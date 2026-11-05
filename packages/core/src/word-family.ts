/**
 * Synchronic word family for the lexicon card: inflections, derivatives,
 * related terms, affixes — links, not extra senses.
 *
 * Source of truth is Wiktionary’s English (or detected-language) headings,
 * the same lists GoldenDict-style apps show. Local wink/stems fill gaps.
 */

import {
  foldLookupKey,
  isContentHeadword,
  latinCitationPos,
  latinLemmasByPos,
  lemmaFromFormOfHtml,
} from './text-normalize';
import { abbreviatePos } from './definition-merge';
import { isGrammaticalFormOfGloss } from './lookup-policy';
import { extractLanguageSection, scanTemplates, templateToLink, type EtymologyLink } from './etymology';
import { derivationalStems } from './pronunciation';
import { cmuKnownSync } from './cmu-ipa';

export type WordFamilyRelation =
  | 'forms'
  | 'lemma'
  | 'derived'
  | 'phrases'
  | 'related'
  | 'alternatives'
  | 'affixes'
  | 'roots'
  | 'seeAlso';

export interface WordFamilyItem {
  word: string;
  /** Short POS / formation banner on the chip: adj./adv. for long labels; noun/verb stay full. */
  label?: string;
  /** No recorded use at all (a coinage such as "redundantant"): listed only under "All". */
  rare?: boolean;
}

export interface WordFamilyGroup {
  relation: WordFamilyRelation;
  items: WordFamilyItem[];
}

const FAMILY_CAP = 40;

const LANG_SECTION: Record<string, string> = {
  en: 'English',
  eng: 'English',
  zh: 'Chinese',
  cmn: 'Chinese',
  ja: 'Japanese',
  jpn: 'Japanese',
  ko: 'Korean',
  kor: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  ru: 'Russian',
  pt: 'Portuguese',
  la: 'Latin',
};

const HEADING_RELATION: Record<string, WordFamilyRelation> = {
  'alternative forms': 'alternatives',
  'alternative form': 'alternatives',
  'derived terms': 'derived',
  'related terms': 'related',
  'see also': 'seeAlso',
  descendants: 'derived',
  hyponyms: 'related',
  hypernyms: 'related',
  'coordinate terms': 'related',
  troponyms: 'related',
  holonyms: 'related',
  meronyms: 'related',
  idioms: 'phrases',
  idiom: 'phrases',
  phrases: 'phrases',
  proverb: 'phrases',
  proverbs: 'phrases',
  collocations: 'phrases',
  collocation: 'phrases',
};

const SKIP_HEADINGS = /^(etymology|pronunciation|noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|article|determiner|particle|numeral|translations?|synonyms|antonyms|anagrams|further reading|references|usage notes|quotations|examples|conjugation|declension|mutation|trivia|gallery)$/i;

const COL_TEMPLATES = new Set([
  'col', 'col1', 'col2', 'col3', 'col4', 'col5', 'col-auto',
  'der-top', 'der-mid', 'der-bottom', 'der2', 'der3', 'der4', 'der5', 'der-top3',
  'rel-top', 'rel-mid', 'rel-bottom', 'rel2', 'rel3', 'rel4', 'rel5', 'rel-top3',
]);

const LINK_TEMPLATES = new Set(['l', 'link', 'm', 'mention', 'll']);

const INFL_TEMPLATES = new Set([
  'en-verb', 'en-noun', 'en-adj', 'en-adv', 'en-proper noun', 'en-proper-noun',
  'en-pp', 'en-ing-form', 'head',
]);

const FORM_OF_TEMPLATES = new Set([
  'infl of', 'inflection of', 'plural of', 'present participle of',
  'past participle of', 'gerund of', 'en-past of', 'en-simple past of',
  'en-third-person singular of', 'en-ing form of', 'adj form of',
  'noun form of', 'verb form of', 'alternative form of', 'alt form',
  'alternative spelling of', 'alt sp',
]);

function langSectionName(language?: string): string {
  const code = (language || 'en').toLowerCase().split('-')[0];
  return LANG_SECTION[code] || 'English';
}

