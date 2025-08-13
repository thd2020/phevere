/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/latest/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

console.log('🚀 Phevere Renderer Process Started');
import './index.css';

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  const path = window.location.pathname || '';

  // If we're on the dedicated popup bundle (/popup_window), DO NOT rebuild DOM.
  // The markup and behavior come from popup-new.html itself.
  if (path.includes('popup_window')) {
    console.log('[POPUP-RENDERER] Detected /popup_window. Skipping initializePopup() to use popup-new.html. hash=', hash);
  } else if (hash === '#popup') {
    // Legacy hash-based popup route (main bundle)
    initializePopup();
  } else if (hash === '#settings') {
    // Settings window functionality
    initializeSettingsWindow();
  } else {
    // Main window functionality
    initializeMainWindow();
  }
});

// Also try immediate execution if DOM is already ready
// IMPORTANT: Avoid double init. We rely solely on DOMContentLoaded above

function initializeSettingsWindow() {
  console.log('🚀 Initializing settings window...');

  const settingsHTML = `
    <div class="settings-container">
      <div class="settings-header" style="-webkit-app-region: drag; display:flex; align-items:center; justify-content: space-between;">
        <h1 style="margin:0; font-size:16px;">⚙️ Settings</h1>
        <button id="settings-close" class="close-btn" style="-webkit-app-region: no-drag;">×</button>
      </div>
      <div class="settings-content">
        <div class="settings-section">
          <h4>🔑 API Configuration</h4>
          <div class="setting-item">
            <label for="google-api-key">Google Translate API Key:</label>
            <input type="password" id="google-api-key" placeholder="Enter your Google API key" class="setting-input">
            <button onclick="saveGoogleApiKey()" class="btn btn-primary">Save</button>
          </div>
          <div class="setting-item">
            <label for="deepl-api-key">DeepL API Key:</label>
            <input type="password" id="deepl-api-key" placeholder="Enter your DeepL API key" class="setting-input">
            <button onclick="saveDeepLApiKey()" class="btn btn-primary">Save</button>
          </div>
        </div>
        <div class="settings-section">
          <h4>📚 Dictionary Sources</h4>
          <div id="main-source-toggles"></div>
        </div>
        <div class="settings-section">
          <h4>Audio Settings</h4>
          </div>
      </div>
    </div>
  `;
  document.body.innerHTML = settingsHTML;

  // Inject modern styles specifically for the settings window so they always apply
  const settingsStyle = document.createElement('style');
  settingsStyle.textContent = `
    body { margin: 0; padding: 0; }
    .settings-container { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#1f2937; }
    .settings-header { background: linear-gradient(135deg, #5b67e7 0%, #6c58b9 50%, #3a2e7e 100%); color:#fff; padding: 10px 14px; }
    .settings-header .close-btn { background: rgba(255,255,255,0.15); color:#fff; border:none; width:28px; height:28px; border-radius:6px; cursor:pointer; }
    .settings-header .close-btn:hover { background: rgba(255,255,255,0.3); }
    .settings-content { padding: 16px; }
    .settings-section { background:#fff; border:1px solid #e9ecef; border-radius:12px; padding:16px; margin-bottom:16px; box-shadow:0 6px 24px rgba(0,0,0,.06); }
    .setting-item { display:flex; flex-direction:column; gap:8px; margin:12px 0; }
    .setting-input { padding:10px 12px; border:2px solid #e9ecef; border-radius:8px; font-size:14px; }
    .btn.btn-primary { background:#0d6efd; color:#fff; padding:10px 18px; border-radius:10px; border:none; cursor:pointer; font-weight:600; }
    .btn.btn-primary:hover { background:#0b5ed7; }
    #main-source-toggles .source-toggle-main { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border:1px solid #e9ecef; border-radius:10px; margin-bottom:8px; background:#f8f9fa; }
    .toggle-input { position:absolute; opacity:0; width:0; height:0; }
    .toggle-switch { position:relative; width:48px; height:26px; background:#ccc; border-radius:13px; cursor:pointer; display:inline-block; }
    .toggle-slider { position:absolute; top:2px; left:2px; width:22px; height:22px; background:#fff; border-radius:50%; transition:transform .2s ease; box-shadow:0 2px 4px rgba(0,0,0,.2); }
    .toggle-input:checked + .toggle-switch { background:#22c55e; }
    .toggle-input:checked + .toggle-switch .toggle-slider { transform: translateX(22px); }
  `;
  document.head.appendChild(settingsStyle);

  // Load settings data
  loadMainSourceToggles();
  setupAudioSettings();
  document.getElementById('settings-close')?.addEventListener('click', () => {
    window.close();
  });
}

