const assert = require('assert');
const { app, BrowserWindow } = require('electron');
const { registerPrivacyScriptForNewDocuments } = require('../privacy');

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
    console.log('Electron CDP privacy integration test passed.');
  } finally {
    if (window.webContents.debugger.isAttached()) {
      window.webContents.debugger.detach();
    }
    if (!window.isDestroyed()) window.destroy();
    app.exit(0);
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
