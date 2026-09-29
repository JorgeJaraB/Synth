// Piano "en el aire": un teclado dibujado sobre la imagen de la cámara.
// Una tecla suena cuando la punta de un dedo baja y entra en ella.
import { TIP } from '../core/hands.js';
import { keyLayout, keyAt, drawKeyboard } from './keyboard.js';
import { settings } from '../core/settings.js';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export class AirPiano {
  constructor({ onNoteOn, onNoteOff, getHints }) {
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.getHints = getHints || (() => new Map());
    this.active = new Map(); // "mano:dedo" → midi
    this.prevY = new Map();
    this.external = new Map();
    this.fingers = new Set(['index', 'middle', 'ring', 'pinky', 'thumb']);
  }

  /** Rango fijo opcional (los tutoriales lo ajustan a la canción). */
  setRange(low, high) {
    this.range = { low, high };
  }
  get low() {
    return this.range?.low ?? settings.airPianoStart;
  }
  get high() {
    // Sin pasar de Do8, la tecla más aguda de un piano de verdad.
    return this.range?.high ?? Math.min(108, settings.airPianoStart + settings.airPianoOctaves * 12);
  }

  /** Región del teclado en la pantalla. */
  region(w, h) {
    const kh = Math.min(h * 0.34, 260);
    const margin = w * 0.03;
    // Con la cámara del portátil las manos suelen quedar a media altura de la imagen.
    const pos = settings.airPianoPosition;
    const y = pos === 'abajo' ? h - kh - 12 : pos === 'arriba' ? h * 0.3 : h * 0.52;
    return { x: margin, y: Math.min(y, h - kh - 12), w: w - margin * 2, h: kh };
  }

  update(hands, stage) {
    const r = this.region(stage.w, stage.h);
    this.layout = keyLayout(this.low, this.high, r.x, r.y, r.w, r.h);
    const seen = new Set();
    this.tips = [];
    for (const hand of hands) {
      for (const f of FINGERS) {
        if (!this.fingers.has(f)) continue;
        const id = hand.key + ':' + f;
        const p = stage.toScreen(hand.landmarks[TIP[f]]);
        // Con el pulgar solo tocamos si está bien separado (evita notas fantasma).
        if (f === 'thumb' && !hand.extended.thumb) continue;
        seen.add(id);
        const prevY = this.prevY.get(id) ?? p.y;
        this.prevY.set(id, p.y);
        const cur = this.active.get(id);
        const inside = p.y >= r.y + 4;
        const m = inside ? keyAt(this.layout, p.x, p.y) : null;
        this.tips.push({ ...p, id, pressed: cur != null });
        if (cur == null) {
          // Solo se pulsa al "bajar" hacia la tecla (no al estar ya dentro quieto).
          if (m != null && p.y - prevY > -2) this._on(id, m);
        } else if (!inside || p.y < r.y - 6) {
          this._off(id);
        } else if (m != null && m !== cur) {
          this._off(id);
          this._on(id, m);
        }
      }
    }
    for (const id of [...this.active.keys()]) if (!seen.has(id)) this._off(id);
    for (const id of [...this.prevY.keys()]) if (!seen.has(id)) this.prevY.delete(id);
  }

  _on(id, midi) {
    this.active.set(id, midi);
    const count = [...this.active.values()].filter((m) => m === midi).length;
    if (count === 1) this.onNoteOn?.(midi, 0.8);
  }

  _off(id) {
    const midi = this.active.get(id);
    this.active.delete(id);
    if (midi != null && ![...this.active.values()].includes(midi)) this.onNoteOff?.(midi);
  }

  draw(ctx) {
    if (!this.layout) return;
    const pressed = new Map();
    for (const m of this.active.values()) pressed.set(m, true);
    for (const [m, c] of this.external) pressed.set(m, c);
    drawKeyboard(ctx, this.layout, { pressed, hints: this.getHints(), alpha: 0.88 });
    for (const t of this.tips || []) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.pressed ? 13 : 9, 0, Math.PI * 2);
      ctx.fillStyle = t.pressed ? 'rgba(255,170,40,0.95)' : 'rgba(255,255,255,0.85)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
    }
  }

  releaseAll() {
    for (const id of [...this.active.keys()]) this._off(id);
  }
}