let __popupInitDone = false;
let __lastRenderedText = '';
let __lastResizedForText = '';
function initializePopup() {
  if (__popupInitDone) {
    console.log('[POPUP-RENDERER] initializePopup skipped (already initialized)');
    return;
  }
  __popupInitDone = true;
  console.log('[POPUP-RENDERER] initializePopup start hash=', window.location.hash, 'href=', window.location.href);
  
  // Create modern popup UI with tabs and language selection
  const popupHTML = `
    <div class="popup-container resizable-popup" id="popup-container">
      <div class="popup-content">
        <div class="selected-text-container">
          <div class="selected-text" id="selected-text">Loading...</div>
          <div class="language-controls" id="language-controls" style="display: none;">
            <div class="language-selector">
              <select id="source-lang" class="lang-select">
                <option value="auto">Auto-detect</option>
              </select>
              <button class="swap-languages" id="swap-languages" title="Swap languages">⇄</button>
              <select id="target-lang" class="lang-select">
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </div>

        <div class="popup-header">
          <div class="popup-title">
            <span class="title-text">📚 Phevere Dictionary</span>
            <span class="title-subtitle" id="title-subtitle">Multi-source Translation</span>
          </div>
          <div class="toolbar">
            <button id="copy-btn" class="toolbar-btn" title="Copy to clipboard">📋</button>
            <button id="wikipedia-btn" class="toolbar-btn" title="Search Wikipedia">📚</button>
            <button id="web-search-btn" class="toolbar-btn" title="Web search">🌐</button>
            <button id="audio-btn" class="toolbar-btn" title="Play pronunciation">🔊</button>
            <button id="settings-btn" class="toolbar-btn" title="Settings">⚙️</button>
            <button id="open-full-btn" class="toolbar-btn" title="Open full window">🗖</button>
          </div>
          <button id="close-btn" class="close-btn">×</button>
        </div>

        <div class="loading" id="loadingElement">
          <div class="loading-spinner"></div>
          <span>Looking up definition...</span>
        </div>
        
        <div class="tab-container" id="tab-container" style="display: none;">
          <div class="tab-nav" id="tab-nav"></div>
          <div class="tab-content" id="tab-content"></div>
        </div>
      </div>
    </div>
  `;
  
  document.body.innerHTML = popupHTML;
  
  
  
  // Add improved styling with tabs and better scrolling
  const style = document.createElement('style');
  style.textContent = `
    body, html {
  margin: 0 !important;
  padding: 0 !important;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: transparent !important;
}
* {
  box-sizing: border-box;
}

    
    .popup-container {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(20px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      overflow: hidden;
      min-width: 280px;
      width: 100%;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    .popup-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    }
    
    .popup-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
    }
    
    .title-text {
      font-size: 16px;
      font-weight: 600;
      color: #2c3e50;
    }
    
    .title-subtitle {
      font-size: 12px;
      color: #6c757d;
      font-weight: 400;
    }
    
    .toolbar {
      display: flex;
      gap: 8px;
      margin: 0 16px;
    }
    
    .toolbar-btn {
      background: rgba(255, 255, 255, 0.8);
      border: 1px solid rgba(0, 0, 0, 0.1);
      color: #6c757d;
      cursor: pointer;
      font-size: 16px;
      padding: 8px;
      border-radius: 6px;
      transition: all 0.2s ease;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .toolbar-btn:hover {
      background: rgba(33, 150, 243, 0.1);
      color: #2196f3;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    
    .toolbar-btn:active {
      transform: translateY(0);
    }
    
    .close-btn {
      background: none;
      border: none;
      color: #6c757d;
      cursor: pointer;
      font-size: 20px;
      padding: 8px;
      border-radius: 6px;
      transition: all 0.2s ease;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .close-btn:hover {
      color: #495057;
      background: rgba(0, 0, 0, 0.05);
    }
    
    .popup-content {
  flex-grow: 1; /* Allow this to grow and take up space */
  overflow-y: auto; /* Add scrollbar only when content overflows */
  padding: 16px; /* Keep your padding */
  min-width: 350px;
}
    
    .selected-text-container {
      padding: 16px 20px 8px 20px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    }
    
    .language-controls {
      margin-top: 12px;
      padding: 8px 0;
    }
    
    .language-selector {
      display: flex;
      align-items: center;
      gap: 12px;
      justify-content: center;
    }
    
    .lang-select {
      padding: 6px 12px;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 6px;
      background: white;
      font-size: 12px;
      min-width: 120px;
      outline: none;
      transition: all 0.2s ease;
      position: relative;
      z-index: 1000;
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      cursor: pointer;
    }
    
    .lang-select:focus {
      border-color: #2196f3;
      box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.2);
      z-index: 1001;
    }
    
    .lang-select:hover {
      border-color: #666;
    }
    
    /* Prevent dropdown from closing too quickly */
    .language-selector {
      position: relative;
      z-index: 1000;
    }
    
    .swap-languages {
      background: #f8f9fa;
      border: 1px solid rgba(0, 0, 0, 0.1);
      color: #6c757d;
      cursor: pointer;
      font-size: 14px;
      padding: 6px 8px;
      border-radius: 6px;
      transition: all 0.2s ease;
      min-width: 32px;
    }
    
    .swap-languages:hover {
      background: #e9ecef;
      color: #495057;
    }
    
    .tab-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .tab-nav {
      display: flex;
      background: #f8f9fa;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    
    .tab-nav::-webkit-scrollbar {
      display: none;
    }
    
    .tab-button {
      background: none;
      border: none;
      padding: 12px 16px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: #6c757d;
      transition: all 0.2s ease;
      white-space: nowrap;
      border-bottom: 2px solid transparent;
      position: relative;
    }
    
    .tab-button:hover {
      color: #495057;
      background: rgba(0, 0, 0, 0.03);
    }
    
    .tab-button.active {
      color: #2196f3;
      border-bottom-color: #2196f3;
      background: rgba(33, 150, 243, 0.05);
    }
    
    .tab-content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 20px;
      position: relative;
      scrollbar-width: thin;
      scrollbar-color: #ccc #f8f9fa;
      max-height: 400px;
    }
    
    .tab-content::-webkit-scrollbar {
      width: 8px;
    }
    
    .tab-content::-webkit-scrollbar-track {
      background: #f8f9fa;
      border-radius: 4px;
    }
    
    .tab-content::-webkit-scrollbar-thumb {
      background: #ccc;
      border-radius: 4px;
    }
    
    .tab-content::-webkit-scrollbar-thumb:hover {
      background: #999;
    }
    
    .tab-pane {
      display: none;
      animation: fadeIn 0.3s ease-out;
    }
    
    .tab-pane.active {
      display: block;
    }
    
    .selected-text {
      background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 16px;
      font-weight: 500;
      color: #2c3e50;
      border-left: 4px solid #2196f3;
      word-break: break-word;
    }
    
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 20px;
      color: #6c757d;
      font-size: 14px;
    }
    
    .loading-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid #e9ecef;
      border-top: 2px solid #2196f3;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .dictionary-results {
      animation: fadeIn 0.3s ease-out;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .dictionary-entry {
      background: rgba(255, 255, 255, 0.8);
      border-radius: 10px;
      padding: 16px;
      border: 1px solid rgba(0, 0, 0, 0.06);
    }
    
    .word {
      font-size: 24px;
      font-weight: 700;
      color: #2c3e50;
      margin-bottom: 8px;
      text-transform: capitalize;
    }
    
    .pronunciation {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      font-family: 'Courier New', monospace;
      color: #6c757d;
      font-size: 14px;
    }
    
    .pronunciation-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .definitions {
      margin-bottom: 20px;
    }
    
    .definition {
      background: rgba(248, 249, 250, 0.8);
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 12px;
      border-left: 3px solid #2196f3;
    }
    
    .definition strong {
      color: #2196f3;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    
    .synonyms {
      margin-top: 8px;
      font-size: 13px;
      color: #6c757d;
      font-style: italic;
    }
    
    .antonyms {
      margin-top: 4px;
      font-size: 13px;
      color: #dc3545;
      font-style: italic;
    }
    
    .synonyms-section {
      background: rgba(232, 245, 233, 0.8);
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      border-left: 3px solid #4caf50;
      font-size: 14px;
    }
    
    .antonyms-section {
      background: rgba(255, 235, 238, 0.8);
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      border-left: 3px solid #f44336;
      font-size: 14px;
    }
    
    .etymology {
      background: rgba(255, 243, 224, 0.8);
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      border-left: 3px solid #ff9800;
      font-size: 14px;
      font-style: italic;
    }
    
    .sources-section {
      background: rgba(240, 248, 255, 0.8);
      padding: 8px 12px;
      border-radius: 6px;
      margin-top: 16px;
      border-left: 3px solid #2196f3;
      font-size: 12px;
      color: #6c757d;
    }
    
    .confidence {
      font-size: 11px;
      color: #28a745;
      font-weight: 600;
      margin-top: 4px;
    }
    
    .source {
      font-size: 11px;
      color: #6c757d;
      font-style: italic;
      margin-top: 2px;
    }
    
    .translations {
      margin-bottom: 20px;
    }
    
    .translation {
      background: rgba(248, 249, 250, 0.8);
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 12px;
      border-left: 3px solid #4caf50;
    }
    
    .translation strong {
      color: #4caf50;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    
    .examples {
      margin-bottom: 20px;
    }
    
    .example {
      background: rgba(255, 243, 224, 0.8);
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 8px;
      font-style: italic;
      color: #795548;
      border-left: 3px solid #ff9800;
    }
    
    .word-origin {
      background: rgba(232, 245, 233, 0.8);
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      border-left: 3px solid #4caf50;
    }
    
    .word-origin strong {
      color: #4caf50;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    
    .error-message {
      background: rgba(255, 235, 238, 0.8);
      border: 1px solid rgba(244, 67, 54, 0.3);
      color: #d32f2f;
      padding: 16px;
      border-radius: 8px;
      text-align: center;
      font-style: italic;
    }
    
    .notification {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: 500;
      z-index: 1000;
      animation: slideIn 0.3s ease-out;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    
    /* Tab content styles */
    .translation-tab, .dictionary-tab {
      line-height: 1.6;
    }
    
    .translation-results {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    
    .translation-item {
      background: rgba(248, 249, 250, 0.8);
      border-radius: 8px;
      padding: 16px;
      border-left: 4px solid #4caf50;
    }
    
    .translation-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    
    .translation-language {
      font-weight: 600;
      color: #4caf50;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .translation-source {
      font-size: 11px;
      color: #6c757d;
      font-style: italic;
    }
    
    .confidence-score {
      font-size: 11px;
      color: #28a745;
      font-weight: 600;
    }
    
    .translation-text {
      font-size: 16px;
      color: #2c3e50;
      font-weight: 500;
    }
    
    .translation-pronunciation {
      font-size: 12px;
      color: #6c757d;
      font-family: 'Courier New', monospace;
      margin-top: 4px;
    }
    
    .word-header {
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid #e9ecef;
    }
    
    .word-title {
      font-size: 24px;
      font-weight: 700;
      color: #2c3e50;
      margin-bottom: 4px;
    }
    
    .pronunciation {
      font-family: 'Courier New', monospace;
      color: #6c757d;
      font-size: 14px;
    }
    
    .definitions-section, .examples-section, .etymology-section, 
    .synonyms-section, .antonyms-section {
      margin-bottom: 20px;
    }
    
    .definitions-section h4, .examples-section h4, .etymology-section h4,
    .synonyms-section h4, .antonyms-section h4 {
      color: #495057;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .definition-item {
      background: rgba(248, 249, 250, 0.6);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 12px;
      border-left: 3px solid #2196f3;
    }
    
    .part-of-speech {
      font-size: 12px;
      color: #2196f3;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    
    .definition-text {
      color: #2c3e50;
      line-height: 1.5;
      margin-bottom: 8px;
    }
    
    .definition-examples {
      margin-top: 8px;
    }
    
    .definition-examples .example {
      font-style: italic;
      color: #6c757d;
      font-size: 14px;
      margin-bottom: 4px;
    }
    
    .synonyms {
      font-size: 13px;
      color: #28a745;
      font-style: italic;
      margin-top: 6px;
    }
    
    .example {
      font-style: italic;
      color: #6c757d;
      margin-bottom: 6px;
      padding-left: 12px;
      border-left: 2px solid #dee2e6;
    }
    
    .etymology-text {
      color: #6c757d;
      font-style: italic;
      line-height: 1.5;
    }
    
    .word-list {
      color: #495057;
      line-height: 1.5;
    }
    
    .no-data {
      text-align: center;
      color: #6c757d;
      font-style: italic;
      padding: 40px 20px;
    }

    .resizable-popup {
      resize: both;
      overflow: auto;
      min-width: 300px;
      min-height: 200px;
      max-width: 800px;
      max-height: 600px;
    }
  `;
  document.head.appendChild(style);
  
  // Initialize language selectors
  initializeLanguageSelectors();
  
  // Set up toolbar button handlers
  console.log('[POPUP-RENDERER] initializePopup start');
  document.getElementById('copy-btn')?.addEventListener('click', async () => {
    const selectedText = document.getElementById('selected-text')?.textContent || '';
    if (window.clipboardAPI) {
      await window.clipboardAPI.copy(selectedText);
    }
  });
  
  document.getElementById('wikipedia-btn')?.addEventListener('click', () => {
    const selectedText = document.getElementById('selected-text')?.textContent || '';
    (window as any).searchWikipedia(selectedText);
  });
  
  document.getElementById('web-search-btn')?.addEventListener('click', () => {
    const selectedText = document.getElementById('selected-text')?.textContent || '';
    (window as any).searchWeb(selectedText);
  });
  
  document.getElementById('audio-btn')?.addEventListener('click', () => {
    const selectedText = document.getElementById('selected-text')?.textContent || '';
    // Determine language from current context
    const sourceLang = (document.getElementById('source-lang') as HTMLSelectElement)?.value || 'en-US';
    const detectedLang = sourceLang === 'auto' ? 'en-US' : sourceLang;
    (window as any).playAudio(selectedText, detectedLang);
  });
  
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    // Also support in-popup settings panel (for popup-new.html). If not present, open window.
    const panel = document.getElementById('settingsPanel');
    if (panel) {
      panel.classList.toggle('show');
    } else {
      window.electronAPI.showSettingsWindow();
    }
  });

  // Open full dictionary window instead of small popup
  document.getElementById('open-full-btn')?.addEventListener('click', () => {
    const text = (document.getElementById('selected-text')?.textContent || '').trim();
    if (!text) return;
    // Ask main to open a full in-app window instead of external protocol
    window.electronAPI?.send('open-full-lookup', text);
  });
  
  // Handle close button
  document.getElementById('close-btn')?.addEventListener('click', () => {
    console.log('[POPUP-RENDERER] Close button clicked');
    window.close();
  });
  
  // Listen for popup data from main process
  if (window.electronAPI) {
    console.log('[POPUP-RENDERER] getLastSelection invoke');
    try {
      const envInfo = (window as any).electronAPI.__debugInfo ? (window as any).electronAPI.__debugInfo() : null;
      console.log('[POPUP-RENDERER] env', envInfo);
    } catch {}
    window.electronAPI.getLastSelection().then(selection => {
      const txt = (selection && selection.text) ? selection.text : '';
      console.log('[POPUP-RENDERER] getLastSelection OK (deferred lookup):', txt);
      const selectedTextElement = document.getElementById('selected-text');
      if (selectedTextElement && txt) selectedTextElement.textContent = txt;
      if (txt) (window as any).__popupCurrentText = txt;
      // Do NOT call updatePopupContent here; wait for user click
    });
    // Also listen for pushed text from main
    let lastPushed = '';
    window.electronAPI.onPopupText((text) => {
      const t = (text || '').trim();
      if (!t || t === lastPushed) return;
      lastPushed = t;
      console.log('[POPUP-RENDERER] onPopupText (deferred lookup):', t);
      const selectedTextElement = document.getElementById('selected-text');
      if (selectedTextElement) selectedTextElement.textContent = t;
      (window as any).__popupCurrentText = t;
      // Do NOT call updatePopupContent here; wait for user click
    });
  } else {
    console.log('[POPUP-RENDERER] electronAPI not available');
    updatePopupContent('Error: electronAPI not available.');
  }
  
  // Handle escape key to close popup
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      console.log('🚀 Escape key pressed, closing popup');
      window.close();
    }
  });
  
  // Remove aggressive fallback content injection to avoid confusing duplicates

  // Handle clicks on hyperlinks
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const link = target.closest('a');
    if (link && link.hasAttribute('href')) {
      event.preventDefault();
      let href = link.getAttribute('href');
      if (href) {
        if (href.startsWith('/')) href = `https://en.wiktionary.org${href}`;
        if ((window as any).openLinksExternally) window.electronAPI.openExternal(href); else window.electronAPI.send('open-in-app', href);
      }
    }
  });
}



function initializeMainWindow() {
  // Initialize controls for the existing HTML structure
  initializeMainWindowControls();
  
  // Start monitoring automatically
  startMonitoring();

  // Inject a compact visual refresh for the main window (targets existing DOM in src/index.html)
  const mainStyle = document.createElement('style');
  mainStyle.textContent = `
    .container { max-width: 880px; margin: 0 auto; padding: 16px 20px; }
    .container h1 { font-size: 28px; font-weight: 800; color:#1f2937; display:flex; align-items:center; gap:10px; }
    .controls { display:flex; gap:10px; }
    .btn { padding:10px 18px; border-radius:10px; font-weight:600; }
    .recent-selections { background:#fff; border:1px solid #e9ecef; border-radius:12px; box-shadow:0 6px 24px rgba(0,0,0,.06); }
  `;
  document.head.appendChild(mainStyle);
}

