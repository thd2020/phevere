/**
 * Whether a word is only a form of another word: an inflection ("gleaned" is the simple past of
 * glean, "paparazzi" the plural of paparazzo) or another spelling ("idiosyncracy" is an
 * alternative spelling of idiosyncrasy). Such a word opens and is saved as the other word, the
 * way Merriam-Webster and Oxford Learner's open "gleaned" on the entry for glean. A form with a
 * meaning of its own ("glasses" are spectacles, "data" is information, "news") stays itself.
 *
 * The decision reads Wiktextract's (kaikki.org) parse of the word's Wiktionary page, where every
 * sense is tagged: `form_of`/`alt_of` name the lemma, and tags such as obsolete or dialectal mark
 * senses a learner dictionary leaves out. Wiktionary's REST definitions drop those tags, so the
 * plain text of the senses is only a fallback. When a word is a form of two lemmas ("children" is
 * also the plural of the dialectal "childer"), the lemma that is far more common wins, judged by
 * Datamuse's word frequencies; two common lemmas ("axes": axe and axis) leave the word as it is.
 */

import type { HttpClient } from './http';
import { fetchKaikkiPage, kaikkiDirectory } from './multilingual-sources';
import { stripGlossText } from './lookup-policy';

/* -------------------------------------------------------------- citations */

