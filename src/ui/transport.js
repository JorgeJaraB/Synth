// Barra de reproducción compartida por tutoriales y karaoke.
import { h, formatTime, segmented } from './dom.js';
import { settings } from '../core/settings.js';

export function speedSelect(player) {
  const sel = h(
    'select.compact',
    {
      title: 'Velocidad',
      onchange: () => {
        settings.tutorialSpeed = Number(sel.value);
        player().speed = settings.tutorialSpeed;
      },
    },
    [0.5, 0.6, 0.75, 0.9, 1, 1.25].map((v) => h('option', { value: v, selected: v === settings.tutorialSpeed }, `${v < 1 ? '🐢' : v > 1 ? '🐇' : '▶️'} ${Math.round(v * 100)}%`)),
  );
  return sel;
}

export function toggleButton(label, key, onChange) {
  const b = h('button.btn.toggle-btn', { class: settings[key] ? 'on' : '', onclick: () => { settings[key] = !settings[key]; b.classList.toggle('on', settings[key]); onChange?.(settings[key]); } }, label);
  return b;
}

export class Transport {
  constructor(getPlayer, { onRestart, extras = [] } = {}) {
    this.getPlayer = getPlayer;
    this.playBtn = h('button.btn.primary.round', { title: 'Reproducir / pausa (barra espaciadora)', onclick: () => this.toggle() }, '▶');
    this.restartBtn = h('button.btn.round', { title: 'Empezar de nuevo', onclick: () => { this.getPlayer().restart(); onRestart?.(); } }, '⏮');
    this.fill = h('div.progress-fill');
    this.bar = h('div.progress', this.fill);
    this.timeLabel = h('span.time-label', '0:00');
    this.el = h('div.transport', this.restartBtn, this.playBtn, this.bar, this.timeLabel, extras.length ? h('div.transport-extras', extras) : null);
    const seek = (e) => {
      const r = this.bar.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      this.getPlayer().seek(p * this.getPlayer().duration);
    };
    let dragging = false;
    this.bar.addEventListener('pointerdown', (e) => { dragging = true; this.bar.setPointerCapture(e.pointerId); seek(e); });
    this.bar.addEventListener('pointermove', (e) => dragging && seek(e));
    this.bar.addEventListener('pointerup', () => (dragging = false));
    this._key = (e) => {
      if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener('keydown', this._key);
  }

  toggle() {
    this.getPlayer().toggle();
  }

  update() {
    const p = this.getPlayer();
    this.playBtn.textContent = p.playing ? '⏸' : '▶';
    this.fill.style.width = (Math.max(0, p.time) / Math.max(1, p.duration)) * 100 + '%';
    this.timeLabel.textContent = `${formatTime(p.time)} / ${formatTime(p.duration)}`;
  }

  destroy() {
    window.removeEventListener('keydown', this._key);
  }
}

export function modeSelector(value, onChange) {
  return segmented(
    [
      ['escuchar', '👂 Escuchar'],
      ['esperar', '⏳ Practicar'],
      ['tiempo', '⭐ Reto'],
    ],
    value,
    onChange,
  );
}

export function scoreBox() {
  const el = h('div.score-box');
  return {
    el,
    update(player) {
      if (player.mode !== 'tiempo') {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const s = player.score;
      el.replaceChildren(
        h('span.score-points', s.points.toLocaleString('es')),
        h('span.score-streak', s.streak >= 3 ? `🔥 ${s.streak}` : ''),
      );
    },
  };
}

/** Pantalla de resultado al acabar la canción. */
export function resultOverlay(parent, player, { onReplay, onBack }) {
  const s = player.score;
  const total = player.practice.length || 1;
  const ratio = s.hits / total;
  const stars = player.mode === 'tiempo' ? (ratio > 0.9 ? 3 : ratio > 0.65 ? 2 : ratio > 0.3 ? 1 : 0) : 3;
  const msg = stars === 3 ? '¡Fantástico!' : stars === 2 ? '¡Muy bien!' : stars === 1 ? '¡Buen intento!' : '¡Sigue practicando!';
  const ov = h(
    'div.result-overlay',
    h('div.result-card',
      h('div.stars', [0, 1, 2].map((i) => h('span', { class: i < stars ? 'star on' : 'star' }, '★'))),
      h('h2', msg),
      player.mode === 'tiempo' ? h('p', `Aciertos: ${s.hits} de ${total} · Mejor racha: ${s.best} · Puntos: ${s.points.toLocaleString('es')}`) : h('p', 'Has llegado al final de la canción.'),
      h('div.row',
        h('button.btn.primary', { onclick: () => { ov.remove(); onReplay(); } }, '🔁 Otra vez'),
        h('button.btn', { onclick: () => { ov.remove(); onBack(); } }, '📚 Elegir otra canción'),
      ),
    ),
  );
  parent.append(ov);
  if (stars >= 2) confetti(ov);
  return ov;
}

export function confetti(parent) {
  const colors = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ec407a'];
  for (let i = 0; i < 80; i++) {
    const c = h('i.confetti', {
      style: {
        left: Math.random() * 100 + '%',
        background: colors[i % colors.length],
        animationDelay: Math.random() * 0.8 + 's',
        animationDuration: 2 + Math.random() * 2 + 's',
        transform: `rotate(${Math.random() * 360}deg)`,
      },
    });
    parent.append(c);
    setTimeout(() => c.remove(), 5000);
  }
}
