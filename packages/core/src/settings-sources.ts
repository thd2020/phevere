/**
 * Settings → Sources: dictionary sources and translation engines as one family of rows.
 * Shared by the desktop Settings window and the phone's Settings tab; each app
 * wires the `data-act` attributes. Styles: settings-sources.css.
 */

import type { ApiProviderId } from './api-key-check';
import { languageDisplayName, t, tHtml } from './i18n/runtime';
import { esc, hostOf, SVG } from './settings-kit';

export interface SourceInfo {
  /** One or two letters stamped on the seal. */
  mark: string;
  /** Headword languages as ISO codes, or 'many'. */
  languages: string[] | 'many';
  /** What Phevere gets from it, at most two lines, in the interface language (read when shown). */
  readonly about: string;
  url?: string;
  /** Provider whose key it needs. */
  key?: ApiProviderId;
  /** Needs an offline pack (CC-CEDICT). */
  pack?: boolean;
  /** Defines words in a language other than English; listed in its own group, off until switched on. */
  native?: boolean;
}

/** Keyed by the dictionary service's source names. */
export const SOURCE_INFO: Record<string, SourceInfo> = {
  'Free Dictionary API': {
    mark: 'Fd',
    languages: ['en'],
    get about() {
      return t('settings.sources.about.freeDictionary');
    },
    url: 'https://dictionaryapi.dev/',
  },
  Wiktionary: {
    mark: 'W',
    languages: 'many',
    get about() {
      return t('settings.sources.about.wiktionary');
    },
    url: 'https://en.wiktionary.org/',
  },
  'Oxford Dictionary API': {
    mark: 'Ox',
    languages: ['en'],
    get about() {
      return t('settings.sources.about.oxford');
    },
    url: 'https://developer.oxforddictionaries.com/',
    key: 'oxford',
  },
  'Collins Dictionary API': {
    mark: 'Co',
    languages: ['en'],
    get about() {
      return t('settings.sources.about.collins');
    },
    url: 'https://www.collinsdictionary.com/',
    key: 'collins',
  },
  WordsAPI: {
    mark: 'Wa',
    languages: ['en'],
    get about() {
      return t('settings.sources.about.wordsapi');
    },
    url: 'https://www.wordsapi.com/',
    key: 'wordsapi',
  },
  'Youdao API': {
    mark: '有',
    languages: ['zh', 'en'],
    get about() {
      return t('settings.sources.about.youdao');
    },
    url: 'https://ai.youdao.com/',
    key: 'youdao',
  },
  'CC-CEDICT': {
    mark: '典',
    languages: ['zh'],
    get about() {
      return t('settings.sources.about.cedict');
    },
    url: 'https://cc-cedict.org/wiki/',
    pack: true,
  },
  Datamuse: {
    mark: 'Dm',
    languages: ['en'],
    get about() {
      return t('settings.sources.about.datamuse');
    },
    url: 'https://www.datamuse.com/api/',
  },
  Tatoeba: {
    mark: 'Ta',
    languages: 'many',
    get about() {
      return t('settings.sources.about.tatoeba');
    },
    url: 'https://tatoeba.org/',
  },
  Jisho: {
    mark: '辞',
    languages: ['ja'],
    get about() {
      return t('settings.sources.about.jisho');
    },
    url: 'https://jisho.org/',
  },
  OpenRussian: {
    mark: 'Ру',
    languages: ['ru'],
    get about() {
      return t('settings.sources.about.openrussian');
    },
    url: 'https://en.openrussian.org/',
  },
  Kaikki: {
    mark: 'Kk',
    languages: 'many',
    get about() {
      return t('settings.sources.about.kaikki');
    },
    url: 'https://kaikki.org/',
  },
  'Chinese Wiktionary': {
    mark: '中',
    languages: 'many',
    get about() {
      return t('settings.sources.about.zhWiktionary');
    },
    url: 'https://zh.wiktionary.org/',
    native: true,
  },
  'Russian Wiktionary': {
    mark: 'Рв',
    languages: ['ru'],
    get about() {
      return t('settings.sources.about.ruWiktionary');
    },
    url: 'https://ru.wiktionary.org/',
    native: true,
  },
  'Japanese Wiktionary': {
    mark: '国',
    languages: ['ja'],
    get about() {
      return t('settings.sources.about.jaWiktionary');
    },
    url: 'https://ja.wiktionary.org/',
    native: true,
  },
};

export interface EngineInfo extends SourceInfo {
  id: string;
  /** The engine's name; Automatic follows the interface language. */
  readonly label: string;
}

