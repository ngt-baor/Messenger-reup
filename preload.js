const { contextBridge, ipcRenderer, webFrame } = require('electron');
const { buildPrivacyPatchScript } = require('./privacy');
const { normalizeService } = require('./service-model');

/** Set via BrowserView webPreferences.additionalArguments: --mp-service=messenger|discord */
function getPreloadService() {
  const arg = process.argv.find((item) => typeof item === 'string' && item.startsWith('--mp-service='));
  if (!arg) return 'messenger';
  return normalizeService(arg.slice('--mp-service='.length));
}

const PRELOAD_SERVICE = getPreloadService();
const IS_MESSENGER_PRELOAD = PRELOAD_SERVICE === 'messenger';

function applyPrivacySettings(settings = {}) {
  if (!IS_MESSENGER_PRELOAD) return;
  webFrame.executeJavaScript(buildPrivacyPatchScript(settings), true).catch(() => {});
}

// Privacy FB hooks must never run on Discord partitions
if (IS_MESSENGER_PRELOAD) {
  applyPrivacySettings(ipcRenderer.sendSync('get-settings'));
  ipcRenderer.on('privacy-settings-updated', (event, settings) => {
    applyPrivacySettings(settings);
  });
}

contextBridge.exposeInMainWorld('messengerApp', {
  service: PRELOAD_SERVICE,
  toggleDarkMode: () => ipcRenderer.send('toggle-dark-mode'),
  toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),
  reloadPage: () => ipcRenderer.send('reload-page'),
  zoomIn: () => ipcRenderer.send('zoom-in'),
  zoomOut: () => ipcRenderer.send('zoom-out'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  getSettings: () => ipcRenderer.sendSync('get-settings'),
  reportUnreadSignal: (data) => {
    if (!IS_MESSENGER_PRELOAD) return;
    ipcRenderer.send('messenger-unread-signal', data);
  },
});
