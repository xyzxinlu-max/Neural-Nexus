// Content script for Notion pages

// Scan state
let isScanning = false;
let isAutoBrowsing = false;
let currentPageUrl = null;
let currentPageTitle = null;
let linkClickListeners = [];

// Auto-browse state
let browseQueue = [];
let visitedUrls = new Set();
let maxBrowseDepth = 3;
let browseInterval = 2000; // 2 seconds between page visits
let browseTimeoutId = null;

// Listen for messages from background script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  if (request.action === 'toggleOverlay') {
    console.log('Toggling overlay...');
    toggleOverlay();
    sendResponse({ success: true });
  } else if (request.action === 'startScan') {
    console.log('Starting scan...');
    startScanning();
    sendResponse({ success: true });
  } else if (request.action === 'stopScan') {
    console.log('Stopping scan...');
    stopScanning();
    sendResponse({ success: true });
  } else if (request.action === 'showGraph') {
    console.log('Showing graph from scan data...');
    showGraphFromScanData();
    sendResponse({ success: true });
  } else if (request.action === 'startAutoBrowse') {
    console.log('Starting auto-browse...');
    startAutoBrowse();
    sendResponse({ success: true });
  } else if (request.action === 'stopAutoBrowse') {
    console.log('Stopping auto-browse...');
    stopAutoBrowse();
    sendResponse({ success: true });
  }
  return true; // Keep the message channel open for async response
});

// Initialize: check if scanning on page load
chrome.storage.local.get(['scanning', 'autoBrowsing'], (result) => {
  if (result.scanning) {
    startScanning();
  }
  if (result.autoBrowsing) {
    startAutoBrowse();
  }
});

// Start scanning mode
function startScanning() {
  if (isScanning) return;
  
  isScanning = true;
  console.log('Scan mode activated');
  
  // Record current page
  recordCurrentPage();
  
  // Auto-scan all links on the page (fast, no clicking needed)
  autoScanAllLinks();
  
  // Scan sidebar for all pages (including database entries)
  scanSidebarPages();
  
  // Scan database views if current page is a database
  scanDatabasePages();
  
  // Listen for link clicks (for navigation tracking)
  setupLinkClickListeners();
  
  // Listen for page navigation (SPA navigation)
  observePageNavigation();
  
  // Set up auto-scan interval to catch dynamically loaded content
  setupAutoScanInterval();
}

// Scan sidebar for all pages
function scanSidebarPages() {
  if (!isScanning) return;
  
  // Try different selectors for sidebar
  const sidebarSelectors = [
    '.notion-sidebar',
    'nav[role="navigation"]',
    'nav',
    '[data-testid="sidebar"]',
    '.notion-sidebar-container'
  ];
  
  let sidebarContainer = null;
  for (const selector of sidebarSelectors) {
    sidebarContainer = document.querySelector(selector);
    if (sidebarContainer) break;
  }
  
  if (!sidebarContainer) {
    console.log('Sidebar not found');
    return;
  }
  
  // Find all links in sidebar
  const sidebarLinks = sidebarContainer.querySelectorAll('a[href]');
  console.log('Found', sidebarLinks.length, 'links in sidebar');
  
  chrome.storage.local.get(['scanData'], (result) => {
    const scanData = result.scanData || { pages: {}, links: [] };
    let newPages = 0;
    
    sidebarLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href || !isInternalNotionLink(href)) return;
      
      const url = normalizeUrl(href);
      const name = (link.innerText || link.textContent || '').trim();
      
      if (name && !scanData.pages[url]) {
        scanData.pages[url] = {
          name: name,
          href: url,
          timestamp: Date.now()
        };
        newPages++;
      }
    });
    
    if (newPages > 0) {
      chrome.storage.local.set({ scanData });
      console.log('Recorded', newPages, 'new pages from sidebar');
    }
  });
}

// Scan database pages (database entries) - automatically add all entries without opening
function scanDatabasePages() {
  if (!isScanning) return;
  
  // Try to find database view
  const databaseSelectors = [
    '.notion-table-view',
    '.notion-board-view',
    '.notion-gallery-view',
    '.notion-list-view',
    '[data-block-id]'
  ];
  
  let databaseContainer = null;
  for (const selector of databaseSelectors) {
    databaseContainer = document.querySelector(selector);
    if (databaseContainer) break;
  }
  
  if (!databaseContainer) {
    return; // Not a database page
  }
  
  // Auto-scroll to load all database entries (for lazy-loaded content)
  autoScrollDatabase(databaseContainer);
  
  // Find all database row links
  const rowLinks = databaseContainer.querySelectorAll('a[href]');
  console.log('Found', rowLinks.length, 'database rows');
  
  chrome.storage.local.get(['scanData'], (result) => {
    const scanData = result.scanData || { pages: {}, links: [] };
    let newPages = 0;
    const currentUrl = normalizeUrl(window.location.href);
    const databasePageName = currentPageTitle || 'Database';
    
    rowLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href || !isInternalNotionLink(href)) return;
      
      const url = normalizeUrl(href);
      
      // Try multiple methods to get the title
      let name = (link.innerText || link.textContent || '').trim();
      
      // If title is empty, try to find it in the link's parent or nearby elements
      if (!name || name === '') {
        // Try to find title in parent row (for database entries)
        const row = link.closest('[role="row"], .notion-table-row, .notion-board-item, .notion-gallery-item, .notion-list-item');
        if (row) {
          const titleElement = row.querySelector('[data-content-editable-root], .notion-page-title, h1, h2, h3, [class*="title"]');
          if (titleElement) {
            name = (titleElement.innerText || titleElement.textContent || '').trim();
          }
        }
        
        // Try aria-label or title attribute
        if (!name) {
          name = link.getAttribute('aria-label') || 
                 link.getAttribute('title') || 
                 'Untitled';
        }
      }
      
      // Clean name: remove English mixed strings
      name = cleanPageName(name);
      
      // Always add/update the page (even if it exists, update the name in case it changed)
      const isNewPage = !scanData.pages[url];
      scanData.pages[url] = {
        name: name,
        href: url,
        timestamp: isNewPage ? Date.now() : scanData.pages[url].timestamp
      };
      
      if (isNewPage) {
        newPages++;
      }
      
      // Create link from database parent page to database entry (adjacency list pattern)
      if (currentUrl && currentUrl !== url) {
        const linkExists = scanData.links.some(
          l => l.source === currentUrl && l.target === url
        );
        if (!linkExists) {
          scanData.links.push({
            source: currentUrl,
            target: url,
            sourceName: databasePageName,
            targetName: name
          });
        }
      }
    });
    
    if (newPages > 0 || rowLinks.length > 0) {
      chrome.storage.local.set({ scanData });
      console.log('Recorded', newPages, 'new database pages, total', rowLinks.length, 'entries');
    }
  });
}

