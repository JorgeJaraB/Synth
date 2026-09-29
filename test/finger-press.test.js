import test from 'node:test';
import assert from 'node:assert/strict';
import { FingerPress } from '../src/core/finger-press.js';

// Mano "de piano" vista por la cámara del portátil: palma hacia abajo, nudillos en fila.
// drops: cuánto baja cada punta (px) respecto a su posición de reposo. shift: mover toda la mano.
function hand(drops = {}, shift = { x: 0, y: 0 }, key = 'R') {
  const p = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  const set = (i, x, y) => (p[i] = { x: x + shift.x, y: y + shift.y });
  set(0, 300, 520); // muñeca
  set(1, 250, 500);
  set(2, 230, 470); // nudillo del pulgar
  set(3, 220, 450);
  set(4, 215, 440 + (drops.thumb || 0));
  const fingers = [['index', 5, 250], ['middle', 9, 290], ['ring', 13, 330], ['pinky', 17, 365]];
  for (const [f, k, x] of fingers) {
    set(k, x, 420);
    set(k + 1, x, 405);
    set(k + 2, x, 398);
    set(k + 3, x, 395 + (drops[f] || 0)); // puntas un poco por encima de los nudillos
  }
  return { key, points: p };
}

// Reloj continuo a 30 fotogramas por segundo.
function run(fp, frames) {
  let r;
  fp._t ??= 0;
  for (const h of frames) r = fp.update([h], (fp._t += 1 / 30));
  return r;
}

test('bajar un dedo más que los demás lo pulsa, y subirlo lo suelta', () => {
  const fp = new FingerPress();
  run(fp, Array(10).fill(hand()));
  // Palma = 115 px; bajar 25 px ≈ 0,22 palmas
  let r = run(fp, [hand({ middle: 12 }), hand({ middle: 25 })]);
  assert.equal(r.get('R:middle').pressed, true);
  assert.equal(r.get('R:index').pressed, false);
  assert.equal(r.get('R:ring').pressed, false);
  r = run(fp, [hand({ middle: 3 }), hand()]);
  assert.equal(r.get('R:middle').pressed, false);
});

test('mover o inclinar toda la mano no pulsa nada', () => {
  const fp = new FingerPress();
  run(fp, Array(10).fill(hand()));
  const moved = [];
  for (let i = 0; i < 20; i++) moved.push(hand({}, { x: i * 6, y: i * 8 }));
  // Todas las puntas bajan a la vez (la mano se inclina hacia delante)
  for (let i = 0; i < 10; i++) moved.push(hand({ index: i * 4, middle: i * 4, ring: i * 4, pinky: i * 4 }));
  const fired = new Set();
  moved.forEach((h, i) => {
    for (const [id, s] of fp.update([h], (fp._t += 1 / 30))) if (s.pressed) fired.add(id);
  });
  assert.deepEqual([...fired].filter((id) => id !== 'R:thumb'), []);
});

test('un movimiento pequeño no suena; el anillo muestra cuánto falta', () => {
  const fp = new FingerPress();
  run(fp, Array(10).fill(hand()));
  const r = run(fp, [hand({ ring: 8 }), hand({ ring: 8 })]);
  assert.equal(r.get('R:ring').pressed, false);
  assert.ok(r.get('R:ring').amount > 0.3 && r.get('R:ring').amount < 1);
});

test('la sensibilidad cambia lo que hay que bajar el dedo', () => {
  const alta = new FingerPress({ sensitivity: 'alta' });
  const baja = new FingerPress({ sensitivity: 'baja' });
  for (const fp of [alta, baja]) run(fp, Array(10).fill(hand()));
  const frames = [hand({ index: 13 }), hand({ index: 13 })];
  assert.equal(run(alta, frames).get('R:index').pressed, true);
  assert.equal(run(baja, frames).get('R:index').pressed, false);
});

test('bajar el dedo rápido da más volumen que despacio', () => {
  const rapido = new FingerPress();
  const lento = new FingerPress();
  for (const fp of [rapido, lento]) run(fp, Array(10).fill(hand()));
  const v1 = run(rapido, [hand({ pinky: 30 })]).get('R:pinky');
  let v2;
  [4, 8, 12, 16, 20, 24].forEach((d, i) => {
    const s = lento.update([hand({ pinky: d })], (lento._t += 1 / 30)).get('R:pinky');
    if (s.justPressed) v2 = s;
  });
  assert.equal(v1.justPressed, true);
  assert.ok(v2, 'el dedo lento también acaba sonando');
  assert.ok(v1.velocity > v2.velocity);
});
