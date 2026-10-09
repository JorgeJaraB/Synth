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

test('bajar un dedo lo pulsa, y subirlo lo suelta', () => {
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

test('mover toda la mano no pulsa nada', () => {
  const fp = new FingerPress();
  run(fp, Array(10).fill(hand()));
  const fired = new Set();
  for (let i = 0; i < 30; i++) {
    for (const [id, st] of fp.update([hand({}, { x: i * 6, y: i * 8 })], (fp._t += 1 / 30))) if (st.pressed) fired.add(id);
  }
  assert.deepEqual([...fired], []);
});

test('cada dedo va por su cuenta: un dedo más bajo de lo normal no suena', () => {
  const fp = new FingerPress();
  // La mano no está plana: el anular descansa bastante más abajo que los demás.
  run(fp, Array(40).fill(hand({ ring: 22 })));
  let r = run(fp, [hand({ ring: 22 })]);
  assert.equal(r.get('R:ring').pressed, false);
  // Bajarlo desde su propio reposo sí pulsa, aunque los otros dedos no se muevan.
  r = run(fp, [hand({ ring: 36 }), hand({ ring: 48 })]);
  assert.equal(r.get('R:ring').pressed, true);
  assert.equal(r.get('R:index').pressed, false);
  // Dos dedos a la vez también suenan (antes uno "tapaba" al otro).
  const fp2 = new FingerPress();
  run(fp2, Array(10).fill(hand()));
  r = run(fp2, [hand({ index: 14, middle: 14 }), hand({ index: 28, middle: 28 })]);
  assert.equal(r.get('R:index').pressed, true);
  assert.equal(r.get('R:middle').pressed, true);
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

test('cerrar la mano no toca ninguna nota', () => {
  const fp = new FingerPress();
  run(fp, Array(10).fill(hand()));
  // Todos los dedos bajan a la vez (la mano se cierra): no es una tecla
  const fired = new Set();
  for (const d of [10, 25, 40, 55]) {
    for (const [id, st] of fp.update([hand({ index: d, middle: d, ring: d, pinky: d, thumb: d / 2 })], (fp._t += 1 / 30))) if (st.pressed) fired.add(id);
  }
  // Y con el puño detectado tampoco
  const closed = { ...hand({ index: 60, middle: 60, ring: 60, pinky: 60 }), closed: true };
  for (let i = 0; i < 5; i++) for (const [id, st] of fp.update([closed], (fp._t += 1 / 30))) if (st.pressed) fired.add(id);
  // Al abrirla otra vez, tampoco suena nada
  for (let i = 0; i < 5; i++) for (const [id, st] of fp.update([hand()], (fp._t += 1 / 30))) if (st.pressed) fired.add(id);
  assert.deepEqual([...fired], []);
});

test('un dedo que se va bajando muy despacio no suena', () => {
  const fp = new FingerPress();
  run(fp, Array(10).fill(hand()));
  let fired = false;
  // 0,5 px por fotograma durante 2 s: es la mano que se relaja, no una pulsación
  for (let i = 0; i < 60; i++) if (fp.update([hand({ index: i * 0.5 })], (fp._t += 1 / 30)).get('R:index').pressed) fired = true;
  assert.equal(fired, false);
});
