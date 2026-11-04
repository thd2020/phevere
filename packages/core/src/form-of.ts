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
  'misspelling', 'common', 'letter-case', 'inflection', 'the', 'a', 'an',
]);
const LABEL_CORE = /\b(?:past|participle|plural|singular|gerund|comparative|superlative|spelling|form|inflection)\b/;
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
  'eye-dialect', 'pronunciation-spelling', 'hypercorrect', 'misconstruction', 'error-unrecognized-form',
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
 * Lemmas the word is a form of according to one kaikki.org page, most-cited first; [] when the word
 * has a meaning of its own (or the page has no senses). Senses tagged obsolete, archaic, dialectal,
 * rare or nonstandard are left out unless nothing else is left.
 */
export function formOfLemmasFromKaikki(jsonl: string, word: string, lang = 'en'): string[] {
  const w = String(word || '').trim();
  const lower = w === w.toLowerCase();
  const senses: Array<{ s: KaikkiSense; minor: boolean }> = [];
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
    for (const s of Array.isArray(entry?.senses) ? (entry.senses as KaikkiSense[]) : []) {
      const tags = tagsOf(s);
      if (tags.includes('no-gloss') || (!s.glosses?.length && !s.form_of?.length && !s.alt_of?.length)) continue;
      senses.push({ s, minor: tags.some((x) => MINOR.has(x)) });
    }
  }
  const major = senses.filter((x) => !x.minor);
  const use = major.length ? major : senses;
  if (!use.length) return [];
  const lemmas: string[] = [];
  const others: string[] = [];
  for (const { s } of use) {
    const tags = tagsOf(s);
    const formOf = String(s.form_of?.[0]?.word || '').trim();
    const altOf = String(s.alt_of?.[0]?.word || '').trim();
    const separate = tags.some((x) => SEPARATE_WORD.has(x));
    let lemma = '';
    if (formOf && tags.includes('form-of') && !separate) lemma = formOf;
    // A regional spelling ("estrus", American for oestrus) is the standard where it is used, so it stays.
    else if (altOf && (tags.includes('alternative') || tags.includes('misspelling')) && !separate && !tags.some((x) => /^[A-Z]/.test(x))) lemma = altOf;
    if (lemma && lemma.toLowerCase() !== w.toLowerCase()) {
      if (!lemmas.some((l) => l.toLowerCase() === lemma.toLowerCase())) lemmas.push(lemma);
      continue;
    }
    others.push(String(s.glosses?.[0] || ''));
  }
  if (!lemmas.length) return [];
  return others.every((g) => isRestatement(g, [w, ...lemmas])) ? lemmas : [];
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

/** The lemma far more common than the others (fifty times), or null when none is. */
export function dominantLemma(lemmas: string[], freq: Map<string, number>): string | null {
  if (lemmas.length === 1) return lemmas[0];
  if (!lemmas.every((l) => freq.has(l))) return null;
  const ranked = [...lemmas].sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0));
  const top = freq.get(ranked[0]) || 0;
  const next = freq.get(ranked[1]) || 0;
  return top > 0 && top >= next * 50 ? ranked[0] : null;
}

/* --------------------------------------------------------------- resolving */

const resolved = new Map<string, Promise<string | null>>();

/**
 * The word to open and save instead of `word`, or null when `word` is a word in its own right.
 * Rejects when the page could not be fetched, so a caller can fall back or try again later.
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
      const lemmas = formOfLemmasFromKaikki(page, w, lang);
      if (lemmas.length < 2) return lemmas[0] || null;
      const freq = await wordFrequencies(http, lemmas.slice(0, 3));
      return dominantLemma(lemmas.slice(0, 3), freq);
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