function initializeMainWindowControls() {
  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
  const testBtn = document.getElementById('testPopupBtn') as HTMLButtonElement;
  const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
  const selectionStatus = document.getElementById('selectionStatus') as HTMLElement;
  const clipboardStatus = document.getElementById('clipboardStatus') as HTMLElement;
  
  // Window control buttons
  const minimizeBtn = document.getElementById('minimize-btn') as HTMLButtonElement;
  const maximizeBtn = document.getElementById('maximize-btn') as HTMLButtonElement;
  const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;
  
  let isMonitoring = false;
  
  // Window control event listeners
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => {
      window.electronAPI?.minimizeWindow();
    });
  }
  
  if (maximizeBtn) {
    maximizeBtn.addEventListener('click', () => {
      window.electronAPI?.maximizeWindow();
    });
  }
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.electronAPI?.closeWindow();
    });
  }
  
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      try {
        await startMonitoring();
        selectionStatus.textContent = 'Running';
        selectionStatus.className = 'status-value running';
        isMonitoring = true;
      } catch (error) {
        console.error('Start monitoring failed:', error);
      }
    });
  }
  
  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      try {
        await stopMonitoring();
        selectionStatus.textContent = 'Stopped';
        selectionStatus.className = 'status-value stopped';
        isMonitoring = false;
      } catch (error) {
        console.error('Stop monitoring failed:', error);
      }
    });
  }
  
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      if (window.electronAPI) {
        await window.electronAPI.testPopup();
      }
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      window.electronAPI.showSettingsWindow();
    });
  }

  // Listen for clipboard history shortcut
  if (window.electronAPI) {
    window.electronAPI.onShowClipboardHistory(() => {
      showClipboardHistory();
    });
  }
  
  // Update clipboard status to show it's running
  clipboardStatus.textContent = 'Running';
  clipboardStatus.className = 'status-value running';
  
  // Update selection status to show it's running (since it starts automatically)
  selectionStatus.textContent = 'Running';
  selectionStatus.className = 'status-value running';
  isMonitoring = true;
}

async function startMonitoring() {
  try {
    // Ask main process to start native monitoring and open popup on selection
    if (window.electronAPI && typeof window.electronAPI.startMonitoring === 'function') {
      await window.electronAPI.startMonitoring();
    }
    // Ensure we have a listener to update the recent selections list when the selection event arrives
    if (window.electronAPI) {
      window.electronAPI.onSelectionChange((text: string) => {
        console.log('[DBG] renderer received selection-changed:', text);
        // Ignore only if this window is focused (selection originated inside app)
        if (document.hasFocus()) {
          console.log('[DBG] ignoring selection because window is focused');
          return;
        }
        addToRecentSelections(text);
      });
    }
    console.log('Monitoring started');
  } catch (error) {
    console.error('Failed to start monitoring:', error);
  }
}

async function stopMonitoring() {
  try {
    if (window.electronAPI && typeof window.electronAPI.stopMonitoring === 'function') {
      await window.electronAPI.stopMonitoring();
    }
    console.log('Monitoring stopped');
  } catch (error) {
    console.error('Failed to stop monitoring:', error);
  }
}

function addToRecentSelections(text: string) {
  // Harmonize with index.html id
  const recentList = document.getElementById('selectionsList') || document.getElementById('recent-list');
  if (!recentList) return;

  const last = recentList.firstElementChild as HTMLElement | null;
  if (last && last.querySelector('.selection-text')?.textContent === text) {
    // Debounce duplicates produced by same selection event burst
    return;
  }
  
  const selectionItem = document.createElement('button');
  selectionItem.className = 'selection-item';
  selectionItem.setAttribute('type', 'button');
  selectionItem.setAttribute('aria-label', `Lookup ${text}`);
  selectionItem.style.textAlign = 'left';
  selectionItem.style.width = '100%';
  selectionItem.style.background = 'transparent';
  selectionItem.style.border = 'none';
  selectionItem.style.cursor = 'pointer';
  selectionItem.innerHTML = `
    <span class="selection-text">${text}</span>
    <span class="selection-time">${new Date().toLocaleTimeString()}</span>
  `;
  selectionItem.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      // Recall via cache first for fast open, then show expanded window
      if (window.dictionaryAPI && typeof window.dictionaryAPI.recall === 'function') {
        await window.dictionaryAPI.recall(text, 'en');
      }
      window.electronAPI?.send('open-full-lookup', text);
    } catch (err) {
      console.error('Failed to open full dictionary view:', err);
    }
  });
  
  // Add to beginning of list
  recentList.insertBefore(selectionItem, recentList.firstChild);
  
  // Keep only last 10 selections
  const items = recentList.querySelectorAll('.selection-item');
  if (items.length > 10) {
    recentList.removeChild(items[items.length - 1]);
  }
}

function showTestPopup(text: string) {
  // Simulate popup for testing
  const popup = document.createElement('div');
  popup.className = 'test-popup';
  popup.innerHTML = `
    <div class="popup-header">
      <h3>${text}</h3>
      <button onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
    <div class="popup-content">
      <p>Test popup for: "${text}"</p>
      <p>Dictionary results would appear here...</p>
    </div>
  `;
  
  document.body.appendChild(popup);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (popup.parentElement) {
      popup.remove();
    }
  }, 5000);
}

async function showClipboardHistory() {
  if (!window.clipboardAPI) {
    console.error('Clipboard API not available');
    return;
  }

  try {
    const history = await window.clipboardAPI.getHistory();
    const stats = await window.clipboardAPI.getStats();
    
    // Create clipboard history popup
    const popup = document.createElement('div');
    popup.className = 'clipboard-popup';
    popup.innerHTML = `
      <div class="popup-header">
        <h3>📋 Clipboard History (${stats.totalEntries} items)</h3>
        <div class="popup-controls">
          <button id="clear-clipboard" class="btn btn-danger">Clear All</button>
          <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
        </div>
      </div>
      <div class="popup-content">
        <div class="clipboard-search">
          <input type="text" id="clipboard-search" placeholder="Search clipboard history..." class="search-input">
        </div>
        <div id="clipboard-list" class="clipboard-list">
          ${history.length === 0 ? '<p class="empty-state">No clipboard history yet</p>' : ''}
        </div>
      </div>
    `;
    
    document.body.appendChild(popup);
    
    // Populate clipboard list
    const clipboardList = document.getElementById('clipboard-list');
    if (clipboardList && history.length > 0) {
      clipboardList.innerHTML = history.map(entry => `
        <div class="clipboard-item" data-id="${entry.id}">
          <div class="clipboard-text">${entry.text.substring(0, 100)}${entry.text.length > 100 ? '...' : ''}</div>
          <div class="clipboard-meta">
            <span class="clipboard-time">${entry.timestamp.toLocaleTimeString()}</span>
            <button class="copy-btn" onclick="copyClipboardText('${entry.text.replace(/'/g, "\\'")}')">Copy</button>
            <button class="remove-btn" onclick="removeClipboardEntry('${entry.id}')">×</button>
          </div>
        </div>
      `).join('');
    }
    
    // Handle search
    const searchInput = document.getElementById('clipboard-search') as HTMLInputElement;
    searchInput?.addEventListener('input', async (e) => {
      const query = (e.target as HTMLInputElement).value;
      if (query.trim()) {
        const results = await window.clipboardAPI.search(query);
        updateClipboardList(results);
      } else {
        const allHistory = await window.clipboardAPI.getHistory();
        updateClipboardList(allHistory);
      }
    });
    
    // Handle clear all
    document.getElementById('clear-clipboard')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all clipboard history?')) {
        await window.clipboardAPI.clear();
        popup.remove();
      }
    });
    
    // Auto-remove on escape
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        popup.remove();
      }
    });
    
  } catch (error) {
    console.error('Error loading clipboard history:', error);
  }
}

function updateClipboardList(entries: any[]) {
  const clipboardList = document.getElementById('clipboard-list');
  if (!clipboardList) return;
  
  if (entries.length === 0) {
    clipboardList.innerHTML = '<p class="empty-state">No matching entries</p>';
    return;
  }
  
  clipboardList.innerHTML = entries.map(entry => `
    <div class="clipboard-item" data-id="${entry.id}">
      <div class="clipboard-text">${entry.text.substring(0, 100)}${entry.text.length > 100 ? '...' : ''}</div>
      <div class="clipboard-meta">
        <span class="clipboard-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
        <button class="copy-btn" onclick="copyClipboardText('${entry.text.replace(/'/g, "\\'")}')">Copy</button>
        <button class="remove-btn" onclick="removeClipboardEntry('${entry.id}')">×</button>
      </div>
    </div>
  `).join('');
}

// Make popup resizable
function makePopupResizable(popup: HTMLElement) {
  const resizeHandle = popup.querySelector('.resize-handle-se') as HTMLElement;
  if (!resizeHandle) return;
  
  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  
  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = parseInt(window.getComputedStyle(popup).width, 10);
    startHeight = parseInt(window.getComputedStyle(popup).height, 10);
    
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    e.preventDefault();
  });
  
  function handleResize(e: MouseEvent) {
    if (!isResizing) return;
    
    const width = startWidth + e.clientX - startX;
    const height = startHeight + e.clientY - startY;
    
    // Set minimum and maximum sizes
    const minWidth = 400;
    const minHeight = 300;
    const maxWidth = window.innerWidth * 0.9;
    const maxHeight = window.innerHeight * 0.9;
    
    popup.style.width = Math.min(Math.max(width, minWidth), maxWidth) + 'px';
    popup.style.height = Math.min(Math.max(height, minHeight), maxHeight) + 'px';
  }
  
  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
  }
}

// Make settings modal draggable
function makeSettingsModalDraggable(modal: HTMLElement, header: HTMLElement) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  
  header.addEventListener('mousedown', (e) => {
    // Don't drag if clicking on buttons
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    const rect = modal.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    
    // Switch from flexbox positioning to absolute positioning
    const overlay = modal.parentElement as HTMLElement;
    overlay.style.alignItems = 'flex-start';
    overlay.style.justifyContent = 'flex-start';
    modal.style.position = 'absolute';
    modal.style.left = startLeft + 'px';
    modal.style.top = startTop + 'px';
    
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
    e.preventDefault();
  });
  
  function handleDrag(e: MouseEvent) {
    if (!isDragging) return;
    
    const left = startLeft + e.clientX - startX;
    const top = startTop + e.clientY - startY;
    
    // Keep modal within screen bounds
    const maxLeft = window.innerWidth - modal.offsetWidth;
    const maxTop = window.innerHeight - modal.offsetHeight;
    
    modal.style.left = Math.min(Math.max(left, 0), maxLeft) + 'px';
    modal.style.top = Math.min(Math.max(top, 0), maxTop) + 'px';
  }
  
  function stopDrag() {
    isDragging = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  }
}

