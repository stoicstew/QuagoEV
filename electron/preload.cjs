const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quagoev', Object.freeze({
  credentials: Object.freeze({
    get: () => ipcRenderer.invoke('quagoev:credentials:get'),
    set: (value) => ipcRenderer.invoke('quagoev:credentials:set', { serverUrl: value?.serverUrl, token: value?.token }),
    clear: () => ipcRenderer.invoke('quagoev:credentials:clear'),
  }),
}));
