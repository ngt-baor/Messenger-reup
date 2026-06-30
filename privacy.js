'use strict';

function payloadToText(payload) {
  if (payload === undefined || payload === null) return '';
  if (typeof payload === 'string') return payload;

  if (typeof URLSearchParams !== 'undefined' && payload instanceof URLSearchParams) {
    return payload.toString();
  }

  let bytes = null;
  if (typeof ArrayBuffer !== 'undefined') {
    if (payload instanceof ArrayBuffer) {
      bytes = new Uint8Array(payload);
    } else if (ArrayBuffer.isView(payload)) {
      bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) {
    bytes = payload;
  }

  if (bytes) {
    let decodedStr = '';
    if (typeof TextDecoder !== 'undefined') {
      try {
        decodedStr = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } catch (e) {}
    }

    let asciiStr = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b >= 32 && b <= 126) {
        asciiStr += String.fromCharCode(b);
      } else {
        asciiStr += ' ';
      }
    }

    // Nếu giải mã bình thường rỗng hoặc chứa quá nhiều kí tự rác,
    // ta dùng giải pháp byte-by-byte trích xuất ASCII
    if (!decodedStr || decodedStr.includes('\uFFFD')) {
      return asciiStr;
    }
    if (asciiStr.trim() && asciiStr !== decodedStr) {
      return `${decodedStr}\n${asciiStr}`;
    }
    return decodedStr;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function sanitizePrivacyLogText(value) {
  let text = payloadToText(value);

  const paramNames = [
    '__user',
    'av',
    'fb_dtsg',
    'lsd',
    'jazoest',
    '__hsi',
    '__dyn',
    '__csr',
    '__spin_r',
    '__spin_b',
    '__spin_t',
    'access_token',
    'token',
    'auth',
    'authorization',
    'cookie',
    'password',
    'pass',
  ];

  paramNames.forEach((name) => {
    const encodedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(${encodedName}=)[^&\\s]+`, 'gi'), '$1<redacted>');
    text = text.replace(new RegExp(`("${encodedName}"\\s*:\\s*")[^"]*(")`, 'gi'), '$1<redacted>$2');
  });

  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>');
  text = text.replace(/(DTSGInitialData[^&\s"]{0,80})/gi, '<redacted-dtsg>');
  return text;
}

function extractMessengerRequestInfo(url, payload, config = {}) {
  const text = payloadToText(payload);
  const lowerUrl = String(url || '').toLowerCase();
  const lowerBody = text.toLowerCase();
  const shouldBlock = shouldBlockMessengerRequest(url, payload, config);
  const keywords = [
    'mark',
    'read',
    'seen',
    'typing',
    'indicator',
    'receipt',
    'lsthread',
    'lstyping',
    'mawthread',
    'mawsend',
  ];

  let friendlyName = '';
  let docId = '';
  try {
    const params = new URLSearchParams(text);
    friendlyName = params.get('fb_api_req_friendly_name') || params.get('friendly_name') || '';
    docId = params.get('doc_id') || '';
  } catch (e) {}

  if (!friendlyName) {
    const match = text.match(/(?:fb_api_req_friendly_name|friendly_name)["'=:%26]+([^&"',\s]+)/i);
    friendlyName = match ? decodeURIComponent(match[1]) : '';
  }
  if (!docId) {
    const match = text.match(/doc_id["'=:%26]+([0-9]+)/i);
    docId = match ? match[1] : '';
  }

  return {
    shouldBlock,
    isInteresting: shouldBlock || keywords.some((keyword) => lowerBody.includes(keyword) || lowerUrl.includes(keyword)),
    friendlyName,
    docId,
    sanitizedPreview: sanitizePrivacyLogText(text).slice(0, 8000),
    textLength: text.length,
  };
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
      'friendly_name=markread',
      'friendly_name=mark_seen',
      '"markread"',
      '"mark_seen"',
      'readreceipt',
      'read_receipt',
      'last_read_watermark_ts',
      '\\"last_read_watermark_ts\\":',
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
      'friendly_name=typingindicator',
      '"typingindicator"',
      '"typing_indicator"',
      '"is_typing":',
      '\\"is_typing\\":',
      'send_typing_indicators',
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

  if (target.__messengerSetAwayMode) {
    target.__messengerSetAwayMode(!!config.blockSeen);
  }

  if (target.__messengerPrivacyInstalled) return;
  target.__messengerPrivacyInstalled = true;

  // Cài đặt Away Mode (chặn Đã xem bằng cách giả lập mất focus)
  (function installAwayMode() {
    target.__messengerAwayMode = !!config.blockSeen;
    const doc = target.document;
    if (!doc) return;

    try {
      const docProto = doc.constructor?.prototype || doc.prototype || doc;
      const hiddenDescriptor = Object.getOwnPropertyDescriptor(docProto, 'hidden');
      const visibilityDescriptor = Object.getOwnPropertyDescriptor(docProto, 'visibilityState');
      const originalHasFocus = doc.hasFocus ? doc.hasFocus.bind(doc) : function() { return true; };

      Object.defineProperty(docProto, 'hidden', {
        configurable: true,
        get: function() {
          return target.__messengerAwayMode ? true : (hiddenDescriptor && hiddenDescriptor.get ? hiddenDescriptor.get.call(this) : false);
        }
      });

      Object.defineProperty(docProto, 'visibilityState', {
        configurable: true,
        get: function() {
          return target.__messengerAwayMode ? 'hidden' : (visibilityDescriptor && visibilityDescriptor.get ? visibilityDescriptor.get.call(this) : 'visible');
        }
      });

      doc.hasFocus = function() {
        return target.__messengerAwayMode ? false : originalHasFocus();
      };

      target.__messengerSetAwayMode = function(value) {
        const next = !!value;
        if (target.__messengerAwayMode === next) return;
        target.__messengerAwayMode = next;
        try {
          target.dispatchEvent(new Event(next ? 'blur' : 'focus'));
          doc.dispatchEvent(new Event('visibilitychange'));
        } catch (e) {}
      };
    } catch (e) {}
  })();

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

  if (typeof target.XMLHttpRequest === 'function') {
    const XHR = target.XMLHttpRequest;
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function privacyXHROpen(method, url) {
      this.__privacyUrl = url;
      return originalOpen.apply(this, arguments);
    };

    XHR.prototype.send = function privacyXHRSend(body) {
      if (shouldBlockMessengerRequest(this.__privacyUrl, body, target.__messengerPrivacyConfig)) {
        Object.defineProperty(this, 'status', { value: 200, writable: false, configurable: true });
        Object.defineProperty(this, 'readyState', { value: 4, writable: false, configurable: true });
        Object.defineProperty(this, 'responseText', { value: '{}', writable: false, configurable: true });
        Object.defineProperty(this, 'response', { value: '{}', writable: false, configurable: true });
        var self = this;
        setTimeout(function() {
          if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
          if (typeof self.onload === 'function') self.onload();
        }, 0);
        return;
      }
      return originalSend.apply(this, arguments);
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

function buildPrivacyPatchSource(targetExpression, config) {
  return `
    (function() {
      const payloadToText = ${payloadToText.toString()};
      const shouldBlockMessengerRequest = ${shouldBlockMessengerRequest.toString()};
      const installPrivacyProtection = ${installPrivacyProtection.toString()};
      installPrivacyProtection(${targetExpression}, ${JSON.stringify({
        blockSeen: !!config.blockSeen,
        blockTyping: !!config.blockTyping,
      })});
    })();
  `;
}

function buildPrivacyPatchScript(config) {
  return buildPrivacyPatchSource('window', config);
}

function buildPrivacyWorkerPatchScript(config) {
  return buildPrivacyPatchSource('self', config);
}

module.exports = {
  buildPrivacyPatchScript,
  buildPrivacyWorkerPatchScript,
  extractMessengerRequestInfo,
  installPrivacyProtection,
  payloadToText,
  registerPrivacyScriptForNewDocuments,
  sanitizePrivacyLogText,
  shouldUseMessengerAwayMode,
  shouldBlockMessengerRequest,
};
