// Punto de entrada de la interfaz.
import './styles.css';
import { audio } from './core/audio.js';
import { settings } from './core/settings.js';
import { registerView, setRoot, navigate, onNavigate } from './router.js';
import { h, toast } from './ui/dom.js';

registerView('home', () => import('./views/home.js'));
registerView('synth', () => import('./views/synth.js'));
registerView('piano', () => import('./views/piano.js'));
registerView('chords', () => import('./views/chords.js'));
registerView('library', () => import('./views/library.js'));
registerView('tutorial-piano', () => import('./views/tutorial-piano.js'));
registerView('tutorial-synth', () => import('./views/tutorial-synth.js'));
registerView('karaoke', () => import('./views/karaoke.js'));
registerView('settings', () => import('./views/settings.js'));

const NAV = [
  ['home', '🏠', 'Inicio'],
  ['synth', '🖐️', 'Sintetizador'],
  ['chords', '🤟', 'Acordes'],
  ['piano', '🎹', 'Piano'],
  ['library', '📚', 'Canciones'],
  ['settings', '⚙️', 'Ajustes'],
];
const SECTION_OF = { 'tutorial-piano': 'library', 'tutorial-synth': 'library', karaoke: 'library' };

export function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === 'claro' ? 'light' : 'dark';
}

export function toggleClassMode(force) {
  const on = force ?? !document.body.classList.contains('clase');
  document.body.classList.toggle('clase', on);
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function buildShell() {
  const navButtons = NAV.map(([view, emoji, label]) =>
    h('button.nav-btn', { 'data-view': view, onclick: () => navigate(view) }, h('span.nav-emoji', emoji), h('span.nav-label', label)),
  );
  const vol = h('input', {
    type: 'range', min: 0, max: 1, step: 0.01, value: settings.masterVolume, title: 'Volumen',
    oninput: () => (settings.masterVolume = Number(vol.value)),
  });
  const main = h('main#app-main');
  const shell = h(
    'div.app',
    h('header.topbar',
      h('div.brand', { onclick: () => navigate('home') }, h('span.brand-logo', '♫'), h('span.brand-name', 'Synth Manos')),
      h('nav.nav', navButtons),
      h('div.topbar-right',
        h('label.volume', '🔊', vol),
        h('button.btn.class-btn', { title: 'Pantalla completa para proyectar en clase', onclick: () => toggleClassMode() }, '📺 Modo clase'),
      ),
    ),
    main,
    h('button.exit-class', { onclick: () => toggleClassMode(false), title: 'Salir del modo clase' }, '✕ Salir de modo clase'),
  );
  document.body.append(shell);
  setRoot(main);
  onNavigate((name) => {
    const section = SECTION_OF[name] || name;
    for (const b of navButtons) b.classList.toggle('active', b.dataset.view === section);
  });
}

// El audio del navegador solo puede arrancar tras un gesto del usuario.
const unlock = () => {
  audio.init().catch((e) => console.error('No se pudo iniciar el audio', e));
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
};
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);

// Arrastrar canciones a cualquier parte de la ventana las añade a la biblioteca.
function setupGlobalDrop() {
  const overlay = h('div.drop-overlay', h('div.drop-overlay-card', h('div.big-emoji', '🎵'), h('h2', 'Suelta aquí para añadir las canciones'), h('p', 'Archivos MIDI (.mid) o karaoke (.kar)')));
  document.body.append(overlay);
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    overlay.classList.add('show');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove('show');
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    const { importFiles } = await import('./core/library.js');
    const { added, rejected } = await importFiles(files);
    if (added.length) toast(`✅ ${added.length === 1 ? 'Canción añadida' : added.length + ' canciones añadidas'}`);
    if (rejected.length) toast(`⚠️ No se pudo añadir: ${rejected.join(', ')} (solo .mid o .kar)`, 4000);
    if (added.length) navigate('library', { select: added[0] });
  });
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('clase');
});

applyTheme();
buildShell();
setupGlobalDrop();
navigate('home');
