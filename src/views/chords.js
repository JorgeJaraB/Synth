// Acordes con gestos: una mano forma el acorde con los dedos (como en lengua de signos)
// y la otra controla cómo suena. Idea inspirada en "Gesture Synth" de Eric Wei.
import { audio, INSTRUMENTS } from '../core/audio.js';
import { settings, onSettingsChange } from '../core/settings.js';
import { noteColor, noteName, SOLFEGE, LETTERS } from '../core/notes.js';
import {
  chordNotes, chordSymbol, chordLongName, chordRoot, romanFor, degreeFromFingers, voicingFromFingers,
  handRoll, tiltSide, qualityFor, NATURAL_QUALITY, PROGRESSIONS, Stabilizer, voicingLabel,
} from '../core/chords.js';
import { CameraStage } from '../ui/camera-stage.js';
import { confetti } from '../ui/transport.js';
import { h, settingSelect, settingRange, settingToggle, panelToggle, INSTRUMENT_OPTIONS } from '../ui/dom.js';
import { laneArea, drawWave } from './synth.js';
import { ChordTutorial } from './chords-tutorial.js';
import { handSvg } from '../ui/hand-svg.js';

const HAND_SHAPES = ['i', 'im', 'ima', 'imae', 'pimae', 'ie', 'pie'];
const SIGN_TEXT = ['1 dedo', '2 dedos', '3 dedos', '4 dedos', 'mano abierta', 'índice + meñique', 'índice + meñique + pulgar'];

const hexToRgb = (hex) => {
  const s = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)).join(',');
};

