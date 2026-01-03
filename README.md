# Notion Overlay Chrome Extension

A Chrome Extension (Manifest V3) that injects a full-screen overlay on Notion pages.

## Files

- `manifest.json` - Extension manifest with required permissions
- `background.js` - Service worker that handles extension icon clicks
- `content.js` - Content script that creates and manages the overlay
- `popup.html` - Extension popup interface
- `popup.js` - Popup script logic

## Setup

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `notion-overlay-extension` folder

## Usage

- **Via Popup**: Click the extension icon to open the popup, then click "Toggle Overlay"
- **Direct Icon Click**: If you want clicking the icon directly to toggle the overlay (without opening popup), remove the `"default_popup": "popup.html"` line from `manifest.json` in the `action` section

## Permissions

- `activeTab` - Access to the current active tab
- `scripting` - Inject scripts into pages
- `storage` - Store extension data
- Host permission: `https://www.notion.so/*` - Access to Notion pages

## Note on Icons

The manifest references icon files (`icon16.png`, `icon48.png`, `icon128.png`) that are not included. You can:
1. Create placeholder icons, or
2. Remove the icon references from `manifest.json` (the extension will still work, just without custom icons)

