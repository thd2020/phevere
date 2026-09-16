import type { DictionarySource } from '@phevere/core';
import type { CatalogStatus } from './platform/offline';
import type { MobilePrefs } from './platform/prefs';

function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type CaptureInfo = {
  platform: 'web' | 'android' | 'ios';
  canDrawOverlays: boolean;
  notificationsGranted?: boolean;
};

export type SettingsSection = 'capture' | 'notifications' | 'sources' | 'offline' | 'api' | 'audio';

export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'capture', label: 'Capture' },
  { id: 'sources', label: 'Sources' },
  { id: 'offline', label: 'Offline' },
  { id: 'api', label: 'API keys' },
  { id: 'audio', label: 'Audio' },
];

export function settingsSections(capture: CaptureInfo): Array<{ id: SettingsSection; label: string }> {
  if (capture.platform === 'web') return SETTINGS_SECTIONS;
  return [
    { id: 'capture', label: 'Capture' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'sources', label: 'Sources' },
    { id: 'offline', label: 'Offline' },
    { id: 'api', label: 'API keys' },
    { id: 'audio', label: 'Audio' },
  ];
}

const TRANSLATION_ONLY = new Set(['DeepL API', 'Google Translate API']);

function panelIntro(title: string): string {
  return `<div class="settings-panel__intro">
    <h2 class="settings-panel__title">${esc(title)}</h2>
  </div>`;
}

function packArticle(p: CatalogStatus, action: 'download' | 'remove'): string {
  const btn =
    action === 'remove'
      ? `<button type="button" class="danger" data-act="pack-rm" data-id="${esc(p.id)}">Remove</button>`
      : `<button type="button" class="filled" data-act="pack-dl" data-id="${esc(p.id)}">Download</button>`;
  const extra = p.installed ? ` · ${p.entryCount} entries` : '';
  return `<article class="pack">
    <strong>${esc(p.name)}</strong>
    <p class="hint">${esc(p.summary)} · ${esc(p.sizeHint)} · ${esc(p.license)}${extra}</p>
    ${btn}
  </article>`;
}

function capturePanel(_prefs: MobilePrefs, capture: CaptureInfo): string {
  const overlayBtn =
    capture.platform === 'android' && !capture.canDrawOverlays
      ? `<div class="toolbar-row"><button type="button" class="outlined" data-act="overlay-perm">Allow draw over other apps</button></div>`
      : '';
  return `
    ${panelIntro('Capture')}
    <button type="button" class="settings-dropzone" data-act="ocr">
      <strong>Camera or photo</strong>
      <span>Text stays on the picture</span>
    </button>
    ${overlayBtn}`;
}

function notificationsPanel(prefs: MobilePrefs, capture: CaptureInfo): string {
  const allow = !capture.notificationsGranted
    ? `<div class="toolbar-row"><button type="button" class="filled" data-act="notify-allow">Allow notifications</button></div>`
    : '';
  return `
    ${panelIntro('Notifications')}
    ${allow}
    <label class="toggle">
      <span class="src-name">Incoming lookup</span>
      <input type="checkbox" data-act="notify" data-key="incoming" ${prefs.notifyIncoming ? 'checked' : ''} />
    </label>
    <label class="toggle">
      <span class="src-name">Saved to notebook</span>
      <input type="checkbox" data-act="notify" data-key="saved" ${prefs.notifySaved ? 'checked' : ''} />
    </label>
    <label class="toggle">
      <span class="src-name">Scan finished</span>
      <input type="checkbox" data-act="notify" data-key="ocr" ${prefs.notifyOcr ? 'checked' : ''} />
    </label>
    <div class="toolbar-row"><button type="button" class="outlined" data-act="notify-settings">Notification settings</button></div>`;
}

function sourcesPanel(prefs: MobilePrefs, sources: DictionarySource[]): string {
  const dictSources = sources.filter((s) => !TRANSLATION_ONLY.has(s.name));
  const src =
    dictSources
      .map((s) => {
        const avail = s.isAvailable ? '' : ' · Needs a key or pack';
        return `<label class="toggle">
        <span><span class="src-name">${esc(s.name)}</span><span class="src-meta">Priority: ${s.priority}${avail}</span></span>
        <input type="checkbox" data-act="src" data-name="${esc(s.name)}" ${s.enabled ? 'checked' : ''} />
      </label>`;
      })
      .join('') || '<p class="hint">No dictionary sources loaded.</p>';
  const engines: Array<{ id: MobilePrefs['translationProvider']; label: string; detail: string }> = [
    { id: 'auto', label: 'Auto', detail: 'Google Translate, then MyMemory' },
    { id: 'google', label: 'Google Translate', detail: 'No API key' },
    { id: 'mymemory', label: 'MyMemory', detail: 'No API key' },
    { id: 'youdao', label: 'Youdao', detail: 'API key required' },
    { id: 'deepl', label: 'DeepL', detail: 'API key required' },
  ];
  const engine = engines
    .map(
      (e) => `<label class="radio"><span><span class="src-name">${e.label}</span><span class="src-meta">${e.detail}</span></span>
        <input type="radio" name="engine" data-act="engine" value="${e.id}" ${prefs.translationProvider === e.id ? 'checked' : ''} /></label>`,
    )
    .join('');
  return `
    ${panelIntro('Sources')}
    <h3 class="settings-subhead">Dictionary</h3>
    ${src}
    <h3 class="settings-subhead">Translation</h3>
    ${engine}`;
}

