// Tests de privacidad: las grabaciones y la cámara nunca deben poder salir del ordenador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scrubPaths } from '../src/core/diagnostics.js';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('los reportes no llevan rutas ni nombres de vídeos', () => {
  assert.equal(scrubPaths('Error en C:\\Users\\ana.garcia\\Documents\\Synth Manos\\Grabaciones\\clase.mp4'), 'Error en <ruta>');
  assert.equal(scrubPaths('file:///C:/Users/ana/x.webm falló'), '<ruta>');
  assert.equal(scrubPaths('Guardado Synth Manos 2026-09-29 18.52.01.webm'), '<archivo de vídeo>');
  assert.equal(scrubPaths('acorde Sol'), 'acorde Sol');
});

test('la interfaz no puede conectarse a ningún servidor de internet (CSP)', () => {
  const csp = read('index.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const connect = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'));
  assert.ok(connect, 'falta connect-src');
  assert.ok(!/https?:|\*|wss?:/.test(connect), 'connect-src permite conexiones externas: ' + connect);
});

test('el grabador no tiene ningún código de red', () => {
  const src = read('src/core/recorder.js');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'http://', 'https://']) {
    assert.ok(!src.includes(bad), 'recorder.js contiene ' + bad);
  }
});

test('el envío de reportes solo acepta texto y lo limpia', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /typeof title !== 'string' \|\| typeof body !== 'string'/);
  assert.match(main, /body = scrubPrivate\(body\)/);
  // Las grabaciones solo se escriben en disco local
  const rec = main.slice(main.indexOf("ipcMain.handle('rec:start'"), main.indexOf("ipcMain.handle('rec:folder'"));
  assert.ok(!/net\.fetch|https?:/.test(rec), 'el código de grabación usa la red');
});

test('YouTube (prueba): ningún código de fuera se carga en la app y el vídeo va aislado', () => {
  const csp = read('index.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const dir = (name) => csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ')) || '';
  assert.ok(!/https?:|\*/.test(dir('script-src')), 'script-src permite código de internet: ' + dir('script-src'));
  assert.equal(dir('frame-src'), 'frame-src https://www.youtube-nocookie.com');
  const yt = read('src/core/youtube.js');
  assert.match(yt, /setAttribute\('sandbox', 'allow-scripts allow-same-origin allow-presentation'\)/);
  for (const bad of ['fetch(', 'XMLHttpRequest', 'iframe_api', 'createElement(\'script\')']) assert.ok(!yt.includes(bad), 'youtube.js contiene ' + bad);
});