export const TRANSLATION_ENGINES: EngineInfo[] = [
  {
    id: 'auto',
    get label() {
      return t('settings.sources.engine.auto');
    },
    mark: 'A',
    languages: 'many',
    get about() {
      return t('settings.sources.about.engineAuto');
    },
  },
  {
    id: 'google',
    label: 'Google Translate', // i18n-ignore: the service's name
    mark: 'G',
    languages: 'many',
    get about() {
      return t('settings.sources.about.engineGoogle');
    },
    url: 'https://translate.google.com/',
  },
  {
    id: 'mymemory',
    label: 'MyMemory',
    mark: 'Mm',
    languages: 'many',
    get about() {
      return t('settings.sources.about.engineMymemory');
    },
    url: 'https://mymemory.translated.net/',
  },
  {
    id: 'youdao',
    label: 'Youdao',
    mark: '有',
    languages: 'many',
    get about() {
      return t('settings.sources.about.engineYoudao');
    },
    url: 'https://ai.youdao.com/',
    key: 'youdao',
  },
  {
    id: 'deepl',
    label: 'DeepL',
    mark: 'D',
    languages: 'many',
    get about() {
      return t('settings.sources.about.engineDeepl');
    },
    url: 'https://www.deepl.com/translator',
    key: 'deepl',
  },
];

export interface SourceRowInput {
  control: 'switch' | 'radio';
  /** Source name (switch) or engine id (radio). */
  name: string;
  label: string;
  info?: SourceInfo;
  on: boolean;
  /** Its key or pack is missing. */
  blocked?: boolean;
  open?: boolean;
}

function chipsHtml(languages: SourceInfo['languages'] | undefined): string {
  if (!languages) return '';
  if (languages === 'many') return `<span class="sv-chip">${tHtml('settings.sources.manyLanguages')}</span>`;
  return languages.map((c) => `<span class="sv-chip">${esc(languageDisplayName(c))}</span>`).join('');
}

function requirementHtml(info: SourceInfo | undefined): string {
  if (info?.key) {
    return `<button type="button" class="sv-need" data-act="goto-section" data-section="api" data-provider="${esc(info.key)}">${tHtml('settings.sources.needsKey')}</button>`;
  }
  if (info?.pack) {
    return `<button type="button" class="sv-need" data-act="goto-section" data-section="offline">${tHtml('settings.sources.needsPack')}</button>`;
  }
  return '';
}

/** One source or engine: seal, name, language chips, state, and a disclosure with what it provides. */
export function sourceRowHtml(r: SourceRowInput): string {
  const info = r.info;
  const key = `src:${r.control}:${r.name}`;
  const control =
    r.control === 'switch'
      ? `<input type="checkbox" role="switch" class="sv-switch" data-act="src" data-name="${esc(r.name)}" ${r.on ? 'checked' : ''} aria-label="${esc(r.label)}" />`
      : `<input type="radio" class="sv-radio" name="engine" data-act="engine" value="${esc(r.name)}" ${r.on ? 'checked' : ''} aria-label="${esc(r.label)}" />`;
  const more = info
    ? `<div class="sv-src__more">
        <p>${esc(info.about)}</p>
        ${info.url ? `<a class="sv-link" href="${esc(info.url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(info.url))}${SVG.out}</a>` : ''}
      </div>`
    : '';
  return `<div class="sv-src${r.on ? ' is-on' : ''}${r.blocked ? ' is-blocked' : ''}" data-control="${r.control}">
    <span class="sv-seal" aria-hidden="true">${esc(info?.mark || r.label.slice(0, 1))}</span>
    <details class="sv-src__body" data-key="${esc(key)}"${r.open ? ' open' : ''}>
      <summary class="sv-src__head">
        <span class="sv-src__title"><span class="sv-src__name">${esc(r.label)}</span><span class="sv-src__chev">${SVG.chevron}</span></span>
        <span class="sv-chips">${chipsHtml(info?.languages)}</span>
      </summary>
      ${more}
    </details>
    <span class="sv-src__state">${r.blocked ? requirementHtml(info) : ''}</span>
    <label class="sv-src__ctl sv-ctl">${control}</label>
  </div>`;
}

export interface SourcesPanelInput {
  dictionary: SourceRowInput[];
  engines: SourceRowInput[];
}

export function sourcesPanelHtml(p: SourcesPanelInput): string {
  const main = p.dictionary.filter((r) => !r.info?.native);
  const native = p.dictionary.filter((r) => r.info?.native);
  const on = main.filter((r) => r.on).length;
  const nativeHtml = native.length
    ? `<header class="sv-head"><h3 class="sv-head__title">${tHtml('settings.sources.nativeHead')}</h3></header>
    <div class="sv-ledger">${native.map(sourceRowHtml).join('')}</div>`
    : '';
  return `<div class="sv sv-sources">
    <header class="sv-head"><h3 class="sv-head__title">${tHtml('settings.sources.dictionaries')}</h3><span class="sv-head__count">${tHtml('settings.sources.countOn', { on, total: main.length })}</span></header>
    <div class="sv-ledger">${main.map(sourceRowHtml).join('') || `<p class="sv-empty">${tHtml('settings.sources.empty')}</p>`}</div>
    ${nativeHtml}
    <header class="sv-head"><h3 class="sv-head__title">${tHtml('settings.sources.engineHead')}</h3></header>
    <div class="sv-ledger" role="radiogroup" aria-label="${tHtml('settings.sources.engineHead')}">${p.engines.map(sourceRowHtml).join('')}</div>
  </div>`;
}
