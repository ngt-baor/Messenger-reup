const assert = require('assert');
const vm = require('vm');
const {
  buildPrivacyPatchScript,
  buildPrivacyWorkerPatchScript,
  extractMessengerRequestInfo,
  installPrivacyProtection,
  payloadToText,
  registerPrivacyScriptForNewDocuments,
  sanitizeMessengerWebSocketPayload,
  sanitizePrivacyLogText,
  shouldBlockWorkerMessage,
  shouldBlockMessengerWebSocketSend,
  shouldUseMessengerAwayMode,
  shouldBlockMessengerRequest,
} = require('../privacy');

function createPageHarness() {
  const calls = {
    fetch: 0,
    socket: 0,
    beacon: 0,
    xhr: 0,
    socketPayloads: [],
  };

  function createEventTarget() {
    const listeners = {};
    return {
      addEventListener: function addEventListener(type, listener) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      },
      dispatchEvent: function dispatchEvent(event) {
        (listeners[event.type] || []).forEach((listener) => listener.call(this, event));
      },
    };
  }

  function MockWebSocket(url = 'wss://gateway.facebook.com/ws/lightspeed') {
    this.url = url;
  }
  MockWebSocket.prototype.send = function send() {
    calls.socket += 1;
    calls.socketPayloads.push(arguments[0]);
  };

  function MockXMLHttpRequest() {
    this.status = 0;
    this.readyState = 0;
    this.responseText = '';
    this.response = '';
    this.onreadystatechange = null;
    this.onload = null;
  }
  MockXMLHttpRequest.prototype.open = function open(method, url) {
    this._method = method;
    this._url = url;
  };
  MockXMLHttpRequest.prototype.send = function send() {
    calls.xhr += 1;
  };

  function MockWorker(url) {
    this.url = url;
  }
  MockWorker.prototype.postMessage = function postMessage(msg) {
    calls.workerPostCalls = (calls.workerPostCalls || 0) + 1;
    calls.workerMessages = calls.workerMessages || [];
    calls.workerMessages.push(msg);
  };

  function MockSharedWorker(url) {
    this.url = url;
    this.port = {
      postMessage: function postMessage(msg) {
        calls.sharedWorkerPostCalls = (calls.sharedWorkerPostCalls || 0) + 1;
        calls.sharedWorkerMessages = calls.sharedWorkerMessages || [];
        calls.sharedWorkerMessages.push(msg);
      }
    };
  }

  class MockResponse {
    constructor(body, options) {
      this.body = body;
      this.status = options.status;
    }
  }

  class MockDocument {}
  const document = Object.assign(new MockDocument(), createEventTarget(), {
    hasFocus: () => true,
  });

  const page = {
    ...createEventTarget(),
    Response: MockResponse,
    WebSocket: MockWebSocket,
    XMLHttpRequest: MockXMLHttpRequest,
    Worker: MockWorker,
    SharedWorker: MockSharedWorker,
    document,
    fetch: async () => {
      calls.fetch += 1;
      return new MockResponse('{}', { status: 200 });
    },
    navigator: {
      sendBeacon: () => {
        calls.beacon += 1;
        return true;
      },
    },
  };

  return { page, calls };
}