function cleanTerm(raw: string): string {
  let t = String(raw || '').trim();
  t = t.replace(/^\[\[/, '').replace(/\]\]$/, '');
  t = t.replace(/\{\{|\}\}/g, '');
  t = t.split('|')[0] || t;
  t = t.replace(/#.*$/, '').replace(/_/g, ' ').trim();
  t = t.replace(/^w:/i, '').replace(/^en:/i, '');
  // "-y<id:adjectival>", "<t:gloss>": inline modifiers from newer Wiktionary templates.
  t = t.replace(/<[a-z]+:[^>]*>/gi, '');
  try {
    t = decodeURIComponent(t);
  } catch {
    /* keep */
  }
  return t.replace(/\s+/g, ' ').trim();
}

function isAffixOrRootToken(term: string): boolean {
  const t = term.trim();
  if (!t || t.length > 80) return false;
  if (t.startsWith('*') || t.startsWith('-') || t.endsWith('-')) return t.length >= 2;
  return isContentHeadword(t);
}

/** Wiktionary `{{head|en|verb form}}` POS strings — never lookup chips. */
function isGrammarLabel(term: string): boolean {
  const t = cleanTerm(term).toLowerCase().replace(/\./g, '');
  if (!t || t.length > 40) return false;
  if (/^(verb|noun|adjective|adverb|adj|adv|proper|pronoun|preposition|conjunction|interjection|article|determiner|particle|numeral|participle|gerund|infinitive|plural|singular|comparative|superlative|head|form)s?$/i.test(t)) {
    return true;
  }
  return /^(verb|noun|adj|adjective|adv|adverb|proper(?:\s+noun)?)(\s+form)?$/i.test(t);
}

function normalizeBanner(raw: string): string | undefined {
  const t = cleanTerm(raw).toLowerCase().replace(/\./g, '');
  if (!t) return undefined;
  if (/verb/.test(t) && /form/.test(t)) return abbreviatePos('verb');
  if (/noun/.test(t) && /form/.test(t)) return abbreviatePos('noun');
  if (/(adjective|adj)/.test(t)) return abbreviatePos('adjective');
  if (/(adverb|adv)/.test(t)) return abbreviatePos('adverb');
  if (/present\s+participle|pres(?:ent)?\s*ptcp|gerund/.test(t)) return 'participle';
  if (/past\s+participle|past\s*ptcp/.test(t)) return 'pp.';
  if (/^plural|pl\b/.test(t)) return 'pl.';
  if (/^verb$/.test(t)) return abbreviatePos('verb');
  if (/^noun$/.test(t)) return abbreviatePos('noun');
  if (isGrammarLabel(raw)) return t.replace(/\s+form$/, '');
  return undefined;
}

function acceptFamilyTerm(term: string, surfaceKey: string, affixLike: boolean): string | undefined {
  const t = cleanTerm(term);
  if (!t) return undefined;
  if (foldLookupKey(t) === surfaceKey) return undefined;
  if (isGrammarLabel(t)) return undefined;
  if (affixLike) {
    if (!isAffixOrRootToken(t)) return undefined;
    return t;
  }
  if (!isContentHeadword(t)) return undefined;
  return t;
}

function collectWikiLinks(body: string, surfaceKey: string, into: string[]): void {
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const title = m[1] || '';
    if (/^(File|Category|Special|Wiktionary|Template|Appendix|Help|Module|User|Talk|Reconstruction|Image):/i.test(title)) {
      continue;
    }
    const ok = acceptFamilyTerm(title, surfaceKey, false);
    if (ok) into.push(ok);
  }
}

function isMultiwordTerm(term: string): boolean {
  return /\s/.test(term.trim());
}

function phraseKindLabel(raw?: string): string | undefined {
  const t = (raw || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!t) return undefined;
  if (/idiom/.test(t)) return 'idiom';
  if (/proverb/.test(t)) return 'proverb';
  if (/collocat/.test(t)) return 'colloc.';
  if (/compound/.test(t)) return 'compound';
  return undefined;
}

function posFromWiki(raw?: string): string | undefined {
  const t = (raw || '').toLowerCase().replace(/\./g, '').trim();
  if (!t) return undefined;
  if (/^(n|noun|nn)$/.test(t)) return abbreviatePos('noun');
  if (/^(v|verb|vb)$/.test(t)) return abbreviatePos('verb');
  if (/^(a|adj|adjective)$/.test(t)) return abbreviatePos('adjective');
  if (/^(adv|adverb)$/.test(t)) return abbreviatePos('adverb');
  if (/idiom/.test(t)) return 'idiom';
  return normalizeBanner(t);
}

