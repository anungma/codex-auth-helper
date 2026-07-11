// background.js - Service Worker for async Session fetching + file download
// Following Manifest V3 best practices, avoiding loss of global state

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetch_session') {
    // Run request asynchronously
    fetchChatGPTSession()
      .then(sessionData => {
        sendResponse({ success: true, data: sessionData });
      })
      .catch(error => {
        console.error('Failed to fetch ChatGPT Session:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Important: keep the async communication channel open
  }

  if (message.action === 'download_auth_json') {
    // Run download in the Service Worker process, independent of Popup lifecycle
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(message.jsonContent);
    chrome.downloads.download({
      url: dataUrl,
      filename: 'auth.json',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download error:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId: downloadId });
      }
    });
    return true; // Keep the async communication channel open
  }
});

/**
 * Cross-origin request to the ChatGPT Session API
 * Since host_permissions for https://chatgpt.com/ are declared in manifest.json,
 * the Service Worker can perform this request in the background securely
 * without being restricted by same-origin (CORS) policies.
 */
async function fetchChatGPTSession() {
  const response = await fetch('https://chatgpt.com/api/auth/session', {
    method: 'GET',
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
