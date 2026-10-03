import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSong, decodeMidiText, monophonic, noteNameLines } from '../src/core/midi-parse.js';

const load = (f) => parseSong(fs.readFileSync(new URL('../public/songs/' + f, import.meta.url)), f);

test('lee la letra y el título de un .kar', () => {
  const s = load('Estrellita.kar');
  assert.equal(s.title, 'Estrellita, ¿dónde estás?');
  assert.ok(s.hasLyrics);
  assert.equal(s.lines.length, 6);
  assert.equal(s.lines[0].syllables.map((x) => x.text).join(''), 'Estrellita, ¿dónde estás? ');
  assert.ok(s.lines[2].paragraph);
  assert.ok(!s.lines[1].paragraph);
});

test('duración y límites de las líneas de letra', () => {
  const s = load('Estrellita.kar');
  assert.ok(Number.isFinite(s.duration) && s.duration > 20);
  s.lines.forEach((l, i) => {
    assert.ok(Number.isFinite(l.start) && Number.isFinite(l.end));
    if (s.lines[i + 1]) assert.equal(l.end, s.lines[i + 1].start);
  });
});

test('detecta la pista de melodía usando la letra', () => {
  const s = load('Estrellita.kar');
  assert.equal(s.tracks.length, 2);
  assert.equal(s.tracks[s.melodyTrack].name, 'Melodía');
  assert.equal(s.tracks[s.melodyTrack].notes.length, 42);
});

test('detecta la melodía sin letra (la pista más aguda)', () => {
  const s = load('Himno de la alegría.mid');
  assert.equal(s.hasLyrics, false);
  assert.equal(s.tracks[s.melodyTrack].name, 'Melodía');
  assert.equal(s.title, 'Himno de la alegría');
});

test('tempo, compás y pulsos', () => {
  const s = load('Cumpleaños feliz.kar');
  assert.equal(s.bpm, 100);
  assert.deepEqual(s.timeSignature, [3, 4]);
  assert.ok(s.beats.length > 10);
  assert.ok(s.beats[0].accent && !s.beats[1].accent && s.beats[3].accent);
});

test('decodifica textos en Windows-1252 y UTF-8', () => {
  assert.equal(decodeMidiText('\xf1and\xfa'), 'ñandú');
  assert.equal(decodeMidiText('\xc3\xb1'), 'ñ');
});

test('monophonic se queda con la nota más aguda de cada acorde', () => {
  const m = monophonic([
    { midi: 60, time: 0, duration: 1 },
    { midi: 64, time: 0, duration: 1 },
    { midi: 62, time: 0.5, duration: 1 },
  ]);
  assert.deepEqual(m.map((n) => n.midi), [64, 62]);
  assert.equal(m[0].duration, 0.5);
});

test('noteNameLines crea líneas de nombres de notas', () => {
  const s = load('Himno de la alegría.mid');
  const mel = monophonic(s.tracks[s.melodyTrack].notes);
  const lines = noteNameLines(mel, (m) => ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'][m % 12]);
  assert.equal(lines.flatMap((l) => l.syllables).length, mel.length);
  assert.equal(lines[0].syllables[0].text, 'Mi ');
  lines.forEach((l) => assert.ok(l.end > l.start && l.syllables.length <= 8));
});

test('un MIDI cuyo único "texto" es el título no cuenta como canción con letra', async () => {
  const { default: midiFile } = await import('midi-file');
  const notes = [];
  for (let i = 0; i < 16; i++) {
    notes.push({ deltaTime: i ? 240 : 0, type: 'noteOn', channel: 0, noteNumber: 60 + (i % 5), velocity: 90 });
    notes.push({ deltaTime: 240, type: 'noteOff', channel: 0, noteNumber: 60 + (i % 5), velocity: 0 });
  }
  const bytes = new Uint8Array(midiFile.writeMidi({
    header: { format: 1, numTracks: 2, ticksPerBeat: 480 },
    tracks: [
      [{ deltaTime: 0, meta: true, type: 'trackName', text: 'Creep' }, { deltaTime: 0, meta: true, type: 'text', text: 'Creep' }, { deltaTime: 0, meta: true, type: 'text', text: 'Radiohead' }, { deltaTime: 0, meta: true, type: 'endOfTrack' }],
      [{ deltaTime: 0, meta: true, type: 'trackName', text: 'Piano' }, { deltaTime: 960, meta: true, type: 'text', text: 'Piano' }, ...notes, { deltaTime: 0, meta: true, type: 'endOfTrack' }],
    ],
  }));
  const s = parseSong(bytes, 'Creep.mid');
  assert.equal(s.hasLyrics, false);
});
