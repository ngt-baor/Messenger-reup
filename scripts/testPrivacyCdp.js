const assert = require('assert');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { registerPrivacyScriptForNewDocuments } = require('../privacy');

app.disableHardwareAcceleration();
app.setPath('userData', path.join(app.getPath('temp'), `messenger-privacy-cdp-${process.pid}`));

ipcMain.on('get-settings', (event) => {
  event.returnValue = {
    isDarkMode: true,
    appLockHash: 'should-not-be-exposed',
  };
});

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), 5000);
    }),
  ]);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await withTimeout(window.loadURL('about:blank'), 'Bootstrap page load');
    await withTimeout(
      registerPrivacyScriptForNewDocuments(window.webContents.debugger, {
        blockSeen: true,
        blockTyping: true,
      }),
      'CDP registration',
    );
    await withTimeout(
      window.loadURL('data:text/html,<title>privacy-test</title>'),
      'Test page load',
    );

    const state = await withTimeout(
      window.webContents.executeJavaScript(`({
        installed: window.__messengerPrivacyInstalled,
        config: window.__messengerPrivacyConfig
      })`),
      'Privacy state readback',
    );

    assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), {
      installed: true,
      config: {
        blockSeen: true,
        blockTyping: true,
      },
    });

    const preloadWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: ['--mp-service=messenger'],
      },
    });

    try {
      let messengerSignalCount = 0;
      const onMessengerSignal = () => { messengerSignalCount += 1; };
      ipcMain.on('messenger-unread-signal', onMessengerSignal);
      const unreadSignal = new Promise((resolve) => {
        ipcMain.once('messenger-unread-signal', (_event, data) => resolve(data));
      });
      await withTimeout(
        preloadWindow.loadURL('data:text/html,<title>preload-test</title>'),
        'Sandbox preload page load',
      );
      const bridge = await withTimeout(
        preloadWindow.webContents.executeJavaScript(`({
          keys: Object.keys(window.messengerApp || {}).sort(),
          service: window.messengerApp?.service,
          reportUnreadSignal: typeof window.messengerApp?.reportUnreadSignal,
          settings: window.messengerApp?.getSettings()
        })`),
        'Sandbox preload bridge readback',
      );
      assert.deepStrictEqual(JSON.parse(JSON.stringify(bridge)), {
        keys: [
          'getSettings',
          'reloadPage',
          'reportUnreadSignal',
          'service',
          'toggleAlwaysOnTop',
          'toggleDarkMode',
          'toggleFullscreen',
          'zoomIn',
          'zoomOut',
        ],
        service: 'messenger',
        reportUnreadSignal: 'function',
        settings: { isDarkMode: true },
      });

      await preloadWindow.webContents.executeJavaScript(
        `window.messengerApp.reportUnreadSignal({ count: 2, reason: 'test' })`,
      );
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(await withTimeout(unreadSignal, 'Unread signal'))),
        { count: 2, title: '', reason: 'test', messageInfo: null },
      );

      await preloadWindow.webContents.executeJavaScript(`
        window.messengerApp.reportUnreadSignal(null);
        window.messengerApp.reportUnreadSignal({ count: Infinity });
      `);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.strictEqual(messengerSignalCount, 1);
    } finally {
      ipcMain.removeAllListeners('messenger-unread-signal');
      if (!preloadWindow.isDestroyed()) preloadWindow.destroy();
    }

    const discordWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: ['--mp-service=discord'],
      },
    });
    let discordSignalReceived = false;
    const onDiscordSignal = () => { discordSignalReceived = true; };
    ipcMain.on('messenger-unread-signal', onDiscordSignal);

    try {
      await withTimeout(
        discordWindow.loadURL('data:text/html,<title>discord-preload-test</title>'),
        'Discord sandbox preload page load',
      );
      const discordBridge = await discordWindow.webContents.executeJavaScript(`({
        keys: Object.keys(window.messengerApp || {}).sort(),
        service: window.messengerApp?.service
      })`);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(discordBridge)), {
        keys: [
          'getSettings',
          'reloadPage',
          'reportUnreadSignal',
          'service',
          'toggleAlwaysOnTop',
          'toggleDarkMode',
          'toggleFullscreen',
          'zoomIn',
          'zoomOut',
        ],
        service: 'discord',
      });

      await discordWindow.webContents.executeJavaScript(
        `window.messengerApp.reportUnreadSignal({ count: 9, reason: 'discord-test' })`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.strictEqual(discordSignalReceived, false);
    } finally {
      ipcMain.removeListener('messenger-unread-signal', onDiscordSignal);
      if (!discordWindow.isDestroyed()) discordWindow.destroy();
    }

    console.log('Electron CDP privacy and sandbox preload integration tests passed.');
  } finally {
    if (window.webContents.debugger.isAttached()) {
      window.webContents.debugger.detach();
    }
    if (!window.isDestroyed()) window.destroy();
  }
}).then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
