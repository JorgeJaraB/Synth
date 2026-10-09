// Canciones copiadas de webs de acordes (acordes encima de la letra), por ejemplo:
//
//   Key: G
//   [Intro] G  B  C  Cm
//   [Verse]
//                         G
//   When you were here before
//                            B
//   Couldn't look you in the eye
//
// Se convierten en un .kar: letra palabra a palabra, acompañamiento con los acordes y marcas
// con cada acorde y la tonalidad (el karaoke de acordes las usa tal cual, sin adivinarlas).
// Como estas hojas no traen la melodía, se añade una nota guía por palabra con el ritmo.
import { buildKar } from './song-text.js';

const SOLFEO = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };
const LETTER = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Lo que puede ir detrás de la nota: calidad, séptimas, extensiones entre paréntesis y bajo.
// Admite las formas de las webs en inglés ("Cmaj7", "Bm7b5") y de Cifra Club ("A7M", "Bm7(b5)", "Gº").
const CHORD_RE = /^(do|re|mi|fa|sol|la|si|[A-G])(#|b|♯|♭)?((?:maj|min|dim|aug|sus|add|m|M|-|°|º|o|ø|Δ|\+|[#b]?\d{1,2}|\((?:[#b+-]?\d{1,2}[,/]?)+\))*)(\/(?:do|re|mi|fa|sol|la|si|[A-G])(?:#|b|♯|♭)?)?$/i;

/**
 * Acorde escrito ("G", "Cm", "F#m7", "Bb", "Dsus4", "C/G", "Lam", "Sol7", "A7M", "Bm7(b5)") →
 * { name, root (0..11), quality: 'mayor'|'menor'|'dim', seventh: null|'7'|'maj7'|'dim7'|'m7b5' },
 * o null si no es un acorde.
 */
export function parseChordName(tok) {
  const m = tok.match(CHORD_RE);
  if (!m) return null;
  const [, n, acc, rest = ''] = m;
  // En minúscula ("a", "la", "mi"…) suele ser una palabra de la letra, no un acorde.
  if (n[0] !== n[0].toUpperCase()) return null;
  const base = SOLFEO[n.toLowerCase()] ?? LETTER[n.toLowerCase()];
  const alter = acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0;
  const r = rest.replace(/\(.*?\)/g, (x) => (/b5|-5/.test(x) ? 'b5' : '')); // (9), (11)… no cambian el acorde
  const lower = r.toLowerCase();
  const halfDim = r.includes('ø') || /^(m|min|-)7?b5/.test(lower);
  const dim = halfDim || /^(dim|°|º|o)/.test(lower);
  // "M" sola o "maj" es mayor; "m", "min" o "-" es menor (¡distingue mayúsculas!)
  const minor = !dim && /^(m(?!aj)|min|-)/.test(r) && !/^M/.test(r);
  const quality = dim ? 'dim' : minor ? 'menor' : 'mayor';
  let seventh = null;
  if (halfDim) seventh = 'm7b5';
  else if (/maj7|maj9|7M|M7|Δ|7\+|^M9/.test(r)) seventh = 'maj7';
  else if (dim && /7/.test(r)) seventh = 'dim7';
  else if (/(^|[^d\d])(7|9|11|13)/.test(r.replace(/add\d+|sus\d?/gi, ''))) seventh = '7';
  return { name: tok, root: (base + alter + 12) % 12, quality, seventh };
}

/** Variante de los gestos que suena como la séptima del acorde (o 'triada'). */
export function voicingForSeventh(quality, seventh) {
  if (!seventh) return 'triada';
  if (quality === 'mayor') return seventh === 'maj7' ? 'septima' : 'dominante';
  if (quality === 'menor') return seventh === '7' ? 'septima' : 'triada';
  return seventh === 'm7b5' ? 'septima' : 'dominante'; // dim: ø7 o °7
}

/** Nombre normalizado para las marcas del archivo: "Am7", "Cmaj7", "Bm7b5", "Bdim7". */
function markName(c) {
  const q = c.quality === 'menor' ? 'm' : c.quality === 'dim' && c.seventh !== 'm7b5' ? 'dim' : '';
  const sev = c.seventh === 'm7b5' ? 'm7b5' : c.seventh === 'dim7' ? '7' : c.seventh || '';
  return NAMES[c.root] + q + sev;
}

/** Semitonos de la séptima sobre la fundamental. */
const SEVENTH_INT = { '7': 10, maj7: 11, dim7: 9, m7b5: 10 };

/** Palabras de una línea con la columna en la que empieza cada una. */
function tokensWithCol(line) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) out.push({ text: m[0], col: m.index });
  return out;
}

/** ¿Es una línea solo de acordes? (admite marcas como "x2" o "|") */
function chordLine(line) {
  const toks = tokensWithCol(line).filter((t) => !/^(\||x\d+|\(x\d+\)|-+)$/i.test(t.text));
  if (!toks.length) return null;
  // "B7(9)" se lee tal cual; si no, se quitan paréntesis y comas sueltos: "(G)", "C,".
  const chords = toks.map((t) => ({ ...(parseChordName(t.text) || parseChordName(t.text.replace(/^\(|[),]+$/g, ''))), col: t.col }));
  return chords.every((c) => c.name) ? chords : null;
}

/**
 * Lee la hoja de acordes.
 * @returns {{ key: number|null, lines: { chords: object[], lyric: string, paragraph: boolean }[], errors: string[] }}
 */
