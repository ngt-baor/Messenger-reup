const { contextBridge, ipcRenderer, webFrame } = require('electron');
const { buildPrivacyPatchScript } = require('./privacy');

function applyPrivacySettings(settings = {}) {
  webFrame.executeJavaScript(buildPrivacyPatchScript(settings), true).catch(() => {});
}

applyPrivacySettings(ipcRenderer.sendSync('get-settings'));
ipcRenderer.on('privacy-settings-updated', (event, settings) => {
  applyPrivacySettings(settings);
});

contextBridge.exposeInMainWorld('messengerApp', {
  toggleDarkMode: () => ipcRenderer.send('toggle-dark-mode'),
  toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),
  reloadPage: () => ipcRenderer.send('reload-page'),
  zoomIn: () => ipcRenderer.send('zoom-in'),
  zoomOut: () => ipcRenderer.send('zoom-out'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  getSettings: () => ipcRenderer.sendSync('get-settings'),
  reportUnreadSignal: (data) => ipcRenderer.send('messenger-unread-signal', data),
});
