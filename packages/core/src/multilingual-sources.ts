/**
 * Keyless online dictionaries for non-English headwords, each with English glosses:
 *
 * - Jisho (jisho.org): Japanese, built on JMdict (EDRDG, CC BY-SA 4.0).
 * - OpenRussian (openrussian.org): Russian, CC BY-SA 4.0.
 * - kaikki.org: per-word JSON extracted from English Wiktionary by wiktextract
 *   (CC BY-SA 4.0 / GFDL), one file per word and language.
 *
 * URL builders and parsers are pure so the tests can run them on saved payloads.
 */

import { DictionaryError } from './base';
import type { HttpClient } from './http';
import type { Pronunciation } from './pronunciation';
import { LANGUAGE_NAMES } from './source-languages';

export interface SourceSense {
  partOfSpeech: string;
  meaning: string;
  examples?: string[];
  source: string;
  senseOrder?: number;
}

export interface SourceSenses {
  definitions: SourceSense[];
  examples: string[];
  pronunciations?: Pronunciation[];
}

const EMPTY = (): SourceSenses => ({ definitions: [], examples: [] });
const MAX_SENSES = 24;
/** Dedicated dictionaries sort ahead of Wiktionary (40+); kaikki repeats Wiktionary, so after it. */
const ORDER_DEDICATED = 20;
const ORDER_KAIKKI = 60;

const HIRAGANA_ONLY = /^[぀-ゟー]+$/;
const ENDS_IN_KANA = /[぀-ゟ]$/;

