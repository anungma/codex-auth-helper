// popup.js - Core interaction logic for Codex Auth Exporter
// Following local-only processing principle: no storage, no cloud upload

// Store Session data globally
const hasPromiseExtensionApi = typeof browser !== 'undefined';
const extensionApi = hasPromiseExtensionApi ? browser : chrome;
let globalSession = null;
let globalWorkspaces = [];
let isWorkspaceDiscoveryInProgress = false;
let isAllWorkspaceExportInProgress = false;
let countdownInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  renderExtensionVersion();

  // Initialize and fetch data
  initSessionFetch();
  
  // Bind basic event listeners
  bindEvents();
});

function renderExtensionVersion() {
  const versionEl = document.getElementById('extension-version');
  const manifest = extensionApi.runtime.getManifest();
  versionEl.textContent = `Codex Auth Exporter v${manifest.version}`;
}

/**
 * Initialize Session fetching
 */
function initSessionFetch() {
  showState('loading');
  
  // Send request to background.js to initiate cross-origin fetch
  sendRuntimeMessage({ action: 'fetch_session' })
    .then(response => {
    if (response && response.success && isExportableSession(response.data)) {
      globalSession = response.data;
      renderAuthorizedState(response.data);
      showState('authorized');
      initWorkspaceDiscovery();
    } else {
      globalSession = null;
      globalWorkspaces = [];
      showState('unauthorized');
    }
    })
    .catch(error => {
      console.error('Communication error:', error);
      showState('unauthorized');
    });
}

function isExportableSession(session) {
  return Boolean(session && (session.accessToken || session.isExportable));
}

/**
 * Switch UI display state
 * @param {'loading'|'unauthorized'|'authorized'} state 
 */
function showState(state) {
  const loadingEl = document.getElementById('state-loading');
  const unauthorizedEl = document.getElementById('state-unauthorized');
  const authorizedEl = document.getElementById('state-authorized');

  loadingEl.classList.remove('active');
  unauthorizedEl.classList.remove('active');
  authorizedEl.classList.remove('active');

  if (state === 'loading') {
    loadingEl.classList.add('active');
  } else if (state === 'unauthorized') {
    unauthorizedEl.classList.add('active');
  } else if (state === 'authorized') {
    authorizedEl.classList.add('active');
  }
}

/**
 * Render UI data for the authorized (logged-in) state
 */
function renderAuthorizedState(session) {
  const avatarEl = document.getElementById('user-avatar');
  const nameEl = document.getElementById('user-name');
  const emailEl = document.getElementById('user-email');
  const planEl = document.getElementById('badge-plan');
  const expiresEl = document.getElementById('token-expires');

  // User profile information
  const user = session.user || {};
  avatarEl.src = user.image || 'https://lh3.googleusercontent.com/a/default-user=s96-c';
  nameEl.textContent = user.name || 'ChatGPT User';
  emailEl.textContent = user.email || 'No email linked';

  // Account plan
  const account = session.account || {};
  const planType = (account.planType || 'free').toUpperCase();
  planEl.textContent = planType;
  
  if (planType === 'PLUS' || planType === 'PRO') {
    planEl.className = 'plan-badge plus';
  } else {
    planEl.className = 'plan-badge free';
  }

  // Expiration date
  const expiresTime = session.expires ? new Date(session.expires) : null;
  if (expiresTime) {
    expiresEl.textContent = formatLocalDate(expiresTime);
    // Start real-time remaining time countdown
    startCountdown(expiresTime);
  } else {
    expiresEl.textContent = 'Never expires';
    document.getElementById('token-countdown').textContent = 'Unlimited';
  }
}

/**
 * Bind all button events in the DOM
 */
function bindEvents() {
  // 1. Not logged in - redirect to login page
  document.getElementById('btn-login').addEventListener('click', () => {
    createTab({ url: 'https://chatgpt.com/' });
    window.close(); // Close the popup window
  });

  // 2. Export auth.json - delegate to background service worker for download
  document.getElementById('btn-download').addEventListener('click', () => {
    if (!isExportableSession(globalSession)) {
      showToast('\u274c No active ChatGPT session found');
      return;
    }

    sendRuntimeMessage({ action: 'export_current_account' })
      .then(response => {
      if (response && response.success) {
        showToast('\u{1F389} auth.json download started');
      } else {
        showToast('\u274c Download failed, please try again');
      }
      })
      .catch(error => {
        console.error('Download communication error:', error);
        showToast('\u274c Download failed, please try again');
      });
  });

  document.getElementById('btn-export-all').addEventListener('click', handleExportAllWorkspaces);
}

