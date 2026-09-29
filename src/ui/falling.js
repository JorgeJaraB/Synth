// Notas que caen hacia el teclado (estilo tutorial de piano de YouTube).
import { noteColor, noteName } from '../core/notes.js';
import { settings } from '../core/settings.js';
import { mix } from './keyboard.js';

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

/**
 * @param ctx
 * @param layout  geometría del teclado (keyLayout)
 * @param notes   notas a dibujar {midi,time,duration,state}
 * @param time    tiempo actual de la canción
 * @param area    {top, bottom} zona de caída (bottom = borde superior del teclado)
 */
export function drawFalling(ctx, layout, notes, time, area, opts = {}) {
  const look = opts.lookahead ?? settings.lookahead;
  const H = area.bottom - area.top;
  const pps = H / look; // píxeles por segundo
  const notation = settings.notation;
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x - 2, area.top, layout.width + 4, H);
  ctx.clip();

  // Líneas de pulso
  if (opts.beats) {
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (const b of opts.beats) {
      if (b.time < time - 0.2 || b.time > time + look) continue;
      const y = area.bottom - (b.time - time) * pps;
      ctx.strokeStyle = b.accent ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(layout.x, y);
      ctx.lineTo(layout.x + layout.width, y);
      ctx.stroke();
    }
  }

  for (const n of notes) {
    if (n.time > time + look || n.time + n.duration < time - 0.5) continue;
    const k = layout.keys.get(n.midi);
    if (!k) continue;
    const y2 = area.bottom - (n.time - time) * pps;
    const y1 = area.bottom - (n.time + n.duration - time) * pps;
    const w = k.black ? k.w : k.w * 0.86;
    const x = k.x + (k.w - w) / 2;
    const hgt = Math.max(10, y2 - y1 - 2);
    let col = noteColor(n.midi);
    if (n.state === 'miss') col = '#6b6f80';
    const grad = ctx.createLinearGradient(0, y1, 0, y2);
    grad.addColorStop(0, mix(col.startsWith('#') ? col : '#888888', '#ffffff', 0.25));
    grad.addColorStop(1, col);
    ctx.fillStyle = grad;
    if (n.state === 'hit') {
      ctx.shadowColor = col;
      ctx.shadowBlur = 18;
    }
    rr(ctx, x, y2 - hgt, w, hgt, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (k.black) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (n.state === 'hit') {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Nombre de la nota dentro del rectángulo
    if (hgt > 18 && w > 16 && notation !== 'colores') {
      const fs = Math.min(16, w * 0.45);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = `800 ${fs}px Nunito, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(noteName(n.midi, notation), x + w / 2, y2 - 4);
    }
  }
  ctx.restore();

  // Línea de "ahora"
  const g = ctx.createLinearGradient(0, area.bottom - 16, 0, area.bottom);
  g.addColorStop(0, 'rgba(255,170,40,0)');
  g.addColorStop(1, 'rgba(255,170,40,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(layout.x, area.bottom - 16, layout.width, 16);
}

/** Notas que están sonando ahora (para iluminar teclas). */
export function activeNotes(notes, time) {
  const map = new Map();
  for (const n of notes) {
    if (n.time <= time && n.time + n.duration > time) map.set(n.midi, noteColor(n.midi));
  }
  return map;
}

/** Próximas notas (para marcar las teclas que vienen). */
export function upcomingNotes(notes, time, within = 0.6) {
  const map = new Map();
  for (const n of notes) {
    if (n.state === 'hit') continue;
    if (n.time >= time - 0.05 && n.time <= time + within) map.set(n.midi, noteColor(n.midi));
    if (n.time > time + within) break;
  }
  return map;
}
