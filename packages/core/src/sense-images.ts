/**
 * Pictures for dictionary senses. A wrong picture is worse than none, so every picture comes from
 * a link a lexicographer or an encyclopedia made between a meaning and a file, and a sense with
 * no such link shows none.
 *
 * Sources, all keyless and all files on Wikimedia Commons (free licences or public domain; each
 * picture carries its author, licence and file page for the credit line), in the order of how
 * often each kind of link is right:
 *
 * 1. Wikidata lexemes. A lexeme sense links to the item it means ("item for this sense", P5137),
 *    whose image (P18) shows that meaning: "crane" the bird and "crane" the machine each have
 *    their own. One SPARQL query (Wikidata Query Service) returns every sense with its gloss, item
 *    label, item description and image; it is matched to our senses by part of speech and shared
 *    words, the head word of the lexeme's gloss among them (`lexemeFit`).
 * 2. Wiktionary definition lines tied to a Wikidata item (`{{senseid|en|Q…}}`), whose image shows
 *    that line's sense ("spring" the water source, Q124714).
 * 3. Wiktionary's own pictures. Editors tie a caption to a sense with `{{senseno}}` or a number
 *    ("A mechanical crane (3)"); a caption-only picture counts when it shares two words with a
 *    gloss, or names the word and the thing the gloss is about ("A palm tree"). Book covers and
 *    title pages from quotations are skipped.
 * 4. The Wikipedia article titled with the word, for a noun sense whose gloss fits the article's
 *    description or first sentences: the article's Wikidata image first, its lead image second;
 *    without either, a picture used in it that names the word ("Lac Operon.svg" on "Operon"). A
 *    foreign word also tries the article titled with its short English gloss ("猫" gives "Cat").
 *
 * Captions and articles rest on shared words rather than a curated link, so they only go to a
 * picturable sense: a noun whose gloss is not about an act, state, quality or idea
 * (`picturableSense`). Abstract words such as serendipity or vicissitude show no picture.
 *
 * All three are gathered once per word into a pool (`PicturePool`), apart from the sense list,
 * and matched to senses locally (`assignPictures`), so a lookup whose senses arrive in steps and
 * the card for the same word share one pool. Which senses get a picture: the major ones first,
 * meaning each entry's first sense and each part of speech's first sense, ordered by how often
 * the sense is used (SemCor) when known; minor senses only once every major sense you can see has
 * one; three pictures at most per entry. The rules sit in `SENSE_PICTURE_RULES`.
 *
 * Checks: a portrait of a named person never shows; works, places,
 * companies and disambiguation pages are never the article for a sense; a reader can hide a
 * picture (`hideSenseImage`), and it never shows again on that sense; Undo brings it back
 * (`unhideSenseImage`).
 *
 * Speed: the pool's three sources start together (a lookup can start them when the word is
 * submitted, `prefetchSenseImages`) and the Wiktionary page is the one the dictionary already
 * fetched; each source's files get their Commons details as soon as it answers, and `onUpdate`
 * hands the lookup its first pictures then. Requests asked within a few milliseconds of each
 * other (a screen of cards) share one request per kind, at most three go to one host at a time
 * with an identifying User-Agent, and a failure is logged once per host. Pools are kept in memory
 * and in the platform's lookup cache: two weeks with pictures, a day when a request failed, six
 * hours when empty.
 */
import { getHttp, getLookupCache, isCoreConfigured } from './runtime';
import type { HttpClient, HttpRequestInit, HttpTextResponse, HttpBytesResponse } from './http';

export interface SenseImage {
  /** A larger rendering (at most 960 px wide) for a zoomed view. */
  url: string;
  /** A 330 px rendering for the inline figure (a standard Wikimedia thumbnail step). */
  thumb: string;
  /** Intrinsic size of `thumb`, for a fixed aspect box before the bytes arrive. */
  width?: number;
  height?: number;
  /** What the picture shows: the Wiktionary caption or the Wikipedia article title. */
  title: string;
  /** The file's description page on Wikimedia Commons (author and licence live there). */
  pageUrl: string;
  /** "Author · Licence · Wikimedia Commons", or just "Wikimedia Commons". */
  credit: string;
}

export interface SenseInput {
  meaning: string;
  partOfSpeech?: string;
  /** How often the sense is used (SemCor tag count, see sense-frequency.ts), when known. */
  frequency?: number;
}

const THUMB_WIDTH = 330;
const LARGE_WIDTH = 960;
const TIMEOUT_MS = 8000;
/**
 * The Wiktionary page carries the curated pictures and the etymologies that tell "bank" of money
 * from "bank" of a river, and under load it takes four seconds or more, so it keeps the full
 * timeout; a timed-out page is asked again on the next call because the result is not cached.
 */
const WIKTIONARY_TIMEOUT_MS = TIMEOUT_MS;
/** A query asked again on its own after its batch failed gets longer. */
const RETRY_TIMEOUT_MS = 15000;
// v6: pools also hold Wiktionary sense lines' Wikidata items and the article's Wikidata image.
// v7: pools also hold the articles listed on the word's disambiguation page.
const CACHE_VERSION = 'v7';
const PERSIST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** A result with no picture at all is kept this long, so a word saved earlier is tried again. */
const EMPTY_TTL_MS = 6 * 60 * 60 * 1000;
/** A result found while a request failed is never saved, and kept in memory only this long. */
const FAILED_MEMORY_MS = 3 * 60 * 1000;
const API_UA = 'Phevere/2 (https://github.com/thd2020/phevere)';

const STOP = new Set(
  (
    'the and for with from that this which who whom whose what when where why how are was were been being ' +
    'has have had having its their there them they then than into onto upon over under about above ' +
    'below between through during before after such some any each every other another more most less least ' +
    'very also only just not but can could may might must shall should will would one ones two three used use ' +
    'using usually especially often sometimes typically generally something someone somebody thing things ' +
    'kind sort type form forms like similar various any all both either neither out off own same see also ' +
    'etc his her him she you your our ours mine yours ' +
    'countable uncountable transitive intransitive plural singular chiefly mostly informal formal ' +
    'british american dated rare figuratively figurative literally thereof therein whereby lieu'
  ).split(/\s+/),
);

/** Glosses that name an act, state, quality or category rarely have a faithful picture. */
const ABSTRACT_HEADS = new Set(
  (
    'act action instance state quality condition process fact faculty ability capacity feeling emotion ' +
    'sensation practice art science study way manner method occurrence event period degree amount number ' +
    'idea concept notion belief principle theory situation circumstance habit tendency result outcome ' +
    'combination discovery experience relationship relation attitude behaviour behavior activity measure ' +
    'unit name surname abbreviation initialism acronym symbol letter word phrase expression term status ' +
    'rank role duty right trait nature aspect affection happiness sadness fear anger desire luck chance ' +
    'fortune opportunity success failure movement motion lack absence presence existence knowledge skill ' +
    'phenomenon view understanding perception change statement saying peculiarity characteristic meaning ' +
    'reaction discovery difference sight thought mind algebraic operation ratio proportion size'
  )
    .split(/\s+/)
    .map((w) => stem(w)),
);

/** Labels in a gloss that make a sense a poor target for a photo. */
const BAD_LABELS =
  /\b(slang|figurative(?:ly)?|derogatory|ethnic slur|offensive|vulgar|obsolete|archaic|idiomatic|euphemistic|metaphor(?:ical)?|humorous|jocular|nonce)\b/i;

/** Article descriptions that mean "not the thing itself": works, people, places, companies. */
const BAD_DESCRIPTION =
  /\b(film|movie|album|song|band|novel|book|magazine|newspaper|company|corporation|brand|manufacturer|rapper|singer|musician|actor|actress|politician|footballer|television|tv series|episode|video game|software|programming language|surname|given name|disambiguation|village|town|city|municipality|commune|county|district|province|state of|river in|mountain in|record label|organi[sz]ation|sports team|musical group|folk group|vocal group|duo|trio|quartet|football club|ethnic group|born|died|fictional|website|operating system|census|neighbourhood|neighborhood)\b/i;

const POS_HEADINGS: Record<string, string> = {
  noun: 'noun',
  'proper noun': 'proper noun',
  verb: 'verb',
  adjective: 'adjective',
  adverb: 'adverb',
  pronoun: 'pronoun',
  preposition: 'preposition',
  conjunction: 'conjunction',
  interjection: 'interjection',
  numeral: 'numeral',
  determiner: 'determiner',
  article: 'article',
  particle: 'particle',
  classifier: 'classifier',
  phrase: 'phrase',
  'prepositional phrase': 'phrase',
  idiom: 'phrase',
  proverb: 'phrase',
};

/** Pictures of a book that a quotation comes from: its cover, title page or frontispiece. */
const BOOK_PICTURE = /\b(cover|title ?page|frontispiece)\b/i;

const NON_IMAGE_EXT = /\.(ogg|oga|ogv|opus|webm|mp3|mp4|wav|flac|mid|midi|pdf|djvu|stl)$/i;

// ---------------------------------------------------------------- text helpers

