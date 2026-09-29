import type { DictionarySource } from '@phevere/core';
import type { CatalogStatus } from './platform/offline';
import type { MobilePrefs } from './platform/prefs';

export type VoiceStatus = {
  selected: string;
  /** iOS: the installed system voices, listed as plain choices (no downloads). */
  rows?: Array<{ id: string; name: string; detail: string }>;
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
  /** LSPosed module working (modern service connected, or a lookup came through it). */
  moduleActive?: boolean;
  moduleFramework?: string;
  /** -1: system placement; otherwise Phevere's slot on the selection bar. */
  barSlot?: number;
};

/** Typical main row of Android's selection bar, for placing Phevere. */
export const MOCK_BAR = ['Cut', 'Copy', 'Paste', 'Select all', 'Share'];

/** Mock selection bar: drag the Phevere chip (or use the arrows) to choose its slot. */
export function mockBarHtml(slot: number): string {
  const at = Math.max(0, Math.min(MOCK_BAR.length, slot));
  const chips = MOCK_BAR.map((label) => `<span class="mock-bar__item">${esc(label)}</span>`);
  chips.splice(at, 0, `<span class="mock-bar__item mock-bar__ours" data-drag="bar-slot" role="slider" tabindex="0"
    aria-label="Phevere position on the selection bar" aria-valuemin="0" aria-valuemax="${MOCK_BAR.length}" aria-valuenow="${at}">Phevere</span>`);
  return `<div class="mock-bar-wrap">
    <button type="button" class="icon-btn" data-act="bar-slot-step" data-step="-1" aria-label="Move Phevere left" ${at === 0 ? 'disabled' : ''}>${ICON.left}</button>
    <div class="mock-bar" data-mock-bar>${chips.join('')}</div>
    <button type="button" class="icon-btn" data-act="bar-slot-step" data-step="1" aria-label="Move Phevere right" ${at === MOCK_BAR.length ? 'disabled' : ''}>${ICON.right}</button>
  </div>`;
}

const ICON = {
  trash: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  import: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M12 4v11M7 10l5 5 5-5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bell: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 21h4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  layers: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  overlay: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 5h11v11H4zM9 10h11v10H9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  left: '<svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 9.5h8M8 12.5h8M8 15.5h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  select: '<svg viewBox="0 0 24 24"><path d="M3 5h2V3a2 2 0 0 0-2 2m0 8h2v-2H3zm4 8h2v-2H7zM3 9h2V7H3zm10-6h-2v2h2zm6 0v2h2a2 2 0 0 0-2-2M5 21v-2H3a2 2 0 0 0 2 2m-2-4h2v-2H3zM9 3H7v2h2zm2 18h2v-2h-2zm8-8h2v-2h-2zm0 8a2 2 0 0 0 2-2h-2zm0-12h2V7h-2zm0 8h2v-2h-2zm-4 4h2v-2h-2zm0-16h2V3h-2zM7 17h10V7H7zm2-8h6v6H9z"/></svg>',
  a11y: '<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4m9 7h-6v13h-2v-6h-2v6H9V9H3V7h18z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
};

/** Material list row that opens something: leading icon, label, optional value, chevron. */
function navRow(act: string, icon: string, label: string, value = '', sub = ''): string {
  return `<button type="button" class="nav-row" data-act="${act}">
    <span class="nav-row__icon" aria-hidden="true">${icon}</span>
    <span class="nav-row__label">${esc(label)}${sub ? `<small class="nav-row__sub">${esc(sub)}</small>` : ''}</span>
    ${value ? `<span class="nav-row__value">${esc(value)}</span>` : ''}
    <span class="nav-row__chevron" aria-hidden="true">${ICON.chevron}</span>
  </button>`;
}

/** What the LSPosed module does, for people who meet it here before reading the README. */
const MODULE_ABOUT = "Hooks the system selection toolbar in apps you scope: Phevere's slot, Phevere where apps hide it, and the instant press";

