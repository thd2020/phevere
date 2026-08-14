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

import './index.css';
import { captureNextShortcut } from './shortcut-capture';

// Inside your main window initialization or setup block:
const clearBtn = document.getElementById('clearSelectionsBtn') as HTMLButtonElement;
const recentList = document.getElementById('selectionsList');

const rlog = (...args: unknown[]) => {
  if (!__PHEVERE_DEV__) return;
  console.log(...args);
};

rlog('🚀 Phevere renderer started');

if (clearBtn && recentList) {
  clearBtn.addEventListener('click', () => {
    localStorage.removeItem(RECENT_SELECTIONS_STORAGE_KEY);
    recentList.innerHTML = `
      <p class="empty-message">No selections yet. When the monitor is On or Shortcut, chosen text appears here.</p>
    `;
    updateClearButtonVisibility(); // <-- Will hide the button automatically
  });
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  const path = window.location.pathname || '';

  // If we're on the dedicated popup bundle (/popup_window), DO NOT rebuild DOM.
  // The markup and behavior come from popup-new.html itself.
  if (path.includes('popup_window')) {
    rlog('[POPUP-RENDERER] Detected /popup_window. Skipping initializePopup() to use popup-new.html. hash=', hash);
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
function updateClearButtonVisibility(): void {
  const clearBtn = document.getElementById('clearSelectionsBtn') as HTMLButtonElement;
  const recentList = document.getElementById('selectionsList') || document.getElementById('recent-list');
  if (!clearBtn || !recentList) return;
  
  const hasItems = recentList.querySelectorAll('.selection-item').length > 0;
  clearBtn.style.display = hasItems ? 'inline-flex' : 'none';
}

function initializeSettingsWindow() {
  rlog('🚀 Initializing settings window...');

  document.body.className = 'settings-page';

  const settingsHTML = `
    <div class="settings-app">
      <header class="settings-titlebar">
        <div class="settings-titlebar__lead">
          <span class="settings-brand-mark" aria-hidden="true">P</span>
          <div class="settings-titlebar__text">
            <h1 class="settings-titlebar__heading">Phevere</h1>
            <span class="settings-titlebar__sub">Settings</span>
          </div>
        </div>
        <button type="button" id="settings-close" class="settings-close-btn" title="Close" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
          </svg>
        </button>
      </header>
      <div class="settings-shell">
        <nav class="settings-nav" aria-label="Settings sections">
          <button type="button" class="settings-nav__item is-active" data-section="shortcuts">Shortcuts</button>
          <button type="button" class="settings-nav__item" data-section="capture">Capture</button>
          <button type="button" class="settings-nav__item" data-section="sources">Sources</button>
          <button type="button" class="settings-nav__item" data-section="offline">Offline</button>
          <button type="button" class="settings-nav__item" data-section="api">API keys</button>
          <button type="button" class="settings-nav__item" data-section="audio">Audio</button>
        </nav>
        <main class="settings-main">
          <section class="settings-panel is-active" data-panel="shortcuts" aria-labelledby="settings-monitor-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-monitor-heading" class="settings-panel__title">Shortcuts</h2>
            </div>
            <div class="settings-field">
              <span id="label-monitor-cycle" class="settings-field-label">Cycle monitor mode</span>
              <div class="settings-shortcut-row">
                <input type="text" id="monitor-cycle-shortcut" readonly class="setting-input settings-shortcut-input" spellcheck="false" autocomplete="off" placeholder="Set… or double-click" aria-labelledby="label-monitor-cycle" />
                <button type="button" class="btn btn-secondary settings-shortcut-set" id="monitor-cycle-set">Set…</button>
              </div>
            </div>
            <div class="settings-field">
              <span id="label-monitor-trigger" class="settings-field-label">Popup trigger (hold while selecting)</span>
              <div class="settings-shortcut-row">
                <input type="text" id="monitor-trigger-shortcut" readonly class="setting-input settings-shortcut-input" spellcheck="false" autocomplete="off" placeholder="Set… or double-click" aria-labelledby="label-monitor-trigger" />
                <button type="button" class="btn btn-secondary settings-shortcut-set" id="monitor-trigger-set">Set…</button>
              </div>
            </div>
            <div class="settings-field">
              <span id="label-ocr-shortcut" class="settings-field-label">OCR region overlay</span>
              <div class="settings-shortcut-row">
                <input type="text" id="ocr-shortcut" readonly class="setting-input settings-shortcut-input" spellcheck="false" autocomplete="off" placeholder="Set… or double-click" aria-labelledby="label-ocr-shortcut" />
                <button type="button" class="btn btn-secondary settings-shortcut-set" id="ocr-shortcut-set">Set…</button>
              </div>
            </div>
            <div class="settings-field">
              <span id="label-hover-shortcut" class="settings-field-label">Toggle hover lookup</span>
              <div class="settings-shortcut-row">
                <input type="text" id="hover-shortcut" readonly class="setting-input settings-shortcut-input" spellcheck="false" autocomplete="off" placeholder="Set… or double-click" aria-labelledby="label-hover-shortcut" />
                <button type="button" class="btn btn-secondary settings-shortcut-set" id="hover-shortcut-set">Set…</button>
              </div>
            </div>
            <div class="settings-actions settings-actions--wrap">
              <button type="button" id="monitor-save-shortcuts" class="btn btn-primary">Save shortcuts</button>
              <span id="monitor-shortcuts-status" class="settings-inline-status" role="status" aria-live="polite"></span>
            </div>
            <ul class="settings-cheat">
              <li><kbd>Ctrl+Shift+G</kbd> Grab under cursor</li>
              <li><kbd>Ctrl+Shift+W</kbd> Read this window</li>
              <li><kbd>Ctrl+Shift+I</kbd> OCR clipboard image</li>
              <li><kbd>Ctrl+Shift+P</kbd> Now playing</li>
            </ul>
          </section>

          <section class="settings-panel" data-panel="capture" aria-labelledby="settings-capture-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-capture-heading" class="settings-panel__title">Capture</h2>
            </div>
            <div class="settings-row" role="group" aria-labelledby="enable-hover-label">
              <span id="enable-hover-label" class="settings-row__label">Hover lookup</span>
              <label class="settings-toggle-label">
                <input class="toggle-input" type="checkbox" id="enable-hover" checked />
                <span class="toggle-switch" aria-hidden="true"><span class="toggle-slider"></span></span>
              </label>
            </div>
            <div class="settings-dropzone" id="settings-dropzone" tabindex="0">
              <strong>Drop or paste an image</strong>
              <span>PNG / JPG / WebP</span>
            </div>
            <div class="settings-panel__intro" style="margin-top:20px;">
              <h3 class="settings-panel__title" style="font-size:1rem;">OCR engine</h3>
            </div>
            <div class="settings-field">
              <label for="ocr-profile-select">Model pack</label>
              <select id="ocr-profile-select" class="setting-input"></select>
            </div>
            <p id="ocr-status" class="settings-inline-status" role="status" aria-live="polite">Checking OCR…</p>
            <div class="settings-actions settings-actions--wrap">
              <button type="button" id="ocr-apply-profile" class="btn btn-primary">Apply</button>
              <button type="button" id="ocr-upload-models" class="btn btn-secondary">Upload folder…</button>
              <button type="button" id="ocr-refresh-status" class="btn btn-outlined">Refresh</button>
            </div>
          </section>

          <section class="settings-panel" data-panel="sources" aria-labelledby="settings-sources-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-sources-heading" class="settings-panel__title">Dictionary sources</h2>
            </div>
            <div id="main-source-toggles"></div>
          </section>

          <section class="settings-panel" data-panel="offline" aria-labelledby="settings-offline-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-offline-heading" class="settings-panel__title">Offline dictionary</h2>
            </div>
            <p class="settings-hint">
              Download open, paper-era, or academic packs for lookup without the network.
              Current <strong>Oxford</strong>, <strong>Merriam-Webster Collegiate</strong>, and <strong>Collins</strong>
              editions are copyrighted and are not offered as dumps — use a licensed JSON import, or Oxford’s online API when you have keys.
            </p>
            <div id="offline-catalog" class="settings-offline-catalog"></div>
            <div class="settings-actions settings-actions--wrap">
              <button type="button" id="offline-import-json" class="btn btn-secondary">Import JSON / JSONL</button>
              <button type="button" id="offline-import-cedict" class="btn btn-secondary">Import CEDICT file</button>
              <button type="button" id="offline-refresh-packs" class="btn btn-outlined">Refresh</button>
            </div>
            <p id="offline-status" class="settings-inline-status" role="status" aria-live="polite"></p>
            <h3 class="settings-offline-installed-title">Installed packs</h3>
            <div id="offline-packs-list" class="settings-offline-packs"></div>
          </section>

          <section class="settings-panel" data-panel="api" aria-labelledby="settings-api-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-api-heading" class="settings-panel__title">API keys</h2>
            </div>
            <div class="settings-field">
              <label for="google-api-key">Google Translate API key</label>
              <input type="password" id="google-api-key" placeholder="Paste your Google Cloud API key" class="setting-input" autocomplete="off" />
              <div class="settings-actions">
                <button type="button" onclick="saveGoogleApiKey()" class="btn btn-primary">Save</button>
              </div>
            </div>
            <div class="settings-field">
              <label for="deepl-api-key">DeepL API key</label>
              <input type="password" id="deepl-api-key" placeholder="Paste your DeepL API key" class="setting-input" autocomplete="off" />
              <div class="settings-actions">
                <button type="button" onclick="saveDeepLApiKey()" class="btn btn-primary">Save</button>
              </div>
            </div>
          </section>

          <section class="settings-panel" data-panel="audio" aria-labelledby="settings-audio-heading">
            <div class="settings-panel__intro">
              <h2 id="settings-audio-heading" class="settings-panel__title">Audio</h2>
            </div>
            <div class="settings-row" role="group" aria-labelledby="enable-audio-label">
              <span id="enable-audio-label" class="settings-row__label">Enable pronunciation</span>
              <label class="settings-toggle-label">
                <input class="toggle-input" type="checkbox" id="enable-audio" checked />
                <span class="toggle-switch" aria-hidden="true"><span class="toggle-slider"></span></span>
              </label>
            </div>
            <div class="settings-field">
              <label for="audio-speed">Playback speed</label>
              <div class="settings-audio-range">
                <input type="range" id="audio-speed" min="0.5" max="2" step="0.1" value="1" />
                <span id="speed-value">1x</span>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  `;
  document.body.innerHTML = settingsHTML;

  document.querySelectorAll('.settings-nav__item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = (btn as HTMLElement).dataset.section;
      document.querySelectorAll('.settings-nav__item').forEach((b) => b.classList.remove('is-active'));
      document.querySelectorAll('.settings-panel').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      document.querySelector(`.settings-panel[data-panel="${section}"]`)?.classList.add('is-active');
    });
  });

  loadMainSourceToggles();
  setupAudioSettings();
  wireSettingsImageDrop();
  void wireOfflineSettingsPanel();
  void wireOcrSettingsPanel();
  void wireMonitorSettingsFields().then(({ stopCapture }) => {
    document.getElementById('settings-close')?.addEventListener('click', () => {
      stopCapture();
      window.close();
    });
  });
}

