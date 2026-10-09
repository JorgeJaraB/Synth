// Tutorial interactivo del modo "Acordes con gestos": la app pide un gesto,
// comprueba con la cámara que se hace bien y pasa sola al siguiente paso.
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { chordSymbol, romanFor, restQuality, chordRoot } from '../core/chords.js';
import { noteColor } from '../core/notes.js';
import { confetti } from '../ui/transport.js';
import { handSvg } from '../ui/hand-svg.js';
import { h } from '../ui/dom.js';

const FINGERS_FOR_DEGREE = ['i', 'im', 'ima', 'imae', 'pimae', 'ie', 'pie'];
const SHAPE_TEXT = [
  'Levanta solo el <b>dedo índice</b>.',
  'Levanta el <b>índice y el corazón</b> (como una V).',
  'Levanta <b>tres dedos</b>: índice, corazón y anular.',
  'Levanta <b>cuatro dedos</b>, con el pulgar doblado.',
  'Abre <b>toda la mano</b>, con el pulgar bien separado.',
  'Levanta el <b>índice y el meñique</b> (los "cuernos" 🤘).',
  'Como los cuernos, pero sacando también el <b>pulgar</b> 🤟.',
];
const PROG = [1, 4, 5, 1];

export class ChordTutorial {
  /**
   * @param {HTMLElement} host  dónde se muestra la tarjeta
   * @param {object} opts  { tonic: () => número MIDI, onClose: fn }
   */
  constructor(host, { tonic, onClose }) {
    this.host = host;
    this.tonic = tonic;
    this.onClose = onClose;
    this.index = 0;
    this.holdSince = 0;
    this.passed = false;
    this.mem = {};
    this.el = h('div.tut-card');
    host.append(this.el);
    this.steps = this.buildSteps();
    this.render();
  }