// Auto-scroll database to load all entries (for lazy-loaded content)
function autoScrollDatabase(container) {
  if (!isScanning) return;
  
  let scrollAttempts = 0;
  const maxScrollAttempts = 10;
  let lastScrollHeight = container.scrollHeight;
  
  const scrollInterval = setInterval(() => {
    if (!isScanning || scrollAttempts >= maxScrollAttempts) {
      clearInterval(scrollInterval);
      return;
    }
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
    
    // Wait a bit for content to load
    setTimeout(() => {
      const newScrollHeight = container.scrollHeight;
      
      // If scroll height didn't change, we've reached the end
      if (newScrollHeight === lastScrollHeight) {
        clearInterval(scrollInterval);
        return;
      }
      
      lastScrollHeight = newScrollHeight;
      scrollAttempts++;
    }, 300);
  }, 500);
}

// Auto-scan interval ID
let autoScanIntervalId = null;

// Auto-scan all links on the page (fast scanning without clicking)
function autoScanAllLinks() {
  if (!isScanning) return;
  
  console.log('Auto-scanning all links on page...');
  
  // Find all links on the page
  const allLinks = document.querySelectorAll('a[href]');
  console.log('Found', allLinks.length, 'links to scan');
  
  chrome.storage.local.get(['scanData'], (result) => {
    const scanData = result.scanData || { pages: {}, links: [] };
    let newPages = 0;
    let newLinks = 0;
    const currentUrl = normalizeUrl(window.location.href);
    const currentPageName = currentPageTitle || getPageTitle();
    
    allLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href || !isInternalNotionLink(href)) return;
      
      const targetUrl = normalizeUrl(href);
      if (targetUrl === currentUrl) return; // Skip self-references
      
      // Try multiple methods to get the title
      let targetTitle = link.innerText || link.textContent || '';
      
      // If title is empty, try to find it in the link's parent or nearby elements
      if (!targetTitle || targetTitle.trim() === '') {
        // Try to find title in parent row (for database entries)
        const row = link.closest('[role="row"], .notion-table-row, .notion-board-item, .notion-gallery-item, .notion-list-item');
        if (row) {
          const titleElement = row.querySelector('[data-content-editable-root], .notion-page-title, h1, h2, h3, [class*="title"]');
          if (titleElement) {
            targetTitle = titleElement.innerText || titleElement.textContent || '';
          }
        }
        
        // Try aria-label or title attribute
        if (!targetTitle) {
          targetTitle = link.getAttribute('aria-label') || 
                       link.getAttribute('title') || 
                       'Untitled';
        }
      }
      
      // Clean the title
      targetTitle = cleanPageName(targetTitle.trim() || 'Untitled');
      
      // Record the page
      const isNewPage = !scanData.pages[targetUrl];
      if (isNewPage) {
        scanData.pages[targetUrl] = {
          name: targetTitle,
          href: targetUrl,
          timestamp: Date.now()
        };
        newPages++;
      } else {
        // Update name if it changed
        if (scanData.pages[targetUrl].name !== targetTitle) {
          scanData.pages[targetUrl].name = targetTitle;
          scanData.pages[targetUrl].updatedAt = Date.now();
        }
      }
      
      // Record the link
      const linkExists = scanData.links.some(
        l => l.source === currentUrl && l.target === targetUrl
      );
      
      if (!linkExists && currentUrl && currentUrl !== targetUrl) {
        scanData.links.push({
          source: currentUrl,
          target: targetUrl,
          sourceName: currentPageName,
          targetName: targetTitle
        });
        newLinks++;
      }
    });
    
    if (newPages > 0 || newLinks > 0) {
      chrome.storage.local.set({ scanData });
      console.log('Auto-scan complete: Added', newPages, 'new pages and', newLinks, 'new links');
    }
  });
}

// Setup auto-scan interval to catch dynamically loaded content
function setupAutoScanInterval() {
  // Clear existing interval
  if (autoScanIntervalId) {
    clearInterval(autoScanIntervalId);
  }
  
  // Auto-scan every 2 seconds to catch dynamically loaded content
  autoScanIntervalId = setInterval(() => {
    if (isScanning) {
      autoScanAllLinks();
      scanDatabasePages(); // Also re-scan database in case new entries loaded
    } else {
      clearInterval(autoScanIntervalId);
      autoScanIntervalId = null;
    }
  }, 2000);
}

