// Barra bajo la mano de los acordes que enseña cuánto hay que inclinarla para mayor o menor.
import { TILT_ENTER } from '../core/chords.js';

const RANGE = 35; // grados que abarca la barra a cada lado

/**
 * @param ctx  contexto del canvas
 * @param x,y  centro de la barra (en píxeles)
 * @param roll  inclinación de la mano en grados (positivo = hacia la derecha de la pantalla)
 * @param onLeft  la mano de los acordes está en la mitad izquierda (hacia dentro = derecha)
 * @param tilt  'dentro' | 'fuera' | 'recta' (zona actual)
 */
export function drawTiltGauge(ctx, x, y, roll, onLeft, tilt) {
  const w = 200;
  const hgt = 26;
  const half = w / 2;
  const edge = (TILT_ENTER / RANGE) * half; // borde de la zona central
  // A la derecha de la pantalla está "dentro" (mayor) si la mano está a la izquierda.
  const right = onLeft ? { label: 'Mayor', zone: 'dentro', col: '#ffb020' } : { label: 'menor', zone: 'fuera', col: '#4aa8ff' };
  const left = onLeft ? { label: 'menor', zone: 'fuera', col: '#4aa8ff' } : { label: 'Mayor', zone: 'dentro', col: '#ffb020' };
  const segs = [
    { x0: -half, x1: -edge, ...left },
    { x0: -edge, x1: edge, label: 'recta', zone: 'recta', col: '#9aa0b8' },
    { x0: edge, x1: half, ...right },
  ];
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(10,11,25,0.65)';
  ctx.beginPath();
  ctx.roundRect(-half - 4, -hgt / 2 - 4, w + 8, hgt + 8, 12);
  ctx.fill();
  ctx.font = '800 13px Nunito, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of segs) {
    const active = s.zone === tilt;
    ctx.globalAlpha = active ? 1 : 0.4;
    ctx.fillStyle = s.col;
    ctx.beginPath();
    ctx.roundRect(s.x0 + 1, -hgt / 2, s.x1 - s.x0 - 2, hgt, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = active ? '#14152b' : '#fff';
    ctx.fillText(s.label, (s.x0 + s.x1) / 2, 1);
  }
  // Aguja: inclinación actual de la mano
  const nx = Math.max(-half, Math.min(half, (roll / RANGE) * half));
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#14152b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(nx, -hgt / 2 - 2);
  ctx.lineTo(nx - 8, -hgt / 2 - 14);
  ctx.lineTo(nx + 8, -hgt / 2 - 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(nx - 1.5, -hgt / 2, 3, hgt);
  ctx.restore();
}
