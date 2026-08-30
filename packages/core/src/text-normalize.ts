/**
 * Query normalization for dictionary lookup.
 *
 * Follows the approach used by mature lookup tools (GoldenDict-ng's folding +
 * scored match tiers, Yomitan's preprocess-then-deinflect pipeline): sanitize
 * the raw selection, trim punctuation at the edges only, then try a ladder of
 * punctuation/script variants. Inflected lemmas are not mixed into a hit;
 * they are only a fallback when the exact form has no senses at all. An exact
 * match always outranks a normalized one, so forms like "U.S." and "C++"
 * survive while "word." still resolves to "word".
 */

export type QueryKind = 'word' | 'phrase' | 'sentence';

export interface NormalizedQuery {
  /** Exactly what the user selected. */
  raw: string;
  /** Whitespace-collapsed, NFC, control/zero-width stripped. Still has edge punctuation. */
  sanitized: string;
  /** `sanitized` with leading/trailing punctuation, symbols and separators removed. */
  trimmed: string;
  kind: QueryKind;
  isCJK: boolean;
  /** Ordered lookup candidates, most-exact first. Always non-empty unless `trimmed` is empty. */
  candidates: string[];
}

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD\u2060\u180E]/gu;
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
const WHITESPACE_RUN = /[\p{Z}\s]+/gu;
const EDGE_JUNK = /^[\p{P}\p{S}\p{Z}]+|[\p{P}\p{S}\p{Z}]+$/gu;
const COMBINING_MARKS = /\p{M}/gu;
const ANY_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/u;
const CJK_CHAR_GLOBAL = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/gu;
const SENTENCE_PUNCT = /[.!?;。！？；]/u;
const POSSESSIVE = /['\u2019]s$/u;
const LATIN_ACRONYM = /^[A-Z0-9]{2,6}$/;

/**
 * Dictionary APIs (Free Dictionary, Wiktionary REST) 404 on "Marionette"
 * while "marionette" hits. Keep short all-caps acronyms (USA, HTML).
 */
export function foldLatinHeadword(word: string): string {
  const t = (word || '').trim();
  if (!t || CJK_CHAR.test(t)) return t;
  if (LATIN_ACRONYM.test(t)) return t;
  return t.toLocaleLowerCase();
}

/** Longest single-token dictionary headword we will consider a "word". */
const MAX_WORD_LENGTH = 32;
/** Beyond this, always treat the selection as a sentence to translate. */
const MAX_PHRASE_LENGTH = 120;
const MAX_CANDIDATES = 8;

let lemmatizer: {
  noun?: (w: string) => string;
  verb?: (w: string) => string;
  adjective?: (w: string) => string;
} | null = null;
let lemmatizerLoaded = false;

function getLemmatizer(): typeof lemmatizer {
  if (!lemmatizerLoaded) {
    lemmatizerLoaded = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      lemmatizer = require('wink-lemmatizer');
    } catch {
      lemmatizer = null;
    }
  }
  return lemmatizer;
}

/**
 * Phase A: make the string safe and canonical without changing what it says.
 */
export function sanitize(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(ZERO_WIDTH, '')
    .replace(CONTROLS, '')
    .replace(WHITESPACE_RUN, ' ')
    .normalize('NFC')
    .trim();
}

/**
 * Phase B: drop punctuation, symbols and separators at the edges only.
 * Interior hyphens, apostrophes and periods are part of real headwords
 * ("well-being", "don't", "U.S.") and must survive.
 */
export function trimEdges(sanitized: string): string {
  if (!sanitized) return '';
  return sanitized.replace(EDGE_JUNK, '');
}

function countCJK(text: string): number {
  const matches = text.match(CJK_CHAR_GLOBAL);
  return matches ? matches.length : 0;
}

/**
 * Route to the dictionary or to translation. Classification runs on the
 * edge-trimmed form, so a stray terminal period no longer looks like a sentence.
 */
