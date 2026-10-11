import test from 'node:test';
import assert from 'node:assert/strict';
import { SongPlayer } from '../src/core/player.js';

// Tres acordes seguidos de 2 s (como en el karaoke de acordes: el "midi" es un código de acorde)
const song = { tracks: [], beats: [], duration: 6, melodyTrack: 0 };
const chords = () => [
  { midi: 10, time: 0, duration: 2 },
  { midi: 40, time: 2, duration: 2 },
  { midi: 50, time: 4, duration: 2 },
];

test('Reto: cambiar de acorde a tiempo cuenta', () => {
  const p = new SongPlayer(song, { practiceTrack: -1, practice: chords(), mode: 'tiempo' });
  p.time = 0;
  assert.equal(p.input(10, { since: -1 }), true); // el primero, preparado antes de empezar: vale
  p.time = 2.05;
  assert.equal(p.input(40, { since: 1.95 }), true);
  assert.equal(p.score.hits, 2);
});

test('Reto: cambiar antes de tiempo (cortando el acorde anterior) es fallo', () => {
  const p = new SongPlayer(song, { practiceTrack: -1, practice: chords(), mode: 'tiempo' });
  let early = 0;
  p.on('early', () => early++);
  p.time = 0;
  p.input(10, { since: -1 });
  // Cambia al IV un segundo antes: cuando se abre su margen, no se le da por bueno
  p.time = 1.8;
  assert.equal(p.input(40, { since: 1.0 }), false);
  assert.equal(early, 1);
  assert.equal(p.practice[1].state, 'miss');
  assert.equal(p.score.streak, 0);
});

test('Reto: un código distinto (p. ej. mayor en vez de menor) no vale', () => {
  const p = new SongPlayer(song, { practiceTrack: -1, practice: chords(), mode: 'tiempo' });
  p.time = 0;
  assert.equal(p.input(11, { since: -1 }), false); // grado 1 pero menor
});

test('Practicar: adelantarse sigue la canción pero sin puntos ni racha', () => {
  const p = new SongPlayer(song, { practiceTrack: -1, practice: chords(), mode: 'esperar' });
  p.time = 0;
  p.waiting = [p.practice[0]];
  p.input(10, { since: -1 });
  const pts = p.score.points;
  p.time = 2;
  p.waiting = [p.practice[1]];
  assert.equal(p.input(40, { since: 1.0 }), true);
  assert.equal(p.practice[1].early, true);
  assert.equal(p.score.points, pts);
  assert.equal(p.score.streak, 0);
});

test('acordes que pone la app: no se esperan, no se puntúan y sobreviven a reiniciar', async () => {
  const { SongPlayer } = await import('../src/core/player.js');
  const song = { duration: 10, tracks: [], beats: [], melodyTrack: 0, lines: [] };
  let auto = new Set([20]);
  const practice = [{ midi: 10, time: 0.5, duration: 1 }, { midi: 20, time: 1.5, duration: 1 }, { midi: 10, time: 2.5, duration: 1 }];
  const p = new SongPlayer(song, { practice, practiceTrack: -1, mode: 'esperar', isAuto: (n) => auto.has(n.midi) });
  assert.equal(p.practice[1].state, 'auto');
  assert.equal(p.playableCount, 2);
  p.restart();
  assert.equal(p.practice[1].state, 'auto');
  // En Practicar no se queda esperando al acorde que pone la app
  p.seek(1.4);
  p.play();
  p.update();
  assert.ok(!p.waiting || p.waiting.every((n) => n.midi !== 20));
  // Si el niño ya lo sabe, vuelve a ser suyo
  auto = new Set();
  p.refreshAuto();
  assert.equal(p.practice[1].state, null);
});
