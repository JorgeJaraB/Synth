// Punto de entrada de la interfaz.
import './styles.css';
import { audio } from './core/audio.js';
import { settings } from './core/settings.js';
import { registerView, setRoot, navigate, onNavigate } from './router.js';
import { h, toast } from './ui/dom.js';
import { installErrorCapture } from './core/diagnostics.js';

installErrorCapture();

registerView('home', () => import('./views/home.js'));
registerView('synth', () => import('./views/synth.js'));
registerView('piano', () => import('./views/piano.js'));
registerView('chords', () => import('./views/chords.js'));
registerView('library', () => import('./views/library.js'));
registerView('tutorial-piano', () => import('./views/tutorial-piano.js'));
registerView('tutorial-synth', () => import('./views/tutorial-synth.js'));
registerView('karaoke', () => import('./views/karaoke.js'));
registerView('karaoke-chords', () => import('./views/karaoke-chords.js'));
registerView('song-editor', () => import('./views/song-editor.js'));
registerView('settings', () => import('./views/settings.js'));

const NAV = [
  ['home', '🏠', 'Inicio'],
  ['synth', '🖐️', 'Sintetizador'],
  ['chords', '🤟', 'Acordes'],
  ['piano', '🎹', 'Piano'],
  ['library', '📚', 'Canciones'],
  ['settings', '⚙️', 'Ajustes'],
];
const SECTION_OF = { 'tutorial-piano': 'library', 'tutorial-synth': 'library', karaoke: 'library', 'karaoke-chords': 'library', 'song-editor': 'library' };

export function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === 'claro' ? 'light' : 'dark';
}

export function toggleClassMode(force) {
  const on = force ?? !document.body.classList.contains('clase');
  document.body.classList.toggle('clase', on);
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

// ---------- Grabación de vídeo ----------
const recButton = h('button.btn.rec-btn', { title: 'Grabar un vídeo de la pantalla con el sonido (F9)', onclick: () => toggleRecording() }, '⏺ Grabar');
const recFloat = h('button.rec-float', { title: 'Parar la grabación (F9)', onclick: () => toggleRecording() });
let recTimer = null;

async function toggleRecording() {
  const { recorder, showRecording } = await import('./core/recorder.js');
  if (recorder.state === 'recording') {
    const res = await recorder.stop();
    if (res?.file) {
      toastAction('🎬 Vídeo guardado en Documentos › Synth Manos › Grabaciones', '📂 Ver vídeo', () => showRecording(res.file));
    } else if (res?.url) toast('🎬 Vídeo descargado: ' + res.name, 4000);
    return;
  }
  if (recorder.state !== 'idle' || document.querySelector('.rec-countdown')) return;
  // Cuenta atrás para que dé tiempo a colocarse.
  const cd = h('div.rec-countdown');
  document.body.append(cd);
  for (const n of [3, 2, 1]) {
    cd.textContent = n;
    cd.classList.remove('pop');
    void cd.offsetWidth;
    cd.classList.add('pop');
    await new Promise((r) => setTimeout(r, 800));
  }
  cd.remove();
  try {
    await recorder.start();
  } catch (e) {
    console.error(e);
    toast('⚠️ No se pudo empezar a grabar' + (e?.name === 'NotAllowedError' ? ' (permiso denegado)' : ''), 4000);
    return;
  }
}

function watchRecorder() {
  import('./core/recorder.js').then(({ recorder }) => {
    recorder.on(({ state }) => {
      const rec = state === 'recording';
      document.body.classList.toggle('recording', rec);
      recButton.classList.toggle('on', rec);
      clearInterval(recTimer);
      const paint = () => {
        const t = Math.floor(recorder.elapsed);
        const label = `⏹ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        recButton.textContent = rec ? label : state === 'saving' ? '💾 Guardando…' : '⏺ Grabar';
        recFloat.textContent = rec ? '● REC ' + label.slice(2) : '';
      };
      paint();
      if (rec) recTimer = setInterval(paint, 500);
    });
  });
}

/** Aviso con un botón de acción. */
function toastAction(msg, label, fn) {
  let stack = document.querySelector('.toast-stack');
  if (!stack) document.body.append((stack = h('div.toast-stack')));
  const t = h('div.toast.show.with-action', h('span', msg), h('button.btn.small', { onclick: () => { fn(); t.remove(); } }, label));
  stack.append(t);
  setTimeout(() => t.remove(), 9000);
}

// ---------- Actualización automática (solo en la app instalada) ----------
const updateBtn = h('button.btn.update-btn', { title: 'Hay una versión nueva: reiniciar para instalarla', onclick: () => window.synthAPI?.installUpdate() }, '✨ Actualizar');
export const updateState = { status: 'idle' };
function watchUpdates() {
  if (!window.synthAPI?.onUpdate) return;
  let announced = null;
  window.synthAPI.onUpdate((info) => {
    Object.assign(updateState, info);
    document.dispatchEvent(new CustomEvent('synth-update', { detail: info }));
    if (info.status === 'downloading' && announced !== info.version) {
      announced = info.version;
      toast(`⬇️ Descargando la versión ${info.version}…`, 3500);
    }
    if (info.status === 'ready') {
      updateBtn.classList.add('show');
      updateBtn.textContent = `✨ Actualizar a ${info.version}`;
      toastAction(`✨ La versión ${info.version} está lista. Se instalará sola al cerrar la app.`, 'Reiniciar ahora', () => window.synthAPI.installUpdate());
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'F9') {
    e.preventDefault();
    toggleRecording();
  }
});

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
        updateBtn,
        h('button.btn.icon.report-btn', { title: 'Reportar un problema', onclick: () => import('./ui/report-dialog.js').then((m) => m.openReportDialog()) }, '🐞'),
        recButton,
        h('button.btn.class-btn', { title: 'Pantalla completa para proyectar en clase', onclick: () => toggleClassMode() }, '📺 Modo clase'),
      ),
    ),
    main,
    h('button.exit-class', { onclick: () => toggleClassMode(false), title: 'Salir del modo clase' }, '✕ Salir de modo clase'),
    recFloat,
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
  const overlay = h('div.drop-overlay', h('div.drop-overlay-card', h('div.big-emoji', '🎵'), h('h2', 'Suelta aquí para añadir las canciones'), h('p', 'MIDI (.mid), karaoke (.kar) o partituras MusicXML (.musicxml, .mxl)')));
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
    if (rejected.length) toast(`⚠️ No se pudo añadir: ${rejected.join(', ')} (solo .mid, .kar, .musicxml o .mxl)`, 4000);
    if (added.length) navigate('library', { select: added[0] });
  });
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('clase');
});

applyTheme();
buildShell();
setupGlobalDrop();
watchRecorder();
watchUpdates();
navigate('home');
