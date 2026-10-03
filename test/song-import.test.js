import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { durationSuffix, songToText } from '../src/core/song-import.js';
import { parseSongText, buildKar } from '../src/core/song-text.js';
import { parseSong } from '../src/core/midi-parse.js';

test('duraciones al formato del editor', () => {
  assert.equal(durationSuffix(1), '');
  assert.equal(durationSuffix(2), '-');
  assert.equal(durationSuffix(3), '--');
  assert.equal(durationSuffix(0.5), '/');
  assert.equal(durationSuffix(0.25), '//');
  assert.equal(durationSuffix(1.5), '/-');
  assert.equal(durationSuffix(0.75), '/.');
  // Lo que se escribe se vuelve a leer con la misma duración
  for (const b of [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.75, 4]) {
    assert.equal(parseSongText({ notesText: 'Do' + durationSuffix(b) }).notes[0].beats, b);
  }
});

test('Estrellita.kar se convierte en texto del editor y vuelve a sonar igual', () => {
  const song = parseSong(fs.readFileSync(new URL('../public/songs/Estrellita.kar', import.meta.url)), 'Estrellita.kar');
  const r = songToText(song);
  assert.ok(r.notesText.startsWith('Do Do Sol Sol | La La Sol-'), r.notesText.slice(0, 40));
  assert.ok(r.lyricsText.toLowerCase().startsWith('es-tre-lli-ta'), r.lyricsText.slice(0, 30));
  assert.ok(r.chordsText.startsWith('Do'));
  const parsed = parseSongText(r);
  assert.deepEqual(parsed.errors, []);
  // Mismo número de notas que la melodía original
  assert.equal(parsed.notes.filter((n) => !n.rest).length, song.tracks[song.melodyTrack].notes.length);
  assert.ok(buildKar({ title: 'x', notes: parsed.notes, syllables: parsed.syllables, chords: parsed.chords }).length > 100);
});
