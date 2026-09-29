// Piano "en el aire": un teclado dibujado sobre la imagen de la cámara.
// Dos formas de tocar:
//  - 'pulsar' (por defecto): teclado en perspectiva abajo de la pantalla; con la palma hacia
//    abajo, suena la tecla cuando un dedo baja más que los demás, como en un piano de verdad.
//  - 'extender': teclado plano; suena mientras un dedo está extendido sobre la tecla.
import { TIP } from '../core/hands.js';
import { FingerPress } from '../core/finger-press.js';
import { isBlack, noteColor, noteName } from '../core/notes.js';
import { keyLayout, keyAt, drawKeyboard, mix } from './keyboard.js';
import { settings } from '../core/settings.js';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const TOP_RATIO = 0.7; // ancho del borde lejano respecto al cercano (efecto de perspectiva)

export class AirPiano {
  constructor({ onNoteOn, onNoteOff, getHints }) {
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.getHints = getHints || (() => new Map());
    this.active = new Map(); // "mano:dedo" → midi
    this.extCount = new Map(); // fotogramas seguidos con el dedo extendido (+) o doblado (-)
    this.external = new Map();
    this.fingers = new Set(['index', 'middle', 'ring', 'pinky', 'thumb']);
    this.press = new FingerPress({ sensitivity: settings.airPianoSensitivity });
  }

