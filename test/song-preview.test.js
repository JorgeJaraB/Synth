import test from 'node:test';
import assert from 'node:assert/strict';
import { previewStart } from '../src/core/song-preview.js';

const line = (text, start) => ({ start, syllables: [{ text, time: start }] });

test('la escucha previa empieza en el estribillo (la línea que más se repite)', () => {
  const song = {
    duration: 120,
    hasLyrics: true,
    lines: [line('Estrofa uno', 3), line('Esto es el estribillo', 30), line('Estrofa dos', 50), line('¡Esto es el estribillo!', 80), line('Final', 100)],
  };
  assert.equal(previewStart(song), 29.6);
});

test('sin estribillo, empieza hacia un tercio en un pulso fuerte; canciones cortas desde el principio', () => {
  const beats = Array.from({ length: 120 }, (_, i) => ({ time: i * 0.5, accent: i % 4 === 0 }));
  const s = previewStart({ duration: 60, hasLyrics: false, beats });
  assert.ok(Math.abs(s - 20) <= 1 && beats.some((b) => b.accent && b.time === s));
  assert.equal(previewStart({ duration: 18, hasLyrics: false, beats: [] }), 0);
});
