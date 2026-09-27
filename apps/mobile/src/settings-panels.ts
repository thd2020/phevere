import type { DictionarySource } from '@phevere/core';
import type { CatalogStatus } from './platform/offline';
import type { MobilePrefs } from './platform/prefs';

export type VoiceStatus = {
  selected: string;
  downloading: string;
  progress: string;
  doneMb?: number;
  variants: Array<{ id: string; mb: number; ready: boolean }>;
};

const VOICE_NAMES: Record<string, string> = { compact: 'Neural compact', full: 'Neural full quality' };

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
  autoPopup?: boolean;
  accessibilityOn?: boolean;
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

function capturePanel(prefs: MobilePrefs, capture: CaptureInfo): string {
  const overlayBtn =
    capture.platform === 'android' && !capture.canDrawOverlays
      ? `<div class="toolbar-row"><button type="button" class="outlined" data-act="overlay-perm">Allow draw over other apps</button></div>`
      : '';
  return `
    ${panelIntro('Capture')}
    ${capture.platform === 'android' ? `<label class="toggle">
      <span class="src-name">Floating lookup popup</span>
      <input type="checkbox" data-act="strip-on" ${prefs.floatingStrip ? 'checked' : ''} />
    </label>
    <label class="toggle">
      <span class="src-name">Pop up as soon as text is selected<span class="hint">Off: select text, then tap Phevere in the selection menu</span></span>
      <input type="checkbox" data-act="auto-popup" ${capture.autoPopup ? 'checked' : ''} />
    </label>
    ${capture.autoPopup && !capture.accessibilityOn ? `<div class="toolbar-row">
      <p class="hint">Needs Phevere turned on under Accessibility. Chrome does not report page selections there; use the menu item in Chrome.</p>
      <button type="button" class="outlined" data-act="a11y-settings">Open Accessibility settings</button>
    </div>` : ''}
    <button type="button" class="outlined" data-act="selection-setup">Put Phevere first · LSPosed setup</button>` : ''}
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

const VOICE_ICON = {
  wave: '<svg viewBox="0 0 24 24"><path d="M7 18h2V6H7zm4 4h2V2h-2zm-8-8h2v-4H3zm12 4h2V6h-2zm4-8v4h2v-4z"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  cancel: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
};
const VOICE_BLURB: Record<string, string> = {
  mechanical: 'Built in · robotic, reads IPA exactly',
  compact: 'Natural voice · smaller download',
  full: 'Most natural voice',
};

/**
 * Material list pattern for downloadable options (as in Google's offline languages):
 * tap a row to use it; rows that need a download show the size and a download icon,
 * then a progress bar with cancel; the active voice carries a check.
 */
function voiceList(voice: VoiceStatus | null): string {
  if (!voice) return '';
  const rows = [{ id: 'mechanical', mb: 0, ready: true }, ...voice.variants]
    .map((v) => {
      const on = voice.selected === v.id;
      const busy = voice.downloading === v.id;
      const meta = v.id === 'mechanical'
        ? VOICE_BLURB.mechanical
        : `${VOICE_BLURB[v.id] || ''} · ${v.mb} MB${v.ready ? ' · downloaded' : ''}`;
      const trailing = busy
        ? `<button type="button" class="icon-btn voice-row__action" data-act="voice-cancel" aria-label="Cancel download">${VOICE_ICON.cancel}</button>`
        : on
          ? `<span class="voice-row__check" aria-hidden="true">${VOICE_ICON.check}</span>`
          : !v.ready
            ? `<span class="voice-row__dl" aria-hidden="true">${VOICE_ICON.download}</span>`
            : '';
      const pct = busy && v.mb ? Math.min(100, Math.round(((voice.doneMb || 0) / v.mb) * 100)) : 0;
      const bar = busy
        ? `<div class="voice-row__progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
           <small class="voice-row__status">${esc(voice.progress)}</small>`
        : '';
      const name = v.id === 'mechanical' ? 'Mechanical' : VOICE_NAMES[v.id] || v.id;
      const blocked = !!voice.downloading && !busy && !v.ready;
      return `<div class="voice-row${on ? ' is-on' : ''}">
        <button type="button" class="voice-row__main" role="radio" aria-checked="${on}" data-act="voice" data-value="${v.id}" ${blocked ? 'disabled' : ''} aria-label="${esc(name)}${v.ready ? '' : `, download ${v.mb} MB`}">
          <span class="voice-row__icon">${VOICE_ICON.wave}</span>
          <span class="voice-row__text"><span>${esc(name)}</span><small>${esc(meta)}</small></span>
        </button>
        ${trailing}
        ${bar}
      </div>`;
    })
    .join('');
  const note = !voice.downloading && voice.progress && !/^(Connecting|Downloading|Installing)/.test(voice.progress)
    ? `<p class="hint">${esc(voice.progress)}</p>`
    : '';
  return `<h3 class="settings-subhead">Pronunciation voice</h3><div class="voice-list" role="radiogroup" aria-label="Pronunciation voice">${rows}</div>${note}`;
}

function audioPanel(prefs: MobilePrefs, capture: CaptureInfo, voice: VoiceStatus | null): string {
  const speed = Number.isFinite(prefs.audioSpeed) ? prefs.audioSpeed : 1;
  const volume = Math.round((Number.isFinite(prefs.audioVolume) ? prefs.audioVolume : 1) * 100);
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
    </div>
    <div class="settings-field">
      <label for="audio-volume">Playback volume</label>
      <div class="settings-audio-range">
        <input id="audio-volume" type="range" min="0" max="100" step="5" value="${volume}" data-act="audio-volume" />
        <span id="volume-value">${volume}%</span>
      </div>
    </div>
    ${capture.platform === 'android' ? voiceList(voice) : ''}`;
}

export function settingsBody(
  prefs: MobilePrefs,
  sources: DictionarySource[],
  packs: CatalogStatus[],
  packMsg: string,
  capture: CaptureInfo,
  section: SettingsSection,
  voice: VoiceStatus | null = null,
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
              : audioPanel(prefs, capture, voice);
  return `
    <div class="settings">
      <div class="settings-sticky">
        <div class="settings-tabs" role="tablist" aria-label="Settings sections">${tabs}</div>
      </div>
      <div class="settings-panel" role="tabpanel">${panel}</div>
    </div>`;
}