async function wireOcrSettingsPanel(): Promise<void> {
  const api = (window as any).ocrAPI;
  const statusEl = document.getElementById('ocr-status');
  const selectEl = document.getElementById('ocr-profile-select') as HTMLSelectElement | null;
  const setStatus = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };

  const fillSelect = (s: any) => {
    if (!selectEl) return;
    const profiles = Array.isArray(s?.profiles) ? s.profiles : [];
    const active = String(s?.activeProfileId || 'bundled-pp-ocrv4');
    selectEl.innerHTML = profiles
      .map((p: any) => {
        const mark = p.installed ? '' : p.kind === 'download' ? ' (download)' : '';
        return `<option value="${escapeHtmlSelection(p.id)}"${p.id === active ? ' selected' : ''}>${escapeHtmlSelection(p.label)}${mark}</option>`;
      })
      .join('');
    if (!profiles.length) {
      selectEl.innerHTML = `<option value="bundled-pp-ocrv4">PP-OCRv4 mobile (bundled)</option>`;
    }
  };

  const refresh = async () => {
    if (!api?.getStatus) {
      setStatus('OCR unavailable.');
      return;
    }
    try {
      const s = await api.getStatus();
      fillSelect(s);
      const label =
        (s.profiles || []).find((p: any) => p.id === s.activeProfileId)?.label || s.activeProfileId || 'OCR';
      if (s.available === true) {
        setStatus(`${label} · ready`);
      } else if (s.available === false) {
        setStatus(`${label} · ${s.lastError || 'unavailable'}`);
      } else {
        setStatus(`${label} · checking…`);
      }
    } catch (e: any) {
      setStatus(`Status check failed: ${e?.message || e}`);
    }
  };

  document.getElementById('ocr-refresh-status')?.addEventListener('click', () => {
    void refresh();
  });

  document.getElementById('ocr-apply-profile')?.addEventListener('click', async () => {
    if (!api?.setProfile || !selectEl) return;
    const id = selectEl.value;
    if (id === 'custom') {
      setStatus('Choose a model folder…');
      const picked = await api.pickCustomFolder?.();
      if (!picked || picked.cancelled || !picked.path) {
        setStatus('Cancelled.');
        return;
      }
      setStatus('Loading custom models…');
      const r = await api.setProfile('custom', picked.path);
      setStatus(r?.ok ? r.detail : `Failed — ${r?.detail || 'unknown'}`);
      await refresh();
      return;
    }
    setStatus(id.startsWith('pp-ocr') && id !== 'bundled-pp-ocrv4' ? 'Downloading models…' : 'Switching…');
    try {
      const r = await api.setProfile(id);
      setStatus(r?.ok ? r.detail : `Failed — ${r?.detail || 'unknown'}`);
    } catch (e: any) {
      setStatus(`Failed: ${e?.message || e}`);
    }
    await refresh();
  });

  document.getElementById('ocr-upload-models')?.addEventListener('click', async () => {
    if (!api?.setProfile) return;
    const picked = await api.pickCustomFolder?.();
    if (!picked || picked.cancelled || !picked.path) return;
    setStatus('Loading custom models…');
    const r = await api.setProfile('custom', picked.path);
    setStatus(r?.ok ? r.detail : `Failed — ${r?.detail || 'unknown'}`);
    await refresh();
  });

  await refresh();
}