function getRuntimeLastError() {
  return typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.lastError : null;
}

function sendRuntimeMessage(message) {
  if (hasPromiseExtensionApi) {
    return extensionApi.runtime.sendMessage(message);
  }

  return new Promise((resolve, reject) => {
    extensionApi.runtime.sendMessage(message, response => {
      const runtimeError = getRuntimeLastError();
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

function createTab(options) {
  if (hasPromiseExtensionApi) {
    return extensionApi.tabs.create(options);
  }

  return new Promise((resolve, reject) => {
    extensionApi.tabs.create(options, tab => {
      const runtimeError = getRuntimeLastError();
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function initWorkspaceDiscovery() {
  isWorkspaceDiscoveryInProgress = true;
  renderWorkspaceListState('loading');

  sendRuntimeMessage({ action: 'list_workspaces' })
    .then(response => {
      if (!response || !response.success) {
        globalWorkspaces = [];
        renderWorkspaceListState('error', [], response && response.error);
        return;
      }

      globalWorkspaces = response.workspaces || [];
      renderWorkspaceListState('ready', globalWorkspaces, '', response.skipped || [], response.detectedCount || 0);
    })
    .catch(error => {
      console.error('Workspace discovery error:', error);
      globalWorkspaces = [];
      renderWorkspaceListState('error', [], error.message);
    })
    .finally(() => {
      isWorkspaceDiscoveryInProgress = false;
      setWorkspaceSpinner(false);
      updateExportAllButtonState();
    });
}

function renderWorkspaceListState(state, workspaces = [], errorMessage = '', skipped = [], detectedCount = 0) {
  const countEl = document.getElementById('workspace-count');
  const summaryEl = document.getElementById('workspace-summary');
  const listEl = document.getElementById('workspace-list');

  if (!countEl || !summaryEl || !listEl) return;

  listEl.innerHTML = '';
  setWorkspaceSpinner(state === 'loading' || state === 'exporting');

  if (state === 'loading') {
    countEl.textContent = '...';
    summaryEl.textContent = 'Wait! Inspecting account access.';
    listEl.innerHTML = '<span class="workspace-empty">Loading account names...</span>';
    updateExportAllButtonState();
    return;
  }

  if (state === 'exporting') {
    countEl.textContent = String(globalWorkspaces.length);
    summaryEl.textContent = 'Exporting account auth files...';
    listEl.innerHTML = '<span class="workspace-empty">Please keep this popup open until downloads start.</span>';
    updateExportAllButtonState();
    return;
  }

  if (state === 'error') {
    countEl.textContent = '0';
    summaryEl.textContent = errorMessage || 'Unable to inspect workspaces.';
    listEl.innerHTML = '<span class="workspace-empty">Open a ChatGPT tab and try again.</span>';
    updateExportAllButtonState();
    return;
  }

  countEl.textContent = String(workspaces.length);
  const skippedText = skipped.length ? `, ${skipped.length} skipped` : '';
  const detectedText = detectedCount && detectedCount !== workspaces.length ? `${detectedCount} detected, ` : '';
  summaryEl.textContent = `${detectedText}${workspaces.length} exportable account${workspaces.length === 1 ? '' : 's'}${skippedText}.`;
  updateExportAllButtonState();

  if (!workspaces.length) {
    listEl.innerHTML = '<span class="workspace-empty">No exportable account found.</span>';
    return;
  }

  for (const workspace of workspaces) {
    const chip = document.createElement('span');
    chip.className = 'workspace-chip';
    chip.title = workspace.id || workspace.name || '';
    chip.textContent = workspace.name || workspace.id || 'Unnamed workspace';
    listEl.appendChild(chip);
  }
}

function handleExportAllWorkspaces() {
  if (!canExportAllWorkspaces()) {
    showToast(globalWorkspaces.length === 0 ? '\u26a0\ufe0f No exportable account found' : '\u23f3 Account scan still running');
    updateExportAllButtonState();
    return;
  }

  if (!isExportableSession(globalSession)) {
    showToast('\u274c No active ChatGPT session found');
    return;
  }

  isAllWorkspaceExportInProgress = true;
  renderWorkspaceListState('exporting');
  updateExportAllButtonState();
  showToast('\u23f3 Exporting account auth files...');

  sendRuntimeMessage({ action: 'export_all_workspaces' })
    .then(async response => {
      if (!response || !response.success) {
        showToast('\u274c Multi export failed');
        renderWorkspaceListState('error', [], response && response.error);
        return;
      }

      const sessions = response.sessions || [];
      const skipped = response.skipped || [];
      const exportedCount = response.exportedCount || 0;
      const workspaces = response.workspaces || sessions.map(item => item.workspace).filter(Boolean);

      showToast(`\u{1F389} Exported ${exportedCount}, skipped ${skipped.length}`);
      if (workspaces.length || skipped.length) {
        renderWorkspaceListState('ready', workspaces, '', skipped, response.detectedCount || 0);
      }
    })
    .catch(error => {
      console.error('Multi export error:', error);
      showToast('\u274c Multi export failed');
    })
    .finally(() => {
      isAllWorkspaceExportInProgress = false;
      updateExportAllButtonState();
    });
}

function canExportAllWorkspaces() {
  return Boolean(
    isExportableSession(globalSession) &&
    !isWorkspaceDiscoveryInProgress &&
    !isAllWorkspaceExportInProgress &&
    globalWorkspaces.length > 0
  );
}

function updateExportAllButtonState() {
  const exportAllBtn = document.getElementById('btn-export-all');
  if (!exportAllBtn) return;

  exportAllBtn.disabled = !canExportAllWorkspaces();
  if (isWorkspaceDiscoveryInProgress) {
    exportAllBtn.title = 'Account scan is still running.';
  } else if (isAllWorkspaceExportInProgress) {
    exportAllBtn.title = 'Export is still running.';
  } else if (globalWorkspaces.length === 0) {
    exportAllBtn.title = 'Available when at least one workspace is detected.';
  } else {
    exportAllBtn.title = 'Download one auth JSON file per active personal/workspace account.';
  }
}

function setWorkspaceSpinner(isActive) {
  const spinnerEl = document.getElementById('workspace-spinner');
  if (!spinnerEl) return;
  spinnerEl.classList.toggle('active', isActive);
}

function generateAuthFilename(session) {
  const user = session.user || {};
  const account = session.account || {};
  const identity = getEmailLocalPart(session) || user.name || user.id || getSessionAccountId(session) || account.id || 'chatgpt-account';
  const planType = account.planType || account.workspaceType || session.workspaceType || 'free';
  const safeIdentity = sanitizeFilenamePart(identity);
  const safePlanType = sanitizeFilenamePart(planType);

  return `${safeIdentity}-${safePlanType}.json`;
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

/**
 * Real-time countdown for token validity period
 */
function startCountdown(expiresTime) {
  if (countdownInterval) clearInterval(countdownInterval);

  const countdownEl = document.getElementById('token-countdown');

  function update() {
    const now = new Date();
    const diff = expiresTime - now;

    if (diff <= 0) {
      countdownEl.textContent = 'Expired';
      countdownEl.className = 'detail-value text-danger';
      clearInterval(countdownInterval);
      return;
    }

    // Convert to days, hours, minutes, seconds
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    let displayStr = '';
    if (days > 0) displayStr += `${days}d `;
    if (hours > 0 || days > 0) displayStr += `${hours}h `;
    displayStr += `${minutes}m ${seconds}s`;

    countdownEl.textContent = displayStr;
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

/**
 * Format a local date string (YYYY-MM-DD HH:MM)
 */
function formatLocalDate(date) {
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Show a lightweight Toast notification
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  
  toastMsg.textContent = message;
  toast.classList.add('show');
  
  // Disappear after 2 seconds
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

