/**
 * Settings → API keys: one key-tag card per provider with status, Test, reveal and clear.
 * Shared by the desktop Settings window and the phone's Settings tab; each app
 * wires the `data-act` attributes. Styles: settings-keys.css.
 */

import type { ApiProviderId } from './api-key-check';
import { t, tHtml, type MessageKey } from './i18n/runtime';
import { esc, linkHtml, SVG } from './settings-kit';

export interface ApiKeyField {
  /** Phone preference name; desktop maps it to an IPC setter. */
  pref: string;
  /** In the interface language, read when it is shown. */
  readonly label: string;
  secret: boolean;
}

export interface ApiProviderInfo {
  id: ApiProviderId;
  name: string;
  mark: string;
  /** What the key turns on in Phevere, in the interface language, read when it is shown. */
  readonly unlocks: string;
  console: string;
  fields: ApiKeyField[];
}

/** A field whose label follows the interface language. */
function field(pref: string, labelKey: MessageKey, secret: boolean): ApiKeyField {
  return {
    pref,
    secret,
    get label() {
      return t(labelKey);
    },
  };
}

/** A provider whose `unlocks` line follows the interface language. */
function provider(p: Omit<ApiProviderInfo, 'unlocks'>, unlocksKey: MessageKey): ApiProviderInfo {
  return Object.defineProperty(p, 'unlocks', { get: () => t(unlocksKey), enumerable: true }) as ApiProviderInfo;
}

export const API_PROVIDERS: ApiProviderInfo[] = [
  provider(
    {
      id: 'google',
      name: 'Google Translate',
      mark: 'G',
      console: 'https://console.cloud.google.com/apis/credentials',
      fields: [field('googleKey', 'settings.keys.field.apiKey', true)],
    },
    'settings.keys.unlocks.google',
  ),
  provider(
    {
      id: 'deepl',
      name: 'DeepL',
      mark: 'D',
      console: 'https://www.deepl.com/your-account/keys',
      fields: [field('deeplKey', 'settings.keys.field.authKey', true)],
    },
    'settings.keys.unlocks.deepl',
  ),
  provider(
    {
      id: 'youdao',
      name: 'Youdao',
      mark: '有',
      console: 'https://ai.youdao.com/console/',
      fields: [field('youdaoKey', 'settings.keys.field.appKey', true), field('youdaoSecret', 'settings.keys.field.appSecret', true)],
    },
    'settings.keys.unlocks.youdao',
  ),
  provider(
    {
      id: 'oxford',
      name: 'Oxford Dictionaries',
      mark: 'Ox',
      console: 'https://developer.oxforddictionaries.com/',
      fields: [field('oxfordId', 'settings.keys.field.appId', false), field('oxfordKey', 'settings.keys.field.appKey', true)],
    },
    'settings.keys.unlocks.oxford',
  ),
  provider(
    {
      id: 'wordsapi',
      name: 'WordsAPI',
      mark: 'Wa',
      console: 'https://rapidapi.com/dpventures/api/wordsapi',
      fields: [field('wordsKey', 'settings.keys.field.rapidApiKey', true)],
    },
    'settings.keys.unlocks.wordsapi',
  ),
  provider(
    {
      id: 'collins',
      name: 'Collins',
      mark: 'Co',
      console: 'https://rapidapi.com/search/collins',
      fields: [field('collinsKey', 'settings.keys.field.rapidApiKey', true), field('collinsHost', 'settings.keys.field.apiHost', false)],
    },
    'settings.keys.unlocks.collins',
  ),
];

export type KeyStatus = 'unset' | 'saved' | 'testing' | 'verified' | 'failed';

export interface KeyCardState {
  status: KeyStatus;
  message?: string;
  /** Current field values where the app holds them (phone); desktop leaves them empty. */
  values?: Record<string, string>;
  /** Fields shown in plain text. */
  revealed?: Set<string>;
  /** Credentials saved but not readable here (desktop): fields show a saved placeholder. */
  savedHidden?: boolean;
  /** Scroll target from a Sources "API key required" link. */
  highlight?: boolean;
}

const STATUS_LABEL: Record<KeyStatus, MessageKey> = {
  unset: 'settings.keys.status.unset',
  saved: 'settings.keys.status.saved',
  testing: 'settings.keys.status.testing',
  verified: 'settings.keys.status.verified',
  failed: 'settings.keys.status.failed',
};

