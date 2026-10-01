import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSong } from '../src/core/midi-parse.js';
import { chordTimeline, detectKey } from '../src/core/harmony.js';
import { mode, volumeFromHeight } from '../src/core/chord-hands.js';

const load = (f) => parseSong(fs.readFileSync(new URL('../public/songs/' + f, import.meta.url)), f);
const degrees = (f) => chordTimeline(load(f)).chords.map((c) => c.degree);

test('acordes de Estrellita (Do: I IV I IV I V I …)', () => {
  const { tonic, chords } = chordTimeline(load('Estrellita.kar'));
  assert.equal(tonic, 0);
  assert.deepEqual(chords.slice(0, 7).map((c) => c.degree), [1, 4, 1, 4, 1, 5, 1]);
  assert.equal(chords[0].time, 0);
});

test('tonalidad: La cucaracha en Fa, María tenía un corderito en Do', () => {
  assert.equal(chordTimeline(load('La cucaracha.kar')).tonic, 5);
  assert.deepEqual(degrees('La cucaracha.kar'), [1, 5, 1]);
  assert.equal(chordTimeline(load('María tenía un corderito.mid')).tonic, 0);
  assert.deepEqual(degrees('María tenía un corderito.mid'), [1, 5, 1, 5, 1]);
});

test('Cumpleaños feliz: la nota de entrada no lleva acorde', () => {
  const { chords } = chordTimeline(load('Cumpleaños feliz.kar'));
  assert.equal(chords[0].degree, 1);
  assert.ok(chords[0].time > 0.3);
});

test('detectKey usa el relativo mayor de una tonalidad menor', () => {
  // La menor (La Do Mi … termina en La) → relativo mayor Do
  const notes = [57, 60, 64, 57, 62, 65, 64, 60, 59, 57].map((m, i) => ({ midi: m, time: i, duration: 1 }));
  const k = detectKey(notes, { finalPc: 9 });
  assert.equal(k.tonic, 0);
});

test('votación y volumen por altura', () => {
  assert.deepEqual(mode([1, 1, 2, 1, 3]), [1, 3]);
  assert.equal(volumeFromHeight(0.25), 1);
  assert.equal(volumeFromHeight(0.1), 1);
  assert.ok(Math.abs(volumeFromHeight(0.85) - 0.35) < 1e-9); // lo más bajo se sigue oyendo
  assert.ok(volumeFromHeight(0.55) > 0.6 && volumeFromHeight(0.55) < 0.75);
});

test('reacción rápida de los acordes (cámara a 30 fps)', async () => {
  const { ChordHandReader } = await import('../src/core/chord-hands.js');
  const r = new ChordHandReader();
  const stage = { toScreen: (p) => ({ x: p.x * 1000, y: p.y * 600 }) };
  const lm = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.5 }));
  lm[9] = { x: 0.3, y: 0.4 }; // mano recta
  const hand = (ext) => ({ landmarks: lm, extended: ext, fist: false });
  const one = { thumb: false, index: true, middle: false, ring: false, pinky: false };
  const four = { thumb: false, index: true, middle: true, ring: true, pinky: true };
  let t = 0;
  for (; t < 1000; t += 33) r.update([hand(one)], stage, 600, t);
  assert.equal(r.stable.degree, 1);
  const change = t;
  while (r.stable?.degree !== 4 && t < change + 2000) {
    r.update([hand(four)], stage, 600, t);
    t += 33;
  }
  const latency = t - change;
  assert.equal(r.stable.degree, 4);
  assert.ok(latency <= 170, `el acorde tardó ${latency} ms en cambiar`);
  // Un fotograma suelto erróneo no debe cambiar el acorde
  r.update([hand(one)], stage, 600, t);
  r.update([hand(four)], stage, 600, t + 33);
  r.update([hand(four)], stage, 600, t + 66);
  assert.equal(r.stable.degree, 4);
});
