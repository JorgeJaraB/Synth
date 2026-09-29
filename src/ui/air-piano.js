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
    this.extCount = new Map(); // fotogramas seguidos con el dedo extendido (+) o doblado (-)
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

  /**
   * Una tecla suena solo mientras un dedo está EXTENDIDO y su punta está sobre ella.
   * Con la mano cerrada no suena nada; al doblar el dedo, la nota se suelta.
   */
  update(hands, stage) {
    const r = this.region(stage.w, stage.h);
    this.layout = keyLayout(this.low, this.high, r.x, r.y, r.w, r.h);
    const seen = new Set();
    this.tips = [];
    for (const hand of hands) {
      for (const f of FINGERS) {
        if (!this.fingers.has(f)) continue;
        const id = hand.key + ':' + f;
        seen.add(id);
        const p = stage.toScreen(hand.landmarks[TIP[f]]);
        // Pequeño filtro: el dedo debe llevar 2 fotogramas extendido (o doblado) para cambiar.
        const ext = hand.extended[f];
        const c = this.extCount.get(id) || 0;
        const n = ext ? Math.max(1, c + 1) : Math.min(-1, c - 1);
        this.extCount.set(id, n);
        const isExt = n >= 2 || (n > -2 && this.active.has(id));
        const inside = p.y >= r.y + 4 && p.y <= r.y + r.h + 10;
        const m = isExt && inside ? keyAt(this.layout, p.x, Math.min(p.y, r.y + r.h - 2)) : null;
        const cur = this.active.get(id);
        this.tips.push({ ...p, id, pressed: m != null, extended: isExt });
        if (m == null) {
          if (cur != null) this._off(id);
        } else if (m !== cur) {
          if (cur != null) this._off(id);
          this._on(id, m);
        }
      }
    }
    for (const id of [...this.active.keys()]) if (!seen.has(id)) this._off(id);
    for (const id of [...this.extCount.keys()]) if (!seen.has(id)) this.extCount.delete(id);
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
      if (!t.extended) continue; // los dedos doblados no tocan: no se dibujan
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
