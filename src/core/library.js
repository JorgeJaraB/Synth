// Biblioteca de canciones: lee la carpeta de canciones del usuario.
// En la app de escritorio (Electron) se usa la carpeta real de Windows
// (Documentos/Synth Manos/Canciones, con subcarpetas como categorías);
// en el navegador (desarrollo) se usan las canciones de ejemplo.
import { parseSong } from './midi-parse.js';
import { parseMusicXmlFile } from './musicxml.js';
import { moveSongInfo } from './song-info.js';

/** Lee cualquier formato admitido: MIDI/KAR o MusicXML. */
export async function parseAny(bytes, fileName) {
  return SCORE_RE.test(fileName) ? parseMusicXmlFile(bytes, fileName) : parseSong(bytes, fileName);
}

const api = window.synthAPI || null;
export const isDesktop = !!api;
export const SONG_RE = /\.(mid|midi|kar|musicxml|mxl|xml)$/i;
export const SCORE_RE = /\.(musicxml|mxl|xml)$/i; // partituras MusicXML (MuseScore…)
export const EXAMPLES_CATEGORY = 'Ejemplos';

const cache = new Map();
const sessionSongs = new Map(); // canciones arrastradas en modo navegador

/** "Navidad/Villancico.kar" → "Villancico" */
export const displayName = (name) => name.split('/').pop().replace(SONG_RE, '');

/**
 * Lista de canciones: [{ name, category }].
 * name es la ruta relativa dentro de la carpeta (p. ej. "Ejemplos/Estrellita.kar").
 */
export async function listSongs() {
  let list;
  if (api) {
    list = (await api.listSongs()).filter((f) => SONG_RE.test(f.name));
  } else {
    let names = [];
    try {
      names = await (await fetch('./songs/index.json')).json();
    } catch {
      /* sin índice */
    }
    list = [
      ...names.map((n) => ({ name: EXAMPLES_CATEGORY + '/' + n, category: EXAMPLES_CATEGORY })),
      ...[...sessionSongs.keys()].map((name) => ({ name, category: '' })),
    ];
  }
  return list.sort((a, b) => displayName(a.name).localeCompare(displayName(b.name), 'es'));
}

async function readBytes(name) {
  if (sessionSongs.has(name)) return sessionSongs.get(name);
  if (api) return new Uint8Array(await api.readSong(name));
  const file = name.startsWith(EXAMPLES_CATEGORY + '/') ? name.slice(EXAMPLES_CATEGORY.length + 1) : name;
  const res = await fetch('./songs/' + encodeURIComponent(file));
  if (!res.ok) throw new Error('No se pudo leer ' + name);
  return new Uint8Array(await res.arrayBuffer());
}

export async function loadSong(name) {
  if (cache.has(name)) return cache.get(name);
  const song = await parseAny(await readBytes(name), name.split('/').pop());
  cache.set(name, song);
  return song;
}

/**
 * Añade archivos (arrastrados o elegidos) a la biblioteca.
 * Devuelve { added: [rutas], rejected: [nombres] }.
 */
export async function importFiles(files, category = '') {
  const added = [];
  const rejected = [];
  for (const f of files) {
    if (!SONG_RE.test(f.name)) {
      rejected.push(f.name);
      continue;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      await parseAny(bytes, f.name); // validar antes de copiar
    } catch {
      rejected.push(f.name);
      continue;
    }
    let rel;
    if (api) rel = await api.saveSong(f.name, bytes, category);
    else {
      rel = f.name;
      sessionSongs.set(rel, bytes);
    }
    cache.delete(rel);
    added.push(rel);
  }
  return { added, rejected };
}

/** ¿La hizo la app? (los .kar de "Crear canción" llevan una pista llamada "Melodia") */
export const isAppSong = (name, song) => /\.kar$/i.test(name) && (!!song.editSource || song.tracks.some((t) => t.name === 'Melodia'));

/**
 * Guarda una canción hecha en "Crear canción". Si se está editando una (editing = su ruta),
 * se sobrescribe ese mismo archivo y, si ha cambiado el título, se le cambia el nombre.
 * Devuelve la ruta con la que queda.
 */
export async function saveCreatedSong(bytes, title, editing = null) {
  if (!editing || !/\.kar$/i.test(editing)) {
    const { added } = await importFiles([new File([bytes], title + '.kar')]);
    if (!added.length) throw new Error('No se pudo guardar');
    return added[0];
  }
  const slash = editing.lastIndexOf('/');
  const dir = slash >= 0 ? editing.slice(0, slash) : '';
  const base = editing.slice(slash + 1).replace(SONG_RE, '');
  const { added } = await importFiles([new File([bytes], base + '.kar')], dir);
  if (!added.length) throw new Error('No se pudo guardar');
  let rel = added[0];
  if (title && title !== base) {
    try {
      rel = await renameSong(rel, title);
    } catch {
      /* ya hay otra con ese nombre: se queda con el de antes */
    }
  }
  return rel;
}

/** Cambia el nombre de una canción. Devuelve su nueva ruta. */
export async function renameSong(name, newBase) {
  cache.delete(name);
  if (api) {
    const rel = await api.renameSong(name, newBase);
    moveSongInfo(name, rel);
    return rel;
  }
  // Versión web (pruebas): solo las canciones añadidas en esta sesión
  if (!sessionSongs.has(name)) throw new Error('Solo en la app de escritorio');
  const ext = name.match(/\.[^.]+$/)[0];
  const rel = newBase.trim() + ext;
  if (sessionSongs.has(rel)) throw new Error('Ya existe');
  sessionSongs.set(rel, sessionSongs.get(name));
  sessionSongs.delete(name);
  moveSongInfo(name, rel);
  return rel;
}

/** Envía la canción a la papelera de Windows (se puede recuperar). */
export async function removeSong(name) {
  cache.delete(name);
  moveSongInfo(name, null);
  if (api) return api.trashSong(name);
  sessionSongs.delete(name);
}

/** Avisa cuando cambian los archivos de la carpeta (solo escritorio). */
export function onSongsChanged(fn) {
  return api?.onSongsChanged ? api.onSongsChanged(() => {
    cache.clear();
    fn();
  }) : () => {};
}

export function openSongsFolder() {
  return api?.openSongsFolder();
}

export async function songsFolderPath() {
  return api ? api.songsFolder() : null;
}

export function clearCache() {
  cache.clear();
}
