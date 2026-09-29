// Karaoke para la clase: letra gigante con bolita, fondo animado y notas de colores.
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { loadSong } from '../core/library.js';
import { SongPlayer } from '../core/player.js';
import { monophonic, noteNameLines } from '../core/midi-parse.js';
import { noteColor, noteName } from '../core/notes.js';
import { navigate } from '../router.js';
import { LyricsView } from '../ui/lyrics.js';
import { h, segmented, fitCanvas } from '../ui/dom.js';
import { Transport, speedSelect, toggleButton, resultOverlay } from '../ui/transport.js';
import { toggleClassMode } from '../main.js';

export function mount(root, params) {
  let player = null;
  let alive = true;
  let song = null;
  let melody = [];
  let textMode = 'letra';
  let guide = true;

  const titleEl = h('h2.song-title', 'Cargando…');
  const transport = new Transport(() => player, {
    extras: [speedSelect(() => player), toggleButton('🎼 Acompañamiento', 'accompaniment')],
  });
  const textSel = h('span');
  const toolbar = h(
    'div.view-toolbar.wrap',
    h('button.btn.icon', { title: 'Volver a canciones', onclick: () => navigate('library') }, '←'),
    titleEl,
    h('div.spacer'),
    textSel,
    h('button.btn.toggle-btn.on', { onclick: (e) => { guide = !guide; e.currentTarget.classList.toggle('on', guide); player.mode = guide ? 'escuchar' : 'silencio'; } }, '🎵 Melodía guía'),
    h('button.btn', { onclick: () => toggleClassMode(true) }, '📺 Pantalla completa'),
  );
  const bg = h('canvas.karaoke-bg');
  const rollCanvas = h('canvas.karaoke-roll');
  const stageEl = h('div.karaoke-stage', bg, h('div.karaoke-title'), h('div.karaoke-lyrics'), rollCanvas);
  const view = h('div.view.karaoke', toolbar, stageEl, transport.el);
  root.append(view);
  let lyrics = null;

  function setLines() {
    lyrics?.destroy();
    const useNames = textMode === 'notas' || !song.hasLyrics;
    song.__lines = song.__lines || song.lines;
    const lines = useNames ? noteNameLines(melody, (m) => (settings.notation === 'colores' ? '●' : noteName(m, settings.notation))) : song.__lines;
    player.song = { ...song, lines };
    lyrics = new LyricsView(stageEl.querySelector('.karaoke-lyrics'), { size: 'big' });
    lyrics.el.classList.toggle('note-names', useNames);
  }

  // Burbujas / notas flotantes del fondo
  const floaters = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random(), v: 0.0006 + Math.random() * 0.0012, ch: ['♪', '♫', '♩', '♬'][Math.floor(Math.random() * 4)], hue: Math.random() * 360 }));

  function drawBg(t) {
    const { ctx, w, h: hh } = fitCanvas(bg);
    const beat = player ? player.time * (song?.bpm || 100) / 60 : 0;
    const pulse = player?.playing ? Math.pow(1 - (beat % 1), 3) : 0;
    const g = ctx.createLinearGradient(0, 0, w, hh);
    const hue = (t / 80) % 360;
    g.addColorStop(0, `hsl(${hue}, 60%, ${16 + pulse * 4}%)`);
    g.addColorStop(1, `hsl(${(hue + 80) % 360}, 65%, ${12 + pulse * 3}%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      f.y -= f.v * (1 + pulse * 2);
      if (f.y < -0.1) {
        f.y = 1.1;
        f.x = Math.random();
      }
      ctx.font = `${28 * f.s * (1 + pulse * 0.15)}px serif`;
      ctx.fillStyle = `hsla(${(f.hue + hue) % 360}, 90%, 70%, 0.25)`;
      ctx.fillText(f.ch, f.x * w, f.y * hh);
    }
  }

  // Tira inferior con la melodía en colores (como un pentagrama sencillo)
  function drawRoll() {
    const { ctx, w, h: hh } = fitCanvas(rollCanvas);
    ctx.clearRect(0, 0, w, hh);
    if (!player || !melody.length) return;
    const lo = Math.min(...melody.map((n) => n.midi));
    const hi = Math.max(...melody.map((n) => n.midi));
    const span = Math.max(6, hi - lo);
    const nowX = w * 0.2;
    const pps = w / 8;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, hh);
    for (const n of melody) {
      const x = nowX + (n.time - player.time) * pps;
      const x2 = nowX + (n.time + n.duration - player.time) * pps;
      if (x2 < 0 || x > w) continue;
      const y = hh - 14 - ((n.midi - lo) / span) * (hh - 36);
      const on = n.time <= player.time && n.time + n.duration > player.time;
      ctx.fillStyle = noteColor(n.midi);
      ctx.globalAlpha = on ? 1 : 0.75;
      ctx.beginPath();
      ctx.roundRect(x, y - 9, Math.max(18, x2 - x - 3), 18, 9);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (on) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (settings.notation !== 'colores') {
        ctx.fillStyle = '#fff';
        ctx.font = '800 12px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(noteName(n.midi, settings.notation), x + 6, y + 1);
      }
    }
    ctx.fillStyle = 'rgba(255,200,60,0.9)';
    ctx.fillRect(nowX - 1.5, 0, 3, hh);
  }

  const loop = (t) => {
    if (!alive) return;
    requestAnimationFrame(loop);
    player?.update();
    drawBg(t);
    drawRoll();
    if (player) {
      transport.update();
      lyrics?.update(player.lyricState(), player.time);
    }
  };
  requestAnimationFrame(loop);

  (async () => {
    try {
      song = await loadSong(params.songName);
    } catch {
      titleEl.textContent = 'No se pudo cargar la canción';
      return;
    }
    if (!alive) return;
    titleEl.textContent = song.title;
    stageEl.querySelector('.karaoke-title').textContent = song.title;
    const trackIdx = params.practiceTrack ?? song.melodyTrack;
    melody = monophonic(song.tracks[trackIdx]?.notes || []);
    player = new SongPlayer(song, { practiceTrack: trackIdx, practice: melody, mode: 'escuchar', instrument: 'flauta' });
    if (import.meta.env.DEV) window.__player = player;
    player.on('end', () => {
      audio.releaseAll();
      resultOverlay(view, player, { onReplay: () => { player.restart(); player.play(); }, onBack: () => navigate('library') });
    });
    if (song.hasLyrics) {
      textSel.replaceChildren(segmented([['letra', '🎤 Letra'], ['notas', '🎶 Nombres de notas']], textMode, (m) => { textMode = m; setLines(); }));
    }
    setLines();
    player.play();
  })();

  return () => {
    alive = false;
    player?.pause();
    lyrics?.destroy();
    transport.destroy();
    audio.releaseAll();
    view.remove();
  };
}
