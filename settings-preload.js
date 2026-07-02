const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  getState: () => ipcRenderer.invoke('settings:get-state'),
  setOption: (key, value) => ipcRenderer.invoke('settings:set-option', { key, value }),
  clearCache: (clearSessionData) => ipcRenderer.invoke('settings:clear-cache', { clearSessionData }),
  updateAction: () => ipcRenderer.invoke('settings:update-action'),
  openUserData: () => ipcRenderer.invoke('settings:open-user-data'),
  onStateUpdated: (callback) => {
    const handler = (event, state) => callback(state);
    ipcRenderer.on('settings-state-updated', handler);
    return () => ipcRenderer.removeListener('settings-state-updated', handler);
  },
});