// Make popup draggable
function makePopupDraggable(popup: HTMLElement) {
  const header = popup.querySelector('.popup-header') as HTMLElement;
  if (!header) return;
  
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  
  header.style.cursor = 'move';
  
  header.addEventListener('mousedown', (e) => {
    // Don't drag if clicking on buttons
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = popup.offsetLeft;
    startTop = popup.offsetTop;
    
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
    e.preventDefault();
  });
  
  function handleDrag(e: MouseEvent) {
    if (!isDragging) return;
    
    const left = startLeft + e.clientX - startX;
    const top = startTop + e.clientY - startY;
    
    // Keep popup within screen bounds
    const maxLeft = window.innerWidth - popup.offsetWidth;
    const maxTop = window.innerHeight - popup.offsetHeight;
    
    popup.style.left = Math.min(Math.max(left, 0), maxLeft) + 'px';
    popup.style.top = Math.min(Math.max(top, 0), maxTop) + 'px';
  }
  
  function stopDrag() {
    isDragging = false;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  }
}

// Load main source toggles
async function loadMainSourceToggles() {
  try {
    if (window.dictionaryAPI) {
      const sourceStats = await window.dictionaryAPI.getSourceStats();
      const enabledSources = await window.dictionaryAPI.getEnabledSources();
      console.log('[DBG][Settings] sourceStats:', sourceStats);
      console.log('[DBG][Settings] enabledSources:', enabledSources);
      
      const sourceToggles = document.getElementById('main-source-toggles');
      if (sourceToggles && sourceStats.sources) {
        sourceToggles.innerHTML = sourceStats.sources.map(source => `
          <div class="source-toggle-main">
            <div class="source-info">
              <span class="source-name">${source.name}</span>
              <span class="source-priority">Priority: ${source.priority}</span>
            </div>
            <label>
              <input class="toggle-input" type="checkbox" data-source="${source.name}" ${enabledSources.includes(source.name) ? 'checked' : ''} />
              <span class="toggle-switch" aria-hidden="true"><span class="toggle-slider"></span></span>
            </label>
          </div>
        `).join('');

        // Bind change handlers to checkboxes (more reliable than div clicks)
        sourceToggles.querySelectorAll('.toggle-input').forEach((el) => {
          const input = el as HTMLInputElement;
          input.addEventListener('change', async () => {
            const sourceName = input.dataset?.source || '';
            const enabled = input.checked;
            try {
              await window.dictionaryAPI.setSourceEnabled(sourceName, enabled);
              // Sync from backend
              const updatedEnabled = await window.dictionaryAPI.getEnabledSources();
              input.checked = updatedEnabled.includes(sourceName);
            } catch (e) {
              console.error('Toggle update failed:', e);
              input.checked = !enabled; // revert local state on error
            }
          });
        });
      }
    }
  } catch (error) {
    console.error('Failed to load main source toggles:', error);
  }
}

// Setup audio settings
function setupAudioSettings() {
  const audioSpeedInput = document.getElementById('audio-speed') as HTMLInputElement;
  const speedValue = document.getElementById('speed-value');
  
  if (audioSpeedInput && speedValue) {
    audioSpeedInput.addEventListener('input', () => {
      speedValue.textContent = audioSpeedInput.value + 'x';
    });
  }
}

// Global functions for API key saving
(window as any).savePopupGoogleKey = async function() {
  const input = document.getElementById('popup-google-key') as HTMLInputElement;
  if (input?.value && window.dictionaryAPI) {
    await window.dictionaryAPI.setApiKey(input.value);
    showNotification('Google API key saved');
    input.value = '';
  }
};

(window as any).savePopupDeepLKey = async function() {
  const input = document.getElementById('popup-deepl-key') as HTMLInputElement;
  if (input?.value && window.dictionaryAPI) {
    await window.dictionaryAPI.setDeepLApiKey(input.value);
    showNotification('DeepL API key saved');
    input.value = '';
  }
};

// Global functions for clipboard operations
(window as any).copyClipboardText = async function(text: string) {
  if (window.clipboardAPI) {
    await window.clipboardAPI.copy(text);
    // Show feedback
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = 'Copied to clipboard!';
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2000);
  }
};

(window as any).removeClipboardEntry = async function(id: string) {
  if (window.clipboardAPI) {
    await window.clipboardAPI.removeEntry(id);
    // Remove from UI
    const item = document.querySelector(`[data-id="${id}"]`);
    item?.remove();
  }
};

// Global functions for dictionary actions
(window as any).copyToClipboard = async function(text: string) {
  if (window.clipboardAPI) {
    await window.clipboardAPI.copy(text);
    showNotification('Copied to clipboard!');
  }
};

(window as any).searchWikipedia = async function(term: string) {
  try {
    if (window.wikipediaAPI) {
      const result = await window.wikipediaAPI.search(term);
      showWikipediaResults(result);
    } else {
      // Fallback: open Wikipedia in browser
      window.open(`https://en.wikipedia.org/wiki/${encodeURIComponent(term)}`, '_blank');
    }
  } catch (error) {
    console.error('Wikipedia search failed:', error);
    showNotification('Wikipedia search failed');
  }
};

(window as any).searchWeb = async function(query: string) {
  try {
    if (window.searchAPI) {
      const result = await window.searchAPI.search(query);
      showSearchResults(result);
    } else {
      // Fallback: open Google search in browser
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
    }
  } catch (error) {
    console.error('Web search failed:', error);
    showNotification('Web search failed');
  }
};

/**
 * FIXED: Replaced placeholder audio function with the actual Web Speech API implementation.
 */
(window as any).playAudio = function(word: string, accent: string = 'en-US') {
  console.log(`🔊 Playing audio for "${word}" with ${accent} accent`);
  
  try {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(word);
      const languageMap: { [key: string]: string } = {
        'us': 'en-US', 'uk': 'en-GB', 'en-US': 'en-US', 'en-GB': 'en-GB',
        'zh': 'zh-CN', 'ja': 'ja-JP', 'ko': 'ko-KR', 'fr': 'fr-FR', 
        'de': 'de-DE', 'es': 'es-ES', 'it': 'it-IT', 'pt': 'pt-PT', 'ru': 'ru-RU'
      };
      utterance.lang = languageMap[accent] || 'en-US';
      utterance.rate = 1.0;

      // Find a suitable voice
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(voice => voice.lang === utterance.lang);
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      
      window.speechSynthesis.cancel(); // Cancel any previous speech
      window.speechSynthesis.speak(utterance);
      showNotification(`Playing pronunciation for "${word}"`);
    } else {
      showNotification('Audio playback is not supported by this browser.');
    }
  } catch (error) {
    console.error('Audio playback failed:', error);
    showNotification('Audio playback failed.');
  }
};

function showNotification(message: string) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 2000);
}

function showWikipediaResults(result: any) {
  const popup = document.createElement('div');
  popup.className = 'wikipedia-popup';
  popup.innerHTML = `
    <div class="popup-header">
      <h3>📚 Wikipedia Results for "${result.query}"</h3>
      <button onclick="this.parentElement.parentElement.remove()" class="close-btn">×</button>
    </div>
    <div class="popup-content">
      ${result.results.length === 0 ? 
        '<p class="empty-state">No Wikipedia articles found</p>' :
        result.results.map((article: any) => `
          <div class="wikipedia-item">
            <h4><a href="${article.url}" target="_blank">${article.title}</a></h4>
            <p>${article.extract}</p>
            <div class="article-meta">
              <span class="language">${article.language.toUpperCase()}</span>
              ${article.thumbnail ? `<img src="${article.thumbnail}" alt="Thumbnail" class="thumbnail">` : ''}
            </div>
          </div>
        `).join('')
      }
    </div>
  `;
  
  document.body.appendChild(popup);
  
  // Auto-remove on escape
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      popup.remove();
    }
  });
}

function showSearchResults(result: any) {
  const popup = document.createElement('div');
  popup.className = 'search-popup';
  popup.innerHTML = `
    <div class="popup-header">
      <h3>🔍 Search Results for "${result.query}"</h3>
      <button onclick="this.parentElement.parentElement.remove()" class="close-btn">×</button>
    </div>
    <div class="popup-content">
      ${result.results.length === 0 ? 
        '<p class="empty-state">No search results found</p>' :
        result.results.map((item: any) => `
          <div class="search-item">
            <h4><a href="${item.url}" target="_blank">${item.title}</a></h4>
            <p>${item.snippet}</p>
            <div class="search-meta">
              <span class="source">${item.source}</span>
            </div>
          </div>
        `).join('')
      }
    </div>
  `;
  
  document.body.appendChild(popup);
  
  // Auto-remove on escape
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      popup.remove();
    }
  });
}

// Initialize language selectors
async function initializeLanguageSelectors() {
  try {
    if (window.dictionaryAPI && typeof window.dictionaryAPI.getSupportedLanguages === 'function') {
      const languages = await window.dictionaryAPI.getSupportedLanguages();
      
      const sourceLangSelect = document.getElementById('source-lang') as HTMLSelectElement;
      const targetLangSelect = document.getElementById('target-lang') as HTMLSelectElement;
      
      if (sourceLangSelect && targetLangSelect) {
        // Clear existing options
        sourceLangSelect.innerHTML = '';
        targetLangSelect.innerHTML = '';
        
        // Add language options
        languages.forEach(lang => {
          const sourceOption = document.createElement('option');
          sourceOption.value = lang.code;
          sourceOption.textContent = `${lang.nativeName} (${lang.name})`;
          sourceLangSelect.appendChild(sourceOption);
          
          const targetOption = document.createElement('option');
          targetOption.value = lang.code;
          targetOption.textContent = `${lang.nativeName} (${lang.name})`;
          targetLangSelect.appendChild(targetOption);
        });
        
        // Set default values
        sourceLangSelect.value = 'auto';
        targetLangSelect.value = 'en';
        
        // Add swap languages functionality
        document.getElementById('swap-languages')?.addEventListener('click', () => {
          const sourceValue = sourceLangSelect.value;
          const targetValue = targetLangSelect.value;
          
          if (sourceValue !== 'auto') {
            sourceLangSelect.value = targetValue;
            targetLangSelect.value = sourceValue;
            
            // Re-lookup with swapped languages
            const text = document.getElementById('selected-text')?.textContent;
            if (text) {
              updatePopupContent(text);
            }
          }
        });
        
        sourceLangSelect.addEventListener('mousedown', (e) => e.stopPropagation());
        targetLangSelect.addEventListener('mousedown', (e) => e.stopPropagation());

        // When this container is clicked, stop the event from bubbling up
      const languageSelectorContainer = document.getElementById('language-controls');
      languageSelectorContainer.addEventListener('click', (event) => {
        event.stopPropagation(); 
      });
        sourceLangSelect.addEventListener('change', (e) => {
          console.log('🔄 [DEBUG] Source language changed:', (e.target as HTMLSelectElement).value);
          const text = document.getElementById('selected-text')?.textContent;
          if (text) {
            updatePopupContent(text);
          }
        });
        
        targetLangSelect.addEventListener('change', (e) => {
          console.log('🔄 [DEBUG] Target language changed:', (e.target as HTMLSelectElement).value);
          const text = document.getElementById('selected-text')?.textContent;
          if (text) {
            updatePopupContent(text);
          }
        });
        
        // Debug: Log initial dropdown setup
        console.log('🔄 [DEBUG] Language selectors initialized:', {
          sourceOptions: sourceLangSelect.options.length,
          targetOptions: targetLangSelect.options.length,
          sourceValue: sourceLangSelect.value,
          targetValue: targetLangSelect.value
        });
      }
    }
  } catch (error) {
    console.error('Failed to initialize language selectors:', error);
  }
}

