// Pantalla de inicio: acceso rápido a todos los modos.
import { navigate } from '../router.js';
import { h } from '../ui/dom.js';

const MODES = [
  { view: 'synth', emoji: '🖐️', title: 'Sintetizador con las manos', text: 'Sube y baja la mano delante de la cámara para hacer música.', color: '#ff9f1c' },
  { view: 'piano', emoji: '🎹', title: 'Piano táctil', text: 'Toca las teclas en la pantalla con los dedos.', color: '#2ec4b6' },
  { view: 'piano', params: { mode: 'camara' }, emoji: '✨', title: 'Piano en el aire', text: 'Un piano mágico que aparece en la cámara.', color: '#e71d73' },
  { view: 'library', emoji: '📚', title: 'Canciones y tutoriales', text: 'Aprende canciones paso a paso, con notas que caen.', color: '#7b61ff' },
  { view: 'library', emoji: '🎤', title: 'Karaoke', text: 'Letra gigante con bolita para cantar toda la clase.', color: '#3a86ff' },
];

export function mount(root) {
  const view = h(
    'div.view.home',
    h('div.home-hero',
      h('h1', h('span.logo-notes', '♪♫'), ' Synth Manos'),
      h('p', 'Haz música con las manos, con la pantalla o cantando en clase.'),
    ),
    h('div.mode-grid',
      MODES.map((m) =>
        h('button.mode-card', { style: { '--c': m.color }, onclick: () => navigate(m.view, m.params || {}) },
          h('span.mode-card-emoji', m.emoji),
          h('span.mode-card-title', m.title),
          h('span.mode-card-text', m.text),
        ),
      ),
    ),
    h('p.home-tip', '💡 Con la cámara del portátil: siéntate a un brazo de distancia, con la pantalla un poco inclinada hacia atrás y con luz de frente (sin una ventana detrás). En ', h('b', 'Ajustes'), ' puedes elegir la cámara y cómo se ven las notas.'),
  );
  root.append(view);
  return () => view.remove();
}
