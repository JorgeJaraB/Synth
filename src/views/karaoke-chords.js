// Karaoke de acordes: suena la canción (melodía y letra) y el alumno pone los acordes
// con las manos, como en "Acordes con gestos". Los acordes se deducen del MIDI.
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { loadSong } from '../core/library.js';
import { SongPlayer } from '../core/player.js';
import { chordTimeline } from '../core/harmony.js';
import { chordNotes, chordSymbol, chordRoot, romanFor, qualityFor } from '../core/chords.js';
import { ChordHandReader } from '../core/chord-hands.js';
import { noteColor, SOLFEGE, LETTERS } from '../core/notes.js';
import { navigate } from '../router.js';
import { CameraStage } from '../ui/camera-stage.js';
import { LyricsView } from '../ui/lyrics.js';
import { handSvg } from '../ui/hand-svg.js';
import { drawTiltGauge, drawOctaveGauge, drawLock } from '../ui/tilt-gauge.js';
import { h } from '../ui/dom.js';
import { Transport, speedSelect, toggleButton, accompanimentControl, lyricsToggle, modeSelector, scoreBox, resultOverlay } from '../ui/transport.js';

const HAND_SHAPES = ['i', 'im', 'ima', 'imae', 'pimae', 'ie', 'pie'];
const QUALITY_CODE = { mayor: 0, menor: 1, dim: 2 };
/**
 * El reproductor compara "notas": el código junta el grado y si es mayor o menor. Con la mano
 * recta en mayor (como Gesture Synth) no hay gesto de disminuido: vale con hacerlo menor.
 */
const chordCode = (degree, quality) => degree * 10 + QUALITY_CODE[quality === 'dim' && settings.chordStraight !== 'natural' ? 'menor' : quality];
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
function handImage(degree) {
  const side = settings.chordLefty ? 'derecha' : 'izquierda';
  const key = degree + side;
  if (!handImages.has(key)) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(handSvg(HAND_SHAPES[degree - 1], { side, size: 80 }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
    handImages.set(key, img);
  }
  return handImages.get(key);
}

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
  const keyEl = h('span.key-badge');
  const toolbar = h(
    'div.view-toolbar.wrap',
    h('button.btn.icon', { title: 'Volver a canciones', onclick: () => navigate('library') }, '←'),
    titleEl,
    keyEl,
    h('div.spacer'),
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
  const stageWrap = h('div.stage-wrap', nowCard, lyricsHost);
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
    const key = (cur?.id ?? '-') + '/' + (next?.id ?? '-') + settings.notation;
    if (key === shownKey) return;
    shownKey = key;
    const block = (c, big) =>
      c
        ? h('div.kc-chord', { class: big ? 'big' : '', style: { '--c': noteColor(chordRoot(tonic, c.degree)) } },
            h('div.kc-hand', { html: handSvg(HAND_SHAPES[c.degree - 1], { side: settings.chordLefty ? 'derecha' : 'izquierda', size: big ? 96 : 60 }) }),
            h('div', h('b', romanFor(c.degree, c.quality)), h('span', chordSymbol(tonic, c.degree, c.quality, c.voicing || 'triada', settings.notation)), h('small.kc-quality', QUALITY_WORD[c.quality]),
              big && VOICING_HINT[c.voicing] ? h('small.kc-quality', VOICING_HINT[c.voicing]) : null),
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
      const col = c.state === 'miss' ? '#6b6f80' : noteColor(chordRoot(tonic, c.degree));
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
        ctx.fillText(chordSymbol(tonic, c.degree, c.quality, c.voicing || 'triada', settings.notation) + (c.state === 'hit' ? (c.early ? ' ⏩' : ' ✓') : ''), tx, top + 46);
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
        if (stable && !listening) voice.setChord(chordNotes(tonic, stable.degree, stable.quality, stable.voicing, stable.octave));
        else voice.silence();
        voice.setVolume(stable && !listening ? r.volume : 0);
        voice.setBrightness(r.brightness);
      }
      // Se recuerda cuándo empezó el alumno a hacer el acorde actual (para no premiar adelantarse).
      const code = stable ? chordCode(stable.degree, stable.quality) : null;
      if (code !== heldCode) {
        heldCode = code;
        heldSince = player ? player.time : 0;
      }
      // Cuenta aunque no esté la mano derecha (la canción sigue); el puño de esa mano sí calla.
      const fistMuted = r.expr && r.exprMuted;
      if (player && stable && !fistMuted && !listening) player.input(code, { penalize: false, since: heldSince });
      drawLane(ctx, w);
      // Casi: el grado está bien pero falta cambiar entre mayor y menor
      const want = player?.expectedNow?.()[0] || player?.practice.find((c) => !c.state && c.time <= player.time + 0.05 && c.time + c.duration > player.time);
      const nearMiss = !listening && stable && want && want.degree === stable.degree && chordCode(want.degree, want.quality) !== code;
      if (nearMiss) say(`↔️ ¡Casi! Este acorde es ${QUALITY_WORD[want.quality]}: ${qualityHint(want.quality)}`, 300);
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
    const practice = chords.map((c) => ({ midi: chordCode(c.degree, c.quality), degree: c.degree, quality: c.quality, voicing: c.voicing || 'triada', time: c.time, duration: c.duration, velocity: 0.8 }));
    // Por defecto se callan las pistas de acompañamiento (los acordes los pone el alumno);
    // con "Piano de la canción" suenan también, para canciones donde importa más la melodía.
    harmonyTracks = song.tracks.filter((t) => !t.isDrum && t.index !== melodyTrack).map((t) => t.index);
    player = new SongPlayer(song, { practiceTrack: -1, practice, mode, muted: settings.kcOriginalBacking ? [] : harmonyTracks, accGain: settings.kcOriginalBacking ? BACKING_GAIN : 1 });
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