  buildSteps() {
    const chordSide = settings.chordLefty ? 'derecha' : 'izquierda';
    const exprSide = settings.chordLefty ? 'izquierda' : 'derecha';
    const natural = settings.chordStraight === 'natural';
    const rest = (d) => restQuality(d, settings.chordStraight);
    const name = (d, q = rest(d), v = 'triada') => chordSymbol(this.tonic(), d, q, v, settings.notation);
    const hand = (fingers, opts = {}) => ({ fingers, side: chordSide, ...opts });
    const steps = [
      {
        intro: true,
        hand: hand('pimae'),
        title: 'Vamos a tocar acordes con las manos',
        text: `Con la <b>mano ${chordSide}</b> eliges el acorde levantando dedos, como en lengua de signos. Con la <b>mano ${exprSide}</b> decides cómo suena. ¡Son 5 minutos!`,
      },
      {
        hand: hand('pimae'),
        title: `Enseña la mano ${chordSide}`,
        text: `Ponla delante de la cámara, en tu lado ${chordSide} de la pantalla, con la palma hacia la cámara.`,
        check: (s) => s.chordPresent,
      },
    ];
    FINGERS_FOR_DEGREE.forEach((f, i) => {
      const d = i + 1;
      steps.push({
        hand: hand(f),
        title: `Acorde ${romanFor(d, rest(d))} · ${name(d)}`,
        text: SHAPE_TEXT[i] + ` Así suena el acorde <b>${name(d)}</b>.` + (d === 1 ? ' Mantén la mano recta.' : ''),
        check: (s) => s.chordPresent && s.degree === d && s.tilt === 'recta',
        color: noteColor(chordRoot(this.tonic(), d)),
      });
    });
    steps.push(
      {
        hand: hand(''),
        title: 'Puño = silencio',
        text: 'Cierra el puño para que deje de sonar. Así puedes hacer pausas.',
        check: (s) => s.chordPresent && s.degree === 0,
      },
      ...(natural
        ? [
            {
              hand: hand('im', { tilt: 30 }),
              title: 'Inclinar hacia dentro = mayor',
              text: `Con <b>2 dedos</b> (${name(2)}), inclina la mano hacia el <b>centro de la pantalla</b>. El acorde menor se vuelve mayor: <b>${name(2, 'mayor')}</b>.`,
              check: (s) => s.chordPresent && s.degree === 2 && s.tilt === 'dentro',
            },
            {
              hand: hand('i', { tilt: -30 }),
              title: 'Inclinar hacia fuera = menor',
              text: `Con <b>1 dedo</b> (${name(1)}), inclina la mano hacia <b>fuera</b>. El acorde mayor se vuelve menor: <b>${name(1, 'menor')}</b>.`,
              check: (s) => s.chordPresent && s.degree === 1 && s.tilt === 'fuera',
            },
          ]
        : [
            {
              hand: hand('im', { tilt: -30 }),
              title: 'Inclinar hacia fuera = menor',
              text: `Con la mano recta todos los acordes son mayores. Con <b>2 dedos</b> (${name(2)}), inclina la mano hacia <b>fuera</b> y se vuelve menor: <b>${name(2, 'menor')}</b>.`,
              check: (s) => s.chordPresent && s.degree === 2 && s.tilt === 'fuera',
            },
          ]),
      {
        hand: { fingers: 'i', side: exprSide },
        title: `Ahora la mano ${exprSide}`,
        text: `Deja la mano ${chordSide} haciendo un acorde y enseña también la <b>mano ${exprSide}</b> con un dedo levantado.`,
        check: (s) => s.exprPresent && s.stable,
      },
      {
        hand: { fingers: 'i', side: exprSide },
        title: 'Sube y baja = volumen',
        text: `Sube la mano ${exprSide} para que suene <b>fuerte</b> y bájala para que suene <b>flojito</b>. Mira la barra de volumen de la derecha.`,
        check: (s, m) => {
          if (s.exprPresent && s.volume > 0.8) m.high = true;
          if (s.exprPresent && s.volume < 0.45) m.low = true;
          return m.high && m.low;
        },
        progress: (m) => `${m.high ? '✅' : '⬜'} Fuerte   ${m.low ? '✅' : '⬜'} Flojito`,
        hold: 0,
      },
      settings.chordOctaveTurn
        ? {
            hand: { fingers: 'i', side: exprSide, tilt: 30 },
            title: 'Girar = octava',
            text: `Gira la mano ${exprSide} hacia un lado y hacia el otro, como el botón del volumen: el acorde suena una <b>octava más agudo</b> o <b>más grave</b>. Recta, vuelve a su sitio.`,
            check: (s, m) => {
              if (s.exprPresent && s.octave > 0) m.up = true;
              if (s.exprPresent && s.octave < 0) m.down = true;
              return m.up && m.down;
            },
            progress: (m) => `${m.up ? '✅' : '⬜'} Más agudo   ${m.down ? '✅' : '⬜'} Más grave`,
            hold: 0,
          }
        : {
            hand: { fingers: 'i', side: exprSide, tilt: 30 },
            title: 'Inclinar = brillo',
            text: `Inclina la mano ${exprSide} hacia un lado y hacia el otro: el sonido se vuelve más <b>brillante</b> o más <b>apagado</b>.`,
            check: (s, m) => {
              if (s.exprPresent && s.brightness > 0.8) m.bright = true;
              if (s.exprPresent && s.brightness < 0.3) m.dark = true;
              return m.bright && m.dark;
            },
            progress: (m) => `${m.bright ? '✅' : '⬜'} Brillante   ${m.dark ? '✅' : '⬜'} Apagado`,
            hold: 0,
          },
      {
        hand: { fingers: 'imae', side: exprSide },
        title: 'Dedos de la otra mano = variante',
        text: `Haz el acorde <b>${name(5)}</b> (mano ${chordSide} abierta) y levanta <b>4 dedos</b> con la mano ${exprSide}: suena <b>${name(5, 'mayor', 'dominante')}</b>, la séptima de dominante. Con 2 dedos sale la inversión y con 3, la séptima.`,
        check: (s) => s.stable && s.stable.degree === 5 && s.voicing === 'dominante',
      },
      {
        hand: { fingers: '', side: exprSide },
        title: 'Puño en la otra mano = silencio',
        text: `Cierra el puño de la mano ${exprSide}: el acorde se calla aunque la otra mano siga haciendo el gesto.`,
        check: (s) => s.exprPresent && s.exprMuted,
      },
      {
        hand: hand('i'),
        title: `¡Reto final! ${PROG.map((d) => romanFor(d, rest(d))).join(' – ')}`,
        text: `Toca esta progresión, la de miles de canciones: <b>${PROG.map((d) => name(d)).join(' → ')}</b>. Mantén cada acorde un momento.`,
        check: (s, m) => {
          m.step ??= 0;
          if (s.stable && s.stable.degree === PROG[m.step]) {
            m.since ??= performance.now();
            if (performance.now() - m.since > 500) {
              m.step++;
              m.since = null;
              if (m.step < PROG.length) this.chime(76 + m.step * 2);
            }
          } else m.since = null;
          return m.step >= PROG.length;
        },
        progress: (m) => PROG.map((d, i) => `${i < (m.step || 0) ? '✅' : '⬜'} ${name(d)}`).join('   '),
        hold: 0,
      },
      {
        done: true,
        hand: hand('pie'),
        title: '¡Enhorabuena! 🎉',
        text: 'Ya sabes tocar acordes con las manos. Prueba las <b>progresiones</b> del panel de la derecha, cambia la <b>tonalidad</b> o activa el <b>arpegio</b>.',
      },
    );
    return steps;
  }

