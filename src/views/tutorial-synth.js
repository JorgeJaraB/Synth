// Tutorial con las manos: las notas avanzan por carriles y un anillo
// indica dónde colocar la mano en cada momento.
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { loadSong } from '../core/library.js';
import { SongPlayer } from '../core/player.js';
import { monophonic } from '../core/midi-parse.js';
import { noteColor, noteName } from '../core/notes.js';
import { navigate } from '../router.js';
import { CameraStage } from '../ui/camera-stage.js';
import { LyricsView } from '../ui/lyrics.js';
import { h } from '../ui/dom.js';
import { Transport, speedSelect, toggleButton, accompanimentControl, modeSelector, scoreBox, resultOverlay } from '../ui/transport.js';
import { laneFromY, laneY, drawWave, handIsOn, handPoint, TRIGGER_OPTIONS } from './synth.js';

const PLAY_X = 0.28; // posición de la línea de juego (fracción del ancho)

export function mount(root, params) {
  let player = null;
  let mode = params.mode || 'esperar';
  let alive = true;
  let lanes = [];
  let melody = [];
  const voices = new Map();

  const score = scoreBox();
  // Misma opción que en el sintetizador: índice, pinza o siempre.
  const triggerSelect = h(
    'select.compact',
    { title: 'Cómo se activa el sonido', onchange: (e) => { settings.synthTrigger = e.target.value; updateHint(); } },
    TRIGGER_OPTIONS.map(([v, t]) => h('option', { value: v, selected: v === settings.synthTrigger }, t)),
  );
  const transport = new Transport(() => player, {
    extras: [speedSelect(() => player), accompanimentControl(), toggleButton('🥁 Metrónomo', 'metronome')],
  });
  const titleEl = h('h2.song-title', 'Cargando…');
  const toolbar = h(
    'div.view-toolbar.wrap',
    h('button.btn.icon', { title: 'Volver a canciones', onclick: () => navigate('library') }, '←'),
    titleEl,
    h('div.spacer'),
    modeSelector(mode, (m) => { mode = m; player.mode = m; player.restart(); }),
    triggerSelect,
    score.el,
  );
  const lyricsHost = h('div.lyrics-host');
  const stageWrap = h('div.stage-wrap');
  const view = h('div.view.tutorial', toolbar, lyricsHost, h('div.tutorial-body', stageWrap), transport.el);
  root.append(view);
  const hintEl = h('div.hint-card.compact');
  const updateHint = () => {
    hintEl.textContent = settings.synthTrigger === 'pinza'
      ? '👌 Junta el pulgar y el índice dentro del anillo brillante para que suene. ¡Mantenlos ahí cuando llegue la nota!'
      : settings.synthTrigger === 'siempre'
        ? '✋ Pon la mano en el anillo brillante: suena siempre que se vea la mano.'
        : '☝️ Pon el dedo índice dentro del anillo brillante. Cuando la nota llegue a la línea, ¡mantenla ahí!';
    hintEl.style.animation = 'none';
    void hintEl.offsetWidth;
    hintEl.style.animation = '';
  };
  updateHint();
  stageWrap.append(hintEl);
  let lyrics = null;

  // Misma zona segura que el sintetizador (la muñeca debe verse en la cámara del portátil).
  const area = (hh) => ({ top: hh * 0.1, bottom: hh * 0.74 });

  function drawScene(ctx, w, hh, active) {
    const a = area(hh);
    const playX = w * PLAY_X;
    const pps = (w * (1 - PLAY_X)) / (settings.lookahead * 1.2);
    // Carriles
    lanes.forEach((m, i) => {
      const y = laneY(i, a, lanes.length);
      ctx.strokeStyle = active.has(m) ? noteColor(m) : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = active.has(m) ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.font = `800 ${Math.min(24, (a.bottom - a.top) / lanes.length * 0.55)}px Nunito, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = settings.notation === 'colores' ? noteColor(m) : 'rgba(255,255,255,0.85)';
      ctx.fillText(settings.notation === 'colores' ? '●' : noteName(m, settings.notation), 12, y);
    });
    // Línea de juego
    ctx.fillStyle = 'rgba(255,170,40,0.18)';
    ctx.fillRect(playX - 3, a.top - 20, 6, a.bottom - a.top + 40);
    if (!player) return;
    const t = player.time;
    const laneH = (a.bottom - a.top) / Math.max(1, lanes.length - 1);
    const barH = Math.max(14, Math.min(34, laneH * 0.6));
    for (const n of player.practice) {
      const x1 = playX + (n.time - t) * pps;
      const x2 = playX + (n.time + n.duration - t) * pps;
      if (x2 < -20 || x1 > w + 20) continue;
      const li = lanes.indexOf(n.midi);
      if (li < 0) continue;
      const y = laneY(li, a, lanes.length);
      const col = n.state === 'miss' ? '#6b6f80' : noteColor(n.midi);
      ctx.fillStyle = col;
      if (n.state === 'hit') {
        ctx.shadowColor = col;
        ctx.shadowBlur = 20;
      }
      ctx.beginPath();
      ctx.roundRect(x1, y - barH / 2, Math.max(barH, x2 - x1 - 3), barH, barH / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (n.state === 'hit') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    // Anillo objetivo: la nota que toca ahora o la siguiente
    const target = player.practice.find((n) => n.time + n.duration > t && n.state !== 'hit') || null;
    if (target) {
      const li = lanes.indexOf(target.midi);
      const y = laneY(li, a, lanes.length);
      const until = target.time - t;
      const pulse = 1 + Math.sin(performance.now() / 150) * 0.08;
      const r = (barH * 1.2 + Math.max(0, Math.min(1.5, until)) * 25) * pulse;
      ctx.strokeStyle = noteColor(target.midi);
      ctx.lineWidth = 5;
      ctx.shadowColor = noteColor(target.midi);
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(playX, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      targetPos = { x: playX, y, midi: target.midi };
    } else targetPos = null;
  }

  let targetPos = null;

  const stage = new CameraStage(stageWrap, {
    dim: 0.45,
    onDraw(ctx, w, hh, hands, st) {
      player?.update();
      const a = area(hh);
      const active = new Set();
      const seen = new Set();
      for (const hand of hands) {
        seen.add(hand.key);
        let v = voices.get(hand.key);
        if (!v) {
          v = { voice: audio.createVoice(settings.synthInstrument), lane: null };
          voices.set(hand.key, v);
        }
        const p = st.toScreen(handPoint(hand));
        v.pos = p;
        if (!lanes.length) continue;
        v.lane = laneFromY(p.y, a, lanes.length, v.lane);
        const midi = lanes[v.lane];
        v.midi = midi;
        v.voice.setNote(midi);
        v.voice.setBrightness(0.8);
        const on = handIsOn(hand) && player?.mode !== 'escuchar';
        v.on = on;
        if (on) {
          v.voice.start();
          active.add(midi);
        } else v.voice.stop();
      }
      for (const [k, v] of voices) if (!seen.has(k)) { v.voice.dispose(); voices.delete(k); }
      if (player && player.mode !== 'escuchar') for (const m of active) player.input(m, { penalize: false });
      if (player?.mode === 'escuchar') for (const n of player.practice) if (n.time <= player.time && n.time + n.duration > player.time) active.add(n.midi);
      drawScene(ctx, w, hh, active);
      drawWave(ctx, w, hh);
    },
    afterDraw(ctx) {
      for (const v of voices.values()) {
        if (!v.pos) continue;
        // Flecha desde el dedo hasta el anillo objetivo
        if (targetPos && v.midi !== targetPos.midi) {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.setLineDash([8, 8]);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(v.pos.x, v.pos.y);
          ctx.lineTo(targetPos.x, targetPos.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.arc(v.pos.x, v.pos.y, v.on ? 16 : 11, 0, Math.PI * 2);
        ctx.fillStyle = v.on && v.midi != null ? noteColor(v.midi) : 'rgba(255,255,255,0.7)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
      if (player) {
        transport.update();
        score.update(player);
        lyrics?.update(player.lyricState(), player.time);
      }
    },
  });

  (async () => {
    let song;
    try {
      song = await loadSong(params.songName);
    } catch {
      titleEl.textContent = 'No se pudo cargar la canción';
      return;
    }
    if (!alive) return;
    titleEl.textContent = song.title;
    const trackIdx = params.practiceTrack ?? song.melodyTrack;
    melody = monophonic(song.tracks[trackIdx]?.notes || []);
    lanes = [...new Set(melody.map((n) => n.midi))].sort((x, y) => x - y);
    player = new SongPlayer(song, { practiceTrack: trackIdx, practice: melody, mode, instrument: settings.synthInstrument });
    if (import.meta.env.DEV) window.__player = player;
    player.on('end', () => {
      audio.releaseAll();
      resultOverlay(view, player, { onReplay: () => { player.restart(); player.play(); }, onBack: () => navigate('library') });
    });
    if (song.hasLyrics) lyrics = new LyricsView(lyricsHost, { size: 'small' });
    player.play();
  })();

  return () => {
    alive = false;
    player?.pause();
    for (const v of voices.values()) v.voice.dispose();
    stage.destroy();
    transport.destroy();
    audio.releaseAll();
    view.remove();
  };
}
