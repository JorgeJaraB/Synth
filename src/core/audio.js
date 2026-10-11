// Motor de audio: instrumentos, efectos y voces continuas para el modo cámara.
import * as Tone from 'tone';
import { settings, onSettingsChange } from './settings.js';
import { perf, onPerfChange } from './perf.js';
import { toneName, midiToFreq } from './notes.js';

/** Ganancia extra tras el compresor (dB). Ajustada midiendo: acorde ≈ -14 dB RMS. */
const MAKEUP_DB = 4;

const PIANO_SAMPLES = {};
for (let o = 1; o <= 7; o++) {
  PIANO_SAMPLES['C' + o] = `C${o}.mp3`;
  PIANO_SAMPLES['D#' + o] = `Ds${o}.mp3`;
  PIANO_SAMPLES['F#' + o] = `Fs${o}.mp3`;
  PIANO_SAMPLES['A' + o] = `A${o}.mp3`;
}
PIANO_SAMPLES.A0 = 'A0.mp3';
PIANO_SAMPLES.C8 = 'C8.mp3';

/** Catálogo de instrumentos que ve el usuario. */
export const INSTRUMENTS = {
  piano: { name: 'Piano de cola', emoji: '🎹', sampled: true },
  suave: {
    name: 'Synth suave',
    emoji: '🌙',
    osc: { type: 'fattriangle', count: 3, spread: 18 },
    env: { attack: 0.04, decay: 0.3, sustain: 0.7, release: 0.8 },
    filter: 2400,
  },
  cristal: {
    name: 'Campanas de cristal',
    emoji: '🔔',
    fm: true,
    env: { attack: 0.002, decay: 1.2, sustain: 0.1, release: 1.4 },
    filter: 8000,
  },
  organo: {
    name: 'Órgano',
    emoji: '⛪',
    osc: { type: 'fatsine4', count: 2, spread: 8 },
    env: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.25 },
    filter: 5000,
  },
  retro: {
    name: 'Videojuego retro',
    emoji: '👾',
    osc: { type: 'square' },
    env: { attack: 0.005, decay: 0.1, sustain: 0.6, release: 0.15 },
    filter: 6000,
  },
  sierra: {
    name: 'Synth brillante',
    emoji: '⚡',
    osc: { type: 'fatsawtooth', count: 3, spread: 25 },
    env: { attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.5 },
    filter: 3200,
  },
  flauta: {
    name: 'Flauta',
    emoji: '🪈',
    osc: { type: 'sine' },
    env: { attack: 0.08, decay: 0.1, sustain: 0.85, release: 0.3 },
    filter: 4000,
    vibrato: true,
  },
};

/**
 * Sonidos de los modos de acordes que se tocan con osciladores puros que se deslizan de un
 * acorde al siguiente (como en Gesture Synth): suenan limpios, afinados y sin cortes.
 */
export const CHORD_WAVES = {
  limpio: { name: 'Synth limpio', emoji: '✨', wave: 'triangle', level: 0.24 },
  puro: { name: 'Onda pura (muy suave)', emoji: '🌊', wave: 'sine', level: 0.27 },
  brillante: { name: 'Sierra brillante', emoji: '⚡', wave: 'sawtooth', level: 0.12 },
  cuadrada: { name: 'Cuadrada retro', emoji: '👾', wave: 'square', level: 0.1 },
};

/**
 * Lleva un parámetro a un valor de forma suave (curva exponencial, sin esquinas) y solo si
 * cambia lo bastante. Los controles de las manos se actualizan ~30 veces por segundo con
 * pequeños temblores: rehacer la rampa cada vez producía un raspado que sonaba a saturación.
 * @param state  objeto donde se guarda el último valor (key)
 * @param gate   valor con el que se decide si ha cambiado lo bastante (p. ej. el brillo 0..1)
 */
function easeParam(state, key, param, value, { gate = value, minDelta = 0.01, tc = 0.04 } = {}) {
  if (state[key] != null && Math.abs(gate - state[key]) < minDelta) return;
  state[key] = gate;
  const now = Tone.now();
  param.cancelAndHoldAtTime(now);
  param.setTargetAtTime(value, now, tc);
}

