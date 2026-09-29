// Ilustración de una mano (SVG) con los dedos levantados que se indiquen.
// Sirve para enseñar los gestos del modo "Acordes con gestos".
// La mano se ve como en el espejo de la cámara: palma hacia la pantalla.

let uid = 0;
const rad = (d) => (d * Math.PI) / 180;
const f1 = (n) => Math.round(n * 10) / 10;

/**
 * Silueta de un dedo: cápsula que se estrecha hacia la punta.
 * @returns {{ path: string, tip: {x,y}, dir: {x,y}, perp: {x,y} }}
 */
function finger(bx, by, angle, len, w0, w1) {
  const dir = { x: Math.sin(rad(angle)), y: -Math.cos(rad(angle)) };
  const perp = { x: -dir.y, y: dir.x };
  // La base se prolonga hacia la palma para que no queden huecos.
  const b = { x: bx - dir.x * 10, y: by - dir.y * 10 };
  const t = { x: bx + dir.x * (len - w1 / 2), y: by + dir.y * (len - w1 / 2) };
  const p = (c, s, w) => `${f1(c.x + perp.x * s * w)} ${f1(c.y + perp.y * s * w)}`;
  const path = `M${p(b, -1, w0 / 2)} L${p(t, -1, w1 / 2)} A${f1(w1 / 2)} ${f1(w1 / 2)} 0 0 1 ${p(t, 1, w1 / 2)} L${p(b, 1, w0 / 2)} Z`;
  return { path, tip: t, dir, perp, base: { x: bx, y: by } };
}

/** Pliegue de una articulación: línea curva cruzando el dedo. */
function crease(fg, at, w) {
  const c = { x: fg.base.x + fg.dir.x * at, y: fg.base.y + fg.dir.y * at };
  const a = { x: c.x - fg.perp.x * w * 0.32, y: c.y - fg.perp.y * w * 0.32 };
  const e = { x: c.x + fg.perp.x * w * 0.32, y: c.y + fg.perp.y * w * 0.32 };
  const m = { x: c.x - fg.dir.x * 1.6, y: c.y - fg.dir.y * 1.6 };
  return `M${f1(a.x)} ${f1(a.y)} Q${f1(m.x)} ${f1(m.y)} ${f1(e.x)} ${f1(e.y)}`;
}

/** Uña cerca de la punta del dedo. */
function nail(fg, w1) {
  const c = { x: fg.tip.x - fg.dir.x * 3, y: fg.tip.y - fg.dir.y * 3 };
  const ang = (Math.atan2(fg.dir.x, -fg.dir.y) * 180) / Math.PI;
  return `<rect x="${f1(c.x - w1 * 0.28)}" y="${f1(c.y - w1 * 0.36)}" width="${f1(w1 * 0.56)}" height="${f1(w1 * 0.72)}" rx="${f1(w1 * 0.26)}" transform="rotate(${f1(ang)} ${f1(c.x)} ${f1(c.y)})"/>`;
}

// Dedos de izquierda a derecha (mano izquierda en espejo): meñique … índice.
const FINGERS = {
  e: { bx: 37, by: 66, angle: -13, len: 38, w0: 13, w1: 11 },
  a: { bx: 50.5, by: 60, angle: -4, len: 48, w0: 14, w1: 12 },
  m: { bx: 64, by: 58, angle: 3, len: 52, w0: 14.5, w1: 12.5 },
  i: { bx: 77.5, by: 61, angle: 10, len: 46, w0: 14, w1: 12 },
};

/**
 * @param {string} fingers  dedos levantados: p (pulgar), i (índice), m (corazón), a (anular), e (meñique)
 * @param {object} opts  { side: 'izquierda'|'derecha', tilt: grados, size }
 */
export function handSvg(fingers, { side = 'izquierda', tilt = 0, size = 110 } = {}) {
  const id = 'hand' + ++uid;
  const up = (f) => fingers.includes(f);
  const back = []; // dedos detrás de la palma
  const front = []; // detalles por delante
  const lines = [];

  for (const [f, g] of Object.entries(FINGERS)) {
    if (up(f)) {
      const fg = finger(g.bx, g.by, g.angle, g.len, g.w0, g.w1);
      back.push(`<path d="${fg.path}" fill="url(#${id}s)"/>`);
      lines.push(crease(fg, g.len * 0.36, g.w0), crease(fg, g.len * 0.66, g.w1));
      front.push(nail(fg, g.w1));
    } else {
      // Dedo doblado: se ve el nudillo asomando por encima de la palma.
      const fg = finger(g.bx, g.by + 2, g.angle * 0.5, 13, g.w0, g.w0 - 1);
      back.push(`<path d="${fg.path}" fill="url(#${id}d)"/>`);
      lines.push(crease(fg, 4, g.w0));
    }
  }

  // Pulgar: extendido sale por detrás de la palma (así no se ve la unión);
  // doblado cruza la palma por delante y se recorta con su contorno.
  let foldedThumb = '';
  if (up('p')) {
    const fg = finger(85, 95, 50, 48, 19, 14);
    back.push(`<path d="${fg.path}" fill="url(#${id}s)"/>`);
    lines.push(crease(fg, 28, 16));
    front.push(nail(fg, 14));
  } else {
    const fg = finger(91, 101, -60, 38, 17, 13.5);
    foldedThumb = `<path d="${fg.path}" fill="url(#${id}d)" clip-path="url(#${id}c)"/>`;
    lines.push(crease(fg, 22, 15));
  }

  const palm =
    'M40 132 C38 118 31 104 29 88 C27 76 29 67 35 62 C48 55 70 53 84 58 C90 61 92 70 92 80 ' +
    'C92 92 86 104 80 116 C78 122 77 128 77 132 Z';
  const palmLines = 'M40 96 C52 90 66 88 80 92 M44 108 C54 102 64 101 74 104';
  const flip = side === 'derecha' ? 'translate(120 0) scale(-1 1)' : '';

  return `<svg class="hand-svg" viewBox="-28 -2 180 148" width="${size}" height="${f1(size * 0.82)}" aria-hidden="true">
  <defs>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe0c4"/><stop offset="1" stop-color="#f6b98f"/>
    </linearGradient>
    <linearGradient id="${id}d" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7c49d"/><stop offset="1" stop-color="#eaa478"/>
    </linearGradient>
    <radialGradient id="${id}p" cx="0.45" cy="0.35" r="0.75">
      <stop offset="0" stop-color="#ffe6cf"/><stop offset="1" stop-color="#f3b085"/>
    </radialGradient>
    <clipPath id="${id}c"><path d="${palm}"/></clipPath>
  </defs>
  <g transform="${flip}">
    <ellipse cx="60" cy="138" rx="30" ry="5" fill="rgba(0,0,0,0.25)"/>
    <g transform="rotate(${tilt} 60 134)" stroke="#b86f47" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
      ${back.join('')}
      <path d="${palm}" fill="url(#${id}p)"/>
      <path d="${palmLines}" fill="none" stroke="#c98561" stroke-width="1.4" opacity="0.7"/>
      ${foldedThumb}
      <path d="${palm}" fill="none"/>
      <g fill="#fff3ea" stroke="#d9987a" stroke-width="1" opacity="0.9">${front.join('')}</g>
      <path d="${lines.join(' ')}" fill="none" stroke="#c98561" stroke-width="1.4" opacity="0.7"/>
    </g>
  </g>
</svg>`;
}