// Tab management functions
function createTabs(result: any, enabledSourceNames?: string[]) {
  const tabNav = document.getElementById('tab-nav');
  const tabContent = document.getElementById('tab-content');
  
  if (!tabNav || !tabContent) return;
  
  // Clear existing tabs
  tabNav.innerHTML = '';
  tabContent.innerHTML = '';
  
  const hasTranslation = result.translations && result.translations.length > 0;
  if (hasTranslation) {
    // Main combined Translation tab (deduped by source/text)
    const tabId = 'translation';
    const button = document.createElement('button');
    button.className = `tab-button active`;
    button.dataset.tabId = tabId;
    button.innerHTML = `🌐 Translation`;
    button.addEventListener('click', () => switchTab(tabId));
    tabNav.appendChild(button);
    
    const pane = document.createElement('div');
    pane.className = `tab-pane active`;
    pane.id = `tab-${tabId}`;
    pane.innerHTML = createTranslationTab(result);
    tabContent.appendChild(pane);

    // Add per-translation-source tabs without duplicates (source+text)
    const seenKey = new Set<string>();
    const sourceOrder: string[] = [];
    (result.translations || []).forEach((t: any) => {
      const s = (t?.source || 'Translation').toString();
      const text = (t?.text || '').toString().trim();
      const key = `${s}|${text}`;
      if (!seenKey.has(key)) {
        seenKey.add(key);
        if (!sourceOrder.includes(s)) sourceOrder.push(s);
      }
    });
    sourceOrder.forEach((src: string) => {
      const id = `trans-${src.replace(/\s+/g, '-').toLowerCase()}`;
      const btn = document.createElement('button');
      btn.className = 'tab-button';
      btn.dataset.tabId = id;
      btn.innerHTML = `${getDictionaryIcon(src)} ${src}`;
      btn.addEventListener('click', () => switchTab(id));
      tabNav.appendChild(btn);
      const p = document.createElement('div');
      p.className = 'tab-pane';
      p.id = `tab-${id}`;
      p.innerHTML = createSingleTranslationSourceTab(result, src);
      tabContent.appendChild(p);
    });
  }
  
  // Create tabs for each unique dictionary source with data
  const definitions = result.definitions || [];
  const sourcesWithData = new Set((definitions.map((d: any) => d.source).filter((s: string) => s && s !== 'Sentence' && s !== 'Fallback')));
  // Merge in enabled sources, so users see a tab even when a source yields no results
  const enabledList: string[] = Array.isArray(enabledSourceNames) ? (enabledSourceNames as string[]) : [];
  const allSources: string[] = Array.from(new Set([...(enabledList), ...Array.from(sourcesWithData) as string[]]));
  
  allSources.forEach((source: string, index: number) => {
    const isActive = !hasTranslation && index === 0;
    const tabId = `dict-${source.replace(/\s+/g, '-').toLowerCase()}`;
    const button = document.createElement('button');
    button.className = `tab-button ${isActive ? 'active' : ''}`;
    button.dataset.tabId = tabId;
    button.innerHTML = `${getDictionaryIcon(source)} ${source}`;
    button.addEventListener('click', () => switchTab(tabId));
    tabNav.appendChild(button);
    
    const pane = document.createElement('div');
    pane.className = `tab-pane ${isActive ? 'active' : ''}`;
    pane.id = `tab-${tabId}`;
    pane.innerHTML = createDictionaryTab(result, source);
    tabContent.appendChild(pane);
  });
  
  // If no content, show a message
  if (!hasTranslation && allSources.length === 0) {
    tabContent.innerHTML = `<div class="no-data">No definitions or translations found for "${result.word}".</div>`;
  }
}