function suffixPosGuess(word: string): string | undefined {
  const w = word.trim().toLocaleLowerCase();
  if (w.length < 4 || /\s/.test(w)) return undefined;
  if (/(?:lly|ily)$/.test(w) || (w.length > 4 && /ly$/.test(w))) return abbreviatePos('adverb');
  if (/(?:tion|sion|ness|ity|ment|ism|ship|hood|ance|ence|age|ist|ian|ee)$/.test(w)) return abbreviatePos('noun');
  if (w.length >= 7 && /(?:er|or)$/.test(w)) return abbreviatePos('noun');
  if (w.length >= 5 && /(?:ize|ise|ate|ify)$/.test(w)) return abbreviatePos('verb');
  if (/(?:ous|ive|able|ible|ical|ful|less|ary|ory|ish|al|ic)$/.test(w)) return abbreviatePos('adjective');
  if (w.length >= 6 && /ing$/.test(w)) return abbreviatePos('verb');
  return undefined;
}

function inferPosBanner(word: string): string | undefined {
  const t = cleanTerm(word);
  if (!t || isMultiwordTerm(t)) return undefined;
  return suffixPosGuess(t) || latinCitationPos(t) || undefined;
}

function inferPhraseBanner(_term: string, hint?: string): string | undefined {
  const kind = phraseKindLabel(hint);
  return kind || undefined;
}

function termsFromTemplate(name: string, positional: string[], named: Record<string, string>, surfaceKey: string): string[] {
  return itemsFromTemplate(name, positional, named, surfaceKey).map((i) => i.word);
}

function itemsFromTemplate(
  name: string,
  positional: string[],
  named: Record<string, string>,
  surfaceKey: string,
  groupHint?: string,
): WordFamilyItem[] {
  const out: WordFamilyItem[] = [];
  const push = (raw: string, affix = false, extraLabel?: string) => {
    const ok = acceptFamilyTerm(raw, surfaceKey, affix);
    if (!ok) return;
    const label = extraLabel
      || posFromWiki(named.pos)
      || phraseKindLabel(named.q || named.qq || named.qual || named.lit || groupHint)
      || undefined;
    out.push({ word: ok, label });
  };

  if (COL_TEMPLATES.has(name) || LINK_TEMPLATES.has(name)) {
    const start = /^[a-z]{2,3}(?:-[a-z]+)?$/i.test(positional[0] || '') ? 1 : 0;
    const titleHint = named.title || named.titlename || groupHint;
    for (let i = 0; i < positional.slice(start).length; i++) {
      const p = positional[start + i];
      if (!p || p === '-' || p.startsWith('!')) continue;
      const qn = named[`q${i + 1}`] || named[`qq${i + 1}`];
      push(p, false, posFromWiki(qn) || posFromWiki(named.pos) || phraseKindLabel(qn) || phraseKindLabel(titleHint));
    }
    if (named.term) push(named.term, false, phraseKindLabel(titleHint));
    if (named.alt) push(named.alt, false, phraseKindLabel(titleHint));
    return out;
  }

  if (INFL_TEMPLATES.has(name)) {
    if (name === 'head') return out;
    for (const p of positional) {
      if (!p || /^(en|head|verb|noun|adjective|adverb|proper)$/i.test(p)) continue;
      if (isGrammarLabel(p)) continue;
      if (/^(es|s|ing|ed|er|est)$/i.test(p) && p.length <= 3) continue;
      push(p);
    }
    for (const key of ['pres_ptcp', 'past_ptcp', 'past', 'plural', 'sg', 'pl', 'head']) {
      if (named[key]) push(named[key]);
    }
    return out;
  }

  if (FORM_OF_TEMPLATES.has(name)) {
    const start = /^[a-z]{2,3}$/i.test(positional[0] || '') ? 1 : 0;
    const lemma = positional[start] || named.term;
    if (lemma) push(lemma);
    return out;
  }

  return out;
}

