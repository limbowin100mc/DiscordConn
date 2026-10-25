'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.off('state', handler);
  },
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setService: (id, patch) => ipcRenderer.invoke('service:set', id, patch),
  testService: (id) => ipcRenderer.invoke('service:test', id),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openFolder: (which) => ipcRenderer.invoke('app:open-folder', which),
  copy: (text) => ipcRenderer.invoke('app:copy', text),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
});
