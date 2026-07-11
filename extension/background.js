// background.js - Background worker/script for async Session fetching + file download
// Supports Chromium Manifest V3 and Firefox WebExtensions.

const CHATGPT_SESSION_URL = 'https://chatgpt.com/api/auth/session';
const MAX_AUTH_JSON_BYTES = 64 * 1024;

const hasPromiseExtensionApi = typeof browser !== 'undefined';
const extensionApi = hasPromiseExtensionApi ? browser : chrome;

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedExtensionSender(sender) || !isPlainObject(message)) {
    sendResponse({ success: false, error: 'Invalid request' });
    return false;
  }

  if (hasPromiseExtensionApi) {
    return handleRuntimeMessage(message, sender);
  }

  handleRuntimeMessage(message, sender)
    .then(response => {
      sendResponse(response);
    })
    .catch(error => {
      console.error('Runtime message error:', error);
      sendResponse({ success: false, error: error.message });
    });
  return true;
});

async function handleRuntimeMessage(message, sender) {
  if (message.action === 'fetch_session') {
    try {
      const sessionData = await fetchChatGPTSession()
        .catch(() => fetchChatGPTSessionFromChatGPTTab(sender));
      return { success: true, data: getSafeSessionPreview(sessionData) };
    } catch (error) {
      console.error('Failed to fetch ChatGPT Session:', sanitizeError(error));
      return { success: false, error: error.message };
    }
  }

  if (message.action === 'export_current_account') {
    try {
      const sessionData = await fetchChatGPTSession()
        .catch(() => fetchChatGPTSessionFromChatGPTTab(sender));
      const authJson = generateCodexAuthJson(sessionData);
      if (!isSafeAuthJson(authJson)) {
        throw new Error('INVALID_AUTH_JSON');
      }

      const downloadId = await downloadAuthFile({
        url: toJsonDataUrl(authJson),
        filename: generateAuthFilename(sessionData),
        saveAs: false,
        conflictAction: 'uniquify'
      });
      return { success: true, downloadId: downloadId };
    } catch (error) {
      console.error('Export error:', sanitizeError(error));
      return { success: false, error: error.message };
    }
  }

  if (message.action === 'list_workspaces') {
    try {
      const tab = await findChatGPTTab(sender);
      const result = await executeFunctionInTab(tab.id, discoverWorkspacesFromCurrentPage);

      if (!result || !result.success) {
        return { success: false, error: (result && result.error) || 'Unable to inspect ChatGPT workspaces.' };
      }

      return {
        success: true,
        workspaces: result.workspaces || [],
        skipped: result.skipped || [],
        detectedCount: result.detectedCount || 0
      };
    } catch (error) {
      console.error('Workspace discovery error:', error);
      return { success: false, error: error.message };
    }
  }

  if (message.action === 'export_all_workspaces') {
    try {
      const tab = await findChatGPTTab(sender);
      const result = await executeFunctionInTab(tab.id, collectWorkspaceSessionsFromCurrentPage);

      if (!result || !result.success) {
        return { success: false, error: (result && result.error) || 'Unable to export workspace sessions.' };
      }

      const filenames = new Set();
      let exportedCount = 0;
      const exportedWorkspaces = [];

      for (const item of result.sessions || []) {
        const sessionData = item.sessionData;
        const workspace = item.workspace || {};
        const authJson = generateCodexAuthJson(sessionData);
        if (!isSafeAuthJson(authJson)) {
          continue;
        }

        const downloadId = await downloadAuthFile({
          url: toJsonDataUrl(authJson),
          filename: generateUniqueAuthFilename(sessionData, filenames, workspace),
          saveAs: false,
          conflictAction: 'uniquify'
        });

        if (downloadId !== undefined) {
          exportedCount++;
          exportedWorkspaces.push(workspace);
        }
      }

      return {
        success: true,
        exportedCount,
        workspaces: exportedWorkspaces,
        skipped: result.skipped || [],
        detectedCount: result.detectedCount || 0
      };
    } catch (error) {
      console.error('Multi workspace export error:', sanitizeError(error));
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'UNKNOWN_ACTION' };
}

function isTrustedExtensionSender(sender) {
  if (!sender || sender.id !== extensionApi.runtime.id) {
    return false;
  }

  if (!sender.url) {
    return true;
  }

  try {
    return new URL(sender.url).origin === new URL(extensionApi.runtime.getURL('')).origin;
  } catch (error) {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Cross-origin request to the ChatGPT Session API.
 * With host permissions, Chromium background workers can perform this request directly.
 * Firefox may not include the active tab cookies here, so the tab-injected fallback below
 * remains the source of truth when direct session detection fails.
 */
async function fetchChatGPTSession() {
  const response = await fetch(CHATGPT_SESSION_URL, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
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
      planType: stringOrEmpty(account.planType),
      workspaceType: stringOrEmpty(account.workspaceType)
    },
    expires: stringOrEmpty(session.expires),
    isExportable: Boolean(session.accessToken && session.sessionToken)
  };
}

function getSafeImageUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch (error) {
    return '';
  }
}

async function fetchChatGPTSessionFromChatGPTTab(sender) {
  const tab = await findChatGPTTab(sender);
  const data = await executeSessionFetchInTab(tab.id);

  if (!data || !data.accessToken) {
    throw new Error('UNAUTHORIZED');
  }

  return data;
}

async function findChatGPTTab(sender) {
  const senderIsIncognito = Boolean(sender && (sender.incognito || (sender.tab && sender.tab.incognito)));
  const activeTabs = await queryTabs({ active: true, lastFocusedWindow: true });
  const activeTab = selectChatGPTTab(activeTabs, senderIsIncognito);

  if (activeTab) {
    return activeTab;
  }

  const tabs = await queryTabs({ url: 'https://chatgpt.com/*' });
  const tab = selectChatGPTTab(tabs, senderIsIncognito);

  if (!tab || !tab.id) {
    throw new Error('NO_CHATGPT_TAB');
  }

  return tab;
}

function selectChatGPTTab(tabs, isIncognito) {
  const chatgptTabs = (tabs || []).filter(tab => tab.id && tab.url && tab.url.startsWith('https://chatgpt.com/'));
  const sameContextTabs = chatgptTabs.filter(tab => Boolean(tab.incognito) === isIncognito);
  return sameContextTabs[0] || chatgptTabs[0] || null;
}

function getRuntimeLastError() {
  return typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.lastError : null;
}

function queryTabs(query) {
  if (hasPromiseExtensionApi) {
    return extensionApi.tabs.query(query);
  }

  return new Promise((resolve, reject) => {
    extensionApi.tabs.query(query, tabs => {
      const runtimeError = getRuntimeLastError();
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(tabs || []);
    });
  });
}

async function executeSessionFetchInTab(tabId) {
  return executeFunctionInTab(tabId, fetchSessionFromCurrentPage);
}

async function executeFunctionInTab(tabId, func, args = []) {
  if (extensionApi.scripting && extensionApi.scripting.executeScript) {
    const details = {
      target: { tabId },
      func,
      args
    };
    const [result] = hasPromiseExtensionApi
      ? await extensionApi.scripting.executeScript(details)
      : await executeScriptMv3(details);

    return result && result.result;
  }

  if (extensionApi.tabs && extensionApi.tabs.executeScript) {
    const encodedArgs = JSON.stringify(args);
    const [result] = await executeScriptMv2(tabId, {
      code: `(${func.toString()})(...${encodedArgs})`
    });

    return result;
  }

  throw new Error('SCRIPTING_UNAVAILABLE');
}

async function fetchSessionFromCurrentPage() {
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  return response.json();
}

async function discoverWorkspacesFromCurrentPage() {
  const fetchJsonFromChatGPT = async (url, options = {}) => {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      ...options,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const error = new Error(`HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  };

  const getAccountCount = (payload) => {
    const accounts = payload && payload.accounts;
    if (Array.isArray(accounts)) return accounts.length;
    if (accounts && typeof accounts === 'object') return Object.keys(accounts).length;
    return 0;
  };

  const fetchAccountsPayload = async (accessToken) => {
    const timezoneOffset = new Date().getTimezoneOffset();
    const path = `/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=${encodeURIComponent(timezoneOffset)}`;
    let credentialsPayload = null;
    let credentialsError = null;

    try {
      credentialsPayload = await fetchJsonFromChatGPT(path);
    } catch (error) {
      credentialsError = error;
    }

    if (accessToken) {
      try {
        const bearerPayload = await fetchJsonFromChatGPT(path, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (getAccountCount(bearerPayload) >= getAccountCount(credentialsPayload)) {
          return bearerPayload;
        }
      } catch (error) {
        if (!credentialsPayload && credentialsError) {
          throw credentialsError;
        }
      }
    }

    if (credentialsPayload) {
      return credentialsPayload;
    }

    throw credentialsError || new Error('accounts/check failed.');
  };

  const normalizeAccount = (account, fallbackId) => {
    const id = account.account_id || account.id || account.workspace_id || account.workspaceId || fallbackId || '';
    const workspaceType = account.workspace_type || account.workspaceType || '';
    const role = account.account_user_role || account.role || '';
    const accountType = String(account.account_type || account.accountType || account.type || '').toLowerCase();
    const planType = String(account.plan_type || account.planType || '').toLowerCase();
    const name = account.name || account.display_name || id;
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(name));
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(name));
    const isPersonal = Boolean(
      account.is_personal ||
      account.personal ||
      account.is_personal_account ||
      account.is_default ||
      accountType === 'personal' ||
      accountType === 'individual' ||
      workspaceType === 'personal' ||
      looksLikeEmail ||
      looksLikeUuid ||
      (!workspaceType && !role && (looksLikeEmail || planType === 'free' || planType === 'plus' || planType === 'pro'))
    );
    const isWorkspaceCandidate = Boolean(!isPersonal && (workspaceType || role || account.workspace_id || account.workspaceId || account.organization_id || account.organizationId || accountType === 'workspace'));
    const isExportCandidate = Boolean(isPersonal || isWorkspaceCandidate);

    return {
      id,
      name,
      isDeactivated: Boolean(account.is_deactivated || account.deactivated),
      eligibleForReactivation: Boolean(account.eligible_for_reactivation),
      isPersonal,
      isWorkspaceCandidate,
      isExportCandidate,
      workspaceType,
      role
    };
  };

  const normalizeAccountsPayload = (accountsPayload) => {
    const accounts = accountsPayload && accountsPayload.accounts;
    const ordering = accountsPayload && accountsPayload.account_ordering;
    if (!accounts || typeof accounts !== 'object') return [];

    if (Array.isArray(accounts)) {
      return accounts
        .map((wrapper, index) => normalizeAccount((wrapper && wrapper.account) || wrapper || {}, String(index)))
        .filter(account => account.id);
    }

    const orderedIds = Array.isArray(ordering) ? ordering : [];
    const accountIds = Object.keys(accounts);
    const ids = [...new Set([...orderedIds, ...accountIds])];

    return ids
      .map(id => normalizeAccount((accounts[id] && accounts[id].account) || accounts[id] || {}, id))
      .filter(account => account.id);
  };

  const buildCurrentSessionAccount = (sessionData, accountId) => {
    if (!sessionData || !accountId) return null;
    const account = sessionData.account || {};
    const user = sessionData.user || {};
    const name = account.name || account.displayName || user.name || user.email || 'Personal account';

    return {
      id: accountId,
      name,
      isDeactivated: false,
      eligibleForReactivation: false,
      isPersonal: true,
      isWorkspaceCandidate: false,
      isExportCandidate: true,
      workspaceType: 'personal',
      role: ''
    };
  };

  const ensureCurrentSessionAccount = (accounts, sessionData, accountId) => {
    const currentAccount = buildCurrentSessionAccount(sessionData, accountId);
    if (!currentAccount) return accounts;

    let foundCurrentAccount = false;
    const normalizedAccounts = accounts.map(account => {
      if (account.id !== accountId) return account;

      foundCurrentAccount = true;
      if (account.isWorkspaceCandidate) return account;

      return {
        ...account,
        name: account.name || currentAccount.name,
        isPersonal: true,
        isExportCandidate: true,
        workspaceType: account.workspaceType || 'personal'
      };
    });

    return foundCurrentAccount ? normalizedAccounts : [currentAccount, ...accounts];
  };

  const exchangeWorkspaceSession = async (workspaceId, accessToken) => {
    const path = `/api/auth/session?exchange_workspace_token=true&workspace_id=${encodeURIComponent(workspaceId)}&reason=account_switcher`;

    try {
      return await fetchJsonFromChatGPT(path);
    } catch (error) {
      if ((error.status === 401 || error.status === 403) && accessToken) {
        return fetchJsonFromChatGPT(path, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }

      throw error;
    }
  };

  const getAccountIdFromAccessToken = (accessToken) => {
    try {
      const payloadPart = String(accessToken || '').split('.')[1];
      if (!payloadPart) return '';
      const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const json = decodeURIComponent(atob(padded).split('').map(char => `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`).join(''));
      const payload = JSON.parse(json);
      const auth = payload['https://api.openai.com/auth'] || {};
      return auth.chatgpt_account_id || '';
    } catch (error) {
      return '';
    }
  };

  const getAccountIdFromSessionData = (sessionData) => {
    if (!sessionData) return '';
    return getAccountIdFromAccessToken(sessionData.accessToken)
      || sessionData.chatgptAccountId
      || (sessionData.account && sessionData.account.id)
      || sessionData.accountId
      || (sessionData.user && sessionData.user.accountId)
      || '';
  };

  try {
    const currentSession = await fetchJsonFromChatGPT('/api/auth/session');
    const accessToken = currentSession && currentSession.accessToken;
    const currentAccountId = getAccountIdFromSessionData(currentSession);
    const accountsPayload = await fetchAccountsPayload(accessToken);
    const accounts = ensureCurrentSessionAccount(
      normalizeAccountsPayload(accountsPayload),
      currentSession,
      currentAccountId
    );
    const workspaceCandidateCount = accounts.filter(account => account.isExportCandidate && !account.isDeactivated).length;
    const workspaces = [];
    const skipped = [];

    for (const account of accounts) {
      if (account.isDeactivated) {
        skipped.push({ id: account.id, name: account.name, reason: 'deactivated' });
        continue;
      }

      if (!account.isExportCandidate) {
        continue;
      }

      try {
        const sessionData = (account.isPersonal && (!currentAccountId || currentAccountId === account.id))
          ? currentSession
          : await exchangeWorkspaceSession(account.id, accessToken);
        const error = sessionData && sessionData.workspaceTokenExchangeError;
        if (error) {
          skipped.push({ id: account.id, name: account.name, reason: error.code || 'exchange_error' });
          continue;
        }

        const sessionAccountId = getAccountIdFromSessionData(sessionData);
        if (!sessionData || !sessionData.accessToken) {
          skipped.push({ id: account.id, name: account.name, reason: 'no_token' });
          continue;
        }

        if (!account.isPersonal && sessionAccountId && sessionAccountId !== account.id) {
          skipped.push({ id: account.id, name: account.name, reason: 'account_mismatch' });
          continue;
        }

        workspaces.push({
          id: account.id,
          name: account.name,
          workspaceType: account.isPersonal ? 'personal' : account.workspaceType,
          role: account.role,
          isPersonal: account.isPersonal
        });
      } catch (error) {
        skipped.push({ id: account.id, name: account.name, reason: error.message || 'error' });
      }
    }

    return { success: true, workspaces, skipped, detectedCount: workspaceCandidateCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function collectWorkspaceSessionsFromCurrentPage() {
  const fetchJsonFromChatGPT = async (url, options = {}) => {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      ...options,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const error = new Error(`HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  };

  const getAccountCount = (payload) => {
    const accounts = payload && payload.accounts;
    if (Array.isArray(accounts)) return accounts.length;
    if (accounts && typeof accounts === 'object') return Object.keys(accounts).length;
    return 0;
  };

  const fetchAccountsPayload = async (accessToken) => {
    const timezoneOffset = new Date().getTimezoneOffset();
    const path = `/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=${encodeURIComponent(timezoneOffset)}`;
    let credentialsPayload = null;
    let credentialsError = null;

    try {
      credentialsPayload = await fetchJsonFromChatGPT(path);
    } catch (error) {
      credentialsError = error;
    }

    if (accessToken) {
      try {
        const bearerPayload = await fetchJsonFromChatGPT(path, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (getAccountCount(bearerPayload) >= getAccountCount(credentialsPayload)) {
          return bearerPayload;
        }
      } catch (error) {
        if (!credentialsPayload && credentialsError) {
          throw credentialsError;
        }
      }
    }

    if (credentialsPayload) {
      return credentialsPayload;
    }

    throw credentialsError || new Error('accounts/check failed.');
  };

  const normalizeAccount = (account, fallbackId) => {
    const id = account.account_id || account.id || account.workspace_id || account.workspaceId || fallbackId || '';
    const workspaceType = account.workspace_type || account.workspaceType || '';
    const role = account.account_user_role || account.role || '';
    const accountType = String(account.account_type || account.accountType || account.type || '').toLowerCase();
    const planType = String(account.plan_type || account.planType || '').toLowerCase();
    const name = account.name || account.display_name || id;
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(name));
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(name));
    const isPersonal = Boolean(
      account.is_personal ||
      account.personal ||
      account.is_personal_account ||
      account.is_default ||
      accountType === 'personal' ||
      accountType === 'individual' ||
      workspaceType === 'personal' ||
      looksLikeEmail ||
      looksLikeUuid ||
      (!workspaceType && !role && (looksLikeEmail || planType === 'free' || planType === 'plus' || planType === 'pro'))
    );
    const isWorkspaceCandidate = Boolean(!isPersonal && (workspaceType || role || account.workspace_id || account.workspaceId || account.organization_id || account.organizationId || accountType === 'workspace'));
    const isExportCandidate = Boolean(isPersonal || isWorkspaceCandidate);

    return {
      id,
      name,
      isDeactivated: Boolean(account.is_deactivated || account.deactivated),
      eligibleForReactivation: Boolean(account.eligible_for_reactivation),
      isPersonal,
      isWorkspaceCandidate,
      isExportCandidate,
      workspaceType,
      role
    };
  };

  const normalizeAccountsPayload = (accountsPayload) => {
    const accounts = accountsPayload && accountsPayload.accounts;
    const ordering = accountsPayload && accountsPayload.account_ordering;
    if (!accounts || typeof accounts !== 'object') return [];

    if (Array.isArray(accounts)) {
      return accounts
        .map((wrapper, index) => normalizeAccount((wrapper && wrapper.account) || wrapper || {}, String(index)))
        .filter(account => account.id);
    }

    const orderedIds = Array.isArray(ordering) ? ordering : [];
    const accountIds = Object.keys(accounts);
    const ids = [...new Set([...orderedIds, ...accountIds])];

    return ids
      .map(id => normalizeAccount((accounts[id] && accounts[id].account) || accounts[id] || {}, id))
      .filter(account => account.id);
  };

  const buildCurrentSessionAccount = (sessionData, accountId) => {
    if (!sessionData || !accountId) return null;
    const account = sessionData.account || {};
    const user = sessionData.user || {};
    const name = account.name || account.displayName || user.name || user.email || 'Personal account';

    return {
      id: accountId,
      name,
      isDeactivated: false,
      eligibleForReactivation: false,
      isPersonal: true,
      isWorkspaceCandidate: false,
      isExportCandidate: true,
      workspaceType: 'personal',
      role: ''
    };
  };

  const ensureCurrentSessionAccount = (accounts, sessionData, accountId) => {
    const currentAccount = buildCurrentSessionAccount(sessionData, accountId);
    if (!currentAccount) return accounts;

    let foundCurrentAccount = false;
    const normalizedAccounts = accounts.map(account => {
      if (account.id !== accountId) return account;

      foundCurrentAccount = true;
      if (account.isWorkspaceCandidate) return account;

      return {
        ...account,
        name: account.name || currentAccount.name,
        isPersonal: true,
        isExportCandidate: true,
        workspaceType: account.workspaceType || 'personal'
      };
    });

    return foundCurrentAccount ? normalizedAccounts : [currentAccount, ...accounts];
  };

  const exchangeWorkspaceSession = async (workspaceId, accessToken) => {
    const path = `/api/auth/session?exchange_workspace_token=true&workspace_id=${encodeURIComponent(workspaceId)}&reason=account_switcher`;

    try {
      return await fetchJsonFromChatGPT(path);
    } catch (error) {
      if ((error.status === 401 || error.status === 403) && accessToken) {
        return fetchJsonFromChatGPT(path, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }

      throw error;
    }
  };

  const getAccountIdFromAccessToken = (accessToken) => {
    try {
      const payloadPart = String(accessToken || '').split('.')[1];
      if (!payloadPart) return '';
      const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const json = decodeURIComponent(atob(padded).split('').map(char => `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`).join(''));
      const payload = JSON.parse(json);
      const auth = payload['https://api.openai.com/auth'] || {};
      return auth.chatgpt_account_id || '';
    } catch (error) {
      return '';
    }
  };

  const getAccountIdFromSessionData = (sessionData) => {
    if (!sessionData) return '';
    return getAccountIdFromAccessToken(sessionData.accessToken)
      || sessionData.chatgptAccountId
      || (sessionData.account && sessionData.account.id)
      || sessionData.accountId
      || (sessionData.user && sessionData.user.accountId)
      || '';
  };

  try {
    const currentSession = await fetchJsonFromChatGPT('/api/auth/session');
    const accessToken = currentSession && currentSession.accessToken;
    const currentAccountId = getAccountIdFromSessionData(currentSession);

    if (!accessToken) {
      return { success: false, error: 'Access token not found. Please log in to ChatGPT first.' };
    }

    const accountsPayload = await fetchAccountsPayload(accessToken);
    const accounts = ensureCurrentSessionAccount(
      normalizeAccountsPayload(accountsPayload),
      currentSession,
      currentAccountId
    );
    const workspaceCandidateCount = accounts.filter(account => account.isExportCandidate && !account.isDeactivated).length;
    const sessions = [];
    const skipped = [];

    for (const account of accounts) {
      if (account.isDeactivated) {
        skipped.push({ id: account.id, name: account.name, reason: 'deactivated' });
        continue;
      }

      if (!account.isExportCandidate) {
        continue;
      }

      try {
        const sessionData = (account.isPersonal && (!currentAccountId || currentAccountId === account.id))
          ? currentSession
          : await exchangeWorkspaceSession(account.id, accessToken);
        const error = sessionData && sessionData.workspaceTokenExchangeError;
        if (error) {
          skipped.push({ id: account.id, name: account.name, reason: error.code || 'exchange_error' });
          continue;
        }

        const sessionAccountId = getAccountIdFromSessionData(sessionData);
        if (sessionData && sessionAccountId) {
          sessionData.chatgptAccountId = sessionAccountId || account.id;
        }

        if (!sessionData || !sessionData.accessToken) {
          skipped.push({ id: account.id, name: account.name, reason: 'no_token' });
          continue;
        }

        if (!account.isPersonal && sessionAccountId && sessionAccountId !== account.id) {
          skipped.push({ id: account.id, name: account.name, reason: 'account_mismatch' });
          continue;
        }

        sessionData.chatgptAccountId = sessionData.chatgptAccountId || account.id;
        sessionData.workspaceName = account.name;
        sessionData.workspaceType = account.isPersonal ? 'personal' : account.workspaceType;
        sessions.push({
          workspace: { ...account, workspaceType: account.isPersonal ? 'personal' : account.workspaceType },
          sessionData
        });
      } catch (error) {
        skipped.push({ id: account.id, name: account.name, reason: error.message || 'error' });
      }
    }

    return { success: true, sessions, skipped, detectedCount: workspaceCandidateCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function executeScriptMv2(tabId, details) {
  if (hasPromiseExtensionApi) {
    return extensionApi.tabs.executeScript(tabId, details);
  }

  return new Promise((resolve, reject) => {
    extensionApi.tabs.executeScript(tabId, details, results => {
      const runtimeError = getRuntimeLastError();
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(results || []);
    });
  });
}

function executeScriptMv3(details) {
  return new Promise((resolve, reject) => {
    extensionApi.scripting.executeScript(details, results => {
      const runtimeError = getRuntimeLastError();
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(results || []);
    });
  });
}

function downloadAuthFile(options) {
  if (hasPromiseExtensionApi) {
    return extensionApi.downloads.download(options);
  }

  return new Promise((resolve, reject) => {
    extensionApi.downloads.download(options, downloadId => {
      const runtimeError = getRuntimeLastError();
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

function generateCodexAuthJson(session) {
  const accountId = getSessionAccountId(session);
  const email = stringOrEmpty(session.user && session.user.email);
  const planType = stringOrEmpty(session.account && (session.account.planType || session.account.workspaceType))
    || stringOrEmpty(session.workspaceType)
    || 'free';
  const userId = stringOrEmpty(session.user && session.user.id);
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
    return parsed && parsed.auth_mode === 'chatgpt'
      && typeof parsed.tokens?.access_token === 'string'
      && parsed.tokens.access_token.length > 0
      && typeof parsed.tokens?.refresh_token === 'string'
      && parsed.tokens.refresh_token.length > 0;
  } catch (error) {
    return false;
  }
}

function toJsonDataUrl(jsonContent) {
  return 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonContent);
}

function generateAuthFilename(session) {
  return generateWorkspaceAuthFilename(session, {});
}

function generateUniqueAuthFilename(session, usedFilenames, workspace = {}) {
  let filename = generateWorkspaceAuthFilename(session, workspace);
  if (!usedFilenames.has(filename)) {
    usedFilenames.add(filename);
    return filename;
  }

  const accountId = getSessionAccountId(session) || workspace.id || '';
  const shortAccountId = sanitizeFilenamePart(accountId.slice(0, 8));
  const basename = filename.replace(/\.json$/i, '');
  filename = `${basename}-${shortAccountId || 'workspace'}.json`;

  let counter = 2;
  while (usedFilenames.has(filename)) {
    filename = `${basename}-${shortAccountId || 'workspace'}-${counter}.json`;
    counter++;
  }

  usedFilenames.add(filename);
  return filename;
}

function generateWorkspaceAuthFilename(session, workspace = {}) {
  const workspaceName = workspace.name
    || session.workspaceName
    || (session.account && (session.account.name || session.account.displayName))
    || '';
  const emailLocalPart = getEmailLocalPart(session);
  const safeEmailPrefix = sanitizeFilenamePart(emailLocalPart || 'chatgpt');

  if (workspaceName && !isUuidLike(workspaceName)) {
    return `${safeEmailPrefix}-${sanitizeFilenamePart(workspaceName)}.json`;
  }

  const accountId = getSessionAccountId(session) || workspace.id || (session.account && session.account.id) || '';
  const safeAccountId = sanitizeFilenamePart(accountId);
  return `${safeEmailPrefix}-${safeAccountId || 'chatgpt-workspace'}.json`;
}

function getEmailLocalPart(session) {
  const email = session && session.user && session.user.email;
  if (!email) return '';
  return String(email).split('@')[0] || '';
}

function getSessionAccountId(session) {
  if (!session) return '';
  return getAccountIdFromAccessToken(session.accessToken)
    || session.chatgptAccountId
    || (session.account && session.account.id)
    || session.accountId
    || (session.user && session.user.accountId)
    || '';
}

function getAccountIdFromAccessToken(accessToken) {
  try {
    const payloadPart = String(accessToken || '').split('.')[1];
    if (!payloadPart) return '';
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = decodeURIComponent(atob(padded).split('').map(char => `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`).join(''));
    const payload = JSON.parse(json);
    const auth = payload['https://api.openai.com/auth'] || {};
    return auth.chatgpt_account_id || '';
  } catch (error) {
    return '';
  }
}

function sanitizeFilenamePart(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '') || 'unknown';
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

function sanitizeError(error) {
  return {
    name: error && error.name ? error.name : 'Error',
    message: error && error.message ? error.message : String(error)
  };
}
