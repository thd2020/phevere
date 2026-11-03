import {
  API_PROVIDERS,
  SOURCE_INFO,
  TRANSLATION_ENGINES,
  apiKeysPanelHtml,
  choiceRowHtml,
  groupCatalogByLanguage,
  navRowHtml,
  rangeRowHtml,
  switchRowHtml,
  offlineShelvesHtml,
  packInspectorHtml,
  sourcesPanelHtml,
  type ApiProviderId,
  type DictionarySource,
  type KeyCardState,
  type KeyStatus,
  type PackDetails,
  type PackProgress,
  type PackView,
  type SourceRowInput,
} from '@phevere/core';
import type { CatalogStatus } from './platform/offline';
import type { MobilePrefs } from './platform/prefs';

export type VoiceStatus = {
  selected: string;
  /** iOS: the installed system voices, listed as plain choices above the Neural downloads. */
  rows?: Array<{ id: string; name: string; detail: string }>;
  downloading: string;
  progress: string;
  doneMb?: number;
  variants: Array<{ id: string; mb: number; ready: boolean }>;
};

const VOICE_NAMES: Record<string, string> = { compact: 'Neural (standard)', full: 'Neural (high quality)' };

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
  layers: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  left: '<svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 9.5h8M8 12.5h8M8 15.5h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  signIn: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l4 4-4 4M14 12H4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  signOut: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sync: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
};

/** Material list row that opens something: leading icon, label, optional value, chevron. */
function navRow(act: string, icon: string, label: string, value = '', sub = '', kind = ''): string {
  return `<button type="button" class="nav-row" data-act="${act}"${kind ? ` data-kind="${esc(kind)}"` : ''}>
    <span class="nav-row__icon" aria-hidden="true">${icon}</span>
    <span class="nav-row__label">${esc(label)}${sub ? `<small class="nav-row__sub">${esc(sub)}</small>` : ''}</span>
    ${value ? `<span class="nav-row__value">${esc(value)}</span>` : ''}
    <span class="nav-row__chevron" aria-hidden="true">${ICON.chevron}</span>
  </button>`;
}

/** What the LSPosed module does, for people who meet it here before reading the README. */
const MODULE_ABOUT = 'Adds Phevere to the text selection menu in chosen apps';