class AudioEngine {
  constructor() {
    this.ready = false;
    this.poly = new Map();
    this.pianoLoaded = false;
  }

  /** Debe llamarse tras un gesto del usuario (clic/toque). */
  async init() {
    if (this.ready) return;
    // Un poco más de margen de audio: con la cámara y el detector de manos el ordenador va
    // muy cargado y, con el mínimo, el sonido puede llegar a cortarse ("petardear").
    Tone.setContext(new Tone.Context({ latencyHint: 'balanced', lookAhead: 0.02 }));
    await Tone.start();

    this.master = new Tone.Volume(Tone.gainToDb(settings.masterVolume));
    this.limiter = new Tone.Limiter(-3);
    // Recorte suave al final: si aun así algo pasa del máximo, se redondea en vez de
    // chasquear contra el límite.
    this.softClip = new Tone.WaveShaper((x) => Math.tanh(x * 1.05) / Math.tanh(1.05), 2048);
    this.reverb = new Tone.Reverb({ decay: 2.8, preDelay: 0.02, wet: settings.reverb });
    this.delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.3, wet: settings.delay });
    this.analyser = new Tone.Waveform(1024);
    this.meter = new Tone.Meter({ smoothing: 0.8 });
    this.bus = new Tone.Gain(1);
    // Compresor + ganancia de compensación: sube el volumen percibido (sobre todo de los
    // acordes, que antes apenas se oían) sin saturar; el limitador evita picos.
    // Ataque no demasiado rápido: con 5 ms deformaba los graves del piano (sonaba saturado).
    this.compressor = new Tone.Compressor({ threshold: -22, ratio: 3, attack: 0.02, release: 0.3, knee: 10 });
    this.makeup = new Tone.Gain(Tone.dbToGain(MAKEUP_DB));
    this.bus.chain(this.delay, this.reverb, this.compressor, this.makeup, this.master, this.limiter, this.softClip, Tone.getDestination());
    this.limiter.connect(this.analyser);
    this.limiter.connect(this.meter);

    // Bus separado para el acompañamiento de las canciones (volumen propio).
    this.accBus = new Tone.Gain(settings.accompanimentVolume).connect(this.bus);

    this.click = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
    }).connect(this.master);
    this.click.volume.value = -10;

    onSettingsChange((k, v) => {
      if (k === 'masterVolume') this.master.volume.rampTo(Tone.gainToDb(Math.max(0.0001, v)), 0.05);
      if (k === 'reverb' && !this._reverbOff) this.reverb.wet.rampTo(v, 0.1);
      if (k === 'delay') this.delay.wet.rampTo(v, 0.1);
      if (k === 'accompanimentVolume') this.accBus.gain.rampTo(v, 0.1);
    });

    // Modo ligero: la reverb (lo que más cálculo de sonido gasta) se salta del todo.
    // No se toca settings.reverb: al quitar el modo ligero vuelve el valor del usuario.
    this._reverbOff = false;
    onPerfChange(() => this._applyLight());
    this._applyLight();

    this.ready = true;
    this.loadPiano();
  }

  _applyLight() {
    const off = perf.light;
    if (off === this._reverbOff) return;
    this._reverbOff = off;
    clearTimeout(this._bypassT);
    if (off) {
      // Primero se baja a 0 (sin chasquido) y luego se conecta el delay directo al compresor:
      // con wet = 0 la reverb deja pasar el sonido tal cual, así que el cambio no se nota.
      this.reverb.wet.rampTo(0, 0.1);
      this._bypassT = setTimeout(() => {
        this.delay.disconnect();
        this.delay.connect(this.compressor);
      }, 200);
    } else {
      this.delay.disconnect();
      this.delay.connect(this.reverb);
      this.reverb.wet.rampTo(settings.reverb, 0.1);
    }
  }

  /** Precarga los pianos (principal y acompañamiento) para que la primera nota ya suene. */
  loadPiano() {
    if (this.pianoPromise) return this.pianoPromise;
    this.getPoly('piano', 'main');
    this.getPoly('piano', 'acc');
    this.pianoPromise = Tone.loaded().then(() => {
      this.pianoLoaded = true;
    });
    return this.pianoPromise;
  }

  now() {
    return Tone.now();
  }

  _makePoly(key, dest) {
    const def = INSTRUMENTS[key] || INSTRUMENTS.suave;
    if (def.sampled) {
      // Un Sampler por destino (principal / acompañamiento).
      const s = new Tone.Sampler({ urls: PIANO_SAMPLES, baseUrl: './samples/piano/', release: 1.2 });
      s.connect(dest);
      s.volume.value = 3;
      return s;
    }
    const filter = new Tone.Filter(def.filter, 'lowpass', -12).connect(dest);
    let synth;
    if (def.fm) {
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 12,
        envelope: def.env,
        modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.1, release: 0.8 },
      });
    } else {
      synth = new Tone.PolySynth(Tone.Synth, { oscillator: def.osc, envelope: def.env });
    }
    synth.maxPolyphony = 32;
    synth.volume.value = -5;
    if (def.vibrato) {
      const vib = new Tone.Vibrato(5, 0.08);
      synth.chain(vib, filter);
    } else synth.connect(filter);
    return synth;
  }

  getPoly(key, target = 'main') {
    const id = key + ':' + target;
    if (!this.poly.has(id)) this.poly.set(id, this._makePoly(key, target === 'acc' ? this.accBus : this.bus));
    return this.poly.get(id);
  }

  /** Nota mantenida (piano táctil, teclado en el aire...). */
  noteOn(midi, velocity = 0.8, instrument = settings.pianoInstrument) {
    if (!this.ready) return;
    const inst = this.getPoly(instrument);
    if (inst.loaded === false) return;
    inst.triggerAttack(toneName(midi), undefined, velocity);
  }

  noteOff(midi, instrument = settings.pianoInstrument) {
    if (!this.ready) return;
    const inst = this.getPoly(instrument);
    if (inst.loaded === false) return;
    inst.triggerRelease(toneName(midi), '+0.01');
  }

  /** Nota con duración programada (reproducción de canciones). */
  playNote(midi, duration, time, velocity = 0.7, instrument = 'piano', target = 'main') {
    if (!this.ready) return;
    const inst = this.getPoly(instrument, target);
    if (inst.loaded === false) return;
    inst.triggerAttackRelease(toneName(midi), Math.max(0.05, duration), time, velocity);
  }

  /** Batería sencilla sintetizada para los canales de percusión de los MIDI. */
  playDrum(note, time, velocity = 0.7) {
    if (!this.ready) return;
    if (!this.drums) {
      const out = new Tone.Gain(0.5).connect(this.accBus);
      this.drums = {
        kick: new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.04, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } }).connect(out),
        snare: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(out),
        hat: new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }).connect(new Tone.Filter(7000, 'highpass').connect(out)),
      };
      this.drums.hat.volume.value = -12;
      this.drums.snare.volume.value = -8;
    }
    try {
      if (note === 35 || note === 36) this.drums.kick.triggerAttackRelease('C1', 0.2, time, velocity);
      else if (note === 38 || note === 40 || note === 37 || note === 39) this.drums.snare.triggerAttackRelease(0.12, time, velocity);
      else if ([42, 44, 46, 49, 51, 57].includes(note)) this.drums.hat.triggerAttackRelease(note === 46 || note === 49 ? 0.25 : 0.04, time, velocity * 0.7);
    } catch {
      /* dos golpes en el mismo instante: se ignora */
    }
  }

  releaseAll() {
    for (const p of this.poly.values()) p.releaseAll?.();
  }

  tick(time, accent = false) {
    if (!this.ready) return;
    this.click.triggerAttackRelease(accent ? 'C6' : 'G5', 0.03, time);
  }

  /** Voz continua para el modo cámara: tono, volumen y brillo variables. */
  createVoice(instrument = settings.synthInstrument) {
    return new ContinuousVoice(this, instrument);
  }

  /**
   * Flujo de audio para grabar: todo lo que suena en la app y, opcionalmente, el micrófono.
   * @param {MediaStream|null} mic
   */
  startRecordingAudio(mic = null) {
    const ctx = Tone.getContext();
    this.recDest = ctx.createMediaStreamDestination();
    Tone.connect(this.limiter, this.recDest);
    if (mic) {
      this.recMic = ctx.createMediaStreamSource(mic);
      this.recMicGain = ctx.createGain();
      this.recMicGain.gain.value = 1.2;
      this.recMic.connect(this.recMicGain);
      this.recMicGain.connect(this.recDest);
    }
    return this.recDest.stream;
  }

  stopRecordingAudio() {
    try {
      Tone.disconnect(this.limiter, this.recDest);
    } catch {
      /* ya desconectado */
    }
    this.recMic?.disconnect();
    this.recMicGain?.disconnect();
    this.recDest = this.recMic = this.recMicGain = null;
  }

  /** Voz de acordes para el modo "Acordes con gestos". */
  createChordVoice(instrument = 'limpio') {
    if (CHORD_WAVES[instrument]) return new GlideChordVoice(this, CHORD_WAVES[instrument]);
    return new ChordVoice(this, instrument);
  }

  getWaveform() {
    return this.ready ? this.analyser.getValue() : null;
  }

  getLevel() {
    if (!this.ready) return 0;
    const db = this.meter.getValue();
    return Math.max(0, Math.min(1, (db + 60) / 60));
  }
}

