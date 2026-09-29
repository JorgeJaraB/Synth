// Piano: táctil (pantalla / ratón / teclado) o "en el aire" con la cámara.
import { audio, INSTRUMENTS } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { noteName, noteColor } from '../core/notes.js';
import { TouchKeyboard } from '../ui/keyboard.js';
import { CameraStage } from '../ui/camera-stage.js';
import { AirPiano } from '../ui/air-piano.js';
import { h, fitCanvas, panelToggle, segmented, settingSelect, settingToggle, settingRange, INSTRUMENT_OPTIONS } from '../ui/dom.js';

const RANGES = [
  ['48-72', '2 octavas (Do3–Do5)'],
  ['48-84', '3 octavas (Do3–Do6)'],
  ['36-96', '5 octavas (Do2–Do7)'],
  ['60-72', '1 octava grande (Do4–Do5)'],
];

export function airPianoHint() {
  return settings.airPianoMode === 'extender'
    ? '✊ Pon la mano cerrada sobre el teclado y ☝️ extiende un dedo para tocar la tecla que tiene debajo. Al doblarlo, la nota se para. Si no llegas bien, cambia la altura del teclado en Opciones.'
    : '🖐️ Pon las manos abajo, con la palma hacia la mesa, como en un piano. 👇 Baja un dedo más que los otros para tocar la tecla que tiene debajo; al subirlo, la nota se para. Si cuesta, cambia la sensibilidad en Opciones.';
}

