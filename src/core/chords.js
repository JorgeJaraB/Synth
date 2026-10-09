// Acordes de una tonalidad mayor y lectura de gestos de mano para el modo "Acordes con gestos".
// Idea inspirada en "Gesture Synth" de Eric Wei (indecisive.eric); implementación propia.
import { noteName } from './notes.js';

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
/** Calidad natural de cada grado en una tonalidad mayor: I ii iii IV V vi vii° */
export const NATURAL_QUALITY = ['mayor', 'menor', 'menor', 'mayor', 'mayor', 'menor', 'dim'];
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export const VOICINGS = {
  triada: 'Tríada',
  inversion: '1.ª inversión',
  septima: 'Con séptima',
  dominante: 'Séptima de dominante / disminuido',
};

/** Nombre de la variante teniendo en cuenta si el acorde es mayor o menor. */
export function voicingLabel(voicing, quality) {
  if (voicing === 'dominante') return quality === 'mayor' ? 'Séptima de dominante' : 'Disminuido';
  if (voicing === 'septima') return quality === 'mayor' ? 'Séptima mayor' : 'Séptima menor';
  return VOICINGS[voicing];
}

/** Número romano con la convención habitual: mayúsculas mayor, minúsculas menor, ° disminuido. */
export function romanFor(degree, quality) {
  const r = ROMAN[degree - 1];
  if (quality === 'mayor') return r;
  return r.toLowerCase() + (quality === 'dim' ? '°' : '');
}

/** Distancia de cada grado a la tónica, como en Gesture Synth: el VII queda por debajo. */
const DEGREE_OFFSET = [0, 2, 4, 5, 7, 9, -1];

/**
 * Notas MIDI de un acorde, en posición abierta y en el mismo registro que Gesture Synth:
 * la tónica va de Solb3 a Fa4, cada grado sube desde ella (el VII baja un semitono) y encima
 * van la quinta, la octava y la décima.
 * @param {number} tonic  nota MIDI de la tónica (solo importa la nota, no la octava)
 * @param {number} degree 1..7
 * @param {'mayor'|'menor'|'dim'} quality
 * @param {keyof VOICINGS} voicing
 * @param {number} octave  -1, 0 o +1 (girando la mano de expresión)
 */
export function chordNotes(tonic, degree, quality, voicing = 'triada', octave = 0) {
  const home = 54 + ((((tonic % 12) - 6) % 12) + 12) % 12;
  const root = home + DEGREE_OFFSET[degree - 1] + 12 * octave;
  const third = quality === 'mayor' ? 4 : 3;
  const fifth = quality === 'dim' ? 6 : 7;
  let iv;
  if (voicing === 'inversion') iv = [third, fifth, 12, 12 + third];
  else if (voicing === 'septima') iv = [0, third, fifth, quality === 'mayor' ? 11 : 10];
  else if (voicing === 'dominante') iv = quality === 'mayor' ? [0, 4, 7, 10] : [0, 3, 6, 9];
  else iv = [0, fifth, 12, 12 + third];
  return iv.map((i) => root + i);
}

/** Nombre corto del acorde: "Do", "Rem", "Si°", "Sol7", "Domaj7", "Rem7", "Si°7". */
export function chordSymbol(tonic, degree, quality, voicing, notation = 'solfeo') {
  const root = tonic + MAJOR_STEPS[degree - 1];
  const n = noteName(root, notation === 'colores' ? 'solfeo' : notation);
  if (voicing === 'dominante') return quality === 'mayor' ? n + '7' : n + '°7';
  if (voicing === 'septima') return quality === 'mayor' ? n + 'maj7' : quality === 'dim' ? n + 'ø7' : n + 'm7';
  return n + (quality === 'menor' ? 'm' : quality === 'dim' ? '°' : '');
}

/** Nombre largo en castellano: "Do mayor", "Re menor", "Si disminuido". */
export function chordLongName(tonic, degree, quality, notation = 'solfeo') {
  const root = tonic + MAJOR_STEPS[degree - 1];
  const n = noteName(root, notation === 'colores' ? 'solfeo' : notation);
  return n + (quality === 'mayor' ? ' mayor' : quality === 'menor' ? ' menor' : ' disminuido');
}

export const chordRoot = (tonic, degree) => tonic + MAJOR_STEPS[degree - 1];

/**
 * Grado según los dedos levantados de la mano de los acordes.
 *   1..5 dedos → I..V · 🤘 índice + meñique → VI · 🤟 (con pulgar) → VII · puño → 0 (silencio)
 */
