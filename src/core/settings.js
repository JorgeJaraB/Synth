// Ajustes persistentes (se guardan en el propio equipo con localStorage).

const KEY = 'synth-manos-ajustes-v1';

export const DEFAULTS = {
  notation: 'solfeo', // 'solfeo' | 'letras' | 'colores'
  theme: 'oscuro', // 'oscuro' | 'claro'
  masterVolume: 0.8,
  // Sintetizador con cámara
  synthInstrument: 'suave',
  synthScale: 'pentatonica',
  synthTonic: 60, // Do4
  synthLow: 60,
  synthHigh: 84,
  synthPitchMode: 'escala', // 'escala' (notas fijas, como en el vídeo) | 'libre' (continuo, tipo theremin)
  synthTrigger: 'indice', // 'indice' (índice levantado) | 'pinza' (juntar pulgar e índice) | 'siempre'
  synthGlide: true,
  synthXControl: 'brillo', // 'brillo' | 'volumen' | 'nada'
  reverb: 0.35,
  delay: 0.0,
  mirror: true,
  showSkeleton: true,
  cameraId: '',
  // Piano
  pianoInstrument: 'piano',
  pianoLow: 48,
  pianoHigh: 84,
  pianoLabels: true,
  airPianoOctaves: 1, // con la cámara del portátil, teclas grandes funcionan mejor
  airPianoPosition: 'centro', // 'abajo' | 'centro' | 'arriba'
  airPianoStart: 60,
  // Tutoriales y karaoke
  tutorialSpeed: 1.0,
  accompaniment: true,
  accompanimentVolume: 0.6,
  metronome: false,
  lookahead: 3, // segundos de notas visibles cayendo
};

let state = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  state = { ...DEFAULTS, ...saved };
} catch {
  /* sin almacenamiento: usamos los valores por defecto */
}

const listeners = new Set();

export const settings = new Proxy(state, {
  set(target, prop, value) {
    target[prop] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(target));
    } catch {
      /* ignorar */
    }
    for (const fn of listeners) fn(prop, value);
    return true;
  },
});

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetSettings() {
  for (const k of Object.keys(DEFAULTS)) settings[k] = DEFAULTS[k];
}
