/**
 * Settings → Sources: dictionary sources and translation engines as one family of rows.
 * Shared by the desktop Settings window and the phone's Settings tab; each app
 * wires the `data-act` attributes. Styles: settings-sources.css.
 */

import type { ApiProviderId } from './api-key-check';
import { languageName } from './source-languages';
import { esc, hostOf, SVG } from './settings-kit';

export interface SourceInfo {
  /** One or two letters stamped on the seal. */
  mark: string;
  /** Headword languages as ISO codes, or 'many'. */
  languages: string[] | 'many';
  /** What Phevere gets from it, at most two lines. */
  about: string;
  url?: string;
  /** Provider whose key it needs. */
  key?: ApiProviderId;
  /** Needs an offline pack (CC-CEDICT). */
  pack?: boolean;
}

/** Keyed by the dictionary service's source names. */
export const SOURCE_INFO: Record<string, SourceInfo> = {
  'Free Dictionary API': {
    mark: 'Fd',
    languages: ['en'],
    about: 'English definitions, phonetic spellings and recorded pronunciations, drawn from Wiktionary.',
    url: 'https://dictionaryapi.dev/',
  },
  Wiktionary: {
    mark: 'W',
    languages: 'many',
    about: 'Definitions, parts of speech and etymologies from the English Wiktionary, for words in any language it covers.',
    url: 'https://en.wiktionary.org/',
  },
  'Oxford Dictionary API': {
    mark: 'Ox',
    languages: ['en'],
    about: 'Oxford definitions, examples and etymologies for English words.',
    url: 'https://developer.oxforddictionaries.com/',
    key: 'oxford',
  },
  'Collins Dictionary API': {
    mark: 'Co',
    languages: ['en'],
    about: 'Collins English definitions, through a RapidAPI subscription.',
    url: 'https://www.collinsdictionary.com/',
    key: 'collins',
  },
  WordsAPI: {
    mark: 'Wa',
    languages: ['en'],
    about: 'English definitions with synonyms and related words.',
    url: 'https://www.wordsapi.com/',
    key: 'wordsapi',
  },
  'Youdao API': {
    mark: '有',
    languages: ['zh', 'en'],
    about: 'Chinese–English dictionary entries and web translations from NetEase Youdao.',
    url: 'https://ai.youdao.com/',
    key: 'youdao',
  },
  'CC-CEDICT': {
    mark: '典',
    languages: ['zh'],
    about: 'Chinese–English entries with pinyin, read from the CC-CEDICT offline pack.',
    url: 'https://cc-cedict.org/wiki/',
    pack: true,
  },
  Datamuse: {
    mark: 'Dm',
    languages: ['en'],
    about: 'Short English definitions and synonyms from the Datamuse word-finding API.',
    url: 'https://www.datamuse.com/api/',
  },
  Tatoeba: {
    mark: 'Ta',
    languages: 'many',
    about: 'Example sentences with translations, written and checked by volunteers.',
    url: 'https://tatoeba.org/',
  },
  Jisho: {
    mark: '辞',
    languages: ['ja'],
    about: 'Japanese words with readings and English glosses. Built on JMdict.',
    url: 'https://jisho.org/',
  },
  OpenRussian: {
    mark: 'Ру',
    languages: ['ru'],
    about: 'Russian words with stress marks, inflected forms and English translations.',
    url: 'https://en.openrussian.org/',
  },
  Kaikki: {
    mark: 'Kk',
    languages: 'many',
    about: 'Wiktionary entries extracted by wiktextract, for words that are not English.',
    url: 'https://kaikki.org/',
  },
};

export interface EngineInfo extends SourceInfo {
  id: string;
  label: string;
}

export const TRANSLATION_ENGINES: EngineInfo[] = [
  {
    id: 'auto',
    label: 'Automatic',
    mark: 'A',
    languages: 'many',
    about: 'Google Translate first, then MyMemory when Google does not answer.',
  },
  {
    id: 'google',
    label: 'Google Translate',
    mark: 'G',
    languages: 'many',
    about: 'Works without a key. With a Cloud Translation key it uses the official API.',
    url: 'https://translate.google.com/',
  },
  {
    id: 'mymemory',
    label: 'MyMemory',
    mark: 'Mm',
    languages: 'many',
    about: 'Translation memory from Translated, mixing human and machine translations.',
    url: 'https://mymemory.translated.net/',
  },
  {
    id: 'youdao',
    label: 'Youdao',
    mark: '有',
    languages: 'many',
    about: 'Translation by NetEase Youdao.',
    url: 'https://ai.youdao.com/',
    key: 'youdao',
  },
  {
    id: 'deepl',
    label: 'DeepL',
    mark: 'D',
    languages: 'many',
    about: 'Translation by DeepL, with a key from a DeepL API Free account.',
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
  if (languages === 'many') return '<span class="sv-chip">Many languages</span>';
  return languages.map((c) => `<span class="sv-chip" lang="${esc(c)}">${esc(languageName(c))}</span>`).join('');
}

function requirementHtml(info: SourceInfo | undefined): string {
  if (info?.key) {
    return `<button type="button" class="sv-need" data-act="goto-section" data-section="api" data-provider="${esc(info.key)}">API key required</button>`;
  }
  if (info?.pack) {
    return '<button type="button" class="sv-need" data-act="goto-section" data-section="offline">Offline pack required</button>';
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
  const on = p.dictionary.filter((r) => r.on).length;
  return `<div class="sv sv-sources">
    <header class="sv-head"><h3 class="sv-head__title">Dictionaries</h3><span class="sv-head__count">${on} of ${p.dictionary.length} on</span></header>
    <div class="sv-ledger">${p.dictionary.map(sourceRowHtml).join('') || '<p class="sv-empty">No dictionary sources loaded.</p>'}</div>
    <header class="sv-head"><h3 class="sv-head__title">Translation engine</h3></header>
    <div class="sv-ledger" role="radiogroup" aria-label="Translation engine">${p.engines.map(sourceRowHtml).join('')}</div>
  </div>`;
}
