import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chordNotes, chordSymbol, romanFor, degreeFromFingers, voicingFromFingers, handRoll, tiltSide, qualityFor, octaveFromRoll, Stabilizer,
} from '../src/core/chords.js';

const ext = (s) => ({ thumb: s.includes('p'), index: s.includes('i'), middle: s.includes('m'), ring: s.includes('a'), pinky: s.includes('e') });

test('acordes de Do mayor', () => {
  // Posición abierta y registro de Gesture Synth: los grados suben desde la tónica y el VII baja
  assert.deepEqual(chordNotes(60, 1, 'mayor'), [60, 67, 72, 76]); // Do Sol Do Mi
  assert.deepEqual(chordNotes(48, 1, 'mayor'), [60, 67, 72, 76]); // la octava de la tónica no importa
  assert.deepEqual(chordNotes(60, 2, 'menor'), [62, 69, 74, 77]); // Re La Re Fa
  assert.deepEqual(chordNotes(60, 7, 'dim'), [59, 65, 71, 74]); // Si Fa Si Re
  assert.deepEqual(chordNotes(60, 5, 'mayor', 'dominante'), [67, 71, 74, 77]); // Sol7, por encima del Do
  assert.deepEqual(chordNotes(60, 6, 'mayor'), [69, 76, 81, 85]); // La mayor
  // Sol mayor: la tónica baja a Sol3, como en Gesture Synth
  assert.deepEqual(chordNotes(67, 1, 'mayor'), [55, 62, 67, 71]);
  assert.deepEqual(chordNotes(65, 1, 'mayor'), [65, 72, 77, 81]); // Fa4
  // Octava arriba / abajo
  assert.deepEqual(chordNotes(60, 1, 'mayor', 'triada', 1), [72, 79, 84, 88]);
  assert.deepEqual(chordNotes(60, 1, 'mayor', 'triada', -1), [48, 55, 60, 64]);
  assert.deepEqual(chordNotes(60, 1, 'mayor', 'inversion'), [64, 67, 72, 76]);
  assert.deepEqual(chordNotes(60, 1, 'mayor', 'septima'), [60, 64, 67, 71]); // Domaj7
});

test('nombres de acordes y números romanos', () => {
  assert.equal(chordSymbol(60, 1, 'mayor', 'triada'), 'Do');
  assert.equal(chordSymbol(60, 6, 'menor', 'triada'), 'Lam');
  assert.equal(chordSymbol(60, 5, 'mayor', 'dominante'), 'Sol7');
  assert.equal(chordSymbol(60, 2, 'menor', 'triada', 'letras'), 'Dm');
  assert.equal(romanFor(6, 'menor'), 'vi');
  assert.equal(romanFor(7, 'dim'), 'vii°');
});

test('grados según los dedos', () => {
  assert.equal(degreeFromFingers(ext('i')), 1);
  assert.equal(degreeFromFingers(ext('im')), 2);
  assert.equal(degreeFromFingers(ext('ima')), 3);
  assert.equal(degreeFromFingers(ext('imae')), 4);
  assert.equal(degreeFromFingers(ext('pimae')), 5);
  assert.equal(degreeFromFingers(ext('ie')), 6); // 🤘
  assert.equal(degreeFromFingers(ext('pie')), 7); // 🤟
  assert.equal(degreeFromFingers(ext('')), 0); // puño
  // Puño con el pulgar por fuera (sin cruzarlo): sigue siendo puño, no "1 dedo"
  assert.equal(degreeFromFingers({ thumb: true, index: false, middle: false, ring: false, pinky: false }), 0);
  // Con otro dedo levantado, el pulgar sí cuenta
  assert.equal(degreeFromFingers({ thumb: true, index: true, middle: false, ring: false, pinky: false }), 2);
});

test('variante según los dedos de la mano derecha', () => {
  assert.equal(voicingFromFingers(ext('')), null);
  assert.equal(voicingFromFingers(ext('i')), 'triada');
  assert.equal(voicingFromFingers(ext('pim')), 'inversion');
  assert.equal(voicingFromFingers(ext('imae')), 'dominante');
});

test('inclinación de la mano y calidad', () => {
  const up = [{ x: 0.5, y: 0.8 }];
  up[9] = { x: 0.5, y: 0.6 };
  assert.ok(Math.abs(handRoll(up)) < 1);
  const right = [{ x: 0.5, y: 0.8 }];
  right[9] = { x: 0.6, y: 0.65 };
  assert.ok(handRoll(right) > 30);
  // Mano a la izquierda inclinada hacia el centro = "dentro" → mayor
  assert.equal(tiltSide(35, true), 'dentro');
  assert.equal(tiltSide(-35, true), 'fuera');
  assert.equal(tiltSide(35, false), 'fuera');
  assert.equal(tiltSide(5, true, 'dentro'), 'recta');
  assert.equal(tiltSide(9, true, 'dentro'), 'dentro'); // histéresis
  assert.equal(tiltSide(9, true, 'recta'), 'recta');
  assert.equal(tiltSide(-14, true, 'recta'), 'fuera'); // basta con inclinarla un poco
  assert.equal(tiltSide(-35, true, 'dentro'), 'fuera'); // de un lado al otro directamente
  assert.equal(qualityFor(2, 'recta'), 'mayor'); // como en Gesture Synth
  assert.equal(qualityFor(2, 'recta', 'natural'), 'menor');
  assert.equal(qualityFor(7, 'recta', 'natural'), 'dim');
  assert.equal(qualityFor(2, 'dentro'), 'mayor');
  assert.equal(qualityFor(1, 'fuera'), 'menor');
});

test('girar la mano de expresión cambia de octava, con histéresis', () => {
  assert.equal(octaveFromRoll(0), 0);
  assert.equal(octaveFromRoll(30), 1);
  assert.equal(octaveFromRoll(15, 1), 1); // sigue arriba hasta volver casi a recta
  assert.equal(octaveFromRoll(15, 0), 0);
  assert.equal(octaveFromRoll(5, 1), 0);
  assert.equal(octaveFromRoll(-30, 1), -1);
});

test('el estabilizador espera a que el gesto se mantenga', () => {
  const s = new Stabilizer(100);
  assert.equal(s.update(1, 0), null);
  assert.equal(s.update(1, 50), null);
  assert.equal(s.update(1, 120), 1);
  assert.equal(s.update(2, 130), 1);
  assert.equal(s.update(1, 150), 1);
  assert.equal(s.update(2, 160), 1);
  assert.equal(s.update(2, 270), 2);
});