const CITATION_HTML = /\bmw-cite-backlink\b|\bmw-reference-text\b|\breference-text\b|\bcitation-whole\b|\bcited-source\b/;
const CITATION_TEXT = [
  // The backlink arrow Wiktionary puts before each reference.
  /^\s*[↑^]\s/,
  /→\s*(?:ISBN|OCLC|DOI|ISSN)\b/,
  /\bISBN(?:-1[03])?[\s:]*[\dX-]{9,}/i,
  /\beditors?\s*\(\s*1\d{3}\s*[–-]/,
  /,\s*in\s+(?:the\s+)?[^,]{0,80}\b(?:Dictionary|Unabridged|Lexicon|Encyclop(?:a)?edia|Thesaurus)\b[^.]*\b(?:1[5-9]\d\d|20\d\d)\b/,
];

/**
 * A reference from the page's References section ("“idiosyncracy”, in Dictionary.com Unabridged,
 * Dictionary.com, LLC, 1995–present."), which Wiktionary's REST definitions list among the senses.
 */
export function isCitationGloss(meaning: string): boolean {
  const raw = String(meaning || '');
  if (CITATION_HTML.test(raw)) return true;
  const text = stripGlossText(raw);
  return CITATION_TEXT.some((re) => re.test(text));
}

/** A saved definition without the reference lines; '' when nothing else was there. */
export function stripCitationLines(definition: string): string {
  const text = String(definition || '');
  const lines = text.split('\n');
  const kept = lines.filter((line) => !isCitationGloss(line));
  if (kept.length === lines.length) return text;
  return kept.join('\n').trim();
}

/* ------------------------------------------------------------ text senses */

/** Words a form-of label is made of: "simple past and past participle", "alternative spelling". */
const LABEL_WORDS = new Set([
  'simple', 'past', 'tense', 'participle', 'present', 'and', 'or', 'plural', 'third-person', 'singular', 'indicative',
  'form', 'gerund', 'comparative', 'superlative', 'degree', 'alternative', 'obsolete', 'archaic', 'dated', 'spelling',
  'misspelling', 'common', 'letter-case', 'inflection', 'the', 'a', 'an', 'subjunctive', 'imperative', 'first-person', 'remote',
  'second-person', 'first/third-person', 'first/second/third-person',
]);
const LABEL_CORE = /\b(?:past|participle|plural|singular|gerund|comparative|superlative|spelling|form|inflection|subjunctive|imperative)\b/;
const FORM_OF_TEXT =
  /^(.{1,90}?)\s+of\s+["“]?([\p{L}][\p{L}'’-]*(?:\s[\p{L}][\p{L}'’-]*){0,2}?)["”]?\s*(?:\(\s*[“"][^)]*\))?\s*[.;]?$/u;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Paparazzi taken as a group.": a sense that only restates the word. */
function isRestatement(gloss: string, words: string[]): boolean {
  const names = words.filter(Boolean).map((w) => `${escapeRe(w)}s?`).join('|');
  if (!names) return false;
  return new RegExp(
    `^(?:the\\s+)?(?:${names})\\s+(?:taken\\s+)?(?:as\\s+a\\s+(?:group|whole|body|class|collective)|collectively)\\.?$`,
    'iu',
  ).test(gloss.trim());
}

/** The lemma a gloss such as "simple past and past participle of glean" names, or null. */
export function formOfGlossLemma(meaning: string): string | null {
  const text = stripGlossText(meaning).replace(/\s+([,.;])/g, '$1');
  const m = FORM_OF_TEXT.exec(text);
  if (!m) return null;
  const label = m[1].toLowerCase().replace(/,/g, ' ');
  const words = label.split(/\s+/).filter(Boolean);
  if (!words.length || !words.every((w) => LABEL_WORDS.has(w)) || !LABEL_CORE.test(label)) return null;
  return m[2].trim();
}

/**
 * The lemma when every one of `senses` (Wiktionary's, as text or HTML) is a form of it, leaving out
 * references and senses that only restate the word; null when any sense has a meaning of its own or
 * the senses name more than one lemma.
 */
export function formOfLemmaFromGlosses(senses: string[], word = ''): string | null {
  if (PLURALS_WITH_OWN_ENTRY.has(word.trim().toLowerCase())) return null;
  const list = senses.filter((s) => s && !isCitationGloss(s)).map(stripGlossText).filter(Boolean);
  let lemma = '';
  const rest: string[] = [];
  for (const s of list) {
    const l = formOfGlossLemma(s);
    if (!l) {
      rest.push(s);
      continue;
    }
    if (lemma && l.toLowerCase() !== lemma.toLowerCase()) return null;
    lemma = l;
  }
  if (!lemma || lemma.toLowerCase() === word.trim().toLowerCase()) return null;
  return rest.every((s) => isRestatement(s, [word, lemma])) ? lemma : null;
}

/* ---------------------------------------------------------- kaikki senses */

/** Senses a learner dictionary leaves out; they neither block nor make a redirect. */
const MINOR = new Set([
  'obsolete', 'archaic', 'dialectal', 'rare', 'nonstandard', 'nonce-word', 'proscribed', 'humorous', 'poetic',
  'eye-dialect', 'pronunciation-spelling', 'hypercorrect', 'misconstruction', 'error-unrecognized-form', 'dated', 'slang', 'vulgar', 'colloquial',
]);
/** Kinds of "X of Y" that are separate words: "abbreviation of", "diminutive of". */
const SEPARATE_WORD = new Set([
  'abbreviation', 'initialism', 'acronym', 'clipping', 'ellipsis', 'contraction', 'diminutive', 'augmentative',
  'feminine', 'masculine', 'pejorative', 'endearing', 'honorific', 'synonym', 'short-form', 'agent', 'nominalization',
]);
/** Parts of speech that do not count for a lower-case word (ISO codes, surnames). */
const SKIPPED_POS = new Set(['name', 'symbol', 'character', 'prefix', 'suffix', 'infix', 'interfix', 'affix', 'combining_form']);

interface KaikkiSense {
  tags?: string[];
  glosses?: string[];
  form_of?: Array<{ word?: string }>;
  alt_of?: Array<{ word?: string }>;
}

/** Tags Wiktextract sometimes puts on the sense's links only; both count. */
function tagsOf(s: KaikkiSense): string[] {
  return Array.isArray(s.tags) ? s.tags : [];
}

/**
 * Plurals learner dictionaries give an entry of their own, though Wiktionary may call them only
 * "plural of": savings is money put by, not several acts of saving.
 */
export const PLURALS_WITH_OWN_ENTRY = new Set([
  'savings', 'belongings', 'earnings', 'surroundings', 'lodgings', 'proceeds', 'customs', 'manners', 'goods',
  'outskirts', 'premises', 'quarters', 'remains', 'riches', 'valuables', 'winnings', 'takings', 'holdings',
  'findings', 'glasses', 'spectacles', 'clothes', 'contents', 'damages', 'arms', 'odds', 'means', 'grounds',
  'looks', 'pains', 'regards', 'spirits', 'stairs', 'terms', 'troops', 'wages', 'works', 'greens', 'headquarters',
  'authorities', 'data', 'media', 'news', 'scissors', 'trousers', 'pants', 'goggles', 'thanks', 'congratulations',
]);

/** "ax and axe", "ax or axe": Wiktextract names two spellings of one lemma in one link. */
function splitLemma(lemma: string): string[] {
  return lemma
    .split(/\s+(?:and|or)\s+|\s*,\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** One kaikki.org page read for whether the word is a form, and of what. */
export interface FormOfReading {
  /** Lemmas the word is a form of, most-cited first; [] when it is a word in its own right. */
  lemmas: string[];
  /** Spellings that name one lemma ("ax", "axe"), so they count as one when choosing. */
  groups: string[][];
  /** Whether the word is a plural noun form, for which other dictionaries get a say. */
  plural: boolean;
  /** What the word is of each lemma, by lower-case lemma: "past tense", "plural", "comparative". */
  labels?: Map<string, Set<string>>;
  /** The word's own pronunciation, as Wiktionary gives it. */
  ipa?: string;
}

/**
 * A learner dictionary's name for a form: from Wiktionary's wording when it says it plainly
 * ("simple past and past participle of teach" is both), else from Wiktextract's tags; '' for a
 * spelling.
 */
function formLabels(tags: string[], gloss: string): string[] {
  const g = gloss.toLowerCase();
  const said: string[] = [];
  if (/\bsimple past\b|\bpast tense\b|\bpreterite\b/.test(g)) said.push('past tense');
  if (/\bpast participle\b/.test(g)) said.push('past participle');
  if (/\bpresent participle\b/.test(g)) said.push('present participle');
  if (said.length) return said;
  const one = formLabel(tags);
  return one ? [one] : [];
}

function formLabel(tags: string[]): string {
  const t = new Set(tags);
  if (t.has('comparative')) return 'comparative';
  if (t.has('superlative')) return 'superlative';
  if (t.has('participle')) return t.has('past') ? 'past participle' : 'present participle';
  if (t.has('past')) return 'past tense';
  if (t.has('present')) return t.has('third-person') && t.has('singular') ? 'third person singular' : 'present tense';
  if (t.has('plural')) return 'plural';
  return '';
}

/**
 * Reads one kaikki.org page. Senses tagged obsolete, archaic, dialectal, rare, nonstandard or
 * misspelling, and regional spellings of another word ("is" as Geordie for us), are left out unless
 * nothing else is left. A single sense of its own beside the form-of senses does not stop the word
 * being a form: "mice" is also a rare Bermudan verb, "oxen" an adjective "oxlike", "rested" an
 * adjective "recovered", "was" the colloquial "there was" with a plural subject. Two senses of its
 * own do ("glasses", "pants", "ironed").
 */
export function readFormOf(jsonl: string, word: string, lang = 'en'): FormOfReading {
  const none: FormOfReading = { lemmas: [], groups: [], plural: false };
  const w = String(word || '').trim();
  const lower = w === w.toLowerCase();
  const senses: Array<{ s: KaikkiSense; minor: boolean; pos: string }> = [];
  let ipa = '';
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
    if (lower && typeof entry?.word === 'string' && entry.word !== w) continue;
    if (lower && SKIPPED_POS.has(String(entry?.pos || ''))) continue;
    if (!ipa && Array.isArray(entry?.sounds)) {
      ipa = String(entry.sounds.find((x: { ipa?: string }) => typeof x?.ipa === 'string')?.ipa || '');
    }
    for (const s of Array.isArray(entry?.senses) ? (entry.senses as KaikkiSense[]) : []) {
      const tags = tagsOf(s);
      if (tags.includes('no-gloss') || (!s.glosses?.length && !s.form_of?.length && !s.alt_of?.length)) continue;
      const regionalSpelling = !!s.alt_of?.length && tags.some((x) => /^[A-Z]/.test(x));
      senses.push({ s, minor: tags.some((x) => MINOR.has(x)) || regionalSpelling, pos: String(entry?.pos || '') });
    }
  }
  const lemmaOf = (s: KaikkiSense): string => {
    const tags = tagsOf(s);
    const formOf = String(s.form_of?.[0]?.word || '').trim();
    const altOf = String(s.alt_of?.[0]?.word || '').trim();
    if (tags.some((x) => SEPARATE_WORD.has(x))) return '';
    if (formOf && tags.includes('form-of')) return formOf;
    // A regional spelling ("estrus", American for oestrus) is the standard where it is used, so it stays.
    if (altOf && (tags.includes('alternative') || tags.includes('misspelling')) && !tags.some((x) => /^[A-Z]/.test(x))) return altOf;
    // Wiktextract sometimes leaves the tags off a form-of sense ("simple subjunctive of be").
    return s.form_of?.length || s.alt_of?.length ? '' : formOfGlossLemma(String(s.glosses?.[0] || '')) || '';
  };
  const isMisspelling = (s: KaikkiSense) => tagsOf(s).includes('misspelling');
  const major = senses.filter((x) => !x.minor);
  let use = major.length ? major : senses;
  // "taught" is the past of teach; that it is also a common misspelling of taut does not count. A
  // word that is only a misspelling ("accomodate") is decided by its misspelling senses.
  const proper = use.filter((x) => !isMisspelling(x.s) && lemmaOf(x.s));
  if (proper.length) use = use.filter((x) => !isMisspelling(x.s));
  else if (!use.some((x) => lemmaOf(x.s))) use = [...use, ...senses.filter((x) => isMisspelling(x.s))];
  if (!use.length) return none;
  const lemmas: string[] = [];
  const groups: string[][] = [];
  const others: Array<{ s: KaikkiSense; pos: string }> = [];
  const formPos = new Set<string>();
  const labels = new Map<string, Set<string>>();
  let plural = false;
  for (const { s, pos } of use) {
    const names = splitLemma(lemmaOf(s)).filter((l) => l.toLowerCase() !== w.toLowerCase());
    if (names.length) {
      if (pos === 'noun' && tagsOf(s).includes('plural') && s.form_of?.length) plural = true;
      formPos.add(pos);
      for (const label of formLabels(tagsOf(s), String(s.glosses?.[0] || ''))) {
        for (const l of names) {
          const set = labels.get(l.toLowerCase()) || new Set<string>();
          set.add(label);
          labels.set(l.toLowerCase(), set);
        }
      }
      const fresh = names.filter((l) => !lemmas.some((x) => x.toLowerCase() === l.toLowerCase()));
      lemmas.push(...fresh);
      if (fresh.length) groups.push(fresh);
      continue;
    }
    others.push({ s, pos });
  }
  if (!lemmas.length) return none;
  // Plural-only senses of a plural ("teeth": power to enforce; "men": enlisted personnel) are uses
  // the singular's entry covers; a plural that is a word of its own is caught by pluralHasOwnSense.
  const own = others.filter(
    ({ s }) =>
      !isRestatement(String(s.glosses?.[0] || ''), [w, ...lemmas]) &&
      !(plural && tagsOf(s).includes('plural-only')) &&
      // "had" forming the past perfect is a use of have its own entry describes.
      !tagsOf(s).includes('auxiliary'),
  );
  // One sense of its own in another part of speech is allowed (the verb "mice", the adjective
  // "oxen"); one in the same part of speech is a meaning the form adds ("bacteria" as a strain).
  if (!own.length || (own.length === 1 && !formPos.has(own[0].pos))) return { lemmas, groups, plural, labels, ipa };
  return none;
}

/** Lemmas only, for callers that do not choose between them. */
export function formOfLemmasFromKaikki(jsonl: string, word: string, lang = 'en'): string[] {
  return readFormOf(jsonl, word, lang).lemmas;
}

/* ------------------------------------------------------------ frequencies */

const freqMemo = new Map<string, Promise<number>>();

/**
 * Occurrences per million words (Google Books Ngrams, through Datamuse) for each word; 0 for a word
 * Datamuse does not know. A word whose request fails is left out of the map.
 */
export async function wordFrequencies(http: HttpClient, words: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(
    [...new Set(words.map((w) => String(w || '').trim()).filter(Boolean))].map(async (w) => {
      const key = w.toLowerCase();
      let p = freqMemo.get(key);
      if (!p) {
        p = http
          .requestJson<Array<{ word?: string; tags?: string[] }>>(
            `https://api.datamuse.com/words?sp=${encodeURIComponent(w)}&md=f&max=1`,
            { timeoutMs: 4000 },
          )
          .then((rows) => {
            const hit = (rows || []).find((r) => String(r.word || '').toLowerCase() === key);
            const tag = (hit?.tags || []).find((t) => t.startsWith('f:'));
            return tag ? Number(tag.slice(2)) || 0 : 0;
          });
        freqMemo.set(key, p);
        p.catch(() => freqMemo.delete(key));
      }
      try {
        out.set(w, await p);
      } catch {
        /* unknown, not zero */
      }
    }),
  );
  return out;
}

/**
 * The lemma far more common than the others (twenty times), or null when none is. `groups` puts
 * spellings of one lemma together ("ax" and "axe"), which count as one at their commonest spelling.
 */
export function dominantLemma(lemmas: string[], freq: Map<string, number>, groups: string[][] = lemmas.map((l) => [l])): string | null {
  if (groups.length === 1) return [...groups[0]].sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0))[0] || null;
  if (!lemmas.every((l) => freq.has(l))) return null;
  const ranked = groups
    .map((g) => {
      const best = [...g].sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0))[0];
      return { best, f: freq.get(best) || 0 };
    })
    .sort((a, b) => b.f - a.f);
  return ranked[0].f > 0 && ranked[0].f >= (ranked[1]?.f || 0) * 20 ? ranked[0].best : null;
}

const ownSenseMemo = new Map<string, Promise<boolean>>();

/**
 * Whether other dictionaries define a plural as a word of its own: WordNet, through Datamuse,
 * has "savings" as "a fund of money put by", while "geese" and "paparazzi" have nothing of their
 * own there, or only senses marked nonstandard ("(nonstandard) A paparazzo.").
 */
export function pluralHasOwnSense(http: HttpClient, word: string): Promise<boolean> {
  const key = word.toLowerCase();
  if (PLURALS_WITH_OWN_ENTRY.has(key)) return Promise.resolve(true);
  let p = ownSenseMemo.get(key);
  if (!p) {
    p = http
      .requestJson<Array<{ word?: string; defHeadword?: string; defs?: string[] }>>(
        `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=d&max=1`,
        { timeoutMs: 4000 },
      )
      .then((rows) => {
        const hit = (rows || []).find((r) => String(r.word || '').toLowerCase() === key);
        if (!hit || hit.defHeadword) return false;
        return (hit.defs || []).some((d) => {
          const [pos, gloss = ''] = String(d).split('\t');
          if (pos !== 'n') return false;
          const text = gloss.trim();
          const label = /^\(([^)]*)\)/.exec(text)?.[1] || '';
          if (/nonstandard|proscribed|rare|obsolete|archaic|dialect|uncountable/i.test(label)) return false;
          if (/^(?:a|an|the)?\s*(?:individual\s+|single\s+)?[\p{L}-]+\.?$/iu.test(text.replace(/^\([^)]*\)\s*/, ''))) return false;
          return !formOfGlossLemma(text);
        });
      });
    ownSenseMemo.set(key, p);
    p.catch(() => ownSenseMemo.delete(key));
  }
  return p;
}

