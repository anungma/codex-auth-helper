// background.js - Service Worker for async Session fetching + file download
// Following Manifest V3 best practices, avoiding loss of global state

const CHATGPT_SESSION_URL = 'https://chatgpt.com/api/auth/session';
const MAX_AUTH_JSON_BYTES = 64 * 1024;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedExtensionSender(sender) || !isPlainObject(message)) {
    sendResponse({ success: false, error: 'Invalid request' });
    return false;
  }

  if (message.action === 'fetch_session') {
    // Run request asynchronously
    fetchChatGPTSession()
      .then(sessionData => {
        sendResponse({ success: true, data: getSafeSessionPreview(sessionData) });
      })
      .catch(error => {
        console.error('Failed to fetch ChatGPT Session:', sanitizeError(error));
        sendResponse({ success: false, error: error.message });
      });
    return true; // Important: keep the async communication channel open
  }

  if (message.action === 'export_auth_json') {
    // Run download in the Service Worker process, independent of Popup lifecycle
    fetchChatGPTSession()
      .then(sessionData => {
        const authJson = generateCodexAuthJson(sessionData);
        if (!isSafeAuthJson(authJson)) {
          throw new Error('INVALID_AUTH_JSON');
        }

        const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(authJson);
        chrome.downloads.download({
          url: dataUrl,
          filename: 'auth.json',
          saveAs: true,
          conflictAction: 'uniquify'
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('Download error:', sanitizeError(chrome.runtime.lastError));
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, downloadId: downloadId });
          }
        });
      })
      .catch(error => {
        console.error('Export error:', sanitizeError(error));
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the async communication channel open
  }

  sendResponse({ success: false, error: 'Unknown action' });
  return false;
});

function isTrustedExtensionSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) {
    return false;
  }

  if (!sender.url) {
    return true;
  }

  try {
    return new URL(sender.url).origin === chrome.runtime.getURL('').slice(0, -1);
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Cross-origin request to the ChatGPT Session API
 * Since host_permissions for https://chatgpt.com/ are declared in manifest.json,
 * the Service Worker can perform this request in the background securely
 * without being restricted by same-origin (CORS) policies.
 */
async function fetchChatGPTSession() {
  const response = await fetch(CHATGPT_SESSION_URL, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    throw new Error("HTTP error, status code: " + response.status);
  }

  const data = await response.json();
  
  // Verify that a valid accessToken was obtained; if empty or undefined, consider not logged in
  if (!data || !data.accessToken) {
    throw new Error('UNAUTHORIZED');
  }

  return data;
}

function getSafeSessionPreview(session) {
  const user = session.user || {};
  const account = session.account || {};

  return {
    user: {
      name: stringOrEmpty(user.name),
      email: stringOrEmpty(user.email),
      image: getSafeImageUrl(user.image)
    },
    account: {
      planType: stringOrEmpty(account.planType)
    },
    expires: stringOrEmpty(session.expires)
  };
}

function getSafeImageUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function generateCodexAuthJson(session) {
  const accountId = stringOrEmpty(session.account?.id);
  const email = stringOrEmpty(session.user?.email);
  const planType = stringOrEmpty(session.account?.planType) || 'free';
  const userId = stringOrEmpty(session.user?.id);
  const iat = Math.floor(Date.now() / 1000);
  const exp = session.expires ? Math.floor(new Date(session.expires).getTime() / 1000) : iat + (30 * 24 * 3600);

  const jwtHeader = { alg: 'none', typ: 'JWT', cpa_synthetic: true };
  const jwtPayload = {
    iat,
    exp,
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
      chatgpt_plan_type: planType,
      chatgpt_user_id: userId,
      user_id: userId
    },
    email
  };

  const syntheticIdToken = `${base64UrlEncode(jwtHeader)}.${base64UrlEncode(jwtPayload)}.synthetic`;
  const authConfig = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: syntheticIdToken,
      access_token: stringOrEmpty(session.accessToken),
      refresh_token: stringOrEmpty(session.sessionToken),
      account_id: accountId
    },
    last_refresh: new Date().toISOString()
  };

  return JSON.stringify(authConfig, null, 2);
}

function base64UrlEncode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function isSafeAuthJson(authJson) {
  if (typeof authJson !== 'string' || new TextEncoder().encode(authJson).length > MAX_AUTH_JSON_BYTES) {
    return false;
  }

  try {
    const parsed = JSON.parse(authJson);
    return parsed?.auth_mode === 'chatgpt'
      && typeof parsed?.tokens?.access_token === 'string'
      && parsed.tokens.access_token.length > 0
      && typeof parsed?.tokens?.refresh_token === 'string'
      && parsed.tokens.refresh_token.length > 0;
  } catch {
    return false;
  }
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

function sanitizeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error)
  };
}
