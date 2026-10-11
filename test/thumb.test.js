import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbOut3D } from '../src/core/thumb.js';

// Mano en 3D (metros), palma de ~7 cm: nudillo del índice (5) y del meñique (17).
function world(thumb) {
  const w = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  w[0] = { x: 0, y: 0.08, z: 0 };
  w[5] = { x: 0.035, y: 0, z: 0 };
  w[17] = { x: -0.035, y: 0.005, z: 0 };
  w[1] = { x: 0.03, y: 0.065, z: 0.01 };
  w[2] = { x: 0.05, y: 0.045, z: 0.01 };
  [w[3], w[4]] = thumb;
  return w;
}

test('pulgar en 3D: solo cuenta fuera si está lejos del índice y estirado', () => {
  // 🤟 pulgar estirado hacia fuera
  assert.equal(thumbOut3D(world([{ x: 0.075, y: 0.03, z: 0.01 }, { x: 0.1, y: 0.015, z: 0.01 }])), true);
  // Pulgar relajado pegado al índice (el falso positivo típico)
  assert.equal(thumbOut3D(world([{ x: 0.058, y: 0.025, z: 0.012 }, { x: 0.05, y: 0.005, z: 0.015 }])), false);
  // Recogido sobre la palma
  assert.equal(thumbOut3D(world([{ x: 0.04, y: 0.03, z: 0.02 }, { x: 0.015, y: 0.025, z: 0.025 }])), false);
  // Lejos pero doblado (gancho): tampoco
  assert.equal(thumbOut3D(world([{ x: 0.085, y: 0.04, z: 0.01 }, { x: 0.085, y: 0.065, z: 0.01 }])), false);
});