/* --------------------------------------------------------------- resolving */

const resolved = new Map<string, Promise<string | null>>();
/** What a resolved form is, for the line above its lemma's entry: "ran /ræn/ · past tense of run". */
const lines = new Map<string, FormLine>();

export interface FormLine {
  form: string;
  ipa: string;
  /** "past tense of run" */
  label: string;
}

/**
 * The line a lookup of `word` shows above the entry it opens, or null when the form opens its
 * lemma plainly. Set once resolveFormOf has answered for the word.
 */
export function formLine(word: string, lang = 'en'): FormLine | null {
  return lines.get(`${lang}:${String(word || '').trim()}`) || null;
}

/**
 * Whether a learner dictionary gives `form` a short entry of its own ("ran: past tense of run")
 * rather than opening `lemma` directly. This follows the Oxford Advanced Learner's Dictionary,
 * which does it for irregular forms spelled unlike their headword: verbs (ran, swam, bought, was,
 * went, been) and plurals that change a vowel or an f (feet, mice, men, knives, wolves). Regular
 * forms (gleaned, cities, stopped), plurals from Latin and Greek (criteria, crises, phenomena) and
 * irregular plurals that begin like their singular (children, paparazzi, oxen) open the headword.
 * The 48 forms in scripts/test-word-forms.js were searched in OALD on 2026-11-04 and the rule
 * agrees on 46 ("does" and "women" are the exceptions). Longman and Cambridge also give
 * "children" a short entry; docs/WORD_FORMS.md has the comparison.
 */