class ContinuousVoice {
  constructor(engine, instrument) {
    this.engine = engine;
    this.instrument = instrument;
    this.def = INSTRUMENTS[instrument] || INSTRUMENTS.suave;
    this.active = false;
    this.midi = null;
    if (this.def.sampled) return; // el piano se re-dispara nota a nota

    this.out = new Tone.Gain(0).connect(engine.bus);
    this.filter = new Tone.Filter(this.def.filter, 'lowpass', -12).connect(this.out);
    if (this.def.fm) {
      this.osc = new Tone.FMOscillator({ harmonicity: 3.01, modulationIndex: 6, frequency: 440 });
    } else {
      this.osc = new Tone.OmniOscillator({ frequency: 440, ...this.def.osc });
    }
    // Un vibrato ligero da vida al sonido cuando la mano está quieta.
    this.vibrato = new Tone.Vibrato(5.5, this.def.vibrato ? 0.1 : 0.03);
    this.osc.chain(this.vibrato, this.filter);
    this.osc.volume.value = -4;
    this.osc.start();
    this.gainTarget = 0.7;
  }

  setNote(midi, glide = settings.synthGlide) {
    if (midi === this.midi) return;
    const prev = this.midi;
    this.midi = midi;
    if (this.def.sampled) {
      if (this.active) {
        if (prev != null) this.engine.noteOff(prev, 'piano');
        this.engine.noteOn(midi, 0.75, 'piano');
      }
      return;
    }
    const f = midiToFreq(midi);
    if (glide && this.active) this.osc.frequency.rampTo(f, 0.06);
    else this.osc.frequency.setValueAtTime(f, Tone.now());
  }