async function wireOfflineSettingsPanel(): Promise<void> {
  const api = (window as any).offlineDictAPI;
  const statusEl = document.getElementById('offline-status');
  const listEl = document.getElementById('offline-packs-list');
  const catalogEl = document.getElementById('offline-catalog');
  const setStatus = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };

  const refreshPacks = async () => {
    if (!listEl || !api?.listPacks) {
      if (listEl) listEl.innerHTML = `<p class="settings-hint">Offline API unavailable.</p>`;
      return;
    }
    try {
      const packs = await api.listPacks();
      if (!packs?.length) {
        listEl.innerHTML = `<p class="settings-hint">No packs installed yet.</p>`;
        return;
      }
      listEl.innerHTML = packs
        .map(
          (p: any) => `<div class="settings-offline-pack">
            <div>
              <strong>${escapeHtmlSelection(p.name)}</strong>
              <span class="settings-hint">${escapeHtmlSelection(p.language)} · ${Number(p.entryCount) || 0} entries</span>
            </div>
            <button type="button" class="btn btn-outlined btn-small offline-remove" data-id="${escapeHtmlSelection(p.id)}">Remove</button>
          </div>`,
        )
        .join('');
      listEl.querySelectorAll('.offline-remove').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = (btn as HTMLElement).dataset.id;
          if (!id) return;
          if (!confirm(`Remove pack “${id}”?`)) return;
          await api.removePack(id);
          setStatus('Pack removed.');
          await refreshAll();
        });
      });
    } catch (error) {
      console.error(error);
      listEl.innerHTML = `<p class="settings-hint">Could not list packs.</p>`;
    }
  };

  const consentById = new Map<string, string>();

  const refreshCatalog = async () => {
    if (!catalogEl) return;
    if (!api?.listCatalog) {
      catalogEl.innerHTML = `<p class="settings-hint">Catalog unavailable.</p>`;
      return;
    }
    try {
      const items = await api.listCatalog();
      consentById.clear();
      catalogEl.innerHTML = (items || [])
        .map((c: any) => {
          const installed = !!c.installed;
          const count = Number(c.entryCount) || 0;
          const state = installed ? `Installed · ${count.toLocaleString()} entries` : escapeHtmlSelection(c.sizeHint || '');
          consentById.set(String(c.id), String(c.consent || ''));
          return `<article class="settings-offline-offer" data-id="${escapeHtmlSelection(c.id)}">
            <div class="settings-offline-offer__body">
              <div class="settings-offline-offer__kicker">${escapeHtmlSelection(c.direction)} · ${escapeHtmlSelection(c.license)}</div>
              <h3 class="settings-offline-offer__title">${escapeHtmlSelection(c.name)}</h3>
              <p class="settings-hint">${escapeHtmlSelection(c.summary)}</p>
              <p class="settings-hint">${state}</p>
            </div>
            <button type="button" class="btn ${installed ? 'btn-outlined' : 'btn-primary'} btn-small offline-download" data-id="${escapeHtmlSelection(c.id)}">
              ${installed ? 'Re-download' : 'Download'}
            </button>
          </article>`;
        })
        .join('');
      catalogEl.querySelectorAll('.offline-download').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = (btn as HTMLElement).dataset.id;
          const consent = consentById.get(id || '') || 'Download this dictionary pack?';
          if (!id || !api?.downloadPack) return;
          if (!confirm(consent)) return;
          (btn as HTMLButtonElement).disabled = true;
          setStatus(`Downloading ${id}…`);
          try {
            const r = await api.downloadPack(id);
            setStatus(r?.success ? `${id} ready · ${Number(r.count) || 0} entries.` : 'Download failed.');
            await refreshAll();
          } catch (e: any) {
            setStatus(`Download failed: ${e?.message || e}`);
          } finally {
            (btn as HTMLButtonElement).disabled = false;
          }
        });
      });
    } catch (error) {
      console.error(error);
      catalogEl.innerHTML = `<p class="settings-hint">Could not load catalog.</p>`;
    }
  };

  const refreshAll = async () => {
    await refreshCatalog();
    await refreshPacks();
  };

  document.getElementById('offline-refresh-packs')?.addEventListener('click', () => {
    void refreshAll();
  });
  document.getElementById('offline-import-json')?.addEventListener('click', async () => {
    if (!api?.importJson) return;
    setStatus('Choose a JSON / JSONL file…');
    try {
      const r = await api.importJson();
      if (r?.cancelled) {
        setStatus('Import cancelled.');
        return;
      }
      setStatus(r?.success ? `Imported ${r.count} entries.` : 'Import failed.');
      await refreshAll();
    } catch (e: any) {
      setStatus(`Import failed: ${e?.message || e}`);
    }
  });
  document.getElementById('offline-import-cedict')?.addEventListener('click', async () => {
    if (!api?.importCedictFile) return;
    setStatus('Choose a CEDICT text file…');
    try {
      const r = await api.importCedictFile();
      if (r?.cancelled) {
        setStatus('Import cancelled.');
        return;
      }
      setStatus(r?.success ? `Imported ${r.count} CEDICT entries.` : 'Import failed.');
      await refreshAll();
    } catch (e: any) {
      setStatus(`Import failed: ${e?.message || e}`);
    }
  });

  await refreshAll();
}

function wireSettingsImageDrop(): void {
  const zone = document.getElementById('settings-dropzone');
  const api = window.electronAPI as {
    ocrImageFile?: (path: string) => Promise<{ success: boolean; error?: string }>;
    ocrImageData?: (data: string) => Promise<{ success: boolean; error?: string }>;
  };
  if (!zone || (!api.ocrImageFile && !api.ocrImageData)) return;

  const setBusy = (busy: boolean) => {
    zone.classList.toggle('is-busy', busy);
  };

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const anyFile = file as File & { path?: string };
      if (anyFile.path && api.ocrImageFile) {
        await api.ocrImageFile(anyFile.path);
      } else if (api.ocrImageData) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        await api.ocrImageData(dataUrl);
      }
    } finally {
      setBusy(false);
    }
  });

  zone.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items || !api.ocrImageData) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue;
      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) return;
      setBusy(true);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        await api.ocrImageData(dataUrl);
      } finally {
        setBusy(false);
      }
      return;
    }
  });
}

