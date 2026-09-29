// Sintetizador con las manos: cada dedo índice es una voz; la altura elige la nota.
import { audio, INSTRUMENTS } from '../core/audio.js';
import { settings, onSettingsChange } from '../core/settings.js';
import { scaleNotes, SCALES, noteName, noteColor, SOLFEGE, LETTERS } from '../core/notes.js';
import { TIP } from '../core/hands.js';
import { CameraStage } from '../ui/camera-stage.js';
import { h, settingSelect, settingRange, settingToggle, panelToggle, INSTRUMENT_OPTIONS } from '../ui/dom.js';

export function lanesFor(low, high) {
  if (high <= low) high = low + 12;
  return scaleNotes(settings.synthTonic, settings.synthScale, low, high);
}

/**
 * Zona vertical útil para las notas. Abajo se deja margen de sobra: con la cámara
 * del portátil, si el dedo baja demasiado la muñeca sale de la imagen y se pierde la mano.
 */
export const laneArea = (hh) => ({ top: hh * 0.08, bottom: hh * 0.74 });

/** Posición vertical de una nota en modo theremin (proporcional a la altura del sonido). */
export const pitchY = (m, area, low, high) => area.bottom - ((m - low) / Math.max(1, high - low)) * (area.bottom - area.top);

/** Tono continuo a partir de la altura de la mano (modo theremin). */
export function pitchFromY(y, area, low, high) {
  const t = Math.max(0, Math.min(1, (area.bottom - y) / (area.bottom - area.top)));
  return low + t * (high - low);
}

/** Carril más cercano a una altura, con histéresis para que no "tiemble". */
export function laneFromY(y, area, count, current) {
  const t = 1 - (y - area.top) / (area.bottom - area.top);
  const f = Math.max(0, Math.min(count - 1, t * (count - 1)));
  if (current != null && Math.abs(f - current) < 0.62) return current;
  return Math.round(f);
}

export function laneY(i, area, count) {
  return area.bottom - (i / Math.max(1, count - 1)) * (area.bottom - area.top);
}

/** Dibuja las líneas de las notas y sus nombres. */
export function drawLanes(ctx, w, lanes, area, active = new Set(), targets = new Map(), yOf = null) {
  const notation = settings.notation;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  lanes.forEach((m, i) => {
    const y = yOf ? yOf(m) : laneY(i, area, lanes.length);
    const col = noteColor(m);
    const on = active.has(m);
    const tgt = targets.get(m);
    ctx.strokeStyle = on ? col : tgt ? tgt : m % 12 === settings.synthTonic % 12 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)';
    ctx.lineWidth = on ? 3 : tgt ? 2.5 : 1;
    ctx.setLineDash(on || tgt ? [] : [6, 8]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w - 70, y);
    ctx.stroke();
    ctx.setLineDash([]);
    // etiqueta a la derecha
    const fs = Math.max(12, Math.min(22, (area.bottom - area.top) / lanes.length * 0.6));
    if (notation === 'colores') {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(w - 30, y, fs * 0.45 * (on ? 1.4 : 1), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.font = `800 ${on ? fs * 1.25 : fs}px Nunito, system-ui, sans-serif`;
      ctx.fillStyle = on ? col : 'rgba(255,255,255,0.75)';
      ctx.fillText(noteName(m, notation), w - 14, y);
    }
  });
  ctx.restore();
}

/** Onda del sonido, brillante como en el vídeo. */
export function drawWave(ctx, w, hh) {
  const data = audio.getWaveform();
  if (!data) return;
  const level = audio.getLevel();
  const baseY = hh * 0.87;
  const amp = hh * 0.09 * (0.4 + level);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let s = 0; s < 3; s++) {
    ctx.beginPath();
    const off = s * 7;
    for (let i = 0; i < data.length; i += 4) {
      const x = (i / (data.length - 1)) * w;
      const env = Math.sin((i / data.length) * Math.PI);
      const y = baseY + data[(i + off) % data.length] * amp * env + Math.sin(i * 0.02 + performance.now() * 0.002 + s) * 3;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = `rgba(255,${150 + s * 25},${40 + s * 20},${0.55 - s * 0.12})`;
    ctx.lineWidth = 2.5 - s * 0.6;
    ctx.shadowColor = 'rgba(255,160,40,0.9)';
    ctx.shadowBlur = 12;
    ctx.stroke();
  }
  ctx.restore();
}

