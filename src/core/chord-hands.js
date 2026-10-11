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
 * Un gesto nuevo solo se acepta cuando se repite en varias detecciones seguidas. Al abrir o cerrar
 * la mano los dedos se mueven uno a uno y los gestos intermedios (2, 3, 4 dedos…) duran una o dos
 * imágenes: antes ganaban por mayoría y sonaban acordes de paso. Con la cámara lenta (pocas
 * imágenes por segundo) bastan dos seguidas, para no ir con retraso.
 */
const STEADY = 3;
const STEADY_SLOW = 2;
const SLOW_FRAME_MS = 50;
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
// Postura "recta" de cada uno: se adapta en unos segundos y como mucho hasta 10°.
const NEUTRAL_TAU = 3000;
const NEUTRAL_MAX = 10;

function vote(hist, frameMs = 33) {
  const k = frameMs > SLOW_FRAME_MS ? STEADY_SLOW : STEADY;
  while (hist.length > 8) hist.shift();
  const last = hist.slice(-k);
  const ok = last.length === k && last.every((x) => x.v === last[0].v) && last[0].v !== PENDING;
  return { value: last[0]?.v, ok };
}
/** Gesto a medias: el pulgar acaba de salir y todavía no se sabe si es de verdad. */
const PENDING = 'pendiente';

/**
 * El pulgar engaña mucho al cambiar de acorde: mientras los demás dedos se mueven, la cámara
 * lo ve salir un instante. Solo se cree un cambio del pulgar si dura un rato.
 */
const THUMB_HOLD_MS = 150;
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
    this.stab = new Stabilizer(30);
    this.frameMs = 33; // tiempo medio entre detecciones
    this._lastFresh = null;
    this._thumbOutSince = null;
    this.neutral = 0; // inclinación "recta" de esta persona (grados)
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
    if (fresh) {
      if (this._lastFresh != null) this.frameMs += (Math.min(200, now - this._lastFresh) - this.frameMs) * 0.2;
      this._lastFresh = now;
    }
    if (chord) {
      const ext = chord.extended;
      if (fresh) {
        if (ext.thumb && this._thumbOutSince == null) this._thumbOutSince = now;
        if (!ext.thumb) this._thumbOutSince = null;
      }
      rawDeg = degreeFromFingers(ext);
      // El pulgar que asoma al cambiar de acorde: si cambia el acorde y acaba de salir, se
      // espera un momento (sin dar por bueno el gesto de "sin pulgar", que tampoco es).
      const thumbMatters = ext.thumb && degreeFromFingers({ ...ext, thumb: false }) !== rawDeg;
      if (thumbMatters && now - this._thumbOutSince < THUMB_HOLD_MS) rawDeg = PENDING;
    } else this._thumbOutSince = null;
    if (fresh) this.degHist.push({ t: now, v: rawDeg });
    const dv = vote(this.degHist, this.frameMs);
    if (dv.ok) this.degree = dv.value;
    if (!chord) this.degree = -1;

    let chordInfo = null;
    if (chord) {
      const onLeft = chord.landmarks[0].x < 0.5;
      this.roll += (screenRoll(chord, stage) - this.roll) * ease(dt, 60);
      // "Recta" es como cada uno pone la mano sin pensar (casi nadie la pone perfectamente
      // vertical): mientras está recta, el punto de partida se ajusta poco a poco a su postura.
      if (this.tilt === 'recta' && this.degree >= 1) {
        this.neutral += (this.roll - this.neutral) * ease(dt, NEUTRAL_TAU);
        this.neutral = Math.max(-NEUTRAL_MAX, Math.min(NEUTRAL_MAX, this.neutral));
      }
      const rel = this.roll - this.neutral;
      this.tilt = tiltSide(rel, onLeft, this.tilt);
      chordInfo = { pos: stage.toScreen(chord.landmarks[0]), degree: this.degree, tilt: this.tilt, roll: rel, onLeft };
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
      const vv = vote(this.voiceHist, this.frameMs);
      if (vv.ok) {
        this.voicingSmooth = vv.value;
        this.exprReady = true; // ya se sabe cuántos dedos enseña (no es el valor por defecto)
      }
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
      this.exprReady = false;
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
    // Candado: con el pulgar de la mano de expresión fuera, el acorde queda fijado del todo
    // (grado, mayor/menor, variante y octava) para preparar el siguiente con las dos manos.
    // El volumen sigue a la mano.
    if (settings.chordThumbLock && lockThumb && !exprMuted) {
      if (!this.locked && this.stable) this.locked = { ...this.stable };
    } else this.locked = null;
    if (this.locked) this.stable = { ...this.locked };

    return {
      chord,
      expr,
      chordInfo,
      exprInfo,
      rawDegree: rawDeg,
      degree: this.degree,
      tilt: this.tilt,
      octave: this.octave,
      exprReady: !!this.exprReady,
      locked: !!this.locked,
      voicing: exprInfo ? exprInfo.voicing : null,
      exprMuted,
      volume: this.volume,
      brightness: this.brightness,
      stable: this.stable,
    };
  }
}