  get step() {
    return this.steps[this.index];
  }

  chime(midi = 84) {
    if (audio.ready) audio.playNote(midi, 0.25, audio.now(), 0.35, 'cristal');
  }

  go(i) {
    this.index = Math.max(0, Math.min(this.steps.length - 1, i));
    this.holdSince = 0;
    this.passed = false;
    this.mem = {};
    if (this.step.done) {
      settings.chordTutorialDone = true;
      confetti(this.host);
      this.chime(88);
    }
    this.render();
  }

  render() {
    const st = this.step;
    const total = this.steps.length - 2; // sin contar la presentación ni el final
    const hd = st.hand;
    this.status = h('div.tut-status');
    this.el.replaceChildren(
      h('div.tut-head',
        h('span', `🎓 Tutorial${st.intro || st.done ? '' : ` · paso ${this.index} de ${total}`}`),
        h('button.btn.icon.small', { title: 'Salir del tutorial', onclick: () => this.close() }, '✕'),
      ),
      h('div.tut-progress', h('div', { style: { width: Math.min(100, (this.index / (total + 1)) * 100) + '%' } })),
      h('div.tut-body',
        h('div.tut-hand', { html: handSvg(hd.fingers, { side: hd.side, tilt: hd.tilt || 0, size: 150 }), style: { '--c': st.color || 'var(--accent)' } }),
        h('div.tut-text', h('h3', st.title), h('p', { html: st.text }), this.status),
      ),
      h('div.tut-foot',
        st.intro
          ? [h('button.btn', { onclick: () => this.close() }, 'Ahora no'), h('button.btn.primary', { onclick: () => this.go(1) }, '¡Empezar! →')]
          : st.done
            ? [h('button.btn', { onclick: () => this.go(1) }, '🔁 Repetir'), h('button.btn.primary', { onclick: () => this.close() }, 'Terminar')]
            : [
                h('button.btn.small', { onclick: () => this.go(this.index - 1), disabled: this.index <= 1 }, '← Anterior'),
                h('button.btn.small', { onclick: () => this.go(this.index + 1) }, 'Saltar →'),
              ],
      ),
    );
    this.renderStatus(0);
  }

  renderStatus(holdP) {
    const st = this.step;
    if (!st.check) return;
    if (this.passed) {
      this.status.className = 'tut-status ok';
      this.status.textContent = '✅ ¡Muy bien!';
      return;
    }
    this.status.className = 'tut-status';
    const prog = st.progress ? st.progress(this.mem) : '';
    this.status.replaceChildren(
      ...[
        h('span', prog || (holdP > 0 ? 'Mantén el gesto…' : '👀 Esperando el gesto…')),
        st.hold !== 0 ? h('div.tut-hold', h('div', { style: { width: holdP * 100 + '%' } })) : null,
      ].filter(Boolean),
    );
  }

  /** Llamar en cada fotograma con lo que detecta la cámara. */
  update(s) {
    const st = this.step;
    if (!st.check || this.passed) return;
    const ok = st.check(s, this.mem);
    const hold = st.hold ?? 700;
    const now = performance.now();
    let p = 0;
    if (ok) {
      this.holdSince ||= now;
      p = hold ? Math.min(1, (now - this.holdSince) / hold) : 1;
    } else this.holdSince = 0;
    if (p >= 1) {
      this.passed = true;
      this.chime();
      this.renderStatus(1);
      const at = this.index;
      setTimeout(() => this.index === at && this.go(this.index + 1), 1100);
      return;
    }
    // Refrescar el estado sin rehacer la tarjeta en cada fotograma
    if (st.progress || Math.abs(p - (this._lastP || 0)) > 0.04 || (p === 0) !== (this._lastP === 0)) {
      this._lastP = p;
      this.renderStatus(p);
    }
  }

  close() {
    this.el.remove();
    this.onClose?.();
  }
}
