// Pequeñas utilidades para construir la interfaz sin frameworks.
import { settings } from '../core/settings.js';

/** Crea un elemento: h('div.clase#id', {atributos}, hijos...) */
export function h(tag, attrs = {}, ...children) {
  if (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    }
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Desplegable enlazado a un ajuste. options: [[valor, texto]] */
export function settingSelect(label, key, options, onChange) {
  const sel = h(
    'select',
    { onchange: () => { const raw = sel.value; const v = typeof settings[key] === 'number' ? Number(raw) : raw; settings[key] = v; onChange?.(v); } },
    options.map(([v, t]) => h('option', { value: String(v), selected: String(settings[key]) === String(v) }, t)),
  );
  return h('label.field', h('span.field-label', label), sel);
}

/** Deslizador enlazado a un ajuste. */
export function settingRange(label, key, { min = 0, max = 1, step = 0.01, format = (v) => Math.round(v * 100) + '%' } = {}, onChange) {
  const out = h('span.field-value', format(settings[key]));
  const input = h('input', {
    type: 'range', min, max, step, value: settings[key],
    oninput: () => { const v = Number(input.value); settings[key] = v; out.textContent = format(v); onChange?.(v); },
  });
  return h('label.field', h('span.field-label', label, out), input);
}

/** Interruptor enlazado a un ajuste. */
export function settingToggle(label, key, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!settings[key], onchange: () => { settings[key] = input.checked; onChange?.(input.checked); } });
  return h('label.toggle', input, h('span.toggle-track', h('span.toggle-thumb')), h('span', label));
}

/** Control segmentado (botones excluyentes). */
export function segmented(options, value, onChange) {
  const wrap = h('div.segmented');
  const render = (val) => {
    wrap.replaceChildren(
      ...options.map(([v, t]) => h('button', { class: v === val ? 'active' : '', onclick: () => { render(v); onChange(v); } }, t)),
    );
  };
  render(value);
  wrap.select = render; // marcar otra opción desde el código (sin llamar a onChange)
  return wrap;
}

export function toast(msg, ms = 2600) {
  let stack = document.querySelector('.toast-stack');
  if (!stack) document.body.append((stack = h('div.toast-stack')));
  const t = h('div.toast', msg);
  stack.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, ms);
}

/** Ajusta un canvas al tamaño de su contenedor con la densidad de píxeles correcta. */
export function fitCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const hh = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== hh) {
    canvas.width = w;
    canvas.height = hh;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height, dpr };
}

export function formatTime(s) {
  s = Math.max(0, s);
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

export const INSTRUMENT_OPTIONS = (INSTRUMENTS) => Object.entries(INSTRUMENTS).map(([k, v]) => [k, `${v.emoji} ${v.name}`]);

/** Botón para mostrar/ocultar el panel lateral en pantallas estrechas (tablet en vertical). */
export function panelToggle(panel, label = '⚙️ Opciones') {
  const btn = h('button.btn.panel-toggle', { onclick: () => panel.classList.toggle('open') }, label);
  panel.prepend(h('button.btn.icon.panel-close', { title: 'Cerrar', onclick: () => panel.classList.remove('open') }, '✕'));
  return btn;
}

/** ¿El usuario está escribiendo en un campo de texto? (los atajos de teclado no deben saltar). */
export function isTyping() {
  const el = document.activeElement;
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
}
