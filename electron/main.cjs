// Proceso principal de Electron: ventana, archivos locales y carpeta de canciones.
const { app, BrowserWindow, protocol, ipcMain, shell, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DIST = path.join(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mid': 'audio/midi',
  '.kar': 'audio/midi',
};
const SONG_RE = /\.(mid|midi|kar)$/i;

// La detección de manos necesita WebGL. Si la tarjeta gráfica está en la lista
// negra de Chromium o no hay aceleración, se usa el renderizado por software.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function songsDir() {
  return path.join(app.getPath('documents'), 'Synth Manos', 'Canciones');
}

const EXAMPLES_DIR = 'Ejemplos';
const MARKER = '.ejemplos-copiados.json';

/**
 * Crea la carpeta de canciones y copia las de ejemplo en "Ejemplos".
 * Cada ejemplo se copia una sola vez: si el profe lo borra, no vuelve a aparecer.
 */
function ensureSongsDir() {
  const dir = songsDir();
  const firstTime = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  const markerPath = path.join(dir, MARKER);
  let copied = [];
  try {
    copied = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    /* primera vez */
  }
  const examples = path.join(DIST, 'songs');
  try {
    const pending = fs.readdirSync(examples).filter((f) => SONG_RE.test(f) && !copied.includes(f));
    if (pending.length) {
      const exDir = path.join(dir, EXAMPLES_DIR);
      fs.mkdirSync(exDir, { recursive: true });
      for (const f of pending) {
        // readFile + writeFile en lugar de copyFile: copyFile falla dentro del
        // paquete .asar con nombres con tildes o eñes ("Cumpleaños feliz.kar").
        try {
          const dest = path.join(exDir, f);
          if (!fs.existsSync(dest)) fs.writeFileSync(dest, fs.readFileSync(path.join(examples, f)));
          copied.push(f);
        } catch (e) {
          console.error('No se pudo copiar el ejemplo', f, e);
        }
      }
      fs.writeFileSync(markerPath, JSON.stringify(copied, null, 2));
      if (process.platform === 'win32') require('node:child_process').exec(`attrib +h "${markerPath}"`);
    }
    if (firstTime) {
      fs.writeFileSync(
        path.join(dir, 'LÉEME - cómo añadir canciones.txt'),
        [
          'CÓMO AÑADIR CANCIONES A SYNTH MANOS',
          '',
          '1. Copia en esta carpeta archivos MIDI (.mid) o karaoke (.kar).',
          '   Los .kar llevan la letra y sirven para el karaoke.',
          '2. Aparecen solos en la pestaña "Canciones" (no hace falta reiniciar).',
          '',
          'Puedes crear carpetas dentro de esta para ordenarlas, por ejemplo',
          '"Navidad" o "3º Primaria": cada carpeta aparece como una categoría.',
          '',
          'También puedes arrastrar los archivos directamente a la ventana de la app.',
          '',
        ].join('\r\n'),
      );
    }
  } catch (e) {
    console.error('No se pudieron copiar las canciones de ejemplo', e);
  }
  return dir;
}

/** Nombre de archivo sin caracteres que Windows no admite. */
function cleanName(name) {
  return String(name).replace(/[<>:"|?*\x00-\x1f]/g, '_').trim();
}

/**
 * Ruta segura dentro de la carpeta de canciones (admite una subcarpeta, "Navidad/Villancico.kar").
 * Impide salir de la carpeta con "..".
 */
function safeSongPath(rel) {
  const parts = String(rel).split(/[\\/]/).filter(Boolean).map(cleanName);
  if (!parts.length || parts.length > 2 || parts.some((p) => p === '.' || p === '..')) throw new Error('Ruta no permitida');
  if (!SONG_RE.test(parts[parts.length - 1])) throw new Error('Tipo de archivo no permitido');
  const root = songsDir();
  const full = path.resolve(root, ...parts);
  if (!full.startsWith(root + path.sep)) throw new Error('Ruta no permitida');
  return full;
}

async function listSongs() {
  const dir = ensureSongsDir();
  const out = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && SONG_RE.test(e.name)) {
      const st = await fs.promises.stat(path.join(dir, e.name));
      out.push({ name: e.name, category: '', size: st.size, mtime: st.mtimeMs });
    } else if (e.isDirectory() && !e.name.startsWith('.')) {
      let sub = [];
      try {
        sub = await fs.promises.readdir(path.join(dir, e.name));
      } catch {
        continue;
      }
      for (const f of sub) {
        if (!SONG_RE.test(f)) continue;
        const st = await fs.promises.stat(path.join(dir, e.name, f));
        out.push({ name: e.name + '/' + f, category: e.name, size: st.size, mtime: st.mtimeMs });
      }
    }
  }
  return out;
}

let watcher = null;
let watchTimer = null;

/** Avisa a la ventana cuando cambian los archivos de la carpeta de canciones. */
function watchSongs() {
  try {
    watcher?.close();
    watcher = fs.watch(ensureSongsDir(), { recursive: true }, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => win?.webContents.send('songs:changed'), 400);
    });
    watcher.on('error', () => {});
  } catch (e) {
    console.warn('No se puede vigilar la carpeta de canciones', e);
  }
}

function registerIpc() {
  ipcMain.handle('songs:list', () => listSongs());
  ipcMain.handle('songs:read', async (_e, name) => {
    const buf = await fs.promises.readFile(safeSongPath(name));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  ipcMain.handle('songs:save', async (_e, name, bytes, category = '') => {
    ensureSongsDir();
    const base = cleanName(path.basename(String(name)));
    const rel = category ? cleanName(category) + '/' + base : base;
    const full = safeSongPath(rel);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, Buffer.from(bytes));
    return rel;
  });
  ipcMain.handle('songs:trash', async (_e, name) => {
    await shell.trashItem(safeSongPath(name));
    return true;
  });
  ipcMain.handle('songs:folder', () => ensureSongsDir());
  ipcMain.handle('songs:open', () => shell.openPath(ensureSongsDir()));
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('Prohibido', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, {
        headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' },
      });
    } catch {
      return new Response('No encontrado', { status: 404 });
    }
  });
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#0f1020',
    title: 'Synth Manos',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.loadURL('app://synth/index.html');

  // Los enlaces externos se abren en el navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
    if (input.key === 'F5') win.webContents.reload();
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  registerProtocol();
  registerIpc();
  createWindow();
  watchSongs();
});

app.on('window-all-closed', () => app.quit());