export function hasOwnFormEntry(form: string, lemma: string): boolean {
  const f = String(form || '').toLowerCase();
  const l = String(lemma || '').toLowerCase();
  if (!f || !l || f === l) return false;
  // lie → lying, die → dying, tie → tying
  if (/ie$/.test(l) && f === `${l.slice(0, -2)}ying`) return true;
  if (isRegularInflection(f, l)) return false;
  // leaf → leaves, knife → knives, wolf → wolves
  if (/(?:f|fe)$/.test(l) && /ves$/.test(f)) return true;
  if (FOREIGN_PLURALS.some(([a, b]) => l.endsWith(a) && f === l.slice(0, l.length - a.length) + b)) return false;
  if (l === 'ox' && f === 'oxen') return false;
  return !(l.length >= 3 && f.startsWith(l.slice(0, -1)));
}

/** Singular and plural endings of Latin, Greek and French plurals. */
const FOREIGN_PLURALS: Array<[string, string]> = [
  ['um', 'a'], ['on', 'a'], ['us', 'i'], ['is', 'es'], ['a', 'ae'], ['ex', 'ices'], ['ix', 'ices'], ['o', 'i'], ['eau', 'eaux'],
];

/**
 * The word to open and save instead of `word`, or null when `word` is a word in its own right.
 * Rejects when the page could not be fetched, or when the word frequencies that choose between
 * two lemmas could not, so a caller can fall back or try again later.
 */
