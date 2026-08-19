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
  latinLemmaForms,
  lemmaFromFormOfHtml,
} from './text-normalize';
import { isGrammaticalFormOfGloss } from './lookup-policy';
import { extractLanguageSection, scanTemplates, templateToLink, type EtymologyLink } from './etymology';
import { derivationalStems } from './pronunciation';

export type WordFamilyRelation =
  | 'forms'
  | 'lemma'
  | 'derived'
  | 'related'
  | 'alternatives'
  | 'affixes'
  | 'roots'
  | 'seeAlso';

export interface WordFamilyGroup {
  relation: WordFamilyRelation;
  words: string[];
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
};

const SKIP_HEADINGS = /^(etymology|pronunciation|noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|article|determiner|particle|numeral|translations?|synonyms|antonyms|anagrams|further reading|references|usage notes|quotations|examples|conjugation|declension|mutation|trivia|gallery)$/i;

const COL_TEMPLATES = new Set([
  'col', 'col1', 'col2', 'col3', 'col4', 'col5', 'col-auto',
  'der-top', 'der-mid', 'der-bottom', 'der3', 'der4', 'der-top3',
  'rel-top', 'rel-mid', 'rel-bottom', 'rel3', 'rel4', 'rel-top3',
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

function acceptFamilyTerm(term: string, surfaceKey: string, affixLike: boolean): string | undefined {
  const t = cleanTerm(term);
  if (!t) return undefined;
  if (foldLookupKey(t) === surfaceKey) return undefined;
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

function termsFromTemplate(name: string, positional: string[], named: Record<string, string>, surfaceKey: string): string[] {
  const out: string[] = [];
  const push = (raw: string, affix = false) => {
    const ok = acceptFamilyTerm(raw, surfaceKey, affix);
    if (ok) out.push(ok);
  };

  if (COL_TEMPLATES.has(name) || LINK_TEMPLATES.has(name)) {
    const start = /^[a-z]{2,3}(?:-[a-z]+)?$/i.test(positional[0] || '') ? 1 : 0;
    for (const p of positional.slice(start)) {
      if (!p || p === '-' || p.startsWith('!')) continue;
      push(p);
    }
    if (named.term) push(named.term);
    if (named.alt) push(named.alt);
    return out;
  }

  if (INFL_TEMPLATES.has(name)) {
    for (const p of positional) {
      if (!p || /^(en|head|verb|noun|adjective|adverb|proper)$/i.test(p)) continue;
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

function parseHeadingGroups(scope: string, surfaceKey: string): Map<WordFamilyRelation, string[]> {
  const groups = new Map<WordFamilyRelation, string[]>();
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
    const words: string[] = [];
    collectWikiLinks(body, surfaceKey, words);
    for (const t of scanTemplates(body)) {
      words.push(...termsFromTemplate(t.name, t.positional, t.named, surfaceKey));
    }
    if (words.length) {
      const acc = groups.get(relation) || [];
      acc.push(...words);
      groups.set(relation, acc);
    }
  }
  return groups;
}

function addUnique(
  buckets: Map<WordFamilyRelation, string[]>,
  relation: WordFamilyRelation,
  terms: string[],
  surfaceKey: string,
  affixLike = false,
): void {
  const acc = buckets.get(relation) || [];
  const seen = new Set(acc.map(foldLookupKey));
  for (const raw of terms) {
    const ok = acceptFamilyTerm(raw, surfaceKey, affixLike);
    if (!ok) continue;
    const k = foldLookupKey(ok);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    acc.push(ok);
    if (acc.length >= FAMILY_CAP) break;
  }
  if (acc.length) buckets.set(relation, acc);
}

function lemmasFromDefinitions(defs: Array<{ meaning?: string }> | undefined, surface: string): string[] {
  const out: string[] = [];
  for (const d of defs || []) {
    const meaning = d.meaning || '';
    if (!isGrammaticalFormOfGloss(meaning)) continue;
    const fromHtml = lemmaFromFormOfHtml(meaning, surface);
    if (fromHtml) out.push(fromHtml);
    const text = meaning.replace(/<[^>]+>/g, ' ');
    const m = /\bof\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'-]*)/i.exec(text);
    if (m && m[1]) out.push(m[1]);
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
  const buckets = new Map<WordFamilyRelation, string[]>();
  addUnique(buckets, 'affixes', affixes, surfaceKey, true);
  addUnique(buckets, 'roots', roots, surfaceKey, true);
  return groupsFromBuckets(buckets);
}

function groupsFromBuckets(buckets: Map<WordFamilyRelation, string[]>): WordFamilyGroup[] {
  const order: WordFamilyRelation[] = [
    'forms', 'lemma', 'alternatives', 'derived', 'related', 'affixes', 'roots', 'seeAlso',
  ];
  const out: WordFamilyGroup[] = [];
  for (const relation of order) {
    const words = buckets.get(relation);
    if (!words || !words.length) continue;
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const w of words) {
      const k = foldLookupKey(w);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      unique.push(w);
      if (unique.length >= FAMILY_CAP) break;
    }
    if (unique.length) out.push({ relation, words: unique });
  }
  return out;
}

export function mergeWordFamilyGroups(...lists: Array<WordFamilyGroup[] | undefined>): WordFamilyGroup[] {
  const buckets = new Map<WordFamilyRelation, string[]>();
  for (const list of lists) {
    for (const g of list || []) {
      const acc = buckets.get(g.relation) || [];
      acc.push(...g.words);
      buckets.set(g.relation, acc);
    }
  }
  return groupsFromBuckets(buckets);
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
  const buckets = new Map<WordFamilyRelation, string[]>();

  addUnique(buckets, 'forms', latinLemmaForms(surface), surfaceKey);
  addUnique(buckets, 'forms', derivationalStems(surface), surfaceKey);
  addUnique(buckets, 'lemma', lemmasFromDefinitions(opts.definitions, surface), surfaceKey);

  if (opts.wikitext) {
    const scope = extractLanguageSection(opts.wikitext, langSectionName(opts.language));
    const fromHeadings = parseHeadingGroups(scope, surfaceKey);
    for (const [rel, words] of fromHeadings) {
      addUnique(buckets, rel, words, surfaceKey);
    }
    // Inflection / form-of templates anywhere in the language section
    const infl: string[] = [];
    const lemmaBits: string[] = [];
    for (const t of scanTemplates(scope)) {
      if (INFL_TEMPLATES.has(t.name)) {
        infl.push(...termsFromTemplate(t.name, t.positional, t.named, surfaceKey));
      }
      if (FORM_OF_TEMPLATES.has(t.name)) {
        lemmaBits.push(...termsFromTemplate(t.name, t.positional, t.named, surfaceKey));
      }
    }
    addUnique(buckets, 'forms', infl, surfaceKey);
    addUnique(buckets, 'lemma', lemmaBits, surfaceKey);

    const etyBits = familyFromEtymologyChain(
      (opts.etymologyChain && opts.etymologyChain.length)
        ? opts.etymologyChain
        : scanTemplates(scope).map(templateToLink).filter((x): x is EtymologyLink => !!x),
      surface,
    );
    for (const g of etyBits) addUnique(buckets, g.relation, g.words, surfaceKey, g.relation === 'affixes' || g.relation === 'roots');
  } else if (opts.etymologyChain) {
    for (const g of familyFromEtymologyChain(opts.etymologyChain, surface)) {
      addUnique(buckets, g.relation, g.words, surfaceKey, g.relation === 'affixes' || g.relation === 'roots');
    }
  }

  return groupsFromBuckets(buckets);
}