export function mount(root) {
  let voice = null;
  const stab = new Stabilizer(140);
  let current = null; // { degree, quality, voicing }
  let tilt = 'recta';
  let volume = 0;
  let brightness = 0.6;
  let exprMuted = false;
  let progStep = 0;
  let progHeldSince = 0;
  let progWaitChange = null; // al completar la progresión, esperar a que cambie el acorde
  let chordHandInfo = null;
  let exprHandInfo = null;

  const tonic = () => 48 + settings.chordKey;

  // ---------- Panel lateral ----------
  const legendRows = [];
  const legend = h('div.chord-legend');
  function renderLegend() {
    legendRows.length = 0;
    legend.replaceChildren(
      ...HAND_SHAPES.map((shape, i) => {
        const deg = i + 1;
        const q = NATURAL_QUALITY[i];
        const row = h('div.legend-row', { style: { '--c': noteColor(chordRoot(tonic(), deg)) } },
          h('span.legend-sign', { html: handSvg(shape, { side: settings.chordLefty ? 'derecha' : 'izquierda', size: 44 }) }),
          h('span.legend-text', SIGN_TEXT[i]),
          h('span.legend-roman', romanFor(deg, q)),
          h('span.legend-chord', chordSymbol(tonic(), deg, q, 'triada', settings.notation)),
        );
        legendRows.push(row);
        return row;
      }),
      h('div.legend-row.muted-row', h('span.legend-sign', { html: handSvg('', { side: settings.chordLefty ? 'derecha' : 'izquierda', size: 44 }) }), h('span.legend-text', 'puño'), h('span.legend-roman', ''), h('span.legend-chord', 'silencio')),
    );
  }

  const progHost = h('div.progression');
  function renderProgression() {
    const p = PROGRESSIONS[settings.chordProgression] || PROGRESSIONS.ninguna;
    progStep = 0;
    progHost.replaceChildren(
      ...p.degrees.map((d, i) => h('span.prog-chip', { 'data-i': i, style: { '--c': noteColor(chordRoot(tonic(), d)) } },
        h('b', romanFor(d, NATURAL_QUALITY[d - 1])), h('small', chordSymbol(tonic(), d, NATURAL_QUALITY[d - 1], 'triada', settings.notation)))),
    );
    updateProgression();
  }
  function updateProgression() {
    [...progHost.children].forEach((c, i) => {
      c.classList.toggle('next', i === progStep);
      c.classList.toggle('done', i < progStep);
    });
  }

  const onChange = () => {
    renderLegend();
    renderProgression();
    applyChord(current, true);
  };

  const panel = h(
    'aside.panel',
    h('h2', '🤟 Acordes con gestos'),
    h('button.btn.primary.tut-btn', { onclick: () => startTutorial() }, '🎓 Tutorial paso a paso'),
    settingSelect('Tonalidad', 'chordKey', SOLFEGE.map((s, i) => [i, `${s} mayor (${LETTERS[i]})`]), onChange),
    settingSelect('Sonido', 'chordInstrument', INSTRUMENT_OPTIONS(INSTRUMENTS), () => rebuildVoice()),
    settingToggle('Arpegiar (tocar las notas una a una)', 'chordArpeggio', (v) => voice?.setArpeggio(v)),
    settingToggle('Soy zurdo/a (la mano derecha forma el acorde)', 'chordLefty'),
    settingSelect('Progresión para practicar', 'chordProgression', Object.entries(PROGRESSIONS).map(([k, v]) => [k, v.name]), renderProgression),
    settingSelect('Nombres de las notas', 'notation', [['solfeo', 'Do, Re, Mi'], ['letras', 'C, D, E'], ['colores', 'Colores']], onChange),
    settingRange('Eco de sala (reverb)', 'reverb'),
    h('h3.legend-title'),
    legend,
    h('p.muted', '↔️ Inclina esa mano: ', h('b', 'hacia dentro = mayor'), ', ', h('b', 'hacia fuera = menor'), '. Recta = el acorde natural de la escala.'),
    h('h3.legend-title', '🤚 La otra mano: cómo suena'),
    h('ul.expr-legend',
      h('li', '☝️ 1 dedo: acorde normal (tríada)'),
      h('li', '✌️ 2 dedos: 1.ª inversión'),
      h('li', '3 dedos: con séptima'),
      h('li', '4 dedos: séptima de dominante (o disminuido si el acorde es menor)'),
      h('li', '↕️ Altura: volumen · ↔️ Inclinar: brillo'),
      h('li', '✊ Puño: silencio'),
    ),
    h('p.muted.credit', 'Idea inspirada en «Gesture Synth» de Eric Wei (indecisive.eric).'),
  );
  // El título de la leyenda cambia con la opción de zurdo/a.
  const legendTitle = panel.querySelector('.legend-title');
  const setLegendTitle = () => (legendTitle.textContent = settings.chordLefty ? '✋ Mano derecha: el acorde' : '✋ Mano izquierda: el acorde');
  setLegendTitle();

  const hint = h(
    'div.hint-card',
    h('h3', '¿Cómo se toca?'),
    h('ul',
      h('li', '✋ Con la ', h('b', 'mano izquierda'), ' levanta dedos: 1 dedo = acorde I, 2 = II… (mira la tabla de la derecha).'),
      h('li', '↔️ Inclínala para cambiar entre mayor y menor.'),
      h('li', '🤚 Con la otra mano: súbela o bájala para el volumen e inclínala para el brillo.'),
      h('li', '✊ Cierra el puño para callar.'),
    ),
    h('button.btn.small', { onclick: () => hint.remove() }, 'Entendido'),
  );
  const stageWrap = h('div.stage-wrap', progHost);
  let tutorial = null;
  function startTutorial(atIntro = false) {
    hint.remove();
    tutorial?.close();
    panel.classList.remove('open');
    progHost.style.display = 'none';
    tutorial = new ChordTutorial(stageWrap, {
      tonic,
      onClose: () => {
        tutorial = null;
        progHost.style.display = '';
      },
    });
    if (!atIntro) tutorial.go(1);
  }
  const view = h('div.view.view-with-panel', stageWrap, panel, panelToggle(panel));
  root.append(view);
  renderLegend();
  renderProgression();
  // La primera vez se ofrece el tutorial; después, la tarjeta de ayuda breve.
  if (!settings.chordTutorialDone) startTutorial(true);
  else stageWrap.append(hint);
  if (import.meta.env.DEV) window.__chords = { get tutorial() { return tutorial; }, get current() { return current; }, get voice() { return voice; }, get volume() { return volume; }, get progStep() { return progStep; } };

  function rebuildVoice() {
    voice?.dispose();
    voice = null;
    const keep = current;
    current = null;
    applyChord(keep);
  }

  function ensureVoice() {
    if (!voice && audio.ready) {
      voice = audio.createChordVoice(settings.chordInstrument);
      voice.setArpeggio(settings.chordArpeggio);
    }
    return voice;
  }

  function applyChord(state, force = false) {
    const same = JSON.stringify(state) === JSON.stringify(current);
    if (same && !force) return;
    current = state;
    const v = ensureVoice();
    if (!v) return;
    if (!state) v.silence();
    else v.setChord(chordNotes(tonic(), state.degree, state.quality, state.voicing));
    legendRows.forEach((r, i) => r.classList.toggle('active', !!state && state.degree === i + 1));
  }

  /** Reparte las manos: la de los acordes y la de expresión. */
  function assignHands(hands) {
    let chord = null;
    let expr = null;
    const chordOnLeft = !settings.chordLefty;
    if (hands.length >= 2) {
      const sorted = [...hands].sort((a, b) => a.landmarks[0].x - b.landmarks[0].x);
      [chord, expr] = chordOnLeft ? [sorted[0], sorted[sorted.length - 1]] : [sorted[sorted.length - 1], sorted[0]];
    } else if (hands.length === 1) {
      const onLeft = hands[0].landmarks[0].x < 0.5;
      if (onLeft === chordOnLeft) chord = hands[0];
      else expr = hands[0];
    }
    return { chord, expr };
  }

  const stage = new CameraStage(stageWrap, {
    dim: 0.4,
    onDraw(ctx, w, hh, hands, st) {
      const now = performance.now();
      const { chord, expr } = assignHands(hands);
      const area = laneArea(hh);

      // Mano de los acordes → grado + mayor/menor
      let raw = null;
      chordHandInfo = null;
      if (chord) {
        const degree = degreeFromFingers(chord.extended);
        const onLeft = chord.landmarks[0].x < 0.5;
        tilt = tiltSide(handRoll(chord.landmarks), onLeft, tilt);
        if (degree >= 1 && degree <= 7) raw = { degree, quality: qualityFor(degree, tilt) };
        chordHandInfo = { pos: st.toScreen(chord.landmarks[0]), degree, tilt, onLeft };
      }

      // Mano de expresión → variante, volumen y brillo
      exprHandInfo = null;
      let voicing = 'triada';
      if (expr) {
        const vc = voicingFromFingers(expr.extended);
        exprMuted = vc == null && expr.fist;
        voicing = vc || 'triada';
        const y = st.toScreen(expr.landmarks[0]).y;
        const t = Math.max(0, Math.min(1, (area.bottom + hh * 0.12 - y) / (area.bottom + hh * 0.12 - area.top)));
        volume = exprMuted ? 0 : 0.15 + t * 0.85;
        brightness = Math.max(0, Math.min(1, 0.55 + handRoll(expr.landmarks) / 80));
        exprHandInfo = { pos: st.toScreen(expr.landmarks[0]), voicing, muted: exprMuted };
      } else {
        exprMuted = false;
        volume = 0.7;
        brightness = 0.6;
      }
      if (raw) raw.voicing = voicing;

      const stable = stab.update(raw, now);
      applyChord(stable);
      tutorial?.update({
        chordPresent: !!chord,
        degree: chordHandInfo?.degree ?? -1,
        tilt,
        exprPresent: !!expr,
        voicing: expr ? voicingFromFingers(expr.extended) : null,
        exprMuted,
        volume,
        brightness,
        stable,
      });
      const v = ensureVoice();
      if (v) {
        v.setVolume(stable ? volume : 0);
        v.setBrightness(brightness);
        v.tick();
      }

      // Progresión guía: avanza al mantener el acorde esperado medio segundo
      const prog = PROGRESSIONS[settings.chordProgression]?.degrees || [];
      if (progWaitChange != null && (!stable || stable.degree !== progWaitChange)) progWaitChange = null;
      if (prog.length && stable && !exprMuted && progWaitChange == null) {
        if (stable.degree === prog[progStep]) {
          if (!progHeldSince) progHeldSince = now;
          if (now - progHeldSince > 500) {
            progStep++;
            progHeldSince = 0;
            if (progStep >= prog.length) {
              confetti(stageWrap);
              progStep = 0;
              progWaitChange = stable.degree;
            }
            updateProgression();
          }
        } else progHeldSince = 0;
      }

      const col = stable ? noteColor(chordRoot(tonic(), stable.degree)) : '#888888';
      drawWave(ctx, w, hh, stable ? hexToRgb(col) : '150,150,160');
      drawChordCard(ctx, w, hh, stable, col);
      drawVolume(ctx, w, hh);
    },
    afterDraw(ctx) {
      if (chordHandInfo) {
        const { pos, degree, tilt: tl, onLeft } = chordHandInfo;
        const ok = degree >= 1 && degree <= 7;
        const label = ok ? romanFor(degree, qualityFor(degree, tl)) : '✊';
        const col = ok ? noteColor(chordRoot(tonic(), degree)) : '#999';
        const x = pos.x + (onLeft ? -10 : 10);
        const y = pos.y + 46;
        ctx.save();
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.font = '900 30px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 1);
        // Flecha de inclinación
        if (ok && tl !== 'recta') {
          const dir = (tl === 'dentro') === onLeft ? 1 : -1;
          ctx.font = '800 15px Nunito, system-ui, sans-serif';
          ctx.fillText(tl === 'dentro' ? 'mayor' : 'menor', x + dir * 70, y);
          ctx.fillText(dir > 0 ? '➜' : '⬅', x + dir * 44, y - 20);
        }
        ctx.restore();
      }
      if (exprHandInfo) {
        const { pos, voicing, muted } = exprHandInfo;
        ctx.save();
        ctx.font = '800 16px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const text = muted ? '✊ silencio' : voicingLabel(voicing, current?.quality || 'mayor');
        const tw = ctx.measureText(text).width + 20;
        ctx.beginPath();
        ctx.roundRect(pos.x - tw / 2, pos.y + 22, tw, 28, 14);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, pos.x, pos.y + 36);
        ctx.restore();
      }
    },
  });

  function drawChordCard(ctx, w, hh, state, col) {
    const cx = w / 2;
    const cy = hh * 0.8;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!state) {
      ctx.font = '800 20px Nunito, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(chordHandInfo ? '✊ Levanta dedos para elegir un acorde' : 'Enseña la mano a la cámara', cx, cy);
      ctx.restore();
      return;
    }
    const sym = chordSymbol(tonic(), state.degree, state.quality, state.voicing, settings.notation);
    const roman = romanFor(state.degree, state.quality);
    ctx.shadowColor = col;
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#fff';
    ctx.font = '900 64px Nunito, system-ui, sans-serif';
    ctx.fillText(sym, cx, cy - 18);
    ctx.shadowBlur = 0;
    ctx.font = '800 20px Nunito, system-ui, sans-serif';
    ctx.fillStyle = col;
    ctx.fillText(`${roman} · ${chordLongName(tonic(), state.degree, state.quality, settings.notation)}${state.voicing !== 'triada' ? ' · ' + voicingLabel(state.voicing, state.quality) : ''}`, cx, cy + 26);
    // Notas del acorde como fichas de colores
    const notes = chordNotes(tonic(), state.degree, state.quality, state.voicing).slice(1);
    const chipW = 52;
    let x = cx - (notes.length * (chipW + 8) - 8) / 2;
    for (const m of notes) {
      ctx.fillStyle = noteColor(m);
      ctx.beginPath();
      ctx.roundRect(x, cy + 46, chipW, 30, 10);
      ctx.fill();
      if (settings.notation !== 'colores') {
        ctx.fillStyle = '#fff';
        ctx.font = '900 15px Nunito, system-ui, sans-serif';
        ctx.fillText(noteName(m, settings.notation), x + chipW / 2, cy + 62);
      }
      x += chipW + 8;
    }
    ctx.restore();
  }

  function drawVolume(ctx, w, hh) {
    const bars = 12;
    const x = w - 34;
    const top = hh * 0.12;
    const bh = (hh * 0.6) / bars;
    const lit = Math.round((current ? volume : 0) * bars);
    for (let i = 0; i < bars; i++) {
      ctx.fillStyle = bars - i <= lit ? `hsl(${40 - i * 2}, 95%, 58%)` : 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, top + i * bh, 18, bh - 4);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '700 12px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('vol', x + 9, top - 10);
  }

  const off = onSettingsChange((k) => {
    if (k === 'chordLefty') {
      setLegendTitle();
      renderLegend();
    }
  });

  return () => {
    off();
    voice?.dispose();
    stage.destroy();
    view.remove();
  };
}
