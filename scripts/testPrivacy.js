const assert = require('assert');
const vm = require('vm');
const {
  buildPrivacyPatchScript,
  installPrivacyProtection,
  registerPrivacyScriptForNewDocuments,
  shouldUseMessengerAwayMode,
  shouldBlockMessengerRequest,
} = require('../privacy');

function createPageHarness() {
  const calls = {
    fetch: 0,
    socket: 0,
    beacon: 0,
  };

  function MockWebSocket() {}
  MockWebSocket.prototype.send = function send() {
    calls.socket += 1;
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

console.log('Privacy regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
