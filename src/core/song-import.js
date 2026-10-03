// "Crear canción" → abrir una partitura o un MIDI: convierte la canción al texto del editor
// (notas con su duración, letra en sílabas y un acorde por compás) para poder retocarla.
import { monophonic } from './midi-parse.js';
import { chordTimeline } from './harmony.js';
import { SOLFEGE, LETTERS } from './notes.js';

const STEPS = [0, 2, 4, 5, 7, 9, 11];

/** Duración en pulsos (múltiplo de 1/4) → sufijo del editor: 1 "", 2 "-", 0,5 "/", 2,5 "/--"… */
export function durationSuffix(beats) {
  const q = Math.max(0.25, Math.round(beats * 4) / 4);
  const whole = Math.floor(q);
  const frac = q - whole;
  if (frac === 0) return '-'.repeat(whole - 1);
  const head = frac === 0.5 ? '/' : frac === 0.25 ? '//' : '/.'; // 0,5 · 0,25 · 0,75
  return head + '-'.repeat(whole);
}

/** Nota MIDI → "Sol", "Fa#5", "C3"… (la octava 4 no se escribe). */
export function noteToken(midi, notation = 'solfeo') {
  const names = notation === 'letras' ? LETTERS : SOLFEGE;
  const oct = Math.floor(midi / 12) - 1;
  return names[midi % 12] + (oct === 4 ? '' : oct);
}

/**
 * @param {object} song  resultado de parseSong / parseMusicXmlFile
 * @param {object} opts  { track (índice de la melodía), notation: 'solfeo'|'letras' }
 * @returns {{ title, bpm, beatsPerBar, notesText, lyricsText, chordsText, warnings: string[] }}
 */
export function songToText(song, { track = song.melodyTrack, notation = 'solfeo' } = {}) {
  const warnings = [];
  const bpm = song.bpm || 100;
  const spb = 60 / bpm;
  const beatsPerBar = [2, 3, 4].includes(song.timeSignature?.[0]) ? song.timeSignature[0] : 4;
  const notes = monophonic(song.tracks[track]?.notes || []);
  const q = (sec) => Math.round((sec / spb) * 4) / 4; // a cuartos de pulso
  const tokens = [];
  const sounding = [];
  let t = 0;
  let barPos = 0;
  const push = (tok, beats) => {
    tokens.push(tok);
    barPos += beats;
    // Barras de compás para que se lea mejor
    while (barPos >= beatsPerBar - 1e-6) {
      barPos -= beatsPerBar;
      if (barPos < 1e-6) tokens.push('|');
    }
  };
  notes.forEach((n, i) => {
    const start = q(n.time);
    const next = notes[i + 1] ? q(notes[i + 1].time) : start + Math.max(0.25, q(n.duration));
    if (start > t + 0.01) {
      push('_' + durationSuffix(start - t), start - t);
      t = start;
    }
    let len = Math.min(Math.max(0.25, q(n.duration)), next - start);
    if (len <= 0) return; // dos notas a la vez tras redondear: se queda la primera
    const gap = next - start - len;
    // Huecos muy cortos entre notas: se alarga la nota en vez de poner un silencio
    if (gap > 0 && gap < 0.5) len += gap;
    push(noteToken(n.midi, notation) + durationSuffix(len), len);
    sounding.push({ time: n.time });
    t = start + len;
  });
  // Quitar la barra final
  while (tokens[tokens.length - 1] === '|') tokens.pop();
  // Líneas de unos 4 compases
  const lines = [];
  let cur = [];
  let bars = 0;
  for (const tok of tokens) {
    cur.push(tok);
    if (tok === '|' && ++bars % 4 === 0) {
      lines.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length) lines.push(cur.join(' '));
  const notesText = lines.map((l) => l.replace(/^\| /, '').replace(/ \|$/, '')).join('\n');

  // Letra: cada sílaba con la nota que empieza a la vez
  let lyricsText = '';
  if (song.hasLyrics) {
    const out = [];
    let matched = 0;
    let total = 0;
    for (const line of song.lines) {
      let text = '';
      line.syllables.forEach((s, i) => {
        total++;
        const hit = sounding.some((n) => Math.abs(n.time - s.time) < 0.12);
        if (hit) matched++;
        const syl = s.text.trim().replace(/[-\s]+/g, '_');
        if (!syl) return;
        const endsWord = /\s$/.test(s.text) || i === line.syllables.length - 1;
        text += syl + (endsWord ? ' ' : '-');
      });
      if (line.paragraph && out.length) out.push('');
      out.push(text.trim().replace(/-$/, ''));
    }
    lyricsText = out.join('\n');
    if (total && matched / total < 0.9) warnings.push('La letra no coincide del todo con las notas de la melodía: revísala.');
  }

  // Acordes: el de cada compás
  let chordsText = '';
  const tl = chordTimeline(song, { melodyTrack: track });
  if (tl.chords.length) {
    const names = notation === 'letras' ? LETTERS : SOLFEGE;
    const totalBars = Math.ceil(t / beatsPerBar);
    const out = [];
    for (let b = 0; b < totalBars; b++) {
      const at = b * beatsPerBar * spb + 0.01;
      const c = tl.chords.reduce((acc, x) => (x.time <= at ? x : acc), tl.chords[0]);
      const root = (tl.tonic + STEPS[c.degree - 1]) % 12;
      out.push(names[root] + (c.quality === 'mayor' ? '' : 'm'));
      if (b % 4 === 3) out.push('|');
    }
    chordsText = out.join(' ').replace(/ \|$/, '');
  }
  if (!notes.length) warnings.push('Esa pista no tiene notas: elige otra.');
  return { title: song.title, bpm, beatsPerBar, notesText, lyricsText, chordsText, warnings };
}
