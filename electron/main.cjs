// Proceso principal de Electron: ventana, archivos locales y carpeta de canciones.
const { app, BrowserWindow, protocol, ipcMain, shell, session, Menu, desktopCapturer, net } = require('electron');

/** Repositorio de GitHub donde se crean los reportes de problemas. */
const REPORT_REPO = 'JorgeJaraB/Synth';
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
const SONG_RE = /\.(mid|midi|kar|musicxml|mxl|xml)$/i;

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

/**
 * Quita del texto de un reporte cualquier dato que pueda identificar al equipo o a las personas:
 * rutas de archivos (p. ej. la de un vídeo grabado), nombre de usuario y nombre del equipo.
 */
function scrubPrivate(text) {
  const os = require('node:os');
  // Las rutas pueden tener espacios: se borra hasta el final de la línea (mejor de más que de menos).
  let out = String(text)
    .replace(/[A-Za-z]:\\[^\n"'<>|]*/g, '<ruta>')
    .replace(/\\\\[^\n"'<>|]+/g, '<ruta>')
    .replace(/file:\/\/[^\n"'<>)]+/gi, '<ruta>')
    .replace(/\/(?:home|Users)\/[^\n"'<>)]*/g, '<ruta>')
    .replace(/[^\n"'<>]*\.(?:mp4|webm|mkv|mov)\b/gi, '<archivo de vídeo>');
  for (const secret of [os.userInfo().username, os.hostname()]) {
    if (secret && secret.length > 2) out = out.split(secret).join('<privado>');
  }
  return out;
}

function recordingsDir() {
  return path.join(app.getPath('documents'), 'Synth Manos', 'Grabaciones');
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
  // Cambiar el nombre de una canción (se queda en su carpeta y conserva la extensión).
  ipcMain.handle('songs:rename', async (_e, name, newBase) => {
    const from = safeSongPath(name);
    const ext = path.extname(from);
    const base = cleanName(path.basename(String(newBase))).replace(/\.(mid|midi|kar|musicxml|mxl|xml)$/i, '').slice(0, 80);
    if (!base) throw new Error('Nombre vacío');
    const dir = path.dirname(String(name).replace(/\\/g, '/'));
    const rel = (dir && dir !== '.' ? dir + '/' : '') + base + ext;
    const to = safeSongPath(rel);
    if (to === from) return rel;
    if (to.toLowerCase() === from.toLowerCase()) {
      // Solo cambian mayúsculas/minúsculas (Windows no distingue): se pasa por un nombre temporal
      const tmp = from + '.renombrando';
      await fs.promises.rename(from, tmp);
      await fs.promises.rename(tmp, to);
      return rel;
    }
    if (fs.existsSync(to)) throw new Error('Ya existe');
    await fs.promises.rename(from, to);
    return rel;
  });
  ipcMain.handle('songs:trash', async (_e, name) => {
    await shell.trashItem(safeSongPath(name));
    return true;
  });
  ipcMain.handle('songs:folder', () => ensureSongsDir());
  ipcMain.handle('songs:open', () => shell.openPath(ensureSongsDir()));

  // ---------- Grabaciones de vídeo ----------
  // Se escriben por trozos mientras se graba (no se acumula todo en memoria).
  const recordings = new Map();
  ipcMain.handle('rec:start', async (_e, ext) => {
    const dir = recordingsDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
    const safeExt = ext === 'mp4' ? 'mp4' : 'webm';
    const file = path.join(dir, `Synth Manos ${stamp}.${safeExt}`);
    const id = String(Date.now());
    recordings.set(id, { file, stream: fs.createWriteStream(file) });
    return id;
  });
  ipcMain.handle('rec:chunk', (_e, id, bytes) => {
    const r = recordings.get(id);
    if (!r) return false;
    return new Promise((resolve) => r.stream.write(Buffer.from(bytes), () => resolve(true)));
  });
  ipcMain.handle('rec:end', (_e, id) => {
    const r = recordings.get(id);
    if (!r) return null;
    recordings.delete(id);
    return new Promise((resolve) => r.stream.end(() => resolve(r.file)));
  });
  ipcMain.handle('rec:folder', () => recordingsDir());
  ipcMain.handle('app:version', () => app.getVersion());

  // ---------- Reportes de problemas sin cuenta de GitHub ----------
  // El token (solo con permiso para crear incidencias en este repositorio) lo añade GitHub
  // Actions al compilar, desde el secreto ISSUES_TOKEN. Si no hay, se usa la web de GitHub.
  const reportToken = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, 'report-config.json'), 'utf8')).token || null;
    } catch {
      return null;
    }
  })();
  let lastReport = 0;
  ipcMain.handle('report:can-send', () => !!reportToken);
  ipcMain.handle('report:send', async (_e, title, body) => {
    if (!reportToken) return { ok: false, reason: 'no-token' };
    // Privacidad: solo se envía TEXTO, y se limpia de rutas, usuario y nombre del equipo.
    if (typeof title !== 'string' || typeof body !== 'string') return { ok: false, reason: 'formato' };
    title = scrubPrivate(title);
    body = scrubPrivate(body);
    if (Date.now() - lastReport < 20000) return { ok: false, reason: 'too-fast' };
    lastReport = Date.now();
    try {
      const api = process.env.SYNTH_REPORT_API || 'https://api.github.com'; // (variable solo para pruebas)
      const res = await net.fetch(`${api}/repos/${REPORT_REPO}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${reportToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'SynthManos',
        },
        body: JSON.stringify({ title: String(title).slice(0, 200), body: String(body).slice(0, 60000), labels: ['bug'] }),
      });
      if (!res.ok) return { ok: false, reason: 'http-' + res.status };
      const issue = await res.json();
      return { ok: true, number: issue.number, url: issue.html_url };
    } catch (e) {
      return { ok: false, reason: 'offline', message: String(e?.message || e) };
    }
  });
  ipcMain.handle('update:check', async () => {
    if (!updater) return { status: app.isPackaged ? 'unavailable' : 'dev' };
    try {
      await updater.checkForUpdates();
      return { status: 'checking' };
    } catch (e) {
      return { status: 'error', message: String(e?.message || e) };
    }
  });
  ipcMain.handle('update:install', () => {
    // isSilent = true: se instala sin mostrar el asistente; isForceRunAfter = true: se vuelve a abrir.
    updater?.quitAndInstall(true, true);
  });
  ipcMain.handle('rec:open-folder', async () => {
    await fs.promises.mkdir(recordingsDir(), { recursive: true });
    return shell.openPath(recordingsDir());
  });
  ipcMain.handle('rec:show', (_e, file) => {
    // Solo archivos dentro de la carpeta de grabaciones.
    const full = path.resolve(String(file));
    if (full.startsWith(recordingsDir() + path.sep)) shell.showItemInFolder(full);
  });
}

// ---------- Actualización automática ----------
// La app instalada mira en las Releases de GitHub si hay una versión nueva, la descarga
// en segundo plano y la instala al cerrarse (o al pulsar "Reiniciar ahora").
let updater = null;
function sendUpdate(status, extra = {}) {
  win?.webContents.send('update:status', { status, ...extra });
}
function setupAutoUpdate() {
  if (!app.isPackaged || process.env.SYNTH_NO_UPDATE) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (e) {
    console.error('Sin actualizaciones automáticas', e);
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => sendUpdate('checking'));
  updater.on('update-available', (i) => sendUpdate('downloading', { version: i.version }));
  updater.on('update-not-available', () => sendUpdate('latest'));
  updater.on('download-progress', (p) => sendUpdate('progress', { percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (i) => sendUpdate('ready', { version: i.version }));
  updater.on('error', (e) => sendUpdate('error', { message: String(e?.message || e).slice(0, 200) }));
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000); // al arrancar (sin retrasar la apertura)
  setInterval(check, 2 * 60 * 60 * 1000); // y cada 2 horas si se deja abierta
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
  // Minimizada: la interfaz pausa la detección de manos (la página no se entera sola porque
  // backgroundThrottling está desactivado).
  const sendVisible = (v) => win && !win.isDestroyed() && win.webContents.send('win:visible', v);
  win.on('minimize', () => sendVisible(false));
  win.on('hide', () => sendVisible(false));
  win.on('restore', () => sendVisible(true));
  win.on('show', () => sendVisible(true));

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
  const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write', 'display-capture']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  // Grabación: se captura siempre la propia ventana de la app, sin preguntar qué pantalla.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      const own = win && sources.find((s) => s.id === win.getMediaSourceId());
      callback({ video: own || sources.find((s) => s.id.startsWith('screen')) || sources[0] });
    } catch (e) {
      console.error('No se pudo capturar la ventana', e);
      callback({});
    }
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  registerProtocol();
  registerIpc();
  createWindow();
  watchSongs();
  setupAutoUpdate();
});

app.on('window-all-closed', () => app.quit());
