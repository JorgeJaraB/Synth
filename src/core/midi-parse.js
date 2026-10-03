// Lectura de archivos MIDI (.mid) y Karaoke (.kar): notas, pistas y letra.
import tonejsMidi from '@tonejs/midi';
import midiFile from 'midi-file';

const { parseMidi } = midiFile;
const { Midi } = tonejsMidi;

/** Los textos MIDI vienen como bytes: probamos UTF-8 y, si falla, Windows-1252. */
export function decodeMidiText(str) {
  if (!str) return '';
  const bytes = new Uint8Array([...str].map((c) => c.charCodeAt(0) & 0xff));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Marcas "key:G" y "chord:Cm" que guarda la app al importar canciones de acordes. */
function extractMarks(raw, ticksToSeconds) {
  const chordMarks = [];
  let keyMark = null;
  raw.tracks.forEach((track) => {
    let tick = 0;
    for (const ev of track) {
      tick += ev.deltaTime;
      if (ev.type !== 'marker') continue;
      const text = decodeMidiText(ev.text || '').trim();
      if (text.startsWith('key:')) keyMark = text.slice(4);
      else if (text.startsWith('chord:')) chordMarks.push({ time: ticksToSeconds(tick), name: text.slice(6) });
    }
  });
  chordMarks.sort((a, b) => a.time - b.time);
  return { chordMarks, keyMark };
}

/** Mínimo de sílabas para considerar que un archivo trae letra de verdad. */
const MIN_SYLLABLES = 8;

function extractLyrics(raw, ticksToSeconds) {
  const lyricEv = [];
  const textEv = [];
  let title = '';
  // Textos que no son letra: nombres de pistas, título… (muchos MIDI los repiten como texto)
  const noise = new Set();
  const norm = (t) => t.trim().toLowerCase();
  raw.tracks.forEach((track) => {
    for (const ev of track) if (ev.type === 'trackName' && ev.text) noise.add(norm(decodeMidiText(ev.text)));
  });
  raw.tracks.forEach((track) => {
    let tick = 0;
    for (const ev of track) {
      tick += ev.deltaTime;
      if (ev.type !== 'lyrics' && ev.type !== 'text') continue;
      const text = decodeMidiText(ev.text);
      if (ev.type === 'text' && text.startsWith('@')) {
        if (text.startsWith('@T') && !title) title = text.slice(2).trim();
        continue;
      }
      (ev.type === 'lyrics' ? lyricEv : textEv).push({ tick, text });
    }
  });
  // Preferimos los eventos de "letra"; muchos .kar usan eventos de texto.
  let src = lyricEv.filter((e) => e.text.trim()).length >= 4 ? lyricEv : textEv;
  // Descartar textos largos al inicio (créditos) y textos que repiten el título o el nombre
  // de una pista: no son sílabas.
  if (title) noise.add(norm(title));
  src = src.filter((e) => !(e.tick === 0 && e.text.length > 30) && !noise.has(norm(e.text.replace(/^[\\/]/, ''))));
  // Unos pocos textos sueltos (título, autor, "Sequenced by…") no son una letra.
  const syllableCount = src.filter((e) => e.text.replace(/[\r\n\\/]/g, '').trim()).length;
  const distinctTicks = new Set(src.map((e) => e.tick)).size;
  if (syllableCount < MIN_SYLLABLES || distinctTicks < MIN_SYLLABLES) src = [];
  src.sort((a, b) => a.tick - b.tick);

  const lines = [];
  let cur = null;
  let breakNext = true;
  let paraNext = true;
  for (const e of src) {
    let t = e.text.replace(/\r\n/g, '\n');
    let newLine = breakNext;
    let newPara = paraNext;
    breakNext = paraNext = false;
    if (t.startsWith('\\')) {
      newLine = newPara = true;
      t = t.slice(1);
    } else if (t.startsWith('/')) {
      newLine = true;
      t = t.slice(1);
    } else if (/^[\r\n]/.test(t)) {
      newLine = true;
    }
    if (/[\r\n]\s*$/.test(t)) breakNext = true;
    t = t.replace(/[\r\n]/g, '');
    if (!t && !newLine) continue;
    if (newLine || !cur) {
      if (cur && cur.syllables.length) lines.push(cur);
      cur = { syllables: [], paragraph: newPara };
    }
    if (t) cur.syllables.push({ time: ticksToSeconds(e.tick), text: t });
  }
  if (cur && cur.syllables.length) lines.push(cur);
  for (const l of lines) l.start = l.syllables[0].time;
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    l.end = next ? next.start : l.syllables[l.syllables.length - 1].time + 2;
  });
  return { lines, title };
}

function polyphonyRatio(notes) {
  if (notes.length < 2) return 0;
  let overlaps = 0;
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].time < notes[i - 1].time + notes[i - 1].duration - 0.03) overlaps++;
  }
  return overlaps / notes.length;
}

/** Melodía monofónica: si hay acordes, se queda con la nota más aguda de cada ataque. */
export function monophonic(notes) {
  const sorted = [...notes].sort((a, b) => a.time - b.time || b.midi - a.midi);
  const out = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(n.time - last.time) < 0.04) continue; // mismo ataque: ya tenemos la más aguda
    if (last && last.time + last.duration > n.time) last.duration = Math.max(0.05, n.time - last.time);
    out.push({ ...n });
  }
  return out;
}