async function wireMonitorSettingsFields(): Promise<{ stopCapture: () => void }> {
  const noop = (): void => {};
  const api = window.electronAPI as {
    getMonitorState?: () => Promise<{
      cycleShortcut: string;
      triggerShortcut: string;
      ocrShortcut?: string;
      hoverShortcut?: string;
      hoverEnabled?: boolean;
    }>;
    setMonitorShortcuts?: (p: {
      cycleShortcut: string;
      triggerShortcut: string;
      ocrShortcut?: string;
      hoverShortcut?: string;
      hoverEnabled?: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
  };
  if (!api?.getMonitorState || !api?.setMonitorShortcuts) {
    return { stopCapture: noop };
  }
  const cycleEl = document.getElementById('monitor-cycle-shortcut') as HTMLInputElement | null;
  const triggerEl = document.getElementById('monitor-trigger-shortcut') as HTMLInputElement | null;
  const ocrEl = document.getElementById('ocr-shortcut') as HTMLInputElement | null;
  const hoverEl = document.getElementById('hover-shortcut') as HTMLInputElement | null;
  const hoverToggle = document.getElementById('enable-hover') as HTMLInputElement | null;
  const cycleSetBtn = document.getElementById('monitor-cycle-set') as HTMLButtonElement | null;
  const triggerSetBtn = document.getElementById('monitor-trigger-set') as HTMLButtonElement | null;
  const ocrSetBtn = document.getElementById('ocr-shortcut-set') as HTMLButtonElement | null;
  const hoverSetBtn = document.getElementById('hover-shortcut-set') as HTMLButtonElement | null;

  const setBtns = [cycleSetBtn, triggerSetBtn, ocrSetBtn, hoverSetBtn].filter(Boolean) as HTMLButtonElement[];
  let cancelCapture: (() => void) | null = null;

  function stopCaptureUi(): void {
    cancelCapture?.();
    cancelCapture = null;
    for (const b of setBtns) {
      b.textContent = 'Set…';
      b.classList.remove('is-recording');
    }
  }

  function bindCapture(input: HTMLInputElement, setBtn: HTMLButtonElement): void {
    const start = (): void => {
      stopCaptureUi();
      setBtn.textContent = 'Press keys…';
      setBtn.classList.add('is-recording');
      cancelCapture = captureNextShortcut((acc) => {
        cancelCapture = null;
        setBtn.textContent = 'Set…';
        setBtn.classList.remove('is-recording');
        if (acc) input.value = acc;
      });
    };
    setBtn.addEventListener('click', (e) => {
      e.preventDefault();
      start();
    });
    input.addEventListener('dblclick', (e) => {
      e.preventDefault();
      start();
    });
  }

  if (cycleEl && cycleSetBtn) bindCapture(cycleEl, cycleSetBtn);
  if (triggerEl && triggerSetBtn) bindCapture(triggerEl, triggerSetBtn);
  if (ocrEl && ocrSetBtn) bindCapture(ocrEl, ocrSetBtn);
  if (hoverEl && hoverSetBtn) bindCapture(hoverEl, hoverSetBtn);

  try {
    const st = await api.getMonitorState();
    if (cycleEl) cycleEl.value = st.cycleShortcut || '';
    if (triggerEl) triggerEl.value = st.triggerShortcut || '';
    if (ocrEl) ocrEl.value = st.ocrShortcut || 'CommandOrControl+Shift+O';
    if (hoverEl) hoverEl.value = st.hoverShortcut || 'CommandOrControl+Shift+H';
    if (hoverToggle) hoverToggle.checked = st.hoverEnabled !== false;
  } catch {
    /* ignore */
  }

  const btn = document.getElementById('monitor-save-shortcuts');
  const statusEl = document.getElementById('monitor-shortcuts-status');
  btn?.addEventListener('click', async () => {
    if (!cycleEl || !triggerEl || !ocrEl || !hoverEl || !statusEl) return;
    statusEl.textContent = '';
    const r = await api.setMonitorShortcuts({
      cycleShortcut: cycleEl.value.trim(),
      triggerShortcut: triggerEl.value.trim(),
      ocrShortcut: ocrEl.value.trim(),
      hoverShortcut: hoverEl.value.trim(),
      hoverEnabled: hoverToggle ? hoverToggle.checked : true,
    });
    statusEl.textContent = r.success ? 'Saved.' : (r.error || 'Could not save.');
    statusEl.classList.toggle('is-error', !r.success);
  });

  hoverToggle?.addEventListener('change', async () => {
    if (!cycleEl || !triggerEl || !ocrEl || !hoverEl) return;
    await api.setMonitorShortcuts({
      cycleShortcut: cycleEl.value.trim(),
      triggerShortcut: triggerEl.value.trim(),
      ocrShortcut: ocrEl.value.trim(),
      hoverShortcut: hoverEl.value.trim(),
      hoverEnabled: hoverToggle.checked,
    });
  });

  return { stopCapture: stopCaptureUi };
}

let __popupInitDone = false;
let __lastRenderedText = '';
let __lastResizedForText = '';
function initializePopup() {
  if (__popupInitDone) {
    rlog('[POPUP-RENDERER] initializePopup skipped (already initialized)');
    return;
  }
  __popupInitDone = true;
  rlog('[POPUP-RENDERER] initializePopup start hash=', window.location.hash, 'href=', window.location.href);
  
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
      justify-content: flex-start;
      align-items: center;
      gap: 10px;
      padding: 10px 12px 10px 16px;
      background: #ece6f0;
      border-bottom: 1px solid rgba(121, 116, 126, 0.28);
      flex-wrap: nowrap;
      min-height: 52px;
      box-sizing: border-box;
    }
    
    .popup-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1 1 auto;
      min-width: 0;
    }
    
    .title-text {
      font-size: 15px;
      font-weight: 600;
      color: #1d1b20;
      letter-spacing: 0.01em;
    }
    
    .title-subtitle {
      font-size: 12px;
      color: #49454f;
      font-weight: 400;
    }
    
    .toolbar {
      display: flex;
      gap: 4px;
      margin: 0;
      flex: 0 0 auto;
      align-items: center;
    }
    
    .toolbar-btn {
      background: rgba(103, 80, 164, 0.1);
      border: none;
      color: #49454f;
      cursor: pointer;
      font-size: 15px;
      padding: 0;
      border-radius: 10px;
      transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    
    .toolbar-btn:hover {
      background: rgba(103, 80, 164, 0.18);
      color: #1d1b20;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }
    
    .toolbar-btn:active {
      filter: brightness(0.96);
    }
    
    .close-btn {
      background: transparent;
      border: none;
      color: #49454f;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      padding: 0;
      border-radius: 10px;
      transition: background-color 0.15s ease, color 0.15s ease;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    
    .close-btn:hover {
      color: #1d1b20;
      background: rgba(103, 80, 164, 0.12);
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
  rlog('[POPUP-RENDERER] initializePopup start');
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
    rlog('[POPUP-RENDERER] Close button clicked');
    window.close();
  });
  
  // Listen for popup data from main process
  if (window.electronAPI) {
    rlog('[POPUP-RENDERER] getLastSelection invoke');
    window.electronAPI.getLastSelection().then(selection => {
      const txt = (selection && selection.text) ? selection.text : '';
      rlog('[POPUP-RENDERER] getLastSelection OK (deferred lookup):', txt);
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
      rlog('[POPUP-RENDERER] onPopupText (deferred lookup):', t);
      const selectedTextElement = document.getElementById('selected-text');
      if (selectedTextElement) selectedTextElement.textContent = t;
      (window as any).__popupCurrentText = t;
      // Do NOT call updatePopupContent here; wait for user click
    });
  } else {
    rlog('[POPUP-RENDERER] electronAPI not available');
    updatePopupContent('Error: electronAPI not available.');
  }
  
  // Handle escape key to close popup
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      rlog('🚀 Escape key pressed, closing popup');
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
  initializeMainWindowControls();
  wireMainWindowImageIngest();
  wireMainWindowTextSelectionLookup();
  loadRecentSelectionsIntoDom();
  void loadVocabNotebook();
  void attachSelectionChangeListenerOnly();
}

/** Select-to-lookup inside the main window (UIA ignores our own process). */
function wireMainWindowTextSelectionLookup(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener('mouseup', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('button, input, textarea, select, a, .title-bar, .window-controls, .settings-panel, .status-bar')) {
      return;
    }
    const text = (window.getSelection()?.toString() || '').trim();
    if (!text || text.length > 80) return;
    if (!/[\p{L}\p{N}]/u.test(text)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const still = (window.getSelection()?.toString() || '').trim();
      if (still !== text) return;
      addToRecentSelections(text);
      const api = window.electronAPI as { showPopup?: (x: number, y: number, t: string) => void };
      if (api?.showPopup) {
        api.showPopup(e.screenX || 0, e.screenY || 0, text);
      }
    }, 280);
  });
}