// Stop scanning mode
function stopScanning() {
  if (!isScanning) return;
  
  isScanning = false;
  console.log('Scan mode deactivated');
  
  // Remove link click listeners
  removeLinkClickListeners();
  
  // Clear auto-scan interval
  if (autoScanIntervalId) {
    clearInterval(autoScanIntervalId);
    autoScanIntervalId = null;
  }
}

// Record current page with retry for title
function recordCurrentPage() {
  const url = normalizeUrl(window.location.href);
  
  // Get title with retry mechanism
  let title = getPageTitle();
  
  // If title is still default, try again after a delay
  if (title === 'Untitled Page' || title === 'Notion' || !title) {
    setTimeout(() => {
      const retryTitle = getPageTitle();
      if (retryTitle && retryTitle !== 'Untitled Page' && retryTitle !== 'Notion') {
        updatePageTitle(url, retryTitle);
      }
    }, 1000);
  }
  
  // Check if we came from another page (stored in sessionStorage)
  const fromPageData = sessionStorage.getItem('notionScanFromPage');
  let fromUrl = null;
  let fromTitle = null;
  
  if (fromPageData) {
    try {
      const fromPage = JSON.parse(fromPageData);
      fromUrl = fromPage.url;
      fromTitle = fromPage.title;
      // Clear it after use
      sessionStorage.removeItem('notionScanFromPage');
    } catch (e) {
      console.error('Error parsing fromPageData:', e);
    }
  }
  
  currentPageUrl = url;
  currentPageTitle = title;
  
  console.log('Recording page:', title, url);
  
  // Save to storage
  chrome.storage.local.get(['scanData'], (result) => {
    const scanData = result.scanData || { pages: {}, links: [] };
    
    const isNewPage = !scanData.pages[url];
    const existingPage = scanData.pages[url];
    
    // Update page (even if exists, update name in case it changed)
    const pageData = {
      name: title,
      href: url,
      timestamp: existingPage ? existingPage.timestamp : Date.now(), // Keep original timestamp
      updatedAt: Date.now() // Track when name was last updated
    };
    
    // If name changed, log it
    if (existingPage && existingPage.name !== title) {
      console.log('Page name updated:', existingPage.name, '->', title);
    }
    
    scanData.pages[url] = pageData;
    
    // If we came from another page, create a link
    if (fromUrl && fromUrl !== url && isScanning) {
      // Ensure the source page is also recorded
      if (!scanData.pages[fromUrl]) {
        scanData.pages[fromUrl] = {
          name: fromTitle || 'Previous Page',
          href: fromUrl,
          timestamp: Date.now()
        };
      }
      
      // Add link if it doesn't exist
      const linkExists = scanData.links.some(
        link => link.source === fromUrl && link.target === url
      );
      
      if (!linkExists) {
        scanData.links.push({
          source: fromUrl,
          target: url,
          sourceName: fromTitle || 'Previous Page',
          targetName: title
        });
        console.log('Link created from navigation:', fromTitle, '->', title);
      }
    }
    
    chrome.storage.local.set({ scanData }, () => {
      console.log('Page recorded:', scanData.pages[url]);
      if (fromUrl) {
        console.log('Link from', fromTitle, 'to', title, 'recorded');
      }
    });
  });
}

// Update page title (for retry)
function updatePageTitle(url, newTitle) {
  chrome.storage.local.get(['scanData'], (result) => {
    const scanData = result.scanData || { pages: {}, links: [] };
    
    if (scanData.pages[url]) {
      const oldTitle = scanData.pages[url].name;
      scanData.pages[url].name = newTitle;
      scanData.pages[url].updatedAt = Date.now();
      
      // Update links that reference this page
      scanData.links.forEach(link => {
        if (link.target === url && link.targetName === oldTitle) {
          link.targetName = newTitle;
        }
        if (link.source === url && link.sourceName === oldTitle) {
          link.sourceName = newTitle;
        }
      });
      
      chrome.storage.local.set({ scanData });
      console.log('Page title updated (retry):', oldTitle, '->', newTitle);
    }
  });
}

