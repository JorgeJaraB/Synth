import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChordName, parseChordSheet, layoutChordSheet, chordSheetToKar } from '../src/core/chord-sheet.js';
import { parseSong } from '../src/core/midi-parse.js';
import { chordTimeline } from '../src/core/harmony.js';

const CREEP = `Key:  G

[Intro] G  B  C  Cm

[First Part]

                      G
When you were here before
                         B
Couldn't look you in the eye
                    C
You're just like an angel
                     Cm
Your skin makes me cry

[Interlude]

  G                        B
She's running out the door
`;

test('nombres de acordes', () => {
  assert.deepEqual(parseChordName('Cm'), { name: 'Cm', root: 0, quality: 'menor' });
  assert.equal(parseChordName('F#m7').root, 6);
  assert.equal(parseChordName('Bb').root, 10);
  assert.equal(parseChordName('Dsus4').quality, 'mayor');
  assert.equal(parseChordName('C/G').root, 0);
  assert.equal(parseChordName('Lam').quality, 'menor');
  assert.equal(parseChordName('Bdim').quality, 'dim');
  assert.equal(parseChordName('When'), null);
  assert.equal(parseChordName('a'), null); // palabra, no acorde
});

test('lee la hoja: tonalidad, acordes de la intro y acordes sobre la letra', () => {
  const s = parseChordSheet(CREEP);
  assert.equal(s.key, 7); // Sol
  assert.deepEqual(s.lines[0].chords.map((c) => c.name), ['G', 'B', 'C', 'Cm']); // [Intro]
  assert.equal(s.lines[0].lyric, '');
  assert.equal(s.lines[1].lyric, 'When you were here before');
  assert.deepEqual(s.lines[1].chords.map((c) => c.name), ['G']);
  assert.ok(s.lines[1].paragraph);
  // Dos acordes en la misma línea: cada palabra va con el que tiene encima
  const inter = s.lines.at(-1);
  assert.deepEqual(inter.chords.map((c) => c.name), ['G', 'B']);
  const lay = layoutChordSheet({ key: 7, lines: [inter] });
  assert.equal(lay.chords.length, 2);
  // La B está después de "door": toda la frase va con G y la B suena después
  assert.equal(lay.words.filter((w) => w.start < lay.chords[1].start).length, 5);
  // Con el acorde encima de una palabra a mitad de frase, el cambio cae en esa palabra
  const mid = parseChordSheet('G         Em\nI want you to notice').lines[0];
  const lay2 = layoutChordSheet({ key: 7, lines: [mid] });
  assert.deepEqual(lay2.words.filter((w) => w.start >= lay2.chords[1].start).map((w) => w.text), ['to', 'notice']);
});

test('el .kar generado trae letra y los acordes exactos para el karaoke de acordes', () => {
  const sheet = parseChordSheet(CREEP);
  const bytes = chordSheetToKar(sheet, { title: 'Creep', bpm: 90 });
  const song = parseSong(bytes, 'Creep.kar');
  assert.ok(song.hasLyrics);
  assert.equal(song.keyMark, 'G');
  const { tonic, chords } = chordTimeline(song);
  assert.equal(tonic, 7);
  // G B C Cm en Sol: I, III mayor, IV, IV menor
  assert.deepEqual(chords.slice(0, 4).map((c) => [c.degree, c.quality]), [[1, 'mayor'], [3, 'mayor'], [4, 'mayor'], [4, 'menor']]);
});