/**
 * Convierte una melodía en "letra" con los nombres de las notas
 * (para cantar Do-Re-Mi o para canciones sin letra).
 */
export function noteNameLines(notes, nameOf) {
  const lines = [];
  let cur = null;
  notes.forEach((n, i) => {
    const prev = notes[i - 1];
    const gap = prev ? n.time - (prev.time + prev.duration) : 0;
    if (!cur || cur.syllables.length >= 8 || gap > 0.35) {
      cur = { syllables: [], paragraph: !cur || gap > 1, lastEnd: 0 };
      lines.push(cur);
    }
    cur.syllables.push({ time: n.time, text: nameOf(n.midi) + ' ', midi: n.midi });
    cur.lastEnd = n.time + n.duration;
  });
  for (const l of lines) l.start = l.syllables[0].time;
  lines.forEach((l, i) => {
    l.end = lines[i + 1]?.start ?? l.lastEnd + 1;
    delete l.lastEnd;
  });
  return lines;
}

export function guessMelody(tracks, lines) {
  const candidates = tracks.filter((t) => !t.isDrum && t.notes.length);
  if (!candidates.length) return -1;
  const sylTimes = lines.flatMap((l) => l.syllables.map((s) => s.time));
  if (sylTimes.length >= 4) {
    let best = null;
    for (const t of candidates) {
      const onsets = t.notes.map((n) => n.time);
      let hits = 0;
      let j = 0;
      for (const st of sylTimes) {
        while (j < onsets.length && onsets[j] < st - 0.08) j++;
        if (j < onsets.length && Math.abs(onsets[j] - st) <= 0.08) hits++;
      }
      const score = hits / sylTimes.length - polyphonyRatio(t.notes) * 0.3;
      if (!best || score > best.score) best = { t, score };
    }
    if (best.score > 0.4) return best.t.index;
  }
  let best = null;
  for (const t of candidates) {
    const score = t.avgPitch - polyphonyRatio(t.notes) * 25 + Math.min(10, t.notes.length / 20);
    if (!best || score > best.score) best = { t, score };
  }
  return best.t.index;
}

/**
 * Convierte un archivo MIDI/KAR en la estructura que usa la app.
 * @param {ArrayBuffer|Uint8Array} data
 * @param {string} fileName
 */
export function parseSong(data, fileName = 'Canción') {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const midi = new Midi(bytes);
  const raw = parseMidi(bytes);
  const t2s = (tick) => midi.header.ticksToSeconds(tick);
  const { lines, title: karTitle } = extractLyrics(raw, t2s);
  const { chordMarks, keyMark } = extractMarks(raw, t2s);

  const tracks = [];
  midi.tracks.forEach((tr) => {
    if (!tr.notes.length) return;
    // Algunas pistas mezclan canales: las separamos para poder elegir.
    const byChannel = new Map();
    for (const n of tr.notes) {
      const ch = n.channel ?? tr.channel ?? 0;
      if (!byChannel.has(ch)) byChannel.set(ch, []);
      byChannel.get(ch).push({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
    }
    for (const [ch, notes] of byChannel) {
      notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
      const isDrum = ch === 9 || tr.instrument?.percussion === true;
      const name = decodeMidiText(tr.name || '').trim() || (isDrum ? 'Percusión' : tr.instrument?.name || `Pista ${tracks.length + 1}`);
      tracks.push({
        index: tracks.length,
        name: byChannel.size > 1 ? `${name} (canal ${ch + 1})` : name,
        channel: ch,
        isDrum,
        notes,
        avgPitch: notes.reduce((s, n) => s + n.midi, 0) / notes.length,
        minPitch: Math.min(...notes.map((n) => n.midi)),
        maxPitch: Math.max(...notes.map((n) => n.midi)),
      });
    }
  });

  const baseName = fileName.replace(/\.(mid|midi|kar)$/i, '');
  const headerName = decodeMidiText(midi.header.name || '').trim();
  const title = karTitle || baseName || headerName;
  const duration = Math.max(0, ...tracks.flatMap((t) => t.notes.map((n) => n.time + n.duration)), ...lines.map((l) => l.end - 1));
  const bpm = midi.header.tempos[0]?.bpm || 120;
  const ts = midi.header.timeSignatures[0]?.timeSignature || [4, 4];

  // Pulsos para el metrónomo (respetando cambios de tempo).
  const beats = [];
  const ppq = midi.header.ppq;
  const beatTicks = ppq * (4 / ts[1]);
  for (let tick = 0, i = 0; ; tick += beatTicks, i++) {
    const s = t2s(tick);
    if (s > duration + 0.01 || i > 20000) break;
    beats.push({ time: s, accent: i % ts[0] === 0 });
  }

  return {
    title,
    fileName,
    duration,
    bpm: Math.round(bpm),
    timeSignature: ts,
    tracks,
    melodyTrack: guessMelody(tracks, lines),
    lines,
    hasLyrics: lines.length > 0,
    beats,
    chordMarks, // acordes exactos guardados en el archivo (canciones importadas de acordes)
    keyMark,
  };
}
