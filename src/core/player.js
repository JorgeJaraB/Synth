// Reproductor de canciones con reloj propio: acompañamiento, modo "esperar" y puntuación.
import { audio } from './audio.js';
import { settings } from './settings.js';

const LOOKAHEAD = 0.15; // segundos que se programan por adelantado
const HIT_WINDOW = 0.28; // margen para acertar una nota en tiempo real
const CHORD_EPS = 0.05;

export class SongPlayer {
  /**
   * @param {object} song  resultado de parseSong
   * @param {object} opts
   *  - practice: array de notas a practicar (la melodía)
   *  - practiceTrack: índice de la pista que toca el alumno (no se incluye en el acompañamiento)
   *  - mode: 'escuchar' | 'esperar' | 'tiempo'
   *  - instrument: instrumento para la melodía cuando suena sola
   */
  constructor(song, opts = {}) {
    this.song = song;
    this.practiceTrack = opts.practiceTrack ?? song.melodyTrack;
    this.practice = (opts.practice || song.tracks[this.practiceTrack]?.notes || []).map((n, i) => ({ ...n, id: i, state: null }));
    this.mode = opts.mode || 'escuchar';
    this.instrument = opts.instrument || settings.pianoInstrument;
    this.muted = new Set(opts.muted || []);
    this.speed = settings.tutorialSpeed;
    this.time = opts.startAt ?? -1.5; // pequeña cuenta atrás antes de empezar
    this.playing = false;
    this.waiting = null;
    this.listeners = { end: new Set(), hit: new Set(), miss: new Set() };
    this.score = { hits: 0, misses: 0, streak: 0, best: 0, points: 0 };
    this._resetPointers();
  }

  on(ev, fn) {
    this.listeners[ev].add(fn);
    return () => this.listeners[ev].delete(fn);
  }
  _emit(ev, x) {
    for (const fn of this.listeners[ev]) fn(x);
  }

  get duration() {
    return this.song.duration;
  }

  _resetPointers() {
    this.ptr = this.song.tracks.map((tr) => {
      let i = 0;
      while (i < tr.notes.length && tr.notes[i].time < this.time) i++;
      return i;
    });
    this.practicePtr = this.practice.findIndex((n) => n.time >= this.time - 0.001);
    if (this.practicePtr < 0) this.practicePtr = this.practice.length;
    this.beatPtr = this.song.beats.findIndex((b) => b.time >= this.time);
    if (this.beatPtr < 0) this.beatPtr = this.song.beats.length;
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this._last = audio.now();
  }

  pause() {
    this.playing = false;
    audio.releaseAll();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t) {
    this.time = Math.max(-1.5, Math.min(t, this.duration));
    this.waiting = null;
    for (const n of this.practice) if (n.time >= this.time) n.state = null;
    audio.releaseAll();
    this._resetPointers();
    this._last = audio.now();
  }

  restart() {
    this.score = { hits: 0, misses: 0, streak: 0, best: 0, points: 0 };
    for (const n of this.practice) n.state = null;
    this.seek(-1.5);
  }

  /** Notas que el alumno debe tocar ahora mismo (modo esperar). */
  expectedNow() {
    return this.waiting ? this.waiting.filter((n) => n.state !== 'hit') : [];
  }

  /**
   * El alumno ha tocado una nota. Devuelve true si era correcta.
   * Con penalize=false un fallo no rompe la racha (útil para notas mantenidas).
   */
  input(midi, { penalize = true } = {}) {
    if (this.mode === 'esperar') {
      const target = this.waiting?.find((n) => n.midi === midi && n.state !== 'hit');
      if (target) {
        this._hit(target);
        if (this.expectedNow().length === 0) this.waiting = null;
        return true;
      }
      // Permitimos tocar la siguiente nota un poco antes de que llegue.
      const early = this.practice.find((n) => !n.state && n.midi === midi && n.time - this.time < 0.25 && n.time >= this.time - 0.01);
      if (early) {
        this._hit(early);
        return true;
      }
      return false;
    }
    if (this.mode === 'tiempo') {
      let best = null;
      for (let i = Math.max(0, this.practicePtr - 8); i < this.practice.length; i++) {
        const n = this.practice[i];
        if (n.time > this.time + HIT_WINDOW) break;
        if (n.state || n.midi !== midi) continue;
        const d = Math.abs(n.time - this.time);
        if (d <= HIT_WINDOW && (!best || d < best.d)) best = { n, d };
      }
      if (best) {
        this._hit(best.n, best.d);
        return true;
      }
      if (penalize) this.score.streak = 0;
      return false;
    }
    return false;
  }

