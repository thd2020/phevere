/**
 * Settings → API keys: one key-tag card per provider with status, Test, reveal and clear.
 * Shared by the desktop Settings window and the phone's Settings tab; each app
 * wires the `data-act` attributes. Styles: settings-keys.css.
 */

import type { ApiProviderId } from './api-key-check';
import { esc, linkHtml, SVG } from './settings-kit';

export interface ApiKeyField {
  /** Phone preference name; desktop maps it to an IPC setter. */
  pref: string;
  label: string;
  secret: boolean;
}

export interface ApiProviderInfo {
  id: ApiProviderId;
  name: string;
  mark: string;
  /** What the key turns on in Phevere. */
  unlocks: string;
  console: string;
  fields: ApiKeyField[];
}

export const API_PROVIDERS: ApiProviderInfo[] = [
  {
    id: 'google',
    name: 'Google Translate',
    mark: 'G',
    unlocks: 'Translations and language detection through the Cloud Translation API',
    console: 'https://console.cloud.google.com/apis/credentials',
    fields: [{ pref: 'googleKey', label: 'API key', secret: true }],
  },
  {
    id: 'deepl',
    name: 'DeepL',
    mark: 'D',
    unlocks: 'DeepL as the translation engine',
    console: 'https://www.deepl.com/your-account/keys',
    fields: [{ pref: 'deeplKey', label: 'Authentication key', secret: true }],
  },
  {
    id: 'youdao',
    name: 'Youdao',
    mark: '有',
    unlocks: 'Youdao translation and Youdao dictionary entries',
    console: 'https://ai.youdao.com/console/',
    fields: [
      { pref: 'youdaoKey', label: 'App key', secret: true },
      { pref: 'youdaoSecret', label: 'App secret', secret: true },
    ],
  },
  {
    id: 'oxford',
    name: 'Oxford Dictionaries',
    mark: 'Ox',
    unlocks: 'Oxford definitions and etymologies in lookups',
    console: 'https://developer.oxforddictionaries.com/',
    fields: [
      { pref: 'oxfordId', label: 'App ID', secret: false },
      { pref: 'oxfordKey', label: 'App key', secret: true },
    ],
  },
  {
    id: 'wordsapi',
    name: 'WordsAPI',
    mark: 'Wa',
    unlocks: 'WordsAPI definitions and synonyms in lookups',
    console: 'https://rapidapi.com/dpventures/api/wordsapi',
    fields: [{ pref: 'wordsKey', label: 'RapidAPI key', secret: true }],
  },
  {
    id: 'collins',
    name: 'Collins',
    mark: 'Co',
    unlocks: 'Collins definitions in lookups',
    console: 'https://rapidapi.com/search/collins',
    fields: [
      { pref: 'collinsKey', label: 'RapidAPI key', secret: true },
      { pref: 'collinsHost', label: 'API host', secret: false },
    ],
  },
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

const STATUS_LABEL: Record<KeyStatus, string> = {
  unset: 'Not set',
  saved: 'Saved',
  testing: 'Testing…',
  verified: 'Verified',
  failed: 'Failed',
};

export function apiKeyCardHtml(p: ApiProviderInfo, st: KeyCardState): string {
  const fields = p.fields
    .map((f) => {
      const value = st.values?.[f.pref] || '';
      const shown = !f.secret || !!st.revealed?.has(f.pref);
      const id = `sv-key-${p.id}-${f.pref}`;
      const placeholder = st.savedHidden && !value ? (f.secret ? '•••••••••••• saved' : 'Saved') : '';
      return `<div class="sv-field">
        <label class="sv-field__label" for="${id}">${esc(f.label)}</label>
        <span class="sv-field__box">
          <input id="${id}" class="sv-field__input" type="${shown ? 'text' : 'password'}" data-pref="${esc(f.pref)}" data-provider="${p.id}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" />
          ${f.secret ? `<button type="button" class="sv-icon sv-icon--small" data-act="key-reveal" data-provider="${p.id}" data-pref="${esc(f.pref)}" aria-label="${shown ? 'Hide' : 'Show'} ${esc(f.label)}" aria-pressed="${shown}">${shown ? SVG.eyeOff : SVG.eye}</button>` : ''}
          <button type="button" class="sv-icon sv-icon--small" data-act="key-clear" data-provider="${p.id}" data-pref="${esc(f.pref)}" aria-label="Clear ${esc(f.label)}">${SVG.close}</button>
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
      <span class="sv-key__status" role="status">${st.status === 'verified' ? SVG.check : ''}${STATUS_LABEL[st.status]}</span>
    </header>
    <div class="sv-key__fields">${fields}</div>
    <footer class="sv-key__foot">
      ${linkHtml(p.console, 'Get a key')}
      <span class="sv-key__msg">${st.status === 'failed' && st.message ? esc(st.message) : ''}</span>
      <button type="button" class="sv-btn" data-act="key-test" data-provider="${p.id}"${canTest ? '' : ' disabled'}>${st.status === 'testing' ? 'Testing…' : 'Test'}</button>
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
