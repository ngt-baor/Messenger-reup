'use strict';

function payloadToText(payload) {
  if (payload === undefined || payload === null) return '';
  if (typeof payload === 'string') return payload;

  if (typeof URLSearchParams !== 'undefined' && payload instanceof URLSearchParams) {
    return payload.toString();
  }

  if (typeof ArrayBuffer !== 'undefined') {
    let bytes = null;
    if (payload instanceof ArrayBuffer) {
      bytes = new Uint8Array(payload);
    } else if (ArrayBuffer.isView(payload)) {
      bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }

    if (bytes && typeof TextDecoder !== 'undefined') {
      try {
        return new TextDecoder().decode(bytes);
      } catch {}
    }
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) {
    return payload.toString('utf8');
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function shouldBlockMessengerRequest(url, payload, config = {}) {
  const requestUrl = String(url || '').toLowerCase();
  const body = payloadToText(payload).toLowerCase();

  if (config.blockSeen) {
    const seenUrlPatterns = [
      '/change_read_status.php',
      '/mercury/mark_seen.php',
      '/notifications/mark_read.php',
    ];
    const seenPayloadPatterns = [
      'lsthreadmarkread',
      'mawthreadmarkread',
      'threadmarkreadmutation',
      'markthreadreadmutation',
      '"name":"mark_read"',
    ];

    if (
      seenUrlPatterns.some((pattern) => requestUrl.includes(pattern)) ||
      seenPayloadPatterns.some((pattern) => body.includes(pattern))
    ) {
      return true;
    }
  }

  if (config.blockTyping) {
    const typingUrlPatterns = [
      '/ajax/messaging/typ.php',
      '/messaging/typ.php',
    ];
    const typingPayloadPatterns = [
      'lstypingindicator',
      'mawsendtypingindicator',
      'typingindicatormutation',
      'sendtypingindicatormutation',
    ];

    if (
      typingUrlPatterns.some((pattern) => requestUrl.includes(pattern)) ||
      typingPayloadPatterns.some((pattern) => body.includes(pattern))
    ) {
      return true;
    }
  }

  return false;
}

function shouldUseMessengerAwayMode(isWindowAway, blockSeen) {
  return !!isWindowAway || !!blockSeen;
}

function installPrivacyProtection(target, config = {}) {
  target.__messengerPrivacyConfig = {
    blockSeen: !!config.blockSeen,
    blockTyping: !!config.blockTyping,
  };

  if (target.__messengerPrivacyInstalled) return;
  target.__messengerPrivacyInstalled = true;

  if (typeof target.fetch === 'function') {
    const originalFetch = target.fetch;
    target.fetch = function privacyFetch(input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url;
      if (shouldBlockMessengerRequest(url, init.body, target.__messengerPrivacyConfig)) {
        return Promise.resolve(new target.Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return originalFetch.apply(this, arguments);
    };
  }

  if (target.WebSocket?.prototype && typeof target.WebSocket.prototype.send === 'function') {
    const originalWebSocketSend = target.WebSocket.prototype.send;
    target.WebSocket.prototype.send = function privacyWebSocketSend(data) {
      if (shouldBlockMessengerRequest(this.url, data, target.__messengerPrivacyConfig)) {
        return undefined;
      }
      return originalWebSocketSend.apply(this, arguments);
    };
  }

  if (target.navigator && typeof target.navigator.sendBeacon === 'function') {
    const originalSendBeacon = target.navigator.sendBeacon;
    target.navigator.sendBeacon = function privacySendBeacon(url, data) {
      if (shouldBlockMessengerRequest(url, data, target.__messengerPrivacyConfig)) {
        return true;
      }
      return originalSendBeacon.apply(this, arguments);
    };
  }
}

async function registerPrivacyScriptForNewDocuments(
  debuggerApi,
  config,
  previousIdentifier = null,
) {
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach('1.3');
  }

  await debuggerApi.sendCommand('Page.enable');

  if (previousIdentifier) {
    await debuggerApi.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: previousIdentifier,
    });
  }

  const result = await debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: buildPrivacyPatchScript(config),
  });
  return result?.identifier || null;
}

function buildPrivacyPatchScript(config) {
  return `
    (function() {
      const payloadToText = ${payloadToText.toString()};
      const shouldBlockMessengerRequest = ${shouldBlockMessengerRequest.toString()};
      const installPrivacyProtection = ${installPrivacyProtection.toString()};
      installPrivacyProtection(window, ${JSON.stringify({
        blockSeen: !!config.blockSeen,
        blockTyping: !!config.blockTyping,
      })});
    })();
  `;
}

module.exports = {
  buildPrivacyPatchScript,
  installPrivacyProtection,
  payloadToText,
  registerPrivacyScriptForNewDocuments,
  shouldUseMessengerAwayMode,
  shouldBlockMessengerRequest,
};
