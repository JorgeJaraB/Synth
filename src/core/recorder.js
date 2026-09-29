// Grabación en vídeo de la ventana de la app (imagen + sonido de la app + micrófono opcional).
// En la app de escritorio se guarda en Documentos/Synth Manos/Grabaciones.
import { audio } from './audio.js';
import { settings } from './settings.js';

const api = window.synthAPI || null;

// MP4 si el sistema lo permite (se abre en cualquier reproductor de Windows); si no, WebM.
const TYPES = [
  ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'mp4'],
  ['video/webm;codecs=vp9,opus', 'webm'],
  ['video/webm;codecs=vp8,opus', 'webm'],
  ['video/webm', 'webm'],
];

export function pickFormat() {
  for (const [mime, ext] of TYPES) if (window.MediaRecorder?.isTypeSupported(mime)) return { mime, ext };
  return { mime: '', ext: 'webm' };
}

class Recorder {
  constructor() {
    this.state = 'idle'; // 'idle' | 'recording' | 'saving'
    this.listeners = new Set();
    this.startedAt = 0;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(extra = {}) {
    for (const fn of this.listeners) fn({ state: this.state, ...extra });
  }

  get elapsed() {
    return this.state === 'recording' ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  async start() {
    if (this.state !== 'idle') return;
    await audio.init();
    // 1) Imagen de la ventana (en la app de escritorio se elige sola).
    this.display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    // 2) Micrófono opcional (para que se oiga cantar en el karaoke).
    this.mic = null;
    if (settings.recordMic) {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      } catch (e) {
        console.warn('Sin micrófono para la grabación', e);
      }
    }
    // 3) Sonido de la app mezclado con el micrófono.
    const audioStream = audio.startRecordingAudio(this.mic);
    const stream = new MediaStream([...this.display.getVideoTracks(), ...audioStream.getAudioTracks()]);
    this.format = pickFormat();
    this.mr = new MediaRecorder(stream, { mimeType: this.format.mime || undefined, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 160_000 });
    this.chunks = [];
    this.pending = Promise.resolve();
    this.fileId = api ? await api.recStart(this.format.ext) : null;
    this.mr.ondataavailable = (e) => {
      if (!e.data.size) return;
      if (api) {
        // Se envía cada trozo al disco en orden, sin guardarlo todo en memoria.
        this.pending = this.pending.then(async () => api.recChunk(this.fileId, new Uint8Array(await e.data.arrayBuffer())));
      } else this.chunks.push(e.data);
    };
    // Si se cierra la captura desde fuera (p. ej. el sistema la corta), se guarda lo grabado.
    this.display.getVideoTracks()[0].addEventListener('ended', () => this.state === 'recording' && this.stop());
    this.mr.start(1000);
    this.startedAt = performance.now();
    this.state = 'recording';
    this._emit();
  }

  /** Para la grabación y la guarda. Devuelve { file } (escritorio) o { url, name } (navegador). */
  async stop() {
    if (this.state !== 'recording') return null;
    this.state = 'saving';
    this._emit();
    const stopped = new Promise((resolve) => (this.mr.onstop = resolve));
    this.mr.stop();
    await stopped;
    this.display.getTracks().forEach((t) => t.stop());
    this.mic?.getTracks().forEach((t) => t.stop());
    audio.stopRecordingAudio();
    let result;
    if (api) {
      await this.pending;
      result = { file: await api.recEnd(this.fileId) };
    } else {
      const blob = new Blob(this.chunks, { type: this.format.mime || 'video/webm' });
      const name = `Synth Manos ${new Date().toLocaleString('es').replace(/[/:]/g, '.')}.${this.format.ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      result = { url, name, size: blob.size };
    }
    this.state = 'idle';
    this._emit({ saved: result });
    return result;
  }

  toggle() {
    return this.state === 'recording' ? this.stop() : this.start();
  }
}

export const recorder = new Recorder();
export const recordingsFolder = () => api?.recordingsFolder();
export const openRecordingsFolder = () => api?.openRecordingsFolder();
export const showRecording = (file) => api?.showRecording(file);
