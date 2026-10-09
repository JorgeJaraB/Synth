// Lectura de las dos manos en los modos de acordes (libre, tutorial y karaoke de acordes).
// Suaviza la detección para que los acordes no "salten" con cada temblor de la cámara.
import { settings } from './settings.js';
import { degreeFromFingers, voicingFromFingers, handRoll, tiltSide, qualityFor, octaveFromRoll, Stabilizer } from './chords.js';

/** Valor más repetido de una lista y cuántas veces aparece. */
export function mode(list) {
  const counts = new Map();
  let best = null;
  let bestN = 0;
  for (const v of list) {
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return [best, bestN];
}

/** Volumen según la altura de la muñeca (0 = arriba, 1 = abajo de la imagen). */
export function volumeFromHeight(y01) {
  // Muñeca al 25 % de la altura o más arriba → volumen máximo; al 85 % → mínimo, que se
  // sigue oyendo bien (para callar, se quita la mano o se cierra el puño).
  const t = Math.max(0, Math.min(1, (0.85 - y01) / 0.6));
  return 0.35 + 0.65 * t;
}

/**
 * Votación por tiempo (no por fotogramas, para que funcione igual en equipos lentos y rápidos):
 * se miran las detecciones del último cuarto de segundo y gana la mayoría (≥ 60 %).
 */
const WINDOW_MS = 150;
const MAJORITY = 0.6;
const QUICK = 3; // si las últimas 3 detecciones coinciden, se acepta al momento

/**
 * Inclinación de la mano medida en píxeles de pantalla: los puntos de MediaPipe van de 0 a 1
 * en ancho y en alto por separado, así que medirla con ellos falsea el ángulo (una
 * inclinación real de 14° se leía como 9°).
 */
function screenRoll(hand, stage) {
  const lm = hand.landmarks;
  const pts = [];
  pts[0] = stage.toScreen(lm[0]);
  pts[9] = stage.toScreen(lm[9]);
  return handRoll(pts);
}

/** Suavizado exponencial independiente de los fotogramas por segundo (tau en ms). */
const ease = (dt, tau) => 1 - Math.exp(-Math.max(0, dt) / tau);

function vote(hist, now) {
  while (hist.length > QUICK && hist[0].t < now - WINDOW_MS) hist.shift();
  const last = hist.slice(-QUICK);
  if (last.length === QUICK && last.every((x) => x.v === last[0].v)) return { value: last[0].v, ok: true };
  const recent = hist.filter((x) => x.t >= now - WINDOW_MS);
  const [v, n] = mode(recent.map((x) => x.v));
  return { value: v, ok: recent.length > 0 && n / recent.length >= MAJORITY };
}

/**
 * El pulgar engaña mucho al cambiar de acorde: mientras los demás dedos se mueven, la cámara
 * lo ve salir un instante. Solo se cree un cambio del pulgar si dura un rato.
 */
const THUMB_HOLD_MS = 200;
export class SteadyFlag {
  constructor(holdMs = THUMB_HOLD_MS) {
    this.holdMs = holdMs;
    this.value = false;
    this.cand = null;
    this.since = 0;
  }
  update(v, now) {
    if (v === this.value) this.cand = null;
    else if (v !== this.cand) {
      this.cand = v;
      this.since = now;
    } else if (now - this.since >= this.holdMs) {
      this.value = v;
      this.cand = null;
    }
    return this.value;
  }
  reset(v = false) {
    this.value = v;
    this.cand = null;
  }
}

export class ChordHandReader {
  constructor() {
    this.stab = new Stabilizer(60);
    this._lastHands = null;
    this._lastT = null;
    this.degHist = [];
    this.voiceHist = [];
    this.degree = -1;
    this.voicingSmooth = 'triada';
    this.tilt = 'recta';
    this.roll = 0;
    this.volume = 0.85;
    this.brightness = 0.6;
    this.octave = 0;
    this.exprRoll = 0;
    this.chordThumb = new SteadyFlag();
    this.exprThumb = new SteadyFlag();
    this.locked = null; // acorde fijado con el pulgar de la mano de expresión (candado)
    this.stable = null;
    this.allowOneHand = false; // true: suena aunque no haya mano derecha (p. ej. en el tutorial)
    this._lastExprT = -Infinity;
  }

  /** Reparte las manos: la de los acordes y la de expresión. */
  assign(hands) {
    let chord = null;
    let expr = null;
    const chordOnLeft = !settings.chordLefty;
    if (hands.length >= 2) {
      const sorted = [...hands].sort((a, b) => a.landmarks[0].x - b.landmarks[0].x);
      [chord, expr] = chordOnLeft ? [sorted[0], sorted[sorted.length - 1]] : [sorted[sorted.length - 1], sorted[0]];
    } else if (hands.length === 1) {
      const onLeft = hands[0].landmarks[0].x < 0.5;
      if (onLeft === chordOnLeft) chord = hands[0];
      else expr = hands[0];
    }
    return { chord, expr };
  }

  /**
   * @param hands  manos del detector
   * @param stage  CameraStage (para pasar a coordenadas de pantalla)
   * @param hh     alto del escenario en píxeles
   */
  update(hands, stage, hh, now = performance.now()) {
    const { chord, expr } = this.assign(hands);
    // Solo se vota con detecciones nuevas (la pantalla se redibuja más a menudo que la cámara).
    const fresh = hands !== this._lastHands;
    this._lastHands = hands;
    const dt = this._lastT == null ? 16 : Math.min(500, now - this._lastT);
    this._lastT = now;

    // --- Mano de los acordes: votación del último cuarto de segundo ---
    let rawDeg = -1;
    if (chord) {
      const thumb = fresh ? this.chordThumb.update(chord.extended.thumb, now) : this.chordThumb.value;
      rawDeg = degreeFromFingers({ ...chord.extended, thumb });
    } else this.chordThumb.reset();
    if (fresh) this.degHist.push({ t: now, v: rawDeg });
    const dv = vote(this.degHist, now);
    if (dv.ok) this.degree = dv.value;
    if (!chord) this.degree = -1;

    let chordInfo = null;
    if (chord) {
      const onLeft = chord.landmarks[0].x < 0.5;
      this.roll += (screenRoll(chord, stage) - this.roll) * ease(dt, 60);
      this.tilt = tiltSide(this.roll, onLeft, this.tilt);
      chordInfo = { pos: stage.toScreen(chord.landmarks[0]), degree: this.degree, tilt: this.tilt, roll: this.roll, onLeft };
    } else this.tilt = 'recta';

    // --- Mano de expresión: variante, volumen y brillo (suavizados) ---
    let exprInfo = null;
    let exprMuted = false;
    let targetVol = 0.85;
    let targetBright = 0.6;
    let lockThumb = false;
    if (expr) {
      const vc = voicingFromFingers(expr.extended);
      if (fresh) this.voiceHist.push({ t: now, v: vc == null && expr.fist ? 'mudo' : vc || 'triada' });
      const vv = vote(this.voiceHist, now);
      if (vv.ok) this.voicingSmooth = vv.value;
      exprMuted = this.voicingSmooth === 'mudo';
      const pos = stage.toScreen(expr.landmarks[0]);
      targetVol = exprMuted ? 0 : volumeFromHeight(pos.y / hh);
      const roll = screenRoll(expr, stage);
      this.exprRoll += (roll - this.exprRoll) * ease(dt, 60);
      if (settings.chordOctaveTurn) {
        // Girar la mano cambia de octava; el brillo se queda fijo (como en Gesture Synth).
        this.octave = octaveFromRoll(this.exprRoll, this.octave);
        targetBright = 0.5;
      } else {
        this.octave = 0;
        targetBright = Math.max(0, Math.min(1, 0.55 + roll / 80));
      }
      lockThumb = fresh ? this.exprThumb.update(expr.extended.thumb, now) : this.exprThumb.value;
      exprInfo = { pos, voicing: exprMuted ? 'triada' : this.voicingSmooth, muted: exprMuted, roll: this.exprRoll, octave: this.octave };
    } else {
      this.exprThumb.reset();
      this.octave = 0;
      this.voiceHist = [];
      this.voicingSmooth = 'triada';
      // Sin mano derecha se calla (como en Gesture Synth), salvo un instante por si la
      // cámara la pierde un momento.
      if (settings.chordNeedRight && !this.allowOneHand) {
        targetVol = now - this._lastExprT < 150 ? this.volume : 0;
        exprMuted = now - this._lastExprT >= 150;
      }
    }
    if (expr) this._lastExprT = now;
    this.volume += (targetVol - this.volume) * ease(dt, exprMuted ? 40 : 90);
    this.brightness += (targetBright - this.brightness) * ease(dt, 90);

    const voicing = exprInfo && !exprMuted ? this.voicingSmooth : 'triada';
    const raw = this.degree >= 1 && this.degree <= 7 ? { degree: this.degree, quality: qualityFor(this.degree, this.tilt, settings.chordStraight), voicing, octave: this.octave } : null;
    this.stable = this.stab.update(raw, now);
    // Candado: con el pulgar de la mano de expresión fuera, el acorde no cambia aunque se mueva
    // la otra mano (la variante, la octava y el volumen sí siguen a la mano de expresión).
    if (settings.chordThumbLock && lockThumb && !exprMuted) {
      if (!this.locked && this.stable) this.locked = { degree: this.stable.degree, quality: this.stable.quality };
    } else this.locked = null;
    if (this.locked) this.stable = { ...this.locked, voicing, octave: this.octave };

    return {
      chord,
      expr,
      chordInfo,
      exprInfo,
      rawDegree: rawDeg,
      degree: this.degree,
      tilt: this.tilt,
      octave: this.octave,
      locked: !!this.locked,
      voicing: exprInfo ? exprInfo.voicing : null,
      exprMuted,
      volume: this.volume,
      brightness: this.brightness,
      stable: this.stable,
    };
  }
}
