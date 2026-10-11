// Rendimiento: modo ligero para equipos lentos y pausa de la detección con la ventana oculta.
// (Módulo pequeño, sin MediaPipe ni Tone, para poder usarlo desde cualquier sitio.)
import { settings, onSettingsChange } from './settings.js';
import { cameraStats } from './stats.js';

// Umbrales del modo automático. Con histéresis: para encenderlo hace falta ir lento un rato
// seguido y el contador solo se reinicia cuando va claramente bien (no en la zona intermedia).
export const AUTO_LIGHT = {
  slowMs: 40, // el detector tarda más de esto por imagen…
  slowFps: 18, // …o analiza menos imágenes por segundo que esto
  okMs: 30, // va claramente bien por debajo de esto…
  okFps: 22, // …y por encima de esto
  minMsForFps: 20, // pocas img/s con un detector rápido = cámara lenta (poca luz), no el equipo
  holdMs: 4000, // tiempo seguido yendo lento antes de activarlo
  warmupMs: 3000, // al encender la cámara las primeras imágenes son lentas (se ignoran)
};

/**
 * Un paso de la decisión automática (función pura, para los tests).
 * @param st  { on, slowSince }  estado anterior
 * @param s   { detectMs, detectFps, running, since }  datos del detector (since = cuándo empezó)
 * @param now  ms
 * Una vez activado se queda activado toda la sesión (no va y viene).
 */
export function autoLightStep(st, s, now, o = AUTO_LIGHT) {
  if (st.on) return st;
  if (!s.running || !s.since || now - s.since < o.warmupMs || !s.detectFps) return { on: false, slowSince: null };
  const slow = s.detectMs > o.slowMs || (s.detectFps < o.slowFps && s.detectMs > o.minMsForFps);
  const ok = s.detectMs < o.okMs && s.detectFps >= o.okFps;
  let slowSince = st.slowSince;
  if (slow) slowSince ??= now;
  else if (ok) slowSince = null;
  return { on: slowSince != null && now - slowSince >= o.holdMs, slowSince };
}

/**
 * Cuándo toca el siguiente dibujo para ir a ~30 img/s aunque la pantalla vaya a 60–144 Hz.
 * Devuelve el nuevo "next" si hay que dibujar ahora, o null si se salta este fotograma.
 * El margen (tol) evita que en una pantalla de 60 Hz se caiga a 20 img/s por pequeños retrasos.
 */
export function frameGate(next, now, interval = 1000 / 30, tol = 5) {
  if (now < next - tol) return null;
  // Tras un parón no se intenta "recuperar" dibujando varias veces seguidas.
  return Math.max(next + interval, now + interval - tol);
}

export const perf = {
  light: false, // modo ligero activo ahora
  autoOn: false, // lo activó el modo automático (para avisar en Ajustes)
  paused: false, // detección en pausa (ventana oculta y sin grabar)
};

const listeners = new Set();
export function onPerfChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function update() {
  const mode = settings.lightMode;
  const light = mode === 'on' || (mode === 'auto' && auto.on);
  if (light === perf.light && perf.autoOn === auto.on) return;
  perf.light = light;
  perf.autoOn = auto.on;
  for (const fn of listeners) fn(perf);
}

let auto = { on: false, slowSince: null };
let timer = null;

/** Empieza a vigilar el detector (se llama al crear un escenario de cámara; solo una vez). */
export function watchPerf() {
  if (timer) return;
  timer = setInterval(() => {
    if (settings.lightMode !== 'auto' || auto.on) return;
    auto = autoLightStep(auto, cameraStats, performance.now());
    if (auto.on) console.info('Modo ligero activado automáticamente', Math.round(cameraStats.detectMs), 'ms', Math.round(cameraStats.detectFps), 'img/s');
    update();
  }, 1000);
}

onSettingsChange((k) => k === 'lightMode' && update());
update();

// ---------- Ventana oculta ----------
let hidden = false;
let recording = false;
function updatePaused() {
  const p = hidden && !recording; // grabando nunca se pausa (el vídeo saldría sin manos)
  if (p === perf.paused) return;
  perf.paused = p;
  for (const fn of listeners) fn(perf);
}
/** La ventana está minimizada u oculta. */
export function setWindowHidden(v) {
  hidden = !!v;
  updatePaused();
}
/** Se está grabando un vídeo (o guardándolo). */
export function setRecording(v) {
  recording = !!v;
  updatePaused();
}

/** Texto para el informe de problemas. */
export function perfText() {
  const m = { auto: 'automático', on: 'siempre', off: 'nunca' }[settings.lightMode] || settings.lightMode;
  return `modo ligero ${perf.light ? 'activado' : 'desactivado'} (${m}${perf.autoOn ? ', activado por ir lento' : ''})`;
}
