// Karaoke de acordes: suena la canción (melodía y letra) y el alumno pone los acordes
// con las manos, como en "Acordes con gestos". Los acordes se deducen del MIDI.
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { loadSong } from '../core/library.js';
import { SongPlayer } from '../core/player.js';
import { chordTimeline } from '../core/harmony.js';
import { chordNotes, chordSymbol, chordRoot, romanFor, qualityFor, restQuality } from '../core/chords.js';
import { ChordHandReader } from '../core/chord-hands.js';
import { noteColor, SOLFEGE, LETTERS } from '../core/notes.js';
import { navigate } from '../router.js';
import { CameraStage } from '../ui/camera-stage.js';
import { LyricsView } from '../ui/lyrics.js';
import { handSvg } from '../ui/hand-svg.js';
import { drawTiltGauge, drawOctaveGauge, drawLock } from '../ui/tilt-gauge.js';
import { h, settingToggle } from '../ui/dom.js';
import { Transport, speedSelect, toggleButton, accompanimentControl, lyricsToggle, modeSelector, scoreBox, resultOverlay } from '../ui/transport.js';

const HAND_SHAPES = ['i', 'im', 'ima', 'imae', 'pimae', 'ie', 'pie'];
const QUALITY_CODE = { mayor: 0, menor: 1, dim: 2 };
const VOICING_CODE = { triada: 0, inversion: 1, septima: 2, dominante: 3 };
/**
 * El reproductor compara "notas": el código junta el grado, si es mayor o menor y la variante
 * (los dedos de la mano derecha): para acertar tienen que estar bien las dos manos. Con la mano
 * recta en mayor no hay gesto de disminuido: vale con hacerlo menor.
 */
const chordCode = (degree, quality, voicing = 'triada') =>
  degree * 10 + QUALITY_CODE[quality === 'dim' && settings.chordStraight !== 'natural' ? 'menor' : quality] + 100 * (VOICING_CODE[voicing] || 0);
const VOICING_FINGERS = { triada: '1 dedo', inversion: '2 dedos', septima: '3 dedos', dominante: '4 dedos' };
const QUALITY_WORD = { mayor: 'mayor', menor: 'menor', dim: 'disminuido' };
/** Acordes con séptima (de las canciones de acordes): con cuántos dedos de la otra mano suenan igual. */
const VOICING_HINT = { septima: '🤚 + 3 dedos', dominante: '🤚 + 4 dedos' };
const NOW_X = 0.24;

/** Qué hacer con la mano de los acordes para que suene mayor, menor o disminuido. */
function qualityHint(q) {
  const natural = settings.chordStraight === 'natural';
  if (q === 'mayor') return natural ? 'inclina la mano hacia dentro o ponla recta' : 'pon la mano recta';
  if (q === 'menor') return natural ? 'inclina la mano hacia fuera o ponla recta' : 'inclina la mano hacia fuera';
  return natural ? 'pon la mano recta' : 'inclina la mano hacia fuera';
}
// Con el piano de la canción suenan muchas más notas a la vez: se bajan para no saturar.
const BACKING_GAIN = 0.6;

