// Cámara + detección de manos con MediaPipe (todo local, sin internet).
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { settings } from './settings.js';

export const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const PIP = { thumb: 3, index: 6, middle: 10, ring: 14, pinky: 18 };

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

let landmarkerPromise = null;
let forceCpu = false;

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks('./mediapipe/wasm');
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: './models/hand_landmarker.task', delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      // Sin WebGL2 (equipos sin aceleración gráfica) usamos directamente la CPU.
      if (!forceCpu && hasWebGL2()) {
        try {
          return await HandLandmarker.createFromOptions(fileset, opts('GPU'));
        } catch (e) {
          console.warn('GPU no disponible para MediaPipe, usando CPU', e);
        }
      }
      forceCpu = true;
      return await HandLandmarker.createFromOptions(fileset, opts('CPU'));
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null));
  }
  return landmarkerPromise;
}

/** Si la GPU falla al procesar, se recrea el detector usando la CPU. */
async function fallbackToCpu(old) {
  if (forceCpu) return null;
  forceCpu = true;
  try {
    old?.close();
  } catch {
    /* ignorar */
  }
  landmarkerPromise = null;
  return getLandmarker();
}

export async function listCameras() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

/** Analiza una mano: dedos extendidos, pinza, puño... */
export function analyzeHand(lm) {
  const wrist = lm[0];
  const size = dist(wrist, lm[9]) || 0.1; // muñeca → nudillo del dedo corazón
  const extended = {};
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    extended[f] = dist(wrist, lm[TIP[f]]) > dist(wrist, lm[PIP[f]]) * 1.12;
  }
  // Pulgar fuera: la punta se aleja de la palma y además está separada del índice
  // (si está pegado al lado del índice no cuenta; importante para contar dedos).
  extended.thumb =
    dist(lm[TIP.thumb], lm[17]) > dist(lm[PIP.thumb], lm[17]) * 1.05 && dist(lm[TIP.thumb], lm[5]) / size > 0.5;
  const pinchDist = dist(lm[TIP.thumb], lm[TIP.index]) / size;
  const nExt = ['index', 'middle', 'ring', 'pinky'].filter((f) => extended[f]).length;
  return {
    size,
    extended,
    pinch: pinchDist < 0.38,
    pinchDist,
    fist: nExt === 0 && !extended.thumb,
    indexUp: extended.index,
    openHand: nExt >= 4,
  };
}

export class HandTracker {
  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.running = false;
    this.listeners = new Set();
    this.hands = [];
    this.fps = 0;
    this._smooth = new Map();
    this._errors = 0;
    this._recovering = false;
  }

  onFrame(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start() {
    if (this.running) return;
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        ...(settings.cameraId ? { deviceId: { exact: settings.cameraId } } : { facingMode: 'user' }),
      },
      audio: false,
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (settings.cameraId) {
        // La cámara guardada ya no existe: probamos con la predeterminada.
        settings.cameraId = '';
        delete constraints.video.deviceId;
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } else throw e;
    }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    this.landmarker = await getLandmarker();
    this.running = true;
    this._lastVideoTime = -1;
    this._loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.hands = [];
  }

  _loop() {
    if (!this.running) return;
    this._raf = requestAnimationFrame(() => this._loop());
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this._lastVideoTime) return;
    this._lastVideoTime = v.currentTime;
    const now = performance.now();
    if (this._recovering) return;
    let res;
    try {
      res = this.landmarker.detectForVideo(v, now);
      this._errors = 0;
      this.failed = false;
    } catch (e) {
      console.error(e);
      this._errors++;
      if (this._errors > 60) this.failed = true;
      if (this._errors >= 3 && !forceCpu) {
        this._recovering = true;
        fallbackToCpu(this.landmarker).then((lm) => {
          if (lm) this.landmarker = lm;
          this._recovering = false;
          this._errors = 3;
        });
      }
      return;
    }
    if (this._lastT) this.fps = this.fps * 0.9 + (1000 / (now - this._lastT)) * 0.1;
    this._lastT = now;
    this.hands = this._process(res);
    for (const fn of this.listeners) fn(this.hands);
  }

  _process(res) {
    const out = [];
    const mirror = settings.mirror;
    const seen = new Set();
    (res.landmarks || []).forEach((raw, i) => {
      const label = res.handedness?.[i]?.[0]?.categoryName || 'Mano' + i;
      // Con la imagen en espejo, MediaPipe ya etiqueta como el usuario la ve.
      let key = mirror ? label : label === 'Left' ? 'Right' : 'Left';
      if (seen.has(key)) key += '2';
      seen.add(key);
      const lm = raw.map((p) => ({ x: mirror ? 1 - p.x : p.x, y: p.y, z: p.z }));
      // Suavizado exponencial para evitar temblores.
      const prev = this._smooth.get(key);
      const a = 0.55;
      const sm = prev ? lm.map((p, j) => ({ x: prev[j].x + (p.x - prev[j].x) * a, y: prev[j].y + (p.y - prev[j].y) * a, z: p.z })) : lm;
      this._smooth.set(key, sm);
      out.push({ key, side: key.startsWith('Left') ? 'izquierda' : 'derecha', landmarks: sm, ...analyzeHand(sm) });
    });
    for (const k of [...this._smooth.keys()]) if (!seen.has(k)) this._smooth.delete(k);
    out.sort((a, b) => a.landmarks[0].x - b.landmarks[0].x);
    return out;
  }
}

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** Dibuja el esqueleto de la mano (estilo de puntos del vídeo). */
export function drawHand(ctx, hand, w, h, color = 'rgba(255,255,255,0.9)') {
  const lm = hand.landmarks;
  ctx.save();
  if (settings.showSkeleton) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
    }
    ctx.stroke();
  }
  ctx.fillStyle = color;
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export const tracker = new HandTracker();