export function parseChordSheet(text) {
  const errors = [];
  let key = null;
  const lines = [];
  let pending = null; // acordes esperando la línea de letra de debajo
  let paragraph = true;
  const flush = () => {
    if (pending) lines.push({ chords: pending, lyric: '', paragraph });
    if (pending) paragraph = false;
    pending = null;
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\t/g, '    ').replace(/\s+$/, '');
    const keyM = line.match(/^\s*(key|tono|tonalidad|tom)\s*:\s*(\S+)/i);
    if (keyM) {
      const c = parseChordName(keyM[2][0].toUpperCase() + keyM[2].slice(1));
      if (c) key = c.quality === 'menor' ? (c.root + 3) % 12 : c.root; // menor → su relativo mayor
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // [Sección] (puede llevar acordes detrás: "[Intro] G B C Cm")
    const sec = line.match(/^\s*\[[^\]]*\]\s*(.*)$/);
    if (sec) {
      flush();
      paragraph = true;
      const rest = sec[1];
      if (rest.trim()) {
        const ch = chordLine(rest);
        if (ch) pending = ch;
      }
      continue;
    }
    const ch = chordLine(line);
    if (ch) {
      flush();
      pending = ch;
      continue;
    }
    // Línea de letra
    lines.push({ chords: pending || [], lyric: line, paragraph });
    pending = null;
    paragraph = false;
  }
  flush();
  if (!lines.some((l) => l.chords.length)) errors.push('No he encontrado acordes. Pon cada acorde encima de la palabra en la que cambia.');
  if (key == null) {
    // Sin "Key:", la tonalidad es la del primer acorde (lo más habitual).
    const first = lines.find((l) => l.chords.length)?.chords[0];
    if (first) key = first.quality === 'menor' ? (first.root + 3) % 12 : first.root;
  }
  return { key, lines, errors };
}

export const keyName = (pc) => NAMES[pc];

/** ¿Se puede tocar el acorde con los gestos? (su fundamental es una nota de la escala) */
export function inKey(root, key) {
  return [0, 2, 4, 5, 7, 9, 11].includes((root - key + 12) % 12);
}

/**
 * Coloca la canción en el tiempo: cada acorde dura `beatsPerChord` pulsos y las palabras
 * se reparten bajo el acorde que tienen encima.
 * @returns {{ chords: {start, beats, root, quality, name}[], words: {start, beats, text, lineStart, paragraph}[], totalBeats }}
 */
export function layoutChordSheet(sheet, { beatsPerChord = 4 } = {}) {
  const chords = [];
  const words = [];
  let t = 0;
  let last = null; // último acorde, para las líneas de letra sin acordes encima
  for (const line of sheet.lines) {
    const toks = tokensWithCol(line.lyric);
    const segs = line.chords.length
      ? line.chords.map((c) => ({ chord: c, col: c.col, words: [] }))
      : [{ chord: last, col: 0, words: [], continued: true }];
    for (const w of toks) {
      // La palabra va con el último acorde que empieza en su columna o antes.
      let i = 0;
      while (i + 1 < segs.length && segs[i + 1].col <= w.col + Math.max(0, w.text.length - 1)) i++;
      segs[i].words.push(w.text);
    }
    let firstWord = true;
    for (const s of segs) {
      // Si un acorde tiene muchas palabras debajo, dura más compases.
      const beats = beatsPerChord * Math.max(1, Math.ceil(s.words.length / Math.max(4, beatsPerChord * 1.5)));
      if (s.chord && !s.continued) {
        chords.push({ start: t, beats, root: s.chord.root, quality: s.chord.quality, seventh: s.chord.seventh || null, name: s.chord.name });
      } else if (s.chord && chords.length) {
        chords[chords.length - 1].beats += beats;
      }
      if (s.chord) last = s.chord;
      s.words.forEach((text, i) => {
        const step = beats / s.words.length;
        words.push({ start: t + i * step, beats: step, text, lineStart: firstWord, paragraph: firstWord && line.paragraph });
        firstWord = false;
      });
      t += beats;
    }
  }
  return { chords, words, totalBeats: t };
}

/** Notas del acompañamiento de un acorde: bajo, octava, tercera, quinta (y séptima si la lleva). */
export function accompanimentNotes(c) {
  let root = 48 + c.root;
  if (root > 54) root -= 12;
  const third = c.quality === 'mayor' ? 4 : 3;
  const fifth = c.quality === 'dim' ? 6 : 7;
  const notes = [root, root + 12, root + 12 + third, root + 12 + fifth];
  if (c.seventh) notes.push(root + 12 + SEVENTH_INT[c.seventh]);
  return notes;
}

/** Bytes del .kar a partir de la hoja de acordes. */
export function chordSheetToKar(sheet, { title, artist = '', bpm = 90, beatsPerChord = 4, source = null }) {
  const { chords, words } = layoutChordSheet(sheet, { beatsPerChord });
  const key = sheet.key ?? 0;
  const at = (start) => chords.reduce((c, x) => (x.start <= start + 1e-6 ? x : c), chords[0]);
  // Nota guía de cada palabra: la fundamental del acorde, en la octava central.
  const notes = words.map((w) => {
    const c = at(w.start);
    return { midi: 60 + (c?.root ?? key), start: w.start, beats: Math.max(0.25, w.beats * 0.9) };
  });
  const syllables = words.map((w) => (w.paragraph ? '\\' : w.lineStart ? '/' : '') + w.text + ' ');
  const chordNotes = chords.map((c) => ({ start: c.start, beats: c.beats, notes: accompanimentNotes(c) }));
  const marks = [
    { beat: 0, text: 'key:' + NAMES[key] },
    ...chords.map((c) => ({ beat: c.start, text: 'chord:' + markName(c) })),
  ];
  return buildKar({ title, artist, bpm, beatsPerBar: 4, notes, syllables, chords: chordNotes, marks, source });
}
