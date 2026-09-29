// Análisis armónico de una canción MIDI: tonalidad y acordes (para el karaoke de acordes).
// Los MIDI no traen los acordes escritos, así que se deducen de las notas.

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const NATURAL = ['mayor', 'menor', 'menor', 'mayor', 'mayor', 'menor', 'dim'];

const pc = (m) => ((m % 12) + 12) % 12;

function correlate(hist, profile, shift) {
  const n = 12;
  const mx = hist.reduce((a, b) => a + b, 0) / n;
  const my = profile.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const x = hist[(i + shift) % n] - mx;
    const y = profile[i] - my;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  return num / Math.sqrt(dx * dy || 1);
}

/**
 * Tonalidad (algoritmo de Krumhansl). Devuelve la tónica MAYOR equivalente (0 = Do):
 * si la canción está en menor se usa su relativo mayor (así La menor = Do mayor, grado vi).
 */
export function detectKey(notes, { finalPc = null, finalBassPc = null } = {}) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[pc(n.midi)] += n.duration;
  // Las canciones casi siempre terminan en la tónica: pequeño empujón a esa tonalidad.
  const bonus = (s) => (s === finalPc ? 0.12 : 0) + (s === finalBassPc ? 0.12 : 0);
  let best = { score: -Infinity, tonic: 0, minor: false };
  for (let s = 0; s < 12; s++) {
    const maj = correlate(hist, MAJOR_PROFILE, s) + bonus(s);
    const min = correlate(hist, MINOR_PROFILE, s) + bonus(s);
    if (maj > best.score) best = { score: maj, tonic: s, minor: false };
    if (min > best.score) best = { score: min, tonic: s, minor: true };
  }
  return { tonic: best.minor ? (best.tonic + 3) % 12 : best.tonic, minor: best.minor, detectedTonic: best.tonic };
}

/** Peso de cada clase de nota dentro de [t0, t1). El bajo pesa más. */
function windowWeights(notes, t0, t1) {
  const w = new Array(12).fill(0);
  let lowest = null;
  for (const n of notes) {
    const a = Math.max(t0, n.time);
    const b = Math.min(t1, n.time + n.duration);
    if (b <= a) continue;
    w[pc(n.midi)] += b - a;
    if (!lowest || n.midi < lowest.midi) lowest = n;
  }
  if (lowest) w[pc(lowest.midi)] += (t1 - t0) * 0.6;
  return w;
}

/** Grado (1..7) cuyo acorde natural encaja mejor con los pesos, o null si no hay notas. */
function bestDegree(w, tonic) {
  const total = w.reduce((a, b) => a + b, 0);
  if (total < 1e-3) return null;
  let best = null;
  for (let d = 1; d <= 7; d++) {
    const root = (tonic + MAJOR_STEPS[d - 1]) % 12;
    const q = NATURAL[d - 1];
    const tones = [root, (root + (q === 'mayor' ? 4 : 3)) % 12, (root + (q === 'dim' ? 6 : 7)) % 12];
    let score = 0;
    for (let i = 0; i < 12; i++) {
      if (i === tones[0]) score += w[i] * 1.3;
      else if (tones.includes(i)) score += w[i];
      else score -= w[i] * 0.6;
    }
    if (d === 7) score -= total * 0.15; // el vii° es raro en canciones infantiles
    if (!best || score > best.score) best = { degree: d, score };
  }
  return best.degree;
}

/**
 * Acordes de la canción: [{ time, duration, degree, quality }].
 * Se analiza pulso a pulso y se fusionan pulsos iguales; los acordes de 1 solo pulso
 * se absorben (los cambios tan rápidos son casi siempre notas de paso).
 * @param {object} song  resultado de parseSong
 * @param {object} opts  { melodyTrack, tonic } (tónica mayor 0..11; si no, se detecta)
 */
export function chordTimeline(song, opts = {}) {
  const melodyIdx = opts.melodyTrack ?? song.melodyTrack;
  const pitched = song.tracks.filter((t) => !t.isDrum);
  const harmony = pitched.filter((t) => t.index !== melodyIdx).flatMap((t) => t.notes);
  const melody = song.tracks[melodyIdx]?.notes || [];
  const all = pitched.flatMap((t) => t.notes);
  const lastOf = (list) => list.reduce((a, n) => (!a || n.time > a.time ? n : a), null);
  const lastMel = lastOf(melody);
  const endT = lastOf(all)?.time ?? 0;
  const finalBass = all.filter((n) => n.time + n.duration >= endT - 0.01).reduce((a, n) => (!a || n.midi < a.midi ? n : a), null);
  const tonic = opts.tonic ?? detectKey(all, { finalPc: lastMel ? pc(lastMel.midi) : null, finalBassPc: finalBass && harmony.length ? pc(finalBass.midi) : null }).tonic;
  const beats = song.beats.map((b) => b.time);
  if (!beats.length) return { tonic, chords: [] };
  const beatLen = beats.length > 1 ? beats[1] - beats[0] : 0.5;
  const perBar = song.timeSignature?.[0] || 4;
  // Sin acompañamiento: se analiza la melodía por compases (más estable).
  const onlyMelody = harmony.length === 0;
  const step = onlyMelody ? perBar : 1;
  const source = onlyMelody ? melody : harmony;

  const labels = [];
  for (let i = 0; i < beats.length; i += step) {
    const t0 = beats[i];
    const t1 = beats[i + step] ?? t0 + beatLen * step;
    const w = windowWeights(source, t0, t1);
    const hasHarmony = w.some((x) => x > 0);
    if (!onlyMelody && hasHarmony) {
      // La melodía ayuda un poco a desempatar.
      const wm = windowWeights(melody, t0, t1);
      for (let k = 0; k < 12; k++) w[k] += wm[k] * 0.35;
    }
    labels.push({ time: t0, end: t1, degree: bestDegree(w, tonic) });
  }

  // Fusionar pulsos consecutivos iguales
  let segs = [];
  for (const l of labels) {
    const last = segs[segs.length - 1];
    if (last && last.degree === l.degree) last.end = l.end;
    else segs.push({ ...l });
  }
  // Absorber acordes de 1 pulso y huecos sin notas en el acorde anterior
  const minLen = beatLen * 1.5;
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && (s.degree == null || s.end - s.time < minLen)) last.end = s.end;
    else if (!last && s.degree == null) continue;
    else if (last && last.degree === s.degree) last.end = s.end;
    else merged.push({ ...s });
  }
  segs = merged;

  const end = song.duration;
  const chords = segs
    .filter((s) => s.degree != null && s.time < end)
    .map((s) => ({ time: s.time, duration: Math.min(s.end, end) - s.time, degree: s.degree, quality: NATURAL[s.degree - 1] }));
  return { tonic, chords };
}
