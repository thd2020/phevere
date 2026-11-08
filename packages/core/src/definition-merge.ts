/**
 * Cross-source definition merge: identical / near-identical glosses collapse
 * into one sense with multiple citation labels (Free Dictionary · Wiktionary · Datamuse).
 */

import { isGrammaticalFormOfGloss } from './lookup-policy';
import { latinLemmasByPos } from './text-normalize';
import { exampleKey, tidyExample } from './example-text';

export { exampleKey, tidyExample };

export interface MergeableDefinition {
  partOfSpeech: string;
  meaning: string;
  synonyms?: string[];
  antonyms?: string[];
  examples?: string[];
  source: string;
  sources?: string[];
  /** Lower = more common / earlier in Free Dictionary. */
  senseOrder?: number;
  /** SemCor tag count of the aligned WordNet sense (see sense-frequency.ts); absent when unaligned. */
  frequency?: number;
  /**
   * A sense of the looked-up form itself from a source that usually answers with its lemma's:
   * WordNet, through Datamuse, defines "savings" as "a fund of money put by as a reserve".
   */
  ownSense?: boolean;
  /** Grammar codes, usage labels and collocations (sense-notes.ts); a merge keeps them all. */
  grammar?: string[];
  labels?: string[];
  collocations?: string[];
}

/**
 * Strip sense numbers, parenthetical asides, and normalize for comparison. `keepAsides` keeps the
 * text of the asides, for a qualifier one source puts in brackets ("(of a book or document) Not
 * abridged") and another writes into the sense ("Of a book or document, not abridged").
 */
export function normalizeMeaningForMerge(raw: string, keepAsides = false): string {
  let s = (raw || '')
    .normalize('NFC')
    // Wiktionary's inline <style> text (.mw-parser-output .defdate{…}) kept two copies of a sense apart.
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');

  // Drop leading sense markers
  s = s.replace(/^\s*(?:\(?\d+[.)]\)?|[①②③④⑤⑥⑦⑧⑨⑩]|[a-z]\))\s*/i, '');

  // Parenthetical asides (often POS tags / register notes that differ across sources)
  if (!keepAsides) {
    s = s.replace(/\([^)]*\)/g, ' ');
    s = s.replace(/（[^）]*）/g, ' ');
  }

  // Common leading tags that sources disagree on
  s = s.replace(
    /^\s*(?:countable|uncountable|transitive|intransitive|often preceded by (?:the )?definite article|chiefly|informal|formal|slang|archaic|obsolete)\s*,?\s*/gi,
    '',
  );
  s = s.replace(
    /(?:,\s*)?(?:countable|uncountable|transitive|intransitive|often preceded by (?:the )?definite article)\b/gi,
    '',
  );

  s = s
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return s;
}

function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter((t) => t.length > 0);
}

/** Cheap Levenshtein ratio for short glosses (cap length to keep O(n²) sane). */
function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  if (maxLen > 280) {
    // Fall back to prefix/containment for very long strings
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    if (longer.includes(shorter) && shorter.length / longer.length >= 0.85) return 0.92;
    return 0;
  }

  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return 1 - dp[n] / maxLen;
}

/** Webster/GCIDE `n` / `v. t.`, Datamuse `n`, WordNet `noun` → one label. */
const POS_ALIAS: Record<string, string> = {
  n: 'noun',
  noun: 'noun',
  nouns: 'noun',
  pl: 'noun',
  v: 'verb',
  vt: 'verb',
  vi: 'verb',
  vb: 'verb',
  verb: 'verb',
  verbs: 'verb',
  a: 'adjective',
  adj: 'adjective',
  adjective: 'adjective',
  pa: 'adjective',
  adv: 'adverb',
  adverb: 'adverb',
  superl: 'adjective',
  compar: 'adjective',
  prep: 'preposition',
  preposition: 'preposition',
  pron: 'pronoun',
  pronoun: 'pronoun',
  conj: 'conjunction',
  conjunction: 'conjunction',
  interj: 'interjection',
  interjection: 'interjection',
  art: 'article',
  article: 'article',
  det: 'determiner',
  determiner: 'determiner',
  num: 'numeral',
  numeral: 'numeral',
};