async function loadVocabNotebook(): Promise<void> {
  const list = document.getElementById('vocabList');
  if (!list) return;
  const api = (window as any).vocabAPI;
  if (!api?.list) {
    list.innerHTML = `<p class="empty-message">Notebook API unavailable.</p>`;
    return;
  }
  try {
    const entries = await api.list(100);
    if (!entries || !entries.length) {
      list.innerHTML = `<p class="empty-message">No saved words yet.</p>`;
      return;
    }
    list.innerHTML = entries
      .map((e: any) => {
        const defRaw = String(e.definition || '').trim();
        const long = defRaw.length > 280 || defRaw.split(/\n/).length > 4;
        const defHtml = escapeHtmlSelection(defRaw).replace(/\n/g, '<br>');
        const badges = (e.sources || [])
          .slice(0, 4)
          .map((s: string) => `<span class="vocab-badge">${escapeHtmlSelection(s)}</span>`)
          .join('');
        const langPair =
          e.sourceLang || e.targetLang
            ? `<span class="vocab-langs">${escapeHtmlSelection(
                [e.sourceLang, e.targetLang].filter(Boolean).join(' → '),
              )}</span>`
            : '';
        const saved =
          e.updatedAt || e.createdAt
            ? new Date(Number(e.updatedAt || e.createdAt)).toLocaleString()
            : '';
        return `<article class="vocab-item is-collapsed" data-id="${escapeHtmlSelection(e.id)}" tabindex="0" role="button" aria-expanded="false">
          <div class="vocab-entry">
            <header class="vocab-entry__head">
              <h3 class="vocab-lemma">${escapeHtmlSelection(e.lemma)}</h3>
              ${e.reading ? `<span class="vocab-reading">/${escapeHtmlSelection(e.reading)}/</span>` : ''}
              <span class="vocab-expand-hint" aria-hidden="true"></span>
            </header>
            <div class="vocab-entry__meta">
              ${e.partOfSpeech ? `<span class="vocab-pos">${escapeHtmlSelection(e.partOfSpeech)}</span>` : ''}
              ${langPair}
              ${saved ? `<time class="vocab-saved" datetime="${escapeHtmlSelection(String(e.updatedAt || e.createdAt))}">${escapeHtmlSelection(saved)}</time>` : ''}
            </div>
            <div class="vocab-entry__details">
              ${defHtml ? `<div class="vocab-def${long ? ' is-clamped' : ''}" data-full="1">${defHtml}</div>${long ? `<button type="button" class="vocab-more btn-link">Show more</button>` : ''}` : '<p class="vocab-note">No definition saved.</p>'}
              ${badges ? `<div class="vocab-badges">${badges}</div>` : ''}
              ${e.note ? `<p class="vocab-note">${escapeHtmlSelection(e.note)}</p>` : ''}
            </div>
          </div>
          <div class="vocab-actions">
            <button type="button" class="btn btn-outlined btn-small vocab-open" data-lemma="${escapeHtmlSelection(e.lemma)}">Open</button>
            <button type="button" class="btn btn-outlined btn-small vocab-remove" data-id="${escapeHtmlSelection(e.id)}">Remove</button>
          </div>
        </article>`;
      })
      .join('');

    list.querySelectorAll('.vocab-item').forEach((el) => {
      el.addEventListener('click', (ev) => {
        const t = ev.target as HTMLElement;
        if (t.closest('.vocab-actions, .vocab-more, button, a')) return;
        const open = el.classList.toggle('is-collapsed') === false;
        el.classList.toggle('is-expanded', open);
        el.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      el.addEventListener('keydown', (ev) => {
        const ke = ev as KeyboardEvent;
        if (ke.key !== 'Enter' && ke.key !== ' ') return;
        ke.preventDefault();
        (el as HTMLElement).click();
      });
    });
    list.querySelectorAll('.vocab-open').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lemma = (btn as HTMLElement).dataset.lemma;
        if (lemma) void openFullLookup(lemma);
      });
    });
    list.querySelectorAll('.vocab-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        if (!id) return;
        await api.remove(id);
        void loadVocabNotebook();
      });
    });
    list.querySelectorAll('.vocab-more').forEach((btn) => {
      btn.addEventListener('click', () => {
        const def = (btn as HTMLElement).previousElementSibling as HTMLElement | null;
        if (!def) return;
        const open = def.classList.toggle('is-clamped') === false;
        (btn as HTMLElement).textContent = open ? 'Show less' : 'Show more';
        if (open) def.classList.remove('is-clamped');
        else def.classList.add('is-clamped');
        // fix toggle: after toggle is-clamped, if removed we show less
        const clamped = def.classList.contains('is-clamped');
        (btn as HTMLElement).textContent = clamped ? 'Show more' : 'Show less';
      });
    });
  } catch (error) {
    console.error('vocab load failed', error);
    list.innerHTML = `<p class="empty-message">Could not load notebook.</p>`;
  }
}

