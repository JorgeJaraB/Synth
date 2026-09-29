// Teclado de piano dibujado en canvas: geometría, dibujo y control táctil multitoque.
import { isBlack, noteColor, noteName } from '../core/notes.js';
import { settings } from '../core/settings.js';
import { fitCanvas } from './dom.js';

/** Calcula la posición de cada tecla. */
export function keyLayout(low, high, x, y, width, height) {
  if (isBlack(low)) low--;
  if (isBlack(high)) high++;
  const whites = [];
  for (let m = low; m <= high; m++) if (!isBlack(m)) whites.push(m);
  const ww = width / whites.length;
  const keys = new Map();
  whites.forEach((m, i) => keys.set(m, { midi: m, x: x + i * ww, y, w: ww, h: height, black: false }));
  for (let m = low; m <= high; m++) {
    if (!isBlack(m)) continue;
    const left = keys.get(m - 1);
    if (!left) continue;
    const bw = ww * 0.6;
    keys.set(m, { midi: m, x: left.x + ww - bw / 2, y, w: bw, h: height * 0.62, black: true });
  }
  return { low, high, x, y, width, height, whiteWidth: ww, keys };
}

/** Tecla bajo un punto (las negras tienen prioridad). */
export function keyAt(layout, px, py) {
  if (py < layout.y || py > layout.y + layout.height) return null;
  for (const k of layout.keys.values()) if (k.black && px >= k.x && px <= k.x + k.w && py <= k.y + k.h) return k.midi;
  for (const k of layout.keys.values()) if (!k.black && px >= k.x && px < k.x + k.w) return k.midi;
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.closePath();
}

/**
 * Dibuja el teclado.
 * opts.pressed: Map<midi, color|true>, opts.hints: Map<midi, color>, opts.alpha: opacidad
 */
