// Lectura de partituras MusicXML (.musicxml / .xml / .mxl), el formato que exportan
// MuseScore, Finale, Sibelius… Se convierten a la misma estructura que los MIDI.
import { guessMelody } from './midi-parse.js';

// ---------- XML mínimo (sin dependencias; MusicXML es XML bien formado) ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m,
  );

export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const el = { name: m[3], attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] != null) top.text += decode(m[6]);
  }
  return root;
}

const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el, name) => el?.children.find((c) => c.name === name) || null;
const txt = (el, name) => (kid(el, name)?.text ?? '').trim();
const num = (el, name, def = 0) => {
  const v = parseFloat(txt(el, name));
  return Number.isFinite(v) ? v : def;
};

// ---------- .mxl (MusicXML comprimido en ZIP) ----------
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Buscar el final del directorio central (firma 0x06054b50)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Archivo .mxl dañado');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const nlen = view.getUint16(p + 28, true);
    const elen = view.getUint16(p + 30, true);
    const clen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const lnlen = view.getUint16(local + 26, true);
    const lelen = view.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lelen;
    const data = bytes.subarray(start, start + csize);
    files.set(name, method === 8 ? () => inflateRaw(data) : async () => data);
    p += 46 + nlen + elen + clen;
  }
  return files;
}

async function mxlToXml(bytes) {
  const files = await unzip(bytes);
  let rootPath = null;
  if (files.has('META-INF/container.xml')) {
    const c = parseXml(new TextDecoder().decode(await files.get('META-INF/container.xml')()));
    const find = (el) => (el.name === 'rootfile' ? el : el.children.map(find).find(Boolean));
    rootPath = find(c)?.attrs['full-path'] || null;
  }
  if (!rootPath) rootPath = [...files.keys()].find((n) => !n.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(n));
  if (!rootPath || !files.has(rootPath)) throw new Error('No se encontró la partitura dentro del .mxl');
  return new TextDecoder().decode(await files.get(rootPath)());
}

// ---------- Conversión ----------
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Separa la letra en líneas: tras un signo de puntuación, un silencio largo o demasiadas sílabas. */
function buildLines(sylls) {
  const lines = [];
  let cur = null;
  sylls.forEach((s, i) => {
    const prev = sylls[i - 1];
    const gap = prev ? s.time - prev.end : 0;
    const breakAfterPrev = prev && (/[.,;:!?]\s*$/.test(prev.text) || gap > 0.9 || (cur && cur.syllables.length >= 12 && /\s$/.test(prev.text)));
    if (!cur || breakAfterPrev) {
      cur = { syllables: [], paragraph: !cur || gap > 2 };
      lines.push(cur);
    }
    cur.syllables.push({ time: s.time, text: s.text });
  });
  for (const l of lines) l.start = l.syllables[0].time;
  lines.forEach((l, i) => {
    const lastT = l.syllables[l.syllables.length - 1].time;
    l.end = lines[i + 1]?.start ?? lastT + 2;
  });
  return lines;
}

/**
 * Convierte el texto MusicXML en la estructura de canción de la app.
 */