function parseHeadingGroups(scope: string, surfaceKey: string): Map<WordFamilyRelation, WordFamilyItem[]> {
  const groups = new Map<WordFamilyRelation, WordFamilyItem[]>();
  const heading = /^(={3,})\s*([^=\n]+?)\s*\1\s*$/gm;
  const found: Array<{ title: string; index: number; len: number }> = [];
  let hm: RegExpExecArray | null;
  while ((hm = heading.exec(scope)) !== null) {
    found.push({ title: hm[2].trim(), index: hm.index, len: hm[0].length });
  }

  for (let i = 0; i < found.length; i++) {
    const start = found[i].index + found[i].len;
    const end = i + 1 < found.length ? found[i + 1].index : scope.length;
    const key = found[i].title.toLowerCase().replace(/\s+/g, ' ');
    if (SKIP_HEADINGS.test(key)) continue;
    const relation = HEADING_RELATION[key];
    if (!relation) continue;
    const body = scope.slice(start, end);
    const items: WordFamilyItem[] = [];
    const words: string[] = [];
    collectWikiLinks(body, surfaceKey, words);
    for (const w of words) items.push({ word: w });
    for (const t of scanTemplates(body)) {
      const titleHint = t.named.title || t.named.titlename || found[i].title;
      items.push(...itemsFromTemplate(t.name, t.positional, t.named, surfaceKey, titleHint));
    }
    if (items.length) {
      const acc = groups.get(relation) || [];
      acc.push(...items);
      groups.set(relation, acc);
    }
  }
  return groups;
}

type FamilyBuckets = Map<WordFamilyRelation, WordFamilyItem[]>;

function targetRelation(relation: WordFamilyRelation, item: WordFamilyItem): WordFamilyRelation {
  if (relation === 'phrases') return 'phrases';
  if (relation === 'derived' && isMultiwordTerm(item.word)) return 'phrases';
  return relation;
}

function addUnique(
  buckets: FamilyBuckets,
  relation: WordFamilyRelation,
  terms: string[],
  surfaceKey: string,
  affixLike = false,
  label?: string,
): void {
  addUniqueItems(
    buckets,
    relation,
    terms.map((word) => ({ word, label })),
    surfaceKey,
    affixLike,
  );
}

function addUniqueItems(
  buckets: FamilyBuckets,
  relation: WordFamilyRelation,
  items: WordFamilyItem[],
  surfaceKey: string,
  affixLike = false,
): void {
  for (const item of items) {
    const ok = acceptFamilyTerm(item.word, surfaceKey, affixLike);
    if (!ok) continue;
    const dest = targetRelation(relation, { word: ok, label: item.label });
    const acc = buckets.get(dest) || [];
    const seen = new Set(acc.map((i) => foldLookupKey(i.word)));
    const k = foldLookupKey(ok);
    if (!k) continue;
    let banner = item.label && item.label !== 'phrase' ? item.label : undefined;
    if (!banner) {
      banner = dest === 'phrases' ? inferPhraseBanner(ok) : inferPosBanner(ok);
    } else if (dest === 'phrases' && posFromWiki(banner) && !phraseKindLabel(banner)) {
      banner = inferPhraseBanner(ok, banner);
    }
    if (seen.has(k)) {
      const hit = acc.find((i) => foldLookupKey(i.word) === k);
      if (hit && banner && !hit.label) hit.label = banner;
      buckets.set(dest, acc);
      continue;
    }
    if (acc.length >= FAMILY_CAP) {
      buckets.set(dest, acc);
      continue;
    }
    acc.push({ word: ok, label: banner });
    buckets.set(dest, acc);
  }
}

function lemmasFromDefinitions(defs: Array<{ meaning?: string }> | undefined, surface: string): WordFamilyItem[] {
  const out: WordFamilyItem[] = [];
  for (const d of defs || []) {
    const meaning = d.meaning || '';
    if (!isGrammaticalFormOfGloss(meaning)) continue;
    const fromHtml = lemmaFromFormOfHtml(meaning, surface);
    const text = meaning.replace(/<[^>]+>/g, ' ');
    const m = /\bof\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'-]*)/i.exec(text);
    const word = fromHtml || m?.[1];
    if (!word) continue;
    const label = normalizeBanner(text) || undefined;
    out.push({ word, label });
  }
  return out;
}

export function familyFromEtymologyChain(chain?: EtymologyLink[] | null, surface = ''): WordFamilyGroup[] {
  if (!chain || !chain.length) return [];
  const surfaceKey = foldLookupKey(surface);
  const affixes: string[] = [];
  const roots: string[] = [];
  for (const link of chain) {
    if (link.relation === 'affix' || link.relation === 'blend') {
      affixes.push(...(link.parts || []));
    } else if (link.relation === 'root' && link.term) {
      roots.push(link.term);
    }
  }
  const buckets: FamilyBuckets = new Map();
  addUnique(buckets, 'affixes', affixes, surfaceKey, true, 'affix');
  addUnique(buckets, 'roots', roots, surfaceKey, true, 'root');
  return groupsFromBuckets(buckets);
}

