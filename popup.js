// Popup script for the extension popup

document.addEventListener('DOMContentLoaded', async () => {
  const toggleButton = document.getElementById('toggleOverlay');
  const scanToggle = document.getElementById('scanToggle');
  const statusDiv = document.getElementById('status');
  const scanStatus = document.getElementById('scanStatus');
  const scanCount = document.getElementById('scanCount');
  const pageCount = document.getElementById('pageCount');
  const linkCount = document.getElementById('linkCount');
  const autoBrowseToggle = document.getElementById('autoBrowseToggle');
  const autoBrowseStatus = document.getElementById('autoBrowseStatus');
  const autoBrowseProgress = document.getElementById('autoBrowseProgress');
  const currentPage = document.getElementById('currentPage');
  const totalPages = document.getElementById('totalPages');

  // Load scan state
  const scanState = await chrome.storage.local.get(['scanning', 'scanData']);
  if (scanState.scanning) {
    scanToggle.checked = true;
    updateScanStatus(true);
  }
  updateCounts(scanState.scanData);

  // Scan toggle handler
  scanToggle.addEventListener('change', async (e) => {
    const isScanning = e.target.checked;
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url || !tab.url.startsWith('https://www.notion.so/')) {
        scanToggle.checked = !isScanning;
        showStatus('请在 Notion 页面中操作', 'error');
        return;
      }

      // Send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: isScanning ? 'startScan' : 'stopScan' 
      }).catch(async (error) => {
        // If content script is not ready, inject it
        if (error.message && error.message.includes('Could not establish connection')) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          return await chrome.tabs.sendMessage(tab.id, { 
            action: isScanning ? 'startScan' : 'stopScan' 
          });
        }
        throw error;
      });

      if (response && response.success) {
        // Save scan state
        await chrome.storage.local.set({ scanning: isScanning });
        
        if (isScanning) {
          // Clear previous scan data when starting new scan
          await chrome.storage.local.set({ scanData: { pages: {}, links: [] } });
          updateCounts({ pages: {}, links: [] });
        }
        
        updateScanStatus(isScanning);
        showStatus(isScanning ? '扫描已开启' : '扫描已关闭，数据已保存', 'success');
      }
    } catch (error) {
      console.error('Error:', error);
      scanToggle.checked = !isScanning;
      showStatus('错误: ' + error.message, 'error');
    }
  });

  // View graph button
  toggleButton.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url || !tab.url.startsWith('https://www.notion.so/')) {
        showStatus('请在 Notion 页面中操作', 'error');
        return;
      }

      // Get scan data
      const scanData = await chrome.storage.local.get(['scanData']);
      if (!scanData.scanData || Object.keys(scanData.scanData.pages || {}).length === 0) {
        showStatus('没有扫描数据，请先开启扫描', 'error');
        return;
      }

      // Send message to content script to show graph
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'showGraph' }).catch(async (error) => {
        if (error.message && error.message.includes('Could not establish connection')) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          return await chrome.tabs.sendMessage(tab.id, { action: 'showGraph' });
        }
        throw error;
      });
      
      if (response && response.success) {
        showStatus('星图已显示', 'success');
      }
    } catch (error) {
      console.error('Error:', error);
      showStatus('错误: ' + error.message, 'error');
    }
  });

  // Update scan status display
  function updateScanStatus(isScanning) {
    if (isScanning) {
      scanStatus.textContent = '扫描中... 请浏览需要记录的页面';
      scanStatus.style.color = '#007AFF';
    } else {
      scanStatus.textContent = '扫描已关闭';
      scanStatus.style.color = '#666';
    }
    scanCount.style.display = isScanning ? 'block' : 'none';
  }

  // Update counts display
  function updateCounts(data) {
    if (!data) return;
    const pages = data.pages || {};
    const links = data.links || [];
    pageCount.textContent = Object.keys(pages).length;
    linkCount.textContent = links.length;
  }

  // Auto-browse toggle handler
  autoBrowseToggle.addEventListener('change', async (e) => {
    const isAutoBrowsing = e.target.checked;
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url || !tab.url.startsWith('https://www.notion.so/')) {
        autoBrowseToggle.checked = !isAutoBrowsing;
        showStatus('请在 Notion 页面中操作', 'error');
        return;
      }

      // Send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: isAutoBrowsing ? 'startAutoBrowse' : 'stopAutoBrowse' 
      }).catch(async (error) => {
        if (error.message && error.message.includes('Could not establish connection')) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          return await chrome.tabs.sendMessage(tab.id, { 
            action: isAutoBrowsing ? 'startAutoBrowse' : 'stopAutoBrowse' 
          });
        }
        throw error;
      });

      if (response && response.success) {
        await chrome.storage.local.set({ autoBrowsing: isAutoBrowsing });
        updateAutoBrowseStatus(isAutoBrowsing);
        showStatus(isAutoBrowsing ? '自动浏览已开启' : '自动浏览已关闭', 'success');
      }
    } catch (error) {
      console.error('Error:', error);
      autoBrowseToggle.checked = !isAutoBrowsing;
      showStatus('错误: ' + error.message, 'error');
    }
  });

  // Load auto-browse state
  const autoBrowseState = await chrome.storage.local.get(['autoBrowsing']);
  if (autoBrowseState.autoBrowsing) {
    autoBrowseToggle.checked = true;
    updateAutoBrowseStatus(true);
  }

  // Update auto-browse status display
  function updateAutoBrowseStatus(isAutoBrowsing) {
    if (isAutoBrowsing) {
      autoBrowseStatus.textContent = '自动浏览中...';
      autoBrowseStatus.style.color = '#007AFF';
      autoBrowseProgress.style.display = 'block';
    } else {
      autoBrowseStatus.textContent = '自动浏览已关闭';
      autoBrowseStatus.style.color = '#666';
      autoBrowseProgress.style.display = 'none';
    }
  }

  // Listen for auto-browse progress updates
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.scanData) {
        updateCounts(changes.scanData.newValue);
      }
      if (changes.autoBrowseProgress) {
        const progress = changes.autoBrowseProgress.newValue;
        if (progress) {
          currentPage.textContent = progress.current || '-';
          totalPages.textContent = progress.total || '-';
        }
      }
    }
  });

  // Listen for scan data updates
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.scanData) {
      updateCounts(changes.scanData.newValue);
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
});