export function mount(root) {
  const voices = new Map(); // hand.key → {voice, lane, trail}
  if (import.meta.env.DEV) window.__synthVoices = voices;
  let lanes = lanesFor(settings.synthLow, settings.synthHigh);
  const refreshLanes = () => (lanes = lanesFor(settings.synthLow, settings.synthHigh));
  const rangeOf = () => (settings.synthHigh > settings.synthLow ? [settings.synthLow, settings.synthHigh] : [settings.synthLow, settings.synthLow + 12]);

  const hint = h(
    'div.hint-card',
    h('h3', '¿Cómo se toca?'),
    h('ul',
      h('li', '☝️ Levanta el ', h('b', 'dedo índice'), ' para que suene.'),
      h('li', '↕️ Sube o baja la mano para cambiar de nota (sin bajarla tanto que la muñeca salga de la imagen).'),
      h('li', '↔️ Muévela a los lados para cambiar el sonido.'),
      h('li', '✊ Cierra el puño para callar.'),
      h('li', '🙌 Con las dos manos puedes tocar dos notas a la vez.'),
    ),
    h('button.btn.small', { onclick: () => hint.remove() }, 'Entendido'),
  );

  const stageWrap = h('div.stage-wrap');
  const panel = buildPanel(() => {
    refreshLanes();
    rebuildVoices();
  });
  const view = h('div.view.view-with-panel', stageWrap, panel, panelToggle(panel));
  root.append(view);
  stageWrap.append(hint);

  const isOn = (hand) => {
    if (settings.synthTrigger === 'pinza') return hand.pinch;
    if (settings.synthTrigger === 'siempre') return true;
    return hand.indexUp && !hand.fist;
  };

  function rebuildVoices() {
    for (const v of voices.values()) v.voice.dispose();
    voices.clear();
  }

  const stage = new CameraStage(stageWrap, {
    dim: 0.3,
    onDraw(ctx, w, hh, hands, st) {
      const area = laneArea(hh);
      const seen = new Set();
      const active = new Set();
      for (const hand of hands) {
        seen.add(hand.key);
        let v = voices.get(hand.key);
        if (!v) {
          v = { voice: audio.createVoice(settings.synthInstrument), lane: null, trail: [] };
          voices.set(hand.key, v);
        }
        const tipIdx = settings.synthTrigger === 'pinza' ? null : TIP.index;
        const lm = hand.landmarks;
        const pt = tipIdx != null ? lm[tipIdx] : { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
        const p = st.toScreen(pt);
        let midi;
        if (settings.synthPitchMode === 'libre') {
          // Theremin: el tono sigue a la mano sin saltos; mostramos la nota más cercana.
          const [lo, hi] = rangeOf();
          const f = pitchFromY(p.y, area, lo, hi);
          v.voice.setPitch(f);
          midi = Math.round(f);
          v.cents = Math.round((f - midi) * 100);
        } else {
          v.lane = laneFromY(p.y, area, lanes.length, v.lane);
          midi = lanes[v.lane];
          v.voice.setNote(midi);
          v.cents = 0;
        }
        const xN = Math.max(0, Math.min(1, p.x / w));
        if (settings.synthXControl === 'brillo') v.voice.setBrightness(0.25 + xN * 0.75);
        else v.voice.setBrightness(0.8);
        v.voice.setGain(settings.synthXControl === 'volumen' ? 0.25 + xN * 0.75 : 0.8);
        const on = isOn(hand);
        if (on) {
          v.voice.start();
          active.add(midi);
        } else v.voice.stop();
        v.pos = p;
        v.on = on;
        v.midi = midi;
        v.trail.push({ x: p.x, y: p.y, on, c: noteColor(midi) });
        if (v.trail.length > 24) v.trail.shift();
      }
      for (const [k, v] of voices) {
        if (!seen.has(k)) {
          v.voice.dispose();
          voices.delete(k);
        }
      }
      if (settings.synthPitchMode === 'libre') {
        const [lo, hi] = rangeOf();
        drawLanes(ctx, w, lanes, area, active, new Map(), (m) => pitchY(m, area, lo, hi));
      } else drawLanes(ctx, w, lanes, area, active);
      drawWave(ctx, w, hh);
    },
    afterDraw(ctx) {
      // Estela y nombre de la nota junto al dedo (como la "E" del vídeo)
      for (const v of voices.values()) {
        if (!v.pos) continue;
        v.trail.forEach((t, i) => {
          if (!t.on) return;
          ctx.globalAlpha = (i / v.trail.length) * 0.6;
          ctx.fillStyle = t.c;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 4 + i * 0.35, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        const label = settings.notation === 'colores' ? '●' : noteName(v.midi, settings.notation);
        ctx.font = `900 ${v.on ? 54 : 34}px Nunito, system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        const lx = v.pos.x + 26;
        const ly = v.pos.y - 30;
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = v.on ? noteColor(v.midi) : 'rgba(255,255,255,0.55)';
        ctx.fillText(label, lx, ly);
        // En modo theremin, indicador de afinación: centrado = nota exacta.
        if (settings.synthPitchMode === 'libre' && v.on) {
          const bw = 70;
          const bx = lx;
          const by = ly + 36;
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(bx, by, bw, 8);
          ctx.fillStyle = Math.abs(v.cents) < 15 ? '#2ec4b6' : '#ffbf69';
          ctx.fillRect(bx + bw / 2 + (v.cents / 50) * (bw / 2) - 3, by - 3, 6, 14);
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillRect(bx + bw / 2 - 1, by, 2, 8);
        }
      }
    },
  });

  const off = onSettingsChange((k) => {
    if (['synthScale', 'synthTonic', 'synthLow', 'synthHigh'].includes(k)) refreshLanes();
    if (k === 'synthInstrument') rebuildVoices();
  });

  return () => {
    off();
    rebuildVoices();
    stage.destroy();
    view.remove();
  };
}

const TONIC_OPTIONS = SOLFEGE.map((s, i) => [60 + i, `${s} (${LETTERS[i]})`]);
const RANGE_OPTIONS = [
  [48, 'Do3 (grave)'], [55, 'Sol3'], [60, 'Do4 (central)'], [67, 'Sol4'], [72, 'Do5'], [84, 'Do6'], [96, 'Do7 (agudo)'],
];

function buildPanel(onChange) {
  const panel = h(
    'aside.panel',
    h('h2', '🎛️ Sintetizador'),
    settingSelect('Sonido', 'synthInstrument', INSTRUMENT_OPTIONS(INSTRUMENTS), onChange),
    settingSelect('Tipo de tono', 'synthPitchMode', [
      ['escala', '🎯 Notas fijas (siempre afinado)'],
      ['libre', '〰️ Theremin (tono continuo)'],
    ], onChange),
    h('p.muted.small-note', 'Con notas fijas la mano "salta" de nota en nota dentro de la escala. En modo theremin el sonido se desliza como un theremin real: más expresivo, pero hay que buscar la nota con el oído.'),
    settingSelect('Escala', 'synthScale', Object.entries(SCALES).map(([k, v]) => [k, v.name]), onChange),
    settingSelect('Tónica', 'synthTonic', TONIC_OPTIONS, onChange),
    h('div.field-row',
      settingSelect('Nota más grave', 'synthLow', RANGE_OPTIONS.slice(0, -1), onChange),
      settingSelect('Nota más aguda', 'synthHigh', RANGE_OPTIONS.slice(1), onChange),
    ),
    settingSelect('Cómo se activa el sonido', 'synthTrigger', [
      ['indice', '☝️ Índice levantado'],
      ['pinza', '👌 Juntar pulgar e índice'],
      ['siempre', '✋ Siempre que haya mano'],
    ]),
    settingSelect('Mover la mano a los lados cambia…', 'synthXControl', [
      ['brillo', 'El brillo del sonido'],
      ['volumen', 'El volumen'],
      ['nada', 'Nada'],
    ]),
    settingToggle('Deslizar entre notas (glissando)', 'synthGlide'),
    settingRange('Eco de sala (reverb)', 'reverb'),
    settingRange('Repetición (delay)', 'delay', { max: 0.7 }),
    settingSelect('Nombres de las notas', 'notation', [['solfeo', 'Do, Re, Mi'], ['letras', 'C, D, E'], ['colores', 'Colores']]),
  );
  return panel;
}
