/**
 * Notebook language chip: lemma language → language of the saved gloss.
 * Do not use the translation-tab default (en→zh) when the card is an English dictionary sense.
 */
import { formatNumber, t, tHtml } from './i18n/runtime';

const LATIN_DICT =
  /wiktionary|wordnet|webster|gcide|free dictionary|oxford|datamuse|wordsapi|collins/i;
const CJK_EN_DICT = /cedict|cc-cedict|youdao|freedict/i;
const CJK_CHAR = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const KANA = /[\u3040-\u30FF]/g;
const CYRILLIC = /[\u0400-\u04FF]/g;
const LETTER = /\p{L}/gu;

function iso(code?: string): string {
  return String(code || '')
    .toLowerCase()
    .split('-')[0]
    .trim();
}

function mostlyCjk(text: string): boolean {
  const s = String(text || '');
  if (!s) return false;
  const hits = s.match(new RegExp(CJK_CHAR.source, 'g'));
  return !!hits && hits.length >= Math.max(2, Math.floor(s.length * 0.12));
}

export function inferVocabGlossLang(entry: {
  sourceLang?: string;
  targetLang?: string;
  definition?: string;
  sources?: string[];
}): string | undefined {
  const def = String(entry.definition || '').trim();
  const srcs = (entry.sources || []).join(' ');
  // Glosses written in Japanese or Russian (the Japanese and Russian Wiktionaries), by script.
  if ((def.match(KANA) || []).length >= 2) return 'ja';
  const letters = (def.match(LETTER) || []).length;
  if (letters && (def.match(CYRILLIC) || []).length >= letters * 0.5) return 'ru';
  if (mostlyCjk(def)) return 'zh';
  if (LATIN_DICT.test(srcs)) return 'en';
  if (CJK_EN_DICT.test(srcs) && def && !mostlyCjk(def)) return 'en';
  const src = iso(entry.sourceLang);
  const tgt = iso(entry.targetLang);
  if (src === 'en' && tgt === 'zh' && /[A-Za-z]{3,}/.test(def) && !mostlyCjk(def)) return 'en';
  return tgt || src || undefined;
}

/** e.g. `en → en` for an English dictionary card, `zh → en` for CEDICT. */
export function formatVocabLangPair(entry: {
  sourceLang?: string;
  targetLang?: string;
  definition?: string;
  sources?: string[];
}): string {
  const src = iso(entry.sourceLang);
  const gloss = inferVocabGlossLang(entry);
  if (src && gloss) return `${src} → ${gloss}`;
  return src || gloss || '';
}

/* ------------------------------------------------- the Words language filter */

/** A language needs this many saved words before it gets a chip of its own. */
const MIN_LANG_WORDS = 3;
const LATIN_WORD = /^[\p{Script=Latin}\p{M}\s'’.\-]+$/u;

/** The language a saved word is in: the one recorded when it was saved, else read from its script. */
export function vocabHeadwordLang(entry: { lemma?: string; sourceLang?: string }): string {
  const code = iso(entry.sourceLang);
  if (code && code !== 'auto') return code;
  const t = String(entry.lemma || '');
  if (/[\u3040-\u30FF]/.test(t)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(t)) return 'ko';
  if (CJK_CHAR.test(t)) return 'zh';
  if (/[\u0400-\u04FF]/.test(t)) return 'ru';
  return 'en';
}

/**
 * The language to open a saved word in: its own when that is not the one a plain lookup of its
 * letters opens (the Danish "give"), else '' so the lookup goes as before.
 */
export function vocabLookupLang(entry: { lemma?: string; sourceLang?: string }): string {
  const own = vocabHeadwordLang(entry);
  return own === vocabHeadwordLang({ lemma: entry.lemma }) ? '' : own;
}

/** A saved word's key that keeps the same spelling in two languages apart. */
export function vocabLangKey(entry: { lemma?: string; sourceLang?: string }): string {
  return `${String(entry.lemma || '').trim().toLowerCase()}|${vocabHeadwordLang(entry)}`;
}

/**
 * The saved word a plain lookup of `q` stands for, as a Recent row shows it: the only one with
 * that spelling, or, when it is saved in two languages, the one in the language its letters read
 * as (the English "give", not the Danish).
 */
export function savedForSpelling<T extends { lemma: string; sourceLang?: string | null }>(entries: T[], q: string): T | undefined {
  const k = String(q || '').trim().toLowerCase();
  if (!k) return undefined;
  const same = entries.filter((e) => String(e.lemma || '').trim().toLowerCase() === k);
  if (same.length < 2) return same[0];
  const plain = vocabHeadwordLang({ lemma: q });
  return same.find((e) => vocabHeadwordLang({ lemma: e.lemma, sourceLang: e.sourceLang || undefined }) === plain) || same[0];
}

export interface VocabLanguages {
  /** Languages with a chip, most words first. Empty when fewer than two qualify. */
  groups: Array<{ code: string; count: number }>;
  langOf: (entry: { lemma?: string; sourceLang?: string }) => string;
}

/**
 * The languages of a notebook, for the chips above Words. Language detection sometimes files
 * an English phrase under Italian or Malagasy ("a priori", "bindery"), so a Latin-script word
 * under a language with only a word or two counts as English when English is there.
 */
export function vocabLanguages(entries: Array<{ lemma?: string; sourceLang?: string }>): VocabLanguages {
  const raw = new Map<string, number>();
  for (const e of entries) {
    const c = vocabHeadwordLang(e);
    raw.set(c, (raw.get(c) || 0) + 1);
  }
  const hasEnglish = (raw.get('en') || 0) >= MIN_LANG_WORDS;
  const langOf = (e: { lemma?: string; sourceLang?: string }) => {
    const c = vocabHeadwordLang(e);
    if (c !== 'en' && hasEnglish && (raw.get(c) || 0) < MIN_LANG_WORDS && LATIN_WORD.test(String(e.lemma || '').trim())) return 'en';
    return c;
  };
  const counts = new Map<string, number>();
  for (const e of entries) {
    const c = langOf(e);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const groups = [...counts.entries()]
    .filter(([, n]) => n >= MIN_LANG_WORDS)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, count]) => ({ code, count }));
  return { groups: groups.length >= 2 ? groups : [], langOf };
}

/** Only the words in `lang`; every word for 'all' or a language without a chip. */
export function filterVocabByLang<T extends { lemma?: string; sourceLang?: string }>(entries: T[], lang: string, langs = vocabLanguages(entries)): T[] {
  if (!lang || lang === 'all' || !langs.groups.some((g) => g.code === lang)) return entries;
  return entries.filter((e) => langs.langOf(e) === lang);
}

function escAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The chip row: All, then each language with its count. Empty when there is nothing to choose. */
export function vocabLangChipsHtml(langs: VocabLanguages, active: string, total: number, name: (code: string) => string): string {
  if (!langs.groups.length) return '';
  const on = langs.groups.some((g) => g.code === active) ? active : 'all';
  const chip = (code: string, label: string, n: number) =>
    `<button type="button" role="tab" class="nbv-chip vocab-lang-chip${code === on ? ' is-active' : ''}" data-act="vocab-lang" data-lang="${escAttr(code)}" aria-selected="${code === on}">${escAttr(label)}<span class="vocab-lang-chip__n">${formatNumber(n)}</span></button>`;
  return `<div class="nbv-chips vocab-langs" role="tablist" aria-label="${tHtml('notebook.list.languageLabel')}">${chip('all', t('notebook.list.allLanguages'), total)}${langs.groups
    .map((g) => chip(g.code, name(g.code), g.count))
    .join('')}</div>`;
}