function selectionBarSection(capture: CaptureInfo): string {
  const instant = `<label class="toggle">
      <span class="src-name">Pop up on selection</span>
      <input type="checkbox" role="switch" data-act="auto-popup" ${capture.autoPopup ? 'checked' : ''} />
    </label>`;
  if (capture.moduleActive) {
    const slot = typeof capture.barSlot === 'number' ? capture.barSlot : -1;
    const custom = slot >= 0;
    const status = `<span class="status-pill">${ICON.check}${esc(capture.moduleFramework || 'LSPosed')}</span>`;
    const place = capture.autoPopup ? '' : `
    <div class="setting-row">
      <span class="src-name" id="bar-place-label">Position on bar</span>
      <div class="segmented" role="radiogroup" aria-labelledby="bar-place-label">
        <label class="segmented__item"><input type="radio" name="bar-place" data-act="bar-place" value="default" ${custom ? '' : 'checked'} />${ICON.check}System</label>
        <label class="segmented__item"><input type="radio" name="bar-place" data-act="bar-place" value="custom" ${custom ? 'checked' : ''} />${ICON.check}Custom</label>
      </div>
    </div>
    ${custom ? mockBarHtml(slot) : ''}`;
    return `<h3 class="settings-subhead settings-subhead--status">Selection bar ${status}</h3>
    ${instant}
    ${place}
    ${navRow('selection-setup', ICON.select, 'LSPosed setup', '', MODULE_ABOUT)}`;
  }
  const a11y = capture.autoPopup && !capture.accessibilityOn
    ? navRow('a11y-settings', ICON.a11y, 'Accessibility service', 'Off')
    : '';
  return `<h3 class="settings-subhead">Selection bar</h3>
    ${instant}
    ${a11y}
    ${navRow('selection-setup', ICON.select, 'LSPosed module', 'Inactive', MODULE_ABOUT)}`;
}

export type SettingsSection = 'capture' | 'notifications' | 'sources' | 'offline' | 'api' | 'audio';