  _hit(n, delta = 0) {
    n.state = 'hit';
    this.score.hits++;
    this.score.streak++;
    this.score.best = Math.max(this.score.best, this.score.streak);
    const precision = 1 - Math.min(1, delta / HIT_WINDOW);
    this.score.points += Math.round(50 + 50 * precision) * Math.min(4, 1 + Math.floor(this.score.streak / 10));
    this._emit('hit', n);
  }

  /** Avanza el reloj; llamar en cada fotograma. */
  update() {
    const now = audio.now();
    if (!this.playing) {
      this._last = now;
      return;
    }
    const dt = Math.min(0.25, now - this._last) * this.speed;
    this._last = now;

    if (this.mode === 'esperar' && !this.waiting) {
      // ¿Llegamos a la siguiente nota pendiente? Entonces paramos y esperamos.
      const next = this.practice.find((n, i) => i >= this.practicePtr - 4 && !n.state && n.time >= this.time - 0.001);
      if (next && this.time + dt >= next.time) {
        this.time = next.time;
        this.waiting = this.practice.filter((n) => !n.state && Math.abs(n.time - next.time) < CHORD_EPS);
      } else this.time += dt;
    } else if (!(this.mode === 'esperar' && this.waiting)) {
      this.time += dt;
    }

    while (this.practicePtr < this.practice.length && this.practice[this.practicePtr].time < this.time - HIT_WINDOW) {
      const n = this.practice[this.practicePtr];
      if (this.mode === 'tiempo' && !n.state) {
        n.state = 'miss';
        this.score.misses++;
        this.score.streak = 0;
        this._emit('miss', n);
      }
      this.practicePtr++;
    }

    this._schedule(now);

    if (this.time >= this.duration + 0.5) {
      this.playing = false;
      this._emit('end', this.score);
    }
  }

  _schedule(now) {
    const horizonSong = this.time + LOOKAHEAD * this.speed;
    const limit = this.mode === 'esperar' ? this._nextPendingTime() : Infinity;
    const until = Math.min(horizonSong, limit);
    const toAudio = (t) => now + Math.max(0, (t - this.time) / this.speed);

    this.song.tracks.forEach((tr, ti) => {
      const isPractice = ti === this.practiceTrack;
      let audible = isPractice ? this.mode === 'escuchar' : settings.accompaniment;
      // Pistas silenciadas mientras el alumno las toca él (p. ej. los acordes en el karaoke de acordes).
      if (this.muted.has(ti) && this.mode !== 'escuchar') audible = false;
      const notes = tr.notes;
      let i = this.ptr[ti];
      while (i < notes.length && notes[i].time < until) {
        const n = notes[i];
        if (audible && n.time >= this.time - 0.05) {
          const dur = n.duration / this.speed;
          if (tr.isDrum) audio.playDrum(n.midi, toAudio(n.time), n.velocity * 0.8);
          else if (isPractice) audio.playNote(n.midi, dur, toAudio(n.time), n.velocity, this.instrument, 'main');
          else audio.playNote(n.midi, dur, toAudio(n.time), n.velocity * 0.8, 'piano', 'acc');
        }
        i++;
      }
      this.ptr[ti] = i;
    });

    const beats = this.song.beats;
    while (this.beatPtr < beats.length && beats[this.beatPtr].time < until) {
      const b = beats[this.beatPtr];
      if (settings.metronome && b.time >= this.time - 0.05) audio.tick(toAudio(b.time), b.accent);
      this.beatPtr++;
    }
  }

  _nextPendingTime() {
    if (this.waiting) return this.time;
    const next = this.practice.find((n, i) => i >= this.practicePtr - 4 && !n.state && n.time >= this.time - 0.001);
    return next ? next.time : Infinity;
  }

  /** Línea de letra activa y la sílaba actual (para el karaoke). */
  lyricState() {
    const lines = this.song.lines;
    if (!lines.length) return null;
    let li = lines.findIndex((l) => this.time < l.end);
    if (li < 0) li = lines.length - 1;
    const line = lines[li];
    let si = -1;
    line.syllables.forEach((s, i) => {
      if (s.time <= this.time) si = i;
    });
    return { lineIndex: li, line, syllableIndex: si, next: lines[li + 1] || null };
  }
}
