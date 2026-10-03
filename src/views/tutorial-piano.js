// Tutorial de piano: las notas caen sobre el teclado (táctil o en el aire).
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { loadSong } from '../core/library.js';
import { SongPlayer } from '../core/player.js';
import { noteColor } from '../core/notes.js';
import { navigate } from '../router.js';
import { TouchKeyboard } from '../ui/keyboard.js';
import { CameraStage } from '../ui/camera-stage.js';
import { AirPiano } from '../ui/air-piano.js';
import { LyricsView } from '../ui/lyrics.js';
import { drawFalling, activeNotes, upcomingNotes } from '../ui/falling.js';
import { h, segmented, fitCanvas } from '../ui/dom.js';
import { Transport, speedSelect, toggleButton, accompanimentControl, lyricsToggle, modeSelector, scoreBox, resultOverlay } from '../ui/transport.js';

/** Rango de teclado que abarca la canción, empezando y acabando en Do. */
export function rangeFor(notes, minOctaves = 2) {
  if (!notes.length) return [60, 84];
  let lo = Math.min(...notes.map((n) => n.midi));
  let hi = Math.max(...notes.map((n) => n.midi));
  lo = lo - (lo % 12);
  hi = hi + ((12 - (hi % 12)) % 12);
  if (hi === lo) hi += 12;
  while (hi - lo < minOctaves * 12) {
    if ((hi - lo) / 12 % 2) lo -= 12;
    else hi += 12;
  }
  return [lo, hi];
}

