// Barra bajo la mano de los acordes que enseña cuánto hay que inclinarla para mayor o menor.
import { TILT_ENTER, OCTAVE_ENTER } from '../core/chords.js';

const RANGE = 35; // grados que abarca la barra a cada lado

/**
 * @param ctx  contexto del canvas
 * @param x,y  centro de la barra (en píxeles)
 * @param roll  inclinación de la mano en grados (positivo = hacia la derecha de la pantalla)
 * @param onLeft  la mano de los acordes está en la mitad izquierda (hacia dentro = derecha)
 * @param tilt  'dentro' | 'fuera' | 'recta' (zona actual)
 * @param straight  qué suena con la mano recta: 'mayor' (como Gesture Synth) o 'natural'
 */
export function drawTiltGauge(ctx, x, y, roll, onLeft, tilt, straight = 'mayor') {
  const w = 200;
  const hgt = 26;
  const half = w / 2;
  const edge = (TILT_ENTER / RANGE) * half; // borde de la zona central
  // A la derecha de la pantalla está "dentro" (mayor) si la mano está a la izquierda.
  const right = onLeft ? { label: 'Mayor', zone: 'dentro', col: '#ffb020' } : { label: 'menor', zone: 'fuera', col: '#4aa8ff' };
  const left = onLeft ? { label: 'menor', zone: 'fuera', col: '#4aa8ff' } : { label: 'Mayor', zone: 'dentro', col: '#ffb020' };
  let segs = [
    { x0: -half, x1: -edge, ...left },
    { x0: -edge, x1: edge, label: 'recta', zone: 'recta', col: '#9aa0b8' },
    { x0: edge, x1: half, ...right },
  ];
  // Como Gesture Synth: recta e inclinada hacia dentro suenan igual (mayor), es una sola zona.
  if (straight !== 'natural') {
    segs = onLeft
      ? [{ x0: -half, x1: -edge, ...left }, { x0: -edge, x1: half, label: 'Mayor', zone: ['recta', 'dentro'], col: '#ffb020' }]
      : [{ x0: -half, x1: edge, label: 'Mayor', zone: ['recta', 'dentro'], col: '#ffb020' }, { x0: edge, x1: half, ...right }];
  }
  drawBar(ctx, x, y, w, hgt, segs, tilt, roll / RANGE);
}

/** Barra bajo la mano de expresión: girarla a un lado u otro sube o baja una octava. */
export function drawOctaveGauge(ctx, x, y, roll, octave) {
  const w = 250;
  const half = w / 2;
  const edge = (OCTAVE_ENTER / RANGE) * half;
  const segs = [
    { x0: -half, x1: -edge, label: '−8ª', zone: -1, col: '#4aa8ff' },
    { x0: -edge, x1: edge, label: 'octava', zone: 0, col: '#9aa0b8' },
    { x0: edge, x1: half, label: '+8ª', zone: 1, col: '#ffb020' },
  ];
  drawBar(ctx, x, y, w, 22, segs, octave, roll / RANGE);
}

/** Candado del acorde fijado con el pulgar. */
export function drawLock(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = 'rgba(10,11,25,0.75)';
  ctx.beginPath();
  ctx.arc(x, y, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = '26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔒', x, y + 1);
  ctx.restore();
}

function drawBar(ctx, x, y, w, hgt, segs, active, needle) {
  const half = w / 2;
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
    const on = Array.isArray(s.zone) ? s.zone.includes(active) : s.zone === active;
    ctx.globalAlpha = on ? 1 : 0.4;
    ctx.fillStyle = s.col;
    ctx.beginPath();
    ctx.roundRect(s.x0 + 1, -hgt / 2, s.x1 - s.x0 - 2, hgt, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = on ? '#14152b' : '#fff';
    ctx.fillText(s.label, (s.x0 + s.x1) / 2, 1);
  }
  // Aguja: inclinación actual de la mano
  const nx = Math.max(-half, Math.min(half, needle * half));
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
