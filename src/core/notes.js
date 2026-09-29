// Utilidades de teoría musical: nombres de notas, colores y escalas.

export const SOLFEGE = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
export const LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Colores tipo "boomwhacker", muy usados en las aulas de primaria.
export const NOTE_COLORS = [
  '#e53935', // Do  rojo
  '#f4511e', // Do#
  '#fb8c00', // Re  naranja
  '#fdd835', // Re#
  '#fbc02d', // Mi  amarillo
  '#43a047', // Fa  verde
  '#00897b', // Fa#
  '#1e88e5', // Sol azul
  '#3949ab', // Sol#
  '#8e24aa', // La  morado
  '#c2185b', // La#
  '#ec407a', // Si  rosa
];

export const SCALES = {
  mayor: { name: 'Mayor', steps: [0, 2, 4, 5, 7, 9, 11] },
  menor: { name: 'Menor natural', steps: [0, 2, 3, 5, 7, 8, 10] },
  pentatonica: { name: 'Pentatónica mayor', steps: [0, 2, 4, 7, 9] },
  pentatonicaMenor: { name: 'Pentatónica menor', steps: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  dorica: { name: 'Dórica', steps: [0, 2, 3, 5, 7, 9, 10] },
  cromatica: { name: 'Cromática', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const pitchClass = (midi) => ((midi % 12) + 12) % 12;
export const octaveOf = (midi) => Math.floor(midi / 12) - 1;
export const isBlack = (midi) => [1, 3, 6, 8, 10].includes(pitchClass(midi));
export const noteColor = (midi) => NOTE_COLORS[pitchClass(midi)];
export const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Nombre de nota según la notación elegida.
 * @param {number} midi
 * @param {'solfeo'|'letras'|'colores'} notation
 * @param {boolean} withOctave
 */
export function noteName(midi, notation = 'solfeo', withOctave = false) {
  const names = notation === 'letras' ? LETTERS : SOLFEGE;
  const n = names[pitchClass(midi)];
  return withOctave ? n + octaveOf(midi) : n;
}

/** Nombre "científico" que entiende Tone.js, p. ej. "C#4". */
export const toneName = (midi) => LETTERS[pitchClass(midi)] + octaveOf(midi);

/** Lista de notas MIDI de una escala entre dos notas (incluidas). */
export function scaleNotes(tonic, scaleKey, low, high) {
  const steps = (SCALES[scaleKey] || SCALES.mayor).steps;
  const out = [];
  for (let m = low; m <= high; m++) if (steps.includes(pitchClass(m - tonic))) out.push(m);
  return out;
}