export function mount(root, params = {}) {
  let mode = params.mode || 'pantalla';
  let cleanup = null;
  const body = h('div.piano-body');
  const recent = h('div.recent-notes');
  const header = h(
    'div.view-toolbar',
    h('h2', '🎹 Piano'),
    segmented([['pantalla', '👆 Tocar la pantalla'], ['camara', '🖐️ Tocar en el aire']], mode, (m) => {
      mode = m;
      render();
    }),
    h('div.spacer'),
    recent,
  );
  const sensField = settingSelect('Sensibilidad al bajar el dedo', 'airPianoSensitivity', [
    ['alta', 'Alta (basta con bajarlo un poco)'],
    ['normal', 'Normal'],
    ['baja', 'Baja (hay que bajarlo bastante)'],
  ]);
  const posField = settingSelect('Altura del teclado en la cámara', 'airPianoPosition', [['arriba', 'Arriba'], ['centro', 'En el centro (portátil)'], ['abajo', 'Abajo']]);
  const syncOptions = () => {
    sensField.hidden = settings.airPianoMode === 'extender';
    posField.hidden = settings.airPianoMode !== 'extender';
  };
  syncOptions();
  const panel = h(
    'aside.panel',
    h('h2', 'Opciones'),
    settingSelect('Instrumento', 'pianoInstrument', INSTRUMENT_OPTIONS(INSTRUMENTS), () => audio.releaseAll()),
    h('label.field', h('span.field-label', 'Tamaño del teclado (pantalla)'),
      h('select', { onchange: (e) => { const [a, b] = e.target.value.split('-').map(Number); settings.pianoLow = a; settings.pianoHigh = b; render(); } },
        RANGES.map(([v, t]) => h('option', { value: v, selected: v === `${settings.pianoLow}-${settings.pianoHigh}` }, t)))),
    settingSelect('Teclas en el aire (cámara)', 'airPianoOctaves', [
      [1, '1 octava (teclas grandes)'],
      [2, '2 octavas'],
      [3, '3 octavas'],
      [4, '4 octavas (teclas pequeñas)'],
    ], render),
    settingSelect('Empieza en', 'airPianoStart', [[36, 'Do2 (grave)'], [48, 'Do3'], [60, 'Do4 (central)'], [72, 'Do5']], render),
    settingSelect('Cómo se toca en el aire', 'airPianoMode', [
      ['pulsar', '👇 Bajar un dedo (como un piano)'],
      ['extender', '☝️ Extender un dedo'],
    ], () => { syncOptions(); render(); }),
    sensField,
    posField,
    settingToggle('Mostrar nombres en las teclas', 'pianoLabels'),
    settingSelect('Nombres de las notas', 'notation', [['solfeo', 'Do, Re, Mi'], ['letras', 'C, D, E'], ['colores', 'Colores']]),
    settingRange('Eco de sala (reverb)', 'reverb'),
    h('p.muted', '⌨️ También puedes tocar con el teclado del ordenador: A S D F G H J K (blancas) y W E T Y U (negras). Z / X cambian de octava.'),
  );
  header.append(panelToggle(panel));
  const view = h('div.view.view-with-panel', h('div.main-col', header, body), panel);
  root.append(view);

  const history = [];
  const showNote = (m) => {
    history.push(m);
    if (history.length > 8) history.shift();
    recent.replaceChildren(
      ...history.map((x, i) =>
        h('span.note-chip', { style: { background: noteColor(x), opacity: 0.35 + (i / history.length) * 0.65 } }, settings.notation === 'colores' ? '' : noteName(x, settings.notation)),
      ),
    );
  };
  // Notas que "suben" desde el teclado mientras se tocan (visualizador).
  const rising = [];
  const noteOn = (m, v) => {
    audio.noteOn(m, v, settings.pianoInstrument);
    showNote(m);
    rising.push({ midi: m, start: performance.now(), end: null });
  };
  const noteOff = (m) => {
    audio.noteOff(m, settings.pianoInstrument);
    for (const r of rising) if (r.midi === m && r.end == null) r.end = performance.now();
  };
  function drawRising(canvas, layout) {
    const { ctx, w, h: hh } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, hh);
    if (!layout) return;
    const now = performance.now();
    const speed = 0.12; // px por ms
    for (let i = rising.length - 1; i >= 0; i--) {
      const r = rising[i];
      const k = layout.keys.get(r.midi);
      const yTop = hh - (now - r.start) * speed;
      const yBot = r.end == null ? hh : hh - (now - r.end) * speed;
      if (yBot < -10 || !k) {
        rising.splice(i, 1);
        continue;
      }
      const col = noteColor(r.midi);
      const x = k.x + 12 + k.w * 0.1;
      const bw = k.w * 0.8;
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.globalAlpha = Math.max(0.15, Math.min(1, yBot / hh + 0.3));
      ctx.beginPath();
      ctx.roundRect(x, yTop, bw, Math.max(8, yBot - yTop), 6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function render() {
    cleanup?.();
    body.replaceChildren();
    if (mode === 'pantalla') {
      const canvas = h('canvas.keyboard-canvas');
      const glow = h('div.piano-glow');
      const risingCanvas = h('canvas.rising-canvas');
      body.append(glow, risingCanvas, h('div.keyboard-wrap', canvas));
      const kb = new TouchKeyboard(canvas, { low: settings.pianoLow, high: settings.pianoHigh, onNoteOn: noteOn, onNoteOff: noteOff });
      let alive = true;
      const loop = () => {
        if (!alive) return;
        requestAnimationFrame(loop);
        kb.draw();
        drawRising(risingCanvas, kb.layout);
        const cols = [...kb.pressedMap().keys()].map(noteColor);
        glow.style.background = cols.length ? `radial-gradient(ellipse at 50% 100%, ${cols[cols.length - 1]}55, transparent 70%)` : 'transparent';
      };
      loop();
      cleanup = () => {
        alive = false;
        kb.destroy();
      };
    } else {
      const wrap = h('div.stage-wrap');
      body.append(wrap);
      const air = new AirPiano({ onNoteOn: noteOn, onNoteOff: noteOff });
      const stage = new CameraStage(wrap, {
        dim: 0.2,
        onDraw(ctx, w, hh, hands, st) {
          air.update(hands, st);
          air.draw(ctx);
        },
      });
      wrap.append(h('div.hint-card.compact', airPianoHint()));
      cleanup = () => {
        air.releaseAll();
        stage.destroy();
      };
    }
  }
  render();

  return () => {
    cleanup?.();
    audio.releaseAll();
    view.remove();
  };
}
