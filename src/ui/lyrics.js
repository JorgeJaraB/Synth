// Letra de karaoke con "bolita" que salta de sílaba en sílaba.
import { h } from './dom.js';
import { noteColor } from '../core/notes.js';

export class LyricsView {
  constructor(parent, { size = 'normal' } = {}) {
    this.cur = h('div.lyric-line.current');
    this.next = h('div.lyric-line.next');
    this.ball = h('div.lyric-ball');
    this.el = h('div.lyrics', { class: 'lyrics size-' + size }, h('div.lyric-cur-wrap', this.ball, this.cur), this.next);
    parent.append(this.el);
    this.lineIndex = -1;
  }

  /**
   * Acordes para mostrar encima de la letra (como en un cancionero).
   * @param chords  [{ time, ... }]
   * @param label   (acorde) => { text, color }
   */
  setChords(chords, label) {
    this.chords = chords;
    this.chordLabel = label;
    this.lineIndex = -1; // forzar redibujado
  }

  /** Acorde que empieza en esta sílaba (o el que suena al empezar la línea). */
  _chordFor(line, i) {
    if (!this.chords?.length) return null;
    const s = line.syllables[i];
    const from = i === 0 ? -Infinity : s.time - 0.15;
    const to = (line.syllables[i + 1]?.time ?? line.end) - 0.15;
    let c = this.chords.find((ch) => ch.time >= from && ch.time < to && (i > 0 || ch.time >= s.time - 0.15));
    if (!c && i === 0) c = [...this.chords].reverse().find((ch) => ch.time <= s.time + 0.05);
    return c || null;
  }

  _renderLine(target, line) {
    target.replaceChildren(
      ...(line
        ? line.syllables.map((s, i) => {
            const el = h('span.syl', { style: s.midi != null ? { '--c': noteColor(s.midi) } : {} }, s.text);
            const c = this._chordFor(line, i);
            if (c) {
              const { text, color } = this.chordLabel(c);
              el.dataset.chord = text;
              el.style.setProperty('--chord', color);
              el.classList.add('has-chord');
            }
            return el;
          })
        : []),
    );
  }

  update(state, time) {
    if (!state) {
      this.el.classList.add('empty');
      return;
    }
    this.el.classList.remove('empty');
    if (state.lineIndex !== this.lineIndex) {
      this.lineIndex = state.lineIndex;
      this._renderLine(this.cur, state.line);
      this._renderLine(this.next, state.next);
      this.spans = [...this.cur.children];
    }
    const syl = state.line.syllables;
    this.spans.forEach((sp, i) => {
      const s = syl[i];
      const end = syl[i + 1]?.time ?? state.line.end;
      const p = time < s.time ? 0 : time >= end ? 1 : (time - s.time) / Math.max(0.05, Math.min(end - s.time, 1.2));
      sp.style.setProperty('--p', Math.min(1, p) * 100 + '%');
      sp.classList.toggle('active', i === state.syllableIndex);
      sp.classList.toggle('sung', time >= s.time);
    });
    this._placeBall(state, time);
  }

  _placeBall(state, time) {
    const syl = state.line.syllables;
    if (!this.spans?.length) return;
    const wrapRect = this.cur.getBoundingClientRect();
    const center = (i) => {
      const r = this.spans[i].getBoundingClientRect();
      return { x: r.left - wrapRect.left + r.width / 2, y: r.top - wrapRect.top };
    };
    let i = state.syllableIndex;
    let x, y, lift;
    const jump = Math.min(40, wrapRect.height * 0.5 + 10);
    if (i < 0) {
      // Antes de la primera sílaba: rebotes de entrada
      const c = center(0);
      const until = syl[0].time - time;
      x = c.x;
      y = c.y;
      lift = Math.abs(Math.sin(until * Math.PI * 1.6)) * jump * 0.6;
    } else {
      const a = center(i);
      const nextT = syl[i + 1]?.time;
      if (nextT == null) {
        x = a.x;
        y = a.y;
        lift = 0;
      } else {
        const b = center(i + 1);
        const p = Math.min(1, (time - syl[i].time) / Math.max(0.05, nextT - syl[i].time));
        x = a.x + (b.x - a.x) * p;
        y = a.y + (b.y - a.y) * p;
        lift = Math.sin(p * Math.PI) * jump;
      }
    }
    this.ball.style.transform = `translate(${x}px, ${y - lift - 14}px)`;
  }

  destroy() {
    this.el.remove();
  }
}