const TAB_ICON: Record<SettingsSection, string> = {
  capture: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M9 9h6M12 9v7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  notifications: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 21h4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sources: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M5 4.5h4v15H5zM10.5 4.5h4v15h-4zM16 6l3.6-1 3 14.2-3.6 1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  offline: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v7M9 11l3 3 3-3M8.5 17h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  api: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M11 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM11 12h10M18 12v3M21 12v2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  audio: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4zM15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

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

/** The selected tab already names the panel, so panels open straight on their rows. */
function panelIntro(_title: string): string {
  return '';
}

function packArticle(p: CatalogStatus, action: 'download' | 'remove'): string {
  const btn =
    action === 'remove'
      ? `<button type="button" class="icon-btn pack__action" data-act="pack-rm" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}" title="Remove">${ICON.trash}</button>`
      : `<button type="button" class="icon-btn pack__action" data-act="pack-dl" data-id="${esc(p.id)}" aria-label="Download ${esc(p.name)}" title="Download">${ICON.download}</button>`;
  const extra = p.installed ? ` · ${p.entryCount} entries` : '';
  return `<article class="pack">
    <div class="pack__text">
      <strong>${esc(p.name)}</strong>
      <p class="hint">${esc(p.summary)} · ${esc(p.sizeHint)} · ${esc(p.license)}${extra}</p>
    </div>
    ${btn}
  </article>`;
}

function capturePanel(prefs: MobilePrefs, capture: CaptureInfo): string {
  const overlayBtn =
    capture.platform === 'android' && prefs.floatingStrip && !capture.canDrawOverlays
      ? navRow('overlay-perm', ICON.overlay, 'Draw over other apps', 'Off')
      : '';
  return `
    ${panelIntro('Capture')}
    ${capture.platform === 'android' ? `<label class="toggle">
      <span class="src-name">Floating pop-up</span>
      <input type="checkbox" role="switch" data-act="strip-on" ${prefs.floatingStrip ? 'checked' : ''} />
    </label>
    ${overlayBtn}
    ${selectionBarSection(capture)}
    <h3 class="settings-subhead">Scan</h3>` : ''}
    ${capture.platform === 'ios' ? `<label class="toggle">
      <span class="src-name">Floating pop-up</span>
      <input type="checkbox" role="switch" data-act="strip-on" ${prefs.floatingStrip ? 'checked' : ''} />
    </label>
    <h3 class="settings-subhead">Selection</h3>
    <label class="toggle">
      <span class="src-name">Pop up on selection</span>
      <input type="checkbox" role="switch" data-act="auto-popup" ${capture.autoPopup ? 'checked' : ''} />
    </label>
    <h3 class="settings-subhead">Scan</h3>` : ''}
    ${navRow('ocr', ICON.camera, 'Camera or photo')}`;
}

function notificationsPanel(prefs: MobilePrefs, capture: CaptureInfo): string {
  const allow = !capture.notificationsGranted
    ? navRow('notify-allow', ICON.bell, 'Notifications', 'Off')
    : '';
  return `
    ${panelIntro('Notifications')}
    ${allow}
    <label class="toggle">
      <span class="src-name">Incoming lookup</span>
      <input type="checkbox" role="switch" data-act="notify" data-key="incoming" ${prefs.notifyIncoming ? 'checked' : ''} />
    </label>
    <label class="toggle">
      <span class="src-name">Saved to notebook</span>
      <input type="checkbox" role="switch" data-act="notify" data-key="saved" ${prefs.notifySaved ? 'checked' : ''} />
    </label>
    <label class="toggle">
      <span class="src-name">Scan finished</span>
      <input type="checkbox" role="switch" data-act="notify" data-key="ocr" ${prefs.notifyOcr ? 'checked' : ''} />
    </label>
    ${navRow('notify-settings', ICON.bell, 'System notification settings')}`;
}

function sourcesPanel(prefs: MobilePrefs, sources: DictionarySource[]): string {
  const dictSources = sources.filter((s) => !TRANSLATION_ONLY.has(s.name));
  const src =
    dictSources
      .map((s) => {
        const avail = s.isAvailable ? '' : '<span class="src-meta">Needs a key or pack</span>';
        return `<label class="toggle">
        <span><span class="src-name">${esc(s.name)}</span>${avail}</span>
        <input type="checkbox" role="switch" data-act="src" data-name="${esc(s.name)}" ${s.enabled ? 'checked' : ''} />
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
    ${navRow('pack-file', ICON.import, 'Import pack', 'JSON, JSONL, CEDICT')}
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
      <label for="deepl-api-key">DeepL API key</label>
      <input id="deepl-api-key" data-pref="deeplKey" type="password" value="${esc(prefs.deeplKey)}" placeholder="Paste your DeepL API key" autocomplete="off" />
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
    </div>`;
}

const VOICE_ICON = {
  wave: '<svg viewBox="0 0 24 24"><path d="M7 18h2V6H7zm4 4h2V2h-2zm-8-8h2v-4H3zm12 4h2V6h-2zm4-8v4h2v-4z"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  cancel: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
};


/**
 * Material list pattern for downloadable options (as in Google's offline languages):
 * tap a row to use it; rows that need a download show the size and a download icon,
 * then a progress bar with cancel; the active voice carries a check.
 */
function voiceList(voice: VoiceStatus | null): string {
  if (!voice) return '';
  if (voice.rows) return systemVoiceList(voice.selected, voice.rows);
  const rows = [{ id: 'mechanical', mb: 0, ready: true }, ...voice.variants]
    .map((v) => {
      const on = voice.selected === v.id;
      const busy = voice.downloading === v.id;
      const meta = v.id === 'mechanical' ? 'Built in' : v.ready ? 'Downloaded' : `${v.mb} MB`;
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

/** iOS: installed voices as radio rows; iOS downloads more under Settings → Accessibility. */
function systemVoiceList(selected: string, rows: NonNullable<VoiceStatus['rows']>): string {
  const items = rows
    .map((v) => {
      const on = selected === v.id;
      return `<div class="voice-row${on ? ' is-on' : ''}">
        <button type="button" class="voice-row__main" role="radio" aria-checked="${on}" data-act="voice" data-value="${esc(v.id)}" aria-label="${esc(v.name)}">
          <span class="voice-row__icon">${VOICE_ICON.wave}</span>
          <span class="voice-row__text"><span>${esc(v.name)}</span><small>${esc(v.detail)}</small></span>
        </button>
        ${on ? `<span class="voice-row__check" aria-hidden="true">${VOICE_ICON.check}</span>` : ''}
      </div>`;
    })
    .join('');
  return `<h3 class="settings-subhead">Pronunciation voice</h3><div class="voice-list" role="radiogroup" aria-label="Pronunciation voice">${items}</div>`;
}

function audioPanel(prefs: MobilePrefs, capture: CaptureInfo, voice: VoiceStatus | null): string {
  const speed = Number.isFinite(prefs.audioSpeed) ? prefs.audioSpeed : 1;
  const volume = Math.round((Number.isFinite(prefs.audioVolume) ? prefs.audioVolume : 0.5) * 100);
  return `
    ${panelIntro('Audio')}
    <label class="toggle">
      <span class="src-name">Pronunciation</span>
      <input type="checkbox" role="switch" data-act="audio-on" ${prefs.audioEnabled ? 'checked' : ''} />
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
    ${capture.platform !== 'web' ? voiceList(voice) : ''}`;
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
        `<button type="button" class="result-tab" role="tab" data-act="settings-section" data-section="${s.id}" aria-selected="${section === s.id}" aria-label="${s.label}" title="${s.label}">${TAB_ICON[s.id]}</button>`,
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
        <div class="result-tabs settings-tabs" role="tablist" aria-label="Settings sections" style="--tabs:${settingsSections(capture).length}">${tabs}</div>
      </div>
      <div class="settings-panel" role="tabpanel">${panel}</div>
    </div>`;
}
