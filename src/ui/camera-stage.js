// Escenario de cámara: dibuja el vídeo (en espejo) en un canvas y convierte
// las coordenadas de las manos a coordenadas de pantalla.
import { tracker, drawHand } from '../core/hands.js';
import { settings } from '../core/settings.js';
import { watchPerf, frameGate } from '../core/perf.js';
import { h, fitCanvas } from './dom.js';

export class CameraStage {
  /**
   * @param {HTMLElement} parent
   * @param {object} opts  { onDraw(ctx, w, h, hands, stage), dim: oscurecer vídeo 0-1, drawHands: bool }
   */
  constructor(parent, opts = {}) {
    this.opts = { dim: 0.25, drawHands: true, ...opts };
    this.canvas = h('canvas.stage-canvas');
    this.status = h('div.stage-status', h('div.spinner'), h('p', 'Encendiendo la cámara…'));
    this.el = h('div.stage', this.canvas, this.status);
    parent.append(this.el);
    this.hands = [];
    this.alive = true;
    this.map = { dx: 0, dy: 0, sw: 1, sh: 1 };
    this.unsub = tracker.onFrame((hands) => (this.hands = hands));
    this._next = 0; // cuándo toca el siguiente dibujo
    watchPerf();
    this._start();
    this._loop();
  }

  async _start() {
    try {
      await tracker.start();
      if (!this.alive) return;
      this.status.remove();
    } catch (e) {
      console.error(e);
      if (!this.alive) return;
      const denied = e?.name === 'NotAllowedError';
      const missing = e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError';
      this.status.replaceChildren(
        h('div.big-emoji', '📷'),
        h('h3', missing ? 'No se encuentra ninguna cámara' : denied ? 'La cámara está bloqueada' : 'No se pudo encender la cámara'),
        h(
          'p',
          denied
            ? 'Revisa en Windows: Configuración → Privacidad y seguridad → Cámara, y permite el acceso a las aplicaciones de escritorio.'
            : missing
              ? 'Conecta una cámara o elige otra en Ajustes.'
              : 'Puede que otra aplicación (Teams, Zoom…) esté usando la cámara. Ciérrala y vuelve a intentarlo.',
        ),
        h('button.btn.primary', { onclick: () => { this.status.replaceChildren(h('div.spinner'), h('p', 'Encendiendo la cámara…')); this._start(); } }, 'Reintentar'),
      );
      this.status.classList.add('error');
    }
  }

  /** Convierte un punto normalizado de la mano a píxeles de pantalla. */
  toScreen(p) {
    const m = this.map;
    return { x: m.dx + p.x * m.sw, y: m.dy + p.y * m.sh };
  }

  _loop() {
    if (!this.alive) return;
    requestAnimationFrame(() => this._loop());
    // La cámara da ~30 imágenes por segundo: no hace falta redibujar a 60–144 Hz.
    // (onDraw/afterDraw de cada pantalla van aquí dentro, así que también se limitan.)
    const next = frameGate(this._next, performance.now());
    if (next == null) return;
    this._next = next;
    const { ctx, w, h: hh } = fitCanvas(this.canvas);
    this.w = w;
    this.h = hh;
    const v = tracker.video;
    ctx.fillStyle = '#0b0c14';
    ctx.fillRect(0, 0, w, hh);
    if (v.videoWidth) {
      const s = Math.max(w / v.videoWidth, hh / v.videoHeight);
      const sw = v.videoWidth * s;
      const sh = v.videoHeight * s;
      const dx = (w - sw) / 2;
      const dy = (hh - sh) / 2;
      this.map = { dx, dy, sw, sh };
      ctx.save();
      if (settings.mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(v, dx, dy, sw, sh);
      ctx.restore();
      if (this.opts.dim > 0) {
        ctx.fillStyle = `rgba(8,9,20,${this.opts.dim})`;
        ctx.fillRect(0, 0, w, hh);
      }
    } else {
      this.map = { dx: 0, dy: 0, sw: w, sh: hh };
    }
    this.opts.onDraw?.(ctx, w, hh, this.hands, this);
    if (this.opts.drawHands) {
      for (const hand of this.hands) {
        const scr = { landmarks: hand.landmarks.map((p) => ({ x: (this.map.dx + p.x * this.map.sw) / w, y: (this.map.dy + p.y * this.map.sh) / hh })) };
        drawHand(ctx, scr, w, hh);
      }
    }
    this.opts.afterDraw?.(ctx, w, hh, this.hands, this);
    if (tracker.failed && !this.failNotice) {
      this.failNotice = h('div.stage-warning', '⚠️ Este equipo no puede detectar las manos (falta aceleración gráfica). Prueba a actualizar el controlador de la tarjeta gráfica. Los modos táctiles funcionan con normalidad.');
      this.el.append(this.failNotice);
    }
  }

  destroy() {
    this.alive = false;
    this.unsub();
    tracker.stop();
    this.el.remove();
  }
}