  /** Tono continuo (modo theremin): midi puede tener decimales. */
  setPitch(midi) {
    if (this.def.sampled) return this.setNote(Math.round(midi));
    this.midi = midi;
    const f = midiToFreq(midi);
    if (this.active) this.osc.frequency.rampTo(f, 0.03);
    else this.osc.frequency.setValueAtTime(f, Tone.now());
  }

  setGain(g) {
    this.gainTarget = g;
    if (this.active && this.out) easeParam(this, '_g', this.out.gain, g * 0.9, { minDelta: 0.01, tc: 0.02 });
  }

  setBrightness(b) {
    // b en [0,1] → frecuencia de corte del filtro
    if (!this.filter) return;
    const f = 300 * Math.pow(40, b);
    easeParam(this, '_b', this.filter.frequency, f, { gate: b, minDelta: 0.015, tc: 0.03 });
  }

  start() {
    if (this.active) return;
    this.active = true;
    if (this.def.sampled) {
      if (this.midi != null) this.engine.noteOn(this.midi, 0.75, 'piano');
      return;
    }
    const a = this.def.env.attack;
    this.out.gain.cancelScheduledValues(Tone.now());
    this.out.gain.rampTo(this.gainTarget * 0.9, Math.max(0.02, a));
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this.def.sampled) {
      if (this.midi != null) this.engine.noteOff(this.midi, 'piano');
      return;
    }
    this.out.gain.cancelScheduledValues(Tone.now());
    this.out.gain.rampTo(0, Math.min(0.6, this.def.env.release));
  }

  dispose() {
    this.stop();
    if (this.def.sampled) return;
    setTimeout(() => {
      this.osc.dispose();
      this.vibrato?.dispose();
      this.filter.dispose();
      this.out.dispose();
    }, 800);
  }
}

