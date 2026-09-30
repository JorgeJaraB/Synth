// Ilustración de una mano (SVG) con los dedos levantados que se indiquen.
// Sirve para enseñar los gestos del modo "Acordes con gestos".
// Estilo de dibujo animado: guante blanco con contorno grueso y puño de color.
// La mano se ve como en el espejo de la cámara: palma hacia la pantalla.

let uid = 0;
const rad = (d) => (d * Math.PI) / 180;
const f1 = (n) => Math.round(n * 10) / 10;

/** Dedo: cápsula redondeada desde (bx, by) con el ángulo y la longitud dados. */
function capsule(bx, by, angle, len, w) {
  const dir = { x: Math.sin(rad(angle)), y: -Math.cos(rad(angle)) };
  const perp = { x: -dir.y, y: dir.x };
  const r = w / 2;
  // La base se mete dentro de la palma para que no quede hueco.
  const b = { x: bx - dir.x * 14, y: by - dir.y * 14 };
  const t = { x: bx + dir.x * (len - r), y: by + dir.y * (len - r) };
  const p = (c, s) => `${f1(c.x + perp.x * s * r)} ${f1(c.y + perp.y * s * r)}`;
  return {
    d: `M${p(b, -1)} L${p(t, -1)} A${f1(r)} ${f1(r)} 0 0 1 ${p(t, 1)} L${p(b, 1)} Z`,
    tip: t,
    dir,
    perp,
  };
}

// Dedos de izquierda a derecha (mano izquierda en espejo): meñique … índice.
const FINGERS = {
  e: { bx: 36, by: 66, angle: -14, len: 36, w: 16 },
  a: { bx: 51, by: 60, angle: -5, len: 46, w: 17 },
  m: { bx: 66, by: 58, angle: 3, len: 50, w: 17 },
  i: { bx: 81, by: 61, angle: 11, len: 45, w: 17 },
};

/**
 * @param {string} fingers  dedos levantados: p (pulgar), i (índice), m (corazón), a (anular), e (meñique)
 * @param {object} opts  { side: 'izquierda'|'derecha', tilt: grados, size, cuff: color del puño }
 */
export function handSvg(fingers, { side = 'izquierda', tilt = 0, size = 110, cuff = '#ff9f1c' } = {}) {
  const id = 'hand' + ++uid;
  const up = (f) => fingers.includes(f);
  const shapes = []; // siluetas que forman el guante (se dibujan juntas: un solo contorno)
  const shines = []; // brillos
  const folded = []; // dedos doblados (por delante de la palma)

  for (const [f, g] of Object.entries(FINGERS)) {
    if (up(f)) {
      const c = capsule(g.bx, g.by, g.angle, g.len, g.w);
      shapes.push(c.d);
      // Brillo alargado en el dedo
      const s = { x: c.tip.x - c.dir.x * 6 - c.perp.x * 3, y: c.tip.y - c.dir.y * 6 - c.perp.y * 3 };
      const e = { x: c.tip.x - c.dir.x * 16 - c.perp.x * 3, y: c.tip.y - c.dir.y * 16 - c.perp.y * 3 };
      shines.push(`M${f1(s.x)} ${f1(s.y)} L${f1(e.x)} ${f1(e.y)}`);
    } else {
      // Dedo doblado: como en un puño de dibujos, se ve la punta del dedo recogida
      // por delante de la palma.
      const x = g.bx - g.w / 2 + Math.sin(rad(g.angle)) * 3;
      folded.push(`<rect x="${f1(x - 0.5)}" y="${f1(g.by - 6)}" width="${f1(g.w + 1)}" height="27" rx="8.5"/>`);
    }
  }
  // Pulgar: extendido sale hacia un lado; doblado queda escondido detrás de la palma.
  if (up('p')) {
    const c = capsule(86, 98, 58, 42, 19);
    shapes.push(c.d);
  }

  const palm = 'M27 82 C26 66 35 57 50 56 L84 56 C98 57 102 68 101 84 L98 110 C97 119 90 124 81 124 L45 124 C36 124 30 119 29 110 Z';
  shapes.unshift(palm);
  const cuffPath = 'M35 118 L91 118 C95 118 97 121 97 125 L97 131 C97 135 95 138 91 138 L35 138 C31 138 29 135 29 131 L29 125 C29 121 31 118 35 118 Z';
  const flip = side === 'derecha' ? 'translate(126 0) scale(-1 1)' : '';
  const all = shapes.map((d) => `<path d="${d}"/>`).join('');

  return `<svg class="hand-svg" viewBox="-27 -4 180 148" width="${size}" height="${f1(size * 0.82)}" aria-hidden="true">
  <defs>
    <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6e9f5"/>
    </linearGradient>
  </defs>
  <g transform="${flip}">
    <ellipse cx="63" cy="140" rx="36" ry="4.5" fill="rgba(0,0,0,0.28)"/>
    <g transform="rotate(${tilt} 63 128)" stroke-linejoin="round" stroke-linecap="round">
      <g fill="#fff" stroke="#fff" stroke-width="13" opacity="0.92">${all}${folded.join('')}<path d="${cuffPath}"/></g>
      <g fill="#241f3d" stroke="#241f3d" stroke-width="7">${all}</g>
      <g fill="url(#${id}g)">${all}</g>
      <path d="${shines.join(' ')}" fill="none" stroke="#fff" stroke-width="3.2" opacity="0.95"/>
      <ellipse cx="44" cy="80" rx="7" ry="4" fill="#fff" opacity="0.9" transform="rotate(-25 44 80)"/>
      <g fill="url(#${id}g)" stroke="#241f3d" stroke-width="3.5">${folded.join('')}</g>
      <path d="${cuffPath}" fill="${cuff}" stroke="#241f3d" stroke-width="3.5"/>
      <path d="M36 124 L90 124" stroke="#fff" stroke-width="2.5" opacity="0.55"/>
    </g>
  </g>
</svg>`;
}
