// Ajustes persistentes (se guardan en el propio equipo con localStorage).

const KEY = 'synth-manos-ajustes-v1';

export const DEFAULTS = {
  notation: 'solfeo', // 'solfeo' | 'letras' | 'colores'
  theme: 'oscuro', // 'oscuro' | 'claro'
  masterVolume: 1,
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
  recordMic: false, // grabar también el micrófono (para el karaoke)
  // Acordes con gestos
  chordKey: 0, // tonalidad: 0 = Do, 2 = Re, 7 = Sol...
  chordInstrument: 'limpio', // ver CHORD_WAVES e INSTRUMENTS en audio.js
  chordNeedRight: true, // los acordes se callan al quitar la mano derecha (como en Gesture Synth)
  chordStraight: 'mayor', // mano recta: 'mayor' en todos los grados (como Gesture Synth) | 'natural' (el de la escala)
  chordOctaveTurn: true, // girar la mano derecha sube o baja una octava
  chordThumbLock: false, // experimento: sacar el pulgar derecho fija el acorde (candado)
  chordLefty: false, // zurdo/a: la mano derecha elige el acorde
  chordArpeggio: false,
  chordProgression: 'ninguna',
  chordTutorialDone: false,
  chordTutorialOffered: false, // el tutorial se ofrece solo una vez
  chordHintSeen: false,
  chordLegendChord: true, // tablas de gestos sobre la cámara (abiertas / cerradas)
  chordLegendExpr: true,
  // Piano
  pianoInstrument: 'piano',
  pianoLow: 48,
  pianoHigh: 84,
  pianoLabels: true,
  airPianoOctaves: 1, // con la cámara del portátil, teclas grandes funcionan mejor
  airPianoPosition: 'centro', // 'abajo' | 'centro' | 'arriba'
  airPianoStart: 60,
  airPianoMode: 'pulsar', // 'pulsar' (bajar un dedo, teclado en perspectiva abajo) | 'extender' (extender el dedo)
  airPianoSensitivity: 'normal', // 'alta' | 'normal' | 'baja'
  // Tutoriales y karaoke
  tutorialSpeed: 1.0,
  accompaniment: true,
  showLyrics: true, // letra visible en tutoriales y karaoke de acordes
  accompanimentVolume: 0.6,
  kcOriginalBacking: false, // karaoke de acordes: que suene también el piano original de la canción
  metronome: false,
  lookahead: 3, // segundos de notas visibles cayendo
};

let state = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  state = { ...DEFAULTS, ...saved };
  // v2: el volumen por defecto pasó de 0,8 a 1 (antes se oía demasiado bajo).
  if (!saved._v) {
    if (saved.masterVolume === 0.8) state.masterVolume = 1;
    state._v = 2;
  }
  // v3: los acordes estrenan sonido limpio (el "Synth suave" sonaba desafinado en acordes).
  if ((state._v || 0) < 3) {
    if (state.chordInstrument === 'suave') state.chordInstrument = 'limpio';
    state._v = 3;
  }
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