/**
 * Varias notas a la vez con volumen y brillo continuos. Al cambiar de acorde solo
 * se sueltan las notas que sobran y se atacan las nuevas (las comunes siguen sonando).
 */
class ChordVoice {
  constructor(engine, instrument) {
    this.engine = engine;
    this.out = new Tone.Gain(0).connect(engine.bus);
    this.filter = new Tone.Filter(3000, 'lowpass', -24).connect(this.out);
    this.synth = engine._makePoly(instrument, this.filter);
    this.sampled = !!INSTRUMENTS[instrument]?.sampled;
    this.notes = [];
    this.arpeggio = false;
    this.arpIndex = 0;
    this.nextArp = 0;
    this.bpm = 110;
  }

  _names(notes) {
    return notes.map(toneName);
  }

  setChord(notes) {
    const next = notes || [];
    if (this.arpeggio) {
      this.notes = next;
      return;
    }
    const drop = this.notes.filter((m) => !next.includes(m));
    const add = next.filter((m) => !this.notes.includes(m));
    if (drop.length) this.synth.triggerRelease(this._names(drop), '+0.005');
    if (add.length) this.synth.triggerAttack(this._names(add), '+0.01', 0.75);
    this.notes = next;
  }

  setArpeggio(on) {
    if (on === this.arpeggio) return;
    this.synth.releaseAll?.();
    this.arpeggio = on;
    const keep = this.notes;
    this.notes = [];
    if (!on) this.setChord(keep);
    else this.notes = keep;
  }

  /** Llamar en cada fotograma: toca la siguiente nota del arpegio cuando toca. */
  tick() {
    if (!this.arpeggio || !this.notes.length) return;
    const now = Tone.now();
    if (now < this.nextArp - 0.05) return;
    const step = 60 / this.bpm / 2;
    const t = Math.max(now, this.nextArp);
    // Sube y baja por las notas del acorde (sin el bajo), como en un arpegio de piano.
    const up = this.notes.slice(1);
    const seq = up.concat(up.slice(1, -1).reverse());
    const m = seq[this.arpIndex % seq.length] ?? this.notes[0];
    this.synth.triggerAttackRelease(toneName(m), step * 0.9, t, 0.6);
    if (this.arpIndex % seq.length === 0) this.synth.triggerAttackRelease(toneName(this.notes[0]), step * 3.5, t, 0.5);
    this.arpIndex++;
    this.nextArp = t + step;
  }

  setVolume(v) {
    easeParam(this, '_v', this.out.gain, Math.max(0, Math.min(1, v)), { minDelta: 0.01, tc: 0.05 });
  }

  setBrightness(b) {
    const x = Math.max(0, Math.min(1, b));
    easeParam(this, '_b', this.filter.frequency, 250 * Math.pow(48, x), { gate: x, minDelta: 0.015, tc: 0.04 });
  }