// Setup link click listeners and hover listeners
function setupLinkClickListeners() {
  // Remove existing listeners first
  removeLinkClickListeners();
  
  // Store the previous page URL before navigation
  let previousPageUrl = currentPageUrl;
  let previousPageTitle = currentPageTitle;
  
  // Track hovered links to avoid duplicate processing
  const hoveredLinks = new Set();
  
  // Listen for hover on links (for database entries - add node without clicking)
  const handleLinkHover = (event) => {
    if (!isScanning) return;
    
    const link = event.target.closest('a[href]');
    if (!link) return;
    
    const href = link.getAttribute('href');
    if (!href || !isInternalNotionLink(href)) return;
    
    const targetUrl = normalizeUrl(href);
    
    // Skip if already processed
    if (hoveredLinks.has(targetUrl)) return;
    
    // Try multiple methods to get the title
    let targetTitle = link.innerText || link.textContent || '';
    
    // If title is empty, try to find it in the link's parent or nearby elements
    if (!targetTitle || targetTitle.trim() === '') {
      // Try to find title in parent row (for database entries)
      const row = link.closest('[role="row"], .notion-table-row, .notion-board-item, .notion-gallery-item, .notion-list-item');
      if (row) {
        const titleElement = row.querySelector('[data-content-editable-root], .notion-page-title, h1, h2, h3, [class*="title"]');
        if (titleElement) {
          targetTitle = titleElement.innerText || titleElement.textContent || '';
        }
      }
      
      // Try to find title in the link's text content or aria-label
      if (!targetTitle) {
        targetTitle = link.getAttribute('aria-label') || 
                     link.getAttribute('title') || 
                     link.textContent || 
                     'Untitled';
      }
    }
    
    // Clean the title: remove English mixed strings
    targetTitle = cleanPageName(targetTitle.trim() || 'Untitled');
    
    // Record the page and link immediately on hover
    recordPageOnHover(targetUrl, targetTitle);
    recordLink(currentPageUrl, currentPageTitle, targetUrl, targetTitle);
    
    // Mark as processed
    hoveredLinks.add(targetUrl);
    
    console.log('Link hovered (node added):', currentPageTitle, '->', targetTitle, '(', targetUrl, ')');
  };
  
  // Listen for clicks on all links (for navigation tracking)
  const handleLinkClick = (event) => {
    if (!isScanning) return;
    
    const link = event.target.closest('a[href]');
    if (!link) return;
    
    const href = link.getAttribute('href');
    if (!href || !isInternalNotionLink(href)) return;
    
    const targetUrl = normalizeUrl(href);
    
    // Store previous page info before navigation
    previousPageUrl = currentPageUrl;
    previousPageTitle = currentPageTitle;
    
    // Store in sessionStorage for when the new page loads
    sessionStorage.setItem('notionScanFromPage', JSON.stringify({
      url: currentPageUrl,
      title: currentPageTitle
    }));
    
    console.log('Link clicked (navigating):', currentPageTitle, '->', targetUrl);
  };
  
  // Add hover listeners (mouseenter)
  document.addEventListener('mouseenter', handleLinkHover, true);
  linkClickListeners.push({ type: 'mouseenter', handler: handleLinkHover });
  
  // Add click listeners (for navigation tracking)
  document.addEventListener('click', handleLinkClick, true);
  linkClickListeners.push({ type: 'click', handler: handleLinkClick });
}

// Remove link click listeners
function removeLinkClickListeners() {
  linkClickListeners.forEach(({ type, handler }) => {
    document.removeEventListener(type, handler, true);
  });
  linkClickListeners = [];
}

// Record a link between pages
function recordLink(fromUrl, fromTitle, toUrl, toTitle) {
  if (!fromUrl || !toUrl || fromUrl === toUrl) return;
  
  // Clean titles
  fromTitle = cleanPageName(fromTitle);
  toTitle = cleanPageName(toTitle);
  
  chrome.storage.local.get(['scanData'], (result) => {
    const scanData = result.scanData || { pages: {}, links: [] };
    
    // Ensure both pages are recorded (and update names if changed)
    if (!scanData.pages[fromUrl]) {
      scanData.pages[fromUrl] = {
        name: fromTitle,
        href: fromUrl,
        timestamp: Date.now()
      };
    } else {
      // Update name if it changed
      if (scanData.pages[fromUrl].name !== fromTitle) {
        scanData.pages[fromUrl].name = fromTitle;
        scanData.pages[fromUrl].updatedAt = Date.now();
        console.log('Updated page name:', fromUrl, '->', fromTitle);
      }
    }
    
    if (!scanData.pages[toUrl]) {
      scanData.pages[toUrl] = {
        name: toTitle,
        href: toUrl,
        timestamp: Date.now()
      };
    } else {
      // Update name if it changed
      if (scanData.pages[toUrl].name !== toTitle) {
        scanData.pages[toUrl].name = toTitle;
        scanData.pages[toUrl].updatedAt = Date.now();
        console.log('Updated page name:', toUrl, '->', toTitle);
      }
    }
    
    // Add link if it doesn't exist
    const linkExists = scanData.links.some(
      link => link.source === fromUrl && link.target === toUrl
    );
    
    if (!linkExists) {
      scanData.links.push({
        source: fromUrl,
        target: toUrl,
        sourceName: fromTitle,
        targetName: toTitle
      });
      console.log('Link recorded:', fromTitle, '->', toTitle);
    } else {
      // Update link names if they changed
      const link = scanData.links.find(l => l.source === fromUrl && l.target === toUrl);
      if (link) {
        link.sourceName = fromTitle;
        link.targetName = toTitle;
      }
    }
    
    chrome.storage.local.set({ scanData });
  });
}