function switchTab(tabId: string) {
  // Update tab buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    const element = btn as HTMLElement;
    element.classList.toggle('active', element.dataset?.tabId === tabId);
  });
  
  // Update tab panes
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}`);
  });
}

function getDictionaryIcon(source: string): string {
  const icons: { [key: string]: string } = {
    'Free Dictionary API': '📖',
    'Wiktionary': '📝',
    'WordNet': '🔗',
    'Oxford Dictionary': '🎓',
    'Oxford Dictionary API': '🎓',
    'Collins Dictionary': '📙',
    'Collins Dictionary API': '📙',
    'Cambridge Dictionary': '🏛️',
    'Youdao API': '🇨🇳',
    'WordsAPI': '🧠',
    'CC-CEDICT': '📗',
    'General': '📚'
  };
  return icons[source] || '📚';
}

function createTranslationTab(result: any): string {
  const translations = result.translations || [];
  
  let html = `<div class="translation-tab">`;
  
  if (translations.length > 0) {
    html += `<div class="translation-results">`;
    translations.forEach((trans: any) => {
      html += `
        <div class="translation-item">
          <div class="translation-header">
            <span class="translation-language">${trans.language.toUpperCase()}</span>
            ${trans.source ? `<span class="translation-source">${trans.source}</span>` : ''}
            ${trans.confidence ? `<span class="confidence-score">${Math.round(trans.confidence * 100)}%</span>` : ''}
          </div>
          <div class="translation-text">${trans.text}</div>
          ${trans.pronunciation ? `<div class="translation-pronunciation">${trans.pronunciation}</div>` : ''}
        </div>
      `;
    });
    html += `</div>`;
  } else {
    html += `<div class="no-data">No online translation available. Please check your API keys and network connection.</div>`;
  }
  
  html += `</div>`;
  return html;
}

function createDictionaryTab(result: any, source: string): string {
  let html = `<div class="dictionary-tab">`;

  // Filter definitions by the specific source for this tab
  const sourceDefinitions = (result.definitions || []).filter((def: any) => def.source === source || source === 'General');

  
  // Word and pronunciation
  html += `
    <div class="word-header">
      <div class="word-title">${result.word}</div>
      ${result.pronunciation ? `<div class="pronunciation">/${result.pronunciation}/</div>` : ''}
    </div>
  `;
  
  // Definitions
  if (sourceDefinitions && sourceDefinitions.length > 0) {
    html += `<div class="definitions-section">`;
    sourceDefinitions.forEach((def: any) => {
      html += `
        <div class="definition-item">
          <div class="part-of-speech">${def.partOfSpeech}</div>
          <div class="definition-text">${def.meaning}</div>
          ${def.examples && def.examples.length > 0 ? 
            `<div class="definition-examples">${def.examples.map((ex: string) => `<div class=\"example\">"${ex}"</div>`).join('')}</div>` : ''}
          ${def.examples && def.examples.length > 0 ? 
            `<div class="definition-examples">
              ${def.examples.map((ex: string) => `<div class="example">"${ex}"</div>`).join('')}
            </div>` : ''}
          ${def.synonyms && def.synonyms.length > 0 ? 
            `<div class="synonyms">Synonyms: ${def.synonyms.join(', ')}</div>` : ''}
        </div>
      `;
    });
    html += `</div>`;
  } else {
    html += `<div class="no-data">No results from ${source} for this term.</div>`;
  }
  
  // Examples
  if (result.examples && result.examples.length > 0) {
    html += `
      <div class="examples-section">
        <h4>Examples</h4>
        ${result.examples.map((ex: string) => `<div class="example">"${ex}"</div>`).join('')}
      </div>
    `;
  }
  
  // Etymology
  if (result.etymology) {
    html += `
      <div class="etymology-section">
        <h4>Etymology</h4>
        <div class="etymology-text">${result.etymology}</div>
      </div>
    `;
  }
  
  // Synonyms and Antonyms
  if (result.synonyms && result.synonyms.length > 0) {
    html += `
      <div class="synonyms-section">
        <h4>Synonyms</h4>
        <div class="word-list">${result.synonyms.join(', ')}</div>
      </div>
    `;
  }
  
  if (result.antonyms && result.antonyms.length > 0) {
    html += `
      <div class="antonyms-section">
        <h4>Antonyms</h4>
        <div class="word-list">${result.antonyms.join(', ')}</div>
      </div>
    `;
  }
  
  html += `</div>`;
  return html;
}

// Render translations for a specific source as its own tab
function createSingleTranslationSourceTab(result: any, sourceName: string): string {
  // Deduplicate by text for this source
  const seen = new Set<string>();
  const translations = (result.translations || []).filter((t: any) => {
    const match = (t?.source || '') === sourceName;
    if (!match) return false;
    const key = (t?.text || '').toString().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (translations.length === 0) {
    return `<div class="translation-tab"><div class="no-data">No translations from ${sourceName}.</div></div>`;
  }
  let html = `<div class="translation-tab">`;
  html += `<div class="translation-results">`;
  translations.forEach((trans: any) => {
    html += `
      <div class="translation-item">
        <div class="translation-header">
          <span class="translation-language">${(trans.language || '').toString().toUpperCase()}</span>
          ${trans.source ? `<span class="translation-source">${trans.source}</span>` : ''}
          ${trans.confidence ? `<span class="confidence-score">${Math.round(trans.confidence * 100)}%</span>` : ''}
        </div>
        <div class="translation-text">${trans.text || ''}</div>
        ${trans.pronunciation ? `<div class="translation-pronunciation">${trans.pronunciation}</div>` : ''}
      </div>
    `;
  });
  html += `</div>`;
  html += `</div>`;
  return html;
}

async function updatePopupContent(text: string) {
  console.log('[POPUP-RENDERER] updatePopupContent with text:', (text||'').slice(0,80), `(${text.length} chars)`);
  const key = (text || '').trim();
  if (!key) return;
  if (key === __lastRenderedText) {
    console.log('[POPUP-RENDERER] skip duplicate render for same text');
    return;
  }
  __lastRenderedText = key;
  
  const selectedTextElement = document.getElementById('selected-text');
  const loadingElement = document.getElementById('loadingElement');
  const tabContainer = document.getElementById('tab-container');
  const languageControls = document.getElementById('language-controls');
  const titleSubtitle = document.getElementById('title-subtitle');
  
  if (selectedTextElement) {
    selectedTextElement.textContent = text;
  }
  
  // Show loading and ensure the toolbar/content are visible
  if (loadingElement) loadingElement.style.display = 'flex';
  if (tabContainer) tabContainer.style.display = 'flex';
  
  try {
    // Get selected languages
    const sourceLang = (document.getElementById('source-lang') as HTMLSelectElement)?.value || 'auto';
    const targetLang = (document.getElementById('target-lang') as HTMLSelectElement)?.value || 'en';
    
    // Get enabled sources
    let enabledSources: string[] | undefined;
    if (window.dictionaryAPI && typeof window.dictionaryAPI.getEnabledSources === 'function') {
      enabledSources = await window.dictionaryAPI.getEnabledSources();
      console.log('[DBG] Enabled sources at lookup time:', enabledSources);
    }
    
    // Use the dictionary service to get real results
    if (window.dictionaryAPI && typeof window.dictionaryAPI.lookup === 'function') {
      const result = await window.dictionaryAPI.lookup(text, targetLang, enabledSources);
      console.log('[POPUP-RENDERER] lookup summary:', {
        word: result.word,
        definitions: result.definitions?.length || 0,
        sources: result.sources,
        hasTranslations: (result.translations?.length || 0) > 0
      });
      
      // Update UI based on whether it's a sentence or word
      const isSentence = result.metadata?.isSentence || false;
      
      if (isSentence) {
        // Show language controls for sentences
        if (languageControls) languageControls.style.display = 'block';
        if (titleSubtitle) titleSubtitle.textContent = 'Translation';
        
        // Update language selectors based on detected language
        if (result.detectedLanguage && sourceLang === 'auto') {
          const sourceLangSelect = document.getElementById('source-lang') as HTMLSelectElement;
          if (sourceLangSelect) {
            sourceLangSelect.value = result.detectedLanguage;
          }
        }
      } else {
        // Hide language controls for words
        if (languageControls) languageControls.style.display = 'none';
        if (titleSubtitle) titleSubtitle.textContent = 'Dictionary Lookup';
      }
      
      // Hide loading and create tabs
      if (loadingElement) loadingElement.style.display = 'none';
      if (tabContainer) tabContainer.style.display = 'flex';
      
      // Prefer runtime result.sources so tabs reflect APIs actually used
      const tabSources = Array.isArray(result.sources) && result.sources.length > 0 ? result.sources : (enabledSources || []);
      console.log('[POPUP-RENDERER] creating tabs for:', tabSources);
      createTabs(result, tabSources);

      // Ask main to resize the window once per text to prevent jumping
      try {
        if (__lastResizedForText !== key) {
          const desiredW = 420;
          const desiredH = 260;
          window.electronAPI?.resizeWindow(desiredW, desiredH);
          __lastResizedForText = key;
          console.log('[POPUP-RENDERER] requested one-time resize:', desiredW, desiredH);
        }
      } catch {}
    } else {
      console.log('⚠️ Dictionary API not available, using mock data');
      displayMockResult(text);
    }
  } catch (error) {
    console.error('❌ Dictionary lookup failed:', error);
    displayMockResult(text);
  }
}

function displayDictionaryResult(result: any) {
  const resultsElement = document.getElementById('dictionary-results');
  const loadingElement = document.getElementById('loadingElement');
  
  if (loadingElement) {
    loadingElement.style.display = 'none';
  }
  
  if (resultsElement) {
    resultsElement.style.display = 'block';
    
    // Generate pronunciation HTML
    const pronunciationHtml = result.pronunciation ? `
      <div class="pronunciation">
        <div class="pronunciation-item">
          <span>🇺🇸 /${result.pronunciation}/</span>
        </div>
        <div class="pronunciation-item">
          <span>🇬🇧 /${result.pronunciation}/</span>
        </div>
      </div>
    ` : '';
    
    // Generate definitions HTML with better fallback data
    const definitionsHtml = result.definitions && result.definitions.length > 0 ? 
      result.definitions.map((def: any) => `
        <div class="definition">
          <strong>${def.partOfSpeech}</strong> - ${def.meaning}
          ${def.synonyms && def.synonyms.length > 0 ? 
            `<div class="synonyms">Synonyms: ${def.synonyms.join(', ')}</div>` : ''}
          ${def.antonyms && def.antonyms.length > 0 ? 
            `<div class="antonyms">Antonyms: ${def.antonyms.join(', ')}</div>` : ''}
          ${def.examples && def.examples.length > 0 ? 
            def.examples.map((ex: string) => `<div class="example"><em>"${ex}"</em></div>`).join('') : ''}
        </div>
      `).join('') : getFallbackDefinitions(result.word);
    
    // Generate translations HTML
    const translationsHtml = result.translations && result.translations.length > 0 ? 
      result.translations.map((trans: any) => `
        <div class="translation">
          <strong>${trans.language.toUpperCase()}:</strong> ${trans.text}
          ${trans.pronunciation ? `<div class="pronunciation">${trans.pronunciation}</div>` : ''}
          ${trans.confidence ? `<div class="confidence">Confidence: ${Math.round(trans.confidence * 100)}%</div>` : ''}
          ${trans.source ? `<div class="source">Source: ${trans.source}</div>` : ''}
        </div>
      `).join('') : getFallbackTranslations(result.word);
    
    // Generate examples HTML
    const examplesHtml = result.examples && result.examples.length > 0 ? 
      result.examples.map((example: string) => `
        <div class="example">
          <em>"${example}"</em>
        </div>
      `).join('') : getFallbackExamples(result.word);
    
    // Generate synonyms HTML
    const synonymsHtml = result.synonyms && result.synonyms.length > 0 ? `
      <div class="synonyms-section">
        <strong>Synonyms:</strong> ${result.synonyms.join(', ')}
      </div>
    ` : '';
    
    // Generate antonyms HTML
    const antonymsHtml = result.antonyms && result.antonyms.length > 0 ? `
      <div class="antonyms-section">
        <strong>Antonyms:</strong> ${result.antonyms.join(', ')}
      </div>
    ` : '';
    
    // Generate etymology HTML
    const etymologyHtml = result.etymology ? `
      <div class="etymology">
        <strong>Etymology:</strong> ${result.etymology}
      </div>
    ` : '';
    
    // Generate sources HTML
    const sourcesHtml = result.sources && result.sources.length > 0 ? `
      <div class="sources-section">
        <strong>Data Sources:</strong> ${result.sources.join(', ')}
      </div>
    ` : '';
    
    // Generate word origin HTML (fallback)
    const wordOriginHtml = !result.etymology ? getWordOrigin(result.word) : '';
    
    resultsElement.innerHTML = `
      <div class="dictionary-entry">
        <div class="word">${result.word}</div>
        ${pronunciationHtml}
        ${etymologyHtml}
        ${wordOriginHtml}
        <div class="definitions">
          ${definitionsHtml}
        </div>
        ${synonymsHtml}
        ${antonymsHtml}
        <div class="translations">
          ${translationsHtml}
        </div>
        <div class="examples">
          ${examplesHtml}
        </div>
        ${sourcesHtml}
      </div>
    `;
  }
}

// Helper function to generate realistic pronunciation
function getPronunciation(word: string): string {
  const pronunciations: { [key: string]: string } = {
    'hello': 'həˈloʊ',
    'world': 'wɜːld',
    'computer': 'kəmˈpjuːtər',
    'dictionary': 'ˈdɪkʃəneri',
    'translation': 'trænsˈleɪʃən',
    'language': 'ˈlæŋɡwɪdʒ',
    'share': 'ʃer',
    'need': 'niːd',
    'outcry': 'ˈaʊtkraɪ',
    'google': 'ˈɡuːɡəl',
    'wallet': 'ˈwɒlɪt',
    'battery': 'ˈbætəri',
    'screen': 'skriːn',
    'refresh': 'rɪˈfreʃ',
    'example': 'ɪɡˈzæmpəl',
    'correct': 'kəˈrekt',
    'incorrect': 'ˌɪnkəˈrekt',
    'hours': 'ˈaʊəz',
    'novel': 'ˈnɒvəl',
    'reading': 'ˈriːdɪŋ'
  };
  
  const lowerWord = word.toLowerCase();
  return pronunciations[lowerWord] || `${lowerWord.replace(/[aeiou]/g, 'ə')}`;
}

// Helper function to generate word origin
function getWordOrigin(word: string): string {
  const origins: { [key: string]: string } = {
    'hello': 'From Old English "hāl" (healthy, whole) + "ēalā" (oh, lo). Originally a greeting wishing good health.',
    'world': 'From Old English "weorold" (age of man, human existence), from "wer" (man) + "eald" (age).',
    'computer': 'From Latin "computare" (to calculate), from "com-" (together) + "putare" (to think, reckon).',
    'dictionary': 'From Medieval Latin "dictionarium" (collection of words), from "dictio" (speaking, word).',
    'translation': 'From Latin "translatio" (carrying across), from "trans-" (across) + "latus" (carried).',
    'language': 'From Old French "langage" (speech, language), from Latin "lingua" (tongue, language).',
    'share': 'From Old English "scearu" (cutting, division), related to "sceran" (to cut, shear).',
    'need': 'From Old English "nēod" (necessity, compulsion), from Proto-Germanic "*naudiz".',
    'outcry': 'From Middle English "outcrien" (to cry out), from "out" + "cry".',
    'google': 'Coined in 1998, from "googol" (mathematical term for 10^100), suggesting vast amounts of information.',
    'wallet': 'From Middle English "walet" (bag, sack), from Old French "walet" (bag, sack).',
    'battery': 'From Old French "baterie" (action of beating), from "batre" (to beat), originally referring to artillery.',
    'screen': 'From Middle English "screne" (protective barrier), from Old French "escren" (screen, shield).',
    'refresh': 'From Old French "refreschir" (to refresh), from "re-" (again) + "fresche" (fresh).',
    'example': 'From Latin "exemplum" (sample, pattern), from "eximere" (to take out, remove).',
    'correct': 'From Latin "correctus" (corrected), from "corrigere" (to make straight, correct).',
    'incorrect': 'From Latin "incorrectus" (not corrected), from "in-" (not) + "correctus".',
    'hours': 'From Old French "hore" (hour), from Latin "hora" (hour, time).',
    'novel': 'From Italian "novella" (new, fresh), from Latin "novellus" (new, young).',
    'reading': 'From Old English "ræding" (reading), from "rædan" (to read, advise).'
  };
  
  const lowerWord = word.toLowerCase();
  return origins[lowerWord] ? `
    <div class="word-origin">
      <strong>Origin:</strong> ${origins[lowerWord]}
    </div>
  ` : '';
}

// Audio playback function using Web Speech API
function playAudio(word: string, accent: string = 'en-US') {
  console.log(`🔊 [DEBUG] playAudio called with word: "${word}", accent: "${accent}"`);
  console.log(`🔊 [DEBUG] speechSynthesis available:`, 'speechSynthesis' in window);
  
  try {
    // Check if Web Speech API is supported
    if ('speechSynthesis' in window) {
      const initVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          console.log(`🔊 [DEBUG] Voices loaded: ${voices.length}`);
          speak(word, accent, voices);
        } else {
          console.log(`🔊 [DEBUG] Voices not loaded yet, will try again`);
        }
      };

      if (window.speechSynthesis.getVoices().length > 0) {
        initVoices();
      } else {
        window.speechSynthesis.onvoiceschanged = initVoices;
      }
    } else {
      // Fallback for browsers without Web Speech API
      console.warn('🔊 Web Speech API not supported');
      showNotification('Audio not supported in this browser');
      tryAlternativeAudio(word, accent);
    }
  } catch (error) {
    console.error('🔊 Audio playback error:', error);
    showNotification('Audio playback failed');
  }
}

function speak(word: string, accent: string, voices: SpeechSynthesisVoice[]) {
  console.log(`🔊 [DEBUG] speak called with word: "${word}", accent: "${accent}"`);
  
  try {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    console.log(`🔊 [DEBUG] Previous speech cancelled`);
    
    // Create speech utterance
    const utterance = new SpeechSynthesisUtterance(word);
    
    // Set language based on accent
    const languageMap: { [key: string]: string } = {
      'us': 'en-US', 'uk': 'en-GB', 'en-US': 'en-US', 'en-GB': 'en-GB',
      'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'ja': 'ja-JP', 'ko': 'ko-KR',
      'fr': 'fr-FR', 'de': 'de-DE', 'es': 'es-ES', 'it': 'it-IT',
      'pt': 'pt-PT', 'ru': 'ru-RU', 'ar': 'ar-SA'
    };
    utterance.lang = languageMap[accent] || 'en-US';
    
    // Get speech settings
    const enableAudio = (document.getElementById('enable-audio') as HTMLInputElement)?.checked ?? true;
    const audioSpeed = parseFloat((document.getElementById('audio-speed') as HTMLInputElement)?.value || '1');
    
    if (!enableAudio) {
      showNotification('Audio is disabled in settings');
      return;
    }
    
    utterance.rate = audioSpeed;
    
    // Find a suitable voice
    const preferredVoice = voices.find(voice => voice.lang === utterance.lang || voice.lang.startsWith(utterance.lang.split('-')[0]));
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
    
    // Event handlers
    utterance.onstart = () => showNotification(`🔊 Playing pronunciation: "${word}"`);
    utterance.onerror = (event) => showNotification(`Audio error: ${event.error}`);
    
    // Speak the word
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error('🔊 Speech synthesis error:', error);
    showNotification('Speech synthesis failed');
  }
}

// Alternative audio implementation
function tryAlternativeAudio(word: string, accent: string) {
  try {
    // Google Translate TTS as fallback (note: this may have limitations)
    const languageCode = accent === 'us' ? 'en' : accent.split('-')[0];
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=${languageCode}&client=tw-ob`;
    
    const audio = new Audio(ttsUrl);
    audio.crossOrigin = 'anonymous';
    
    audio.onloadstart = () => {
      showNotification(`🔊 Loading pronunciation: "${word}"`);
    };
    
    audio.oncanplay = () => {
      audio.play().catch(error => {
        console.error('🔊 Alternative audio failed:', error);
        showNotification('Audio playback failed - check network connection');
      });
    };
    
    audio.onerror = () => {
      console.error('🔊 Alternative audio error');
      showNotification('Audio not available for this word');
    };
    
  } catch (error) {
    console.error('🔊 Alternative audio implementation failed:', error);
  }
}