function clean(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- Jisho

export function jishoUrl(word: string): string {
  return `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word.trim())}`;
}

function jishoPos(list: unknown): string | null {
  for (const raw of Array.isArray(list) ? list : []) {
    const p = String(raw || '').toLowerCase();
    if (!p) continue;
    if (p.includes('wikipedia')) return 'skip';
    if (/^(place|full name|surname|given name|female given name|male given name|company|organization|product|work of art)/.test(p)) {
      return 'proper noun';
    }
    if (p.includes('adjective') || p.includes('adjectival')) return 'adjective';
    if (p.includes('adverb')) return 'adverb';
    if (p.includes('pronoun')) return 'pronoun';
    if (p.includes('noun')) return 'noun';
    if (p.includes('verb')) return 'verb';
    if (p.includes('expression')) return 'phrase';
    if (p.includes('particle')) return 'particle';
    if (p.includes('conjunction')) return 'conjunction';
    if (p.includes('interjection')) return 'interjection';
    if (p.includes('counter')) return 'counter';
    if (p.includes('suffix')) return 'suffix';
    if (p.includes('prefix')) return 'prefix';
    if (p.includes('numeric')) return 'numeral';
  }
  return null;
}

/** Exact spelling or reading, or the dictionary form Jisho returned for a conjugated query. */
function jishoMatch(entry: any, q: string): 'exact' | 'lemma' | null {
  const forms: Array<{ word?: string; reading?: string }> = Array.isArray(entry?.japanese) ? entry.japanese : [];
  if (forms.some((f) => f.word === q || f.reading === q)) return 'exact';
  for (const f of forms) {
    for (const form of [f.word, f.reading]) {
      if (!form || !ENDS_IN_KANA.test(form)) continue;
      const stem = form.slice(0, -1);
      if (!stem || !q.startsWith(stem) || q.length <= stem.length) continue;
      if (HIRAGANA_ONLY.test(q.slice(stem.length))) return 'lemma';
    }
  }
  return null;
}

/**
 * Jisho also returns words that merely contain the query. Keep exact matches; when
 * there are none, keep the first result only if it is the query's dictionary form
 * (たべました → 食べる).
 */
export function parseJisho(payload: any, query: string): SourceSenses {
  const q = clean(query);
  const data: any[] = Array.isArray(payload?.data) ? payload.data : [];
  let picked = data.filter((e) => jishoMatch(e, q) === 'exact');
  if (!picked.length) {
    const lemma = data.slice(0, 3).find((e) => jishoMatch(e, q) === 'lemma');
    if (lemma) picked = [lemma];
  }
  const out = EMPTY();
  for (const entry of picked) {
    let pos = 'unknown';
    for (const sense of Array.isArray(entry?.senses) ? entry.senses : []) {
      const p = jishoPos(sense?.parts_of_speech);
      if (p === 'skip') continue;
      if (p) pos = p;
      const glosses = (Array.isArray(sense?.english_definitions) ? sense.english_definitions : [])
        .map(clean)
        .filter(Boolean);
      if (!glosses.length) continue;
      out.definitions.push({
        partOfSpeech: pos,
        meaning: glosses.join('; '),
        source: 'Jisho',
        senseOrder: ORDER_DEDICATED + out.definitions.length,
      });
      if (out.definitions.length >= MAX_SENSES) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------- OpenRussian

export function openRussianUrl(word: string): string {
  return `https://api.openrussian.org/suggestions?q=${encodeURIComponent(word.trim())}&lang=en`;
}

/** OpenRussian marks stress with an apostrophe or U+0301; ё and е are interchangeable in print. */
function foldRussian(s: string): string {
  return clean(s).replace(/['́]/g, '').toLowerCase().replace(/ё/g, 'е');
}

const RU_POS: Record<string, string> = {
  noun: 'noun',
  verb: 'verb',
  adjective: 'adjective',
  adverb: 'adverb',
  pronoun: 'pronoun',
  preposition: 'preposition',
  conjunction: 'conjunction',
  particle: 'particle',
  interjection: 'interjection',
  numeral: 'numeral',
  expression: 'phrase',
};

/** Suggestions match prefixes too; keep the words whose lemma or an inflected form is the query. */
export function parseOpenRussian(payload: any, query: string): SourceSenses {
  const q = foldRussian(query);
  const words: any[] = Array.isArray(payload?.result?.words) ? payload.result.words : [];
  const out = EMPTY();
  for (const item of words) {
    const w = item?.word;
    if (!w) continue;
    const forms: any[] = Array.isArray(item?.forms) ? item.forms : [];
    const hit = foldRussian(w.ru) === q || forms.some((f) => foldRussian(f?.ru) === q);
    if (!hit) continue;
    const pos = RU_POS[String(w.type || '').toLowerCase()] || clean(w.type) || 'unknown';
    const senses: any[] = Array.isArray(w.tls2) && w.tls2.length
      ? w.tls2
      : (Array.isArray(w.tls) ? w.tls : []).map((t: unknown) => ({ translation: t }));
    for (const s of senses) {
      const glosses = (Array.isArray(s?.translation) ? s.translation : []).map(clean).filter(Boolean);
      if (!glosses.length) continue;
      const domain = clean(s?.domain);
      const examples = (Array.isArray(s?.examples) ? s.examples : [])
        .map((e: any) => {
          const ru = clean(e?.native).replace(/['́]/g, '');
          const en = clean(e?.translated);
          return ru && en ? `${ru} — ${en}` : '';
        })
        .filter(Boolean)
        .slice(0, 2);
      out.definitions.push({
        partOfSpeech: pos,
        meaning: domain ? `(${domain}) ${glosses.join('; ')}` : glosses.join('; '),
        examples: examples.length ? examples : undefined,
        source: 'OpenRussian',
        senseOrder: ORDER_DEDICATED + out.definitions.length,
      });
      out.examples.push(...examples);
      if (out.definitions.length >= MAX_SENSES) return out;
    }
  }
  return out;
}

// --------------------------------------------------------------- kaikki

export const KAIKKI_ALL_LANGUAGES = 'All languages combined';

/** kaikki.org directory for a language code, or null when it has none we use. */
export function kaikkiLanguage(code: string): string | null {
  const c = (code || '').toLowerCase().split('-')[0];
  if (!c || c === 'en' || c === 'auto') return null;
  return LANGUAGE_NAMES[c] || null;
}

/** kaikki.org/dictionary/<Language>/meaning/<1st char>/<first two chars>/<word>.jsonl */
export function kaikkiUrl(word: string, language: string): string {
  const w = word.trim();
  const chars = Array.from(w);
  const seg = (s: string) => encodeURIComponent(s);
  return (
    `https://kaikki.org/dictionary/${seg(language)}/meaning/` +
    `${seg(chars[0] || '')}/${seg(chars.slice(0, 2).join(''))}/${seg(w)}.jsonl`
  );
}

const KAIKKI_POS: Record<string, string> = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  name: 'proper noun',
  pron: 'pronoun',
  prep: 'preposition',
  postp: 'postposition',
  conj: 'conjunction',
  intj: 'interjection',
  num: 'numeral',
  det: 'determiner',
  article: 'article',
  particle: 'particle',
  phrase: 'phrase',
  prep_phrase: 'phrase',
  proverb: 'phrase',
  suffix: 'suffix',
  prefix: 'prefix',
  counter: 'counter',
  classifier: 'counter',
};

export interface KaikkiOptions {
  /** Keep only these language codes. */
  languages?: Set<string>;
  /** Drop these language codes (English, when filling in for an English lookup). */
  exclude?: Set<string>;
}

/** One JSON object per line; a 404 page or blank body yields nothing. */
export function parseKaikki(jsonl: string, opts: KaikkiOptions = {}): SourceSenses {
  const out = EMPTY();
  const ipas = new Set<string>();
  for (const line of (jsonl || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let entry: any;
    try {
      entry = JSON.parse(t);
    } catch {
      continue;
    }
    const lang = String(entry?.lang_code || '');
    if (opts.languages && !opts.languages.has(lang)) continue;
    if (opts.exclude && opts.exclude.has(lang)) continue;
    const pos = KAIKKI_POS[String(entry?.pos || '')] || clean(entry?.pos) || 'unknown';
    for (const sense of Array.isArray(entry?.senses) ? entry.senses : []) {
      const tags: string[] = Array.isArray(sense?.tags) ? sense.tags : [];
      if (tags.includes('no-gloss')) continue;
      const glosses: string[] = Array.isArray(sense?.glosses) ? sense.glosses : [];
      const meaning = clean(glosses[glosses.length - 1]);
      if (!meaning) continue;
      const examples = (Array.isArray(sense?.examples) ? sense.examples : [])
        .map((e: any) => {
          const text = clean(e?.text);
          const en = clean(e?.english || e?.translation);
          if (!text) return '';
          return en && en !== text ? `${text} — ${en}` : text;
        })
        .filter(Boolean)
        .slice(0, 2);
      out.definitions.push({
        partOfSpeech: pos,
        meaning,
        examples: examples.length ? examples : undefined,
        source: 'Kaikki',
        senseOrder: ORDER_KAIKKI + out.definitions.length,
      });
      out.examples.push(...examples);
      if (out.definitions.length >= MAX_SENSES) break;
    }
    for (const s of Array.isArray(entry?.sounds) ? entry.sounds : []) {
      const ipa = clean(s?.ipa);
      if (ipa && ipas.size < 3) ipas.add(ipa);
    }
    if (out.definitions.length >= MAX_SENSES) break;
  }
  if (ipas.size) {
    out.pronunciations = Array.from(ipas).map((ipa) => ({ ipa, accent: 'other', source: 'Kaikki' }));
  }
  return out;
}

/** Languages worth showing when kaikki fills in for an English lookup that found nothing. */
export const KAIKKI_FALLBACK_LANGUAGES = new Set(Object.keys(LANGUAGE_NAMES).filter((c) => c !== 'en'));

/** Wiktionary glosses that only say the word is a name (Haus: "A surname"). The REST API sends HTML. */
export function isNameOnlyGloss(meaning: string): boolean {
  const text = clean(String(meaning || '').replace(/<[^>]+>/g, ' '));
  return /^(an? )?((male|female|unisex) )?(surname|given name|placename|place name|toponym|municipality|(small )?(town|city|village|river|commune) in\b)/i.test(
    text,
  );
}

// ---------------------------------------------------------------- fetch

async function getJson(http: HttpClient, url: string, timeoutMs: number, headers?: Record<string, string>): Promise<any | null> {
  const res = await http.requestText(url, { timeoutMs, headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new DictionaryError(`HTTP ${res.status}`, `HTTP_${res.status}`, res.status === 429 || res.status >= 500);
  }
  try {
    return JSON.parse(res.text);
  } catch {
    return null;
  }
}

export async function fetchJisho(http: HttpClient, word: string, timeoutMs = 4500): Promise<SourceSenses> {
  const json = await getJson(http, jishoUrl(word), timeoutMs);
  return json ? parseJisho(json, word) : EMPTY();
}

export async function fetchOpenRussian(http: HttpClient, word: string, timeoutMs = 4500): Promise<SourceSenses> {
  const json = await getJson(http, openRussianUrl(word), timeoutMs);
  return json ? parseOpenRussian(json, word) : EMPTY();
}

const kaikkiPages = new Map<string, Promise<string>>();

/**
 * One kaikki.org page, shared for a minute by everything that reads it (senses and forms
 * both parse the same page). A missing page is an empty string.
 */
export function fetchKaikkiPage(http: HttpClient, word: string, language: string, timeoutMs = 5000): Promise<string> {
  const url = kaikkiUrl(word, language);
  const hit = kaikkiPages.get(url);
  if (hit) return hit;
  const p = http.requestText(url, { timeoutMs }).then((res) => {
    if (res.status === 404) return '';
    if (!res.ok) {
      throw new DictionaryError(`HTTP ${res.status}`, `HTTP_${res.status}`, res.status === 429 || res.status >= 500);
    }
    return res.text;
  });
  kaikkiPages.set(url, p);
  if (kaikkiPages.size > 40) kaikkiPages.delete(kaikkiPages.keys().next().value as string);
  p.catch(() => kaikkiPages.delete(url));
  setTimeout(() => kaikkiPages.delete(url), 60_000);
  return p;
}

export async function fetchKaikki(
  http: HttpClient,
  word: string,
  language: string,
  opts: KaikkiOptions = {},
  timeoutMs = 5000,
): Promise<SourceSenses> {
  return parseKaikki(await fetchKaikkiPage(http, word, language, timeoutMs), opts);
}

/** kaikki.org directory for any language code, English included. */
export function kaikkiDirectory(code: string): string | null {
  const c = (code || '').toLowerCase().split('-')[0];
  return c === 'en' ? 'English' : kaikkiLanguage(c);
}