export function canonicalPos(raw?: string): string {
  const original = (raw || '').trim();
  if (!original) return 'unknown';
  const lower = original.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  const compact = lower.replace(/[^a-z]+/g, '');
  if (POS_ALIAS[compact]) return POS_ALIAS[compact];
  const first = lower.split(' ')[0];
  if (POS_ALIAS[first]) return POS_ALIAS[first];
  if (/^v(\s+[ti])+$/.test(lower) || compact.startsWith('vb')) return 'verb';
  if (/^p\s*(pr|p|a)\b/.test(lower)) return compact === 'pa' ? 'adjective' : 'verb';
  if (lower.includes('noun')) return 'noun';
  if (lower.includes('verb')) return 'verb';
  if (lower.includes('adjective')) return 'adjective';
  if (lower.includes('adverb')) return 'adverb';
  if (lower.includes('pronoun')) return 'pronoun';
  if (lower.includes('preposition')) return 'preposition';
  if (lower.includes('conjunction')) return 'conjunction';
  if (lower.includes('interjection')) return 'interjection';
  return lower || 'unknown';
}

const POS_CHIP_ABBREV: Record<string, string> = {
  adjective: 'adj.',
  adverb: 'adv.',
  preposition: 'prep.',
  pronoun: 'pron.',
  conjunction: 'conj.',
  interjection: 'interj.',
  article: 'art.',
  determiner: 'det.',
  numeral: 'num.',
};

/**
 * Chip label only. Noun/verb stay full (short already). Long POS → adj., adv., …
 * Headings in the main pane should use `canonicalPos`, not this.
 */
export function abbreviatePos(raw?: string): string {
  const canon = canonicalPos(raw);
  return POS_CHIP_ABBREV[canon] || canon;
}

function samePos(a: string, b: string): boolean {
  const pa = canonicalPos(a);
  const pb = canonicalPos(b);
  if (pa === pb) return true;
  if (pa === 'unknown' || pb === 'unknown') return true;
  return false;
}

function preferMeaning(a: string, b: string): string {
  // Prefer the longer, more informative gloss (usually has the parentheticals we stripped for matching).
  const ta = (a || '').trim();
  const tb = (b || '').trim();
  if (ta.length === tb.length) return ta.length >= tb.length ? ta : tb;
  return ta.length >= tb.length ? ta : tb;
}

function unionUnique(a?: string[], b?: string[]): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of [...(a || []), ...(b || [])]) {
    const k = exampleKey(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(tidyExample(String(x)));
  }
  return out.length ? out : undefined;
}

export function dedupeExamples(list?: string[]): string[] | undefined {
  return unionUnique(list, []) || undefined;
}

function citeList(def: MergeableDefinition): string[] {
  if (def.sources && def.sources.length) return [...def.sources];
  return def.source ? [def.source] : [];
}

