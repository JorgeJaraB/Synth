// "Crear canción": convierte notas y letra escritas a mano en un archivo de karaoke (.kar).
//
// Notas (separadas por espacios; las barras | se ignoran):
//   Do Re Mi … (o C D E …)   una nota de 1 pulso (octava central)
//   Sol-  Sol--               2 y 3 pulsos (cada guion suma un pulso)
//   Do/   Do//                medio pulso y un cuarto de pulso
//   Do.                       con puntillo (1,5 pulsos)
//   Do5  La3                  otra octava (4 = la central)
//   Fa#  Sib                  sostenidos y bemoles
//   _  _-                     silencio de 1 y 2 pulsos
// Letra: sílabas separadas por guiones y palabras por espacios ("Es-tre-lli-ta dón-de es-tás").
//        Cada sílaba va con una nota; cada línea de letra es una línea del karaoke.
//        Dos sílabas en una misma nota se unen con _ ("dón-de_es-tás", "cie-lo_y").
// Acordes (opcional, uno por compás): Do Fa Sol7 Lam Rem … ; "%" repite el anterior.
import midiFile from 'midi-file';

const { writeMidi } = midiFile;

const SOLFEO = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };
const LETRA = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "Sol#5--" → { midi, beats } ; "_-" → { rest, beats } ; null si no se entiende. */
export function parseNoteToken(tok) {
  const m = tok.match(/^(_|x|do|re|mi|fa|sol|la|si|[a-g])(#|b|s)?(\d)?([-/.]*)$/i);
  if (!m) return null;
  const [, name, acc, oct, dur] = m;
  let beats = 1;
  for (const c of dur) {
    if (c === '-') beats += 1;
    else if (c === '/') beats /= 2;
    else if (c === '.') beats *= 1.5;
  }
  const n = name.toLowerCase();
  if (n === '_' || n === 'x') return { rest: true, beats };
  const pc = SOLFEO[n] ?? LETRA[n];
  const alter = acc === '#' || acc === 's' ? 1 : acc === 'b' ? -1 : 0;
  const octave = oct ? Number(oct) : 4;
  return { midi: (octave + 1) * 12 + pc + alter, beats };
}

/** Acorde escrito ("Do", "Lam", "Sol7", "Fa#m", "C", "Am", "G7") → notas MIDI, o null. */
export function parseChordToken(tok) {
  const m = tok.match(/^(do|re|mi|fa|sol|la|si|[a-g])(#|b)?(m|menor|-)?(7)?$/i);
  if (!m) return null;
  const [, name, acc, minor, seventh] = m;
  const n = name.toLowerCase();
  const root = 48 + (SOLFEO[n] ?? LETRA[n]) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
  const third = minor ? 3 : 4;
  const notes = [root - 12, root, root + third, root + 7];
  if (seventh) notes.push(root + (minor ? 10 : 10));
  return notes;
}

/**
 * Analiza el texto escrito por el maestro.
 * @returns {{ notes, syllables, chords, errors: string[], warnings: string[] }}
 */
export function parseSongText({ notesText = '', lyricsText = '', chordsText = '', beatsPerBar = 4 }) {
  const errors = [];
  const warnings = [];
  const notes = [];
  let t = 0;
  for (const tok of notesText.split(/\s+/).filter((x) => x && x !== '|')) {
    const n = parseNoteToken(tok);
    if (!n) {
      errors.push(`No entiendo la nota "${tok}"`);
      continue;
    }
    notes.push({ ...n, start: t });
    t += n.beats;
  }
  const totalBeats = t;

  // Letra → sílabas (con marcas de línea para el karaoke)
  const syllables = [];
  const lines = lyricsText.replace(/\r/g, '').split('\n');
  let paragraphNext = true;
  for (const line of lines) {
    if (!line.trim()) {
      paragraphNext = true;
      continue;
    }
    let first = true;
    for (const word of line.trim().split(/\s+/)) {
      const parts = word.split('-').filter(Boolean);
      parts.forEach((p, i) => {
        const prefix = first ? (paragraphNext ? '\\' : '/') : '';
        syllables.push(prefix + p.replace(/_/g, ' ') + (i === parts.length - 1 ? ' ' : ''));
        first = false;
      });
    }
    paragraphNext = false;
  }
  const sounding = notes.filter((n) => !n.rest).length;
  if (syllables.length && syllables.length !== sounding) {
    warnings.push(`Hay ${sounding} notas y ${syllables.length} sílabas: ${syllables.length > sounding ? 'sobran sílabas' : 'algunas notas no tendrán letra'}.`);
  }

  // Acordes: uno por compás
  const chords = [];
  let prev = null;
  chordsText.split(/\s+/).filter((x) => x && x !== '|').forEach((tok, bar) => {
    const notesC = tok === '%' ? prev : parseChordToken(tok);
    if (!notesC) {
      errors.push(`No entiendo el acorde "${tok}"`);
      return;
    }
    prev = notesC;
    chords.push({ start: bar * beatsPerBar, beats: beatsPerBar, notes: notesC, name: tok === '%' ? chords[chords.length - 1]?.name : tok });
  });
  if (chords.length && chords.length * beatsPerBar < totalBeats - 0.01) {
    warnings.push('Hay menos acordes que compases: el final quedará sin acompañamiento.');
  }
  return { notes, syllables, chords, totalBeats, errors, warnings };
}

/** Genera los bytes de un archivo .kar (MIDI con letra). */
export function buildKar({ title, bpm = 100, beatsPerBar = 4, notes, syllables = [], chords = [], marks = [] }) {
  const TPB = 480;
  const tick = (beats) => Math.round(beats * TPB);
  const toTrack = (evs) => {
    evs.sort((a, b) => a.t - b.t || (a.off === b.off ? 0 : a.off ? -1 : 1));
    let last = 0;
    const out = evs.map(({ t, e }) => {
      const r = { deltaTime: t - last, ...e };
      last = t;
      return r;
    });
    out.push({ deltaTime: 0, meta: true, type: 'endOfTrack' });
    return out;
  };
  // midi-file escribe los textos byte a byte: se codifican en Latin-1 (el estándar de los .kar).
  const latin1 = (s) => [...s].map((c) => (c.charCodeAt(0) < 256 ? c : '?')).join('');
  const noteEvs = (list, channel, vel) =>
    list.flatMap((n) => [
      { t: tick(n.start), e: { type: 'noteOn', channel, noteNumber: n.midi, velocity: vel } },
      { t: tick(n.start + n.beats) - 10, off: true, e: { type: 'noteOff', channel, noteNumber: n.midi, velocity: 0 } },
    ]);
  const melody = notes.filter((n) => !n.rest);
  const tracks = [
    toTrack([
      { t: 0, e: { meta: true, type: 'trackName', text: latin1(title) } },
      { t: 0, e: { meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60000000 / bpm) } },
      { t: 0, e: { meta: true, type: 'timeSignature', numerator: beatsPerBar, denominator: 4, metronome: 24, thirtyseconds: 8 } },
      // Marcas con la tonalidad y los acordes exactos ("key:G", "chord:Cm"), si se conocen.
      ...marks.map((m) => ({ t: tick(m.beat), e: { meta: true, type: 'marker', text: latin1(m.text) } })),
    ]),
    toTrack([{ t: 0, e: { meta: true, type: 'trackName', text: 'Melodia' } }, ...noteEvs(melody, 0, 100)]),
  ];
  if (chords.length) {
    const cn = chords.flatMap((c) => c.notes.map((m) => ({ midi: m, start: c.start, beats: c.beats })));
    tracks.push(toTrack([{ t: 0, e: { meta: true, type: 'trackName', text: 'Acompanamiento' } }, ...noteEvs(cn, 1, 62)]));
  }
  if (syllables.length) {
    const words = [
      { t: 0, e: { meta: true, type: 'text', text: '@KMIDI KARAOKE FILE' } },
      { t: 0, e: { meta: true, type: 'text', text: latin1('@T' + title) } },
    ];
    melody.forEach((n, i) => {
      if (syllables[i]) words.push({ t: tick(n.start), e: { meta: true, type: 'text', text: latin1(syllables[i]) } });
    });
    tracks.push(toTrack(words));
  }
  return new Uint8Array(writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: TPB }, tracks }));
}

export const EXAMPLE_SONG = {
  title: 'Estrellita (hecha a mano)',
  bpm: 100,
  beatsPerBar: 4,
  notesText: 'Do Do Sol Sol | La La Sol- | Fa Fa Mi Mi | Re Re Do-\nSol Sol Fa Fa | Mi Mi Re- | Sol Sol Fa Fa | Mi Mi Re-',
  lyricsText: 'Es-tre-lli-ta, ¿dón-de_es-tás?\nMe pre-gun-to qué se-rás.\n\nEn el cie-lo_y en el mar,\nun dia-man-te de ver-dad.',
  chordsText: 'Do Do Fa Do | Sol Do Sol Do',
};
