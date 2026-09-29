import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNoteToken, parseChordToken, parseSongText, buildKar, EXAMPLE_SONG } from '../src/core/song-text.js';
import { parseSong } from '../src/core/midi-parse.js';

test('notas escritas a mano', () => {
  assert.deepEqual(parseNoteToken('Do'), { midi: 60, beats: 1 });
  assert.deepEqual(parseNoteToken('Sol--'), { midi: 67, beats: 3 });
  assert.deepEqual(parseNoteToken('la/'), { midi: 69, beats: 0.5 });
  assert.deepEqual(parseNoteToken('Do5'), { midi: 72, beats: 1 });
  assert.deepEqual(parseNoteToken('Fa#'), { midi: 66, beats: 1 });
  assert.deepEqual(parseNoteToken('Sib3'), { midi: 58, beats: 1 });
  assert.deepEqual(parseNoteToken('E.'), { midi: 64, beats: 1.5 });
  assert.deepEqual(parseNoteToken('_-'), { rest: true, beats: 2 });
  assert.equal(parseNoteToken('Hola'), null);
});

test('acordes escritos a mano', () => {
  assert.deepEqual(parseChordToken('Do'), [36, 48, 52, 55]);
  assert.deepEqual(parseChordToken('Lam'), [45, 57, 60, 64]);
  assert.deepEqual(parseChordToken('Sol7'), [43, 55, 59, 62, 65]);
  assert.deepEqual(parseChordToken('Am'), parseChordToken('Lam'));
  assert.equal(parseChordToken('Xyz'), null);
});

test('letra repartida en sílabas y avisos de descuadre', () => {
  const r = parseSongText({ notesText: 'Do Re Mi _ Fa', lyricsText: 'Ho-la\nque tal_es' });
  assert.deepEqual(r.syllables, ['\\Ho', 'la ', '/que ', 'tal es ']);
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 0);
  const bad = parseSongText({ notesText: 'Do Re Pepe', lyricsText: 'a b c d' });
  assert.equal(bad.errors[0], 'No entiendo la nota "Pepe"');
  assert.match(bad.warnings[0], /sobran sílabas/);
});

test('el ejemplo genera un .kar que la app lee con letra y acordes', () => {
  const r = parseSongText({ ...EXAMPLE_SONG, beatsPerBar: 4 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  const bytes = buildKar({ title: EXAMPLE_SONG.title, bpm: 100, beatsPerBar: 4, notes: r.notes, syllables: r.syllables, chords: r.chords });
  const s = parseSong(bytes, 'x.kar');
  assert.equal(s.title, 'Estrellita (hecha a mano)');
  assert.equal(s.bpm, 100);
  assert.equal(s.lines.length, 4);
  assert.equal(s.lines[0].syllables.map((x) => x.text).join(''), 'Estrellita, ¿dónde estás? ');
  assert.ok(s.lines[2].paragraph);
  assert.equal(s.tracks.length, 2); // melodía + acompañamiento
  assert.equal(s.tracks[s.melodyTrack].notes.length, 28);
});
