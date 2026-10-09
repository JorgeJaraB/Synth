import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoId, fitSync, nudgeToNearest } from '../src/core/youtube.js';

test('enlaces de YouTube', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=10', 'https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ']) {
    assert.equal(parseVideoId(u), 'dQw4w9WgXcQ', u);
  }
  assert.equal(parseVideoId('garota de ipanema'), null);
});

test('sincronizar con los toques: inicio y velocidad', () => {
  // 120 ppm (0,5 s por pulso), el primer acorde a los 7,4 s, acordes de 4 pulsos; toques con algo de error
  const taps = [0, 4, 8, 12, 16].map((beat, i) => ({ beat, time: 7.4 + beat * 0.5 + [0.03, -0.04, 0.02, -0.01, 0.03][i] }));
  const fit = fitSync(taps);
  assert.ok(Math.abs(fit.bpm - 120) < 1.5, String(fit.bpm));
  assert.ok(Math.abs(fit.offset - 7.4) < 0.08, String(fit.offset));
  assert.equal(fitSync([{ beat: 0, time: 1 }]), null);
  assert.equal(fitSync([{ beat: 0, time: 1 }, { beat: 4, time: 1.05 }]), null); // velocidad imposible
});

test('reajustar a mitad de canción: se va al cambio de acorde más cercano', () => {
  assert.ok(Math.abs(nudgeToNearest(10.3, [8, 10, 12]) - 0.3) < 1e-9);
  assert.equal(nudgeToNearest(30, [8, 10, 12]), 0); // demasiado lejos: no se toca
});