// Observe page navigation (for SPA)
function observePageNavigation() {
  // Use MutationObserver to detect page changes
  let lastUrl = window.location.href;
  let lastTitle = document.title;
  
  const observer = new MutationObserver(() => {
    if (!isScanning) return;
    
    const currentUrl = window.location.href;
    const currentTitle = document.title;
    
    // Check if URL or title changed
    if (currentUrl !== lastUrl || currentTitle !== lastTitle) {
      // Store previous page info before recording new page
      if (lastUrl && lastUrl !== currentUrl) {
        sessionStorage.setItem('notionScanFromPage', JSON.stringify({
          url: normalizeUrl(lastUrl),
          title: lastTitle.replace(' | Notion', '').replace(' - Notion', '').trim()
        }));
      }
      
      lastUrl = currentUrl;
      lastTitle = currentTitle;
      
      // Longer delay to let page fully load (especially for title)
      setTimeout(() => {
        recordCurrentPage();
        // Also scan database if this is a database page
        scanDatabasePages();
        
        // Retry title after another delay (for slow-loading pages)
        setTimeout(() => {
          const url = normalizeUrl(window.location.href);
          const retryTitle = getPageTitle();
          if (retryTitle && retryTitle !== 'Untitled Page' && retryTitle !== 'Notion') {
            updatePageTitle(url, retryTitle);
          }
        }, 2000);
      }, 1500);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Also listen to popstate for browser navigation
  window.addEventListener('popstate', () => {
    if (isScanning) {
      setTimeout(() => {
        recordCurrentPage();
        scanDatabasePages();
        
        // Retry title
        setTimeout(() => {
          const url = normalizeUrl(window.location.href);
          const retryTitle = getPageTitle();
          if (retryTitle && retryTitle !== 'Untitled Page' && retryTitle !== 'Notion') {
            updatePageTitle(url, retryTitle);
          }
        }, 2000);
      }, 1500);
    }
  });
  
  // Listen to pushstate/replacestate (SPA navigation)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    if (isScanning && currentPageUrl) {
      sessionStorage.setItem('notionScanFromPage', JSON.stringify({
        url: currentPageUrl,
        title: currentPageTitle
      }));
    }
    originalPushState.apply(history, args);
  };
  
  history.replaceState = function(...args) {
    if (isScanning && currentPageUrl) {
      sessionStorage.setItem('notionScanFromPage', JSON.stringify({
        url: currentPageUrl,
        title: currentPageTitle
      }));
    }
    originalReplaceState.apply(history, args);
  };
}

// Get page title with multiple attempts and delays
function getPageTitle() {
  let title = '';
  
  // Method 1: Try document.title first
  if (document.title) {
    title = document.title.replace(' | Notion', '').replace(' - Notion', '').trim();
  }
  
  // Method 2: Try h1 in main content
  if (!title || title === 'Notion' || title === '') {
    const mainContent = document.querySelector('.notion-page-content, main, [role="main"], .notion-page-view, article');
    if (mainContent) {
      const h1 = mainContent.querySelector('h1');
      if (h1) {
        title = (h1.innerText || h1.textContent || '').trim();
      }
    }
  }
  
  // Method 3: Try any h1 on page
  if (!title || title === 'Notion' || title === '') {
    const h1 = document.querySelector('h1');
    if (h1) {
      title = (h1.innerText || h1.textContent || '').trim();
    }
  }
  
  // Method 4: Try page title element
  if (!title || title === 'Notion' || title === '') {
    const titleElement = document.querySelector('.notion-page-title, [data-content-editable-root], [class*="title"]');
    if (titleElement) {
      title = (titleElement.innerText || titleElement.textContent || '').trim();
    }
  }
  
  // Method 5: Try meta title
  if (!title || title === 'Notion' || title === '') {
    const metaTitle = document.querySelector('meta[property="og:title"]');
    if (metaTitle) {
      title = metaTitle.getAttribute('content') || '';
    }
  }
  
  // Fallback
  if (!title || title === 'Notion' || title === '') {
    title = 'Untitled Page';
  }
  
  // Clean the title: remove English mixed strings
  title = cleanPageName(title);
  
  return title;
}

// Get page title with retry (for pages that load slowly)
function getPageTitleWithRetry(maxRetries = 3, delay = 500) {
  let title = getPageTitle();
  
  if (title && title !== 'Untitled Page' && title !== 'Notion') {
    return title;
  }
  
  // Retry if title is empty or default
  let retries = 0;
  const tryGetTitle = () => {
    if (retries >= maxRetries) {
      return title || 'Untitled Page';
    }
    
    setTimeout(() => {
      title = getPageTitle();
      retries++;
      
      if (title && title !== 'Untitled Page' && title !== 'Notion') {
        return title;
      }
      
      if (retries < maxRetries) {
        tryGetTitle();
      }
    }, delay);
    
    return title || 'Untitled Page';
  };
  
  return tryGetTitle();
}

// Clean page name: remove English mixed strings, keep only Chinese/Japanese/Korean and basic punctuation
function cleanPageName(name) {
  if (!name) return name;
  
  // Remove common English patterns that appear after Chinese text
  // Pattern: Chinese text followed by English letters/numbers (like "Notes Database", "Page 1", etc.)
  // Keep only the meaningful part (usually the Chinese part)
  
  // Split by common separators and take the first meaningful part
  const parts = name.split(/[|·•\-_]/);
  let cleaned = parts[0] || name;
  
  // Remove trailing English words/numbers that are likely metadata
  // Pattern: Chinese text + space + English (like "笔记 Notes Database")
  cleaned = cleaned.replace(/\s+[A-Za-z0-9\s]+$/, '');
  
  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // If the cleaned name is empty or too short, keep original
  if (!cleaned || cleaned.length < 1) {
    return name.trim();
  }
  
  return cleaned;
}

// Normalize URL
function normalizeUrl(url) {
  if (!url) return '';
  
  // Handle relative URLs
  if (url.startsWith('/')) {
    url = window.location.origin + url;
  }
  
  // Remove query params and fragments
  try {
    const urlObj = new URL(url);
    return urlObj.origin + urlObj.pathname;
  } catch (e) {
    return url.split('?')[0].split('#')[0];
  }
}

// Check if link is internal Notion link
function isInternalNotionLink(href) {
  if (!href) return false;
  return href.startsWith('/') || href.includes('notion.so');
}

// Generate graph data from scan data
function generateGraphFromScanData(scanData) {
  const nodes = [];
  const links = [];
  const nodeMap = new Map();
  
  // Convert pages to nodes
  Object.values(scanData.pages || {}).forEach(page => {
    const node = {
      id: page.href,
      name: page.name,
      href: page.href,
      isRoot: false // Can be enhanced later
    };
    nodes.push(node);
    nodeMap.set(page.href, node);
  });
  
  // Convert links to edges
  (scanData.links || []).forEach(link => {
    if (nodeMap.has(link.source) && nodeMap.has(link.target)) {
      links.push({
        source: link.source,
        target: link.target,
        sourceName: link.sourceName,
        targetName: link.targetName
      });
    }
  });
  
  return { nodes, links };
}

// Show graph from scan data
function showGraphFromScanData() {
  chrome.storage.local.get(['scanData'], (result) => {
    const scanData = result.scanData;
    
    if (!scanData || Object.keys(scanData.pages || {}).length === 0) {
      console.error('No scan data available');
      return;
    }
    
    const graphData = generateGraphFromScanData(scanData);
    console.log('Generated graph data:', graphData);
    
    // Show overlay and render graph
  let overlay = document.getElementById('notion-overlay-extension');
  
    if (!overlay) {
      createOverlay();
      overlay = document.getElementById('notion-overlay-extension');
    }
    
    overlay.style.display = 'flex';
    
    // Wait for iframe to be ready
    const iframe = document.querySelector('#nexus-graph-frame');
    if (iframe) {
      iframe.onload = () => {
        sendGraphDataToIframe(graphData);
      };
      // If already loaded, send immediately
      if (iframe.contentWindow) {
        setTimeout(() => {
          sendGraphDataToIframe(graphData);
        }, 300);
      }
    }
  });
}

// Create overlay (extracted from toggleOverlay)
function createOverlay() {
  const overlay = document.createElement('div');
    overlay.id = 'notion-overlay-extension';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
    background-color: rgba(0, 0, 0, 0.95);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
  `;
  
  const iframe = document.createElement('iframe');
  iframe.id = 'nexus-graph-frame';
  iframe.src = chrome.runtime.getURL('graph.html');
  iframe.style.cssText = `
    width: 100%;
    height: 100%;
      border: none;
    background: transparent;
  `;
  
  window.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'CLOSE_OVERLAY') {
      overlay.style.display = 'none';
    } else if (event.data && event.data.action === 'NAVIGATE') {
      if (event.data.url) {
        window.location.href = event.data.url;
      }
    }
  });
  
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
}

// Function to create or toggle the overlay (legacy function, now uses scan data)
function toggleOverlay() {
  console.log('toggleOverlay called');
  showGraphFromScanData();
}

// ==================== Auto-Browse Functions ====================

// Start auto-browsing
function startAutoBrowse() {
  if (isAutoBrowsing) return;
  
  isAutoBrowsing = true;
  console.log('Auto-browse started');
  
  // Ensure scanning is enabled
  if (!isScanning) {
    startScanning();
  }
  
  // Reset state
  browseQueue = [];
  visitedUrls = new Set();
  setCurrentBrowseDepth(0);
  
  // Mark current page as visited to prevent immediate loop
  const currentUrl = normalizeUrl(window.location.href);
  visitedUrls.add(currentUrl);
  
  // Start from sidebar (skip first 4, start from 5th)
  collectSidebarPages();
  
  // Start browsing process after a short delay
  setTimeout(() => {
    if (isAutoBrowsing && browseQueue.length > 0) {
      console.log('Starting browse queue processing with', browseQueue.length, 'pages');
      processBrowseQueue();
    } else if (isAutoBrowsing) {
      console.log('Browse queue is empty, retrying collection...');
      // Retry collecting sidebar pages
      setTimeout(() => {
        collectSidebarPages();
        if (browseQueue.length > 0) {
          processBrowseQueue();
        } else {
          console.error('Failed to collect sidebar pages for auto-browse');
        }
      }, 2000);
    }
  }, 2000);
}

// Stop auto-browsing
function stopAutoBrowse() {
  if (!isAutoBrowsing) return;
  
  isAutoBrowsing = false;
  console.log('Auto-browse stopped');
  
  if (browseTimeoutId) {
    clearTimeout(browseTimeoutId);
    browseTimeoutId = null;
  }
  
  browseQueue = [];
  visitedUrls.clear();
  
  // Update progress
  chrome.storage.local.set({ 
    autoBrowseProgress: null 
  });
}

// Collect sidebar pages to start browsing (skip first 4, start from 5th)
function collectSidebarPages() {
  const sidebarSelectors = [
    '.notion-sidebar',
    'nav[role="navigation"]',
    'nav',
    '[data-testid="sidebar"]',
    '.notion-sidebar-container'
  ];
  
  let sidebarContainer = null;
  for (const selector of sidebarSelectors) {
    sidebarContainer = document.querySelector(selector);
    if (sidebarContainer) break;
  }
  
  if (!sidebarContainer) {
    console.log('Sidebar not found, starting from current page');
    // Start from current page
    const currentUrl = normalizeUrl(window.location.href);
    if (!visitedUrls.has(currentUrl)) {
      browseQueue.push({
        url: currentUrl,
        depth: 0,
        title: getPageTitle()
      });
      visitedUrls.add(currentUrl);
    }
    return;
  }
  
  // Find all sidebar links
  const sidebarLinks = Array.from(sidebarContainer.querySelectorAll('a[href]'));
  console.log('Found', sidebarLinks.length, 'sidebar links');
  
  // Skip first 4 links (主页, 会议, Notion AI, 收件箱), start from 5th (index 4)
  const startIndex = 4;
  const linksToProcess = sidebarLinks.slice(startIndex);
  
  console.log('Skipping first', startIndex, 'links, processing', linksToProcess.length, 'links');
  
  linksToProcess.forEach(link => {
    const href = link.getAttribute('href');
    if (!href || !isInternalNotionLink(href)) return;
    
    const url = normalizeUrl(href);
    if (visitedUrls.has(url)) {
      console.log('Skipping already visited:', url);
      return;
    }
    
    const title = (link.innerText || link.textContent || '').trim() || 'Untitled';
    
    browseQueue.push({
      url: url,
      depth: 0,
      title: cleanPageName(title)
    });
    visitedUrls.add(url);
    console.log('Added to queue:', cleanPageName(title), url);
  });
  
  console.log('Added', browseQueue.length, 'pages to browse queue');
  
  // Update progress
  chrome.storage.local.set({ 
    autoBrowseProgress: {
      current: 0,
      total: browseQueue.length
    }
  });
}

// Process browse queue
function processBrowseQueue() {
  if (!isAutoBrowsing) return;
  
  if (browseQueue.length === 0) {
    console.log('Browse queue empty, collecting more pages...');
    // Try to collect more pages from current page
    const currentDepth = getCurrentBrowseDepth();
    collectLinksFromCurrentPage(currentDepth);
    
    if (browseQueue.length === 0) {
      console.log('No more pages to browse');
      stopAutoBrowse();
      return;
    }
  }
  
  const nextPage = browseQueue.shift();
  
  // Double-check if already visited (prevent loops)
  if (visitedUrls.has(nextPage.url)) {
    console.log('Page already visited, skipping:', nextPage.url);
    processBrowseQueue();
    return;
  }
  
  if (nextPage.depth > maxBrowseDepth) {
    console.log('Max depth reached, skipping:', nextPage.url);
    processBrowseQueue();
    return;
  }
  
  const currentUrl = normalizeUrl(window.location.href);
  
  // If we're already on this page, skip navigation
  if (nextPage.url === currentUrl) {
    console.log('Already on this page, collecting links and continuing:', nextPage.title);
    recordCurrentPage();
    collectLinksFromCurrentPage(nextPage.depth + 1);
    
    browseTimeoutId = setTimeout(() => {
      processBrowseQueue();
    }, browseInterval);
    return;
  }
  
  console.log(`Browsing page (depth ${nextPage.depth}):`, nextPage.title, nextPage.url);
  
  // Mark as visited before navigation to prevent loops
  visitedUrls.add(nextPage.url);
  
  // Update progress
  const totalVisited = visitedUrls.size;
  chrome.storage.local.set({ 
    autoBrowseProgress: {
      current: totalVisited,
      total: totalVisited + browseQueue.length
    }
  });
  
  // Navigate to the page
  window.location.href = nextPage.url;
  
  // Wait for page to load, then continue
  browseTimeoutId = setTimeout(() => {
    if (!isAutoBrowsing) {
      console.log('Auto-browse stopped during page load');
      return;
    }
    
    console.log('Page loaded, recording and collecting links...');
    
    // Record current page
    recordCurrentPage();
    
    // Wait a bit more for page content to fully load
    setTimeout(() => {
      if (!isAutoBrowsing) return;
      
      // Collect links from this page for next level
      if (nextPage.depth < maxBrowseDepth) {
        collectLinksFromCurrentPage(nextPage.depth + 1);
      }
      
      // Continue browsing
      browseTimeoutId = setTimeout(() => {
        if (isAutoBrowsing) {
          console.log('Continuing browse queue, remaining:', browseQueue.length);
          processBrowseQueue();
        }
      }, browseInterval);
    }, 2000);
  }, 4000); // Wait 4 seconds for page to load
}

// Track current browse depth
let currentBrowseDepth = 0;

function getCurrentBrowseDepth() {
  return currentBrowseDepth;
}

function setCurrentBrowseDepth(depth) {
  currentBrowseDepth = depth;
}

// Collect links from current page
function collectLinksFromCurrentPage(depth = 0) {
  if (!isAutoBrowsing) return;
  
  setCurrentBrowseDepth(depth);
  
  const allLinks = document.querySelectorAll('a[href]');
  let newPages = 0;
  const currentUrl = normalizeUrl(window.location.href);
  
  allLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (!href || !isInternalNotionLink(href)) return;
    
    const url = normalizeUrl(href);
    
    // Skip if already visited or is current page
    if (visitedUrls.has(url) || url === currentUrl) {
      return;
    }
    
    let title = (link.innerText || link.textContent || '').trim();
    
    // Try to get title from parent row (for database entries)
    if (!title) {
      const row = link.closest('[role="row"], .notion-table-row, .notion-board-item, .notion-gallery-item, .notion-list-item');
      if (row) {
        const titleElement = row.querySelector('[data-content-editable-root], .notion-page-title, h1, h2, h3, [class*="title"]');
        if (titleElement) {
          title = (titleElement.innerText || titleElement.textContent || '').trim();
        }
      }
    }
    
    if (!title) {
      title = link.getAttribute('aria-label') || link.getAttribute('title') || 'Untitled';
    }
    
    title = cleanPageName(title);
    
    // Check if already in queue to prevent duplicates
    const alreadyInQueue = browseQueue.some(page => page.url === url);
    if (alreadyInQueue) {
      return;
    }
    
    browseQueue.push({
      url: url,
      depth: depth,
      title: title
    });
    visitedUrls.add(url);
    newPages++;
  });
  
  if (newPages > 0) {
    console.log('Collected', newPages, 'new pages from current page (depth', depth, ')');
  }
  
  // Update progress
  const totalVisited = visitedUrls.size;
  chrome.storage.local.set({ 
    autoBrowseProgress: {
      current: totalVisited,
      total: totalVisited + browseQueue.length
    }
  });
}

// Helper function to send graph data to iframe
function sendGraphDataToIframe(graphData) {
  const iframe = document.querySelector('#nexus-graph-frame');
  if (iframe && iframe.contentWindow) {
    console.log('Sending graph data to iframe:', graphData);
    // Wait a bit for iframe to be ready, and retry if needed
    let retries = 0;
    const maxRetries = 10;
    
    const sendMessage = () => {
      try {
        iframe.contentWindow.postMessage({
          action: 'RENDER_GRAPH',
          data: graphData
        }, '*');
        console.log('Message sent to iframe successfully');
      } catch (error) {
        console.error('Error sending message to iframe:', error);
        if (retries < maxRetries) {
          retries++;
          setTimeout(sendMessage, 200);
        }
      }
    };
    
    // Initial delay to ensure iframe is ready
    setTimeout(sendMessage, 300);
  } else {
    console.error('Iframe or contentWindow not found');
  }
}

// Make toggleOverlay available globally for background script injection
window.toggleNotionOverlay = toggleOverlay;

/**
 * Scans the current Notion view to extract graph data from Sidebar and Main Content
 * @returns {Object} Graph data with nodes and links: { nodes: [], links: [] }
 */
function scanCurrentView() {
  const graphData = {
    nodes: [],
    links: []
  };
  
  // Map to track nodes by href for deduplication
  const nodeMap = new Map();
  
  // Helper function to check if a link should be ignored
  function shouldIgnoreLink(href, text) {
    if (!href) return true;
    
    const lowerText = (text || '').toLowerCase();
    const ignoreKeywords = ['settings', 'trash', 'help', 'support', 'upgrade'];
    
    // Check if it's a generic functional link
    return ignoreKeywords.some(keyword => lowerText.includes(keyword));
  }
  
  // Helper function to check if a link is an internal Notion link
  function isInternalLink(href) {
    if (!href) return false;
    return href.startsWith('/') || href.includes('notion.so');
  }
  
  // Helper function to add or update a node
  function addNode(name, href, isRoot = false) {
    if (!href || !name) return null;
    
    // Normalize href (remove query params and fragments for consistency)
    const normalizedHref = href.split('?')[0].split('#')[0];
    
    if (nodeMap.has(normalizedHref)) {
      // Update existing node if it's marked as root
      const existingNode = nodeMap.get(normalizedHref);
      if (isRoot && !existingNode.isRoot) {
        existingNode.isRoot = true;
      }
      return existingNode;
    }
    
    const node = {
      id: normalizedHref,
      name: name.trim(),
      href: normalizedHref,
      isRoot: isRoot
    };
    
    nodeMap.set(normalizedHref, node);
    graphData.nodes.push(node);
    return node;
  }
  
  // Zone 1: Sidebar Scanning (Global Roots)
  let sidebarContainer = null;
  
  // Try different selectors for sidebar
  const sidebarSelectors = [
    '.notion-sidebar',
    'nav[role="navigation"]',
    'nav',
    '[data-testid="sidebar"]',
    '.notion-sidebar-container'
  ];
  
  for (const selector of sidebarSelectors) {
    sidebarContainer = document.querySelector(selector);
    if (sidebarContainer) break;
  }
  
  let sidebarNodeCount = 0;
  if (sidebarContainer) {
    const sidebarLinks = sidebarContainer.querySelectorAll('a[href]');
    
    sidebarLinks.forEach(link => {
      const href = link.getAttribute('href');
      const name = link.innerText || link.textContent || '';
      
      if (isInternalLink(href) && !shouldIgnoreLink(href, name)) {
        addNode(name, href, true); // Mark as root node
        sidebarNodeCount++;
      }
    });
  }
  
  console.log("Sidebar Nodes Found:", sidebarNodeCount);
  
  // Zone 2: Main Content Scanning (Context)
  let mainContentContainer = null;
  
  // Try different selectors for main content
  const mainContentSelectors = [
    '.notion-page-content',
    'main',
    '[role="main"]',
    '.notion-page-view',
    'article'
  ];
  
  for (const selector of mainContentSelectors) {
    mainContentContainer = document.querySelector(selector);
    if (mainContentContainer) break;
  }
  
  // Get current page title
  let currentPageTitle = '';
  
  // Try to get from document.title first
  if (document.title) {
    currentPageTitle = document.title.replace(' | Notion', '').replace(' - Notion', '').trim();
  }
  
  // If not found or empty, try to get from top h1
  if (!currentPageTitle && mainContentContainer) {
    const h1 = mainContentContainer.querySelector('h1');
    if (h1) {
      currentPageTitle = (h1.innerText || h1.textContent || '').trim();
    }
  }
  
  // Fallback to a default if still not found
  if (!currentPageTitle) {
    currentPageTitle = 'Current Page';
  }
  
  // Ensure current page is in the nodes list
  const currentPageHref = window.location.pathname;
  const currentPageNode = addNode(currentPageTitle, currentPageHref, false);
  
  let pageContentNodeCount = 0;
  if (mainContentContainer) {
    const contentLinks = mainContentContainer.querySelectorAll('a[href]');
    
    contentLinks.forEach(link => {
      const href = link.getAttribute('href');
      const name = link.innerText || link.textContent || '';
      
      if (isInternalLink(href) && !shouldIgnoreLink(href, name)) {
        const targetNode = addNode(name, href, false);
        
        if (targetNode && currentPageNode && targetNode.id !== currentPageNode.id) {
          // Create a link (edge) from current page to found link
          const linkExists = graphData.links.some(
            l => l.source === currentPageNode.id && l.target === targetNode.id
          );
          
          if (!linkExists) {
            graphData.links.push({
              source: currentPageNode.id,
              target: targetNode.id,
              sourceName: currentPageTitle,
              targetName: targetNode.name
            });
            pageContentNodeCount++;
          }
        }
      }
    });
  }
  
  console.log("Page Content Nodes Found:", pageContentNodeCount);
  console.log("Final Graph Data:", graphData);
  
  return graphData;
}

// Make scanCurrentView available globally in content script context
window.scanCurrentView = scanCurrentView;

// Note: Inline script injection removed due to CSP restrictions
// Users can still access scanCurrentView via the extension popup