function stripHtml(s: string): string {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(w: string): string {
  let s = w;
  if (s.length > 5 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 5 && /(ches|shes|sses|xes|zes)$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us') && !s.endsWith('is')) s = s.slice(0, -1);
  if (s.length > 6 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 5 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 5 && s.endsWith('ly')) s = s.slice(0, -2);
  // "balance" and "balanced", "change" and "changing" share a stem.
  if (s.length > 5 && s.endsWith('e') && !s.endsWith('ee')) s = s.slice(0, -1);
  return s;
}

/** Content-word stems of a gloss, caption or description, without the lemma itself. */
export function contentTokens(text: string, lemma = ''): string[] {
  const plain = stripHtml(text).toLowerCase();
  const lemmaStems = new Set(
    String(lemma || '')
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter(Boolean)
      .map(stem),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of plain.match(/\p{L}[\p{L}'\u2019-]*/gu) || []) {
    const w = raw.replace(/['\u2019]s$/, '').replace(/['\u2019-]+$/g, '');
    if (w.length < 3 || STOP.has(w)) continue;
    const s = stem(w);
    if (lemmaStems.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  let n = 0;
  for (const t of a) if (set.has(t)) n += 1;
  return n;
}

export function canonicalSensePos(pos: string | undefined): string {
  const p = String(pos || '').trim().toLowerCase();
  if (!p || p === 'unknown') return '';
  if (p === 'n' || p === 'n.' || p.startsWith('noun')) return 'noun';
  if (p.startsWith('proper')) return 'proper noun';
  if (p === 'v' || p === 'v.' || p.startsWith('verb')) return 'verb';
  if (p.startsWith('adj')) return 'adjective';
  if (p.startsWith('adv')) return 'adverb';
  return POS_HEADINGS[p] || p;
}

/** Leading "(countable, chiefly in combination)" style labels of a gloss. */
function glossLabels(meaning: string): string {
  const m = stripHtml(meaning).match(/^((?:\([^)]*\)\s*)+)/);
  return m ? m[1] : '';
}

function glossBody(meaning: string): string {
  return stripHtml(meaning).replace(/^((?:\([^)]*\)\s*)+)/, '').trim();
}

/**
 * Whether a sense names a thing you could photograph. Nouns only, no slang or figurative
 * labels, and none of the first few content words may be an abstract head ("act", "state",
 * "quality", "combination" and so on).
 */
export function isConcreteNounSense(sense: SenseInput, lemma: string): boolean {
  if (canonicalSensePos(sense.partOfSpeech) !== 'noun') return false;
  const plain = stripHtml(sense.meaning);
  if (!plain || plain.length < 3) return false;
  if (BAD_LABELS.test(glossLabels(sense.meaning))) return false;
  const body = glossBody(sense.meaning);
  if (/\b(of being|plural of|form of|spelling of|abbreviation of|initialism of|clipping of|short for|ellipsis of|synonym of)\b/i.test(body)) {
    return false;
  }
  if (/(ness|ism)$/i.test(lemma)) return false;
  const head = contentTokens(body, lemma).slice(0, 5);
  if (!head.length) return false;
  return !head.some((t) => ABSTRACT_HEADS.has(t));
}

// ---------------------------------------------------------------- Wiktionary

export interface WiktionaryImage {
  file: string;
  caption: string;
  /** Text of the definition line a `{{senseno}}` or a "(3)" in the caption points to. */
  senseText: string;
  pos: string;
  etymology: number;
}

/** A definition line Wiktionary ties to a Wikidata item with `{{senseid|en|Q…}}`. */
export interface WiktionarySenseItem {
  item: string;
  senseText: string;
  pos: string;
}

/**
 * Definition lines tied to a Wikidata item ("# {{senseid|en|Q102836}} An elastic mechanical
 * part…"): the item's image shows that sense, the way a lexeme's "item for this sense" does.
 */
export function extractSenseItems(wikitext: string, lang: string): WiktionarySenseItem[] {
  const section = wiktionaryLanguageSection(wikitext, lang);
  if (!section) return [];
  const out: WiktionarySenseItem[] = [];
  let pos = '';
  for (const line of section.split('\n')) {
    const heading = line.match(/^(={3,})\s*([^=]+?)\s*\1\s*$/);
    if (heading) {
      const h = heading[2].toLowerCase();
      if (/^etymology(\s+\d+)?$/.test(h)) pos = '';
      else if (POS_HEADINGS[h]) pos = POS_HEADINGS[h];
      continue;
    }
    if (!/^#+[^:*]/.test(line)) continue;
    const id = line.match(/\{\{\s*(?:senseid|sid)\s*\|[^|}]*\|\s*(Q\d+)\s*\}\}/i);
    if (id && !out.some((x) => x.item === id[1])) out.push({ item: id[1], senseText: wikiToText(line.replace(/^#+\s*/, '')), pos });
  }
  return out;
}

function languageName(lang: string): string {
  const code = String(lang || 'en').toLowerCase().split(/[-_]/)[0];
  const fixed: Record<string, string> = {
    en: 'English',
    zh: 'Chinese',
    ja: 'Japanese',
    ko: 'Korean',
    de: 'German',
    fr: 'French',
    es: 'Spanish',
    it: 'Italian',
    pt: 'Portuguese',
    ru: 'Russian',
    nl: 'Dutch',
    sv: 'Swedish',
    la: 'Latin',
    el: 'Greek',
    ar: 'Arabic',
  };
  if (fixed[code]) return fixed[code];
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
    if (name && name.toLowerCase() !== code) return name;
  } catch {
    /* no Intl.DisplayNames */
  }
  return 'English';
}

/** Plain text of a wikitext fragment: links to their labels, most templates dropped. */
export function wikiToText(src: string): string {
  let s = String(src || '');
  s = s.replace(/<ref[\s\S]*?(<\/ref>|\/>)/gi, '');
  s = s.replace(/'''?/g, '');
  for (let i = 0; i < 4 && /\{\{/.test(s); i += 1) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_m, body: string) => {
      const parts = body.split('|').map((p) => p.trim());
      const name = (parts[0] || '').toLowerCase();
      if (name === 'w' || name === 'wp' || name === 'taxlink' || name === 'vern') return parts[1] || '';
      if (name === 'l' || name === 'm' || name === 'll' || name === 'lang') return parts[2] || parts[1] || '';
      if (name === 'ellipsis of' || name === 'clipping of' || name === 'abbreviation of') {
        const t = parts.find((p) => p.startsWith('t='));
        return t ? t.slice(2) : parts[2] || '';
      }
      if (name === ',') return ',';
      return '';
    });
  }
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
  s = s.replace(/\(\s*\)/g, '').replace(/\s+([,.;:])/g, '$1');
  return stripHtml(s);
}

/** Split a `[[File:...]]` body on top-level pipes (captions contain links and templates). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depthSq = 0;
  let depthCurly = 0;
  let cur = '';
  for (let i = 0; i < body.length; i += 1) {
    const two = body.slice(i, i + 2);
    if (two === '[[') { depthSq += 1; cur += two; i += 1; continue; }
    if (two === ']]') { depthSq -= 1; cur += two; i += 1; continue; }
    if (two === '{{') { depthCurly += 1; cur += two; i += 1; continue; }
    if (two === '}}') { depthCurly -= 1; cur += two; i += 1; continue; }
    if (body[i] === '|' && depthSq === 0 && depthCurly === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  parts.push(cur);
  return parts;
}

const IMAGE_OPTION = /^(thumb|thumbnail|frame|frameless|framed|border|right|left|center|centre|none|upright(=.*)?|\d+(x\d+)?px|x\d+px|link=.*|alt=.*|class=.*|lang=.*|page=.*|baseline|middle|sub|super|top|text-top|bottom|text-bottom)$/i;

/** Section of a Wiktionary page for one language (`==German==` up to the next level-2 heading). */
export function wiktionaryLanguageSection(wikitext: string, lang: string): string {
  const name = languageName(lang);
  const lines = String(wikitext || '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const h2 = lines[i].match(/^==\s*([^=].*?)\s*==\s*$/);
    if (!h2) continue;
    if (start >= 0) return lines.slice(start, i).join('\n');
    if (h2[1].toLowerCase() === name.toLowerCase()) start = i;
  }
  return start >= 0 ? lines.slice(start).join('\n') : '';
}

/** Every picture in one language section, with its caption, linked sense text and heading. */
export function extractWiktionaryImages(wikitext: string, lang: string): WiktionaryImage[] {
  const section = wiktionaryLanguageSection(wikitext, lang);
  if (!section) return [];
  // Definition lines that carry a sense id, with the part of speech they sit under.
  const senseLines = new Map<string, { text: string; pos: string }>();
  // Top-level definitions per etymology and part of speech, in order, for a caption's "(3)".
  const defs = new Map<string, Array<{ text: string; pos: string }>>();
  const images: Array<WiktionaryImage & { senseId: string; number: number }> = [];
  let pos = '';
  let etymology = 0;
  const lines = section.split('\n');
  for (const line of lines) {
    const heading = line.match(/^(={3,})\s*([^=]+?)\s*\1\s*$/);
    if (heading) {
      const h = heading[2].toLowerCase();
      if (/^etymology(\s+\d+)?$/.test(h)) {
        etymology += 1;
        pos = '';
      } else if (POS_HEADINGS[h]) {
        pos = POS_HEADINGS[h];
      }
      continue;
    }
    if (/^#+[^:*]/.test(line)) {
      const id = line.match(/\{\{\s*(?:senseid|sid)\s*\|[^|}]*\|\s*([^}|]+?)\s*\}\}/i);
      if (id) senseLines.set(id[1].toLowerCase(), { text: wikiToText(line.replace(/^#+\s*/, '')), pos });
      if (/^#[^#:*]/.test(line) && pos) {
        const key = `${etymology}|${pos}`;
        if (!defs.has(key)) defs.set(key, []);
        (defs.get(key) as Array<{ text: string; pos: string }>).push({ text: wikiToText(line.replace(/^#+\s*/, '')), pos });
      }
    }
    let from = 0;
    for (;;) {
      const at = line.slice(from).search(/\[\[\s*(?:File|Image)\s*:/i);
      if (at < 0) break;
      const open = from + at;
      let depth = 0;
      let end = -1;
      for (let i = open; i < line.length - 1; i += 1) {
        const two = line.slice(i, i + 2);
        if (two === '[[') { depth += 1; i += 1; continue; }
        if (two === ']]') {
          depth -= 1;
          if (depth === 0) { end = i; break; }
          i += 1;
        }
      }
      if (end < 0) break;
      const body = line.slice(open + 2, end);
      from = end + 2;
      const parts = splitTopLevel(body);
      const file = parts[0].replace(/^\s*(?:File|Image)\s*:\s*/i, '').trim().replace(/_/g, ' ');
      if (!file || NON_IMAGE_EXT.test(file)) continue;
      const opts = parts.slice(1).map((p) => p.trim());
      const captionRaw = [...opts].reverse().find((p) => p && !IMAGE_OPTION.test(p)) || '';
      const altRaw = (opts.find((p) => /^alt=/i.test(p)) || '').replace(/^alt=/i, '');
      const senseNo = captionRaw.match(/\{\{\s*senseno\s*\|[^|}]*\|\s*([^}|]+?)\s*\}\}/i);
      const caption = wikiToText(captionRaw) || wikiToText(altRaw);
      // A quotation's book cover or title page ("Afloat and Ashore, cover") shows a book, not the word.
      if (BOOK_PICTURE.test(caption) || BOOK_PICTURE.test(file)) continue;
      // "A mechanical crane (3)": the number of the sense the picture shows.
      const numbered = caption.match(/\((\d{1,2})\)\s*$/);
      images.push({ file, caption, senseText: '', pos, etymology, senseId: senseNo ? senseNo[1].toLowerCase() : '', number: numbered ? Number(numbered[1]) : 0 });
    }
  }
  // Sense ids may be defined below the picture, so resolve them after the pass. A linked
  // definition line also says which part of speech the picture belongs to.
  return images.map(({ senseId, number, ...img }) => {
    const linked = senseId ? senseLines.get(senseId) : undefined;
    if (linked) return { ...img, senseText: linked.text, pos: linked.pos || img.pos };
    if (number) {
      // The numbered list is the picture's part of speech, or the first one of its etymology.
      const key = img.pos ? `${img.etymology}|${img.pos}` : Array.from(defs.keys()).find((k) => k.startsWith(`${img.etymology}|`));
      const line = key ? defs.get(key)?.[number - 1] : undefined;
      if (line) return { ...img, senseText: line.text, pos: line.pos, caption: img.caption.replace(/\s*\(\d{1,2}\)\s*$/, '') };
    }
    return img;
  });
}

export interface SenseMatch {
  senseIndex: number;
  imageIndex: number;
  score: number;
}

/**
 * Pair Wiktionary pictures with our senses. A picture tied to a definition line by
 * `{{senseno}}` needs two shared content words with the gloss (or every word, for a gloss of
 * one or two words); a caption-only picture needs two shared words. Parts of speech must agree
 * when both are known. Each picture and each sense is used once, best score first.
 */
export function matchWiktionaryImages(images: WiktionaryImage[], senses: SenseInput[], lemma: string): SenseMatch[] {
  const senseTokens = senses.map((s) => contentTokens(glossBody(s.meaning), lemma));
  const cands: SenseMatch[] = [];
  images.forEach((img, imageIndex) => {
    const linked = img.senseText ? contentTokens(img.senseText, lemma) : [];
    const cap = contentTokens(img.caption, lemma);
    senses.forEach((sense, senseIndex) => {
      const st = senseTokens[senseIndex];
      if (!st.length) return;
      const sp = canonicalSensePos(sense.partOfSpeech);
      if (img.pos && sp && img.pos !== sp) return;
      let score = 0;
      if (linked.length) {
        const n = overlap(linked, st);
        const ratio = n / Math.min(linked.length, st.length);
        if ((n >= 2 && ratio >= 0.5) || (n >= 1 && n === Math.min(linked.length, st.length) && Math.min(linked.length, st.length) <= 2)) {
          score = 10 + n + ratio;
        }
      }
      if (!score && cap.length) {
        const n = overlap(cap, st);
        if (n >= 2) score = n + n / Math.min(cap.length, st.length);
        // "A palm tree" for "any of various evergreen trees from the family Palmae": the caption
        // names the word and the thing the gloss is about.
        else if (mentionsWord(img.caption, lemma)) {
          const head = glossHead(glossBody(sense.meaning), lemma);
          if (head && cap.some((c) => nearWord(c, head))) score = 1.5;
        }
      }
      if (score > 0) cands.push({ senseIndex, imageIndex, score });
    });
  });
  cands.sort((a, b) => b.score - a.score || a.senseIndex - b.senseIndex);
  const usedSense = new Set<number>();
  const usedImage = new Set<number>();
  const out: SenseMatch[] = [];
  for (const c of cands) {
    if (usedSense.has(c.senseIndex) || usedImage.has(c.imageIndex)) continue;
    usedSense.add(c.senseIndex);
    usedImage.add(c.imageIndex);
    out.push(c);
  }
  return out.sort((a, b) => a.senseIndex - b.senseIndex);
}

export function buildWiktionaryUrl(lemma: string): string {
  return (
    'https://en.wiktionary.org/w/api.php?action=query&format=json&formatversion=2&prop=revisions' +
    `&rvprop=content&rvslots=main&redirects=1&titles=${encodeURIComponent(lemma)}&origin=*`
  );
}

// ---------------------------------------------------------------- Wikipedia

export interface WikipediaPage {
  title: string;
  index?: number;
  missing?: boolean;
  description?: string;
  extract?: string;
  pageimage?: string;
  thumbnail?: { source: string; width: number; height: number };
  pageprops?: { disambiguation?: string; wikibase_item?: string };
}

const WIKI_PAGE_PROPS =
  `prop=pageimages|pageprops|description|extracts&piprop=name|thumbnail&pithumbsize=${THUMB_WIDTH}` +
  '&pilicense=free&ppprop=disambiguation|wikibase_item&exintro=1&explaintext=1&exsentences=2&exlimit=max';

/** Articles with these titles (twenty at most, the limit for first sentences), redirects followed. */
export function buildWikipediaTitlesUrl(titles: string[], lang = 'en'): string {
  return (
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&${WIKI_PAGE_PROPS}&pilimit=50&titles=${encodeURIComponent(titles.slice(0, 20).join('|'))}&origin=*`
  );
}

/** Article whose title is exactly `title` (redirects followed). */
export function buildWikipediaTitleUrl(title: string, lang = 'en'): string {
  return (
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&${WIKI_PAGE_PROPS}&titles=${encodeURIComponent(title)}&origin=*`
  );
}

function titleParts(title: string): { base: string; qualifier: string } {
  const m = String(title || '').match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m ? { base: m[1].trim(), qualifier: m[2].trim() } : { base: String(title || '').trim(), qualifier: '' };
}

function sameWord(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || stem(x) === stem(y);
}

/**
 * Whether a Wikipedia article fairly illustrates a sense. The title must be the word itself
 * (a qualifier in brackets is allowed), the page must have a free lead image and must not be
 * a disambiguation page or a person, work, place or company, and its description and qualifier
 * must share a content word with the gloss, or its first sentences two. `strict` (used for a
 * sense that is not the word's first noun sense) asks for two and three. `exactGloss` covers a
 * foreign word whose whole gloss is the title ("猫" gives "cat", which gives "Cat").
 */
export function acceptWikipediaPage(
  page: WikipediaPage,
  word: string,
  gloss: string,
  lemma: string,
  opts: { exactGloss?: boolean; strict?: boolean } = {},
): boolean {
  if (!page || page.missing || !page.pageimage || !page.thumbnail?.source) return false;
  return pageFitsGloss(page, word, gloss, lemma, opts);
}

/** `acceptWikipediaPage` without the lead-image requirement: the article is about this sense. */
export function pageFitsGloss(
  page: WikipediaPage,
  word: string,
  gloss: string,
  lemma: string,
  opts: { exactGloss?: boolean; strict?: boolean } = {},
): boolean {
  if (!page || page.missing) return false;
  if (page.pageprops && page.pageprops.disambiguation !== undefined) return false;
  const { base, qualifier } = titleParts(page.title);
  if (!sameWord(base, word)) return false;
  const description = String(page.description || '');
  if (BAD_DESCRIPTION.test(description) || BAD_DESCRIPTION.test(qualifier)) return false;
  if (/disambiguation/i.test(page.title)) return false;
  if (opts.exactGloss && !qualifier) return true;
  const g = contentTokens(glossBody(gloss), lemma);
  const d = contentTokens(`${description} ${qualifier}`, word);
  const e = contentTokens(String(page.extract || ''), word);
  const minD = opts.strict ? 2 : 1;
  const minE = opts.strict ? 3 : 2;
  if (overlap(g, d) >= minD || overlap(g, e) >= minE) return true;
  // The same head in other words for the first noun sense: "headdress" and "headwear",
  // "percussive instrument" and "percussion instrument".
  return !opts.strict && headsMeet(glossHeads(glossBody(gloss), lemma), glossHeads(description));
}

/** "cat" from "cat; (dialect) ...": a foreign word's gloss when it is one or two plain words. */
export function shortGlossTitle(gloss: string): string {
  const clause = glossBody(gloss).split(/[;/]/)[0].replace(/\([^)]*\)/g, '').trim();
  // "house, home" is a list of synonyms; "A common, round fruit …" is a sentence.
  const items = clause.split(',').map((s) => s.trim()).filter(Boolean);
  if (items.some((s) => s.split(/\s+/).length > 3)) return '';
  const first = items[0] || '';
  const words = first.replace(/^(a|an|the|to)\s+/i, '').replace(/[.!?]+$/, '').trim();
  if (!words || words.split(/\s+/).length > 2 || !/^[\p{L} -]+$/u.test(words)) return '';
  return words;
}

// ---------------------------------------------------------------- whole-word fallback

/** File names that are rarely a picture of the thing: maps, flags, logos, seals, signatures. */
const BAD_FILE = /\b(map|maps|locator|location map|flag|flags|coat of arms|logo|logos|wordmark|seal|signature|emblem|icon|blank)\b/i;

/**
 * Commons categories that mark a map, flag, logo, cover or screenshot rather than a picture of a
 * thing. An article's picture in one of them is not used ("Ocean bank" is illustrated with a map
 * of the Gulf of Maine).
 */
const BAD_CATEGORY = /\b(maps?|flags?|logos?|coats? of arms|screenshots?|signatures?|album covers?|book covers?)\b/i;

/** "Sean Combs in 2023" or "Portraits of …": a picture of a named person. */
const PERSON_CATEGORY = /(^|\|)[^|]*\bportraits?\b|(^|\|)\p{Lu}[\p{L}.'-]+(?: \p{Lu}[\p{L}.'-]+)+ in \d{4}(?=\||$)/u;

/** Whether `re` matches `text` on a word other than the lemma itself (a "map" may show a map). */
function badMatch(re: RegExp, text: string, lemma: string): boolean {
  const w = String(lemma || '').trim().toLowerCase();
  const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(all)) {
    const hit = m[0].replace(/^\|/, '').trim().toLowerCase();
    if (hit !== w && stem(hit) !== stem(w)) return true;
  }
  return false;
}

export interface TitleQuery {
  pages?: WikipediaPage[];
  normalized?: Array<{ from: string; to: string }>;
  redirects?: Array<{ from: string; to: string }>;
}

/** The page a requested title ends up on, after case normalisation and redirects. */
function resolveTitle(q: TitleQuery, title: string): WikipediaPage | undefined {
  let t = title;
  for (const n of q.normalized || []) if (n.from === t) t = n.to;
  for (const r of q.redirects || []) if (r.from === t) t = r.to;
  return (q.pages || []).find((p) => p.title === t);
}

/** A concept article's lead image is usable when it is free and the page is not a person, work or place. */
export function acceptConceptPage(page: WikipediaPage | undefined): boolean {
  if (!page || page.missing || !page.pageimage || !page.thumbnail?.source) return false;
  if (page.pageprops && page.pageprops.disambiguation !== undefined) return false;
  if (/disambiguation/i.test(page.title)) return false;
  const { qualifier } = titleParts(page.title);
  if (BAD_DESCRIPTION.test(String(page.description || '')) || BAD_DESCRIPTION.test(qualifier)) return false;
  return !badMatch(BAD_FILE, page.pageimage.replace(/_/g, ' ').replace(/\.[a-z0-9]+$/i, ''), titleParts(page.title).base);
}

/** Interface pictures that sit on many articles: edit pencils, sister-project marks, maintenance boxes. */
const CHROME_FILE = /^(OOjs UI|Question book|Symbol .* class|Edit-clear|Ambox|Wiki letter|Disambig|Portal-puzzle|Padlock|Lock-|Nuvola|Crystal Clear|Gnome-|Emblem-|Sound-|Speaker)/i;

/** An article's own pictures (one `prop=images` request), for an article without a free lead image. */
export function buildArticleImagesUrl(title: string, lang = 'en'): string {
  return (
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=images&imlimit=50&titles=${encodeURIComponent(title)}&origin=*`
  );
}

/** Pictures used in several articles at once. */
export function buildArticleImagesManyUrl(titles: string[], lang = 'en'): string {
  return (
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=images&imlimit=max&titles=${encodeURIComponent(titles.join('|'))}&origin=*`
  );
}

/**
 * Pictures used in an article, best first, for a word whose article has no lead image: a
 * diagram such as "Lac Operon.svg" on "Operon". A file counts only when its name contains the
 * word or a gloss word, so navigation-box pictures and interface icons drop out. SVG is fine:
 * Commons serves it as a PNG thumbnail.
 */
export function rankArticleImages(files: string[], lemma: string, gloss: string[]): string[] {
  return files
    .map((raw, i) => {
      const file = String(raw || '').replace(/^(File|Image):/i, '').replace(/_/g, ' ').trim();
      if (!file || NON_IMAGE_EXT.test(file) || !/\.(jpe?g|png|gif|svg|webp|tiff?)$/i.test(file)) return null;
      const name = commonsFileTitle(file);
      if (CHROME_FILE.test(name) || badMatch(BAD_FILE, name, lemma)) return null;
      const named = sharesWord(name, lemma);
      const shared = overlap(contentTokens(name, lemma), gloss);
      if (!named && !shared) return null;
      return { file, score: (named ? 2 : 0) + shared - i / 1000 };
    })
    .filter((x): x is { file: string; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.file);
}

function mentionsWord(text: string, lemma: string): boolean {
  const t = stripHtml(text).toLowerCase();
  const w = String(lemma || '').trim().toLowerCase();
  if (!t || !w) return false;
  if (!/^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}'-]+$/u.test(w)) return t.includes(w);
  return new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(t);
}

/** Whether `text` contains `word` or a form of it ("inspects" for "inspect"). */
function sharesWord(text: string, word: string): boolean {
  const w = String(word || '').toLowerCase();
  if (!w) return false;
  if (!/^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}'-]+$/u.test(w)) return stripHtml(text).toLowerCase().includes(w);
  const target = stem(w);
  return (stripHtml(text).toLowerCase().match(/\p{L}+/gu) || []).some((t) => t === w || stem(t) === target);
}

/** "Love padlocks on the Butchers' Bridge (Ljubljana)" from its file name. */
export function commonsFileTitle(file: string): string {
  return String(file || '')
    .replace(/^File:/i, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\s+-\s+geograph\.org\.uk\s+-\s+\d+$/i, '')
    .replace(/\s*\(\d{6,}\)$/, '')
    .replace(/_/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- major senses

/**
 * The senses that deserve a picture of their own, best first, at most `max`. A dictionary lists
 * a word's entries one after another (Wiktionary gives noun and verb for one etymology, then
 * noun and verb for the next), so a part of speech that comes back after another one starts a
 * new entry: "bank" the institution, then "bank" the edge of a river. Each entry's first sense
 * comes first, then the first sense of each further part of speech in an entry, then a sense
 * among the first six of a run that shares no content word with the senses before it in that
 * run ("equilibrium" of a reaction after "equilibrium" of competing influences).
 */
/** Glosses that are codes or pointers, not meanings: "ISO 639-3 language code for Cowlitz". */
const CODE_GLOSS = /\b(ISO \d|language code|abbreviation of|initialism of|acronym of|symbol for|alternative (?:form|spelling) of|plural of|misspelling of|listed in the|Oxford English Dictionary)\b/i;

export interface MajorSenses {
  /** Senses that get a picture of their own, best first. */
  order: number[];
  /** Entry and part-of-speech heads, which may also borrow a picture of a word their gloss names. */
  heads: Set<number>;
}

export function majorSenses(senses: SenseInput[], lemma: string, max = 4, etymology?: number[]): MajorSenses {
  const entryHeads: number[] = [];
  const posHeads: number[] = [];
  // Distinct senses per run of one part of speech, taken in turns so the verbs' second meaning
  // is not crowded out by a long list of nouns.
  const distinctRuns: number[][] = [];
  const seenEtymology = new Set<number>();
  let entryPos = new Set<string>();
  let prevPos: string | null = null;
  let run: string[][] = [];
  let runDistinct: number[] = [];
  senses.forEach((s, i) => {
    if (!stripHtml(s.meaning)) return;
    const pos = canonicalSensePos(s.partOfSpeech);
    if (pos === 'symbol' || CODE_GLOSS.test(stripHtml(s.meaning))) return;
    const tokens = contentTokens(glossBody(s.meaning), lemma).filter((t) => !ABSTRACT_HEADS.has(t));
    // A sense from an etymology not seen before is a different word spelled the same.
    const ety = etymology?.[i] || 0;
    const newEtymology = ety > 0 && !seenEtymology.has(ety) && seenEtymology.size > 0;
    if (ety > 0) seenEtymology.add(ety);
    if (prevPos === null || (pos !== prevPos && entryPos.has(pos)) || newEtymology) {
      entryHeads.push(i);
      entryPos = new Set([pos]);
      run = [tokens];
      runDistinct = [];
      distinctRuns.push(runDistinct);
    } else if (pos !== prevPos) {
      posHeads.push(i);
      entryPos.add(pos);
      run = [tokens];
      runDistinct = [];
      distinctRuns.push(runDistinct);
    } else {
      const fresh = tokens.length >= 2 && run.length < 6 && run.every((r) => !r.some((t) => tokens.includes(t)));
      if (fresh) runDistinct.push(i);
      run.push(tokens);
    }
    prevPos = pos;
  });
  const distinct: number[] = [];
  for (let k = 0; distinctRuns.some((r) => r.length > k); k += 1) {
    for (const r of distinctRuns) if (r[k] !== undefined) distinct.push(r[k]);
  }
  const order = [...entryHeads, ...posHeads, ...distinct].slice(0, Math.max(1, max));
  return { order, heads: new Set([...entryHeads, ...posHeads].filter((i) => order.includes(i))) };
}

/**
 * Which Wiktionary etymology each sense belongs to (1, 2 and so on; 0 when no definition line
 * fits). A lookup merges its sources and lists senses by part of speech, which hides that "wind"
 * the moving air and "wind" a coil are two words; the Wiktionary page, fetched for its pictures
 * anyway, still has them under Etymology 1 and Etymology 2. A sense belongs to the etymology of
 * the definition line that shares the most content words with it, two at least (or all of a
 * gloss of one or two words).
 */
export function sensesEtymology(wikitext: string, lang: string, senses: SenseInput[], lemma: string): number[] {
  return etymologyOfSenses(etymologyLines(wikitext, lang, lemma), senses, lemma);
}

/** `majorSenses(...).order`. */
export function majorSenseIndexes(senses: SenseInput[], lemma: string, max = 4): number[] {
  return majorSenses(senses, lemma, max).order;
}

// ---------------------------------------------------------------- word matching

/** Two stems are the same word when one starts the other ("balanc" and "balance"). */
function nearWord(a: string, b: string): boolean {
  if (a === b) return true;
  // "moving" and "movement" share a root once their endings go.
  const root = (w: string) => w.replace(/(ments?|ings?|ed|es)$/, '').replace(/e$/, '');
  if (root(a).length >= 3 && root(a) === root(b)) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  // Five letters at least: "part" must not match "particle".
  return s.length >= 5 && l.startsWith(s) && l.length - s.length <= 3;
}

function nearOverlap(a: string[], b: string[]): number {
  return a.filter((x) => b.some((y) => nearWord(x, y))).length;
}

/** Wikipedia articles for many titles at once, without extracts (TextExtracts serves 20 at most). */
export function buildWikipediaBriefTitlesUrl(titles: string[], lang = 'en'): string {
  return (
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=pageimages|pageprops|description&piprop=name|thumbnail&pithumbsize=${THUMB_WIDTH}&pilicense=free&pilimit=50` +
    `&ppprop=disambiguation&titles=${encodeURIComponent(titles.join('|'))}&origin=*`
  );
}

// ---------------------------------------------------------------- Commons file info

interface ImageInfo {
  url?: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  width?: number;
  mime?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, { value?: string }>;
}

export function buildImageInfoUrl(files: string[]): string {
  const titles = files.map((f) => `File:${f.replace(/_/g, ' ')}`).join('|');
  return (
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo' +
    `&iiprop=url|size|mime|extmetadata&iiurlwidth=${THUMB_WIDTH}` +
    '&iiextmetadatafilter=Artist|LicenseShortName|ImageDescription|Categories&iiextmetadatalanguage=en' +
    `&titles=${encodeURIComponent(titles)}&origin=*`
  );
}

/**
 * A short author name from Commons' free-form Artist field: "User:" prefixes, "(talk)" links,
 * e-mail addresses and anything after the first comma or bracket go.
 */
export function shortArtist(raw: string): string {
  let a = stripHtml(raw)
    .replace(/\bUser:/gi, '')
    .split(/\s*(?:[,;(\[]|\s-\s|\bfrom\b)\s*/)[0]
    .replace(/\S+@\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(unknown|anonymous)\b/i.test(a)) a = '';
  return a.length > 40 ? a.slice(0, 39).trim() + '\u2026' : a;
}

export function creditFromInfo(info: ImageInfo | undefined): string {
  const meta = info?.extmetadata || {};
  const artist = shortArtist(meta.Artist?.value || '');
  const licence = stripHtml(meta.LicenseShortName?.value || '');
  return [artist, licence, 'Wikimedia Commons'].filter(Boolean).join(' \u00b7 ');
}

/** Wikimedia appends utm_* tracking parameters to API image URLs; the bare URL is the same file. */
function bareUrl(url: string): string {
  return String(url || '').replace(/\?utm_[^#]*$/, '');
}

export function imageFromInfo(file: string, title: string, info: ImageInfo | undefined): SenseImage | null {
  if (!info || !info.thumburl || !info.url) return null;
  if (info.mime && !/^image\//.test(info.mime)) return null;
  // The large view of an SVG or a TIFF uses Commons' PNG rendering: browsers do not display
  // TIFF at all. A TIFF thumbnail is named "…/lossless-page1-330px-x.tif.png".
  const rendered = /svg|tiff/.test(info.mime || '') || /\.(svg|tiff?)$/i.test(file);
  const thumb = bareUrl(info.thumburl);
  let url = bareUrl(info.url);
  const step = new RegExp(`/((?:lossless-)?(?:page\\d+-)?)${THUMB_WIDTH}px-`);
  if (((info.width || 0) > LARGE_WIDTH || rendered) && step.test(thumb)) {
    url = thumb.replace(step, `/$1${LARGE_WIDTH}px-`);
  }
  return {
    url,
    thumb,
    width: info.thumbwidth,
    height: info.thumbheight,
    title: title || file.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '),
    pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`,
    credit: creditFromInfo(info),
  };
}

// ---------------------------------------------------------------- HTTP and caches

const fetchClient: HttpClient = {
  async requestJson<T>(url: string, options?: HttpRequestInit): Promise<T> {
    const res = await this.requestText(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(res.text) as T;
  },
  async requestText(url: string, options?: HttpRequestInit): Promise<HttpTextResponse> {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), options?.timeoutMs ?? TIMEOUT_MS) : null;
    try {
      const res = await fetch(url, { signal: ctl?.signal });
      return { ok: res.ok, status: res.status, text: await res.text() };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
  async requestBytes(url: string): Promise<HttpBytesResponse> {
    const res = await fetch(url);
    return {
      ok: res.ok,
      status: res.status,
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || '',
    };
  },
};

/**
 * Wikimedia's 2026 rate limits allow 10 requests a minute to a client identified only by IP and
 * 200 to one whose User-Agent names the tool and a contact URL. The desktop HTTP client sends a
 * generic browser User-Agent by default, which Wikimedia answers with 429 after a few requests,
 * so the configured client sends ours. A browser (no configured client) cannot set User-Agent.
 * https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
 */
function client(): { http: HttpClient; headers?: Record<string, string> } {
  if (isCoreConfigured()) return { http: getHttp(), headers: { 'User-Agent': API_UA, 'Api-User-Agent': API_UA } };
  return { http: fetchClient };
}

/**
 * Wikimedia asks for "at most 3 concurrent requests". Each host keeps its own three slots
 * (Wiktionary, Wikipedia, Commons and the Wikidata Query Service are separate services), so a
 * slow Wiktionary page does not hold up the file details another word is waiting for.
 */
const MAX_IN_FLIGHT = 3;
const RETRY_MS = 1500;
const lanes = new Map<string, { inFlight: number; waiting: Array<() => void> }>();

function hostOf(url: string): string {
  const m = String(url || '').match(/^https?:\/\/([^/]+)/);
  return m ? m[1] : '';
}

async function throttled<T>(url: string, run: () => Promise<T>): Promise<T> {
  const host = hostOf(url);
  let lane = lanes.get(host);
  if (!lane) {
    lane = { inFlight: 0, waiting: [] };
    lanes.set(host, lane);
  }
  const l = lane;
  if (l.inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => l.waiting.push(resolve));
  l.inFlight += 1;
  try {
    return await run();
  } finally {
    l.inFlight -= 1;
    l.waiting.shift()?.();
  }
}

/** One console line per host and kind of failure, not one per request. */
const logged = new Set<string>();

function logFailure(url: string, err: unknown): void {
  const msg = String((err as Error)?.message || err || 'failed');
  const kind = (msg.match(/\b(\d{3})\b/) || [])[1] || (/abort|time/i.test(msg) ? 'timeout' : 'network');
  const key = `${hostOf(url)} ${kind}`;
  if (logged.has(key)) return;
  logged.add(key);
  try {
    console.warn(`[sense-images] ${hostOf(url)}: ${msg.slice(0, 120)}`);
  } catch {
    /* no console */
  }
}

const jsonCache = new Map<string, Promise<unknown>>();

/** A JSON answer, or null when the request failed (the failure is logged once per host). */
function getJson<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T | null> {
  const hit = jsonCache.get(url);
  if (hit) return hit as Promise<T | null>;
  const { http, headers } = client();
  const once = () => throttled(url, () => http.requestJson<T>(url, { headers, timeoutMs }));
  const p = once()
    .catch(async (err: unknown) => {
      // Rate limited or overloaded: one more try after a pause.
      if (!/\b(429|503)\b/.test(String((err as Error)?.message || err))) throw err;
      await new Promise((r) => setTimeout(r, RETRY_MS));
      return once();
    })
    .catch((err: unknown): null => {
      logFailure(url, err);
      jsonCache.delete(url);
      return null;
    });
  if (jsonCache.size > 300) jsonCache.clear();
  jsonCache.set(url, p);
  return p;
}

async function titleQuery(url: string): Promise<TitleQuery | null> {
  const res = await getJson<{ query?: TitleQuery }>(url);
  return res?.query || null;
}

/** Pictures used in several articles, one request, by article title (redirects followed). */
async function articleImageFilesMany(titles: string[], lang: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!titles.length) return out;
  const res = await getJson<{ query?: TitleQuery & { pages?: Array<WikipediaPage & { images?: Array<{ title: string }> }> } }>(
    buildArticleImagesManyUrl(titles, lang),
  );
  const q = res?.query;
  if (!q) return out;
  for (const t of titles) {
    const page = resolveTitle(q, t) as (WikipediaPage & { images?: Array<{ title: string }> }) | undefined;
    if (page?.images) out.set(t, page.images.map((i) => i.title));
  }
  return out;
}

/**
 * Requests asked within a few milliseconds of each other (the cards on screen, the steps of one
 * lookup) go out as one request for all their keys: up to 50 titles, or a dozen lemmas for the
 * lexeme query. Each caller gets the whole answer and reads its own part of it.
 */
const BATCH_WINDOW_MS = 12;
const BATCH_MAX = 50;
interface Batch {
  keys: string[];
  waiters: Array<(res: unknown) => void>;
  timer: ReturnType<typeof setTimeout> | null;
}
const batches = new Map<string, Batch>();

function flushBatch(kind: string, build: (keys: string[]) => string, timeoutMs = TIMEOUT_MS): void {
  const batch = batches.get(kind);
  if (!batch) return;
  batches.delete(kind);
  if (batch.timer) clearTimeout(batch.timer);
  void getJson<unknown>(build(batch.keys), timeoutMs).then((res) => {
    for (const w of batch.waiters) w(res);
  });
}

function batched<T>(kind: string, build: (keys: string[]) => string, keys: string[], max = BATCH_MAX, timeoutMs = TIMEOUT_MS): Promise<T | null> {
  const wanted = Array.from(new Set(keys.filter(Boolean)));
  if (!wanted.length) return Promise.resolve(null);
  if (wanted.length > max) return getJson<T>(build(wanted.slice(0, max)), timeoutMs);
  const open = batches.get(kind);
  if (open && new Set([...open.keys, ...wanted]).size > max) flushBatch(kind, build, timeoutMs);
  let batch = batches.get(kind);
  if (!batch) {
    batch = { keys: [], waiters: [], timer: null };
    batches.set(kind, batch);
    const b0 = batch;
    batch.timer = setTimeout(() => {
      if (batches.get(kind) === b0) flushBatch(kind, build, timeoutMs);
    }, BATCH_WINDOW_MS);
  }
  for (const t of wanted) if (!batch.keys.includes(t)) batch.keys.push(t);
  const b = batch;
  return new Promise((resolve) => b.waiters.push((res) => resolve(res as T | null)));
}

function batchedTitleQuery(
  kind: string,
  build: (titles: string[]) => string,
  titles: string[],
  max = BATCH_MAX,
  timeoutMs = TIMEOUT_MS,
): Promise<TitleQuery | null> {
  return batched<{ query?: TitleQuery }>(kind, build, titles, max, timeoutMs).then((r) => (r ? r.query || {} : null));
}

/** File details already fetched, by lower-case file name, so a file is asked for once. */
const infoCache = new Map<string, ImageInfo>();

async function imageInfos(files: string[]): Promise<Map<string, ImageInfo>> {
  const out = new Map<string, ImageInfo>();
  const all = Array.from(new Set(files.map((f) => f.replace(/_/g, ' '))));
  for (const f of all) {
    const hit = infoCache.get(f.toLowerCase());
    if (hit) out.set(f.toLowerCase(), hit);
  }
  const unique = all.filter((f) => !out.has(f.toLowerCase()));
  if (!unique.length) return out;
  const q = (await batchedTitleQuery('commons-info', buildImageInfoUrl, unique)) as {
    normalized?: Array<{ from: string; to: string }>;
    pages?: Array<{ title: string; missing?: boolean; imageinfo?: ImageInfo[] }>;
  } | null;
  if (!q) return out;
  // Commons normalises names ("sarus cranecropped.jpg" to "Sarus cranecropped.jpg"); keep both.
  const from = new Map((q.normalized || []).map((n) => [n.to.replace(/^File:/, '').toLowerCase(), n.from.replace(/^File:/, '').toLowerCase()]));
  for (const p of q.pages || []) {
    if (p.missing || !p.imageinfo?.[0]) continue;
    const key = p.title.replace(/^File:/, '').toLowerCase();
    for (const k of [key, from.get(key)].filter(Boolean) as string[]) {
      out.set(k, p.imageinfo[0]);
      if (infoCache.size > 600) infoCache.clear();
      infoCache.set(k, p.imageinfo[0]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Wikidata lexemes

/** Wikidata's lexical categories, as our parts of speech. */
const LEXICAL_CATEGORIES: Record<string, string> = {
  Q1084: 'noun',
  Q147276: 'proper noun',
  Q24905: 'verb',
  Q34698: 'adjective',
  Q380057: 'adverb',
  Q36224: 'pronoun',
  Q4833830: 'preposition',
  Q36484: 'conjunction',
  Q83034: 'interjection',
  Q63116: 'numeral',
  Q576271: 'determiner',
};

/**
 * A sense of a Wikidata lexeme with a picture: the image of the item the sense links to ("item
 * for this sense", P5137, whose image is P18), or the sense's own image. Lexicographers make
 * these links one sense at a time, so "crane" the bird and "crane" the machine each point to
 * their own item.
 */
export interface LexemeSense {
  sense: string;
  pos: string;
  gloss: string;
  item: string;
  itemLabel: string;
  itemDescription: string;
  file: string;
}

function lexemeLanguageTag(lang: string): string {
  const code = String(lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  return /^[a-z]{2,3}$/.test(code) ? code : 'en';
}

/** One SPARQL query for the senses of every lemma asked (Wikidata Query Service, no key). */
export function buildLexemeQueryUrl(lemmas: string[], lang: string): string {
  const tag = lexemeLanguageTag(lang);
  const values = lemmas.map((l) => `"${String(l).replace(/["\\\n]/g, '')}"@${tag}`).join(' ');
  const q =
    `SELECT ?lemma ?cat ?sense ?gloss ?item ?itemLabel ?itemDesc ?img ?simg WHERE { ` +
    `VALUES ?lemma { ${values} } ` +
    `?lexeme wikibase:lemma ?lemma; wikibase:lexicalCategory ?cat; ontolex:sense ?sense. ` +
    `OPTIONAL { ?sense skos:definition ?gloss FILTER(LANG(?gloss) = "en") } ` +
    `OPTIONAL { ?sense wdt:P5137 ?item. OPTIONAL { ?item wdt:P18 ?img } ` +
    `OPTIONAL { ?item rdfs:label ?itemLabel FILTER(LANG(?itemLabel) = "en") } ` +
    `OPTIONAL { ?item schema:description ?itemDesc FILTER(LANG(?itemDesc) = "en") } } ` +
    `OPTIONAL { ?sense wdt:P18 ?simg } }`;
  return `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`;
}

interface SparqlBinding {
  [name: string]: { value: string } | undefined;
}

/** "Sarus cranecropped.jpg" from a Special:FilePath URL. */
function commonsFileFromUrl(url: string): string {
  const tail = String(url || '').split('/').pop() || '';
  try {
    return decodeURIComponent(tail).replace(/_/g, ' ');
  } catch {
    return tail.replace(/_/g, ' ');
  }
}

/** Advertisements, posters and covers: pictures of print about the thing, not of the thing. */
const PRINT_FILE = /\b(ad|advert|advertisement|poster|cover|catalogue|catalog|brochure|label)\b/i;

/**
 * The best of an item's several images: one whose name names the word or the item ("Internal
 * organs.svg" for the organs of the body rather than "Equisetum braunii (strobilus)"), not an
 * advertisement or poster, then the shorter name, then by name so runs agree.
 */
export function bestImage(urls: string[], about: string): string {
  const want = contentTokens(about);
  const scored = urls.map((u) => {
    const name = commonsFileTitle(commonsFileFromUrl(u));
    const words = contentTokens(name);
    let score = nearOverlap(words, want) > 0 ? 2 : 0;
    if (PRINT_FILE.test(name)) score -= 3;
    return { u, name, score };
  });
  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return scored[0]?.u || '';
}

/**
 * The lexeme senses of `lemma` that have a picture, from the query's rows. An item with several
 * images gives the first by name, so the choice does not change between runs; the item's image
 * comes before the sense's own (a sense image is sometimes a loose illustration).
 */
export function parseLexemeRows(rows: SparqlBinding[], lemma: string): LexemeSense[] {
  const bySense = new Map<string, LexemeSense & { imgs: string[]; simgs: string[] }>();
  for (const b of rows || []) {
    if (!b.lemma || b.lemma.value !== lemma || !b.sense) continue;
    const id = b.sense.value.split('/').pop() || '';
    let s = bySense.get(id);
    if (!s) {
      s = {
        sense: id,
        pos: LEXICAL_CATEGORIES[(b.cat?.value || '').split('/').pop() || ''] || '',
        gloss: b.gloss?.value || '',
        item: (b.item?.value || '').split('/').pop() || '',
        itemLabel: b.itemLabel?.value || '',
        itemDescription: b.itemDesc?.value || '',
        file: '',
        imgs: [],
        simgs: [],
      };
      bySense.set(id, s);
    }
    if (b.img && !s.imgs.includes(b.img.value)) s.imgs.push(b.img.value);
    if (b.simg && !s.simgs.includes(b.simg.value)) s.simgs.push(b.simg.value);
  }
  const out: LexemeSense[] = [];
  for (const s of bySense.values()) {
    const pick = bestImage(s.imgs, `${lemma} ${s.itemLabel} ${s.gloss}`) || bestImage(s.simgs, `${lemma} ${s.gloss}`);
    if (!pick) continue;
    const { imgs: _i, simgs: _s, ...rest } = s;
    out.push({ ...rest, file: commonsFileFromUrl(pick) });
  }
  return out.sort((a, b) => a.sense.localeCompare(b.sense, 'en', { numeric: true }));
}

/** Content words of a lexeme sense: its gloss, then its item's label and description. */
function lexemeTokens(l: LexemeSense, lemma: string): { gloss: string[]; all: string[] } {
  const gloss = contentTokens(l.gloss, lemma);
  const all = contentTokens(`${l.gloss} ${l.itemLabel} ${l.itemDescription}`, lemma);
  return { gloss, all };
}

/** Words that head a gloss without naming the thing: "type of machine", "family of birds". */
const GENERIC_HEADS = new Set(
  'type kind sort form piece part family group collection member set number any instance variety class order item thing one name term general'
    .split(' ')
    .map((w) => stem(w)),
);

/**
 * Head words that dictionaries use interchangeably: a compass is a "navigation instrument" in
 * Wikidata and "a device used to determine the cardinal directions" in Wiktionary.
 */
const HEAD_CLASSES = [
  ['device', 'instrument', 'tool', 'apparatus', 'implement', 'utensil', 'gadget', 'appliance'],
  ['hole', 'opening', 'aperture', 'gap'],
  ['part', 'region', 'area', 'portion', 'zone', 'section'],
  ['container', 'receptacle', 'vessel', 'box'],
  ['structure', 'construction', 'building'],
  ['headdress', 'headwear', 'headgear', 'headpiece', 'hat', 'cap', 'helmet', 'diadem'],
  ['tube', 'pipe', 'cylinder', 'conduit', 'duct'],
  ['cover', 'covering', 'layer', 'casing', 'coating', 'exterior'],
  ['garment', 'clothing', 'outerwear', 'apparel'],
].map((c) => c.map((w) => stem(w)));

function sameHead(a: string, b: string): boolean {
  if (nearWord(a, b)) return true;
  return HEAD_CLASSES.some((c) => c.includes(a) && c.includes(b));
}

const PHRASE_END = /^(.*?)(?:\s+(?:of|which|that|who|used|with|for|in|to|from|between|occurring)\b|[,;(]|$)/;

/**
 * The word a short gloss is about: the last word of its first noun phrase ("financial
 * institution", "sloping edge of a watercourse"), or, when that word is generic, the last word
 * of the phrase after "of" ("type of machine", "family of birds", "one of the Earth's four
 * temperate seasons").
 */
export function glossHead(gloss: string, lemma = ''): string {
  // A leading setting ("in an East Asian context, is a general name for printing stamps") is
  // not the thing; neither is a copula.
  const plain = stripHtml(gloss)
    .toLowerCase()
    .replace(/^(?:in|on|within|among)\b[^,]*,\s*/, '')
    .replace(/^(?:is|are|was)\s+/, '');
  const m = plain.match(PHRASE_END);
  const before = contentTokens(m ? m[1] : plain, lemma);
  const last = before[before.length - 1] || '';
  if (last && !GENERIC_HEADS.has(last)) return last;
  const after = plain.match(/\b(?:of|for)\s+(.*)$/);
  if (!after) return last;
  const phrase = after[1].match(PHRASE_END);
  const words = contentTokens(phrase ? phrase[1] : after[1], lemma).filter((t) => !GENERIC_HEADS.has(t));
  return words[words.length - 1] || last;
}

/** "keystone" and "capstone": two one-word compounds on the same head that are different words. */
export function siblingCompound(label: string, lemma: string): boolean {
  const a = String(label || '').trim().toLowerCase();
  const b = String(lemma || '').trim().toLowerCase();
  if (!a || !b || a === b || /\s/.test(a) || /\s/.test(b) || a.endsWith(b) || b.endsWith(a)) return false;
  let n = 0;
  while (n < Math.min(a.length, b.length) && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n >= 4 && n < a.length && n < b.length;
}

/**
 * Every head the leading noun phrase of a gloss may have, for a gloss that lists adjectives or
 * alternatives: "a royal, imperial or princely headdress" gives headdress, "hard, protective outer
 * layers" gives layer. A lone word before a comma is taken for an adjective and skipped.
 */
export function glossHeads(gloss: string, lemma = ''): string[] {
  const plain = stripHtml(gloss)
    .toLowerCase()
    .replace(/^(?:in|on|within|among)\b[^,]*,\s*/, '')
    .replace(/^(?:is|are|was)\s+/, '');
  const m = plain.match(/^(.*?)(?:\s+(?:of|which|that|who|used|with|for|in|to|from|between|occurring|by|created|made|consisting|comprising|formed|found|containing|on|at|as)\b|[;(]|$)/);
  const phrase = m ? m[1] : plain;
  if (!/,|\s(?:or|and)\s/.test(phrase)) {
    const h = glossHead(gloss, lemma);
    return h ? [h] : [];
  }
  const parts = phrase.split(/,|\s+(?:or|and)\s+/);
  const heads: string[] = [];
  parts.forEach((part, i) => {
    const t = contentTokens(part, lemma);
    if (!t.length || (t.length === 1 && i < parts.length - 1)) return;
    const h = t[t.length - 1];
    if (!GENERIC_HEADS.has(h) && !heads.includes(h)) heads.push(h);
  });
  return heads;
}

function headsMeet(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => sameHead(x, y)));
}

/**
 * How well an article from the word's disambiguation page fits a sense, 0 when it does not:
 * "Tobacco pipe", "Pipe (fluid conveyance)", "Pitcher (container)", "Bed sheet". The title's
 * qualifier or modifier naming a word of the gloss counts two, the article's description having
 * the gloss's head counts two, and each further word the description and first sentences share
 * with the gloss counts one, up to three; three in all are needed.
 */
export function relatedPageFit(page: WikipediaPage, sense: SenseInput, lemma: string): number {
  const { base, qualifier } = titleParts(page.title);
  const w = lemma.toLowerCase();
  const b = base.toLowerCase();
  // "tobacco" in "Tobacco pipe", "sea" in "Seashell".
  const modifier = b !== w && b.endsWith(w) ? b.slice(0, -w.length).replace(/[\s-]+$/, '') : '';
  const g = contentTokens(glossBody(sense.meaning), lemma);
  if (!g.length) return 0;
  const heads = glossHeads(glossBody(sense.meaning), lemma);
  const label = contentTokens(`${modifier} ${qualifier}`, lemma);
  const named = label.some((t) => g.some((x) => nearWord(x, t)) || heads.some((h) => sameHead(h, t)));
  // A gloss with no head of its own ("a curved circular form") needs the title's word in it.
  if (!heads.length && !named) return 0;
  // The description's head with the word kept: "Cap which fills the inner space of a crown" is a cap.
  const pageHeads = glossHeads(String(page.description || ''));
  const headed = headsMeet(heads, pageHeads);
  const d = contentTokens(`${page.description || ''} ${page.extract || ''}`, lemma).filter((t) => !label.includes(t));
  const shared = overlap(g, d);
  // Two different things by head ("Jet (fluid)" is a stream, the sense a nozzle): the title's word
  // in the gloss is not enough without two more shared words.
  if (heads.length && pageHeads.length && !headed && !(named && shared >= 2)) return 0;
  const score = (named ? 2 : 0) + (headed ? 2 : 0) + Math.min(3, shared);
  // A one-word compound is usually another thing ("whiteboard", "eggshell"): it needs its
  // modifier in the gloss, or the head and three shared words.
  const need = named ? 3 : /[\s(-]/.test(page.title) ? 4 : 5;
  return score >= need ? score : 0;
}

/**
 * How well a lexeme sense fits one of our senses, 0 when it does not. The parts of speech must
 * agree (when both are known), and the lexeme sense's gloss, item label and item description
 * must share two content words with our gloss, one of them the head of the lexeme's gloss
 * ("instruments which produce low pitched tones" fits "an instrument that plays in the bass
 * range", not "the section of a musical ensemble that produces the lowest tones"), or one
 * when the lexeme's gloss is two or three words, all of them in ours, one of them its head
 * word ("family of birds" and "Any bird of the family Gruidae").
 */
export function lexemeFit(l: LexemeSense, sense: SenseInput, lemma: string): number {
  const sp = canonicalSensePos(sense.partOfSpeech);
  if (l.pos && sp && l.pos !== sp && !(l.pos === 'noun' && sp === 'proper noun')) return 0;
  const ours = contentTokens(glossBody(sense.meaning), lemma);
  if (!ours.length) return 0;
  const t = lexemeTokens(l, lemma);
  const all = t.all.filter((x) => ours.some((w) => sameHead(w, x))).length;
  const own = nearOverlap(t.gloss, ours);
  const head = glossHead(l.gloss, lemma);
  const headShared = !!head && ours.some((w) => sameHead(w, head));
  if (all >= 2 && headShared) return all + own / 2 + 1;
  // A gloss of two or three words fits when ours contains every one of them (generic heads
  // aside) and opens with its head: "elastic device", "family of birds"; "water source" does not
  // fit "the source from which an action springs".
  const needed = t.gloss.filter((g) => !GENERIC_HEADS.has(g));
  if (t.gloss.length <= 3 && needed.length && needed.every((g) => ours.some((w) => sameHead(w, g))) && needed.some((g) => sameHead(g, ours[0]))) {
    return 1 + own / 2;
  }
  return 0;
}

// ---------------------------------------------------------------- the picture pool

/**
 * Every picture a word may show, gathered once per word and language, before and apart from the
 * sense list: Wiktionary's pictures on the word's page, Wikidata lexeme senses with an image, and
 * the Wikipedia article titled with the word. Which sense shows which picture is decided locally
 * (`assignPictures`), so a lookup whose senses arrive in several steps, and the card for the same
 * word, reuse one pool.
 */
export interface PoolPicture {
  file: string;
  source: 'wiktionary' | 'lexeme' | 'senseitem' | 'article';
  /** Index into the pool's Wiktionary pictures or lexeme senses. */
  ref: number;
  image?: SenseImage;
  /** The file's Commons record files it as a portrait of a named person. */
  portrait?: boolean;
  /** The file's Commons record files it as a map, flag, logo, cover or screenshot. */
  chart?: boolean;
}

export interface PicturePool {
  lemma: string;
  lang: string;
  wiktionary: WiktionaryImage[];
  lexemes: LexemeSense[];
  /** Wiktionary definition lines tied to a Wikidata item, with the item's image. */
  senseItems: Array<WiktionarySenseItem & { file: string; label?: string }>;
  /** The article titled with the word (English) or on the word's own Wikipedia. */
  article: WikipediaPage | null;
  /** English articles titled with a foreign word's short gloss ("猫" gives "Cat"). */
  glossArticles: WikipediaPage[];
  /** Articles on the word's disambiguation page titled with it ("Pitcher (container)", "Tobacco pipe"), with a picture. */
  related?: WikipediaPage[];
  /** Definition lines of the Wiktionary page by etymology, to tell homographs apart. */
  etymology: Array<{ ety: number; tokens: string[] }>;
  pictures: PoolPicture[];
  /** Every source answered (or failed). */
  complete: boolean;
  /** A request failed, so the pool may lack pictures it would otherwise have. */
  failed: boolean;
}

/** Definition lines by etymology, from a Wiktionary language section with two etymologies or more. */
export function etymologyLines(wikitext: string, lang: string, lemma: string): Array<{ ety: number; tokens: string[] }> {
  const section = wiktionaryLanguageSection(wikitext, lang);
  if (!section || !/^={3,}\s*Etymology\s+2\s*=+/im.test(section)) return [];
  const lines: Array<{ ety: number; tokens: string[] }> = [];
  let ety = 0;
  for (const line of section.split('\n')) {
    const h = line.match(/^={3,}\s*Etymology(?:\s+(\d+))?\s*=+\s*$/i);
    if (h) {
      ety = Number(h[1] || 1);
      continue;
    }
    if (ety && /^#\s*[^:*#\s]/.test(line)) lines.push({ ety, tokens: contentTokens(wikiToText(line.replace(/^#+\s*/, '')), lemma).slice(0, 12) });
  }
  return lines;
}

/** Which etymology each sense belongs to, from `etymologyLines` (0 when no line fits). */
export function etymologyOfSenses(lines: Array<{ ety: number; tokens: string[] }>, senses: SenseInput[], lemma: string): number[] {
  if (!lines.length) return senses.map(() => 0);
  return senses.map((s) => {
    const t = contentTokens(glossBody(s.meaning), lemma);
    if (!t.length) return 0;
    let best = 0;
    let bestN = 0;
    for (const l of lines) {
      const n = overlap(t, l.tokens);
      const enough = n >= 2 || (n >= 1 && n === Math.min(t.length, l.tokens.length) && t.length <= 2);
      if (enough && n > bestN) {
        bestN = n;
        best = l.ety;
      }
    }
    return best;
  });
}

/** Senses the lookup should keep a picture box for while pictures load: the major ones. */
export function predictPictureSenses(lemma: string, senses: SenseInput[], max = 4): number[] {
  return majorSenses(senses, lemma, max).order;
}

/**
 * The rules that decide which senses get a picture and from which source, in one place so they
 * can follow lexicographic practice as it is settled (`configureSensePictures`).
 */
export interface SensePictureRules {
  /** Pictures per lookup at most. */
  maxPictures: number;
  /** Source order: the higher rank wins when several sources fit a sense. 0 turns a source off. */
  rank: { lexeme: number; senseItem: number; wiktionaryLinked: number; wiktionaryCaption: number; glossArticle: number; relatedArticle: number; article: number };
  /** Pictures matched by shared words (Wiktionary captions, articles) only go to senses that name
   *  something you can see; a picture an editor linked to the sense itself stays on any sense. */
  picturableOnly: boolean;
  /** Major senses are pictured in order of how often they are used (SemCor), when known. */
  byFrequency: boolean;
  /** Minor senses get a picture only once every major sense you can see has one, or every source has answered. */
  minorsAfterMajors: boolean;
  /** A portrait of a named person never shows: it pictures that person, not the word ("pitcher"
   *  the player is not one baseball player). */
  noNamedPortraits: boolean;
}

export const SENSE_PICTURE_RULES: SensePictureRules = {
  maxPictures: 3,
  // Source order by how often each kind of link is right (Wikidata's item images first).
  rank: { lexeme: 40, senseItem: 38, wiktionaryLinked: 35, wiktionaryCaption: 20, glossArticle: 12, relatedArticle: 11, article: 10 },
  picturableOnly: true,
  byFrequency: true,
  minorsAfterMajors: true,
  noNamedPortraits: true,
};

/** Changes some of the rules for every later lookup. Saved pools stay valid: rules apply when a pool is matched to senses. */
export function configureSensePictures(rules: Partial<SensePictureRules>): void {
  Object.assign(SENSE_PICTURE_RULES, rules, rules.rank ? { rank: { ...SENSE_PICTURE_RULES.rank, ...rules.rank } } : {});
}

/**
 * The order in which senses get a picture. Major senses come first: the first sense of each
 * entry and part of speech, ordered by how often each is used in running text (`frequency`, from
 * SemCor) when the lookup knows it. Minor senses follow in dictionary order, once every major
 * sense you can see has its picture or every source has answered, so a curated picture of a
 * minor sense ("bell" the flower) never takes the place of the main one.
 */
function senseOrder(senses: SenseInput[], lemma: string, etymology: number[]): { major: number[]; minor: number[] } {
  const heads = majorSenses(senses, lemma, 12, etymology).heads;
  const major = senses.map((_s, i) => i).filter((i) => heads.has(i));
  const freq = (i: number) => (typeof senses[i].frequency === 'number' ? (senses[i].frequency as number) : -1);
  major.sort((a, b) => (SENSE_PICTURE_RULES.byFrequency ? freq(b) - freq(a) : 0) || a - b);
  const minor = senses.map((_s, i) => i).filter((i) => stripHtml(senses[i].meaning) && !major.includes(i));
  return { major, minor };
}

/**
 * Whether a sense names something you can see: a noun (or a card's sense of unknown part of
 * speech) with no slang or figurative label whose head is not an act, state, quality or idea.
 * Concreteness ratings (Brysbaert, Warriner and Kuperman 2014) would be finer, but the article
 * and its supplementary data state no licence for redistribution, so the part of speech and the
 * gloss's head decide.
 */
export function picturableSense(sense: SenseInput, lemma: string): boolean {
  const pos = canonicalSensePos(sense.partOfSpeech);
  if (pos && pos !== 'noun' && pos !== 'proper noun') return false;
  return isConcreteNounSense({ meaning: sense.meaning, partOfSpeech: 'noun' }, lemma);
}

/**
 * How well a Wiktionary definition line fits one of our senses (0 when it does not): the same
 * part of speech and two shared content words making half of the shorter gloss, or all of a
 * gloss of one or two words. The line and our gloss usually are the same Wiktionary sentence.
 */
export function linkedLineFit(line: string, linePos: string, sense: SenseInput, lemma: string): number {
  const sp = canonicalSensePos(sense.partOfSpeech);
  if (linePos && sp && linePos !== sp) return 0;
  const a = contentTokens(line, lemma);
  const b = contentTokens(glossBody(sense.meaning), lemma);
  if (!a.length || !b.length) return 0;
  const n = overlap(a, b);
  const ratio = n / Math.min(a.length, b.length);
  // Accepted fits rank by how much of both they cover, so the sense that is the line itself
  // wins over a longer one that only quotes it.
  if ((n >= 2 && ratio >= 0.5) || (n >= 1 && n === Math.min(a.length, b.length) && Math.min(a.length, b.length) <= 2)) {
    return n / Math.max(a.length, b.length);
  }
  return 0;
}

/**
 * Pictures for `senses` from a pool, aligned with `senses`, at most `max`. A sense takes the best
 * unused picture that fits it: a Wiktionary picture tied to it, then a Wikidata lexeme sense that
 * matches its gloss and part of speech, then a Wiktionary caption sharing two of its words, then
 * the article titled with the word when the sense is a noun and its gloss fits the article's
 * description or first sentences. Nothing else is used: a wrong picture is worse than none. A
 * portrait of a named person never shows, and hidden pictures never show.
 */
export function assignPictures(
  pool: PicturePool,
  senses: SenseInput[],
  opts: { max?: number; hidden?: Set<string> } = {},
): Array<SenseImage | null> {
  const lemma = pool.lemma;
  const max = Math.max(0, Math.min(10, opts.max ?? SENSE_PICTURE_RULES.maxPictures));
  const R = SENSE_PICTURE_RULES.rank;
  const out: Array<SenseImage | null> = senses.map((): null => null);
  if (!max) return out;
  const hidden = opts.hidden || new Set<string>();
  const byKey = new Map(pool.pictures.map((p) => [`${p.source}:${p.ref}`, p]));
  const usable = (p: PoolPicture | undefined, sense: SenseInput): p is PoolPicture & { image: SenseImage } =>
    !!p &&
    !!p.image &&
    !isHidden(hidden, p.file, sense.meaning) &&
    (!p.portrait || !SENSE_PICTURE_RULES.noNamedPortraits) &&
    // An article's map or logo is never the thing; a link an editor made may be ("Gulf").
    !(p.chart && p.source === 'article');

  // Candidates per sense, best first.
  const cands = senses.map((): Array<{ key: string; rank: number }> => []);
  const picturable = senses.map((s) => !SENSE_PICTURE_RULES.picturableOnly || picturableSense(s, lemma));
  for (const m of matchWiktionaryImages(pool.wiktionary, senses, lemma)) {
    // A picture an editor tied to this sense stays even on an abstract sense ("hope" has an
    // allegory); one matched only by shared words needs a sense you can see.
    const linked = !!pool.wiktionary[m.imageIndex].senseText;
    if (!linked && !picturable[m.senseIndex]) continue;
    const base = linked ? R.wiktionaryLinked : R.wiktionaryCaption;
    if (base > 0) cands[m.senseIndex].push({ key: `wiktionary:${m.imageIndex}`, rank: base + m.score / 100 });
  }
  // A lexeme sense goes only to the sense it fits best (the violin bow belongs to "a rod with
  // horsehair", not to "a stringed instrument consisting of a stick with a taut cord"), and a
  // sense takes only the lexeme senses that fit it best (the apple, not the apple tree's wood).
  const fit = pool.lexemes.map((l) => senses.map((s) => lexemeFit(l, s, lemma)));
  const bestForLexeme = fit.map((row) => Math.max(0, ...row));
  const bestForSense = senses.map((_s, i) => Math.max(0, ...fit.map((row) => row[i])));
  fit.forEach((row, k) => {
    // An item named with a sibling compound is another thing: "capstone" linked to the keystone.
    if (siblingCompound(pool.lexemes[k].itemLabel, lemma)) return;
    row.forEach((f, i) => {
      if (R.lexeme > 0 && f > 0 && f === bestForLexeme[k] && f === bestForSense[i]) cands[i].push({ key: `lexeme:${k}`, rank: R.lexeme + Math.min(f, 9) });
    });
  });
  // Wiktionary lines tied to an item: the sense whose gloss the line matches, best fit only.
  (pool.senseItems || []).forEach((x, k) => {
    if (R.senseItem <= 0) return;
    const fits = senses.map((s) => linkedLineFit(x.senseText, x.pos, s, lemma));
    const best = Math.max(0, ...fits);
    // The line that is our gloss word for word is the editor's own link for this sense, and
    // beats a lexeme sense matched by shared words ("bell": the church bell, not a trumpet's bell).
    const rank = (f: number) => (f >= 0.9 ? R.lexeme + 10 : R.senseItem + Math.min(f, 1));
    if (best > 0) fits.forEach((f, i) => f === best && cands[i].push({ key: `senseitem:${k}`, rank: rank(f) }));
  });
  const code = String(pool.lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  const nouns = senses.map((s, i) => (stripHtml(s.meaning) && ['noun', ''].includes(canonicalSensePos(s.partOfSpeech)) ? i : -1)).filter((i) => i >= 0);
  if (pool.article) {
    nouns.forEach((i, k) => {
      const fits =
        code === 'en'
          ? pageFitsGloss(pool.article as WikipediaPage, lemma, senses[i].meaning, lemma, { strict: k > 0 })
          : k === 0;
      if (fits && R.article > 0 && picturable[i]) cands[i].push({ key: 'article:0', rank: R.article });
    });
  }
  // Articles from the disambiguation page: each goes to the sense it fits best.
  (pool.related || []).forEach((page, k) => {
    if (R.relatedArticle <= 0) return;
    const fits = senses.map((s, i) => (picturable[i] && nouns.includes(i) ? relatedPageFit(page, s, lemma) : 0));
    const best = Math.max(0, ...fits);
    if (best > 0) fits.forEach((f, i) => f === best && cands[i].push({ key: `article:${2000 + k}`, rank: R.relatedArticle + Math.min(f, 7) / 10 }));
  });
  pool.glossArticles.forEach((page, k) => {
    for (const i of nouns) {
      if (picturable[i] && shortGlossTitle(senses[i].meaning).toLowerCase() === page.title.toLowerCase()) cands[i].push({ key: `article:${1000 + k}`, rank: R.glossArticle });
    }
  });

  const etymology = etymologyOfSenses(pool.etymology, senses, lemma);
  const { major, minor } = senseOrder(senses, lemma, etymology);
  const used = new Set<string>();
  let count = 0;
  const give = (i: number): boolean => {
    for (const c of [...cands[i]].sort((a, b) => b.rank - a.rank)) {
      const p = byKey.get(c.key);
      if (!usable(p, senses[i]) || used.has(p.file.toLowerCase())) continue;
      used.add(p.file.toLowerCase());
      out[i] = p.image;
      count += 1;
      return true;
    }
    return false;
  };
  // A major sense you cannot see does not hold the minor ones back. One you can see that has no
  // picture yet holds them back while sources are still answering, since its picture may still
  // come; once every source has answered it has none to find ("crane" the cranium) and the
  // minor senses take the free places.
  let allMajor = true;
  for (const i of major) {
    if (count >= max) break;
    if (!give(i) && picturable[i]) allMajor = false;
  }
  if (allMajor || pool.complete || !SENSE_PICTURE_RULES.minorsAfterMajors) for (const i of minor) if (count < max) give(i);
  return out;
}

/**
 * One picture for a word with no gloss (a card saved without a definition): the first lexeme
 * sense with a picture, else a Wiktionary sense line's item, else a Wiktionary picture tied to a
 * sense.
 */
function wholeWordPicture(pool: PicturePool, hidden: Set<string>): SenseImage | null {
  // Without a gloss there is no telling which sense a hidden picture was hidden on: any counts.
  const files = new Set(Array.from(hidden, (h) => h.split(HIDDEN_SEP)[0]));
  const ok = (p: PoolPicture | undefined) => !!p && !!p.image && !p.portrait && !files.has(p.file.toLowerCase());
  // Only curated links: with no gloss there is no way to tell an abstract word's article picture
  // from a fitting one, and none is better than a wrong one.
  const order = [
    ...pool.pictures.filter((p) => p.source === 'lexeme'),
    ...pool.pictures.filter((p) => p.source === 'senseitem'),
    ...pool.pictures.filter((p) => p.source === 'wiktionary' && pool.wiktionary[p.ref]?.senseText),
  ];
  return order.find(ok)?.image || null;
}

// ---------------------------------------------------------------- building a pool

let wikitextSource: ((word: string) => Promise<string>) | null = null;

/**
 * The dictionary registers how it reads a Wiktionary page, so pictures reuse the page the lookup
 * already fetched (and keeps on disk) instead of downloading it again.
 */
export function registerWiktionaryWikitextSource(source: ((word: string) => Promise<string>) | null): void {
  wikitextSource = source;
}

/** Wiktionary pages asked for together (a screen of cards) come in one request, four at most. */
const WIKTIONARY_BATCH = 4;

async function wikitextFor(lemma: string): Promise<{ text: string; ok: boolean }> {
  if (wikitextSource) {
    try {
      const text = await wikitextSource(lemma);
      if (text) return { text, ok: true };
    } catch {
      /* fall back to our own request */
    }
  }
  const q = await batchedTitleQuery(
    'wiktionary-page',
    (titles) => buildWiktionaryUrl(titles.join('|')),
    [lemma],
    WIKTIONARY_BATCH,
    WIKTIONARY_TIMEOUT_MS,
  );
  if (!q) return { text: '', ok: false };
  const page = resolveTitle(q, lemma) as { revisions?: Array<{ slots?: { main?: { content?: string } } }> } | undefined;
  return { text: page?.revisions?.[0]?.slots?.main?.content || '', ok: true };
}

/** Lexeme queries asked together share one SPARQL request, twelve lemmas at most. */
const LEXEME_BATCH = 12;

async function lexemesFor(lemma: string, lang: string): Promise<{ senses: LexemeSense[]; ok: boolean }> {
  const tag = lexemeLanguageTag(lang);
  type Rows = { results?: { bindings?: SparqlBinding[] } };
  // A batch the query service could not answer in time is asked again for this lemma alone,
  // which is quick: the batch is slow because of its size, not because of any one word.
  const res =
    (await batched<Rows>(`lexemes:${tag}`, (lemmas) => buildLexemeQueryUrl(lemmas, tag), [lemma], LEXEME_BATCH)) ||
    (await getJson<Rows>(buildLexemeQueryUrl([lemma], tag), RETRY_TIMEOUT_MS));
  if (!res) return { senses: [], ok: false };
  return { senses: parseLexemeRows(res.results?.bindings || [], lemma), ok: true };
}

/** The images (P18) of Wikidata items, one SPARQL query for every item asked together. */
export function buildItemImagesUrl(items: string[]): string {
  const values = items.filter((q) => /^Q\d+$/.test(q)).map((q) => `wd:${q}`).join(' ');
  const q = `SELECT ?item ?img ?label WHERE { VALUES ?item { ${values} } ?item wdt:P18 ?img . OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "en") } }`;
  return `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`;
}

async function itemImages(items: string[]): Promise<{ images: Map<string, string[]>; labels: Map<string, string>; ok: boolean }> {
  const images = new Map<string, string[]>();
  const labels = new Map<string, string>();
  if (!items.length) return { images, labels, ok: true };
  type Rows = { results?: { bindings?: SparqlBinding[] } };
  const res =
    (await batched<Rows>('items', buildItemImagesUrl, items, 40)) || (await getJson<Rows>(buildItemImagesUrl(items), RETRY_TIMEOUT_MS));
  if (!res) return { images, labels, ok: false };
  for (const b of res.results?.bindings || []) {
    const id = (b.item?.value || '').split('/').pop() || '';
    if (!id || !b.img) continue;
    if (!images.has(id)) images.set(id, []);
    const list = images.get(id) as string[];
    if (!list.includes(b.img.value)) list.push(b.img.value);
    if (b.label?.value && !labels.has(id)) labels.set(id, b.label.value);
  }
  return { images, labels, ok: true };
}

/** Commons file details for the pool's pictures that lack them, then the portrait mark. */
async function fillImages(pool: PicturePool, titleOf: (p: PoolPicture) => string): Promise<boolean> {
  const missing = pool.pictures.filter((p) => !p.image);
  if (!missing.length) return true;
  const infos = await imageInfos(missing.map((p) => p.file));
  let ok = true;
  for (const p of missing) {
    const info = infos.get(p.file.toLowerCase());
    if (!info) {
      ok = ok && infos.size > 0;
      continue;
    }
    p.image = imageFromInfo(p.file, titleOf(p), info) || undefined;
    const categories = stripHtml(info.extmetadata?.Categories?.value || '');
    p.portrait = PERSON_CATEGORY.test(categories);
    p.chart = badMatch(BAD_CATEGORY, categories, pool.lemma);
  }
  return ok;
}

/**
 * A picture's title from a definition line when no label names it: the line's first clause,
 * without labels in brackets, cut at a word before sixty letters ("Panthera tigris", not "Panthera
 * tigris, a large predatory mammal (Felis tigris) of the cat fam").
 */
export function titleFromGloss(text: string): string {
  const plain = stripHtml(text || '').replace(/^(\([^)]*\)\s*)+/, '').trim();
  const clause = (plain.split(/[;:.]\s|,\s(?=an?\s|the\s|any\s|one\s)/i)[0] || plain).replace(/[.;:,]+$/, '').trim();
  if (clause.length <= 60) return clause.charAt(0).toUpperCase() + clause.slice(1);
  const cut = clause.slice(0, 60).replace(/\s+\S*$/, '').replace(/[\s,;:]+$/, '');
  return `${cut.charAt(0).toUpperCase()}${cut.slice(1)}…`;
}

function poolTitle(pool: PicturePool, p: PoolPicture): string {
  if (p.source === 'wiktionary') {
    const w = pool.wiktionary[p.ref];
    return (w && (w.caption || titleFromGloss(w.senseText))) || commonsFileTitle(p.file);
  }
  if (p.source === 'lexeme') {
    const l = pool.lexemes[p.ref];
    return (l && (l.itemLabel || titleFromGloss(l.gloss))) || commonsFileTitle(p.file);
  }
  if (p.source === 'senseitem') {
    const x = pool.senseItems[p.ref];
    return (x && (x.label || titleFromGloss(x.senseText))) || commonsFileTitle(p.file);
  }
  if (p.source === 'article' && p.ref < 0) return commonsFileTitle(p.file);
  if (p.ref >= 2000) return titleParts(pool.related?.[p.ref - 2000]?.title || '').base || commonsFileTitle(p.file);
  const page = p.ref >= 1000 ? pool.glossArticles[p.ref - 1000] : pool.article;
  return page?.title || commonsFileTitle(p.file);
}

function addPicture(pool: PicturePool, file: string, source: PoolPicture['source'], ref: number): void {
  const f = String(file || '').replace(/_/g, ' ').trim();
  if (!f || NON_IMAGE_EXT.test(f)) return;
  if (pool.pictures.some((p) => p.source === source && p.ref === ref)) return;
  pool.pictures.push({ file: f, source, ref });
}

/**
 * Builds a pool: the Wiktionary page, the lexeme query and the Wikipedia title query start
 * together; each source's files get their Commons details as soon as that source answers, and
 * `progress` sees the pool after each step, so the first pictures show before the slowest source.
 */
async function buildPool(lemma: string, lang: string, hints: string[], progress: (pool: PicturePool) => void): Promise<PicturePool> {
  const code = String(lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  const pool: PicturePool = {
    lemma,
    lang: code,
    wiktionary: [],
    lexemes: [],
    senseItems: [],
    article: null,
    glossArticles: [],
    etymology: [],
    pictures: [],
    complete: false,
    failed: false,
  };
  const step = async (fill: () => Promise<boolean>) => {
    try {
      if (!(await fill())) pool.failed = true;
    } catch {
      pool.failed = true;
    }
    if (!(await fillImages(pool, (p) => poolTitle(pool, p)))) pool.failed = true;
    progress(pool);
  };
  const wiktionary = step(async () => {
    const { text, ok } = await wikitextFor(lemma);
    if (text) {
      pool.wiktionary = extractWiktionaryImages(text, code);
      pool.etymology = etymologyLines(text, code, lemma);
      pool.wiktionary.forEach((w, k) => addPicture(pool, w.file, 'wiktionary', k));
      // Definition lines tied to a Wikidata item show that item's image.
      const items = extractSenseItems(text, code);
      if (items.length) {
        const { images, labels, ok: itemsOk } = await itemImages(items.map((x) => x.item));
        for (const x of items) {
          const pick = bestImage(images.get(x.item) || [], `${lemma} ${x.senseText}`);
          if (!pick) continue;
          pool.senseItems.push({ ...x, label: labels.get(x.item) || '', file: commonsFileFromUrl(pick) });
          addPicture(pool, commonsFileFromUrl(pick), 'senseitem', pool.senseItems.length - 1);
        }
        if (!itemsOk) return false;
      }
    }
    return ok;
  });
  const lexemes = step(async () => {
    const { senses, ok } = await lexemesFor(lemma, code);
    pool.lexemes = senses;
    senses.forEach((l, k) => addPicture(pool, l.file, 'lexeme', k));
    return ok;
  });
  const article = step(async () => {
    const q = await titleQuery(buildWikipediaTitleUrl(lemma.trim(), code === 'en' ? 'en' : code));
    if (!q) return false;
    const page = resolveTitle(q, lemma.trim()) || null;
    const usable = !!page && !page.missing && page.pageprops?.disambiguation === undefined && !/disambiguation/i.test(page.title);
    const elsewhere = !!page && (BAD_DESCRIPTION.test(String(page.description || '')) || BAD_DESCRIPTION.test(titleParts(page.title).qualifier));
    if (!page || !usable || elsewhere) return true;
    pool.article = page;
    // The article's Wikidata image first: it is chosen for the item, while a lead image may be
    // a diagram or a detail ("Crane (machine)" opens with an SVG).
    const item = page.pageprops?.wikibase_item;
    if (item) {
      const { images } = await itemImages([item]);
      const pick = bestImage(images.get(item) || [], `${lemma} ${page.title}`);
      if (pick) {
        addPicture(pool, commonsFileFromUrl(pick), 'article', 0);
        return true;
      }
    }
    if (acceptConceptPage(page)) {
      addPicture(pool, page.pageimage as string, 'article', 0);
      return true;
    }
    // No free lead image ("Operon"): a picture used in the article that names the word.
    const files = await articleImageFilesMany([page.title], code === 'en' ? 'en' : code);
    const ranked = rankArticleImages(files.get(page.title) || [], lemma, []);
    if (ranked[0]) addPicture(pool, ranked[0], 'article', 0);
    return true;
  });
  const glossTitles = code === 'en' ? Promise.resolve() : addGlossArticles(pool, hints, step);
  const related = code === 'en' ? step(() => addRelatedArticles(pool)) : Promise.resolve();
  await Promise.all([wiktionary, lexemes, article, glossTitles, related]);
  pool.complete = true;
  return pool;
}

/** Whether a title on a disambiguation page is the word itself or a compound ending in it. */
export function relatedTitle(title: string, lemma: string): boolean {
  const w = lemma.trim().toLowerCase();
  const b = titleParts(title).base.toLowerCase();
  if (!w || /disambiguation|^list of|^the\s|surname|given name/i.test(title)) return false;
  if (b === w) return !!titleParts(title).qualifier;
  if (b.endsWith(` ${w}`) || b.endsWith(`-${w}`)) return b.split(/[\s-]+/).length === 2;
  return !/\s/.test(b) && b.endsWith(w) && b.length - w.length >= 3 && b.length - w.length <= 5;
}

/** The articles a word's English disambiguation page links to, with their descriptions. */
export function buildDisambiguationLinksUrl(lemma: string): string {
  const w = lemma.trim();
  const title = `${w.charAt(0).toUpperCase()}${w.slice(1)} (disambiguation)`;
  return (
    'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1' +
    '&generator=links&gplnamespace=0&gpllimit=max&prop=description|pageprops&ppprop=disambiguation|wikibase_item' +
    `&titles=${encodeURIComponent(title)}&origin=*`
  );
}

/** Twenty articles at most from the disambiguation page get their pictures looked up. */
const RELATED_MAX = 20;

/**
 * Articles on the word's disambiguation page that are titled with the word ("Pitcher
 * (container)", "Tobacco pipe", "Seashell"), each with its Wikidata image or its free lead
 * image, for senses the article titled with the bare word does not cover.
 */
async function addRelatedArticles(pool: PicturePool): Promise<boolean> {
  const res = await getJson<{ query?: { pages?: WikipediaPage[] } }>(buildDisambiguationLinksUrl(pool.lemma));
  if (!res) return false;
  const names = (res.query?.pages || [])
    .filter((p) => !p.missing && p.pageprops?.disambiguation === undefined && relatedTitle(p.title, pool.lemma))
    .filter((p) => !BAD_DESCRIPTION.test(String(p.description || '')) && !BAD_DESCRIPTION.test(titleParts(p.title).qualifier))
    .map((p) => p.title)
    .slice(0, RELATED_MAX);
  if (!names.length) return true;
  const q = await titleQuery(buildWikipediaTitlesUrl(names));
  if (!q) return false;
  const pages = names.map((t) => resolveTitle(q, t)).filter((p): p is WikipediaPage => !!p && !p.missing && p.title !== pool.article?.title);
  const items = pages.map((p) => p.pageprops?.wikibase_item || '').filter(Boolean);
  const { images, ok } = await itemImages(items);
  pool.related = pool.related || [];
  for (const page of pages) {
    if (BAD_DESCRIPTION.test(String(page.description || ''))) continue;
    const item = page.pageprops?.wikibase_item || '';
    const pick = item ? bestImage(images.get(item) || [], `${pool.lemma} ${page.title}`) : '';
    const file = pick ? commonsFileFromUrl(pick) : acceptConceptPage(page) ? String(page.pageimage) : '';
    if (!file) continue;
    const k = pool.related.length;
    pool.related.push({ title: page.title, description: page.description, extract: String(page.extract || '').slice(0, 240) });
    addPicture(pool, file, 'article', 2000 + k);
  }
  return ok;
}

/** English articles titled with a foreign word's short glosses ("猫" gives "Cat"). */
async function addGlossArticles(pool: PicturePool, hints: string[], step: (fill: () => Promise<boolean>) => Promise<void>): Promise<void> {
  const titles = Array.from(new Set(hints.map((h) => h.toLowerCase()).filter(Boolean))).slice(0, 3);
  if (!titles.length) return;
  await step(async () => {
    const q = await batchedTitleQuery('wikipedia-brief:en', (t) => buildWikipediaBriefTitlesUrl(t, 'en'), titles);
    if (!q) return false;
    titles.forEach((t) => {
      const page = resolveTitle(q, t);
      if (!page || !acceptConceptPage(page)) return;
      const k = pool.glossArticles.length;
      pool.glossArticles.push({ ...page, title: t });
      addPicture(pool, page.pageimage as string, 'article', 1000 + k);
    });
    return true;
  });
}

// ---------------------------------------------------------------- pool cache

/** Pools by word, in memory; `until` ends an empty or partial pool's life early. */
const poolCache = new Map<string, { p: Promise<PicturePool>; until: number; progress: Set<(pool: PicturePool) => void> }>();

function poolKey(lemma: string, lang: string): string {
  return `sense-images:${CACHE_VERSION}:pool:${String(lang || 'en').toLowerCase()}:${lemma.toLowerCase()}`;
}

/** A saved pool keeps two weeks when it found pictures and six hours when empty; one built while a request failed is not saved. */
function poolTtl(pool: PicturePool): number {
  if (pool.failed) return 0;
  return pool.pictures.some((p) => p.image) ? PERSIST_TTL_MS : EMPTY_TTL_MS;
}

/** What is saved: the pool without pictures that never got file details. */
function compactPool(pool: PicturePool): PicturePool {
  return { ...pool, pictures: pool.pictures.filter((p) => p.image) };
}

async function readPool(key: string): Promise<PicturePool | null> {
  const store = getLookupCache();
  if (!store) return null;
  try {
    const hit = await store.get(key);
    const pool = hit?.value as PicturePool | undefined;
    if (!pool || !Array.isArray(pool.pictures) || typeof hit?.savedAt !== 'number') return null;
    if (Date.now() - hit.savedAt > poolTtl(pool)) return null;
    return pool;
  } catch {
    return null;
  }
}

function writePool(key: string, pool: PicturePool): void {
  const store = getLookupCache();
  if (!store || !poolTtl(pool)) return;
  void Promise.resolve()
    .then(() => store.set(key, compactPool(pool), Date.now()))
    .catch((): undefined => undefined);
}

function getPool(lemma: string, lang: string, hints: string[], progress?: (pool: PicturePool) => void): Promise<PicturePool> {
  const key = poolKey(lemma, lang);
  const hit = poolCache.get(key);
  if (hit && Date.now() < hit.until) {
    if (progress) hit.progress.add(progress);
    return hit.p;
  }
  const listeners = new Set<(pool: PicturePool) => void>(progress ? [progress] : []);
  const entry = { p: Promise.resolve(null as unknown as PicturePool), until: Infinity, progress: listeners };
  entry.p = (async () => {
    const saved = await readPool(key);
    if (saved) {
      entry.until = Date.now() + Math.max(60_000, poolTtl(saved));
      return saved;
    }
    const pool = await buildPool(lemma, lang, hints, (partial) => {
      for (const fn of listeners) {
        try {
          fn(partial);
        } catch {
          /* a listener's error never stops the pool */
        }
      }
    });
    const life = pool.failed ? FAILED_MEMORY_MS : poolTtl(pool);
    entry.until = Date.now() + life;
    if (!life && poolCache.get(key) === entry) poolCache.delete(key);
    writePool(key, pool);
    return pool;
  })();
  if (poolCache.size > 300) poolCache.clear();
  poolCache.set(key, entry);
  return entry.p;
}

// ---------------------------------------------------------------- hidden pictures

/**
 * Hidden pictures of a word, as lower-case file names (hidden on every sense) or a file name and
 * a sense key joined by `HIDDEN_SEP` (hidden on that sense only).
 */
const hiddenCache = new Map<string, Set<string>>();
const HIDDEN_SEP = '\u0000';

/** A sense's key for hiding: its first content words, so a card's copy of the gloss matches the lookup's. */
function senseKey(gloss: string): string {
  return contentTokens(glossBody(gloss)).slice(0, 8).join(' ');
}

function hiddenEntry(file: string, sense?: string): string {
  const key = sense ? senseKey(sense) : '';
  return key ? `${file.toLowerCase()}${HIDDEN_SEP}${key}` : file.toLowerCase();
}

function isHidden(hidden: Set<string>, file: string, sense: string): boolean {
  if (!hidden.size) return false;
  return hidden.has(file.toLowerCase()) || hidden.has(hiddenEntry(file, sense));
}

function hiddenKey(lemma: string, lang: string): string {
  return `sense-images-hidden:${String(lang || 'en').toLowerCase()}:${lemma.toLowerCase()}`;
}

async function hiddenFor(lemma: string, lang: string): Promise<Set<string>> {
  const key = hiddenKey(lemma, lang);
  const hit = hiddenCache.get(key);
  if (hit) return hit;
  const set = new Set<string>();
  const store = getLookupCache();
  if (store) {
    try {
      const saved = await store.get(key);
      const list = saved?.value as Array<{ file: string; sense?: string; scope?: string }> | undefined;
      // Entries saved before pictures were hidden per sense have no scope and stay hidden on every sense.
      for (const h of Array.isArray(list) ? list : []) if (h?.file) set.add(hiddenEntry(String(h.file), h.scope === 'sense' ? h.sense : ''));
      // Written again once a session, so a store that prunes old files (the desktop's, after 15
      // days) keeps the list.
      if (set.size) void Promise.resolve(store.set(key, list, Date.now() + 350 * 86_400_000)).catch((): undefined => undefined);
    } catch {
      /* none */
    }
  }
  hiddenCache.set(key, set);
  return set;
}

/** The Commons file name of a picture, from its file page URL. */
function fileOfImage(img: Pick<SenseImage, 'pageUrl'>): string {
  const tail = String(img.pageUrl || '').split('/File:')[1] || '';
  try {
    return decodeURIComponent(tail).replace(/_/g, ' ');
  } catch {
    return tail.replace(/_/g, ' ');
  }
}

/**
 * Hides a picture the reader marked as wrong. With `sense` it never shows again on that sense of
 * the word (in a lookup or on a card saved with that sense); without, on any sense. Kept with the
 * platform's lookup cache (desktop: a file in userData; phone: localStorage) for a year.
 */
export async function hideSenseImage(
  lemma: string,
  img: Pick<SenseImage, 'pageUrl'>,
  opts?: { lang?: string; sense?: string },
): Promise<void> {
  await setHidden(lemma, img, opts, true);
}

/** Shows a picture hidden with `hideSenseImage` again (the Undo after hiding). */
export async function unhideSenseImage(
  lemma: string,
  img: Pick<SenseImage, 'pageUrl'>,
  opts?: { lang?: string; sense?: string },
): Promise<void> {
  await setHidden(lemma, img, opts, false);
}

async function setHidden(lemma: string, img: Pick<SenseImage, 'pageUrl'>, opts: { lang?: string; sense?: string } | undefined, hide: boolean): Promise<void> {
  const word = String(lemma || '').trim();
  const file = fileOfImage(img);
  if (!word || !file) return;
  const lang = String(opts?.lang || 'en');
  const sense = stripHtml(opts?.sense || '').slice(0, 160);
  const entry = hiddenEntry(file, sense);
  const set = await hiddenFor(word, lang);
  if (hide) set.add(entry);
  else set.delete(entry);
  const store = getLookupCache();
  if (!store) return;
  const key = hiddenKey(word, lang);
  type Entry = { file: string; sense?: string; scope?: string };
  let list: Entry[] = [];
  try {
    const saved = await store.get(key);
    if (Array.isArray(saved?.value)) list = saved?.value as Entry[];
  } catch {
    /* start a new list */
  }
  const same = (h: Entry) => hiddenEntry(String(h.file), h.scope === 'sense' ? h.sense : '') === entry;
  list = list.filter((h) => !same(h));
  if (hide) list.push(sense && senseKey(sense) ? { file, sense, scope: 'sense' } : { file });
  // A date in the future keeps the list well past the lookup cache's usual age.
  await Promise.resolve(store.set(key, list, Date.now() + 350 * 86_400_000)).catch((): undefined => undefined);
}

// ---------------------------------------------------------------- public API

/**
 * Starts gathering a word's pictures before its senses are known (a lookup calls this when the
 * word is submitted), so the pictures are ready when the definitions paint.
 */
export function prefetchSenseImages(lemma: string, opts?: { lang?: string }): void {
  const word = String(lemma || '').trim();
  if (!word) return;
  const lang = String(opts?.lang || 'en');
  if (!/^en/i.test(lang)) return;
  void getPool(word, lang, []).catch((): undefined => undefined);
}

/**
 * One picture per sense where a faithful one exists, aligned with `senses`, at most `max`
 * (default three, `SENSE_PICTURE_RULES.maxPictures`). Never rejects; a failed request means fewer pictures. `onUpdate` gets the
 * pictures found so far while slower sources still answer (not called when the pool is cached).
 */
export async function fetchSenseImages(
  lemma: string,
  senses: Array<{ meaning: string; partOfSpeech?: string; frequency?: number }>,
  opts?: {
    max?: number;
    lang?: string;
    onUpdate?: (list: Array<SenseImage | null>) => void;
  },
): Promise<Array<SenseImage | null>> {
  const word = String(lemma || '').trim();
  const list: SenseInput[] = (senses || []).map((s) => ({
    meaning: String(s?.meaning || ''),
    partOfSpeech: s?.partOfSpeech,
    frequency: typeof s?.frequency === 'number' ? s.frequency : undefined,
  }));
  if (!word || !list.length) return list.map((): null => null);
  const max = Math.max(0, Math.min(10, opts?.max ?? SENSE_PICTURE_RULES.maxPictures));
  if (!max) return list.map((): null => null);
  const lang = String(opts?.lang || 'en');
  const code = lang.toLowerCase().split(/[-_]/)[0] || 'en';
  const hints = code === 'en' ? [] : list.filter((s) => stripHtml(s.meaning)).slice(0, 3).map((s) => shortGlossTitle(s.meaning)).filter(Boolean);
  try {
    const hidden = await hiddenFor(word, lang);
    const update = opts?.onUpdate;
    let last = '';
    const progress = (partial: PicturePool) => {
      if (!update) return;
      const shown = assignPictures(partial, list, { max, hidden });
      const sig = shown.map((x) => (x ? x.pageUrl : '')).join('|');
      if (!shown.some(Boolean) || sig === last) return;
      last = sig;
      try {
        update(shown);
      } catch {
        /* a caller's error never stops the search */
      }
    };
    const pool = await getPool(word, lang, hints, progress);
    const usesWholeWord = !list.some((s) => stripHtml(s.meaning));
    if (usesWholeWord) {
      const out: Array<SenseImage | null> = list.map((): null => null);
      out[0] = wholeWordPicture(pool, hidden);
      return out;
    }
    return assignPictures(pool, list, { max, hidden });
  } catch {
    return list.map((): null => null);
  }
}

/**
 * One picture for a word (the notebook's card): the one its saved sense would show in a lookup,
 * or, without a saved sense, the best picture for the word as a whole. The part of speech is
 * used when the card knows it; otherwise any part of speech may match.
 */
export async function fetchWordImage(
  lemma: string,
  opts?: { lang?: string; gloss?: string; pos?: string; onUpdate?: (img: SenseImage | null) => void },
): Promise<SenseImage | null> {
  const gloss = String(opts?.gloss || '').trim();
  const update = opts?.onUpdate;
  const [img] = await fetchSenseImages(lemma, [{ meaning: gloss, partOfSpeech: opts?.pos || '' }], {
    max: 1,
    lang: opts?.lang,
    onUpdate: update ? (list) => update(list[0] || null) : undefined,
  });
  return img || null;
}

/** For tests: forget every cached request, pool and hidden list. */
export function clearSenseImageCache(): void {
  jsonCache.clear();
  infoCache.clear();
  poolCache.clear();
  hiddenCache.clear();
}
