// popup.js - Core interaction logic for Codex Auth Exporter
// Following local-only processing principle: no storage, no cloud upload

// Store Session data globally
let globalSession = null;
let countdownInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  // Initialize and fetch data
  initSessionFetch();
  
  // Bind basic event listeners
  bindEvents();
});

/**
 * Initialize Session fetching
 */
function initSessionFetch() {
  showState('loading');
  
  // Send request to background.js to initiate cross-origin fetch
  chrome.runtime.sendMessage({ action: 'fetch_session' }, (response) => {
    // Handle channel closure or error
    if (chrome.runtime.lastError) {
      console.error('Communication error:', chrome.runtime.lastError);
      showState('unauthorized');
      return;
    }

    if (response && response.success) {
      globalSession = response.data;
      renderAuthorizedState(response.data);
      showState('authorized');
    } else {
      showState('unauthorized');
    }
  });
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
    chrome.tabs.create({ url: 'https://chatgpt.com/' });
    window.close(); // Close the popup window
  });

  // 2. Export auth.json - delegate to background service worker for download
  document.getElementById('btn-download').addEventListener('click', () => {
    if (!globalSession) return;
    
    chrome.runtime.sendMessage({ action: 'export_auth_json' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Download communication error:', chrome.runtime.lastError);
        showToast('\u274c Download failed, please try again');
        return;
      }
      if (response && response.success) {
        showToast('\u{1F389} auth.json download started');
      } else {
        showToast('\u274c Download failed, please try again');
      }
    });
  });
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