document.getElementById('refreshVocabBtn')?.addEventListener('click', () => {
  void loadVocabNotebook();
});

async function openFullLookup(text: string): Promise<void> {
  try {
    // Open first; lookup runs inside the dictionary window. Awaiting recall here
    // froze history/saves behind a hung IPC with no visible window progress.
    window.electronAPI?.send?.('open-full-lookup', text);
  } catch (error) {
    console.error(error);
  }
}

function wireMainWindowImageIngest(): void {
  const api = window.electronAPI as {
    ocrImageFile?: (path: string) => Promise<{ success: boolean; error?: string }>;
    ocrImageData?: (data: string) => Promise<{ success: boolean; error?: string }>;
  };
  if (!api.ocrImageFile && !api.ocrImageData) return;

  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.preventDefault();
    const anyFile = file as File & { path?: string };
    if (anyFile.path && api.ocrImageFile) {
      await api.ocrImageFile(anyFile.path);
    } else if (api.ocrImageData) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await api.ocrImageData(dataUrl);
    }
  });

  document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items || !api.ocrImageData) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue;
      const blob = item.getAsFile();
      if (!blob) return;
      e.preventDefault();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      await api.ocrImageData(dataUrl);
      return;
    }
  });
}

function initializeMainWindowControls() {
  const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
  const selectionToggle = document.getElementById('selectionToggle') as HTMLButtonElement;
  const clipboardToggle = document.getElementById('clipboardToggle') as HTMLButtonElement;
  const hoverToggle = document.getElementById('hoverToggle') as HTMLButtonElement;
  const audioToggle = document.getElementById('audioToggle') as HTMLButtonElement;
  const ocrStatusBtn = document.getElementById('ocrStatusBtn') as HTMLButtonElement;
  const selectionStatus = document.getElementById('selectionStatus') as HTMLElement;
  const clipboardStatus = document.getElementById('clipboardStatus') as HTMLElement;
  const hoverStatus = document.getElementById('hoverStatus') as HTMLElement;
  const audioStatus = document.getElementById('audioStatus') as HTMLElement;

  const minimizeBtn = document.getElementById('minimize-btn') as HTMLButtonElement;
  const maximizeBtn = document.getElementById('maximize-btn') as HTMLButtonElement;
  const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;

  let isClipboardMonitoring = false;
  const AUDIO_KEY = 'phevereAudioEnabled';

  const selectionModeLabels: Record<string, string> = {
    off: 'Off',
    on: 'On',
    shortcut: 'Shortcut',
  };

  function syncSelectionMonitorUi(mode: string): void {
    if (!selectionStatus || !selectionToggle) return;
    const label = selectionModeLabels[mode] || mode;
    selectionStatus.textContent = label;
    selectionStatus.className =
      mode === 'on'
        ? 'status-value running'
        : mode === 'shortcut'
          ? 'status-value shortcut'
          : 'status-value stopped';
    selectionToggle.setAttribute('aria-pressed', mode !== 'off' ? 'true' : 'false');
    selectionToggle.setAttribute('aria-label', `Selection monitor: ${label}. Click to cycle Off, On, Shortcut.`);
  }

  function syncClipboardUi(running: boolean): void {
    if (!clipboardStatus || !clipboardToggle) return;
    clipboardStatus.textContent = running ? 'Running' : 'Stopped';
    clipboardStatus.className = running ? 'status-value running' : 'status-value stopped';
    clipboardToggle.setAttribute('aria-pressed', running ? 'true' : 'false');
  }

  function syncHoverUi(enabled: boolean): void {
    if (!hoverStatus || !hoverToggle) return;
    hoverStatus.textContent = enabled ? 'On' : 'Off';
    hoverStatus.className = enabled ? 'status-value running' : 'status-value stopped';
    hoverToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    hoverToggle.setAttribute('aria-label', `Hover lookup: ${enabled ? 'On' : 'Off'}. Click to toggle.`);
  }

  function syncAudioUi(enabled: boolean): void {
    if (!audioStatus || !audioToggle) return;
    audioStatus.textContent = enabled ? 'On' : 'Off';
    audioStatus.className = enabled ? 'status-value running' : 'status-value stopped';
    audioToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    audioToggle.setAttribute('aria-label', `Pronunciation audio: ${enabled ? 'On' : 'Off'}. Click to toggle.`);
  }

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

  if (selectionToggle && window.electronAPI?.cycleMonitorMode) {
    selectionToggle.addEventListener('click', async () => {
      try {
        await window.electronAPI.cycleMonitorMode();
        const st = await window.electronAPI.getMonitorState?.();
        if (st?.mode) {
          syncSelectionMonitorUi(st.mode);
        }
      } catch (error) {
        console.error('Selection monitor cycle failed:', error);
      }
    });
  }

  if (clipboardToggle && window.clipboardAPI) {
    clipboardToggle.addEventListener('click', async () => {
      try {
        if (isClipboardMonitoring) {
          await window.clipboardAPI.stopMonitoring();
          syncClipboardUi(false);
          isClipboardMonitoring = false;
        } else {
          await window.clipboardAPI.startMonitoring();
          syncClipboardUi(true);
          isClipboardMonitoring = true;
        }
      } catch (error) {
        console.error('Clipboard monitoring toggle failed:', error);
      }
    });
  }

  if (hoverToggle && window.electronAPI?.toggleHoverEnabled) {
    hoverToggle.addEventListener('click', async () => {
      try {
        const r = await window.electronAPI.toggleHoverEnabled!();
        if (typeof r?.hoverEnabled === 'boolean') syncHoverUi(r.hoverEnabled);
      } catch (error) {
        console.error('Hover toggle failed:', error);
      }
    });
  }

  if (audioToggle) {
    audioToggle.addEventListener('click', () => {
      const next = localStorage.getItem(AUDIO_KEY) === '0';
      localStorage.setItem(AUDIO_KEY, next ? '1' : '0');
      syncAudioUi(next);
    });
  }

  if (ocrStatusBtn && window.electronAPI?.startOcrRegion) {
    ocrStatusBtn.addEventListener('click', () => {
      void window.electronAPI.startOcrRegion!();
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      window.electronAPI.showSettingsWindow();
    });
  }

  if (window.electronAPI) {
    window.electronAPI.onShowClipboardHistory(() => {
      showClipboardHistory();
    });
    window.electronAPI.onMonitorModeChanged?.((payload: { mode: string }) => {
      syncSelectionMonitorUi(payload.mode);
    });
    window.electronAPI.onMonitorHoverChanged?.((payload: { hoverEnabled: boolean }) => {
      syncHoverUi(!!payload.hoverEnabled);
    });
  }

  syncClipboardUi(true);
  isClipboardMonitoring = true;
  syncAudioUi(localStorage.getItem(AUDIO_KEY) !== '0');

  void (async () => {
    try {
      const st = await window.electronAPI?.getMonitorState?.();
      if (st?.mode) {
        syncSelectionMonitorUi(st.mode);
      }
      if (typeof st?.hoverEnabled === 'boolean') {
        syncHoverUi(st.hoverEnabled);
      } else {
        syncHoverUi(true);
      }
    } catch {
      syncSelectionMonitorUi('on');
      syncHoverUi(true);
    }
  })();
}

