// Tocar con canciones de YouTube (prueba): la canción suena en el reproductor oficial de YouTube
// y los acordes los pone el maestro pegando una hoja de acordes. La app sincroniza los acordes
// con el tiempo del vídeo; el audio del vídeo no se toca ni se analiza.
import { settings } from './settings.js';

const STORE = 'synth-manos-youtube';

/** Enlace (o identificador) de YouTube → identificador del vídeo, o null. */
export function parseVideoId(text) {
  const s = String(text || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}

/**
 * Sincronización a partir de los toques del maestro: cada toque es el momento del vídeo (s) en
 * el que empieza un acorde de la hoja (su pulso). Recta de mínimos cuadrados: vídeo = inicio +
 * pulso × segundos por pulso.
 * @param taps [{ beat, time }]
 * @returns {{ offset: number, bpm: number } | null}
 */
export function fitSync(taps) {
  if (taps.length < 2) return null;
  const n = taps.length;
  const mb = taps.reduce((a, t) => a + t.beat, 0) / n;
  const mt = taps.reduce((a, t) => a + t.time, 0) / n;
  let num = 0;
  let den = 0;
  for (const t of taps) {
    num += (t.beat - mb) * (t.time - mt);
    den += (t.beat - mb) ** 2;
  }
  if (!den) return null;
  const spb = num / den;
  if (!(spb > 60 / 240 && spb < 60 / 30)) return null; // fuera de 30–240 pulsos por minuto
  return { offset: mt - spb * mb, bpm: 60 / spb };
}

/**
 * Reajuste durante la canción: el maestro toca justo cuando cambia el acorde y se mueve el
 * inicio para que el cambio de acorde más cercano caiga ahí (sin cambiar la velocidad).
 * @param songTime  tiempo de la canción (s) en el momento del toque, con la sincronización actual
 * @param changes   tiempos (s) de la canción en los que cambia el acorde
 * @returns segundos que hay que sumar al inicio (offset)
 */
export function nudgeToNearest(songTime, changes, maxShift = 1.5) {
  let best = null;
  for (const c of changes) if (best == null || Math.abs(c - songTime) < Math.abs(best - songTime)) best = c;
  if (best == null || Math.abs(best - songTime) > maxShift) return 0;
  return songTime - best;
}

// ---------- Canciones guardadas (en el propio equipo) ----------
export function listYtSongs() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '[]');
  } catch {
    return [];
  }
}

export function saveYtSong(song) {
  const all = listYtSongs().filter((s) => s.id !== song.id);
  all.unshift({ ...song, updated: Date.now() });
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* sin almacenamiento */
  }
  return song;
}

export function removeYtSong(id) {
  try {
    localStorage.setItem(STORE, JSON.stringify(listYtSongs().filter((s) => s.id !== id)));
  } catch {
    /* sin almacenamiento */
  }
}

// ---------- Buscador (API de datos de YouTube, con la clave de Ajustes) ----------
// La búsqueda la hace la parte de escritorio (la interfaz no puede conectarse a internet):
// solo viaja el texto buscado y vuelven títulos e identificadores.
export async function searchVideos(query) {
  const key = settings.youtubeApiKey?.trim();
  if (!key) throw new Error('sin-clave');
  if (!window.synthAPI?.ytSearch) throw new Error('solo-escritorio');
  const res = await window.synthAPI.ytSearch(String(query).slice(0, 120), key);
  if (res.error) throw new Error(res.error);
  return res.items.map((it) => ({ ...it, thumb: thumbUrl(it.videoId) }));
}

export const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

// ---------- Reproductor oficial, aislado en su marco ----------
// No se carga ningún código de YouTube en la app: el reproductor va en un iframe aparte y se
// le habla con mensajes (el mismo protocolo que usa la librería oficial).
const EMBED = 'https://www.youtube-nocookie.com';

