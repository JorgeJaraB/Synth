// Lectura de las dos manos en los modos de acordes (libre, tutorial y karaoke de acordes).
// Suaviza la detección para que los acordes no "salten" con cada temblor de la cámara.
import { settings } from './settings.js';
import { degreeFromFingers, voicingFromFingers, handRoll, tiltSide, qualityFor, Stabilizer } from './chords.js';

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
  // Muñeca al 30 % de la altura o más arriba → volumen máximo; al 80 % → mínimo.
  const t = Math.max(0, Math.min(1, (0.8 - y01) / 0.5));
  return 0.2 + 0.8 * t;
}

/**
 * Votación por tiempo (no por fotogramas, para que funcione igual en equipos lentos y rápidos):
 * se miran las detecciones del último cuarto de segundo y gana la mayoría (≥ 60 %).
 */
const WINDOW_MS = 150;
const MAJORITY = 0.6;
const QUICK = 3; // si las últimas 3 detecciones coinciden, se acepta al momento

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
    this.stable = null;
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
    const rawDeg = chord ? degreeFromFingers(chord.extended) : -1;
    if (fresh) this.degHist.push({ t: now, v: rawDeg });
    const dv = vote(this.degHist, now);
    if (dv.ok) this.degree = dv.value;
    if (!chord) this.degree = -1;

    let chordInfo = null;
    if (chord) {
      const onLeft = chord.landmarks[0].x < 0.5;
      this.roll += (handRoll(chord.landmarks) - this.roll) * ease(dt, 60);
      this.tilt = tiltSide(this.roll, onLeft, this.tilt);
      chordInfo = { pos: stage.toScreen(chord.landmarks[0]), degree: this.degree, tilt: this.tilt, onLeft };
    } else this.tilt = 'recta';

    // --- Mano de expresión: variante, volumen y brillo (suavizados) ---
    let exprInfo = null;
    let exprMuted = false;
    let targetVol = 0.85;
    let targetBright = 0.6;
    if (expr) {
      const vc = voicingFromFingers(expr.extended);
      if (fresh) this.voiceHist.push({ t: now, v: vc == null && expr.fist ? 'mudo' : vc || 'triada' });
      const vv = vote(this.voiceHist, now);
      if (vv.ok) this.voicingSmooth = vv.value;
      exprMuted = this.voicingSmooth === 'mudo';
      const pos = stage.toScreen(expr.landmarks[0]);
      targetVol = exprMuted ? 0 : volumeFromHeight(pos.y / hh);
      targetBright = Math.max(0, Math.min(1, 0.55 + handRoll(expr.landmarks) / 80));
      exprInfo = { pos, voicing: exprMuted ? 'triada' : this.voicingSmooth, muted: exprMuted };
    } else {
      this.voiceHist = [];
      this.voicingSmooth = 'triada';
    }
    this.volume += (targetVol - this.volume) * ease(dt, exprMuted ? 40 : 90);
    this.brightness += (targetBright - this.brightness) * ease(dt, 90);

    const voicing = exprInfo && !exprMuted ? this.voicingSmooth : 'triada';
    const raw = this.degree >= 1 && this.degree <= 7 ? { degree: this.degree, quality: qualityFor(this.degree, this.tilt), voicing } : null;
    this.stable = this.stab.update(raw, now);

    return {
      chord,
      expr,
      chordInfo,
      exprInfo,
      rawDegree: rawDeg,
      degree: this.degree,
      tilt: this.tilt,
      voicing: exprInfo ? exprInfo.voicing : null,
      exprMuted,
      volume: this.volume,
      brightness: this.brightness,
      stable: this.stable,
    };
  }
}
