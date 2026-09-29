// Motor de audio: instrumentos, efectos y voces continuas para el modo cámara.
import * as Tone from 'tone';
import { settings, onSettingsChange } from './settings.js';
import { toneName, midiToFreq } from './notes.js';

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

class AudioEngine {
  constructor() {
    this.ready = false;
    this.poly = new Map();
    this.pianoLoaded = false;
  }

  /** Debe llamarse tras un gesto del usuario (clic/toque). */
  async init() {
    if (this.ready) return;
    await Tone.start();
    Tone.getContext().lookAhead = 0.02;

    this.master = new Tone.Volume(Tone.gainToDb(settings.masterVolume));
    this.limiter = new Tone.Limiter(-1);
    this.reverb = new Tone.Reverb({ decay: 2.8, preDelay: 0.02, wet: settings.reverb });
    this.delay = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.3, wet: settings.delay });
    this.analyser = new Tone.Waveform(1024);
    this.meter = new Tone.Meter({ smoothing: 0.8 });
    this.bus = new Tone.Gain(0.8);
    this.bus.chain(this.delay, this.reverb, this.master, this.limiter, Tone.getDestination());
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
      if (k === 'reverb') this.reverb.wet.rampTo(v, 0.1);
      if (k === 'delay') this.delay.wet.rampTo(v, 0.1);
      if (k === 'accompanimentVolume') this.accBus.gain.rampTo(v, 0.1);
    });

    this.ready = true;
    this.loadPiano();
  }

  loadPiano() {
    if (this.pianoPromise) return this.pianoPromise;
    this.pianoPromise = new Promise((resolve) => {
      const s = new Tone.Sampler({
        urls: PIANO_SAMPLES,
        baseUrl: './samples/piano/',
        release: 1.2,
        onload: () => {
          this.pianoLoaded = true;
          resolve(s);
        },
        onerror: () => resolve(s),
      });
      this._pianoSampler = s;
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
      s.volume.value = -4;
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
    synth.volume.value = -10;
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

  /** Voz de acordes para el modo "Acordes con gestos". */
  createChordVoice(instrument = 'suave') {
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
    this.osc.volume.value = -8;
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
    if (this.active && this.out) this.out.gain.rampTo(g * 0.9, 0.05);
  }

  setBrightness(b) {
    // b en [0,1] → frecuencia de corte del filtro
    if (!this.filter) return;
    const f = 300 * Math.pow(40, b);
    this.filter.frequency.rampTo(f, 0.05);
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
    if (add.length) this.synth.triggerAttack(this._names(add), '+0.01', 0.55);
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
    this.out.gain.rampTo(Math.max(0, Math.min(1, v)) * 0.9, 0.08);
  }

  setBrightness(b) {
    this.filter.frequency.rampTo(250 * Math.pow(48, Math.max(0, Math.min(1, b))), 0.08);
  }

  silence() {
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

export const audio = new AudioEngine();