function selectionBarSection(capture: CaptureInfo): string {
  const instant = switchRowHtml({ label: 'Pop up on selection', on: !!capture.autoPopup, attrs: 'data-act="auto-popup"' });
  if (capture.moduleActive) {
    const slot = typeof capture.barSlot === 'number' ? capture.barSlot : -1;
    const custom = slot >= 0;
    const status = `<span class="sv-pill sv-pill--ok">${ICON.check}${esc(capture.moduleFramework || 'LSPosed')}</span>`;
    const place = capture.autoPopup ? '' : `
      <div class="sv-row">
        <span class="sv-row__text"><span class="sv-row__label" id="bar-place-label">Position on bar</span></span>
        <div class="sv-seg" role="radiogroup" aria-labelledby="bar-place-label">
          <label class="sv-seg__item"><input type="radio" name="bar-place" data-act="bar-place" value="default" ${custom ? '' : 'checked'} />System</label>
          <label class="sv-seg__item"><input type="radio" name="bar-place" data-act="bar-place" value="custom" ${custom ? 'checked' : ''} />Custom</label>
        </div>
      </div>
      ${custom ? `<div class="sv-row sv-row--bar">${mockBarHtml(slot)}</div>` : ''}`;
    return `<header class="sv-head"><h3 class="sv-head__title">Selection bar</h3>${status}</header>
    <div class="sv-ledger">
      ${instant}
      ${place}
      ${navRowHtml({ label: 'LSPosed module', sub: MODULE_ABOUT, attrs: 'data-act="selection-setup"' })}
    </div>`;
  }
  const a11y = capture.autoPopup && !capture.accessibilityOn
    ? navRowHtml({ label: 'Accessibility service', value: 'Off', attrs: 'data-act="a11y-settings"' })
    : '';
  return `<header class="sv-head"><h3 class="sv-head__title">Selection bar</h3></header>
    <div class="sv-ledger">
      ${instant}
      ${a11y}
      ${navRowHtml({ label: 'LSPosed module', sub: MODULE_ABOUT, value: 'Inactive', attrs: 'data-act="selection-setup"' })}
    </div>`;
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

/** The tabs are icons, so each panel starts with its name (added in settingsBody). */
function panelIntro(_title: string): string {
  return '';
}

/** State the Sources, Offline and API keys panels keep between repaints. */
export interface LibraryState {
  /** Open disclosures by their data-key. */
  openDetails: Set<string>;
  packProgress: PackProgress | null;
  /** Pack whose inspector sheet is open. */
  inspecting: string | null;
  /** The sheet was just opened, so this paint slides it in. */
  inspectorEntering: boolean;
  packDetails: Map<string, PackDetails>;
  keyResults: Map<string, { status: KeyStatus; message?: string }>;
  revealedKeys: Set<string>;
  /** Provider card a Sources "API key required" link jumped to. */
  highlightKey: string;
}

export function emptyLibraryState(): LibraryState {
  return {
    openDetails: new Set(),
    packProgress: null,
    inspecting: null,
    inspectorEntering: false,
    packDetails: new Map(),
    keyResults: new Map(),
    revealedKeys: new Set(),
    highlightKey: '',
  };
}

/** True when every field the provider needs is filled in. */
export function keyPresent(prefs: MobilePrefs, id: ApiProviderId): boolean {
  const p = API_PROVIDERS.find((x) => x.id === id);
  if (!p) return false;
  const values = prefs as unknown as Record<string, string>;
  return p.fields.every((f) => !!(values[f.pref] || '').trim());
}

function capturePanel(prefs: MobilePrefs, capture: CaptureInfo): string {
  const floating = switchRowHtml({ label: 'Floating pop-up', on: !!prefs.floatingStrip, attrs: 'data-act="strip-on"' });
  const overlay =
    capture.platform === 'android' && prefs.floatingStrip && !capture.canDrawOverlays
      ? navRowHtml({ label: 'Display over other apps', value: 'Off', attrs: 'data-act="overlay-perm"' })
      : '';
  const scan = `<div class="sv-ledger">${navRowHtml({ icon: ICON.camera, label: 'Camera or photo', attrs: 'data-act="ocr"' })}</div>`;
  const scanHead = '<header class="sv-head"><h3 class="sv-head__title">Scan</h3></header>';
  if (capture.platform === 'android') {
    return `<div class="sv sv-page">
      <div class="sv-ledger">${floating}${overlay}</div>
      ${selectionBarSection(capture)}
      ${scanHead}
      ${scan}
    </div>`;
  }
  if (capture.platform === 'ios') {
    return `<div class="sv sv-page">
      <div class="sv-ledger">${floating}</div>
      <header class="sv-head"><h3 class="sv-head__title">Selection</h3></header>
      <div class="sv-ledger">${switchRowHtml({ label: 'Pop up on selection', on: !!capture.autoPopup, attrs: 'data-act="auto-popup"' })}</div>
      ${scanHead}
      ${scan}
    </div>`;
  }
  return `<div class="sv sv-page">${scan}</div>`;
}

/** Pictures beside senses come from Wikimedia Commons, so their switch sits with the sources. */
function picturesHtml(prefs: MobilePrefs): string {
  return `<div class="sv sv-sources">
    <header class="sv-head"><h3 class="sv-head__title">Pictures</h3></header>
    <div class="sv-ledger">${switchRowHtml({ label: 'Pictures beside senses', on: prefs.senseImages !== false, attrs: 'data-act="sense-images"' })}</div>
  </div>`;
}

function notificationsPanel(prefs: MobilePrefs, capture: CaptureInfo): string {
  const allow = !capture.notificationsGranted
    ? navRowHtml({ label: 'Notifications', value: 'Off', attrs: 'data-act="notify-allow"' })
    : '';
  return `<div class="sv sv-page">
    <div class="sv-ledger">
      ${allow}
      ${switchRowHtml({ label: 'Incoming lookup', on: !!prefs.notifyIncoming, attrs: 'data-act="notify" data-key="incoming"' })}
      ${switchRowHtml({ label: 'Saved to notebook', on: !!prefs.notifySaved, attrs: 'data-act="notify" data-key="saved"' })}
      ${switchRowHtml({ label: 'Scan finished', on: !!prefs.notifyOcr, attrs: 'data-act="notify" data-key="ocr"' })}
      ${navRowHtml({ label: 'System notification settings', attrs: 'data-act="notify-settings"' })}
    </div>
  </div>`;
}

function sourcesPanel(prefs: MobilePrefs, sources: DictionarySource[], lib: LibraryState): string {
  const dictionary: SourceRowInput[] = sources
    .filter((s) => !TRANSLATION_ONLY.has(s.name))
    .map((s) => ({
      control: 'switch',
      name: s.name,
      label: s.name,
      info: SOURCE_INFO[s.name],
      on: s.enabled,
      blocked: !s.isAvailable,
      open: lib.openDetails.has(`src:switch:${s.name}`),
    }));
  const engines: SourceRowInput[] = TRANSLATION_ENGINES.map((e) => ({
    control: 'radio',
    name: e.id,
    label: e.label,
    info: e,
    on: prefs.translationProvider === e.id,
    blocked: !!e.key && !keyPresent(prefs, e.key),
    open: lib.openDetails.has(`src:radio:${e.id}`),
  }));
  return `
    ${panelIntro('Sources')}
    ${sourcesPanelHtml({ dictionary, engines })}
    ${picturesHtml(prefs)}`;
}

/** Packs under the language of their headwords, each a catalogue card; tapping one opens its sheet. */
function offlinePanel(packs: CatalogStatus[], packMsg: string, lib: LibraryState, platform: CaptureInfo['platform']): string {
  const views: PackView[] = packs;
  const open = lib.inspecting ? views.find((p) => p.id === lib.inspecting) : undefined;
  const details: PackDetails = {
    ...(open ? lib.packDetails.get(open.id) : {}),
    storedAt: platform === 'web' ? 'Browser storage for this site' : 'phevere.sqlite in app storage',
  };
  const progress = lib.packProgress;
  return `
    ${panelIntro('Offline dictionary')}
    ${packMsg ? `<p class="status" role="status">${esc(packMsg)}</p>` : ''}
    ${offlineShelvesHtml({ groups: groupCatalogByLanguage(views), progress })}
    <h3 class="settings-subhead">Import</h3>
    ${navRow('pack-file', ICON.import, 'Import pack', '', 'FreeDict TEI, JMdict JSON, Kengdic TSV, WordNet or GCIDE')}
    ${navRow('pack-file', ICON.import, 'Import CEDICT file', '', 'cedict_ts.u8', 'cedict')}
    ${open ? packInspectorHtml(open, details, progress && progress.id === open.id ? progress : null, !!progress, lib.inspectorEntering) : ''}`;
}

function apiPanel(prefs: MobilePrefs, lib: LibraryState): string {
  const values = prefs as unknown as Record<string, string>;
  const states: Record<string, KeyCardState> = {};
  for (const p of API_PROVIDERS) {
    const result = lib.keyResults.get(p.id);
    const fieldValues: Record<string, string> = {};
    for (const f of p.fields) fieldValues[f.pref] = values[f.pref] || '';
    states[p.id] = {
      status: result?.status || (keyPresent(prefs, p.id) ? 'saved' : 'unset'),
      message: result?.message,
      values: fieldValues,
      revealed: lib.revealedKeys,
      highlight: lib.highlightKey === p.id,
    };
  }
  return `
    ${panelIntro('API keys')}
    ${apiKeysPanelHtml(states)}`;
}

/**
 * Radio list for downloadable voices (as in Google's offline languages): tap a row to use it;
 * rows that need a download show the size and a download mark, then a progress bar with
 * cancel; the active voice carries a check.
 */
function voiceList(voice: VoiceStatus | null): string {
  if (!voice) return '';
  const rows = voice.rows
    ? systemVoiceRows(voice.selected, voice.rows) + voice.variants.map((v) => downloadRow(voice, v)).join('')
    : [{ id: 'mechanical', mb: 0, ready: true }, ...voice.variants].map((v) => downloadRow(voice, v)).join('');
  const note = !voice.downloading && voice.progress && !/^(Connecting|Downloading|Installing)/.test(voice.progress)
    ? `<p class="sv-note">${esc(voice.progress)}</p>`
    : '';
  return `<header class="sv-head"><h3 class="sv-head__title">Pronunciation voice</h3></header>
    <div class="sv-ledger" role="radiogroup" aria-label="Pronunciation voice">${rows}</div>${note}`;
}

function downloadRow(voice: VoiceStatus, v: VoiceStatus['variants'][number]): string {
  const busy = voice.downloading === v.id;
  const pct = busy && v.mb ? Math.min(100, Math.round(((voice.doneMb || 0) / v.mb) * 100)) : 0;
  const meta = busy
    ? `Downloading ${pct}%`
    : v.id === 'mechanical' ? 'Built-in' : v.ready ? 'Downloaded' : `${v.mb} MB`;
  const name = v.id === 'mechanical' ? 'Mechanical' : VOICE_NAMES[v.id] || v.id;
  return choiceRowHtml({
    name,
    meta,
    metaTone: busy ? 'busy' : v.ready && v.id !== 'mechanical' ? 'installed' : undefined,
    on: voice.selected === v.id,
    needsDownload: !v.ready,
    disabled: !!voice.downloading && !busy && !v.ready,
    attrs: `data-act="voice" data-value="${esc(v.id)}"`,
    ariaLabel: `${name}${v.ready ? '' : `, download ${v.mb} MB`}`,
    busy: busy ? { pct, cancelAttrs: 'data-act="voice-cancel"' } : undefined,
  });
}

/** iOS: installed voices as radio rows; iOS downloads more under Settings → Accessibility. */
function systemVoiceRows(selected: string, rows: NonNullable<VoiceStatus['rows']>): string {
  return rows
    .map((v) => choiceRowHtml({ name: v.name, meta: v.detail, on: selected === v.id, attrs: `data-act="voice" data-value="${esc(v.id)}"` }))
    .join('');
}

function audioPanel(prefs: MobilePrefs, capture: CaptureInfo, voice: VoiceStatus | null): string {
  const speed = Number.isFinite(prefs.audioSpeed) ? prefs.audioSpeed : 1;
  const volume = Math.round((Number.isFinite(prefs.audioVolume) ? prefs.audioVolume : 0.5) * 100);
  return `<div class="sv sv-page">
    <div class="sv-ledger">${switchRowHtml({ label: 'Pronunciation', on: !!prefs.audioEnabled, attrs: 'data-act="audio-on"' })}</div>
    ${capture.platform !== 'web' ? voiceList(voice) : ''}
    <header class="sv-head"><h3 class="sv-head__title">Playback</h3></header>
    <div class="sv-ledger">
      ${rangeRowHtml({ label: 'Speed', id: 'audio-speed', min: 0.5, max: 2, step: 0.1, value: speed, valueId: 'speed-value', valueText: `${speed.toFixed(1)}×`, attrs: 'data-act="audio-speed"' })}
      ${rangeRowHtml({ label: 'Volume', id: 'audio-volume', min: 0, max: 100, step: 5, value: volume, valueId: 'volume-value', valueText: `${volume}%`, attrs: 'data-act="audio-volume"' })}
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
  voice: VoiceStatus | null = null,
  lib: LibraryState = emptyLibraryState(),
): string {
  const tabs = settingsSections(capture)
    .map(
      (s) =>
        `<button type="button" class="result-tab" role="tab" data-act="settings-section" data-section="${s.id}" aria-selected="${section === s.id}" aria-label="${s.label}" title="${s.label}">${TAB_ICON[s.id]}</button>`,
    )
    .join('');
  const sections = settingsSections(capture);
  const current = sections.find((s) => s.id === section) || sections[0];
  section = current.id;
  const panel =
    section === 'capture'
      ? capturePanel(prefs, capture)
      : section === 'notifications'
        ? notificationsPanel(prefs, capture)
        : section === 'sources'
          ? sourcesPanel(prefs, sources, lib)
          : section === 'offline'
            ? offlinePanel(packs, packMsg, lib, capture.platform)
            : section === 'api'
              ? apiPanel(prefs, lib)
              : audioPanel(prefs, capture, voice);
  return `
    <div class="settings">
      <div class="settings-sticky">
        <div class="result-tabs settings-tabs" role="tablist" aria-label="Settings sections" style="--tabs:${settingsSections(capture).length}">${tabs}</div>
      </div>
      <div class="settings-panel" role="tabpanel" aria-label="${current.label}"><h2 class="settings-panel__name">${current.label}</h2>${panel}</div>
    </div>`;
}