export function resolveFormOf(http: HttpClient, word: string, lang = 'en', timeoutMs = 4000): Promise<string | null> {
  const w = String(word || '').trim();
  const dir = kaikkiDirectory(lang);
  if (!w || !dir || /\s{2,}/.test(w) || w.length > 48) return Promise.resolve(null);
  const key = `${lang}:${w}`;
  let p = resolved.get(key);
  if (!p) {
    p = fetchKaikkiPage(http, w, dir, timeoutMs).then(async (page) => {
      // No page is no answer: the caller falls back to the senses it has.
      if (!page.trim()) throw Object.assign(new Error(`no kaikki page for ${w}`), { code: 'NO_PAGE' });
      const reading = readFormOf(page, w, lang);
      if (!reading.lemmas.length || PLURALS_WITH_OWN_ENTRY.has(w.toLowerCase())) return null;
      const note = (lemma: string | null): string | null => {
        const kinds = lemma ? reading.labels?.get(lemma.toLowerCase()) : undefined;
        if (lemma && kinds?.size && hasOwnFormEntry(w, lemma)) {
          lines.set(key, { form: w, ipa: reading.ipa || '', label: `${[...kinds].join(', ')} of ${lemma}` });
        }
        return lemma;
      };
      // Only a regular plural (savings, belongings) can be a word of its own here; men and teeth are not.
      const regular = reading.lemmas.some((l) => isRegularInflection(w, l));
      if (reading.plural && regular && (await pluralHasOwnSense(http, w).catch(() => PLURALS_WITH_OWN_ENTRY.has(w.toLowerCase())))) return null;
      if (reading.lemmas.length === 1) return note(reading.lemmas[0]);
      if (reading.groups.length < 2) return note(dominantLemma(reading.lemmas, await wordFrequencies(http, reading.lemmas.slice(0, 4)).catch(() => new Map<string, number>()), reading.groups));
      const lemmas = reading.lemmas.slice(0, 4);
      const freq = await wordFrequencies(http, lemmas);
      // Without every lemma's frequency ("teeth": tooth or teethe) there is no answer yet, not an
      // answer that the word is its own: the caller tries again later instead of noting it checked.
      if (!lemmas.every((l) => freq.has(l))) {
        throw Object.assign(new Error(`no word frequencies for ${lemmas.join(', ')}`), { code: 'NO_FREQUENCY' });
      }
      return note(dominantLemma(lemmas, freq, reading.groups.map((g) => g.filter((l) => lemmas.includes(l))).filter((g) => g.length)));
    });
    resolved.set(key, p);
    p.catch(() => resolved.delete(key));
    if (resolved.size > 200) resolved.delete(resolved.keys().next().value as string);
  }
  return p;
}