function formatSourceLabel(sources: string[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const t = (s || '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(t);
  }
  return unique.join(' · ');
}

/** Function words; negations stay, since "not abridged" and "abridged" are opposite senses. */
const STOPWORDS = new Set(
  ('a an the of or and to in on at by for with from as into onto than that which who whom whose this these those ' +
    'it its is are was were be been being has have had do does did such any some one ones ' +
    'especially particularly usually often also etc e g i e').split(' '),
);

const NEGATIONS = new Set(['not', 'no', 'non', 'never', 'without', 'nor', 'neither', 'lacking']);

/** Harman's S-stemmer (1991): plurals and third-person -s only, so "shortened" never meets "short". */
function sStem(w: string): string {
  if (w.length > 3 && /ies$/.test(w) && !/[ae]ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (w.length > 3 && /es$/.test(w) && !/[aeo]es$/.test(w)) return w.slice(0, -1);
  if (w.length > 3 && /s$/.test(w) && !/[us]s$/.test(w)) return w.slice(0, -1);
  return w;
}

function contentWords(normalized: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(normalized)) {
    const w = t.replace(/'s$/, '').replace(/^['-]+|['-]+$/g, '');
    if (w && !STOPWORDS.has(w)) out.add(sStem(w));
  }
  return out;
}

/** One letter apart in a word of five or more, same first letter: "colour" and "color", "-ise" and "-ize". */
function spellingVariant(a: string, b: string): boolean {
  if (a[0] !== b[0] || Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  return levenshteinRatio(a, b) >= 1 - 1 / Math.max(a.length, b.length) - 1e-9;
}

/**
 * Two dictionaries' wording of one sense: every content word of the shorter sense is in the longer
 * one, which adds at most a fifth more (a qualifier, a domain label). This is the "exact" relation
 * of monolingual word sense alignment; a sense that differs in even one content word ("measuring
 * temperature" and "measuring pressure") or narrows the other a lot stays apart.
 */
function sameSenseWords(a: string, b: string): boolean {
  const wa = contentWords(a);
  const wb = contentWords(b);
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (!small.size || (small.size < 3 && small.size < big.size) || small.size / big.size < 0.8) return false;
  for (const w of small) if (!big.has(w) && ![...big].some((v) => spellingVariant(w, v))) return false;
  // A negation only one sense has turns it into the opposite sense.
  for (const w of big) if (NEGATIONS.has(w) && !small.has(w)) return false;
  return true;
}

function areSimilar(a: MergeableDefinition, b: MergeableDefinition): boolean {
  if (!samePos(a.partOfSpeech, b.partOfSpeech)) return false;
  const na = normalizeMeaningForMerge(a.meaning);
  const nb = normalizeMeaningForMerge(b.meaning);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Compared on words, not characters: "not abridged" holds "abridged", and one letter apart can
  // be another word ("temperature", "pressure" share most of a sentence).
  return sameSenseWords(na, nb) || sameSenseWords(normalizeMeaningForMerge(a.meaning, true), normalizeMeaningForMerge(b.meaning, true));
}

/** Two senses that say the same thing (`areSimilar`), for saved lines that carry no part of speech. */
export function sameSense(a: string, b: string): boolean {
  return areSimilar({ partOfSpeech: '', meaning: a, source: '' }, { partOfSpeech: '', meaning: b, source: '' });
}

/** The grammar codes, labels and collocations of two merged senses, each listed once. */
function notesUnion(a: MergeableDefinition, b: MergeableDefinition): Pick<MergeableDefinition, 'grammar' | 'labels' | 'collocations'> {
  const out: Pick<MergeableDefinition, 'grammar' | 'labels' | 'collocations'> = {};
  for (const k of ['grammar', 'labels', 'collocations'] as const) {
    const list: string[] = [];
    for (const x of [...(a[k] || []), ...(b[k] || [])]) if (x && !list.some((y) => y.toLowerCase() === x.toLowerCase())) list.push(x);
    if (list.length) out[k] = list;
  }
  return out;
}

/**
 * Merge near-duplicate definitions across sources into single senses with multi-cites.
 */
export function mergeSimilarDefinitions(defs: MergeableDefinition[]): MergeableDefinition[] {
  if (!defs || defs.length <= 1) return defs || [];

  const clusters: MergeableDefinition[] = [];

  for (const incoming of defs) {
    let mergedInto = -1;
    for (let i = 0; i < clusters.length; i++) {
      if (areSimilar(clusters[i], incoming)) {
        mergedInto = i;
        break;
      }
    }

    if (mergedInto < 0) {
      const sources = citeList(incoming);
      clusters.push({
        ...incoming,
        partOfSpeech: canonicalPos(incoming.partOfSpeech),
        meaning: (incoming.meaning || '').trim(),
        sources,
        source: formatSourceLabel(sources) || incoming.source || 'Unknown',
      });
      continue;
    }

    const base = clusters[mergedInto];
    const sources = [...citeList(base), ...citeList(incoming)];
    const posA = canonicalPos(base.partOfSpeech);
    const posB = canonicalPos(incoming.partOfSpeech);
    const mergedPos =
      posA !== 'unknown' && posA !== 'definition' ? posA
      : posB !== 'unknown' && posB !== 'definition' ? posB
      : posA;
    clusters[mergedInto] = {
      partOfSpeech: mergedPos,
      meaning: preferMeaning(base.meaning, incoming.meaning),
      examples: unionUnique(base.examples, incoming.examples),
      synonyms: unionUnique(base.synonyms, incoming.synonyms),
      antonyms: unionUnique(base.antonyms, incoming.antonyms),
      sources,
      source: formatSourceLabel(sources),
      senseOrder: Math.min(base.senseOrder ?? 80, incoming.senseOrder ?? 80),
      ...(base.ownSense || incoming.ownSense ? { ownSense: true } : {}),
      ...notesUnion(base, incoming),
    };
  }

  return clusters.map((c) => ({
    ...c,
    examples: unionUnique(c.examples, []) || undefined,
  }));
}

function sourceRank(def: MergeableDefinition): number {
  const blob = `${def.source || ''} ${(def.sources || []).join(' ')}`.toLowerCase();
  if (blob.includes('free dictionary')) return 0;
  if (blob.includes('wiktionary')) return 1;
  if (blob.includes('wordnet')) return 2;
  if (blob.includes('webster') || blob.includes('gcide')) return 3;
  if (blob.includes('datamuse')) return 4;
  return 5;
}

/**
 * Drop lemma senses that leaked onto an inflected query (verb “tantalize”
 * under “tantalizing”). Keep this form’s own POS, grammatical form-of
 * glosses (“present participle of …”), and every sense from Wiktionary,
 * whose page for the form holds only that form's senses.
 */
export function stripCrossLemmaSenses<T extends MergeableDefinition>(
  surface: string,
  defs: T[],
  isFormOf: (meaning: string) => boolean = isGrammaticalFormOfGloss,
): T[] {
  const lemmas = latinLemmasByPos(surface);
  if (!lemmas.noun && !lemmas.verb && !lemmas.adjective) return defs;
  const bucketOf = (d: MergeableDefinition): 'noun' | 'verb' | 'adjective' | null => {
    const pos = canonicalPos(d.partOfSpeech);
    const raw = String(d.partOfSpeech || '');
    return pos === 'noun' ? 'noun'
      : pos === 'verb' || /participle|gerund/i.test(raw) ? 'verb'
      : pos === 'adjective' ? 'adjective'
      : null;
  };
  const fromWiktionary = (d: MergeableDefinition) => /wiktionary/i.test(String(d.source || ''));
  // Parts of speech where Wiktionary's page for the form has a sense of its own.
  const wikiOwn = new Set((defs || []).filter((d) => fromWiktionary(d) && !isFormOf(d.meaning)).map(bucketOf));
  return (defs || []).filter((d) => {
    if (isGrammaticalFormOfGloss(d.meaning)) return true;
    // Wiktionary's page for the form lists the form's own senses ("glasses": spectacles).
    if (fromWiktionary(d)) return true;
    const bucket = bucketOf(d);
    if (!bucket) return true;
    // Where Wiktionary has only "plural of saving", WordNet's own "savings" sense stays.
    if (d.ownSense && !wikiOwn.has(bucket)) return true;
    return !lemmas[bucket];
  });
}

/**
 * Within each part of speech that has senses of its own, "plural of saving" and other form-of
 * senses come after them, as learner dictionaries give "savings" its money sense first and
 * leave the relation to a note. Every sense keeps a place its part of speech held, so the parts
 * of speech stay in their order, and one made only of form-of senses is left as it is.
 */
export function formOfSensesLast<T extends MergeableDefinition>(defs: T[], isFormOf: (meaning: string) => boolean): T[] {
  const list = [...(defs || [])];
  const slots = new Map<string, number[]>();
  list.forEach((d, i) => {
    const pos = canonicalPos(d.partOfSpeech);
    if (!slots.has(pos)) slots.set(pos, []);
    slots.get(pos)!.push(i);
  });
  const out = [...list];
  for (const at of slots.values()) {
    const members = at.map((i) => list[i]);
    const formOf = members.filter((d) => isFormOf(d.meaning));
    const own = members.filter((d) => !isFormOf(d.meaning));
    // A Wiktionary sub-heading ("from leave:") is not a sense of its own.
    const heading = (d: T) => /:\s*$/.test(String(d.meaning || '').replace(/<[^>]+>/g, ' ').trim());
    if (!formOf.length || !own.some((d) => !heading(d))) continue;
    const ordered = [...own, ...formOf];
    at.forEach((i, k) => (out[i] = ordered[k]));
  }
  return out;
}

/** Free Dictionary / Wiktionary native order first (common-reading), then other packs. */
export function sortDefinitionsByReadingOrder(defs: MergeableDefinition[]): MergeableDefinition[] {
  return [...(defs || [])].sort((a, b) => {
    const oa = a.senseOrder ?? 80;
    const ob = b.senseOrder ?? 80;
    if (oa !== ob) return oa - ob;
    return sourceRank(a) - sourceRank(b);
  });
}