/** How close a family member is to the headword: its derivatives first, proper names last. */
function familyRank(word: string, surfaceKey: string, relation: WordFamilyRelation): number {
  const w = word.trim();
  const k = foldLookupKey(w);
  let score = 0;
  if (/^\p{Lu}/u.test(w) && !/^\p{Lu}/u.test(surfaceKey)) score += 40;
  if (relation === 'phrases') {
    score += Math.min(30, w.split(/\s+/).length * 4) + w.length / 10;
    if (!k.split(/\s+/).includes(surfaceKey)) score += 8;
    return score;
  }
  // happy → happiness, happily: the stem drops a final y or e.
  const stem = surfaceKey.length > 4 ? surfaceKey.replace(/[ye]$/, '') : surfaceKey;
  if (stem && k.startsWith(stem)) score -= 10;
  else if (stem && k.includes(stem)) score -= 4;
  if (/[\s-]/.test(w)) score += 6;
  // Words common enough for the pronouncing dictionary come before coinages.
  if (cmuKnownSync(k)) score -= 6;
  return score + w.length / 20;
}

function groupsFromBuckets(buckets: FamilyBuckets, surfaceKey = ''): WordFamilyGroup[] {
  // Inflections and "form of" live in the Forms section (inflections.ts), not here.
  const order: WordFamilyRelation[] = [
    'alternatives', 'derived', 'related', 'phrases', 'affixes', 'roots', 'seeAlso',
  ];
  const out: WordFamilyGroup[] = [];
  for (const relation of order) {
    const items = buckets.get(relation);
    if (!items || !items.length) continue;
    const seen = new Set<string>();
    const unique: WordFamilyItem[] = [];
    for (const it of items) {
      const k = foldLookupKey(it.word);
      if (!k || seen.has(k)) {
        if (k && it.label) {
          const hit = unique.find((u) => foldLookupKey(u.word) === k);
          if (hit && !hit.label) hit.label = it.label;
        }
        continue;
      }
      seen.add(k);
      unique.push({ word: it.word, label: it.label });
      if (unique.length >= FAMILY_CAP) break;
    }
    if (!unique.length) continue;
    if (relation === 'derived' || relation === 'phrases' || relation === 'related') {
      const indexed = unique.map((it, i) => ({ it, i, r: familyRank(it.word, surfaceKey, relation) }));
      indexed.sort((a, b) => a.r - b.r || a.i - b.i);
      out.push({ relation, items: indexed.map((x) => x.it) });
    } else {
      out.push({ relation, items: unique });
    }
  }
  return out;
}

/**
 * The part of a word its derived and related words share, for one Datamuse query that returns
 * their frequencies: "redund" for redundant (redundancy, redundantly), "dichot" for dichotomy.
 */
export function familyStem(word: string): string {
  const w = foldLookupKey(word);
  if (!/^\p{L}+$/u.test(w)) return '';
  return w.length <= 4 ? w : w.slice(0, Math.max(4, w.length - 3));
}

/** Frequencies for one family: per million words, keyed by folded word. */
export interface FamilyFrequencies {
  stem: string;
  /** Every word containing the stem is listed, so a missing one has no recorded use. */
  complete: boolean;
  freq: Record<string, number>;
}

/**
 * How often each word containing the stem is used, per million words (Google Books Ngrams,
 * through Datamuse, the same figures the search suggestions use), from one wildcard query.
 */
export async function fetchFamilyFrequencies(
  http: { requestJson<T>(url: string, init?: { timeoutMs?: number }): Promise<T> },
  word: string,
): Promise<FamilyFrequencies | null> {
  const stem = familyStem(word);
  if (!stem) return null;
  const max = 1000;
  const rows = await http.requestJson<Array<{ word?: string; tags?: string[] }>>(
    `https://api.datamuse.com/words?sp=${encodeURIComponent(`*${stem}*`)}&md=f&max=${max}`,
    { timeoutMs: 4000 },
  );
  const list = Array.isArray(rows) ? rows : [];
  const freq: Record<string, number> = {};
  for (const r of list) {
    const f = Number((r?.tags || []).find((t) => t.startsWith('f:'))?.slice(2) || 0);
    if (r?.word && f > 0) freq[foldLookupKey(r.word)] = f;
  }
  return { stem, complete: list.length < max, freq };
}