async function attachSelectionChangeListenerOnly(): Promise<void> {
  try {
    if (window.electronAPI && !__selectionListenerAttached) {
      window.electronAPI.onSelectionChange((text: string) => {
        rlog('[DBG] renderer received selection-changed:', text);
        addToRecentSelections(text);
      });
      __selectionListenerAttached = true;
    }
    rlog('Selection listener attached');
  } catch (error) {
    console.error('Failed to attach selection listener:', error);
  }
}

let __selectionListenerAttached = false;

const RECENT_SELECTIONS_STORAGE_KEY = 'phevereRecentSelections';
const MAX_RECENT_SELECTIONS = 10;

function escapeHtmlSelection(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function persistRecentSelections(entries: { text: string; time: string }[]): void {
  try {
    localStorage.setItem(RECENT_SELECTIONS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota */
  }
}

function loadRecentSelectionsIntoDom(): void {
  const recentList = document.getElementById('selectionsList') || document.getElementById('recent-list');
  if (!recentList) return;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RECENT_SELECTIONS_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const entries = JSON.parse(raw) as { text: string; time?: string }[];
    if (!Array.isArray(entries)) return;
    const empty = recentList.querySelector('.empty-message');
    empty?.remove();
    const slice = entries.slice(0, MAX_RECENT_SELECTIONS);
    for (let i = slice.length - 1; i >= 0; i--) {
      const e = slice[i];
      if (!e?.text) continue;
      appendRecentSelectionRow(e.text, e.time || '', recentList, false);
    }
    updateClearButtonVisibility(); // <-- Add here
  } catch {
    /* ignore */
  }
}

function appendRecentSelectionRow(
  text: string,
  timeLabel: string,
  recentList: HTMLElement,
  save: boolean
): void {
  const selectionItem = document.createElement('button');
  selectionItem.className = 'selection-item';
  selectionItem.setAttribute('type', 'button');
  selectionItem.setAttribute('aria-label', `Lookup ${text}`);
  const safe = escapeHtmlSelection(text);
  const t = timeLabel || new Date().toLocaleTimeString();
  selectionItem.innerHTML = `
    <span class="selection-item__accent" aria-hidden="true"></span>
    <span class="selection-item__body">
      <span class="selection-text">${safe}</span>
      <span class="selection-time">${escapeHtmlSelection(t)}</span>
    </span>
  `;
  selectionItem.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      // Open immediately — do not await recall first (that blocked the window on hung IPC
      // and looked like an infinitely loading lookup). The popup window looks up itself.
      window.electronAPI?.send('open-full-lookup', text);
    } catch (err) {
      console.error('Failed to open full dictionary view:', err);
    }
  });
  
  // Add to beginning of list
  recentList.insertBefore(selectionItem, recentList.firstChild);
  updateClearButtonVisibility(); // <-- Add here

  while (recentList.querySelectorAll('.selection-item').length > MAX_RECENT_SELECTIONS) {
    const all = recentList.querySelectorAll('.selection-item');
    recentList.removeChild(all[all.length - 1]);
  }

  if (save) {
    syncRecentSelectionsStorageFromDom(recentList);
  }
}

function syncRecentSelectionsStorageFromDom(recentList: HTMLElement): void {
  const items = recentList.querySelectorAll('.selection-item');
  const entries: { text: string; time: string }[] = [];
  items.forEach((el) => {
    const text = el.querySelector('.selection-text')?.textContent || '';
    const time = el.querySelector('.selection-time')?.textContent || '';
    if (text) {
      entries.push({ text, time });
    }
  });
  persistRecentSelections(entries);
}