/**
 * Crea el reproductor en `host` y devuelve un reloj para SongPlayer:
 * { time(), videoTime(), play(), pause(), seek(t), playing, setVolume(0..1), destroy(), ready }.
 * El tiempo de la canción es el del vídeo menos `sync.offset`; entre avisos del reproductor se
 * interpola con el reloj del ordenador para que la cinta de acordes se mueva suave.
 */
export function createYtClock(host, videoId, sync) {
  let last = { video: 0, at: performance.now(), playing: false };
  let playing = false;
  let readyDone = false;
  const iframe = document.createElement('iframe');
  const origin = location.origin && location.origin !== 'null' ? location.origin : 'app://synth';
  const q = new URLSearchParams({ enablejsapi: '1', playsinline: '1', rel: '0', controls: '1', disablekb: '1', fs: '0', origin });
  iframe.src = `${EMBED}/embed/${videoId}?${q}`;
  iframe.width = '356';
  iframe.height = '200';
  iframe.allow = 'autoplay; encrypted-media';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  // Sin acceso a la app: no puede abrir ventanas ni navegar fuera de su marco.
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  host.append(iframe);

  const send = (func, args = []) => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }), EMBED);
  const setVideo = (v, isPlaying) => (last = { video: v, at: performance.now(), playing: isPlaying });
  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== EMBED) return;
    let d;
    try {
      d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (d.event === 'onReady' || d.event === 'initialDelivery') {
      if (!readyDone) {
        readyDone = true;
        resolveReady(clock);
      }
    } else if (d.event === 'onError') {
      rejectReady(new Error('video-' + d.info));
    } else if (d.event === 'onStateChange') {
      playing = d.info === 1;
      setVideo(clock.videoTime(), playing);
    }
    if (d.info && typeof d.info === 'object') {
      if (typeof d.info.playerState === 'number') playing = d.info.playerState === 1;
      if (typeof d.info.currentTime === 'number') setVideo(d.info.currentTime, playing);
    }
  };
  window.addEventListener('message', onMessage);
  // Hay que avisar al reproductor de que escuchamos hasta que conteste.
  const hello = setInterval(() => {
    if (readyDone) return clearInterval(hello);
    iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), EMBED);
  }, 250);
  const timeout = setTimeout(() => !readyDone && rejectReady(new Error('sin-conexion')), 15000);

  const clock = {
    sync,
    ready,
    get playing() {
      return playing;
    },
    videoTime() {
      return last.playing ? last.video + (performance.now() - last.at) / 1000 : last.video;
    },
    time() {
      return clock.videoTime() - clock.sync.offset;
    },
    play() {
      send('playVideo');
    },
    pause() {
      send('pauseVideo');
    },
    seek(t) {
      const v = Math.max(0, t + clock.sync.offset);
      send('seekTo', [v, true]);
      setVideo(v, last.playing);
    },
    setVolume(v) {
      send('setVolume', [Math.round(Math.max(0, Math.min(1, v)) * 100)]);
    },
    destroy() {
      clearInterval(hello);
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
  return clock;
}

/** Mensaje claro para los errores del reproductor o del buscador. */
export function ytErrorText(e) {
  const m = String(e?.message || e);
  if (m === 'solo-escritorio') return 'El buscador solo funciona en la app de escritorio. Pega el enlace del vídeo.';
  if (m === 'sin-clave') return 'Para buscar hace falta la clave de la API de YouTube (en Ajustes). Mientras tanto, pega el enlace del vídeo.';
  if (m === 'sin-conexion') return 'No se puede conectar con YouTube. Este modo necesita internet.';
  if (/^busqueda-(400|403)/.test(m)) return 'YouTube no ha aceptado la clave de la API: revísala en Ajustes.';
  if (/^video-(101|150|153)/.test(m)) return 'El dueño de este vídeo no deja verlo fuera de YouTube. Prueba con otro.';
  if (/^video-/.test(m)) return 'No se puede reproducir este vídeo. Prueba con otro.';
  return 'Algo ha fallado con YouTube. Inténtalo de nuevo.';
}