function displayMockResult(text: string) {
  const resultsElement = document.getElementById('dictionary-results');
  const loadingElement = document.getElementById('loadingElement');
  
  if (loadingElement) {
    (loadingElement as HTMLElement).style.display = 'none';
  }
  
  if (resultsElement) {
    (resultsElement as HTMLElement).style.display = 'block';
    resultsElement.innerHTML = `
      <div class="dictionary-entry">
        <div class="word">${text}</div>
        <div class="pronunciation">/həˈloʊ/</div>
        <div class="definition">
          <strong>interjection</strong> - Used as a greeting or to begin a phone conversation.
        </div>
        <div class="example">
          <em>"Hello, how are you today?"</em>
        </div>
        <div class="translation">
          <strong>Chinese:</strong> 你好 (nǐ hǎo)
        </div>
        <div class="actions">
          <button onclick="copyToClipboard('${text}')" class="btn btn-small">Copy</button>
          <button onclick="searchWikipedia('${text}')" class="btn btn-small">Wikipedia</button>
          <button onclick="searchWeb('${text}')" class="btn btn-small">Web Search</button>
        </div>
      </div>
    `;
  }
}

function displayErrorResult(text: string, error: any) {
  const resultsElement = document.getElementById('dictionary-results');
  const loadingElement = document.getElementById('loadingElement');
  
  if (loadingElement) {
    (loadingElement as HTMLElement).style.display = 'none';
  }
  
  if (resultsElement) {
    (resultsElement as HTMLElement).style.display = 'block';
    resultsElement.innerHTML = `
      <div class="dictionary-entry error">
        <div class="word">${text}</div>
        <div class="error-message">
          Failed to load dictionary results. Please try again.
        </div>
        <div class="actions">
          <button onclick="copyToClipboard('${text}')" class="btn btn-small">Copy</button>
          <button onclick="searchWikipedia('${text}')" class="btn btn-small">Wikipedia</button>
          <button onclick="searchWeb('${text}')" class="btn btn-small">Web Search</button>
        </div>
      </div>
    `;
  }
}

// Settings helper functions
async function refreshCacheStats() {
  const cacheStatsElement = document.getElementById('cache-stats');
  if (!cacheStatsElement) return;

  try {
    const dictStats = window.dictionaryAPI ? await window.dictionaryAPI.getCacheStats() : { size: 0, entries: [] };
    const wikiStats = window.wikipediaAPI ? await window.wikipediaAPI.getCacheStats() : { size: 0, entries: [] };
    const searchStats = window.searchAPI ? await window.searchAPI.getCacheStats() : { size: 0, entries: [] };
    
    const totalSize = dictStats.size + wikiStats.size + searchStats.size;
    
    cacheStatsElement.innerHTML = `
      <div class="cache-stat-item">
        <strong>Total cached items:</strong> ${totalSize}
      </div>
      <div class="cache-stat-item">
        <strong>Dictionary cache:</strong> ${dictStats.size} items
      </div>
      <div class="cache-stat-item">
        <strong>Wikipedia cache:</strong> ${wikiStats.size} items
      </div>
      <div class="cache-stat-item">
        <strong>Search cache:</strong> ${searchStats.size} items
      </div>
    `;
  } catch (error) {
    cacheStatsElement.innerHTML = '<p class="error">Failed to load cache statistics</p>';
  }
}

async function clearAllCaches() {
  if (confirm('Are you sure you want to clear all caches? This will remove all cached dictionary, Wikipedia, and search results.')) {
    try {
      if (window.dictionaryAPI) await window.dictionaryAPI.clearCache();
      if (window.wikipediaAPI) await window.wikipediaAPI.clearCache();
      if (window.searchAPI) await window.searchAPI.clearCache();
      
      showNotification('All caches cleared successfully');
      refreshCacheStats();
    } catch (error) {
      showNotification('Failed to clear caches');
    }
  }
}

// Global functions for settings
(window as any).saveGoogleApiKey = async function() {
  const apiKeyInput = document.getElementById('google-api-key') as HTMLInputElement;
  const apiKey = apiKeyInput?.value.trim();
  
  if (!apiKey) {
    showNotification('Please enter an API key');
    return;
  }
  
  try {
    if (window.dictionaryAPI) {
      await window.dictionaryAPI.setApiKey(apiKey);
      showNotification('Google API key saved successfully');
    }
  } catch (error) {
    showNotification('Failed to save Google API key');
  }
};

(window as any).saveDeepLApiKey = async function() {
  const apiKeyInput = document.getElementById('deepl-api-key') as HTMLInputElement;
  const apiKey = apiKeyInput?.value.trim();

  if (!apiKey) {
    showNotification('Please enter an API key');
    return;
  }

  try {
    if (window.dictionaryAPI) {
      await window.dictionaryAPI.setDeepLApiKey(apiKey);
      showNotification('DeepL API key saved successfully');
    }
  } catch (error) {
    showNotification('Failed to save DeepL API key');
  }
};

// Test function for multi-source dictionary
(window as any).testMultiSourceDictionary = async function() {
  try {
    console.log('🧪 Testing multi-source dictionary service...');
    
    // Test with a common word
    const testWord = 'hello';
    const result = await window.dictionaryAPI?.lookup(testWord, 'zh');
    
    console.log('✅ Multi-source dictionary test result:', result);
    
    if (result) {
      showNotification(`✅ Multi-source lookup successful! Sources: ${result.sources?.join(', ') || 'None'}`);
      
      // Display the result in a test popup
      const popup = document.createElement('div');
      popup.className = 'test-popup';
      popup.innerHTML = `
        <div class="popup-header">
          <h3>🧪 Multi-Source Test Result</h3>
          <button onclick="this.parentElement.parentElement.remove()" class="close-btn">×</button>
        </div>
        <div class="popup-content">
          <p><strong>Word:</strong> ${result.word}</p>
          <p><strong>Pronunciation:</strong> ${result.pronunciation || 'N/A'}</p>
          <p><strong>Definitions:</strong> ${result.definitions?.length || 0}</p>
          <p><strong>Translations:</strong> ${result.translations?.length || 0}</p>
          <p><strong>Examples:</strong> ${result.examples?.length || 0}</p>
          <p><strong>Synonyms:</strong> ${result.synonyms?.length || 0}</p>
          <p><strong>Sources:</strong> ${result.sources?.join(', ') || 'None'}</p>
        </div>
      `;
      
      document.body.appendChild(popup);
      
      // Auto-remove after 10 seconds
      setTimeout(() => {
        if (popup.parentElement) {
          popup.remove();
        }
      }, 10000);
    }
    
  } catch (error) {
    console.error('❌ Multi-source dictionary test failed:', error);
    showNotification('❌ Multi-source dictionary test failed');
  }
};

(window as any).refreshSourceStats = async function() {
  const sourceStatsElement = document.getElementById('source-stats');
  if (!sourceStatsElement) return;

  try {
    const sourceStats = window.dictionaryAPI ? await window.dictionaryAPI.getSourceStats() : { total: 0, available: 0, sources: [] };

    sourceStatsElement.innerHTML = `
      <div class="source-stat-item">
        <strong>Total Sources:</strong> ${sourceStats.total}
      </div>
      <div class="source-stat-item">
        <strong>Available Sources:</strong> ${sourceStats.available}
      </div>
      <div class="source-stat-item">
        <strong>Sources:</strong> ${sourceStats.sources.map(s => `${s.name} (${s.isAvailable ? '✅' : '❌'})`).join(', ')}
      </div>
    `;
  } catch (error) {
    sourceStatsElement.innerHTML = '<p class="error">Failed to load source statistics</p>';
  }
};

(window as any).clearAllCaches = clearAllCaches;
(window as any).refreshCacheStats = refreshCacheStats;

// Helper function to generate fallback definitions
function getFallbackDefinitions(word: string): string {
  const fallbackDefs: { [key: string]: string[] } = {
    'hello': ['Used as a greeting or to begin a phone conversation', 'An expression of greeting'],
    'world': ['The earth, together with all of its countries, peoples, and natural features', 'All of the people and societies on the earth'],
    'computer': ['An electronic device for storing and processing data', 'A machine that can be programmed to carry out sequences of arithmetic or logical operations'],
    'dictionary': ['A book or electronic resource that lists the words of a language', 'A reference book containing words and their meanings'],
    'translation': ['The process of translating words or text from one language into another', 'A written or spoken rendering of the meaning of a word or text'],
    'language': ['The method of human communication, either spoken or written', 'A system of communication used by a particular country or community'],
    'share': ['To have or use something at the same time as someone else', 'To give a portion of something to others'],
    'need': ['To require something because it is essential or very important', 'A situation in which something is necessary'],
    'were': ['Past tense of "be" for plural subjects', 'Used to indicate a state or condition in the past'],
    'empty': ['Containing nothing; not filled or occupied', 'Having no meaning or value'],
    '24': ['The number twenty-four', 'A quantity or amount'],
    '01': ['The number one', 'A quantity or amount']
  };
  
  const lowerWord = word.toLowerCase();
  const definitions = fallbackDefs[lowerWord] || ['A word or term that may have various meanings depending on context'];
  
  return definitions.map(def => `
    <div class="definition">
      <strong>definition</strong> - ${def}
    </div>
  `).join('');
}