export function apiKeyCardHtml(p: ApiProviderInfo, st: KeyCardState): string {
  const fields = p.fields
    .map((f) => {
      const value = st.values?.[f.pref] || '';
      const shown = !f.secret || !!st.revealed?.has(f.pref);
      const id = `sv-key-${p.id}-${f.pref}`;
      const placeholder = st.savedHidden && !value ? t(f.secret ? 'settings.keys.savedSecret' : 'settings.keys.savedPlain') : '';
      return `<div class="sv-field">
        <label class="sv-field__label" for="${id}">${esc(f.label)}</label>
        <span class="sv-field__box">
          <input id="${id}" class="sv-field__input" type="${shown ? 'text' : 'password'}" data-pref="${esc(f.pref)}" data-provider="${p.id}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" />
          ${f.secret ? `<button type="button" class="sv-icon sv-icon--small" data-act="key-reveal" data-provider="${p.id}" data-pref="${esc(f.pref)}" aria-label="${tHtml(shown ? 'settings.keys.hide' : 'settings.keys.show', { field: f.label })}" aria-pressed="${shown}">${shown ? SVG.eyeOff : SVG.eye}</button>` : ''}
          <button type="button" class="sv-icon sv-icon--small" data-act="key-clear" data-provider="${p.id}" data-pref="${esc(f.pref)}" aria-label="${tHtml('settings.keys.clear', { field: f.label })}">${SVG.close}</button>
        </span>
      </div>`;
    })
    .join('');
  // Stays enabled while unset: typing a key and pressing Test straight away must work.
  const canTest = st.status !== 'testing';
  return `<section class="sv-key is-${st.status}${st.highlight ? ' is-highlight' : ''}" data-provider="${p.id}" aria-labelledby="sv-key-${p.id}-name">
    <span class="sv-key__hole" aria-hidden="true"></span>
    <header class="sv-key__head">
      <span class="sv-seal" aria-hidden="true">${esc(p.mark)}</span>
      <div class="sv-key__title">
        <h3 id="sv-key-${p.id}-name">${esc(p.name)}</h3>
        <p>${esc(p.unlocks)}</p>
      </div>
      <span class="sv-key__status" role="status">${st.status === 'verified' ? SVG.check : ''}${tHtml(STATUS_LABEL[st.status])}</span>
    </header>
    <div class="sv-key__fields">${fields}</div>
    <footer class="sv-key__foot">
      ${linkHtml(p.console, t('settings.keys.getKey'))}
      <span class="sv-key__msg">${st.status === 'failed' && st.message ? esc(st.message) : ''}</span>
      <button type="button" class="sv-btn" data-act="key-test" data-provider="${p.id}"${canTest ? '' : ' disabled'}>${tHtml(st.status === 'testing' ? 'settings.keys.status.testing' : 'settings.keys.test')}</button>
    </footer>
  </section>`;
}

export function apiKeysPanelHtml(states: Record<string, KeyCardState>): string {
  return `<div class="sv sv-keys">${API_PROVIDERS.map((p) => apiKeyCardHtml(p, states[p.id] || { status: 'unset' })).join('')}</div>`;
}

/**
 * Refresh one card's status, colours and Test button in place. Leaving a field fires
 * `change` just before a click on Test or Show lands; replacing the card then would
 * swallow that click, so callers patch on `change` and repaint only after clicks.
 */
export function patchApiKeyCard(card: Element, p: ApiProviderInfo, st: KeyCardState): void {
  const tmp = document.createElement('div');
  tmp.innerHTML = apiKeyCardHtml(p, st);
  const next = tmp.firstElementChild as HTMLElement | null;
  if (!next) return;
  card.className = next.className;
  for (const sel of ['.sv-key__status', '.sv-key__msg']) {
    const a = card.querySelector(sel);
    const b = next.querySelector(sel);
    if (a && b) a.innerHTML = b.innerHTML;
  }
  const btn = card.querySelector('[data-act="key-test"]') as HTMLButtonElement | null;
  const nextBtn = next.querySelector('[data-act="key-test"]') as HTMLButtonElement | null;
  if (btn && nextBtn) {
    btn.disabled = nextBtn.disabled;
    btn.textContent = nextBtn.textContent;
  }
}
