// Datos que el maestro añade a una canción sin tocar el archivo (por ahora, el artista).
// Se guardan en el propio equipo, por nombre de canción.
const KEY = 'synth-manos-info-canciones';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function store(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* sin almacenamiento */
  }
}

/** Artista escrito por el maestro (o undefined si no lo ha cambiado). */
export function artistOverride(name) {
  return load()[name]?.artist;
}

/** Artista que se enseña: el del maestro o, si no, el que trae el archivo. */
export function songArtist(name, song) {
  return artistOverride(name) ?? song?.artist ?? '';
}

export function setArtist(name, artist) {
  const all = load();
  all[name] = { ...all[name], artist: artist.trim() };
  store(all);
}

/** Al cambiar el nombre o quitar una canción, sus datos la siguen (o se borran). */
export function moveSongInfo(from, to) {
  const all = load();
  if (!(from in all)) return;
  if (to) all[to] = all[from];
  delete all[from];
  store(all);
}
