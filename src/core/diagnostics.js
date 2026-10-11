// Informe de problemas: guarda los últimos errores y prepara una incidencia (issue) en GitHub.
import { cameraStatsText, cameraStats } from './stats.js';
import { perfText } from './perf.js';
import { settings } from './settings.js';
import { currentName } from '../router.js';

/** Repositorio donde se crean las incidencias. */
export const REPO = 'JorgeJaraB/Synth';
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

const errors = [];
const MAX = 25;

/** Privacidad: las rutas de archivos (que llevan el nombre de usuario) no se guardan en el informe. */
export function scrubPaths(s) {
  return String(s)
    .replace(/[A-Za-z]:\\[^\n"'<>|]*/g, '<ruta>')
    .replace(/file:\/\/[^\n"'<>)]+/gi, '<ruta>')
    .replace(/\/(?:home|Users)\/[^\n"'<>)]*/g, '<ruta>')
    .replace(/[^\n"'<>]*\.(?:mp4|webm|mkv|mov)\b/gi, '<archivo de vídeo>');
}

function remember(kind, msg) {
  const text = scrubPaths(String(msg?.stack || msg?.message || msg)).slice(0, 400);
  if (errors.length && errors[errors.length - 1].text === text) return;
  errors.push({ time: new Date().toLocaleTimeString('es'), kind, text });
  if (errors.length > MAX) errors.shift();
}

/** Empieza a recoger errores (llamar una vez al arrancar). */
export function installErrorCapture() {
  window.addEventListener('error', (e) => remember('error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => remember('promesa', e.reason));
  const orig = console.error.bind(console);
  console.error = (...args) => {
    remember('console', args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    orig(...args);
  };
}

const VIEW_NAMES = {
  home: 'Inicio', synth: 'Sintetizador', chords: 'Acordes con gestos', piano: 'Piano', library: 'Canciones',
  'tutorial-piano': 'Tutorial de piano', 'tutorial-synth': 'Tutorial con las manos', karaoke: 'Karaoke',
  'karaoke-chords': 'Karaoke de acordes', 'song-editor': 'Crear canción', settings: 'Ajustes',
};

/**
 * Nombre de la tarjeta gráfica (p. ej. "ANGLE (Intel, Intel(R) UHD Graphics 620 …)"), para saber
 * en qué equipos va lento. Solo el modelo: nada personal. Se usa un canvas de usar y tirar.
 */
let gpuName = null;
export function gpuRenderer() {
  if (gpuName != null) return gpuName;
  gpuName = '?';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpuName = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '?').slice(0, 200);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } else gpuName = 'sin WebGL';
  } catch {
    /* sin datos */
  }
  return gpuName;
}

/** Texto del informe en Markdown (lo que se verá en la incidencia). */
export function buildReport(description, { technical = true } = {}) {
  const lines = ['## ¿Qué ha pasado?', description.trim() || '_(sin descripción)_', ''];
  if (technical) {
    const s = settings;
    lines.push(
      '## Datos técnicos',
      `- Versión: ${APP_VERSION}`,
      `- Pantalla: ${VIEW_NAMES[currentName] || currentName || '-'}`,
      `- Fecha: ${new Date().toLocaleString('es')}`,
      `- Sistema: ${navigator.userAgent}`,
      `- App de escritorio: ${window.synthAPI ? 'sí' : 'no (navegador)'}`,
      `- Resolución: ${window.screen.width}×${window.screen.height} · ventana ${window.innerWidth}×${window.innerHeight}`,
      `- Ajustes: notas=${s.notation}, volumen=${s.masterVolume}, sintetizador=${s.synthInstrument}/${s.synthPitchMode}/${s.synthTrigger}, acordes=${s.chordInstrument}${s.chordLefty ? ' (zurdo)' : ''}, piano aire=${s.airPianoOctaves} oct. ${s.airPianoMode === 'extender' ? 'extender ' + s.airPianoPosition : 'pulsar ' + s.airPianoSensitivity}`,
      `- Cámara: ${cameraStatsText()}`,
      `- Detector de manos: ${cameraStats.delegate === 'GPU' ? 'GPU (tarjeta gráfica)' : cameraStats.delegate === 'CPU' ? 'CPU (procesador)' : 'sin cargar todavía'}`,
      `- Tarjeta gráfica: ${gpuRenderer()}`,
      `- Rendimiento: ${perfText()}`,
      '',
      '## Últimos errores',
      errors.length ? '```\n' + errors.map((e) => `[${e.time}] ${e.kind}: ${e.text}`).join('\n') + '\n```' : '_Ninguno registrado._',
    );
  }
  return scrubPaths(lines.join('\n'));
}

/** Enlace para abrir una incidencia nueva ya rellenada. */
export function issueUrl(title, body) {
  // Las URL muy largas fallan: se recorta el informe si hace falta.
  const max = 6000;
  const b = body.length > max ? body.slice(0, max) + '\n…(recortado)' : body;
  return `https://github.com/${REPO}/issues/new?labels=bug&title=${encodeURIComponent(title)}&body=${encodeURIComponent(b)}`;
}
