// Detecta cuándo un dedo "pulsa" como en un piano de verdad: la mano está con la palma
// hacia abajo y un dedo baja más que los demás. Trabaja con puntos en píxeles de pantalla.

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
// Nudillo de cada dedo: la punta se mide respecto a él para que no influya la longitud del dedo.
const KNUCKLE = { thumb: 2, index: 5, middle: 9, ring: 13, pinky: 17 };
const LONG = ['index', 'middle', 'ring', 'pinky'];

/** Umbrales (en anchos de palma) según la sensibilidad elegida. */
export const SENSITIVITY = {
  alta: { on: 0.09, off: 0.045 },
  normal: { on: 0.13, off: 0.065 },
  baja: { on: 0.18, off: 0.09 },
};

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class FingerPress {
  constructor({ sensitivity = 'normal', adaptTime = 0.8 } = {}) {
    this.setSensitivity(sensitivity);
    this.adaptTime = adaptTime; // s que tarda la posición de reposo en seguir al dedo
    this.state = new Map(); // "mano:dedo" → { base, pressed, over, lastDrop, lastT }
  }

  setSensitivity(name) {
    this.th = SENSITIVITY[name] || SENSITIVITY.normal;
  }

  /**
   * hands: [{ key, points: [{x, y}] × 21 }] en píxeles. t: tiempo en segundos.
   * Devuelve Map "mano:dedo" → { pressed, amount (0..1 hasta el umbral), velocity, justPressed }.
   */
  update(hands, t) {
    const out = new Map();
    const seen = new Set();
    for (const hand of hands) {
      const p = hand.points;
      const palm = Math.hypot(p[5].x - p[17].x, p[5].y - p[17].y);
      if (!(palm > 4)) continue;
      const rel = {};
      for (const f of FINGERS) rel[f] = (p[TIP[f]].y - p[KNUCKLE[f]].y) / palm;
      for (const f of FINGERS) {
        const others = LONG.filter((g) => g !== f).map((g) => rel[g]);
        // Cuánto más abajo está este dedo que el resto (se anula si se mueve toda la mano).
        const drop = rel[f] - median(others);
        const id = hand.key + ':' + f;
        seen.add(id);
        let s = this.state.get(id);
        if (!s) {
          s = { base: drop, pressed: false, over: 0, lastDrop: drop, lastT: t };
          this.state.set(id, s);
        }
        const dt = Math.max(0.001, Math.min(0.25, t - s.lastT));
        const excess = drop - s.base;
        const speed = (drop - s.lastDrop) / dt; // anchos de palma por segundo
        let justPressed = false;
        if (s.pressed) {
          if (excess < this.th.off) s.pressed = false;
        } else {
          // Un solo fotograma basta si baja con decisión; si no, se confirma con dos.
          s.over = excess > this.th.on ? s.over + 1 : 0;
          if (s.over >= 2 || excess > this.th.on * 1.6) {
            s.pressed = true;
            s.over = 0;
            justPressed = true;
          }
        }
        // En reposo, la posición de referencia sigue poco a poco al dedo (más despacio si
        // parece que está empezando a bajar, para no "comerse" las pulsaciones lentas).
        if (!s.pressed && !justPressed) {
          const tau = excess < this.th.off ? this.adaptTime : this.adaptTime * 4;
          s.base += (drop - s.base) * (1 - Math.exp(-dt / tau));
        }
        const velocity = Math.max(0.35, Math.min(1, 0.45 + Math.max(0, speed) * 0.25));
        s.lastDrop = drop;
        s.lastT = t;
        out.set(id, { pressed: s.pressed, justPressed, velocity, amount: Math.max(0, Math.min(1, excess / this.th.on)) });
      }
    }
    for (const id of [...this.state.keys()]) if (!seen.has(id)) this.state.delete(id);
    return out;
  }
}
