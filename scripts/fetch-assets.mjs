// Descarga (una sola vez) los recursos que la app necesita para funcionar sin internet:
//  - Modelo de detección de manos de MediaPipe
//  - Archivos WebAssembly de MediaPipe (copiados desde node_modules)
//  - Muestras del piano "Salamander Grand Piano" (CC-BY 3.0, Alexander Holm)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PIANO_BASE = 'https://raw.githubusercontent.com/Tonejs/audio/master/salamander/';
export const PIANO_NOTES = [];
for (let o = 1; o <= 7; o++) for (const n of ['C', 'Ds', 'Fs', 'A']) PIANO_NOTES.push(n + o);
PIANO_NOTES.unshift('A0');
PIANO_NOTES.push('C8');

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function main() {
  // WASM de MediaPipe
  const wasmSrc = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
  const wasmDst = path.join(pub, 'mediapipe/wasm');
  fs.rmSync(wasmDst, { recursive: true, force: true });
  fs.mkdirSync(wasmDst, { recursive: true });
  // La variante "module" solo se usa en workers de tipo módulo: no la necesitamos.
  for (const f of fs.readdirSync(wasmSrc)) {
    if (!f.includes('_module_')) fs.copyFileSync(path.join(wasmSrc, f), path.join(wasmDst, f));
  }
  console.log('✔ WASM de MediaPipe copiado');

  if (await download(MODEL_URL, path.join(pub, 'models/hand_landmarker.task'))) console.log('✔ Modelo de manos descargado');
  else console.log('• Modelo de manos ya presente');

  let n = 0;
  for (const note of PIANO_NOTES) {
    if (await download(PIANO_BASE + note + '.mp3', path.join(pub, 'samples/piano', note + '.mp3'))) n++;
  }
  console.log(`✔ Muestras de piano listas (${n} nuevas, ${PIANO_NOTES.length} en total)`);
}

main().catch((e) => {
  console.error('✘ Error preparando recursos:', e.message);
  process.exit(1);
});
