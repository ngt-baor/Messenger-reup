const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'settings-renderer.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const defaultState = { version: '1.2.1', settings: {}, update: {} };
const elementIds = [
  'version-text',
  'update-status',
  'update-badge',
  'update-progress',
  'update-progress-bar',
  'update-action',
  'auto-launch',
  'minimize-to-tray',
  'sleep-background',
  'exclusive-service',
  'block-seen',
  'block-typing',
  'clear-cache',
  'clear-session',
  'open-user-data',
];

function createElement() {
  return {
    textContent: '',
    className: '',
    hidden: false,
    disabled: false,
    checked: false,
    style: {},
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
  };
}

async function createRendererHarness(updateAction, getState = async () => defaultState) {
  const elements = Object.fromEntries(elementIds.map((id) => [id, createElement()]));
  let stateListener = null;
  const settingsApi = {
    getState,
    setOption: async () => defaultState,
    clearCache: async () => defaultState,
    openUserData: () => {},
    updateAction,
    onStateUpdated(listener) {
      stateListener = listener;
      return () => {};
    },
  };

  vm.runInNewContext(rendererSource, {
    window: { settingsApi },
    document: { getElementById: (id) => elements[id] },
    console,
  });
  await new Promise(setImmediate);

  return {
    updateButton: elements['update-action'],
    updateStatus: elements['update-status'],
    emitState: (state) => stateListener(state),
  };
}

async function testInitialUpdateButtonDisabledWhileStateLoads() {
  let resolveState;
  const statePromise = new Promise((resolve) => {
    resolveState = resolve;
  });
  const harness = await createRendererHarness(
    async () => defaultState,
    () => statePromise,
  );

  assert.strictEqual(harness.updateButton.disabled, true);
  resolveState(defaultState);
  await new Promise(setImmediate);
  assert.strictEqual(harness.updateButton.disabled, false);
}

async function testRendererRejectRecovery() {
  const harness = await createRendererHarness(async () => {
    throw new Error('simulated failure');
  });

  await harness.updateButton.listeners.click();

  assert.strictEqual(harness.updateButton.disabled, false);
  assert.ok(harness.updateStatus.textContent.includes('simulated failure'));
}

async function testRendererSuccessWaitsForStateEvent() {
  let resolveAction;
  const action = new Promise((resolve) => {
    resolveAction = resolve;
  });
  const harness = await createRendererHarness(() => action);

  const clickPromise = harness.updateButton.listeners.click();
  assert.strictEqual(harness.updateButton.disabled, true);
  resolveAction(defaultState);
  await clickPromise;
  assert.strictEqual(harness.updateButton.disabled, true);

  harness.emitState(defaultState);
  assert.strictEqual(harness.updateButton.disabled, false);
}

function testCheckForUpdatesReturnsPromise() {
  const functionSource = mainSource.match(/function checkForUpdates\(manual = false\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource, 'checkForUpdates function not found');
  const expectedPromise = { marker: 'update-check-promise' };
  const context = {
    autoUpdater: { checkForUpdates: () => expectedPromise },
    isManualUpdateCheck: false,
    result: null,
  };

  vm.runInNewContext(`${functionSource}\nresult = checkForUpdates(true);`, context);

  assert.strictEqual(context.result, expectedPromise);
  assert.strictEqual(context.isManualUpdateCheck, true);
}

async function testIpcPropagatesUpdateFailure() {
  const handlerSource = mainSource.match(/ipcMain\.handle\('settings:update-action',[\s\S]*?\n  \}\);/)?.[0];
  assert.ok(handlerSource, 'settings:update-action handler not found');
  let handler = null;
  const context = {
    ipcMain: { handle: (name, callback) => { if (name === 'settings:update-action') handler = callback; } },
    updateTrayState: { downloaded: false, available: false },
    installDownloadedUpdate: () => {},
    startUpdateDownload: () => {},
    checkForUpdates: () => ({ then: (resolve, reject) => reject(new Error('network failure')) }),
    sendSettingsPanelState: () => {},
    getSettingsPanelState: () => defaultState,
  };
  vm.runInNewContext(handlerSource, context);

  await assert.rejects(handler(), /network failure/);
}

(async () => {
  await testInitialUpdateButtonDisabledWhileStateLoads();
  await testRendererRejectRecovery();
  await testRendererSuccessWaitsForStateEvent();
  testCheckForUpdatesReturnsPromise();
  await testIpcPropagatesUpdateFailure();
  console.log('Settings update action regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