(async () => {
// test shouldBlockWorkerMessage
assert.strictEqual(
  shouldBlockWorkerMessage(
    '{"type":"typing","is_typing":true}',
    { blockTyping: true }
  ),
  true,
  'Pure typing worker message must be blocked'
);

assert.strictEqual(
  shouldBlockWorkerMessage(
    '{"type":"send_message","body":"typing test"}',
    { blockTyping: true }
  ),
  false,
  'Worker message containing real message text must not be blocked'
);
assert.strictEqual(
  shouldBlockMessengerRequest(
    'https://www.messenger.com/api/graphql/',
    'fb_api_req_friendly_name=LSThreadMarkReadMutation',
    { blockSeen: true, blockTyping: false },
  ),
  true,
  'Read-receipt GraphQL payload must be blocked',
);

assert.strictEqual(
  shouldBlockMessengerRequest(
    'wss://edge-chat.messenger.com/chat',
    '{"type":"LSTypingIndicator","is_typing":1}',
    { blockSeen: false, blockTyping: true },
  ),
  true,
  'Typing WebSocket payload must be blocked',
);

assert.strictEqual(
  shouldBlockMessengerRequest(
    'https://www.messenger.com/api/graphql/',
    'fb_api_req_friendly_name=SendMessageMutation&message=hello',
    { blockSeen: true, blockTyping: true },
  ),
  false,
  'Normal messages must not be blocked',
);

assert.strictEqual(
  shouldBlockMessengerRequest(
    'https://www.messenger.com/api/graphql/',
    'fb_api_req_friendly_name=SendMessageMutation&message=typing_indicator',
    { blockSeen: true, blockTyping: true },
  ),
  false,
  'Keywords inside a normal message must not trigger the blocker',
);

// New pattern tests
assert.strictEqual(
  shouldBlockMessengerRequest(
    'https://www.messenger.com/api/graphql/',
    'fb_api_req_friendly_name=MarkReadMutation',
    { blockSeen: true, blockTyping: false },
  ),
  true,
  'MarkReadMutation (new format) must be blocked by friendly_name=markread pattern',
);

assert.strictEqual(
  shouldBlockMessengerRequest(
    'https://www.messenger.com/api/graphql/',
    '{"doc_id":"12345","variables":{"is_typing":true}}',
    { blockSeen: false, blockTyping: true },
  ),
  true,
  'JSON typing payload with "is_typing": must be blocked',
);

assert.strictEqual(
  shouldBlockMessengerRequest(
    'https://www.messenger.com/api/graphql/',
    'fb_api_req_friendly_name=SendMessageMutation&body=markread something',
    { blockSeen: true, blockTyping: false },
  ),
  false,
  'markread inside message body text must NOT trigger blocker (no = or quote prefix)',
);

assert.strictEqual(
  shouldBlockMessengerRequest(
    'wss://gateway.facebook.com/ws/lightspeed',
    '{"payload":"{\\"thread_id\\":1000,\\"last_read_watermark_ts\\":1782857640900,\\"sync_group\\":1}"}',
    { blockSeen: true, blockTyping: false },
  ),
  true,
  'Lightspeed read-watermark WebSocket payload must be blocked',
);

assert.strictEqual(
  shouldBlockMessengerWebSocketSend(
    'wss://gateway.facebook.com/ws/lightspeed',
    '{"payload":"{\\"thread_id\\":1000,\\"last_read_watermark_ts\\":1782857640900,\\"sync_group\\":1}"}',
    { blockSeen: true, blockTyping: false },
  ),
  false,
  'Lightspeed WebSocket frames must not be dropped because Messenger streams require ACKs',
);

assert.strictEqual(
  shouldBlockMessengerWebSocketSend(
    'wss://gateway.facebook.com/ws/lightspeed',
    '{"payload":"{\\"thread_id\\":1000,\\"last_read_watermark_ts\\":1782857640900}","extra":"send_message"}',
    { blockSeen: true, blockTyping: true },
  ),
  false,
  'Mixed send-message WebSocket frames must never be dropped',
);

assert.strictEqual(
  shouldBlockMessengerRequest(
    'wss://gateway.facebook.com/ws/lightspeed',
    '{"payload":"{\\"thread_key\\":1000,\\"is_typing\\":1,\\"thread_type\\":1}"}',
    { blockSeen: false, blockTyping: true },
  ),
  true,
  'Escaped Lightspeed typing WebSocket payload must be blocked',
);

assert.strictEqual(
  shouldBlockMessengerWebSocketSend(
    'wss://gateway.facebook.com/ws/lightspeed',
    '{"payload":"{\\"thread_key\\":1000,\\"is_typing\\":1,\\"thread_type\\":1}"}',
    { blockSeen: false, blockTyping: true },
  ),
  true,
  'Pure typing WebSocket frames must be dropped because sending is_typing=0 still shows typing',
);

assert.strictEqual(
  sanitizeMessengerWebSocketPayload(
    'wss://gateway.facebook.com/ws/lightspeed',
    '{"payload":"{\\"thread_key\\":1000,\\"is_typing\\":1,\\"thread_type\\":1}"}',
    { blockSeen: false, blockTyping: true },
  ),
  '{"payload":"{\\"thread_key\\":1000,\\"is_typing\\":0,\\"thread_type\\":1}"}',
  'Typing WebSocket payload must be downgraded without dropping the frame',
);

const binaryTypingPayload = new TextEncoder().encode('abc {"is_typing":1} def');
const sanitizedBinaryTypingPayload = sanitizeMessengerWebSocketPayload(
  'wss://gateway.facebook.com/ws/lightspeed',
  binaryTypingPayload,
  { blockSeen: false, blockTyping: true },
);
assert.ok(
  payloadToText(sanitizedBinaryTypingPayload).includes('"is_typing":0'),
  'Binary typing WebSocket payload must be downgraded in place when possible',
);

assert.strictEqual(
  shouldBlockMessengerRequest(
    'wss://gateway.facebook.com/ws/realtime',
    '{"events":[{"name":"ods_web_batch","extra":"{\\"batch\\":{\\"3185\\":{\\"send_typing_indicators_ONE_TO_ONE\\":{\\"inbox\\":{\\"n\\":1}}}}}"}]}',
    { blockSeen: false, blockTyping: true },
  ),
  false,
  'Typing telemetry counters must not be blocked as real typing indicators',
);

assert.ok(
  payloadToText(new Uint8Array([0, 1, 76, 83, 84, 121, 112, 105, 110, 103, 73, 110, 100, 105, 99, 97, 116, 111, 114])).includes('LSTypingIndicator'),
  'Binary payload decoding must expose printable ASCII tokens for matching',
);

const sanitizedDebugText = sanitizePrivacyLogText('__user=123&fb_dtsg=secret&lsd=abc&fb_api_req_friendly_name=LSThreadMarkReadMutation');
assert.ok(!sanitizedDebugText.includes('secret'), 'Privacy debug log must redact fb_dtsg');
assert.ok(!sanitizedDebugText.includes('__user=123'), 'Privacy debug log must redact user id parameters');
assert.ok(sanitizedDebugText.includes('LSThreadMarkReadMutation'), 'Privacy debug log must preserve operation names');

const debugInfo = extractMessengerRequestInfo(
  'https://www.messenger.com/api/graphql/',
  '__user=123&doc_id=98765&fb_api_req_friendly_name=LSThreadMarkReadMutation&fb_dtsg=secret',
  { blockSeen: true, blockTyping: false },
);
assert.strictEqual(debugInfo.shouldBlock, true, 'Debug info must use the same blocking rules');
assert.strictEqual(debugInfo.friendlyName, 'LSThreadMarkReadMutation', 'Debug info must extract friendly name');
assert.strictEqual(debugInfo.docId, '98765', 'Debug info must extract doc_id');
assert.ok(!debugInfo.sanitizedPreview.includes('secret'), 'Debug info preview must be redacted');

assert.strictEqual(
  shouldUseMessengerAwayMode(false, true),
  true,
  'Blocking Seen must keep Messenger unfocused while the app window is active',
);

assert.strictEqual(
  shouldUseMessengerAwayMode(false, false),
  false,
  'Messenger must remain focused when Seen blocking is disabled',
);

const awayHarness = createPageHarness();
let awayFocusCalls = 0;
installPrivacyProtection(awayHarness.page, { blockSeen: true, blockTyping: false });
awayHarness.page.addEventListener('focus', () => {
  awayFocusCalls += 1;
});
awayHarness.page.dispatchEvent(new Event('focus'));
assert.strictEqual(awayFocusCalls, 0, 'Away Mode must suppress focus events while Seen blocking is enabled');
installPrivacyProtection(awayHarness.page, { blockSeen: false, blockTyping: false });
assert.strictEqual(awayFocusCalls, 1, 'Disabling Away Mode may emit one focus event to restore normal state');
awayHarness.page.dispatchEvent(new Event('focus'));
assert.strictEqual(awayFocusCalls, 2, 'Focus events must resume when Seen blocking is disabled');

const debuggerCalls = [];
const debuggerApi = {
  isAttached: () => false,
  attach: (version) => debuggerCalls.push(['attach', version]),
  sendCommand: async (method, params) => {
    debuggerCalls.push(['sendCommand', method, params]);
    return { identifier: 'privacy-script' };
  },
};

await registerPrivacyScriptForNewDocuments(
  debuggerApi,
  { blockSeen: true, blockTyping: true },
);
assert.deepStrictEqual(
  debuggerCalls.map((call) => call.slice(0, 2)),
  [
    ['attach', '1.3'],
    ['sendCommand', 'Page.enable'],
    ['sendCommand', 'Page.addScriptToEvaluateOnNewDocument'],
  ],
  'Privacy patch must be registered before Messenger document scripts run',
);

const { page, calls } = createPageHarness();
installPrivacyProtection(page, { blockSeen: true, blockTyping: true });

page.fetch('https://www.messenger.com/api/graphql/', {
  method: 'POST',
  body: 'fb_api_req_friendly_name=LSThreadMarkReadMutation',
});
page.fetch('https://www.messenger.com/api/graphql/', {
  method: 'POST',
  body: 'fb_api_req_friendly_name=SendMessageMutation',
});

const socket = new page.WebSocket();
socket.send('{"payload":"{\\"thread_id\\":1000,\\"last_read_watermark_ts\\":1782857640900,\\"sync_group\\":1}"}');
socket.send('{"type":"SendMessage","body":"hello"}');
socket.send('{"payload":"{\\"thread_key\\":1000,\\"is_typing\\":1,\\"thread_type\\":1}"}');

page.navigator.sendBeacon(
  'https://www.messenger.com/ajax/messaging/typ.php',
  'is_typing=1',
);

assert.strictEqual(calls.fetch, 1, 'Only the normal fetch request may reach the network');
assert.strictEqual(calls.socket, 2, 'WebSocket frames must reach the network to preserve Messenger ACKs');
assert.strictEqual(calls.beacon, 0, 'Typing beacon must be blocked');

// XHR blocking tests
const xhr1 = new page.XMLHttpRequest();
xhr1.open('POST', 'https://www.messenger.com/api/graphql/');
xhr1.send('fb_api_req_friendly_name=LSThreadMarkReadMutation');
assert.strictEqual(calls.xhr, 0, 'Read-receipt XHR must be blocked');
assert.strictEqual(xhr1.status, 200, 'Blocked XHR must get fake 200 status');

const xhr2 = new page.XMLHttpRequest();
xhr2.open('POST', 'https://www.messenger.com/api/graphql/');
xhr2.send('fb_api_req_friendly_name=SendMessageMutation');
assert.strictEqual(calls.xhr, 1, 'Normal XHR must reach the network');

installPrivacyProtection(page, { blockSeen: false, blockTyping: false });
socket.send('{"type":"LSTypingIndicator","is_typing":1}');
assert.strictEqual(calls.socket, 3, 'Changing the setting must keep WebSocket delivery intact');

const generatedHarness = createPageHarness();
vm.runInNewContext(
  buildPrivacyPatchScript({ blockSeen: true, blockTyping: true }),
  {
    window: generatedHarness.page,
    URLSearchParams,
    ArrayBuffer,
    Uint8Array,
    TextDecoder,
    Promise,
  },
);
const generatedSocket = new generatedHarness.page.WebSocket();
generatedSocket.send('{"payload":"{\\"thread_id\\":1000,\\"last_read_watermark_ts\\":1782857640900,\\"sync_group\\":1}"}');
assert.strictEqual(
  generatedHarness.calls.socket,
  1,
  'The script injected into Messenger must not drop WebSocket frames',
);

const generatedWorkerHarness = createPageHarness();
vm.runInNewContext(
  buildPrivacyWorkerPatchScript({ blockSeen: true, blockTyping: true }),
  {
    self: generatedWorkerHarness.page,
    URLSearchParams,
    ArrayBuffer,
    Uint8Array,
    TextDecoder,
    Promise,
  },
);
const generatedWorkerSocket = new generatedWorkerHarness.page.WebSocket();
generatedWorkerSocket.send('{"payload":"{\\"thread_key\\":1000,\\"is_typing\\":1,\\"thread_type\\":1}"}');
assert.strictEqual(
  generatedWorkerHarness.calls.socket,
  0,
  'The script injected into a Messenger worker must drop pure typing frames',
);

// Test Worker & SharedWorker hooks in window context
const workerTestHarness = createPageHarness();
vm.runInNewContext(
  buildPrivacyPatchScript({ blockSeen: true, blockTyping: true }),
  {
    window: workerTestHarness.page,
    URLSearchParams,
    ArrayBuffer,
    Uint8Array,
    TextDecoder,
    Promise,
    Event,
  },
);

const pageWorker = new workerTestHarness.page.Worker('worker.js');
pageWorker.postMessage('{"type":"typing","is_typing":true}');
assert.strictEqual(
  workerTestHarness.calls.workerPostCalls || 0,
  0,
  'Worker postMessage for pure typing must be blocked by the window-level Worker hook'
);

pageWorker.postMessage('{"type":"send_message","body":"real message text"}');
assert.strictEqual(
  workerTestHarness.calls.workerPostCalls || 0,
  1,
  'Worker postMessage for real messages must not be blocked'
);

const pageSharedWorker = new workerTestHarness.page.SharedWorker('shared_worker.js');
pageSharedWorker.port.postMessage('{"type":"typing","is_typing":true}');
assert.strictEqual(
  workerTestHarness.calls.sharedWorkerPostCalls || 0,
  0,
  'SharedWorker port.postMessage for pure typing must be blocked'
);

pageSharedWorker.port.postMessage('{"type":"send_message","body":"real message text"}');
assert.strictEqual(
  workerTestHarness.calls.sharedWorkerPostCalls || 0,
  1,
  'SharedWorker port.postMessage for real messages must not be blocked'
);

console.log('Privacy regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
