/**
 * Cross-source definition merge: identical / near-identical glosses collapse
 * into one sense with multiple citation labels (Free Dictionary · Wiktionary · Datamuse).
 */

import { isGrammaticalFormOfGloss } from './lookup-policy';
import { latinLemmasByPos } from './text-normalize';

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
}

/** Strip sense numbers, parenthetical asides, and normalize for comparison. */
export function normalizeMeaningForMerge(raw: string): string {
  let s = (raw || '')
    .normalize('NFC')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');

  // Drop leading sense markers
  s = s.replace(/^\s*(?:\(?\d+[.)]\)?|[①②③④⑤⑥⑦⑧⑨⑩]|[a-z]\))\s*/i, '');

  // Parenthetical asides (often POS tags / register notes that differ across sources)
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/（[^）]*）/g, ' ');

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

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
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
    out.push(String(x).trim());
  }
  return out.length ? out : undefined;
}

/** Collapse quote/HTML/whitespace variants so the same sentence is not shown twice. */
export function exampleKey(s: string): string {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function areSimilar(a: MergeableDefinition, b: MergeableDefinition): boolean {
  if (!samePos(a.partOfSpeech, b.partOfSpeech)) return false;
  const na = normalizeMeaningForMerge(a.meaning);
  const nb = normalizeMeaningForMerge(b.meaning);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // Containment of normalized forms (one source omits a clause)
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;
    if (shorter.length / longer.length >= 0.72) return true;
  }

  const jac = jaccard(tokenize(na), tokenize(nb));
  if (jac >= 0.82) return true;

  const lev = levenshteinRatio(na, nb);
  return lev >= 0.88;
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
 * under “tantalizing”). Keep this form’s own POS and grammatical form-of
 * glosses (“present participle of …”).
 */
export function stripCrossLemmaSenses<T extends MergeableDefinition>(surface: string, defs: T[]): T[] {
  const lemmas = latinLemmasByPos(surface);
  if (!lemmas.noun && !lemmas.verb && !lemmas.adjective) return defs;
  return (defs || []).filter((d) => {
    if (isGrammaticalFormOfGloss(d.meaning)) return true;
    const pos = canonicalPos(d.partOfSpeech);
    const raw = String(d.partOfSpeech || '');
    const bucket =
      pos === 'noun' ? 'noun'
      : pos === 'verb' || /participle|gerund/i.test(raw) ? 'verb'
      : pos === 'adjective' ? 'adjective'
      : null;
    if (!bucket) return true;
    return !lemmas[bucket];
  });
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
