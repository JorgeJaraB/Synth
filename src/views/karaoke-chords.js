// Karaoke de acordes: suena la canción (melodía y letra) y el alumno pone los acordes
// con las manos, como en "Acordes con gestos". Los acordes se deducen del MIDI.
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { loadSong } from '../core/library.js';
import { SongPlayer } from '../core/player.js';
import { chordTimeline } from '../core/harmony.js';
import { chordNotes, chordSymbol, chordRoot, romanFor, NATURAL_QUALITY, qualityFor } from '../core/chords.js';
import { ChordHandReader } from '../core/chord-hands.js';
import { noteColor, SOLFEGE, LETTERS } from '../core/notes.js';
import { navigate } from '../router.js';
import { CameraStage } from '../ui/camera-stage.js';
import { LyricsView } from '../ui/lyrics.js';
import { handSvg } from '../ui/hand-svg.js';
import { h } from '../ui/dom.js';
import { Transport, speedSelect, toggleButton, modeSelector, scoreBox, resultOverlay } from '../ui/transport.js';

const HAND_SHAPES = ['i', 'im', 'ima', 'imae', 'pimae', 'ie', 'pie'];
const NOW_X = 0.24;

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

  const score = scoreBox();
  const transport = new Transport(() => player, {
    extras: [speedSelect(() => player), toggleButton('🎼 Acompañamiento', 'accompaniment')],
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
  const stageWrap = h('div.stage-wrap', nowCard, lyricsHost);
  const view = h('div.view.tutorial', toolbar, h('div.tutorial-body', stageWrap), transport.el);
  root.append(view);

  const label = (c) => ({ text: chordSymbol(tonic, c.degree, c.quality, 'triada', settings.notation), color: noteColor(chordRoot(tonic, c.degree)) });

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
        ? h('div.kc-chord', { class: big ? 'big' : '', style: { '--c': noteColor(chordRoot(tonic, c.midi)) } },
            h('div.kc-hand', { html: handSvg(HAND_SHAPES[c.midi - 1], { side: settings.chordLefty ? 'derecha' : 'izquierda', size: big ? 96 : 60 }) }),
            h('div', h('b', romanFor(c.midi, NATURAL_QUALITY[c.midi - 1])), h('span', chordSymbol(tonic, c.midi, NATURAL_QUALITY[c.midi - 1], 'triada', settings.notation))),
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
      const col = c.state === 'miss' ? '#6b6f80' : noteColor(chordRoot(tonic, c.midi));
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
      const img = handImage(c.midi);
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
        ctx.fillText(romanFor(c.midi, NATURAL_QUALITY[c.midi - 1]), tx, top + 22);
        ctx.font = '800 15px Nunito, system-ui, sans-serif';
        ctx.fillText(chordSymbol(tonic, c.midi, NATURAL_QUALITY[c.midi - 1], 'triada', settings.notation) + (c.state === 'hit' ? ' ✓' : ''), tx, top + 46);
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
        if (stable && !listening) voice.setChord(chordNotes(tonic, stable.degree, stable.quality, stable.voicing));
        else voice.silence();
        voice.setVolume(stable && !listening ? r.volume : 0);
        voice.setBrightness(r.brightness);
      }
      if (player && stable && !r.exprMuted && !listening) player.input(stable.degree, { penalize: false });
      drawLane(ctx, w);
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
        ctx.fillText(romanFor(degree, qualityFor(degree, tilt)), pos.x, pos.y + 45);
        ctx.restore();
      }
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
    // Los acordes se guardan como "notas" cuyo valor es el grado (1..7) para reutilizar el reproductor.
    const practice = chords.map((c) => ({ midi: c.degree, time: c.time, duration: c.duration, velocity: 0.8 }));
    const muted = song.tracks.filter((t) => !t.isDrum && t.index !== melodyTrack).map((t) => t.index);
    player = new SongPlayer(song, { practiceTrack: -1, practice, mode, muted });
    if (import.meta.env.DEV) window.__kc = { player, chords, get reader() { return reader; }, get voice() { return voice; } };
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
