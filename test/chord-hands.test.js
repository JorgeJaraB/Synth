import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SteadyFlag } from '../src/core/chord-hands.js';

test('el pulgar solo cambia si se mantiene un momento', () => {
  const f = new SteadyFlag(200);
  assert.equal(f.update(true, 0), false);
  assert.equal(f.update(true, 100), false); // un destello al cambiar de acorde no cuenta
  assert.equal(f.update(false, 150), false);
  assert.equal(f.update(true, 160), false);
  assert.equal(f.update(true, 300), false);
  assert.equal(f.update(true, 370), true); // 210 ms seguidos fuera
  assert.equal(f.update(false, 400), true);
  assert.equal(f.update(false, 610), false);
});

// Mano falsa: solo hacen falta la muñeca, el nudillo del corazón y los dedos levantados.
function fakeHand(x, fingers, roll = 0) {
  const lm = Array.from({ length: 21 }, () => ({ x, y: 0.5 }));
  const a = (roll * Math.PI) / 180;
  lm[0] = { x, y: 0.6 };
  lm[9] = { x: x + (Math.sin(a) * 0.2 * 540) / 960, y: 0.6 - Math.cos(a) * 0.2 };
  const extended = Object.fromEntries(['thumb', 'index', 'middle', 'ring', 'pinky'].map((f) => [f, fingers.includes(f)]));
  const n = ['index', 'middle', 'ring', 'pinky'].filter((f) => extended[f]).length;
  return { landmarks: lm, extended, fist: n === 0 };
}
const stage = { toScreen: (p) => ({ x: p.x * 960, y: p.y * 540 }) };

function play(reader, frames, t0 = 0) {
  // frames: [[ms, hands]] — cada fotograma de cámara dura 33 ms
  const seen = [];
  let t = t0;
  for (const [ms, mk] of frames) {
    for (let e = 0; e < ms; e += 33) {
      reader.update(mk(), stage, 540, (t += 33));
      seen.push(reader.stable?.degree ?? null);
    }
  }
  return { seen, t };
}

test('el pulgar que asoma al cambiar de acorde no cambia el acorde', async () => {
  const { ChordHandReader } = await import('../src/core/chord-hands.js');
  const r = new ChordHandReader();
  const right = () => fakeHand(0.7, ['index']);
  const { seen } = play(r, [
    [600, () => [fakeHand(0.3, ['index']), right()]],
    [130, () => [fakeHand(0.3, ['index', 'middle', 'thumb']), right()]], // el pulgar asoma un momento
    [600, () => [fakeHand(0.3, ['index', 'middle']), right()]],
  ]);
  assert.deepEqual([...new Set(seen.filter((x) => x != null))], [1, 2]);
  // Sacar el pulgar a propósito sí cuenta (III con tres dedos: pulgar, índice y corazón)
  const { seen: s2 } = play(r, [[600, () => [fakeHand(0.3, ['index', 'middle', 'thumb']), right()]]], 5000);
  assert.equal(s2.at(-1), 3);
});

test('candado: con el pulgar derecho fuera el acorde no cambia', async () => {
  const { ChordHandReader } = await import('../src/core/chord-hands.js');
  const { settings } = await import('../src/core/settings.js');
  settings.chordThumbLock = true;
  const r = new ChordHandReader();
  let { t } = play(r, [
    [500, () => [fakeHand(0.3, ['index']), fakeHand(0.7, ['index'])]],
    [400, () => [fakeHand(0.3, ['index']), fakeHand(0.7, ['index', 'thumb'])]],
  ]);
  ({ t } = play(r, [[600, () => [fakeHand(0.3, ['index', 'middle', 'ring', 'pinky']), fakeHand(0.7, ['index', 'thumb'])]]], t));
  assert.equal(r.stable.degree, 1);
  assert.equal(r.locked?.degree, 1);
  play(r, [[600, () => [fakeHand(0.3, ['index', 'middle', 'ring', 'pinky']), fakeHand(0.7, ['index'])]]], t);
  assert.equal(r.stable.degree, 4);
  settings.chordThumbLock = false;
});

test('girar la mano derecha sube y baja de octava', async () => {
  const { ChordHandReader } = await import('../src/core/chord-hands.js');
  const r = new ChordHandReader();
  let { t } = play(r, [[600, () => [fakeHand(0.3, ['index']), fakeHand(0.7, ['index'], 35)]]]);
  assert.equal(r.stable.octave, 1);
  ({ t } = play(r, [[600, () => [fakeHand(0.3, ['index']), fakeHand(0.7, ['index'], -35)]]], t));
  assert.equal(r.stable.octave, -1);
  play(r, [[600, () => [fakeHand(0.3, ['index']), fakeHand(0.7, ['index'], 0)]]], t);
  assert.equal(r.stable.octave, 0);
});