// Helper function to generate fallback translations
function getFallbackTranslations(word: string): string {
  const fallbackTrans: { [key: string]: string } = {
    'hello': '你好 (nǐ hǎo)',
    'world': '世界 (shì jiè)',
    'computer': '计算机 (jì suàn jī)',
    'dictionary': '词典 (cí diǎn)',
    'translation': '翻译 (fān yì)',
    'language': '语言 (yǔ yán)',
    'share': '分享 (fēn xiǎng)',
    'need': '需要 (xū yào)',
    'were': '是 (shì) - 过去时',
    'empty': '空的 (kōng de)',
    '24': '二十四 (èr shí sì)',
    '01': '零一 (líng yī)'
  };
  
  const lowerWord = word.toLowerCase();
  const translation = fallbackTrans[lowerWord] || '翻译不可用 (Translation not available)';
  
  return `
    <div class="translation">
      <strong>CHINESE:</strong> ${translation}
    </div>
  `;
}

// Helper function to generate fallback examples
function getFallbackExamples(word: string): string {
  const fallbackEx: { [key: string]: string[] } = {
    'hello': ['Hello, how are you today?', 'She said hello to everyone in the room.'],
    'world': ['The world is a beautiful place.', 'He traveled around the world.'],
    'computer': ['I use my computer every day.', 'The computer crashed and I lost my work.'],
    'dictionary': ['I looked up the word in the dictionary.', 'This dictionary has over 50,000 entries.'],
    'translation': ['The translation was very accurate.', 'She works as a translator.'],
    'language': ['English is a global language.', 'Learning a new language takes time.'],
    'share': ['Let\'s share the pizza.', 'She likes to share her knowledge with others.'],
    'need': ['I need to finish this work.', 'There is a need for more teachers.'],
    'were': ['They were happy to see us.', 'The books were on the table.'],
    'empty': ['The room was empty.', 'The glass is empty.'],
    '24': ['There are 24 hours in a day.', 'The store is open 24 hours.'],
    '01': ['The code starts with 01.', 'It\'s 01:00 in the morning.']
  };
  
  const lowerWord = word.toLowerCase();
  const examples = fallbackEx[lowerWord] || ['Example usage not available.'];
  
  return examples.map(ex => `
    <div class="example">
      <em>"${ex}"</em>
    </div>
  `).join('');
}

let popupTimeout: NodeJS.Timeout | null = null;
let isPopupFocused = false;

function showPopup(x: number, y: number, text: string) {
  // Clear any existing timeout
  if (popupTimeout) {
    clearTimeout(popupTimeout);
    popupTimeout = null;
  }

  // Remove existing popup
  const existingPopup = document.getElementById('popup');
  if (existingPopup) {
    existingPopup.remove();
  }

  // Create new popup
  const popup = document.createElement('div');
  popup.id = 'popup';
  popup.className = 'popup';
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  
  // Add focus/blur event listeners
  popup.addEventListener('mouseenter', () => {
    isPopupFocused = true;
    if (popupTimeout) {
      clearTimeout(popupTimeout);
      popupTimeout = null;
    }
  });
  
  popup.addEventListener('mouseleave', () => {
    isPopupFocused = false;
    // Start timeout when mouse leaves (but don't close immediately)
    startPopupTimeout();
  });

  // Add click event to prevent closing when clicking inside
  popup.addEventListener('click', (e) => {
    e.stopPropagation();
    isPopupFocused = true;
    if (popupTimeout) {
      clearTimeout(popupTimeout);
      popupTimeout = null;
    }
  });

  // Add focus event for keyboard navigation
  popup.addEventListener('focus', () => {
    isPopupFocused = true;
    if (popupTimeout) {
      clearTimeout(popupTimeout);
      popupTimeout = null;
    }
  });

  popup.addEventListener('blur', () => {
    isPopupFocused = false;
    startPopupTimeout();
  });

  // Make popup focusable
  popup.tabIndex = 0;

  // Show loading state
  popup.innerHTML = `
    <div class="popup-content">
      <div class="loading">
        <div class="spinner"></div>
        <div>Looking up "${text}"...</div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  // Start the lookup
  performLookup(text, popup);
}

async function performLookup(text: string, popup: HTMLElement) {
  try {
    console.log('🔍 Performing lookup for:', text);
    
    // Use the dictionary service to get real results
    if (window.dictionaryAPI && typeof window.dictionaryAPI.lookup === 'function') {
      const result = await window.dictionaryAPI.lookup(text);
      console.log('✅ Dictionary result received:', result);
      
      // Update popup content with results
      displayDictionaryResultInPopup(result, popup);
    } else {
      console.log('⚠️ Dictionary API not available, using mock data');
      // Fallback to mock data
      displayMockResultInPopup(text, popup);
    }
  } catch (error) {
    console.error('❌ Dictionary lookup failed:', error);
    // Always fallback to mock data on error
    displayErrorResultInPopup(text, error, popup);
  }
}

function displayDictionaryResultInPopup(result: any, popup: HTMLElement) {
  // Generate pronunciation HTML
  const pronunciationHtml = result.pronunciation ? `
    <div class="pronunciation">
      <div class="pronunciation-item">
        <span>🇺🇸 /${result.pronunciation}/</span>
      </div>
      <div class="pronunciation-item">
        <span>🇬🇧 /${result.pronunciation}/</span>
      </div>
    </div>
  ` : '';
  
  // Generate definitions HTML (deduped by meaning+POS+source)
  const defSeen = new Set<string>();
  const definitionsHtml = result.definitions && result.definitions.length > 0 ? 
    result.definitions.filter((def: any) => {
      const key = `${(def.partOfSpeech||'').toLowerCase()}|${(def.meaning||'').trim().toLowerCase()}|${(def.source||'').toLowerCase()}`;
      if (defSeen.has(key)) return false;
      defSeen.add(key);
      return true;
    }).map((def: any) => `
      <div class="definition">
        <strong>${def.partOfSpeech}</strong> - ${def.meaning}
        ${def.synonyms && def.synonyms.length > 0 ? 
          `<div class="synonyms">Synonyms: ${def.synonyms.join(', ')}</div>` : ''}
        ${def.antonyms && def.antonyms.length > 0 ? 
          `<div class="antonyms">Antonyms: ${def.antonyms.join(', ')}</div>` : ''}
        ${def.examples && def.examples.length > 0 ? 
          def.examples.map((ex: string) => `<div class="example"><em>"${ex}"</em></div>`).join('') : ''}
      </div>
    `).join('') : getFallbackDefinitions(result.word);
  
  // Generate translations HTML (dedupe by source+text)
  const tSeen = new Set<string>();
  const translationsHtml = result.translations && result.translations.length > 0 ? 
    result.translations.filter((trans: any) => {
      const key = `${(trans.source||'').toString().toLowerCase()}|${(trans.text||'').toString().trim()}`;
      if (tSeen.has(key)) return false;
      tSeen.add(key);
      return true;
    }).map((trans: any) => `
      <div class="translation">
        <strong>${trans.language.toUpperCase()}:</strong> ${trans.text}
        ${trans.pronunciation ? `<div class="pronunciation">${trans.pronunciation}</div>` : ''}
        ${trans.confidence ? `<div class="confidence">Confidence: ${Math.round(trans.confidence * 100)}%</div>` : ''}
        ${trans.source ? `<div class="source">Source: ${trans.source}</div>` : ''}
      </div>
    `).join('') : getFallbackTranslations(result.word);
  
  // Generate examples HTML (normalize/dedupe)
  const eSeen = new Set<string>();
  const examplesHtml = result.examples && result.examples.length > 0 ? 
    result.examples.map((example: string) => {
      const n = (example || '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/^"|"$/g, '')
        .trim();
      if (!n || eSeen.has(n)) return '';
      eSeen.add(n);
      return `
      <div class="example">
        <em>"${n}"</em>
      </div>
    `;}).join('') : getFallbackExamples(result.word);
  
  // Generate synonyms HTML
  const synonymsHtml = result.synonyms && result.synonyms.length > 0 ? `
    <div class="synonyms-section">
      <strong>Synonyms:</strong> ${result.synonyms.join(', ')}
    </div>
  ` : '';
  
  // Generate antonyms HTML
  const antonymsHtml = result.antonyms && result.antonyms.length > 0 ? `
    <div class="antonyms-section">
      <strong>Antonyms:</strong> ${result.antonyms.join(', ')}
    </div>
  ` : '';
  
  // Generate etymology HTML
  const etymologyHtml = result.etymology ? `
    <div class="etymology">
      <strong>Etymology:</strong> ${result.etymology}
    </div>
  ` : '';
  
  // Generate sources HTML
  const sourcesHtml = result.sources && result.sources.length > 0 ? `
    <div class="sources-section">
      <strong>Data Sources:</strong> ${result.sources.join(', ')}
    </div>
  ` : '';
  
  // Generate word origin HTML (fallback)
  const wordOriginHtml = !result.etymology ? getWordOrigin(result.word) : '';
  
  popup.innerHTML = `
    <div class="popup-content">
      <div class="dictionary-entry">
        <div class="word">${result.word}</div>
        ${pronunciationHtml}
        ${etymologyHtml}
        ${wordOriginHtml}
        <div class="definitions">
          ${definitionsHtml}
        </div>
        ${synonymsHtml}
        ${antonymsHtml}
        <div class="translations">
          ${translationsHtml}
        </div>
        <div class="examples">
          ${examplesHtml}
        </div>
        ${sourcesHtml}
      </div>
    </div>
  `;
}

function displayMockResultInPopup(text: string, popup: HTMLElement) {
  popup.innerHTML = `
    <div class="popup-content">
      <div class="dictionary-entry">
        <div class="word">${text}</div>
        <div class="pronunciation">
          <div class="pronunciation-item">
            <span>🇺🇸 /${getPronunciation(text)}/</span>
          </div>
        </div>
        <div class="definitions">
          ${getFallbackDefinitions(text)}
        </div>
        <div class="translations">
          ${getFallbackTranslations(text)}
        </div>
        <div class="examples">
          ${getFallbackExamples(text)}
        </div>
      </div>
    </div>
  `;
}

function displayErrorResultInPopup(text: string, error: any, popup: HTMLElement) {
  popup.innerHTML = `
    <div class="popup-content">
      <div class="error-message">
        <div class="word">${text}</div>
        <div class="error-text">❌ Lookup failed</div>
        <div class="error-details">${error.message || 'Unknown error'}</div>
        <div class="fallback">
          <div class="definitions">
            ${getFallbackDefinitions(text)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function startPopupTimeout() {
  // Clear existing timeout
  if (popupTimeout) {
    clearTimeout(popupTimeout);
  }
  
  // Set new timeout with much longer duration (30 seconds instead of 3)
  popupTimeout = setTimeout(() => {
    if (!isPopupFocused) {
      const popup = document.getElementById('popup');
      if (popup) {
        popup.remove();
      }
      popupTimeout = null;
    }
  }, 30000); // 30 seconds
}