/** Imágenes de las manos (SVG → imagen) para dibujarlas en el canvas. */
const handImages = new Map();
function handImage(degree, { shape = HAND_SHAPES[degree - 1], expr = false, tilt = 0, size = 80 } = {}) {
  const chordSide = settings.chordLefty ? 'derecha' : 'izquierda';
  const side = expr ? (chordSide === 'izquierda' ? 'derecha' : 'izquierda') : chordSide;
  const key = [shape, side, tilt, size].join('|');
  if (!handImages.has(key)) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(handSvg(shape, { side, size, tilt }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
    handImages.set(key, img);
  }
  return handImages.get(key);
}

/** Clave de un acorde para "los acordes que sabe hacer": grado y calidad ("6menor"). */
const knowKey = (c) => c.degree + (c.quality === 'dim' && settings.chordStraight !== 'natural' ? 'menor' : c.quality);
/** ¿Lo toca la app sola? (el niño todavía no sabe hacer ese acorde) */
const isAutoChord = (c) => (settings.kcUnknown || []).includes(knowKey(c));
// Volumen de los acordes que pone la app sola
const AUTO_VOLUME = 0.7;
/** Inclinación de la mano guía para que suene mayor o menor (como en el tutorial). */
function guideTilt(c) {
  const q = c.quality === 'dim' && settings.chordStraight !== 'natural' ? 'menor' : c.quality;
  if (q === restQuality(c.degree, settings.chordStraight)) return 0;
  return q === 'mayor' ? 28 : -28;
}
const EXPR_SHAPE = { triada: 'i', inversion: 'im', septima: 'ima', dominante: 'imae' };

export function mount(root, params) {
  let player = null;
  let song = null;
  let chords = [];
  let tonic = 48;
  let mode = params.mode || 'esperar';
  let alive = true;
  let voice = null;
  let lyrics = null;
  const reader = new ChordHandReader();
  let heldCode = null; // acorde que hace ahora el alumno
  let heldSince = 0; // desde cuándo (tiempo de la canción)
  // Mensaje corto sobre la cámara (adelantarse, casi acertado…)
  let message = null;
  const say = (text, ms = 1400) => (message = { text, until: performance.now() + ms });
  function drawMessage(ctx, w, hh) {
    if (!message || performance.now() > message.until) return;
    ctx.save();
    ctx.font = '800 22px Nunito, system-ui, sans-serif';
    const tw = ctx.measureText(message.text).width;
    const x = w / 2;
    const y = 112;
    ctx.fillStyle = 'rgba(15,16,32,0.85)';
    ctx.beginPath();
    ctx.roundRect(x - tw / 2 - 18, y - 22, tw + 36, 44, 22);
    ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message.text, x, y + 1);
    ctx.restore();
  }
  let harmonyTracks = []; // pistas que se callan para que los acordes los ponga el alumno

  const score = scoreBox();
  const transport = new Transport(() => player, {
    extras: [
      speedSelect(() => player),
      accompanimentControl(),
      lyricsToggle(() => lyricsHost),
      toggleButton('🎹 Piano de la canción', 'kcOriginalBacking', (on) => {
        if (!player) return;
        player.muted = new Set(on ? [] : harmonyTracks);
        player.accGain = on ? BACKING_GAIN : 1;
      }),
    ],
  });
  const titleEl = h('h2.song-title', 'Cargando…');
  let helpBtn;
  const keyEl = h('span.key-badge');
  const toolbar = h(
    'div.view-toolbar.wrap',
    h('button.btn.icon', { title: 'Volver a canciones', onclick: () => navigate('library') }, '←'),
    titleEl,
    keyEl,
    h('div.spacer'),
    (helpBtn = h('button.btn.help-btn', { title: 'Ayuda para los niños más pequeños', onclick: () => toggleHelp() }, '🧸 Ayuda')),
    modeSelector(mode, (m) => {
      mode = m;
      player.mode = m;
      player.restart();
    }),
    score.el,
  );
  const nowCard = h('div.kc-now');
  const lyricsHost = h('div.kc-lyrics');
  lyricsHost.hidden = !settings.showLyrics;
  // ---------- Ayuda para los peques ----------
  const knownList = h('div.known-list');
  const helpPanel = h('div.kc-help', { hidden: true },
    h('div.kc-help-head', h('b', '🧸 Ayuda para los peques'), h('button.btn.icon.small', { title: 'Cerrar', onclick: () => toggleHelp(false) }, '✕')),
    settingToggle('🔇 Si se equivoca, no suena (solo suena el acorde correcto)', 'kcOnlyCorrect', refreshHelp),
    settingToggle('👻 Manos guía en grande sobre la cámara', 'kcHolograms', refreshHelp),
    h('details.known', { open: (settings.kcUnknown || []).length > 0 },
      h('summary', '🎓 Acordes que sabe hacer'),
      h('p.muted.small', 'Los que no estén marcados los toca la app sola: así se aprenden poco a poco.'),
      knownList,
      h('div.row.known-actions',
        h('button.btn.small', { onclick: () => setUnknown(songKeys(), false) }, '✅ Todos'),
        h('button.btn.small', { onclick: () => setUnknown(songKeys(), true) }, '⬜ Ninguno'),
      ),
    ),
  );
  function toggleHelp(force) {
    helpPanel.hidden = force == null ? !helpPanel.hidden : !force;
    if (!helpPanel.hidden) renderKnown();
  }
  function refreshHelp() {
    helpBtn?.classList.toggle('on', settings.kcOnlyCorrect || settings.kcHolograms || chords.some(isAutoChord));
    player?.refreshAuto();
    shownKey = '';
  }
  const songKeys = () => [...new Set(chords.map(knowKey))];
  /** Marca acordes como "aún no los sabe" (los toca la app) o como sabidos. */
  function setUnknown(keys, unknown) {
    const set = new Set(settings.kcUnknown || []);
    for (const k of keys) unknown ? set.add(k) : set.delete(k);
    settings.kcUnknown = [...set];
    renderKnown();
    refreshHelp();
  }
  /** Una casilla por acorde de la canción, en el orden en que aparecen. */
  function renderKnown() {
    const seen = new Map();
    for (const c of chords) if (!seen.has(knowKey(c))) seen.set(knowKey(c), c);
    knownList.replaceChildren(
      ...[...seen.entries()].map(([k, c]) => {
        const input = h('input', { type: 'checkbox', checked: !isAutoChord(c), onchange: () => setUnknown([k], !input.checked) });
        return h('label.known-item', { style: { '--c': noteColor(chordRoot(tonic, c.degree)) } },
          input,
          h('span.known-hand', { html: handSvg(HAND_SHAPES[c.degree - 1], { side: settings.chordLefty ? 'derecha' : 'izquierda', size: 34, tilt: guideTilt(c) }) }),
          h('b', romanFor(c.degree, c.quality)),
          h('span', chordSymbol(tonic, c.degree, c.quality, 'triada', settings.notation)),
        );
      }),
    );
  }

  const stageWrap = h('div.stage-wrap', nowCard, lyricsHost, helpPanel);
  const view = h('div.view.tutorial', toolbar, h('div.tutorial-body', stageWrap), transport.el);
  root.append(view);

  const label = (c) => ({ text: chordSymbol(tonic, c.degree, c.quality, c.voicing || 'triada', settings.notation), color: noteColor(chordRoot(tonic, c.degree)) });

  // ---------- Tarjeta "Ahora / Siguiente" ----------
  let shownKey = '';
  function updateNowCard() {
    if (!player) return;
    const t = player.time;
    const expected = player.expectedNow?.()[0];
    const cur = expected || player.practice.find((c) => c.time <= t + 0.05 && c.time + c.duration > t) || player.practice.find((c) => c.time > t);
    const next = cur ? player.practice.find((c) => c.time > cur.time) : null;
    const key = (cur?.id ?? '-') + '/' + (next?.id ?? '-') + settings.notation + (cur?.state === 'auto') + (next?.state === 'auto');
    if (key === shownKey) return;
    shownKey = key;
    const block = (c, big) =>
      c
        ? h('div.kc-chord', { class: big ? 'big' : '', style: { '--c': noteColor(chordRoot(tonic, c.degree)) } },
            h('div.kc-hand', { html: handSvg(HAND_SHAPES[c.degree - 1], { side: settings.chordLefty ? 'derecha' : 'izquierda', size: big ? 96 : 60 }) }),
            h('div', h('b', romanFor(c.degree, c.quality)), h('span', chordSymbol(tonic, c.degree, c.quality, c.voicing || 'triada', settings.notation)), h('small.kc-quality', QUALITY_WORD[c.quality]),
              big && VOICING_HINT[c.voicing] ? h('small.kc-quality', VOICING_HINT[c.voicing]) : null,
              c.state === 'auto' ? h('small.kc-quality', '🎵 lo toca la app') : null),
          )
        : null;
    nowCard.replaceChildren(
      ...[
        h('small', player.mode === 'esperar' && expected ? '⏳ Haz este acorde' : 'Ahora'),
        block(cur, true),
        next ? h('small', 'Después') : null,
        block(next, false),
      ].filter(Boolean),
    );
  }

  /** Acorde de la canción que suena ahora (o el que se espera en Practicar). */
  function currentChord() {
    const t = player.time;
    return player.expectedNow?.()[0] || player.practice.find((c) => c.time <= t + 0.05 && c.time + c.duration > t) || null;
  }
  /** ¿Es el acorde que toca ahora? (o el siguiente, si está a punto de llegar) */
  function rightChord(st) {
    const code = chordCode(st.degree, st.quality, st.voicing);
    const t = player?.time ?? 0;
    const cur = player ? currentChord() : null;
    if (cur && cur.midi === code) return true;
    const next = player?.practice.find((c) => c.time > t);
    return !!next && next.time - t < 0.35 && next.midi === code;
  }

  // ---------- Manos guía ("hologramas") en grande sobre la cámara ----------
  function drawGuide(ctx, w, hh) {
    const t = player.time;
    const cur = currentChord();
    // Si el acorde de ahora lo pone la app, se enseña el siguiente que le toca al niño.
    const target = cur && cur.state !== 'auto' ? cur : player.practice.find((c) => c.time > t && c.state !== 'auto');
    if (!target) return;
    const preparing = target !== cur;
    const size = Math.round(Math.min(hh * 0.5, w * 0.3));
    const col = noteColor(chordRoot(tonic, target.degree));
    const chordOnLeft = !settings.chordLefty;
    const cx = w * (chordOnLeft ? 0.27 : 0.73);
    const cy = hh * 0.52;
    const pulse = 0.5 + 0.08 * Math.sin(performance.now() / 300);
    ctx.save();
    ctx.globalAlpha = preparing ? 0.3 : pulse;
    ctx.shadowColor = col;
    ctx.shadowBlur = 40;
    const img = handImage(target.degree, { tilt: guideTilt(target), size: 256 });
    if (img.complete) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    // La otra mano: cuántos dedos (más si el acorde lleva séptima)
    const exprImg = handImage(target.degree, { shape: EXPR_SHAPE[target.voicing] || 'i', expr: true, size: 256 });
    const ex = w * (chordOnLeft ? 0.73 : 0.27);
    ctx.globalAlpha = (preparing ? 0.2 : 0.32);
    if (exprImg.complete) ctx.drawImage(exprImg, ex - size * 0.35, cy - size * 0.35, size * 0.7, size * 0.7);
    ctx.globalAlpha = preparing ? 0.6 : 0.95;
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(size * 0.16)}px Nunito, system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 6;
    const text = (cur?.state === 'auto' ? '🎵 Toca la app · Prepárate: ' : preparing ? 'Prepárate: ' : '') + chordSymbol(tonic, target.degree, target.quality, target.voicing || 'triada', settings.notation);
    // El nombre va encima de la mano (debajo están la letra y la barra de inclinación).
    const ty = cy - size / 2 - size * 0.06;
    ctx.strokeText(text, cx, ty);
    ctx.fillText(text, cx, ty);
    const tilt = guideTilt(target);
    if (tilt) {
      ctx.font = `800 ${Math.round(size * 0.09)}px Nunito, system-ui, sans-serif`;
      const hint = tilt < 0 ? '↔️ inclínala hacia fuera' : '↔️ inclínala hacia dentro';
      ctx.strokeText(hint, cx, ty + size * 0.13);
      ctx.fillText(hint, cx, ty + size * 0.13);
    }
    ctx.restore();
  }

  // ---------- Cinta de acordes ----------
  function drawLane(ctx, w) {
    if (!player) return;
    const t = player.time;
    const top = 10;
    const hh = 64;
    const nowX = w * NOW_X;
    const pps = (w * (1 - NOW_X)) / 6;
    ctx.save();
    ctx.fillStyle = 'rgba(10,11,25,0.55)';
    ctx.fillRect(0, top - 4, w, hh + 8);
    for (const c of player.practice) {
      const x1 = nowX + (c.time - t) * pps;
      const x2 = nowX + (c.time + c.duration - t) * pps;
      if (x2 < 0 || x1 > w) continue;
      const col = c.state === 'miss' || c.state === 'auto' ? '#6b6f80' : noteColor(chordRoot(tonic, c.degree));
      ctx.globalAlpha = c.state === 'hit' ? 1 : 0.88;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(x1 + 2, top, Math.max(8, x2 - x1 - 4), hh, 12);
      ctx.fill();
      if (c.state === 'hit') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const bw = x2 - x1;
      const img = handImage(c.degree);
      let tx = x1 + 12;
      if (bw > 70 && img.complete) {
        ctx.drawImage(img, x1 + 6, top + 4, 56, 46);
        tx = x1 + 64;
      }
      if (bw > 44) {
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '900 22px Nunito, system-ui, sans-serif';
        ctx.fillText(romanFor(c.degree, c.quality), tx, top + 22);
        ctx.font = '800 15px Nunito, system-ui, sans-serif';
        ctx.fillText(chordSymbol(tonic, c.degree, c.quality, c.voicing || 'triada', settings.notation) + (c.state === 'hit' ? (c.early ? ' ⏩' : ' ✓') : c.state === 'auto' ? ' 🎵' : ''), tx, top + 46);
      }
    }
    ctx.fillStyle = 'rgba(255,200,60,0.95)';
    ctx.fillRect(nowX - 2, top - 6, 4, hh + 12);
    ctx.restore();
  }

  // ---------- Cámara y manos ----------
  const stage = new CameraStage(stageWrap, {
    dim: 0.4,
    onDraw(ctx, w, hh, hands, st) {
      player?.update();
      const r = reader.update(hands, st, hh);
      const stable = r.stable;
      if (!voice && audio.ready) voice = audio.createChordVoice(settings.chordInstrument);
      const listening = player?.mode === 'escuchar';
      if (voice) {
        // En "Escuchar" suenan los acordes originales de la canción; si no, los del alumno.
        const cur = player ? currentChord() : null;
        if (!listening && cur?.state === 'auto') {
          // Acorde que el niño aún no sabe: lo pone la app.
          voice.setChord(chordNotes(tonic, cur.degree, cur.quality, cur.voicing || 'triada'));
          voice.setVolume(player.playing ? AUTO_VOLUME : 0);
        } else {
          // Con "solo el correcto", un acorde equivocado no suena (nunca queda disonante).
          const ok = stable && !listening && (!settings.kcOnlyCorrect || rightChord(stable));
          if (ok) voice.setChord(chordNotes(tonic, stable.degree, stable.quality, stable.voicing, stable.octave));
          else voice.silence();
          voice.setVolume(ok ? r.volume : 0);
        }
        voice.setBrightness(r.brightness);
      }
      // Se recuerda cuándo empezó el alumno a hacer el acorde actual (para no premiar adelantarse).
      // Para acertar hacen falta las dos manos: sin la derecha (o con el puño) no cuenta.
      const bothHands = !!(r.expr && r.exprReady && !r.exprMuted) || r.locked;
      // (la variante se lee de la mano ahora mismo: el acorde estable va un instante por detrás)
      const code = stable && bothHands ? chordCode(stable.degree, stable.quality, r.locked ? stable.voicing : r.voicing) : null;
      if (code !== heldCode) {
        heldCode = code;
        heldSince = player ? player.time : 0;
      }
      if (player && code != null && !listening) player.input(code, { penalize: false, since: heldSince });
      drawLane(ctx, w);
      if (settings.kcHolograms && player && !listening) drawGuide(ctx, w, hh);
      // Casi: el grado está bien pero falta cambiar entre mayor y menor
      const want = player?.expectedNow?.()[0] || player?.practice.find((c) => !c.state && c.time <= player.time + 0.05 && c.time + c.duration > player.time);
      const sameShape = !listening && stable && want && want.degree === stable.degree;
      const qualityOk = sameShape && chordCode(want.degree, want.quality) === chordCode(stable.degree, stable.quality);
      if (sameShape && !qualityOk) say(`↔️ ¡Casi! Este acorde es ${QUALITY_WORD[want.quality]}: ${qualityHint(want.quality)}`, 300);
      else if (qualityOk && !bothHands) say(`🤚 ¡Casi! Enseña también la otra mano con ${VOICING_FINGERS[want.voicing || 'triada']}`, 300);
      else if (qualityOk && code !== want.midi) say(`🤚 ¡Casi! Con la otra mano: ${VOICING_FINGERS[want.voicing || 'triada']}`, 300);
      drawMessage(ctx, w, hh);
      if (r.chordInfo && r.chordInfo.degree >= 1) {
        const { pos, degree, tilt } = r.chordInfo;
        ctx.save();
        ctx.fillStyle = noteColor(chordRoot(tonic, degree));
        ctx.beginPath();
        ctx.arc(pos.x, pos.y + 44, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '900 26px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(romanFor(degree, qualityFor(degree, tilt, settings.chordStraight)), pos.x, pos.y + 45);
        ctx.restore();
        drawTiltGauge(ctx, pos.x, pos.y + 110, r.chordInfo.roll, r.chordInfo.onLeft, tilt, settings.chordStraight);
        if (r.locked) drawLock(ctx, pos.x + 34, pos.y + 10);
      } else if (r.locked) drawLock(ctx, 70, 160);
      if (r.exprInfo && settings.chordOctaveTurn && !r.exprInfo.muted) drawOctaveGauge(ctx, r.exprInfo.pos.x, r.exprInfo.pos.y + 60, r.exprInfo.roll, r.exprInfo.octave);
    },
    afterDraw() {
      if (!player) return;
      transport.update();
      score.update(player);
      lyrics?.update(player.lyricState(), player.time);
      updateNowCard();
    },
  });

  (async () => {
    try {
      song = await loadSong(params.songName);
    } catch {
      titleEl.textContent = 'No se pudo cargar la canción';
      return;
    }
    if (!alive) return;
    titleEl.textContent = song.title;
    const melodyTrack = params.practiceTrack ?? song.melodyTrack;
    const res = chordTimeline(song, { melodyTrack });
    tonic = 48 + res.tonic;
    keyEl.textContent = `🎼 ${SOLFEGE[res.tonic]} mayor (${LETTERS[res.tonic]})`;
    chords = res.chords;
    // Los acordes se guardan como "notas" (grado + calidad) para reutilizar el reproductor.
    const practice = chords.map((c) => ({ midi: chordCode(c.degree, c.quality, c.voicing || 'triada'), degree: c.degree, quality: c.quality, voicing: c.voicing || 'triada', time: c.time, duration: c.duration, velocity: 0.8 }));
    // Por defecto se callan las pistas de acompañamiento (los acordes los pone el alumno);
    // con "Piano de la canción" suenan también, para canciones donde importa más la melodía.
    harmonyTracks = song.tracks.filter((t) => !t.isDrum && t.index !== melodyTrack).map((t) => t.index);
    player = new SongPlayer(song, { practiceTrack: -1, practice, mode, isAuto: isAutoChord, muted: settings.kcOriginalBacking ? [] : harmonyTracks, accGain: settings.kcOriginalBacking ? BACKING_GAIN : 1 });
    if (import.meta.env.DEV) window.__kc = { player, chords, get reader() { return reader; }, get voice() { return voice; } };
    player.on('early', () => say(player.mode === 'tiempo' ? '⏩ ¡Muy pronto! Cambia de acorde cuando llegue a la línea' : '⏩ Te has adelantado: espera a que llegue a la línea'));
    player.on('end', () => {
      voice?.silence();
      audio.releaseAll();
      resultOverlay(view, player, { onReplay: () => { player.restart(); player.play(); }, onBack: () => navigate('library') });
    });
    if (song.hasLyrics) {
      lyrics = new LyricsView(lyricsHost, { size: 'normal' });
      lyrics.el.classList.add('with-chords');
      lyrics.setChords(chords, label);
    }
    if (!chords.length) nowCard.replaceChildren(h('p', 'No se han encontrado acordes en esta canción.'));
    refreshHelp();
    player.play();
  })();

  return () => {
    alive = false;
    player?.pause();
    voice?.dispose();
    stage.destroy();
    transport.destroy();
    audio.releaseAll();
    view.remove();
  };
}
