import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMusicXmlFile, parseXml } from '../src/core/musicxml.js';

const bytes = (f) => new Uint8Array(fs.readFileSync(new URL('./fixtures/' + f, import.meta.url)));

test('lee notas, tempo, compás, ligaduras y acordes de un MusicXML', async () => {
  const s = await parseMusicXmlFile(bytes('estrellita.musicxml'), 'estrellita.musicxml');
  assert.equal(s.title, 'Estrellita (prueba)');
  assert.equal(s.bpm, 90);
  assert.deepEqual(s.timeSignature, [4, 4]);
  const n = s.tracks[0].notes;
  assert.deepEqual(n.slice(0, 7).map((x) => x.midi), [60, 60, 67, 67, 69, 69, 67]);
  // Negra a 90 ppm = 0,667 s
  assert.ok(Math.abs(n[1].time - 60 / 90) < 1e-6);
  // La ligadura une Mi (1 + 1 tiempos) en una sola nota de 2 tiempos
  const tied = n.find((x) => x.midi === 64 && Math.abs(x.time - (11 * 60) / 90) < 1e-6);
  assert.ok(tied && Math.abs(tied.duration - (2 * 60) / 90) < 1e-6);
  // Acorde final Do + Mi a la vez
  const last = n.filter((x) => Math.abs(x.time - (14 * 60) / 90) < 1e-6).map((x) => x.midi);
  assert.deepEqual(last.sort(), [60, 64]);
});

test('lee la letra en sílabas y la separa en líneas', async () => {
  const s = await parseMusicXmlFile(bytes('estrellita.musicxml'), 'x');
  assert.ok(s.hasLyrics);
  assert.equal(s.lines[0].syllables.map((x) => x.text).join(''), 'Estrellita, ');
  assert.equal(s.lines[1].syllables.map((x) => x.text).join(''), '¿dónde estás? ');
  assert.equal(s.lines[2].syllables.map((x) => x.text).join(''), 'Me pregunto ');
});

test('lee el formato comprimido .mxl', async () => {
  const s = await parseMusicXmlFile(bytes('estrellita.mxl'), 'estrellita.mxl');
  assert.equal(s.title, 'Estrellita (prueba)');
  assert.equal(s.tracks[0].notes.length, 13); // 14 notas escritas; la ligadura une 2 en 1
});

test('parser XML: atributos, entidades y CDATA', () => {
  const d = parseXml('<a x="1 &amp; 2"><b>Mi &lt;3</b><![CDATA[<raw>]]><c/></a>');
  const a = d.children[0];
  assert.equal(a.attrs.x, '1 & 2');
  assert.equal(a.children[0].text, 'Mi <3');
  assert.equal(a.text, '<raw>');
  assert.equal(a.children[1].name, 'c');
});
