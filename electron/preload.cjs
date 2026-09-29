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
});