export function degreeFromFingers(ext) {
  // Con los cuatro dedos cerrados es un puño (silencio), esté el pulgar dentro o por fuera:
  // el pulgar solo cuenta junto a otros dedos levantados.
  if (!ext.index && !ext.middle && !ext.ring && !ext.pinky) return 0;
  if (ext.index && ext.pinky && !ext.middle && !ext.ring) return ext.thumb ? 7 : 6;
  return ['thumb', 'index', 'middle', 'ring', 'pinky'].filter((f) => ext[f]).length;
}

/** Variante del acorde según los dedos de la mano de expresión (sin contar el pulgar). 0 = puño. */
export function voicingFromFingers(ext) {
  const n = ['index', 'middle', 'ring', 'pinky'].filter((f) => ext[f]).length;
  return [null, 'triada', 'inversion', 'septima', 'dominante'][n];
}

/**
 * Inclinación lateral de la mano en grados: 0 = recta hacia arriba,
 * positivo = inclinada hacia la derecha de la pantalla.
 */
export function handRoll(lm) {
  const dx = lm[9].x - lm[0].x;
  const dy = lm[9].y - lm[0].y;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Grados de inclinación para pasar a mayor / menor, y para volver a recta (histéresis). */
export const TILT_ENTER = 12;
export const TILT_EXIT = 6;

/**
 * Hacia dónde está inclinada la mano de los acordes, con histéresis para que no parpadee.
 * "dentro" = hacia el centro de la pantalla, "fuera" = hacia el borde.
 * @param {number} roll  grados (handRoll)
 * @param {boolean} onLeft  la mano está en la mitad izquierda de la pantalla
 */
export function tiltSide(roll, onLeft, prev = 'recta', enter = TILT_ENTER, exit = TILT_EXIT) {
  const inward = onLeft ? roll : -roll;
  // Para salir de una inclinación basta con volver casi a recta (histéresis),
  // pero se puede pasar directamente de un lado al otro.
  if (prev === 'dentro' && inward > exit) return 'dentro';
  if (prev === 'fuera' && inward < -exit) return 'fuera';
  if (inward > enter) return 'dentro';
  if (inward < -enter) return 'fuera';
  return 'recta';
}

/**
 * Calidad final. Hacia fuera = menor; hacia dentro = mayor. Con la mano recta:
 * 'mayor' → mayor en todos los grados, como en Gesture Synth; 'natural' → la de la escala.
 */
export function qualityFor(degree, tilt, straight = 'mayor') {
  if (tilt === 'dentro') return 'mayor';
  if (tilt === 'fuera') return 'menor';
  return restQuality(degree, straight);
}

/** Calidad de cada grado con la mano recta. */
export const restQuality = (degree, straight = 'mayor') => (straight === 'natural' ? NATURAL_QUALITY[degree - 1] : 'mayor');

/** Grados de giro de la mano de expresión para subir o bajar una octava (y para volver). */
export const OCTAVE_ENTER = 22;
export const OCTAVE_EXIT = 11;

/**
 * Octava según el giro de la mano de expresión, con histéresis: girarla hacia la derecha de la
 * pantalla (como una rueda de volumen) sube una octava y hacia la izquierda la baja.
 */
export function octaveFromRoll(roll, prev = 0) {
  if (prev === 1 && roll > OCTAVE_EXIT) return 1;
  if (prev === -1 && roll < -OCTAVE_EXIT) return -1;
  if (roll > OCTAVE_ENTER) return 1;
  if (roll < -OCTAVE_ENTER) return -1;
  return 0;
}

/** Evita cambios de acorde por gestos a medio hacer: un valor nuevo debe mantenerse un momento. */
export class Stabilizer {
  constructor(holdMs = 140) {
    this.holdMs = holdMs;
    this.value = null;
    this.candidate = null;
    this.since = 0;
  }
  update(v, now) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (same(v, this.value)) {
      this.candidate = null;
      return this.value;
    }
    if (!same(v, this.candidate)) {
      this.candidate = v;
      this.since = now;
    } else if (now - this.since >= this.holdMs) {
      this.value = v;
      this.candidate = null;
    }
    return this.value;
  }
}

/** Progresiones típicas para practicar en clase (grados con su calidad natural). */
export const PROGRESSIONS = {
  ninguna: { name: 'Libre (sin guía)', degrees: [] },
  basica: { name: 'I – IV – V – I (la más básica)', degrees: [1, 4, 5, 1] },
  pop: { name: 'I – V – vi – IV (canciones pop)', degrees: [1, 5, 6, 4] },
  cincuenta: { name: 'I – vi – IV – V (años 50)', degrees: [1, 6, 4, 5] },
  blues: { name: 'Blues de 12 compases', degrees: [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5] },
  canon: { name: 'Canon de Pachelbel', degrees: [1, 5, 6, 3, 4, 1, 4, 5] },
};
