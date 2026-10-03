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

/**
 * Acorde escrito ("G", "Cm", "F#m7", "Bb", "Dsus4", "C/G", "Lam", "Sol7") →
 * { name, root (0..11), quality: 'mayor'|'menor'|'dim' }, o null si no es un acorde.
 */
export function parseChordName(tok) {
  const m = tok.match(/^(do|re|mi|fa|sol|la|si|[A-G])(#|b|♯|♭)?(maj7|maj|min|m|-|dim|°|o|aug|\+)?(\d{1,2}|sus\d?|add\d{1,2})*(\/(?:do|re|mi|fa|sol|la|si|[A-G])(?:#|b)?)?$/i);
  if (!m) return null;
  const [, n, acc, q] = m;
  // Una sola letra minúscula ("a", "e"…) suele ser una palabra, no un acorde.
  if (n.length === 1 && n !== n.toUpperCase()) return null;
  const base = SOLFEO[n.toLowerCase()] ?? LETTER[n.toLowerCase()];
  const alter = acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0;
  const ql = (q || '').toLowerCase();
  const quality = ql === 'm' || ql === 'min' || ql === '-' ? 'menor' : ql === 'dim' || ql === '°' || ql === 'o' ? 'dim' : 'mayor';
  return { name: tok, root: (base + alter + 12) % 12, quality };
}

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
  const chords = toks.map((t) => ({ ...parseChordName(t.text.replace(/[(),]/g, '')), col: t.col }));
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
    const keyM = line.match(/^\s*(key|tono|tonalidad)\s*:\s*(\S+)/i);
    if (keyM) {
      const c = parseChordName(keyM[2]);
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
        chords.push({ start: t, beats, root: s.chord.root, quality: s.chord.quality, name: s.chord.name });
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

/** Bytes del .kar a partir de la hoja de acordes. */
export function chordSheetToKar(sheet, { title, bpm = 90, beatsPerChord = 4 }) {
  const { chords, words } = layoutChordSheet(sheet, { beatsPerChord });
  const key = sheet.key ?? 0;
  const at = (start) => chords.reduce((c, x) => (x.start <= start + 1e-6 ? x : c), chords[0]);
  // Nota guía de cada palabra: la fundamental del acorde, en la octava central.
  const notes = words.map((w) => {
    const c = at(w.start);
    return { midi: 60 + (c?.root ?? key), start: w.start, beats: Math.max(0.25, w.beats * 0.9) };
  });
  const syllables = words.map((w) => (w.paragraph ? '\\' : w.lineStart ? '/' : '') + w.text + ' ');
  const chordNotes = chords.map((c) => {
    let root = 48 + c.root;
    if (root > 54) root -= 12;
    const third = c.quality === 'mayor' ? 4 : 3;
    const fifth = c.quality === 'dim' ? 6 : 7;
    return { start: c.start, beats: c.beats, notes: [root, root + 12, root + 12 + third, root + 12 + fifth] };
  });
  const marks = [
    { beat: 0, text: 'key:' + NAMES[key] },
    ...chords.map((c) => ({ beat: c.start, text: `chord:${NAMES[c.root]}${c.quality === 'menor' ? 'm' : c.quality === 'dim' ? 'dim' : ''}` })),
  ];
  return buildKar({ title, bpm, beatsPerBar: 4, notes, syllables, chords: chordNotes, marks });
}
