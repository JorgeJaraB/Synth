// Puente seguro entre la interfaz y el sistema de archivos (solo la carpeta de canciones).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('synthAPI', {
  listSongs: () => ipcRenderer.invoke('songs:list'),
  readSong: (name) => ipcRenderer.invoke('songs:read', name),
  saveSong: (name, bytes, category) => ipcRenderer.invoke('songs:save', name, bytes, category),
  trashSong: (name) => ipcRenderer.invoke('songs:trash', name),
  onSongsChanged: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('songs:changed', listener);
    return () => ipcRenderer.removeListener('songs:changed', listener);
  },
  songsFolder: () => ipcRenderer.invoke('songs:folder'),
  openSongsFolder: () => ipcRenderer.invoke('songs:open'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  canSendReport: () => ipcRenderer.invoke('report:can-send'),
  sendReport: (title, body) => ipcRenderer.invoke('report:send', title, body),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (fn) => {
    const listener = (_e, info) => fn(info);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  recStart: (ext) => ipcRenderer.invoke('rec:start', ext),
  recChunk: (id, bytes) => ipcRenderer.invoke('rec:chunk', id, bytes),
  recEnd: (id) => ipcRenderer.invoke('rec:end', id),
  recordingsFolder: () => ipcRenderer.invoke('rec:folder'),
  openRecordingsFolder: () => ipcRenderer.invoke('rec:open-folder'),
  showRecording: (file) => ipcRenderer.invoke('rec:show', file),
});
