const { contextBridge, ipcRenderer } = require('electron');

/** Set via BrowserView webPreferences.additionalArguments: --mp-service=messenger|discord */
function getPreloadService() {
  const arg = process.argv.find((item) => typeof item === 'string' && item.startsWith('--mp-service='));
  if (!arg) return 'messenger';
  return arg.slice('--mp-service='.length) === 'discord' ? 'discord' : 'messenger';
}

const PRELOAD_SERVICE = getPreloadService();
const IS_MESSENGER_PRELOAD = PRELOAD_SERVICE === 'messenger';

function getSafeSettings() {
  const settings = ipcRenderer.sendSync('get-settings') || {};
  delete settings.appLockHash;
  return settings;
}

function normalizeUnreadSignal(data) {
  if (!data || typeof data !== 'object') return null;
  const hasCount = Number.isFinite(data.count);
  const hasTitle = typeof data.title === 'string';
  if (!hasCount && !hasTitle) return null;

  let messageInfo = null;
  if (data.messageInfo && typeof data.messageInfo === 'object') {
    const sender = typeof data.messageInfo.sender === 'string' ? data.messageInfo.sender.slice(0, 80) : '';
    const message = typeof data.messageInfo.message === 'string' ? data.messageInfo.message.slice(0, 180) : '';
    if (sender || message) messageInfo = { sender, message };
  }

  return {
    count: hasCount
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(data.count)))
      : null,
    title: hasTitle ? data.title.slice(0, 512) : '',
    reason: typeof data.reason === 'string' ? data.reason.slice(0, 64) : '',
    messageInfo,
  };
}

contextBridge.exposeInMainWorld('messengerApp', {
  service: PRELOAD_SERVICE,
  toggleDarkMode: () => ipcRenderer.send('toggle-dark-mode'),
  toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),
  reloadPage: () => ipcRenderer.send('reload-page'),
  zoomIn: () => ipcRenderer.send('zoom-in'),
  zoomOut: () => ipcRenderer.send('zoom-out'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  getSettings: getSafeSettings,
  reportUnreadSignal: (data) => {
    if (!IS_MESSENGER_PRELOAD) return;
    const signal = normalizeUnreadSignal(data);
    if (signal) ipcRenderer.send('messenger-unread-signal', signal);
  },
});