export function classify(trimmed: string): QueryKind {
  if (!trimmed) return 'word';
  if (trimmed.length > MAX_PHRASE_LENGTH) return 'sentence';

  const cjkCount = countCJK(trimmed);
  const isCJKDominant = cjkCount > 0 && cjkCount >= trimmed.replace(/\s/g, '').length / 2;

  // Sentence-ending punctuation *inside* the string is a real sentence signal.
  const interior = trimmed.slice(0, -1);
  if (SENTENCE_PUNCT.test(interior) && /\s/.test(trimmed)) return 'sentence';

  if (isCJKDominant) {
    if (cjkCount <= 4) return 'word';
    if (cjkCount <= 12) return 'phrase';
    return 'sentence';
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return trimmed.length > MAX_WORD_LENGTH ? 'phrase' : 'word';
  if (tokens.length <= 4) return 'phrase';
  return 'sentence';
}

/**
 * Abbreviations lose meaning when their periods are trimmed, so they must be
 * tried verbatim first. Same for tokens that trim down to almost nothing
 * ("C++" -> "C").
 */
function preferExactFirst(sanitized: string, trimmed: string): boolean {
  if (sanitized === trimmed) return false;
  // Abbreviations lose their identity without the interior periods.
  if (/\p{L}\.\p{L}/u.test(sanitized)) return true;
  // Trailing symbols that belong to the token itself: "C++", "C#".
  return trimmed.length <= 2 && /\p{S}$/u.test(sanitized);
}

function pushCandidate(list: string[], seen: Set<string>, value: string | undefined | null): void {
  if (!value) return;
  const v = value.trim();
  if (!v || seen.has(v) || list.length >= MAX_CANDIDATES) return;
  seen.add(v);
  list.push(v);
}

/**
 * Phase D: ordered lookup candidates, most-exact first.
 */
export function buildCandidates(sanitized: string, trimmed: string, kind: QueryKind): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  if (!trimmed) return candidates;

  if (preferExactFirst(sanitized, trimmed)) {
    pushCandidate(candidates, seen, sanitized);
  }

  const isCJK = CJK_CHAR.test(trimmed);
  // Latin APIs are effectively lowercase; try that before the capitalized surface form
  // so Datamuse cannot "win" and skip Free Dictionary / Wiktionary.
  if (!isCJK) {
    pushCandidate(candidates, seen, foldLatinHeadword(trimmed));
  }
  pushCandidate(candidates, seen, trimmed);
  pushCandidate(candidates, seen, sanitized);

  // Phrases and sentences are looked up verbatim; folding them rarely helps
  // and multiplies the number of network round trips.
  if (kind !== 'word') return candidates;

  if (isCJK) return candidates;

  const lower = foldLatinHeadword(trimmed);

  if (POSSESSIVE.test(lower)) {
    pushCandidate(candidates, seen, lower.replace(POSSESSIVE, ''));
  }

  const straightQuotes = lower.replace(/[\u2018\u2019]/gu, "'").replace(/[\u201C\u201D]/gu, '"');
  pushCandidate(candidates, seen, straightQuotes);

  const nfkc = lower.normalize('NFKC');
  pushCandidate(candidates, seen, nfkc);

  // Inflected lemmas (tantalizing → tantalize) are *not* mixed into the
  // surface ladder. Dictionary lookup tries them only when every source
  // has zero senses for this exact form.

  // Last resorts: strip interior punctuation, then diacritics. Diacritic
  // folding goes last so "résumé" is never answered with "resume".
  pushCandidate(candidates, seen, lower.replace(/[\p{P}\p{S}]/gu, ''));
  pushCandidate(candidates, seen, lower.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC'));

  return candidates;
}

export type LatinLemmaPos = 'noun' | 'verb' | 'adjective';

/** Noun/verb/adjective lemmas that differ from the surface form (e.g. vicissitudes → vicissitude). */
export function latinLemmasByPos(word: string): Partial<Record<LatinLemmaPos, string>> {
  const w = (word || '').trim().toLocaleLowerCase();
  if (!w || !/^[\p{L}'-]+$/u.test(w)) return {};
  const lem = getLemmatizer();
  if (!lem) return {};
  const out: Partial<Record<LatinLemmaPos, string>> = {};
  const noun = lem.noun?.(w);
  const verb = lem.verb?.(w);
  const adjective = lem.adjective?.(w);
  if (noun && noun !== w) out.noun = noun;
  if (verb && verb !== w) out.verb = verb;
  if (adjective && adjective !== w) out.adjective = adjective;
  return out;
}

/**
 * Citation-form POS for a single Latin token (the word is already the lemma).
 * Used for Word-family banners on derived items that are not inflections of the surface.
 */
export function latinCitationPos(word: string): 'verb' | 'noun' | 'adj.' | undefined {
  const w = (word || '').trim().toLocaleLowerCase();
  if (!w || /\s/.test(w) || !/^[\p{L}'-]+$/u.test(w)) return undefined;
  const lem = getLemmatizer();
  if (!lem) return undefined;
  const isV = lem.verb?.(w) === w;
  const isN = lem.noun?.(w) === w;
  const isA = lem.adjective?.(w) === w;
  const n = Number(!!isV) + Number(!!isN) + Number(!!isA);
  if (n === 1) {
    if (isV) return 'verb';
    if (isN) return 'noun';
    return 'adj.';
  }
  return undefined;
}

export function latinLemmaForms(word: string): string[] {
  const byPos = latinLemmasByPos(word);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of [byPos.noun, byPos.verb, byPos.adjective]) {
    if (!f || seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}

export function normalizeQuery(raw: string): NormalizedQuery {
  const sanitized = sanitize(raw);
  const trimmed = trimEdges(sanitized);
  const kind = classify(trimmed);

  return {
    raw,
    sanitized,
    trimmed,
    kind,
    isCJK: CJK_CHAR.test(trimmed),
    candidates: buildCandidates(sanitized, trimmed, kind)
  };
}

/**
 * Whether a selection is worth showing a popup for at all. Rejects pure
 * punctuation, bare digits, and single Latin letters, while keeping single CJK
 * characters (which are legitimate headwords).
 */
export function isLookupWorthy(raw: string): boolean {
  const sanitized = sanitize(raw);
  const trimmed = trimEdges(sanitized);
  if (!trimmed) return false;
  if (!ANY_LETTER_OR_DIGIT.test(trimmed)) return false;

  if (CJK_CHAR.test(trimmed)) return true;

  // Judge length on the untrimmed form so tokens whose symbols are meaningful
  // ("C++", "C#") are not dismissed as single letters.
  if (sanitized.length < 2) return false;
  if (/^\p{N}+$/u.test(trimmed)) return false;

  return true;
}

/** Letters/digits only — "hello," and "hello" are the same lookup. */
export function foldLookupKey(text: string): string {
  return (text || '').replace(/[^\p{L}\p{N}]+/gu, '').toLocaleLowerCase();
}

/** Stable cache key that collapses "word", "word.", "\"word\"" and "Word". */
export function cacheKeyFor(query: NormalizedQuery, targetLanguage: string): string {
  const key = query.isCJK ? query.trimmed : query.trimmed.toLocaleLowerCase();
  return `${key}_${targetLanguage}`;
}

/**
 * Wiktionary (and most desktop dictionaries) treat inflections as: deinflect,
 * then look up a *content* headword. Namespace pages (Appendix:, Category:, …)
 * are not lemmas — the first `/wiki/` href in a gloss is often
 * `Appendix:Glossary#plural`, which is why “tribulations” became that title.
 *
 * Linked titles must still look like dictionary words (not Appendix:).
 * Lemma *senses* are not merged into an inflected card; lookup may fall
 * back to the lemma only when the exact form has no senses at all.
 */
const WIKI_NON_LEMMA =
  /^(Appendix|Category|File|Image|Special|Wiktionary|Template|Module|Help|User|Talk|Reconstruction|Citations|Rhymes|Thesaurus|MediaWiki|TimedText|Sign gloss):/i;

export function isContentHeadword(title: string): boolean {
  const t = (title || '').trim();
  if (!t || t.length > 80) return false;
  if (WIKI_NON_LEMMA.test(t) || t.includes(':')) return false;
  return /^[\p{L}][\p{L}\p{N}'’.\-]*(?: [\p{L}][\p{L}\p{N}'’.\-]*)*$/u.test(t);
}

/** Last content-namespace wiki title in a grammatical gloss (skip glossary links). */
export function lemmaFromFormOfHtml(meaning: string, surface: string): string | undefined {
  const hrefs = String(meaning || '').matchAll(/href=["']\/wiki\/([^"'#]+)(?:#[^"']*)?["']/gi);
  const surfaceKey = foldLookupKey(surface);
  const found: string[] = [];
  for (const m of hrefs) {
    let title = m[1].replace(/_/g, ' ');
    try {
      title = decodeURIComponent(title);
    } catch {
      /* keep */
    }
    title = title.trim();
    if (!isContentHeadword(title)) continue;
    if (foldLookupKey(title) === surfaceKey) continue;
    found.push(title);
  }
  return found.length ? found[found.length - 1] : undefined;
}