function offlinePanel(packs: CatalogStatus[], packMsg: string): string {
  const catalog = packs.filter((p) => !p.installed);
  const installed = packs.filter((p) => p.installed);
  const catalogHtml =
    catalog.map((p) => packArticle(p, 'download')).join('') ||
    '<p class="hint">All catalog packs are installed.</p>';
  const installedHtml =
    installed.map((p) => packArticle(p, 'remove')).join('') || '<p class="hint">None yet.</p>';
  return `
    ${panelIntro('Offline dictionary')}
    ${catalogHtml}
    <div class="toolbar-row">
      <button type="button" class="outlined" data-act="pack-file">Import JSON / JSONL</button>
      <button type="button" class="outlined" data-act="pack-file">Import CEDICT file</button>
      <button type="button" class="outlined" data-act="pack-refresh">Refresh</button>
    </div>
    ${packMsg ? `<p class="status">${esc(packMsg)}</p>` : ''}
    <h3 class="settings-subhead">Installed packs</h3>
    ${installedHtml}`;
}

function apiPanel(prefs: MobilePrefs): string {
  return `
    ${panelIntro('API keys')}
    <div class="keys">
      <label for="google-api-key">Google Translate API key</label>
      <input id="google-api-key" data-pref="googleKey" type="password" value="${esc(prefs.googleKey)}" placeholder="Paste your Google Cloud API key" autocomplete="off" />
      <div class="toolbar-row"><button type="button" class="filled" data-act="key-save" data-pref="googleKey">Save</button></div>
      <label for="deepl-api-key">DeepL API key</label>
      <input id="deepl-api-key" data-pref="deeplKey" type="password" value="${esc(prefs.deeplKey)}" placeholder="Paste your DeepL API key" autocomplete="off" />
      <div class="toolbar-row"><button type="button" class="filled" data-act="key-save" data-pref="deeplKey">Save</button></div>
    </div>
    <h3 class="settings-subhead">Oxford, Collins, Youdao, WordsAPI</h3>
    <div class="keys">
      <label>Youdao app key</label><input data-pref="youdaoKey" type="password" value="${esc(prefs.youdaoKey)}" autocomplete="off" />
      <label>Youdao secret</label><input data-pref="youdaoSecret" type="password" value="${esc(prefs.youdaoSecret)}" autocomplete="off" />
      <label>Oxford app id</label><input data-pref="oxfordId" type="password" value="${esc(prefs.oxfordId)}" autocomplete="off" />
      <label>Oxford app key</label><input data-pref="oxfordKey" type="password" value="${esc(prefs.oxfordKey)}" autocomplete="off" />
      <label>WordsAPI (RapidAPI)</label><input data-pref="wordsKey" type="password" value="${esc(prefs.wordsKey)}" autocomplete="off" />
      <label>Collins RapidAPI key</label><input data-pref="collinsKey" type="password" value="${esc(prefs.collinsKey)}" autocomplete="off" />
      <label>Collins host</label><input data-pref="collinsHost" value="${esc(prefs.collinsHost)}" autocomplete="off" />
      <div class="toolbar-row" style="margin-top:12px"><button type="button" class="filled" data-act="keys-save">Save keys</button></div>
    </div>`;
}

function audioPanel(prefs: MobilePrefs): string {
  const speed = Number.isFinite(prefs.audioSpeed) ? prefs.audioSpeed : 1;
  return `
    ${panelIntro('Audio')}
    <label class="toggle">
      <span class="src-name">Enable pronunciation</span>
      <input type="checkbox" data-act="audio-on" ${prefs.audioEnabled ? 'checked' : ''} />
    </label>
    <div class="settings-field">
      <label for="audio-speed">Playback speed</label>
      <div class="settings-audio-range">
        <input id="audio-speed" type="range" min="0.5" max="2" step="0.1" value="${speed}" data-act="audio-speed" />
        <span id="speed-value">${speed}×</span>
      </div>
    </div>`;
}

export function settingsBody(
  prefs: MobilePrefs,
  sources: DictionarySource[],
  packs: CatalogStatus[],
  packMsg: string,
  capture: CaptureInfo,
  section: SettingsSection,
): string {
  const tabs = settingsSections(capture)
    .map(
      (s) =>
        `<button type="button" class="chip" role="tab" data-act="settings-section" data-section="${s.id}" aria-selected="${section === s.id}">${s.label}</button>`,
    )
    .join('');
  const panel =
    section === 'capture'
      ? capturePanel(prefs, capture)
      : section === 'notifications'
        ? notificationsPanel(prefs, capture)
        : section === 'sources'
          ? sourcesPanel(prefs, sources)
          : section === 'offline'
            ? offlinePanel(packs, packMsg)
            : section === 'api'
              ? apiPanel(prefs)
              : audioPanel(prefs);
  return `
    <div class="settings">
      <div class="settings-sticky">
        <header class="settings-head">
          <p class="settings-kicker">Phevere</p>
          <h1>Settings</h1>
        </header>
        <div class="settings-tabs" role="tablist" aria-label="Settings sections">${tabs}</div>
      </div>
      <div class="settings-panel" role="tabpanel">${panel}</div>
    </div>`;
}