/* --------------------------------------------------------- regular endings */

/**
 * Whether `surface` is `lemma` with a regular English ending: -s, -es, -ies, -ed, -d, -ied, -ing
 * (with the final e dropped, the consonant doubled, or ie to y), -er and -est.
 */
export function isRegularInflection(surface: string, lemma: string): boolean {
  const s = String(surface || '').toLowerCase();
  const l = String(lemma || '').toLowerCase();
  if (!s || !l || s === l || !s.startsWith(l.slice(0, Math.max(1, l.length - 2)))) return false;
  const stems = new Set<string>([l]);
  if (/e$/.test(l)) stems.add(l.slice(0, -1));
  if (/[^aeiou]y$/.test(l)) stems.add(`${l.slice(0, -1)}i`);
  if (/ie$/.test(l)) stems.add(`${l.slice(0, -2)}y`);
  if (/[^aeiou][aeiou][bdgklmnprtvz]$/.test(l)) stems.add(l + l.slice(-1));
  for (const stem of stems) {
    for (const end of ['s', 'es', 'ed', 'd', 'ing', 'er', 'est', 'r', 'st']) {
      if (s === stem + end) {
        // "-d", "-r", "-st" only after an e: "bifurcated", "nicer", "nicest".
        if (/^(?:d|r|st)$/.test(end) && !/e$/.test(stem)) continue;
        if (end === 'ing' && stem === l.slice(0, -1) && !/e$/.test(l)) continue;
        return true;
      }
    }
  }
  return false;
}
