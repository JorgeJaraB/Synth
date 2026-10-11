// Tests del modo ligero automático y del límite de dibujos por segundo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoLightStep, frameGate, AUTO_LIGHT } from '../src/core/perf.js';

const OFF = { on: false, slowSince: null };
const run = (samples, { since = 1, start = 5000, step = 1000 } = {}) => {
  let st = OFF;
  samples.forEach((s, i) => (st = autoLightStep(st, { running: true, since, ...s }, start + i * step)));
  return st;
};

test('modo ligero: se activa tras unos segundos seguidos yendo lento', () => {
  const slow = { detectMs: 60, detectFps: 14 };
  assert.equal(run([slow, slow, slow]).on, false);
  assert.equal(run([slow, slow, slow, slow, slow]).on, true);
});

test('modo ligero: pocas imágenes por segundo también cuentan si el detector va justo', () => {
  const s = { detectMs: 28, detectFps: 15 };
  assert.equal(run(Array(6).fill(s)).on, true);
});

test('modo ligero: cámara lenta (poca luz) con un detector rápido no lo activa', () => {
  const s = { detectMs: 8, detectFps: 15 };
  assert.equal(run(Array(10).fill(s)).on, false);
});

test('modo ligero: un pico suelto no lo activa y la zona intermedia no reinicia la cuenta', () => {
  const slow = { detectMs: 50, detectFps: 25 };
  const good = { detectMs: 10, detectFps: 30 };
  const mid = { detectMs: 35, detectFps: 25 };
  assert.equal(run([slow, slow, good, slow, slow, good, slow, slow]).on, false);
  assert.equal(run([slow, slow, mid, slow, slow]).on, true);
});

test('modo ligero: se ignoran los primeros segundos y una vez activado se queda', () => {
  const slow = { detectMs: 90, detectFps: 10 };
  // Aún calentando (since muy reciente): no cuenta.
  let st = OFF;
  for (let t = 0; t < AUTO_LIGHT.warmupMs; t += 500) st = autoLightStep(st, { running: true, since: 1, ...slow }, t + 1);
  assert.equal(st.on, false);
  st = run(Array(6).fill(slow));
  assert.equal(st.on, true);
  st = autoLightStep(st, { running: true, since: 1, detectMs: 5, detectFps: 30 }, 99999);
  assert.equal(st.on, true);
  // Con la cámara apagada no se decide nada.
  assert.equal(autoLightStep(OFF, { running: false, since: 0, ...slow }, 99999).on, false);
});

/** Dibujos por segundo con una pantalla de hz Hz (con un poco de temblor). */
function fps(hz, jitter = 0) {
  let next = 0;
  let draws = 0;
  for (let i = 0; i < hz * 10; i++) {
    const now = (i * 1000) / hz + (i % 2 ? jitter : -jitter);
    const n = frameGate(next, now);
    if (n != null) {
      next = n;
      draws++;
    }
  }
  return draws / 10;
}

test('dibujo limitado a unos 30 img/s en pantallas de 60, 75, 120 y 144 Hz', () => {
  for (const hz of [60, 75, 120, 144]) {
    const f = fps(hz);
    assert.ok(f >= 28 && f <= 31, `${hz} Hz → ${f} img/s`);
  }
  // Con temblor en una pantalla de 60 Hz no se cae a 20 img/s.
  assert.ok(fps(60, 2) >= 29, 'temblor a 60 Hz');
  // Una pantalla de 30 Hz dibuja todos sus fotogramas.
  assert.ok(fps(30) >= 29.9);
});

test('tras un parón no se dibuja varias veces seguidas', () => {
  let next = frameGate(0, 0);
  next = frameGate(next, 1000); // parón de un segundo
  assert.equal(frameGate(next, 1016.7), null);
});
