// Genera canciones de ejemplo (melodías populares de dominio público) en formato
// MIDI / Karaoke (.kar) dentro de public/songs. Se copian a la carpeta de canciones
// del usuario la primera vez que se abre la app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import midiFile from 'midi-file';
const { writeMidi } = midiFile;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/songs');
const TPB = 480;
const N = { Bb3: 58, Bb4: 70, C3: 48, D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, B3: 59, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76 };

// notes: [[nombre, duraciónEnPulsos, sílaba?]]
function build({ title, bpm, timeSig = [4, 4], melody, chords = [], lyrics = true, pickup = 0 }) {
  const abs = (list) => {
    let t = pickup;
    return list.map(([n, d, s]) => {
      const ev = { t: Math.round(t * TPB), d: Math.round(d * TPB), n: n ? N[n] : null, s };
      t += d;
      return ev;
    });
  };
  const toTrack = (evs) => {
    evs.sort((a, b) => a.t - b.t || (a.off ? -1 : 1));
    let last = 0;
    return evs.map(({ t, e }) => {
      const out = { deltaTime: t - last, ...e };
      last = t;
      return out;
    });
  };
  const noteEvents = (list, channel, vel) => {
    const evs = [];
    for (const x of list) {
      if (x.n == null) continue;
      const len = Math.max(1, x.d - 20);
      evs.push({ t: x.t, e: { type: 'noteOn', channel, noteNumber: x.n, velocity: vel } });
      evs.push({ t: x.t + len, off: true, e: { type: 'noteOff', channel, noteNumber: x.n, velocity: 0 } });
    }
    return evs;
  };

  const mel = abs(melody);
  const conductor = [
    { deltaTime: 0, meta: true, type: 'trackName', text: title },
    { deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60000000 / bpm) },
    { deltaTime: 0, meta: true, type: 'timeSignature', numerator: timeSig[0], denominator: timeSig[1], metronome: 24, thirtyseconds: 8 },
    { deltaTime: 0, meta: true, type: 'endOfTrack' },
  ];
  const melTrack = toTrack([
    { t: 0, e: { meta: true, type: 'trackName', text: 'Melodía' } },
    { t: 0, e: { type: 'programChange', channel: 0, programNumber: 0 } },
    ...noteEvents(mel, 0, 96),
  ]);
  melTrack.push({ deltaTime: 0, meta: true, type: 'endOfTrack' });
  const tracks = [conductor, melTrack];

  if (chords.length) {
    const ch = [];
    let t = pickup;
    for (const [names, d] of chords) {
      for (const n of names) ch.push({ t: Math.round(t * TPB), d: Math.round(d * TPB), n: N[n] });
      t += d;
    }
    const acc = toTrack([
      { t: 0, e: { meta: true, type: 'trackName', text: 'Acompañamiento' } },
      { t: 0, e: { type: 'programChange', channel: 1, programNumber: 0 } },
      ...noteEvents(ch, 1, 60),
    ]);
    acc.push({ deltaTime: 0, meta: true, type: 'endOfTrack' });
    tracks.push(acc);
  }

  if (lyrics) {
    // Formato .kar: eventos de texto; "/" = nueva línea, "\" = nuevo párrafo
    const words = [
      { t: 0, e: { meta: true, type: 'text', text: '@KMIDI KARAOKE FILE' } },
      { t: 0, e: { meta: true, type: 'text', text: '@T' + title } },
    ];
    for (const x of mel) if (x.s) words.push({ t: x.t, e: { meta: true, type: 'text', text: x.s } });
    const w = toTrack(words);
    w.push({ deltaTime: 0, meta: true, type: 'endOfTrack' });
    tracks.push(w);
  }
  return Buffer.from(writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: TPB }, tracks }));
}