export function musicXmlToSong(xmlText, fileName = 'Partitura') {
  const doc = parseXml(xmlText);
  const score = doc.children.find((c) => c.name === 'score-partwise');
  if (!score) {
    if (doc.children.some((c) => c.name === 'score-timewise')) throw new Error('Formato MusicXML "timewise" no compatible; exporta en formato normal');
    throw new Error('No es un archivo MusicXML');
  }
  const partNames = new Map(kids(kid(score, 'part-list'), 'score-part').map((sp) => [sp.attrs.id, txt(sp, 'part-name')]));
  const title = txt(kid(score, 'work'), 'work-title') || txt(score, 'movement-title') || fileName.replace(/\.(musicxml|mxl|xml)$/i, '');

  // Tempo: cambios en negras → segundos
  const tempos = [{ q: 0, bpm: 100, set: false }];
  let timeSig = [4, 4];
  const parts = kids(score, 'part');
  const rawParts = [];
  parts.forEach((part) => {
    let divisions = 1;
    let q = 0; // posición en negras
    let lastStart = 0;
    const notes = [];
    const sylls = [];
    const ties = new Map(); // midi → nota abierta por ligadura
    for (const measure of kids(part, 'measure')) {
      for (const el of measure.children) {
        if (el.name === 'attributes') {
          divisions = num(el, 'divisions', divisions) || divisions;
          const t = kid(el, 'time');
          if (t && rawParts.length === 0 && q === 0) timeSig = [num(t, 'beats', 4), num(t, 'beat-type', 4)];
        } else if (el.name === 'direction' || el.name === 'sound') {
          const snd = el.name === 'sound' ? el : kid(el, 'sound');
          let bpm = parseFloat(snd?.attrs.tempo);
          if (!Number.isFinite(bpm)) {
            const met = kids(el, 'direction-type').map((dt) => kid(dt, 'metronome')).find(Boolean);
            const pm = met ? parseFloat(txt(met, 'per-minute')) : NaN;
            if (Number.isFinite(pm)) bpm = txt(met, 'beat-unit') === 'half' ? pm * 2 : txt(met, 'beat-unit') === 'eighth' ? pm / 2 : pm;
          }
          if (Number.isFinite(bpm) && bpm > 10 && rawParts.length === 0) {
            if (q === 0) tempos[0] = { q: 0, bpm, set: true };
            else tempos.push({ q, bpm, set: true });
          }
        } else if (el.name === 'backup') q -= num(el, 'duration') / divisions;
        else if (el.name === 'forward') q += num(el, 'duration') / divisions;
        else if (el.name === 'note') {
          if (kid(el, 'grace') || kid(el, 'cue')) continue;
          const dur = num(el, 'duration') / divisions;
          const isChord = !!kid(el, 'chord');
          const start = isChord ? lastStart : q;
          const pitch = kid(el, 'pitch');
          if (pitch && !kid(el, 'rest')) {
            const midi = (num(pitch, 'octave', 4) + 1) * 12 + STEP[txt(pitch, 'step').toUpperCase()] + Math.round(num(pitch, 'alter', 0));
            const tieTypes = kids(el, 'tie').map((t) => t.attrs.type);
            const open = ties.get(midi);
            if (tieTypes.includes('stop') && open) {
              open.qdur = start + dur - open.q; // se alarga la nota ligada
              if (!tieTypes.includes('start')) ties.delete(midi);
            } else {
              const n = { midi, q: start, qdur: dur, velocity: 0.8 };
              notes.push(n);
              if (tieTypes.includes('start')) ties.set(midi, n);
              const ly = kids(el, 'lyric').find((l) => (l.attrs.number || '1') === '1') || kid(el, 'lyric');
              if (ly && txt(ly, 'text')) {
                const syl = txt(ly, 'syllabic') || 'single';
                const t = kids(ly, 'text').map((x) => x.text).join('');
                sylls.push({ q: start, qend: start + dur, text: t + (syl === 'begin' || syl === 'middle' ? '' : ' ') });
              }
            }
          }
          if (!isChord) {
            lastStart = q;
            q += dur;
          }
        }
      }
    }
    rawParts.push({ id: part.attrs.id, name: partNames.get(part.attrs.id) || 'Parte ' + (rawParts.length + 1), notes, sylls, endQ: q });
  });

  // Negras → segundos teniendo en cuenta los cambios de tempo
  tempos.sort((a, b) => a.q - b.q);
  const qToSec = (qq) => {
    let s = 0;
    for (let i = 0; i < tempos.length; i++) {
      const t0 = tempos[i];
      const t1 = tempos[i + 1];
      const end = t1 ? Math.min(qq, t1.q) : qq;
      if (end > t0.q) s += ((end - t0.q) * 60) / t0.bpm;
      if (!t1 || qq <= t1.q) break;
    }
    return s;
  };

  const tracks = [];
  let lyricPart = null;
  for (const rp of rawParts) {
    if (!rp.notes.length) continue;
    const notes = rp.notes
      .map((n) => ({ midi: n.midi, time: qToSec(n.q), duration: Math.max(0.05, qToSec(n.q + n.qdur) - qToSec(n.q)), velocity: n.velocity }))
      .sort((a, b) => a.time - b.time || a.midi - b.midi);
    const index = tracks.length;
    tracks.push({
      index,
      name: rp.name,
      channel: index,
      isDrum: /percus|drum|bater/i.test(rp.name),
      notes,
      avgPitch: notes.reduce((s, n) => s + n.midi, 0) / notes.length,
      minPitch: Math.min(...notes.map((n) => n.midi)),
      maxPitch: Math.max(...notes.map((n) => n.midi)),
    });
    if (rp.sylls.length && (!lyricPart || rp.sylls.length > lyricPart.sylls.length)) lyricPart = rp;
  }
  if (!tracks.length) throw new Error('La partitura no tiene notas');

  const sylls = (lyricPart?.sylls || []).map((s) => ({ time: qToSec(s.q), end: qToSec(s.qend), text: s.text }));
  const lines = sylls.length ? buildLines(sylls) : [];
  const duration = Math.max(...tracks.flatMap((t) => t.notes.map((n) => n.time + n.duration)));
  const bpm = Math.round(tempos[0].bpm);

  const beats = [];
  const beatQ = 4 / timeSig[1];
  for (let i = 0, qq = 0; ; i++, qq += beatQ) {
    const s = qToSec(qq);
    if (s > duration + 0.01 || i > 20000) break;
    beats.push({ time: s, accent: i % timeSig[0] === 0 });
  }

  return {
    title,
    fileName,
    duration,
    bpm,
    timeSignature: timeSig,
    tracks,
    melodyTrack: guessMelody(tracks, lines),
    lines,
    hasLyrics: lines.length > 0,
    beats,
  };
}

/** Lee un archivo .musicxml / .xml / .mxl (bytes) y devuelve la canción. */
export async function parseMusicXmlFile(bytes, fileName) {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  let text;
  if (isZip) text = await mxlToXml(bytes);
  else {
    text = new TextDecoder('utf-8').decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (text.includes('\u0000')) text = new TextDecoder('utf-16').decode(bytes);
  }
  return musicXmlToSong(text, fileName);
}