export function drawKeyboard(ctx, layout, opts = {}) {
  const { pressed = new Map(), hints = new Map(), alpha = 1, labels = settings.pianoLabels } = opts;
  const notation = settings.notation;
  ctx.save();
  ctx.globalAlpha = alpha;
  const r = Math.min(8, layout.whiteWidth * 0.15);
  for (const pass of [false, true]) {
    for (const k of layout.keys.values()) {
      if (k.black !== pass) continue;
      const p = pressed.get(k.midi);
      const hint = hints.get(k.midi);
      const col = noteColor(k.midi);
      let fill = k.black ? '#1b1d2a' : '#f7f7fb';
      if (notation === 'colores' && !k.black) fill = mix('#ffffff', col, 0.28);
      if (hint) fill = k.black ? mix('#1b1d2a', hint, 0.55) : mix('#ffffff', hint, 0.45);
      if (p) fill = typeof p === 'string' ? p : col;
      const inset = k.black ? 0 : 1;
      roundRect(ctx, k.x + inset, k.y, k.w - inset * 2, k.h - (p ? 0 : 2), r);
      ctx.fillStyle = fill;
      ctx.fill();
      if (!k.black) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (!p) {
        // brillo sutil en las teclas negras
        const g = ctx.createLinearGradient(k.x, k.y, k.x, k.y + k.h);
        g.addColorStop(0, 'rgba(255,255,255,0.0)');
        g.addColorStop(1, 'rgba(255,255,255,0.12)');
        ctx.fillStyle = g;
        roundRect(ctx, k.x + 2, k.y, k.w - 4, k.h - 4, r);
        ctx.fill();
      }
      if (hint && !p) {
        ctx.strokeStyle = hint;
        ctx.lineWidth = 3;
        roundRect(ctx, k.x + 2.5, k.y + 1.5, k.w - 5, k.h - 5, r);
        ctx.stroke();
      }
      if (labels && !k.black && layout.whiteWidth > 22) {
        const fs = Math.min(18, layout.whiteWidth * 0.36);
        const cy = k.y + k.h - fs * 1.1;
        if (notation === 'colores') {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(k.x + k.w / 2, cy, fs * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p ? '#fff' : '#555a70';
          ctx.font = `600 ${fs}px Nunito, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(noteName(k.midi, notation), k.x + k.w / 2, cy);
        }
        if (k.midi % 12 === 0 && layout.whiteWidth > 30) {
          ctx.fillStyle = '#9aa0b8';
          ctx.font = `600 ${fs * 0.6}px Nunito, system-ui, sans-serif`;
          ctx.fillText(String(Math.floor(k.midi / 12) - 1), k.x + k.w / 2, cy - fs * 1.05);
        }
      }
    }
  }
  ctx.restore();
}

export function mix(a, b, t) {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function hex(s) {
  s = s.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

// Teclado del ordenador → notas (dos filas, estilo piano).
const KEYMAP = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, 'ñ': 16,
};

/**
 * Teclado táctil: gestiona toques múltiples, deslizamiento entre teclas y teclado físico.
 */
export class TouchKeyboard {
  constructor(canvas, { low, high, onNoteOn, onNoteOff, getHints, keyboardBase = 60 }) {
    this.canvas = canvas;
    this.low = low;
    this.high = high;
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.getHints = getHints || (() => new Map());
    this.pointers = new Map(); // pointerId → midi
    this.external = new Map(); // notas pulsadas desde fuera (reproducción, cámara)
    this.keyboardBase = keyboardBase;
    this.keysDown = new Map();
    this.flash = new Map();

    canvas.style.touchAction = 'none';
    this._down = (e) => this.pointerDown(e);
    this._move = (e) => this.pointerMove(e);
    this._up = (e) => this.pointerUp(e);
    canvas.addEventListener('pointerdown', this._down);
    canvas.addEventListener('pointermove', this._move);
    canvas.addEventListener('pointerup', this._up);
    canvas.addEventListener('pointercancel', this._up);
    canvas.addEventListener('pointerleave', this._up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this._kd = (e) => this.keyDown(e);
    this._ku = (e) => this.keyUp(e);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
  }

  setRange(low, high) {
    this.low = low;
    this.high = high;
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _press(id, midi) {
    const prev = this.pointers.get(id);
    if (prev === midi) return;
    if (prev != null) this._release(id);
    if (midi == null) return;
    this.pointers.set(id, midi);
    this.onNoteOn?.(midi, 0.8);
  }

  _release(id) {
    const m = this.pointers.get(id);
    if (m == null) return;
    this.pointers.delete(id);
    if (![...this.pointers.values()].includes(m)) this.onNoteOff?.(m);
  }

  pointerDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = this._pos(e);
    this._press(e.pointerId, keyAt(this.layout, x, y));
  }

  pointerMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const [x, y] = this._pos(e);
    const m = keyAt(this.layout, x, y);
    if (m == null) this._release(e.pointerId);
    else this._press(e.pointerId, m);
  }

  pointerUp(e) {
    this._release(e.pointerId);
  }

  keyDown(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'z') this.keyboardBase = Math.max(24, this.keyboardBase - 12);
    if (k === 'x') this.keyboardBase = Math.min(96, this.keyboardBase + 12);
    if (!(k in KEYMAP)) return;
    const midi = this.keyboardBase + KEYMAP[k];
    this.keysDown.set(k, midi);
    this._press('key-' + k, midi);
  }

  keyUp(e) {
    const k = e.key.toLowerCase();
    if (!this.keysDown.has(k)) return;
    this.keysDown.delete(k);
    this._release('key-' + k);
  }

  pressedMap() {
    const map = new Map();
    for (const m of this.pointers.values()) map.set(m, true);
    for (const [m, c] of this.external) map.set(m, c);
    return map;
  }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    this.layout = keyLayout(this.low, this.high, 0, 0, w, h);
    drawKeyboard(ctx, this.layout, { pressed: this.pressedMap(), hints: this.getHints() });
  }

  releaseAll() {
    for (const id of [...this.pointers.keys()]) this._release(id);
  }

  destroy() {
    this.releaseAll();
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
  }
}