function addToRecentSelections(text: string): void {
  const recentList = document.getElementById('selectionsList') || document.getElementById('recent-list');
  if (!recentList) return;
  const first = recentList.querySelector('.selection-item');
  if (first && first.querySelector('.selection-text')?.textContent === text) {
    return;
  }
  const empty = recentList.querySelector('.empty-message');
  empty?.remove();
  appendRecentSelectionRow(text, new Date().toLocaleTimeString(), recentList, true);
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

function escapeHtmlClipboard(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatClipboardTimestamp(ts: unknown): string {
  try {
    const d = ts instanceof Date ? ts : new Date(ts as string | number);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString();
  } catch {
    return '';
  }
}

function renderClipboardItemsHtml(entries: { id: string; text: string; timestamp: unknown }[]): string {
  if (entries.length === 0) {
    return '<p class="empty-state">No clipboard history yet</p>';
  }
  return entries
    .map(
      (entry) => `
        <div class="clipboard-item" data-id="${escapeHtmlClipboard(entry.id)}">
          <div class="clipboard-text">${escapeHtmlClipboard(entry.text.substring(0, 200))}${entry.text.length > 200 ? '…' : ''}</div>
          <div class="clipboard-meta">
            <span class="clipboard-time">${escapeHtmlClipboard(formatClipboardTimestamp(entry.timestamp))}</span>
            <button type="button" class="copy-btn" data-copy-id="${escapeHtmlClipboard(entry.id)}">Copy</button>
            <button type="button" class="remove-btn" data-remove-id="${escapeHtmlClipboard(entry.id)}">×</button>
          </div>
        </div>
      `
    )
    .join('');
}

async function showClipboardHistory() {
  if (!window.clipboardAPI) {
    console.error('Clipboard API not available');
    return;
  }

  try {
    const history = await window.clipboardAPI.getHistory();
    const stats = await window.clipboardAPI.getStats();

    const textById = new Map<string, string>();
    history.forEach((e) => textById.set(e.id, e.text));

    const popup = document.createElement('div');
    popup.className = 'clipboard-popup';
    popup.innerHTML = `
      <div class="popup-header">
        <h3>📋 Clipboard History (${stats.totalEntries} items)</h3>
        <div class="popup-controls">
          <button type="button" id="clear-clipboard" class="btn btn-danger">Clear All</button>
          <button type="button" class="close-btn" data-close-clipboard aria-label="Close">×</button>
        </div>
      </div>
      <div class="popup-content">
        <div class="clipboard-search">
          <input type="text" id="clipboard-search" placeholder="Search clipboard history..." class="search-input">
        </div>
        <div id="clipboard-list" class="clipboard-list">${renderClipboardItemsHtml(history)}</div>
      </div>
    `;

    document.body.appendChild(popup);

    const clipboardListEl = () => document.getElementById('clipboard-list');

    const setList = (entries: typeof history) => {
      entries.forEach((e) => textById.set(e.id, e.text));
      const el = clipboardListEl();
      if (el) {
        el.innerHTML = renderClipboardItemsHtml(entries);
      }
    };

    popup.addEventListener('click', async (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest('[data-close-clipboard]')) {
        popup.remove();
        return;
      }
      const copyId = target.closest('[data-copy-id]')?.getAttribute('data-copy-id');
      if (copyId && window.clipboardAPI) {
        const text = textById.get(copyId);
        if (text !== undefined) {
          await window.clipboardAPI.copy(text);
          const notification = document.createElement('div');
          notification.className = 'copy-notification';
          notification.textContent = 'Copied to clipboard!';
          document.body.appendChild(notification);
          setTimeout(() => notification.remove(), 2000);
        }
        return;
      }
      const removeId = target.closest('[data-remove-id]')?.getAttribute('data-remove-id');
      if (removeId && window.clipboardAPI) {
        await window.clipboardAPI.removeEntry(removeId);
        textById.delete(removeId);
        const next = await window.clipboardAPI.getHistory();
        next.forEach((e) => textById.set(e.id, e.text));
        setList(next);
      }
    });

    const searchInput = document.getElementById('clipboard-search') as HTMLInputElement;
    searchInput?.addEventListener('input', async (e) => {
      const query = (e.target as HTMLInputElement).value;
      if (query.trim()) {
        const results = await window.clipboardAPI.search(query);
        setList(results);
      } else {
        const allHistory = await window.clipboardAPI.getHistory();
        setList(allHistory);
      }
    });

    document.getElementById('clear-clipboard')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all clipboard history?')) {
        await window.clipboardAPI.clear();
        popup.remove();
      }
    });

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        popup.remove();
        document.removeEventListener('keydown', onKeydown);
      }
    };
    document.addEventListener('keydown', onKeydown);
  } catch (error) {
    console.error('Error loading clipboard history:', error);
  }
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
      rlog('[DBG][Settings] sourceStats:', sourceStats);
      rlog('[DBG][Settings] enabledSources:', enabledSources);
      
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
  const AUDIO_KEY = 'phevereAudioEnabled';
  const audioSpeedInput = document.getElementById('audio-speed') as HTMLInputElement;
  const speedValue = document.getElementById('speed-value');
  const enableAudio = document.getElementById('enable-audio') as HTMLInputElement | null;

  if (enableAudio) {
    enableAudio.checked = localStorage.getItem(AUDIO_KEY) !== '0';
    enableAudio.addEventListener('change', () => {
      localStorage.setItem(AUDIO_KEY, enableAudio.checked ? '1' : '0');
    });
  }

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
  rlog(`🔊 Playing audio for "${word}" with ${accent} accent`);
  
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
          rlog('🔄 [DEBUG] Source language changed:', (e.target as HTMLSelectElement).value);
          const text = document.getElementById('selected-text')?.textContent;
          if (text) {
            updatePopupContent(text);
          }
        });
        
        targetLangSelect.addEventListener('change', (e) => {
          rlog('🔄 [DEBUG] Target language changed:', (e.target as HTMLSelectElement).value);
          const text = document.getElementById('selected-text')?.textContent;
          if (text) {
            updatePopupContent(text);
          }
        });
        
        // Debug: Log initial dropdown setup
        rlog('🔄 [DEBUG] Language selectors initialized:', {
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
    'Princeton WordNet 3.1': '🔗',
    'WordNet': '🔗',
    "Webster's Unabridged 1913 (GCIDE)": '📘',
    'FreeDict English–Chinese': '🈶',
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
  rlog('[POPUP-RENDERER] updatePopupContent with text:', (text||'').slice(0,80), `(${text.length} chars)`);
  const key = (text || '').trim();
  if (!key) return;
  if (key === __lastRenderedText) {
    rlog('[POPUP-RENDERER] skip duplicate render for same text');
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
      rlog('[DBG] Enabled sources at lookup time:', enabledSources);
    }
    
    // Use the dictionary service to get real results
    if (window.dictionaryAPI && typeof window.dictionaryAPI.lookup === 'function') {
      const result = await window.dictionaryAPI.lookup(text, targetLang, enabledSources);
      rlog('[POPUP-RENDERER] lookup summary:', {
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
      rlog('[POPUP-RENDERER] creating tabs for:', tabSources);
      createTabs(result, tabSources);

      // Ask main to resize the window once per text to prevent jumping
      try {
        if (__lastResizedForText !== key) {
          const desiredW = 420;
          const desiredH = 260;
          window.electronAPI?.resizeWindow(desiredW, desiredH);
          __lastResizedForText = key;
          rlog('[POPUP-RENDERER] requested one-time resize:', desiredW, desiredH);
        }
      } catch {}
    } else {
      rlog('⚠️ Dictionary API not available, using mock data');
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
  rlog(`🔊 [DEBUG] playAudio called with word: "${word}", accent: "${accent}"`);
  rlog(`🔊 [DEBUG] speechSynthesis available:`, 'speechSynthesis' in window);
  
  try {
    // Check if Web Speech API is supported
    if ('speechSynthesis' in window) {
      const initVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          rlog(`🔊 [DEBUG] Voices loaded: ${voices.length}`);
          speak(word, accent, voices);
        } else {
          rlog(`🔊 [DEBUG] Voices not loaded yet, will try again`);
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
  rlog(`🔊 [DEBUG] speak called with word: "${word}", accent: "${accent}"`);
  
  try {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    rlog(`🔊 [DEBUG] Previous speech cancelled`);
    
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
    rlog('🧪 Testing multi-source dictionary service...');
    
    // Test with a common word
    const testWord = 'hello';
    const result = await window.dictionaryAPI?.lookup(testWord, 'zh');
    
    rlog('✅ Multi-source dictionary test result:', result);
    
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
    rlog('🔍 Performing lookup for:', text);
    
    // Use the dictionary service to get real results
    if (window.dictionaryAPI && typeof window.dictionaryAPI.lookup === 'function') {
      const result = await window.dictionaryAPI.lookup(text);
      rlog('✅ Dictionary result received:', result);
      
      // Update popup content with results
      displayDictionaryResultInPopup(result, popup);
    } else {
      rlog('⚠️ Dictionary API not available, using mock data');
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