/**
 * Derived and related words ordered by how common they are, commonest first: "redundancy" and
 * "redundantly" before "redundantant". Then the words with no frequency that are still known
 * words (in the pronouncing dictionary, as "redound" is), then those with no recorded use at
 * all, which are marked rare: a word containing the stem that Datamuse does not list, or one
 * the pronouncing dictionary does not have. Without frequencies the groups stay as they are.
 */
export function rankFamilyByFrequency(groups: WordFamilyGroup[], data: FamilyFrequencies | null | undefined): WordFamilyGroup[] {
  if (!data || !Object.keys(data.freq || {}).length) return groups;
  return groups.map((g) => {
    if (g.relation !== 'derived' && g.relation !== 'related') return g;
    const indexed = g.items.map((it, i) => {
      const k = foldLookupKey(it.word);
      const f = data.freq[k] || 0;
      const rare = !f && ((data.complete && k.includes(data.stem)) || cmuKnownSync(k) === false);
      return { it, i, f, tier: f ? 0 : rare ? 2 : 1 };
    });
    indexed.sort((a, b) => a.tier - b.tier || b.f - a.f || a.i - b.i);
    return { ...g, items: indexed.map(({ it, tier }) => (tier === 2 ? { ...it, rare: true } : it)) };
  });
}

export function mergeWordFamilyGroups(...lists: Array<WordFamilyGroup[] | undefined>): WordFamilyGroup[] {
  return mergeWordFamilyGroupsFor('', ...lists);
}

/** Merge, then order each group by closeness to the headword. */
export function mergeWordFamilyGroupsFor(surface: string, ...lists: Array<WordFamilyGroup[] | undefined>): WordFamilyGroup[] {
  const buckets: FamilyBuckets = new Map();
  for (const list of lists) {
    for (const g of list || []) {
      const acc = buckets.get(g.relation) || [];
      const items = g.items && g.items.length
        ? g.items
        : ((g as WordFamilyGroup & { words?: string[] }).words || []).map((word) => ({ word }));
      acc.push(...items);
      buckets.set(g.relation, acc);
    }
  }
  return groupsFromBuckets(buckets, foldLookupKey(surface));
}

/**
 * Derived and related terms from Wiktextract's parse of the word's Wiktionary page (one kaikki.org
 * JSON Lines page): the same "Derived terms" and "Related terms" lists the wikitext has, already
 * parsed, from a static file that answers when Wiktionary's parse API is slow. Words that only
 * come from a Thesaurus page (synonyms, not family) are left out.
 */