export function mount(root, params) {
  let player = null;
  let input = params.input || 'pantalla';
  let mode = params.mode || 'esperar';
  let alive = true;
  let cleanupInput = null;
  let song = null;
  let practiceNotes = [];
  const particles = [];
  let wrongFlash = new Map();

  const body = h('div.tutorial-body');
  const score = scoreBox();
  const transport = new Transport(() => player, {
    extras: [speedSelect(() => player), accompanimentControl(), lyricsToggle(() => lyricsHost), toggleButton('🥁 Metrónomo', 'metronome')],
  });
  const titleEl = h('h2.song-title', 'Cargando…');
  const toolbar = h(
    'div.view-toolbar.wrap',
    h('button.btn.icon', { title: 'Volver a canciones', onclick: () => navigate('library') }, '←'),
    titleEl,
    h('div.spacer'),
    modeSelector(mode, (m) => { mode = m; player.mode = m; player.restart(); }),
    segmented([['pantalla', '👆 Pantalla'], ['camara', '🖐️ Cámara']], input, (v) => { input = v; buildInput(); }),
    score.el,
  );
  const lyricsHost = h('div.lyrics-host');
  lyricsHost.hidden = !settings.showLyrics;
  const view = h('div.view.tutorial', toolbar, lyricsHost, body, transport.el);
  root.append(view);
  let lyrics = null;

  const hit = (m) => {
    audio.noteOn(m, 0.85, settings.pianoInstrument);
    if (!player || player.mode === 'escuchar') return;
    const ok = player.input(m);
    if (!ok && player.mode !== 'escuchar') wrongFlash.set(m, performance.now());
  };
  const release = (m) => audio.noteOff(m, settings.pianoInstrument);

  const hints = () => {
    if (!player) return new Map();
    if (player.mode === 'esperar') {
      const exp = player.expectedNow();
      if (exp.length) return new Map(exp.map((n) => [n.midi, noteColor(n.midi)]));
    }
    return upcomingNotes(player.practice, player.time, 0.5);
  };
  const external = () => {
    const map = player && player.mode === 'escuchar' ? activeNotes(player.practice, player.time) : new Map();
    const now = performance.now();
    for (const [m, t] of wrongFlash) {
      if (now - t < 250) map.set(m, '#555a70');
      else wrongFlash.delete(m);
    }
    return map;
  };

  function spawnParticles(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI - Math.PI;
      const sp = 2 + Math.random() * 4;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color });
    }
  }
  function drawParticles(ctx) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life -= 0.03;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 + p.life * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  let currentLayout = null;
  let currentArea = null;

  function buildInput() {
    cleanupInput?.();
    body.replaceChildren();
    audio.releaseAll();
    // Con la cámara se respeta el número de octavas elegido en Piano → Opciones.
    const [lo, hi] = rangeFor(practiceNotes, input === 'camara' ? settings.airPianoOctaves : 2);
    if (input === 'pantalla') {
      const fallCanvas = h('canvas.fall-canvas');
      const kbCanvas = h('canvas.keyboard-canvas.tutorial-kb');
      body.append(fallCanvas, h('div.keyboard-wrap', kbCanvas));
      const kb = new TouchKeyboard(kbCanvas, { low: lo, high: hi, onNoteOn: hit, onNoteOff: release, getHints: hints, keyboardBase: practiceNotes.length ? Math.min(...practiceNotes.map((n) => n.midi)) - (Math.min(...practiceNotes.map((n) => n.midi)) % 12) : 60 });
      let running = true;
      const loop = () => {
        if (!running || !alive) return;
        requestAnimationFrame(loop);
        player?.update();
        kb.external = external();
        kb.draw();
        const { ctx, w, h: hh } = fitCanvas(fallCanvas);
        ctx.clearRect(0, 0, w, hh);
        if (player && kb.layout) {
          currentLayout = kb.layout;
          currentArea = { top: 0, bottom: hh, offsetY: 0 };
          drawFalling(ctx, kb.layout, player.practice, player.time, { top: 0, bottom: hh }, { beats: player.song.beats });
          ctx.save();
          ctx.translate(0, hh);
          drawParticles(ctx);
          ctx.restore();
        }
        tick();
      };
      loop();
      cleanupInput = () => {
        running = false;
        kb.destroy();
      };
    } else {
      const wrap = h('div.stage-wrap');
      body.append(wrap);
      const air = new AirPiano({ onNoteOn: hit, onNoteOff: release, getHints: hints });
      air.setRange(lo, hi);
      const stage = new CameraStage(wrap, {
        dim: 0.45,
        onDraw(ctx, w, hh, hands, st) {
          player?.update();
          air.external = external();
          air.update(hands, st);
          if (player && air.layout) {
            currentLayout = air.layout;
            currentArea = { top: 0, bottom: air.layout.y, offsetY: 0 };
            drawFalling(ctx, air.layout, player.practice, player.time, { top: 8, bottom: air.layout.y }, { beats: player.song.beats });
            ctx.save();
            ctx.translate(0, air.layout.y);
            drawParticles(ctx);
            ctx.restore();
          }
          air.draw(ctx);
          tick();
        },
      });
      cleanupInput = () => {
        air.releaseAll();
        stage.destroy();
      };
    }
  }

  function tick() {
    if (!player) return;
    transport.update();
    score.update(player);
    lyrics?.update(player.lyricState(), player.time);
  }

  (async () => {
    try {
      song = await loadSong(params.songName);
    } catch (e) {
      titleEl.textContent = 'No se pudo cargar la canción';
      return;
    }
    if (!alive) return;
    titleEl.textContent = song.title;
    const trackIdx = params.practiceTrack ?? song.melodyTrack;
    practiceNotes = song.tracks[trackIdx]?.notes || [];
    const makePlayer = () => {
      player = new SongPlayer(song, { practiceTrack: trackIdx, mode });
      player.on('hit', (n) => {
        const k = currentLayout?.keys.get(n.midi);
        if (k) spawnParticles(k.x + k.w / 2, 0, noteColor(n.midi));
      });
      if (import.meta.env.DEV) window.__player = player;
    player.on('end', () => {
        audio.releaseAll();
        resultOverlay(view, player, { onReplay: () => { player.restart(); player.play(); }, onBack: () => navigate('library') });
      });
    };
    makePlayer();
    if (song.hasLyrics) lyrics = new LyricsView(lyricsHost, { size: 'small' });
    buildInput();
    player.play();
  })();

  return () => {
    alive = false;
    player?.pause();
    cleanupInput?.();
    transport.destroy();
    audio.releaseAll();
    view.remove();
  };
}