// Sílabas: "\" empieza párrafo, "/" empieza línea. Los espacios marcan fin de palabra.
const songs = {
  'Estrellita.kar': {
    title: 'Estrellita, ¿dónde estás?',
    bpm: 100,
    melody: [
      ['C4', 1, '\\Es'], ['C4', 1, 'tre'], ['G4', 1, 'lli'], ['G4', 1, 'ta, '], ['A4', 1, '¿dón'], ['A4', 1, 'de es'], ['G4', 2, 'tás? '],
      ['F4', 1, '/Me '], ['F4', 1, 'pre'], ['E4', 1, 'gun'], ['E4', 1, 'to '], ['D4', 1, 'qué '], ['D4', 1, 'se'], ['C4', 2, 'rás. '],
      ['G4', 1, '\\En '], ['G4', 1, 'el '], ['F4', 1, 'cie'], ['F4', 1, 'lo y '], ['E4', 1, 'en '], ['E4', 1, 'el '], ['D4', 2, 'mar, '],
      ['G4', 1, '/un '], ['G4', 1, 'dia'], ['F4', 1, 'man'], ['F4', 1, 'te '], ['E4', 1, 'de '], ['E4', 1, 'ver'], ['D4', 2, 'dad. '],
      ['C4', 1, '\\Es'], ['C4', 1, 'tre'], ['G4', 1, 'lli'], ['G4', 1, 'ta, '], ['A4', 1, '¿dón'], ['A4', 1, 'de es'], ['G4', 2, 'tás? '],
      ['F4', 1, '/Me '], ['F4', 1, 'pre'], ['E4', 1, 'gun'], ['E4', 1, 'to '], ['D4', 1, 'qué '], ['D4', 1, 'se'], ['C4', 2, 'rás.'],
    ],
    chords: [
      [['C3', 'E3', 'G3'], 4], [['F3', 'A3', 'C4'], 2], [['C3', 'E3', 'G3'], 2],
      [['F3', 'A3', 'C4'], 2], [['C3', 'E3', 'G3'], 2], [['G3', 'B3', 'D4'], 2], [['C3', 'E3', 'G3'], 2],
      [['C3', 'E3', 'G3'], 2], [['F3', 'A3', 'C4'], 2], [['C3', 'E3', 'G3'], 2], [['G3', 'B3', 'D4'], 2],
      [['C3', 'E3', 'G3'], 2], [['F3', 'A3', 'C4'], 2], [['C3', 'E3', 'G3'], 2], [['G3', 'B3', 'D4'], 2],
      [['C3', 'E3', 'G3'], 4], [['F3', 'A3', 'C4'], 2], [['C3', 'E3', 'G3'], 2],
      [['F3', 'A3', 'C4'], 2], [['C3', 'E3', 'G3'], 2], [['G3', 'B3', 'D4'], 2], [['C3', 'E3', 'G3'], 2],
    ],
  },
  'Martinillo.kar': {
    title: 'Martinillo',
    bpm: 110,
    melody: [
      ['C4', 1, '\\Mar'], ['D4', 1, 'ti'], ['E4', 1, 'ni'], ['C4', 1, 'llo, '],
      ['C4', 1, 'Mar'], ['D4', 1, 'ti'], ['E4', 1, 'ni'], ['C4', 1, 'llo, '],
      ['E4', 1, '/¿dón'], ['F4', 1, 'de es'], ['G4', 2, 'tás? '],
      ['E4', 1, '¿dón'], ['F4', 1, 'de es'], ['G4', 2, 'tás? '],
      ['G4', 0.5, '\\To'], ['A4', 0.5, 'ca '], ['G4', 0.5, 'la '], ['F4', 0.5, 'cam'], ['E4', 1, 'pa'], ['C4', 1, 'na, '],
      ['G4', 0.5, 'to'], ['A4', 0.5, 'ca '], ['G4', 0.5, 'la '], ['F4', 0.5, 'cam'], ['E4', 1, 'pa'], ['C4', 1, 'na, '],
      ['C4', 1, '/din '], ['G3', 1, 'don '], ['C4', 2, 'dan, '],
      ['C4', 1, 'din '], ['G3', 1, 'don '], ['C4', 2, 'dan.'],
    ],
    chords: Array.from({ length: 8 }, () => [['C3', 'G3'], 4]),
  },
  'Cumpleaños feliz.kar': {
    title: 'Cumpleaños feliz',
    bpm: 100,
    timeSig: [3, 4],
    melody: [
      ['G4', 0.75, '\\Cum'], ['G4', 0.25, 'ple'], ['A4', 1, 'a'], ['G4', 1, 'ños '], ['C5', 1, 'fe'], ['B4', 2, 'liz, '],
      ['G4', 0.75, '/te '], ['G4', 0.25, 'de'], ['A4', 1, 'sea'], ['G4', 1, 'mos '], ['D5', 1, 'a '], ['C5', 2, 'ti. '],
      ['G4', 0.75, '\\Cum'], ['G4', 0.25, 'ple'], ['G4', 1, 'a'], ['E5', 1, 'ños '], ['C5', 1, 'que'], ['B4', 1, 'ri'], ['A4', 2, 'do, '],
      ['F4', 0.75, '/cum'], ['F4', 0.25, 'ple'], ['E4', 1, 'a'], ['C4', 1, 'ños '], ['D4', 1, 'fe'], ['C4', 3, 'liz.'],
    ],
    chords: [
      [[], 1], [['C3', 'E3', 'G3'], 3], [['G3', 'B3', 'D4'], 3], [['G3', 'B3', 'D4'], 3], [['C3', 'E3', 'G3'], 3],
      [['C3', 'E3', 'G3'], 3], [['F3', 'A3', 'C4'], 3], [['C3', 'E3', 'G3'], 1], [['G3', 'B3', 'D4'], 2], [['C3', 'E3', 'G3'], 3],
    ],
  },
  'La cucaracha.kar': {
    title: 'La cucaracha',
    bpm: 120,
    melody: [
      ['C4', 0.5, '\\La '], ['C4', 0.5, 'cu'], ['C4', 0.5, 'ca'], ['F4', 1.5, 'ra'], ['A4', 1, 'cha, '],
      ['C4', 0.5, 'la '], ['C4', 0.5, 'cu'], ['C4', 0.5, 'ca'], ['F4', 1.5, 'ra'], ['A4', 1, 'cha, '],
      ['F4', 0.5, '/ya '], ['F4', 0.5, 'no '], ['E4', 0.5, 'pue'], ['E4', 0.5, 'de '], ['D4', 0.5, 'ca'], ['D4', 0.5, 'mi'], ['C4', 1, 'nar, '],
      ['C4', 0.5, '\\por'], ['C4', 0.5, 'que '], ['C4', 0.5, 'no '], ['E4', 1.5, 'tie'], ['G4', 1, 'ne, '],
      ['C4', 0.5, 'por'], ['C4', 0.5, 'que '], ['C4', 0.5, 'le '], ['E4', 1.5, 'fal'], ['G4', 1, 'ta '],
      ['C5', 0.5, '/las '], ['D5', 0.5, 'dos '], ['C5', 0.5, 'pa'], ['Bb4', 0.5, 'ti'], ['A4', 0.5, 'tas '], ['G4', 0.5, 'de a'], ['F4', 1, 'trás.'],
    ],
    chords: [
      [['F3', 'A3', 'C4'], 4], [['F3', 'A3', 'C4'], 4], [['C3', 'E3', 'Bb3'], 4],
      [['C3', 'E3', 'Bb3'], 4], [['C3', 'E3', 'Bb3'], 4], [['F3', 'A3', 'C4'], 4],
    ],
  },
  'Navidad (Jingle Bells).kar': {
    title: 'Navidad (Jingle Bells)',
    bpm: 120,
    melody: [
      ['E4', 1, '\\Na'], ['E4', 1, 'vi'], ['E4', 2, 'dad, '], ['E4', 1, 'na'], ['E4', 1, 'vi'], ['E4', 2, 'dad, '],
      ['E4', 1, 'hoy '], ['G4', 1, 'es '], ['C4', 1.5, 'Na'], ['D4', 0.5, 'vi'], ['E4', 4, 'dad, '],
      ['F4', 1, '/con '], ['F4', 1, 'cam'], ['F4', 1, 'pa'], ['F4', 1, 'nas '], ['E4', 1, 'es'], ['E4', 1, 'te '], ['E4', 1, 'dí'], ['E4', 1, 'a '],
      ['D4', 1, 'hay '], ['D4', 1, 'que '], ['E4', 1, 'fes'], ['D4', 1, 'te'], ['G4', 2, 'jar. '], [null, 2],
      ['E4', 1, '\\Na'], ['E4', 1, 'vi'], ['E4', 2, 'dad, '], ['E4', 1, 'na'], ['E4', 1, 'vi'], ['E4', 2, 'dad, '],
      ['E4', 1, 'hoy '], ['G4', 1, 'es '], ['C4', 1.5, 'Na'], ['D4', 0.5, 'vi'], ['E4', 4, 'dad, '],
      ['F4', 1, '/can'], ['F4', 1, 'te'], ['F4', 1, 'mos '], ['F4', 1, 'to'], ['F4', 1, 'dos '], ['E4', 1, 'jun'], ['E4', 1, 'tos '], ['E4', 1, 'es'],
      ['G4', 1, 'ta '], ['G4', 1, 'no'], ['F4', 1, 'che '], ['D4', 1, 'de '], ['C4', 4, 'paz.'],
    ],
    chords: [
      [['C3', 'E3', 'G3'], 16], [['F3', 'A3', 'C4'], 4], [['C3', 'E3', 'G3'], 4], [['G3', 'B3', 'D4'], 8],
      [['C3', 'E3', 'G3'], 16], [['F3', 'A3', 'C4'], 4], [['C3', 'E3', 'G3'], 4], [['G3', 'B3', 'D4'], 4], [['C3', 'E3', 'G3'], 4],
    ],
  },
  'A la luz de la luna.mid': {
    title: 'A la luz de la luna (Au clair de la lune)',
    bpm: 96,
    lyrics: false,
    melody: [
      ['C4', 1], ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 2], ['D4', 2],
      ['C4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 4],
      ['C4', 1], ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 2], ['D4', 2],
      ['C4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 4],
      ['D4', 1], ['D4', 1], ['D4', 1], ['D4', 1], ['A3', 2], ['A3', 2],
      ['D4', 1], ['C4', 1], ['B3', 1], ['A3', 1], ['G3', 4],
      ['C4', 1], ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 2], ['D4', 2],
      ['C4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 4],
    ],
    chords: [
      [['C3'], 8], [['G3'], 4], [['C3'], 4],
      [['C3'], 8], [['G3'], 4], [['C3'], 4],
      [['D3'], 8], [['D3'], 4], [['G3'], 4],
      [['C3'], 8], [['G3'], 4], [['C3'], 4],
    ],
  },
  'María tenía un corderito.mid': {
    title: 'María tenía un corderito (Mary had a little lamb)',
    bpm: 110,
    lyrics: false,
    melody: [
      ['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1], ['E4', 2],
      ['D4', 1], ['D4', 1], ['D4', 2], ['E4', 1], ['G4', 1], ['G4', 2],
      ['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1], ['E4', 1], ['E4', 1],
      ['D4', 1], ['D4', 1], ['E4', 1], ['D4', 1], ['C4', 4],
    ],
    chords: [
      [['C3', 'E3', 'G3'], 8], [['G3', 'B3', 'D4'], 4], [['C3', 'E3', 'G3'], 4],
      [['C3', 'E3', 'G3'], 8], [['G3', 'B3', 'D4'], 4], [['C3', 'E3', 'G3'], 4],
    ],
  },
  'Escala de Do (ejercicio).mid': {
    title: 'Escala de Do (ejercicio)',
    bpm: 80,
    lyrics: false,
    melody: [
      ['C4', 1], ['D4', 1], ['E4', 1], ['F4', 1], ['G4', 1], ['A4', 1], ['B4', 1], ['C5', 2], [null, 1],
      ['C5', 1], ['B4', 1], ['A4', 1], ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1], ['C4', 3],
    ],
  },
  'Himno de la alegría.mid': {
    title: 'Himno de la alegría (Beethoven)',
    bpm: 100,
    lyrics: false,
    melody: [
      ['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1], ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
      ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1.5], ['D4', 0.5], ['D4', 2],
      ['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1], ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
      ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['D4', 1.5], ['C4', 0.5], ['C4', 2],
      ['D4', 1], ['D4', 1], ['E4', 1], ['C4', 1], ['D4', 1], ['E4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1],
      ['D4', 1], ['E4', 0.5], ['F4', 0.5], ['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1], ['G3', 2],
      ['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1], ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
      ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['D4', 1.5], ['C4', 0.5], ['C4', 2],
    ],
    chords: [
      [['C3'], 4], [['G3'], 4], [['C3'], 4], [['G3'], 4],
      [['C3'], 4], [['G3'], 4], [['C3'], 2], [['G3'], 2], [['C3'], 4],
      [['G3'], 4], [['C3'], 4], [['G3'], 4], [['G3'], 4],
      [['C3'], 4], [['G3'], 4], [['C3'], 2], [['G3'], 2], [['C3'], 4],
    ],
  },
};

fs.mkdirSync(outDir, { recursive: true });
for (const [file, def] of Object.entries(songs)) {
  fs.writeFileSync(path.join(outDir, file), build(def));
  console.log('✔', file);
}
// Índice para la versión de navegador (en la app de escritorio se lee la carpeta real).
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(Object.keys(songs), null, 2));
