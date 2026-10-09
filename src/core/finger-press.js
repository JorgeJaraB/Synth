// Detecta cuándo un dedo "pulsa" como en un piano de verdad, con la palma hacia abajo.
// Cada dedo va por su cuenta: se compara con su propia posición de reposo (no con los otros
// dedos, porque una mano casi nunca está plana). La punta se mide respecto a su nudillo, así
// que mover toda la mano no pulsa nada. Trabaja con puntos en píxeles de pantalla.

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
// Nudillo de cada dedo: la punta se mide respecto a él para que no influya la longitud del dedo.
const KNUCKLE = { thumb: 2, index: 5, middle: 9, ring: 13, pinky: 17 };

/** Umbrales (en anchos de palma) según la sensibilidad elegida. */
export const SENSITIVITY = {
  alta: { on: 0.09, off: 0.045 },
  normal: { on: 0.13, off: 0.065 },
  baja: { on: 0.18, off: 0.09 },
};

// Para evitar notas sin querer:
const RISE_WINDOW = 0.35; // s: la bajada tiene que ser un gesto rápido, no una deriva lenta
const COOLDOWN = 0.12; // s: tras soltar una tecla, el mismo dedo espera un poco
const OPEN_GRACE = 0.35; // s: al abrir la mano tras cerrarla, no suena nada todavía
const TOGETHER = 4; // si bajan 4 o más dedos a la vez es la mano entera (cerrarla), no una tecla

export class FingerPress {
  constructor({ sensitivity = 'normal', adaptTime = 0.8 } = {}) {
    this.setSensitivity(sensitivity);
    this.adaptTime = adaptTime; // s que tarda la posición de reposo en seguir al dedo
    this.state = new Map(); // "mano:dedo" → { base, pressed, over, lastDrop, lastT, hist, coolUntil }
    this.handState = new Map(); // mano → { quietUntil }
  }

  setSensitivity(name) {
    this.th = SENSITIVITY[name] || SENSITIVITY.normal;
  }

  /**
   * hands: [{ key, points: [{x, y}] × 21, closed? }] en píxeles. t: tiempo en segundos.
   * closed: la mano está cerrada (puño): no suena nada.
   * Devuelve Map "mano:dedo" → { pressed, amount (0..1 hasta el umbral), velocity, justPressed }.
   */
  update(hands, t) {
    const out = new Map();
    const seen = new Set();
    const seenHands = new Set();
    for (const hand of hands) {
      const p = hand.points;
      const palm = Math.hypot(p[5].x - p[17].x, p[5].y - p[17].y);
      if (!(palm > 4)) continue;
      seenHands.add(hand.key);
      let hs = this.handState.get(hand.key);
      if (!hs) this.handState.set(hand.key, (hs = { quietUntil: 0 }));
      if (hand.closed) hs.quietUntil = t + OPEN_GRACE;
      const quiet = t < hs.quietUntil;
      const rows = [];
      for (const f of FINGERS) {
        // Altura de la punta respecto a su nudillo, en anchos de palma (más = más abajo).
        const drop = (p[TIP[f]].y - p[KNUCKLE[f]].y) / palm;
        const id = hand.key + ':' + f;
        seen.add(id);
        let s = this.state.get(id);
        if (!s) {
          s = { base: drop, pressed: false, over: 0, lastDrop: drop, lastT: t, hist: [], coolUntil: 0 };
          this.state.set(id, s);
        }
        const dt = Math.max(0.001, Math.min(0.25, t - s.lastT));
        s.hist.push({ t, drop });
        while (s.hist.length && s.hist[0].t < t - RISE_WINDOW) s.hist.shift();
        const excess = drop - s.base;
        // Cuánto ha bajado en el último momento (desde el punto más alto de la ventana)
        const rise = drop - Math.min(...s.hist.map((x) => x.drop));
        const speed = (drop - s.lastDrop) / dt; // anchos de palma por segundo
        rows.push({ f, id, s, drop, dt, excess, rise, speed, justPressed: false, candidate: false });
      }
      for (const r of rows) {
        const { s, excess, rise } = r;
        if (quiet) {
          // Mano cerrada (o recién abierta): nada suena y el reposo se pone donde esté el dedo.
          s.pressed = false;
          s.over = 0;
          s.base = r.drop;
          continue;
        }
        if (s.pressed) {
          if (excess < this.th.off) {
            s.pressed = false;
            s.coolUntil = t + COOLDOWN;
          }
        } else if (t >= s.coolUntil) {
          // Tiene que bajar respecto a su reposo Y haberlo hecho hace poco (un gesto, no una deriva).
          const down = excess > this.th.on && rise > this.th.on * 0.8;
          s.over = down ? s.over + 1 : 0;
          // Un solo fotograma basta si baja con decisión; si no, se confirma con dos.
          r.candidate = s.over >= 2 || (down && excess > this.th.on * 1.6);
        }
      }
      // Si bajan casi todos los dedos a la vez es que se está cerrando la mano: no es una tecla.
      const together = rows.filter((r) => r.candidate).length >= TOGETHER;
      if (together) hs.quietUntil = t + OPEN_GRACE;
      for (const r of rows) {
        const { s, excess, speed } = r;
        if (r.candidate && !together) {
          s.pressed = true;
          s.over = 0;
          r.justPressed = true;
        }
        if (together) s.over = 0;
        // En reposo, la posición de referencia sigue poco a poco al dedo (más despacio si
        // parece que está empezando a bajar, para no "comerse" las pulsaciones lentas).
        if (!s.pressed && !r.justPressed && !quiet) {
          const tau = excess < this.th.off ? this.adaptTime : this.adaptTime * 4;
          s.base += (r.drop - s.base) * (1 - Math.exp(-r.dt / tau));
        }
        const velocity = Math.max(0.35, Math.min(1, 0.45 + Math.max(0, speed) * 0.25));
        s.lastDrop = r.drop;
        s.lastT = t;
        out.set(r.id, { pressed: s.pressed, justPressed: r.justPressed, velocity, amount: quiet ? 0 : Math.max(0, Math.min(1, excess / this.th.on)) });
      }
    }
    for (const k of [...this.handState.keys()]) if (!seenHands.has(k)) this.handState.delete(k);
    for (const id of [...this.state.keys()]) if (!seen.has(id)) this.state.delete(id);
    return out;
  }
}
