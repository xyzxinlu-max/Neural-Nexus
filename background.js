// Service Worker for Chrome Extension (Manifest V3)

// Note: Since manifest.json has "default_popup": "popup.html",
// chrome.action.onClicked won't fire. The popup.js handles the toggle.
// This listener is kept for potential future use if popup is removed.

chrome.action.onClicked.addListener((tab) => {
  // This will only fire if "default_popup" is removed from manifest.json
  // Check if the current tab is a Notion page
  if (tab.url && tab.url.startsWith('https://www.notion.so/')) {
    // Send message to content script to toggle overlay
    chrome.tabs.sendMessage(tab.id, { action: 'toggleOverlay' }).catch(err => {
      console.error('Error sending message:', err);
    });
  } else {
    // If not on a Notion page, show a message
    chrome.action.setBadgeText({
      text: '!',
      tabId: tab.id
    });
    setTimeout(() => {
      chrome.action.setBadgeText({
        text: '',
        tabId: tab.id
      });
    }, 2000);
  }
});

