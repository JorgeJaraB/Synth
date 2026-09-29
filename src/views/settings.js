// Ajustes generales: cámara, notas, sonido, apariencia.
import { settings, resetSettings } from '../core/settings.js';
import { listCameras, tracker } from '../core/hands.js';
import { isDesktop, songsFolderPath, openSongsFolder } from '../core/library.js';
import { navigate } from '../router.js';
import { h, settingSelect, settingRange, settingToggle, toast } from '../ui/dom.js';
import { CameraStage } from '../ui/camera-stage.js';
import { applyTheme } from '../main.js';

export function mount(root) {
  let stage = null;
  const camSel = h('select', { onchange: () => { settings.cameraId = camSel.value; restartPreview(); } }, h('option', { value: '' }, 'Predeterminada'));
  const previewHost = h('div.camera-preview');
  const previewBtn = h('button.btn', { onclick: () => (stage ? stopPreview() : startPreview()) }, '📷 Probar cámara');

  function startPreview() {
    stage = new CameraStage(previewHost, { dim: 0 });
    previewBtn.textContent = '⏹ Parar prueba';
    setTimeout(fillCameras, 1500);
  }
  function stopPreview() {
    stage?.destroy();
    stage = null;
    previewBtn.textContent = '📷 Probar cámara';
  }
  function restartPreview() {
    if (!stage) return;
    stopPreview();
    startPreview();
  }
  async function fillCameras() {
    const cams = await listCameras();
    camSel.replaceChildren(
      h('option', { value: '' }, 'Predeterminada'),
      ...cams.map((c, i) => h('option', { value: c.deviceId, selected: c.deviceId === settings.cameraId }, c.label || `Cámara ${i + 1}`)),
    );
  }
  fillCameras();

  const folder = h('code', '…');
  songsFolderPath().then((p) => (folder.textContent = p || 'Solo disponible en la app de escritorio'));

  const view = h(
    'div.view.settings-view',
    h('div.settings-grid',
      h('section.card',
        h('h2', '📷 Cámara'),
        h('label.field', h('span.field-label', 'Cámara'), camSel),
        settingToggle('Imagen en espejo (recomendado)', 'mirror'),
        settingToggle('Dibujar las líneas de la mano', 'showSkeleton'),
        h('div.row', previewBtn),
        previewHost,
        h('p.muted', 'Si la cámara no funciona en Windows: Configuración → Privacidad y seguridad → Cámara → permitir a las aplicaciones de escritorio.'),
      ),
      h('section.card',
        h('h2', '🎼 Notas'),
        settingSelect('Nombres de las notas', 'notation', [['solfeo', 'Do, Re, Mi (solfeo)'], ['letras', 'C, D, E (cifrado americano)'], ['colores', 'Solo colores']]),
        h('div.color-legend', ...['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'].map((n, i) => h('span', { style: { background: ['#e53935', '#fb8c00', '#fbc02d', '#43a047', '#1e88e5', '#8e24aa', '#ec407a'][i] } }, n))),
        settingRange('Segundos de notas visibles en tutoriales', 'lookahead', { min: 1.5, max: 6, step: 0.5, format: (v) => v + ' s' }),
      ),
      h('section.card',
        h('h2', '🔊 Sonido'),
        settingRange('Volumen general', 'masterVolume'),
        settingRange('Volumen del acompañamiento', 'accompanimentVolume'),
        settingRange('Eco de sala (reverb)', 'reverb'),
        settingRange('Repetición (delay)', 'delay', { max: 0.7 }),
      ),
      h('section.card',
        h('h2', '🎨 Apariencia'),
        settingSelect('Tema', 'theme', [['oscuro', '🌙 Oscuro'], ['claro', '☀️ Claro']], applyTheme),
        h('h2', '📚 Canciones'),
        h('p', 'Carpeta: ', folder),
        isDesktop ? h('button.btn', { onclick: () => openSongsFolder() }, '📂 Abrir carpeta') : null,
        h('button.btn', { onclick: () => navigate('library') }, 'Ir a canciones'),
        h('hr'),
        h('button.btn.danger', { onclick: () => { if (confirm('¿Volver a los ajustes originales?')) { resetSettings(); applyTheme(); toast('Ajustes restablecidos'); navigate('settings'); } } }, '↺ Restablecer ajustes'),
      ),
      h('section.card.about',
        h('h2', 'ℹ️ Acerca de'),
        h('p', 'Synth Manos funciona sin internet. La detección de manos usa MediaPipe (Google, licencia Apache 2.0).'),
        h('p', 'Piano: muestras "Salamander Grand Piano" de Alexander Holm (licencia CC-BY 3.0).'),
        h('p', 'Canciones de ejemplo: melodías populares de dominio público.'),
      ),
    ),
  );
  root.append(view);
  return () => {
    stopPreview();
    tracker.stop();
    view.remove();
  };
}