  silence() {
    if (!this.notes.length) return;
    this.synth.releaseAll?.();
    this.notes = [];
  }

  dispose() {
    this.silence();
    this.out.gain.rampTo(0, 0.3);
    setTimeout(() => {
      this.synth.dispose();
      this.filter.dispose();
      this.out.dispose();
    }, 1500);
  }
}

/**
 * Acorde con osciladores fijos que cambian de nota deslizándose (sin volver a atacar las notas).
 * Mismo uso que ChordVoice. El arpegio usa un sintetizador aparte con la misma onda.
 */
class GlideChordVoice {
  constructor(engine, def) {
    this.out = new Tone.Gain(0).connect(engine.bus);
    this.filter = new Tone.Filter({ frequency: 1200, type: 'lowpass', rolloff: -12, Q: 0.7 }).connect(this.out);
    this.level = def.level;
    this.voices = Array.from({ length: 4 }, () => {
      const g = new Tone.Gain(0).connect(this.filter);
      const o = new Tone.Oscillator({ type: def.wave, frequency: 220 }).connect(g);
      return { o, g, on: false };
    });
    this.started = false;
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: def.wave },
      envelope: { attack: 0.005, decay: 0.25, sustain: 0.25, release: 0.5 },
    }).connect(this.filter);
    this.synth.volume.value = Tone.gainToDb(this.level * 2.5);
    this.notes = [];
    this.key = '';
    this.arpeggio = false;
    this.arpIndex = 0;
    this.nextArp = 0;
    this.bpm = 110;
  }

  setChord(notes) {
    const next = notes || [];
    const key = next.join(',');
    if (this.arpeggio) {
      this.notes = next;
      this.key = key;
      return;
    }
    if (key === this.key) return;
    if (!this.started) {
      this.voices.forEach((v) => v.o.start());
      this.started = true;
    }
    const now = Tone.now();
    this.voices.forEach((v, i) => {
      if (i < next.length) {
        const f = Tone.Frequency(next[i], 'midi').toFrequency();
        // Si la voz estaba callada, empieza directamente en su nota; si no, se desliza.
        if (v.on) v.o.frequency.rampTo(f, 0.035, now);
        else v.o.frequency.setValueAtTime(f, now);
        v.g.gain.rampTo(this.level, 0.03, now);
        v.on = true;
      } else if (v.on) {
        v.g.gain.rampTo(0, 0.05, now);
        v.on = false;
      }
    });
    this.notes = next;
    this.key = key;
  }

  setArpeggio(on) {
    if (on === this.arpeggio) return;
    const keep = this.notes;
    this.silence();
    this.arpeggio = on;
    if (on) this.notes = keep;
    else this.setChord(keep);
  }

  tick() {
    ChordVoice.prototype.tick.call(this);
  }

  setVolume(v) {
    easeParam(this, '_v', this.out.gain, Math.max(0, Math.min(1, v)), { minDelta: 0.01, tc: 0.025 });
  }

  setBrightness(b) {
    const x = Math.max(0, Math.min(1, b));
    easeParam(this, '_b', this.filter.frequency, 300 * Math.pow(16, x), { gate: x, minDelta: 0.015, tc: 0.03 });
    // Poca resonancia: con más, los cambios de brillo "silbaban"
    easeParam(this, '_q', this.filter.Q, 0.7 + 0.6 * x, { gate: x, minDelta: 0.05, tc: 0.05 });
  }

  silence() {
    this.voices.forEach((v) => {
      if (v.on) v.g.gain.rampTo(0, 0.06);
      v.on = false;
    });
    this.synth.releaseAll();
    this.notes = [];
    this.key = '';
  }

  dispose() {
    this.silence();
    this.out.gain.rampTo(0, 0.2);
    setTimeout(() => {
      this.voices.forEach((v) => {
        if (this.started) v.o.stop();
        v.o.dispose();
        v.g.dispose();
      });
      this.synth.dispose();
      this.filter.dispose();
      this.out.dispose();
    }, 600);
  }
}

export const audio = new AudioEngine();