  get mode() {
    return settings.airPianoMode === 'extender' ? 'extender' : 'pulsar';
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

  /** Región del teclado plano en la pantalla. */
  region(w, h) {
    const kh = Math.min(h * 0.34, 260);
    const margin = w * 0.03;
    // Con la cámara del portátil las manos suelen quedar a media altura de la imagen.
    const pos = settings.airPianoPosition;
    const y = pos === 'abajo' ? h - kh - 12 : pos === 'arriba' ? h * 0.3 : h * 0.52;
    return { x: margin, y: Math.min(y, h - kh - 12), w: w - margin * 2, h: kh };
  }

  /** Geometría del teclado en perspectiva, siempre abajo de la pantalla. */
  perspective(w, h) {
    const front = Math.max(8, Math.min(18, h * 0.022)); // grosor visible de las teclas
    const kh = Math.min(h * 0.36, 300);
    const wBot = w * 0.96;
    const wTop = wBot * TOP_RATIO;
    return { cx: w / 2, top: h - kh - front - 6, h: kh, wTop, wBot, front };
  }

  // Del espacio del teclado (u: 0..wBot, v: 0..h) a la pantalla, y al revés.
  _project(g, u, v) {
    const width = g.wTop + (g.wBot - g.wTop) * (v / g.h);
    return { x: g.cx + (u / g.wBot - 0.5) * width, y: g.top + v };
  }
  _unproject(g, x, y) {
    const v = y - g.top;
    const width = g.wTop + (g.wBot - g.wTop) * (v / g.h);
    return { u: ((x - g.cx) / width + 0.5) * g.wBot, v };
  }

  update(hands, stage) {
    if (this.mode === 'pulsar') this._updatePress(hands, stage);
    else this._updateExtend(hands, stage);
  }

  /** Modo 'pulsar': suena la tecla bajo el dedo que baja respecto a los demás. */
  _updatePress(hands, stage) {
    const g = (this.geo = this.perspective(stage.w, stage.h));
    this.keys = keyLayout(this.low, this.high, 0, 0, g.wBot, g.h);
    // Para las notas que caen (tutorial): carriles alineados con el borde lejano del teclado.
    this.layout = keyLayout(this.low, this.high, g.cx - g.wTop / 2, g.top, g.wTop, g.h);
    this.press.setSensitivity(settings.airPianoSensitivity);
    const pts = hands.map((hand) => ({ key: hand.key, points: hand.landmarks.map((p) => stage.toScreen(p)) }));
    const res = this.press.update(pts, performance.now() / 1000);
    const seen = new Set();
    this.tips = [];
    for (const hand of pts) {
      for (const f of FINGERS) {
        if (!this.fingers.has(f)) continue;
        const id = hand.key + ':' + f;
        seen.add(id);
        const p = hand.points[TIP[f]];
        const r = res.get(id);
        const k = this._unproject(g, p.x, p.y);
        // La punta debe estar sobre el teclado (con algo de margen por arriba y por abajo).
        const over = k.v >= -g.h * 0.15 && k.v <= g.h + g.front + 30;
        const m = r?.pressed && over ? keyAt(this.keys, k.u, Math.max(1, Math.min(k.v, g.h - 1))) : null;
        const cur = this.active.get(id);
        this.tips.push({ ...p, id, pressed: m != null, amount: r?.amount || 0, visible: over });
        if (m == null) {
          if (cur != null) this._off(id);
        } else if (m !== cur) {
          if (cur != null) this._off(id);
          this._on(id, m, r.velocity);
        }
      }
    }
    for (const id of [...this.active.keys()]) if (!seen.has(id)) this._off(id);
  }

  /**
   * Modo 'extender': una tecla suena solo mientras un dedo está EXTENDIDO y su punta está
   * sobre ella. Con la mano cerrada no suena nada; al doblar el dedo, la nota se suelta.
   */
  _updateExtend(hands, stage) {
    this.geo = null;
    const r = this.region(stage.w, stage.h);
    this.layout = this.keys = keyLayout(this.low, this.high, r.x, r.y, r.w, r.h);
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
        const m = isExt && inside ? keyAt(this.keys, p.x, Math.min(p.y, r.y + r.h - 2)) : null;
        const cur = this.active.get(id);
        this.tips.push({ ...p, id, pressed: m != null, visible: isExt });
        if (m == null) {
          if (cur != null) this._off(id);
        } else if (m !== cur) {
          if (cur != null) this._off(id);
          this._on(id, m, 0.8);
        }
      }
    }
    for (const id of [...this.active.keys()]) if (!seen.has(id)) this._off(id);
    for (const id of [...this.extCount.keys()]) if (!seen.has(id)) this.extCount.delete(id);
  }

  _on(id, midi, velocity) {
    this.active.set(id, midi);
    const count = [...this.active.values()].filter((m) => m === midi).length;
    if (count === 1) this.onNoteOn?.(midi, velocity);
  }

  _off(id) {
    const midi = this.active.get(id);
    this.active.delete(id);
    if (midi != null && ![...this.active.values()].includes(midi)) this.onNoteOff?.(midi);
  }

  draw(ctx) {
    if (!this.keys) return;
    const pressed = new Map();
    for (const m of this.active.values()) pressed.set(m, true);
    for (const [m, c] of this.external) pressed.set(m, c);
    if (this.geo) this._drawPerspective(ctx, pressed);
    else drawKeyboard(ctx, this.keys, { pressed, hints: this.getHints(), alpha: 0.88 });
    for (const t of this.tips || []) {
      if (!t.visible) continue; // en modo 'extender' los dedos doblados no tocan: no se dibujan
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.pressed ? 13 : 9, 0, Math.PI * 2);
      ctx.fillStyle = t.pressed ? 'rgba(255,170,40,0.95)' : 'rgba(255,255,255,0.85)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
      // Anillo que se llena al ir bajando el dedo: ayuda a ver cuánto falta para que suene.
      if (!t.pressed && t.amount > 0.15) {
        ctx.beginPath();
        ctx.arc(t.x, t.y, 15, -Math.PI / 2, -Math.PI / 2 + t.amount * Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,170,40,0.9)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }
  }

  /** Teclado visto desde el sitio del pianista: más estrecho al fondo y con el canto de las teclas. */
  _drawPerspective(ctx, pressed) {
    const g = this.geo;
    const hints = this.getHints();
    const notation = settings.notation;
    const quad = (u1, u2, v1, v2, dy = 0) => {
      const a = this._project(g, u1, v1);
      const b = this._project(g, u2, v1);
      const c = this._project(g, u2, v2);
      const d = this._project(g, u1, v2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y + dy);
      ctx.lineTo(b.x, b.y + dy);
      ctx.lineTo(c.x, c.y + dy);
      ctx.lineTo(d.x, d.y + dy);
      ctx.closePath();
      return { a, b, c, d };
    };
    ctx.save();
    ctx.globalAlpha = 0.96;
    // Sombra y fondo del mueble del piano
    quad(-g.wBot * 0.012, g.wBot * 1.012, -10, g.h + g.front + 4);
    ctx.fillStyle = 'rgba(12,13,24,0.75)';
    ctx.fill();
    const ww = this.keys.whiteWidth;
    for (const pass of [false, true]) {
      for (const k of this.keys.keys.values()) {
        if (k.black !== pass) continue;
        const p = pressed.get(k.midi);
        const hint = hints.get(k.midi);
        const col = noteColor(k.midi);
        let fill = k.black ? '#1b1d2a' : '#f7f7fb';
        if (notation === 'colores' && !k.black) fill = mix('#ffffff', col, 0.28);
        if (hint) fill = k.black ? mix('#1b1d2a', hint, 0.55) : mix('#ffffff', hint, 0.45);
        if (p) fill = typeof p === 'string' ? p : col;
        const gap = k.black ? 0 : 1.2;
        const dy = p ? (k.black ? 3 : 5) : 0; // la tecla pulsada se hunde
        const u1 = k.x + gap;
        const u2 = k.x + k.w - gap;
        const vEnd = k.h;
        // Canto frontal de la tecla
        const fa = this._project(g, u1, vEnd);
        const fb = this._project(g, u2, vEnd);
        const fh = (k.black ? g.front * 0.9 : g.front) - dy;
        ctx.beginPath();
        ctx.moveTo(fa.x, fa.y + dy);
        ctx.lineTo(fb.x, fb.y + dy);
        ctx.lineTo(fb.x, fb.y + dy + fh);
        ctx.lineTo(fa.x, fa.y + dy + fh);
        ctx.closePath();
        ctx.fillStyle = k.black ? '#07080f' : p ? mix('#000000', typeof p === 'string' ? '#888888' : col, 0.7) : '#b9bccb';
        ctx.fill();
        // Superficie de la tecla
        quad(u1, u2, 0, vEnd, dy);
        if (k.black) {
          const gr = ctx.createLinearGradient(0, g.top, 0, g.top + vEnd);
          gr.addColorStop(0, fill);
          gr.addColorStop(1, p ? fill : '#2b2e42');
          ctx.fillStyle = gr;
        } else ctx.fillStyle = fill;
        ctx.fill();
        if (!k.black) {
          ctx.strokeStyle = 'rgba(0,0,0,0.28)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (hint && !p) {
          quad(u1 + 3, u2 - 3, 3, vEnd - 3, dy);
          ctx.strokeStyle = hint;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        // Nombre de la nota, cerca del borde del pianista
        if (settings.pianoLabels && !k.black && ww > 22) {
          const c = this._project(g, k.x + k.w / 2, vEnd * 0.84);
          const scale = 0.85 + 0.15 * (vEnd * 0.84) / g.h;
          const fs = Math.min(20, ww * 0.36) * scale;
          if (notation === 'colores') {
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(c.x, c.y + dy, fs * 0.5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = p ? '#fff' : '#555a70';
            ctx.font = `700 ${fs}px Nunito, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(noteName(k.midi, notation), c.x, c.y + dy);
          }
          if (k.midi % 12 === 0 && ww > 30 && !isBlack(k.midi)) {
            ctx.fillStyle = '#9aa0b8';
            ctx.font = `600 ${fs * 0.6}px Nunito, system-ui, sans-serif`;
            ctx.fillText(String(Math.floor(k.midi / 12) - 1), c.x, c.y + dy - fs * 1.05);
          }
        }
      }
    }
    ctx.restore();
  }

  releaseAll() {
    for (const id of [...this.active.keys()]) this._off(id);
  }
}
