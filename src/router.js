// Navegación sencilla entre pantallas.
const views = new Map();
let current = null;
let root = null;
const listeners = new Set();
export let currentName = null;

export function registerView(name, loader) {
  views.set(name, loader);
}

export function setRoot(el) {
  root = el;
}

export function onNavigate(fn) {
  listeners.add(fn);
}

export async function navigate(name, params = {}) {
  const loader = views.get(name);
  if (!loader) return;
  try {
    current?.();
  } catch (e) {
    console.error(e);
  }
  current = null;
  root.replaceChildren();
  currentName = name;
  for (const fn of listeners) fn(name);
  const mod = await loader();
  current = mod.mount(root, params) || null;
}
