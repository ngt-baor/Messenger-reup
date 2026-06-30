const assert = require('assert');
const vm = require('vm');
const {
  buildPrivacyPatchScript,
  buildPrivacyWorkerPatchScript,
  extractMessengerRequestInfo,
  installPrivacyProtection,
  payloadToText,
  registerPrivacyScriptForNewDocuments,
  sanitizePrivacyLogText,
  shouldUseMessengerAwayMode,
  shouldBlockMessengerRequest,
} = require('../privacy');

function createPageHarness() {
  const calls = {
    fetch: 0,
    socket: 0,
    beacon: 0,
    xhr: 0,
  };

  function MockWebSocket() {}
  MockWebSocket.prototype.send = function send() {
    calls.socket += 1;
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

  class MockResponse {
    constructor(body, options) {
      this.body = body;
      this.status = options.status;
    }
  }

  const page = {
    Response: MockResponse,
    WebSocket: MockWebSocket,
    XMLHttpRequest: MockXMLHttpRequest,
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
  shouldBlockMessengerRequest(
    'wss://gateway.facebook.com/ws/lightspeed',
    '{"payload":"{\\"thread_key\\":1000,\\"is_typing\\":1,\\"thread_type\\":1}"}',
    { blockSeen: false, blockTyping: true },
  ),
  true,
  'Escaped Lightspeed typing WebSocket payload must be blocked',
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
socket.send('{"type":"LSTypingIndicator","is_typing":1}');
socket.send('{"type":"SendMessage","body":"hello"}');

page.navigator.sendBeacon(
  'https://www.messenger.com/ajax/messaging/typ.php',
  'is_typing=1',
);

assert.strictEqual(calls.fetch, 1, 'Only the normal fetch request may reach the network');
assert.strictEqual(calls.socket, 1, 'Only the normal WebSocket frame may be sent');
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
assert.strictEqual(calls.socket, 2, 'Changing the setting must take effect without reloading');

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
generatedSocket.send('{"type":"LSTypingIndicator","is_typing":1}');
assert.strictEqual(
  generatedHarness.calls.socket,
  0,
  'The script injected into Messenger must block typing frames',
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
  'The script injected into a Messenger worker must block typing frames',
);

console.log('Privacy regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