export function familyFromKaikki(jsonl: string, word: string, lang = 'en'): WordFamilyGroup[] {
  const w = String(word || '').trim();
  const surfaceKey = foldLookupKey(w);
  const buckets: FamilyBuckets = new Map();
  for (const line of String(jsonl || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let entry: any;
    try {
      entry = JSON.parse(t);
    } catch {
      continue;
    }
    if (lang && entry?.lang_code && entry.lang_code !== lang) continue;
    if (typeof entry?.word === 'string' && foldLookupKey(entry.word) !== surfaceKey) continue;
    for (const [field, relation] of [['derived', 'derived'], ['related', 'related']] as const) {
      const list: Array<{ word?: string; source?: string; tags?: string[] }> = Array.isArray(entry?.[field]) ? entry[field] : [];
      const items = list
        .filter((x) => x && typeof x.word === 'string' && !/^Thesaurus:/i.test(String(x.source || '')))
        .map((x) => ({ word: String(x.word), label: posFromWiki((x.tags || []).find((tag) => !!posFromWiki(tag))) }));
      addUniqueItems(buckets, relation, items, surfaceKey);
    }
  }
  return groupsFromBuckets(buckets, surfaceKey);
}

export function buildWordFamily(opts: {
  surface: string;
  wikitext?: string;
  language?: string;
  definitions?: Array<{ meaning?: string }>;
  etymologyChain?: EtymologyLink[];
}): WordFamilyGroup[] {
  const surface = (opts.surface || '').trim();
  const surfaceKey = foldLookupKey(surface);
  const buckets: FamilyBuckets = new Map();

  const byPos = latinLemmasByPos(surface);
  if (byPos.verb) addUnique(buckets, 'forms', [byPos.verb], surfaceKey, false, abbreviatePos('verb'));
  if (byPos.noun) addUnique(buckets, 'forms', [byPos.noun], surfaceKey, false, abbreviatePos('noun'));
  if (byPos.adjective) addUnique(buckets, 'forms', [byPos.adjective], surfaceKey, false, abbreviatePos('adjective'));
  addUnique(buckets, 'forms', derivationalStems(surface), surfaceKey);
  for (const it of lemmasFromDefinitions(opts.definitions, surface)) {
    addUnique(buckets, 'lemma', [it.word], surfaceKey, false, it.label);
  }

  // A page with no section for this language (an English lookup of "Haus") has no family
  // here; reading the whole page mixed in Faroese, Malay and Icelandic words.
  const sectionName = langSectionName(opts.language);
  const hasSection =
    !!opts.wikitext &&
    (new RegExp(`^==\\s*${sectionName}\\s*==\\s*$`, 'm').test(opts.wikitext) || !/^==[^=\n]+==\s*$/m.test(opts.wikitext));
  if (opts.wikitext && hasSection) {
    const scope = extractLanguageSection(opts.wikitext, sectionName);
    const fromHeadings = parseHeadingGroups(scope, surfaceKey);
    for (const [rel, items] of fromHeadings) {
      addUniqueItems(buckets, rel, items, surfaceKey);
    }
    const infl: string[] = [];
    const lemmaBits: string[] = [];
    let headBanner: string | undefined;
    for (const t of scanTemplates(scope)) {
      if (t.name === 'head') {
        const pos = t.positional[1] || t.named.pos;
        if (pos) headBanner = normalizeBanner(pos) || headBanner;
        continue;
      }
      if (INFL_TEMPLATES.has(t.name)) {
        infl.push(...termsFromTemplate(t.name, t.positional, t.named, surfaceKey));
      }
      if (FORM_OF_TEMPLATES.has(t.name)) {
        const bits = termsFromTemplate(t.name, t.positional, t.named, surfaceKey);
        lemmaBits.push(...bits);
        const banner = normalizeBanner(t.name.replace(/\s+of$/, '')) || normalizeBanner(t.name);
        for (const w of bits) addUnique(buckets, 'lemma', [w], surfaceKey, false, banner);
      }
    }
    addUnique(buckets, 'forms', infl, surfaceKey);
    addUnique(buckets, 'lemma', lemmaBits, surfaceKey, false, headBanner);
    if (headBanner) {
      const lemmas = buckets.get('lemma') || [];
      for (const it of lemmas) {
        if (!it.label) it.label = headBanner;
      }
      if (lemmas.length) buckets.set('lemma', lemmas);
    }

    const etyBits = familyFromEtymologyChain(
      (opts.etymologyChain && opts.etymologyChain.length)
        ? opts.etymologyChain
        : scanTemplates(scope).map(templateToLink).filter((x): x is EtymologyLink => !!x),
      surface,
    );
    for (const g of etyBits) {
      addUnique(
        buckets,
        g.relation,
        g.items.map((i) => i.word),
        surfaceKey,
        g.relation === 'affixes' || g.relation === 'roots',
        g.relation === 'affixes' ? 'affix' : g.relation === 'roots' ? 'root' : undefined,
      );
    }
  } else if (opts.etymologyChain) {
    for (const g of familyFromEtymologyChain(opts.etymologyChain, surface)) {
      addUnique(
        buckets,
        g.relation,
        g.items.map((i) => i.word),
        surfaceKey,
        g.relation === 'affixes' || g.relation === 'roots',
        g.relation === 'roots' ? 'root' : 'affix',
      );
    }
  }

  const out = groupsFromBuckets(buckets, surfaceKey);
  for (const g of out) {
    if (g.relation === 'phrases') {
      for (const it of g.items) {
        if (it.label === 'phrase') it.label = undefined;
      }
      continue;
    }
    if (g.relation !== 'forms' && g.relation !== 'lemma' && g.relation !== 'derived') continue;
    for (const it of g.items) {
      if (it.label) continue;
      const k = foldLookupKey(it.word);
      if (byPos.verb && foldLookupKey(byPos.verb) === k) it.label = 'verb';
      else if (byPos.noun && foldLookupKey(byPos.noun) === k) it.label = 'noun';
      else if (byPos.adjective && foldLookupKey(byPos.adjective) === k) it.label = 'adj.';
      else it.label = inferPosBanner(it.word);
    }
  }
  return out;
}
