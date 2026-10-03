// Escucha previa en la biblioteca: elige un trozo reconocible de la canción (el estribillo si
// se encuentra) para saber qué canción es sin abrirla.

export const PREVIEW_SECONDS = 15;

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

/** Segundo de la canción en el que empieza la escucha previa. */
export function previewStart(song) {
  const dur = song.duration || 0;
  if (dur <= PREVIEW_SECONDS + 5) return 0;
  const latest = dur - PREVIEW_SECONDS;
  // Con letra: la línea que más se repite suele ser el estribillo.
  if (song.hasLyrics && song.lines?.length > 2) {
    const count = new Map();
    for (const l of song.lines) {
      const k = norm(l.syllables.map((s) => s.text).join(''));
      if (k.length > 3) count.set(k, (count.get(k) || 0) + 1);
    }
    let best = null;
    for (const [k, n] of count) if (n >= 2 && (!best || n > best.n)) best = { k, n };
    if (best) {
      const line = song.lines.find((l) => norm(l.syllables.map((s) => s.text).join('')) === best.k && l.start > 2);
      if (line) return Math.max(0, Math.min(latest, line.start - 0.4));
    }
  }
  // Sin estribillo claro: un trozo hacia un tercio de la canción, empezando en un pulso fuerte.
  const target = dur * 0.33;
  const beat = (song.beats || []).filter((b) => b.accent).reduce((a, b) => (a == null || Math.abs(b.time - target) < Math.abs(a - target) ? b.time : a), null) ?? target;
  return Math.max(0, Math.min(latest, beat));
}
