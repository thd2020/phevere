/**
 * Pictures for dictionary senses.
 *
 * Every file comes from Wikimedia Commons, which hosts only freely licensed or public-domain
 * files; `pilicense=free` keeps Wikipedia's non-free lead images out. Each picture carries its
 * author, licence and file page for the credit line. No source needs a key.
 *
 * Which senses get a picture: the major ones, at most four (`majorSenses`). A word's entries
 * come first ("bank" of money, "bank" of a river; the Wiktionary page tells them apart by
 * etymology even when a lookup lists senses by part of speech), then each further part of
 * speech, then senses unlike the ones before them ("equilibrium" of a chemical reaction).
 *
 * Where pictures come from, in order:
 *
 * 1. Wiktionary's own sense images. Editors place `[[File:...|thumb|caption]]` in an entry and
 *    often tie the caption to a sense with `{{senseno|en|ID}}`, where the definition line carries
 *    `{{senseid|en|ID}}`. We match the caption (or the linked definition line) against our
 *    glosses by shared content words. Curated by lexicographers, so a match may illustrate any
 *    part of speech. Book covers and title pages from quotations are skipped.
 * 2. Wikipedia's lead image for concrete noun senses: the article titled with the lemma (or, for
 *    a foreign word, with its one-word English gloss), then a search for `lemma + gloss
 *    keywords`. A page counts only when its title is the lemma (optionally with a qualifier such
 *    as "Crane (bird)") and its short description or first sentences share words with the gloss.
 * 3. For a major sense still bare, the same search accepts an article whose title is the word
 *    and one more word ("Chemical equilibrium") when it fits the gloss closely; when that article
 *    has no free lead image, a picture used in it that names the word ("Diagram of a ball placed
 *    in a stable equilibrium").
 * 4. When the first sense is still bare, the best picture for the word as a whole:
 *    a. the Wikipedia article titled with the word, even an abstract one ("Justice", "Happiness");
 *    b. a Wiktionary picture on the word's own page whose caption names the word or a gloss word;
 *    c. the article titled with a derived noun ("inspect" gives "Inspection", "run" "Running",
 *       "beautiful" "Beauty", "ephemeral" "Ephemerality");
 *    d. any other caption-only Wiktionary picture on the page;
 *    e. a picture used in the word's article that names the word or a gloss word, such as the
 *       diagram "Lac Operon.svg" on "Operon", whose lead has no free image. When the title is a
 *       disambiguation page or names something else ("Holon" is a city), the article is the
 *       search hit titled with a qualifier whose description fits the gloss ("Holon (philosophy)").
 * 5. A stand-in for an abstract major sense: a picture of a word its gloss is made of, the way
 *    picture dictionaries show a related concrete thing. Only a short clause counts ("Mental
 *    balance." gives "balance", "…; at sea" gives "sea"); the article titled exactly with that
 *    word gives its lead picture, and Wiktionary's picture for the word is used when the whole
 *    gloss is that word and the file's own Commons record names it ("Balanced scales of justice").
 * 6. When the word still has no picture, a Commons search for it in file names, then anywhere in
 *    a file's record, ranked by shared gloss words. A hit must share a gloss word, and logos,
 *    maps, scans, book pages and portraits are refused.
 *
 * Relevance checks: a portrait of a named person (Commons categories such as "Portraits of …")
 * is never used for a word whose gloss is not about people; works, places, companies and
 * disambiguation pages are never the article for a sense; logos, maps, flags and scans are
 * refused wherever a picture is borrowed rather than matched.
 *
 * Speed: requests go out at most three at a time with an identifying User-Agent, as Wikimedia's
 * rate limits ask. Title and file-info queries asked within a few milliseconds of each other (a
 * screen of cards, the senses of one lookup) share one request of up to 50 titles. Steps that do
 * not depend on each other start together, and `onUpdate` hands a lookup its first pictures
 * while later steps run. Thumbnails are Commons' 330 px standard step, which its servers keep
 * ready. Results are kept in memory and in the platform's persistent lookup cache; a result
 * computed while a request failed is not cached, and a result with no picture is kept for six
 * hours only, so a word that got nothing is tried again.
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
// v4: a picture for each major sense (v3 gave one picture to most words), so v3 results are redone.
const CACHE_VERSION = 'v4';
const PERSIST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** A result with no picture at all is kept this long, so a word saved earlier is tried again. */
const EMPTY_TTL_MS = 6 * 60 * 60 * 1000;
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
    'british american dated rare figuratively figurative literally'
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
    'fortune opportunity success failure movement motion lack absence presence existence knowledge skill'
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
  /** Text of the definition line a `{{senseno}}` in the caption points to. */
  senseText: string;
  pos: string;
  etymology: number;
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
  const images: Array<WiktionaryImage & { senseId: string }> = [];
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
      images.push({ file, caption, senseText: '', pos, etymology, senseId: senseNo ? senseNo[1].toLowerCase() : '' });
    }
  }
  // Sense ids may be defined below the picture, so resolve them after the pass. A linked
  // definition line also says which part of speech the picture belongs to.
  return images.map(({ senseId, ...img }) => {
    const linked = senseId ? senseLines.get(senseId) : undefined;
    return linked ? { ...img, senseText: linked.text, pos: linked.pos || img.pos } : img;
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
  pageprops?: { disambiguation?: string };
}

const WIKI_PAGE_PROPS =
  `prop=pageimages|pageprops|description|extracts&piprop=name|thumbnail&pithumbsize=${THUMB_WIDTH}` +
  '&pilicense=free&ppprop=disambiguation&exintro=1&explaintext=1&exsentences=2&exlimit=max';

/** Article whose title is exactly `title` (redirects followed). */
export function buildWikipediaTitleUrl(title: string, lang = 'en'): string {
  return (
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&${WIKI_PAGE_PROPS}&titles=${encodeURIComponent(title)}&origin=*`
  );
}

/**
 * The search text for a sense: the lemma, the gloss's first content word (usually its head,
 * "bird" in "Any bird of the family Gruidae") and the longest of its next five content words.
 * Abstract heads are skipped: "the state of a body at rest" searches "body" and "resultant".
 */
export function buildSenseSearchQuery(lemma: string, gloss: string): string {
  // Abstract heads ("the state of a body at rest") name no topic, so the search skips them.
  const all = contentTokens(glossBody(gloss), lemma);
  const concrete = all.filter((t) => !ABSTRACT_HEADS.has(t));
  const words = concrete.length ? concrete : all;
  const raw = stripHtml(glossBody(gloss)).toLowerCase().match(/\p{L}[\p{L}-]*/gu) || [];
  const byStem = new Map<string, string>();
  for (const w of raw) {
    const s = stem(w);
    if (!byStem.has(s)) byStem.set(s, w);
  }
  const surface = words.map((s) => byStem.get(s) || s);
  const picked = surface.slice(0, 1);
  const longest = surface.slice(1, 6).sort((a, b) => b.length - a.length)[0];
  if (longest) picked.push(longest);
  return [lemma.trim(), ...picked].join(' ').trim();
}

export function buildWikipediaSearchUrl(query: string, lang = 'en'): string {
  return (
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&gsrnamespace=0&${WIKI_PAGE_PROPS}&origin=*`
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
  return overlap(g, d) >= minD || overlap(g, e) >= minE;
}

/** First page (by search rank) that passes `acceptWikipediaPage`. */
export function pickWikipediaPage(
  pages: WikipediaPage[],
  word: string,
  gloss: string,
  lemma: string,
  opts: { exactGloss?: boolean; strict?: boolean } = {},
): WikipediaPage | null {
  const ordered = [...(pages || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.find((p) => acceptWikipediaPage(p, word, gloss, lemma, opts)) || null;
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

/** Commons categories that mark a logo, map, chart or scan rather than a photo or illustration. */
const BAD_CATEGORY =
  /\b(logos?|text logos|maps?|flags?|coats? of arms|diagrams?|charts?|graphs?|plots?|screenshots?|signatures?|seals?|icons?|album covers?|book covers?|scans?|documents?)\b/i;

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

function ingForm(w: string): string {
  if (w.endsWith('ie')) return `${w.slice(0, -2)}ying`;
  if (w.endsWith('e') && !/(ee|ye|oe)$/.test(w)) return `${w.slice(0, -1)}ing`;
  // One short syllable ending vowel + consonant doubles it: run, swim, stop.
  if (/^[^aeiou]*[aeiou][bdfgklmnprtvz]$/.test(w)) return `${w}${w.slice(-1)}ing`;
  return `${w}ing`;
}

/**
 * Article titles that name an English word's concept, best first: the word, then nouns derived
 * from it ("inspect" gives "Inspection", "run" "Running", "beautiful" "Beauty", "ephemeral"
 * "Ephemerality", "happy" "Happiness"). Titles that do not exist cost nothing in one batched query.
 */
export function derivedTitles(lemma: string): string[] {
  const word = String(lemma || '').trim();
  const w = word.toLowerCase();
  if (!w) return [];
  if (!/^[a-z][a-z-]*$/.test(w) || w.length < 3) return [word];
  const noE = w.endsWith('e') && !w.endsWith('ee') ? w.slice(0, -1) : w;
  const out = [w];
  if (/iful$/.test(w)) out.push(w.replace(/iful$/, 'y'));
  else if (/ful$/.test(w)) out.push(w.replace(/ful$/, ''));
  if (/[^aeiou]y$/.test(w)) out.push(`${w.slice(0, -1)}iness`);
  if (/ble$/.test(w)) out.push(w.replace(/ble$/, 'bility'));
  else if (/(al|ar|ic|id|ile|ive|ure|ine)$/.test(w)) out.push(`${noE}ity`);
  if (/ent$/.test(w)) out.push(w.replace(/ent$/, 'ence'));
  if (/ant$/.test(w)) out.push(w.replace(/ant$/, 'ance'));
  out.push(ingForm(w), `${noE}ion`, `${noE}ation`, `${w}ment`, `${w}ness`);
  return Array.from(new Set(out)).slice(0, 10);
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

export interface FallbackTitles {
  url: string;
  titles: string[];
  /** How many leading titles name the word itself (the rest are derived nouns). */
  exact: number;
}

/**
 * The fallback's title query. It needs no extracts (only lead images, descriptions and
 * disambiguation marks), so up to 50 titles fit one request and the cards on screen share it.
 */
function fallbackTitles(req: FallbackTitles): Promise<TitleQuery | null> {
  const lang = titleQueryLang(req);
  return batchedTitleQuery(`wikipedia-brief:${lang}`, (t) => buildWikipediaBriefTitlesUrl(t, lang), req.titles);
}

/** The Wikipedia language a fallback title query asks. */
function titleQueryLang(req: FallbackTitles): string {
  const m = req.url.match(/^https:\/\/([a-z-]+)\.wikipedia\.org\//);
  return m ? m[1] : 'en';
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

export interface WordArticle {
  page: WikipediaPage | null;
  /**
   * The word's own title names something else (a city, a film, a person), so a file named after
   * the word is no evidence; Commons hits must share a gloss word.
   */
  ambiguous: boolean;
}

/**
 * The article about the word: the page titled with it when that page is about a concept, or,
 * when the title is missing, a disambiguation page or a place, person or work ("Holon" is a city),
 * the search hit titled with the word plus a qualifier whose description fits the first gloss
 * ("Holon (philosophy)").
 */
export function pickWordArticle(
  q: TitleQuery | null,
  req: FallbackTitles,
  search: WikipediaPage[] | null,
  lemma: string,
  senses: SenseInput[],
): WordArticle {
  const state = wordTitleState(q, req);
  if (state.usable) return { page: state.exact as WikipediaPage, ambiguous: false };
  const first = senses.find((s) => stripHtml(s.meaning));
  const ordered = [...(search || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const page = first ? ordered.find((p) => pageFitsGloss(p, lemma, first.meaning, lemma)) || null : null;
  return { page, ambiguous: state.ambiguous };
}

/** The page titled with the word: usable as its article, or missing, or about something else. */
function wordTitleState(q: TitleQuery | null, req: FallbackTitles): { exact?: WikipediaPage; usable: boolean; ambiguous: boolean } {
  const exact = q ? resolveTitle(q, req.titles[0]) : undefined;
  if (!exact || exact.missing) return { exact, usable: false, ambiguous: false };
  const disambiguation = exact.pageprops?.disambiguation !== undefined || /disambiguation/i.test(exact.title);
  const elsewhere =
    BAD_DESCRIPTION.test(String(exact.description || '')) || BAD_DESCRIPTION.test(titleParts(exact.title).qualifier);
  // A disambiguation page only says the word has several meanings ("Afloat", "Apparatus"); a
  // title about a place, work or person ("Holon" the city) is what makes Commons hits suspect.
  return { exact, usable: !disambiguation && !elsewhere, ambiguous: elsewhere };
}

/**
 * The one `titles=` query of the fallback. English: the word and its derived nouns on English
 * Wikipedia. Another language: the short English glosses of its first senses ("猫" gives "Cat"),
 * or, when no gloss is short enough, the word itself on its own language's Wikipedia.
 */
export function fallbackTitleQuery(lemma: string, senses: SenseInput[], lang: string): FallbackTitles | null {
  const code = String(lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  if (code === 'en') {
    const titles = derivedTitles(lemma);
    return titles.length ? { url: buildWikipediaTitleUrl(titles.join('|')), titles, exact: 1 } : null;
  }
  const glossTitles = Array.from(
    new Set(
      senses
        .filter((s) => stripHtml(s.meaning))
        .slice(0, 3)
        .map((s) => shortGlossTitle(s.meaning).toLowerCase())
        .filter(Boolean),
    ),
  );
  if (glossTitles.length) return { url: buildWikipediaTitleUrl(glossTitles.join('|')), titles: glossTitles, exact: glossTitles.length };
  if (!/^[a-z]{2,3}$/.test(code) || !lemma.trim()) return null;
  return { url: buildWikipediaTitleUrl(lemma.trim(), code), titles: [lemma.trim()], exact: 1 };
}

/** Usable concept articles in request order, each marked as naming the word itself or a derived noun. */
export function rankConceptPages(q: TitleQuery | null, req: FallbackTitles): Array<{ page: WikipediaPage; exact: boolean }> {
  if (!q) return [];
  const out: Array<{ page: WikipediaPage; exact: boolean }> = [];
  const seen = new Set<string>();
  req.titles.forEach((t, i) => {
    const page = resolveTitle(q, t);
    if (!page || seen.has(page.title) || !acceptConceptPage(page)) return;
    seen.add(page.title);
    out.push({ page, exact: i < req.exact });
  });
  return out;
}

function glossUnion(senses: SenseInput[], lemma: string): string[] {
  const out: string[] = [];
  for (const s of senses.filter((x) => stripHtml(x.meaning)).slice(0, 3)) {
    for (const t of contentTokens(glossBody(s.meaning), lemma)) if (!out.includes(t)) out.push(t);
  }
  return out;
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

/**
 * Caption-only Wiktionary pictures on the word's page that no sense claimed, best first. A
 * picture tied to a definition line by `{{senseno}}` belongs to a sense we do not show, so it
 * is left out. `strong` means the caption names the word or shares a gloss word.
 */
export function rankWiktionaryFallback(
  images: WiktionaryImage[],
  senses: SenseInput[],
  lemma: string,
): Array<{ image: WiktionaryImage; strong: boolean }> {
  const posSet = new Set(senses.map((s) => canonicalSensePos(s.partOfSpeech)).filter(Boolean));
  const gloss = glossUnion(senses, lemma);
  return images
    .map((image, i) => {
      if (image.senseText) return null;
      if (image.pos && posSet.size && !posSet.has(image.pos)) return null;
      const score = (mentionsWord(image.caption, lemma) ? 1 : 0) + overlap(contentTokens(image.caption, lemma), gloss);
      return { image, score, i };
    })
    .filter((x): x is { image: WiktionaryImage; score: number; i: number } => !!x)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ image, score }) => ({ image, strong: score > 0 }));
}

/**
 * A Commons file search, photos and drawings (SVG diagrams) alike. A one-word query must be in
 * the file name: a full-text search for "arbitrage" returns US Navy repair ships coded "ARB".
 */
export function buildCommonsSearchUrl(query: string, opts: { fullText?: boolean } = {}): string {
  const q = String(query || '').trim();
  const text = !opts.fullText && /^[\p{L}'-]+$/u.test(q) ? `intitle:${q}` : q;
  return (
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2' +
    `&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(`${text} filetype:bitmap|drawing`)}` +
    `&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=${THUMB_WIDTH}` +
    '&iiextmetadatafilter=Artist|LicenseShortName|ImageDescription|Categories&iiextmetadatalanguage=en&origin=*'
  );
}

/** The Commons search text: the English word, or a foreign word's short English gloss. */
export function commonsSearchQuery(lemma: string, senses: SenseInput[], lang: string): string {
  const code = String(lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  const word = String(lemma || '').trim();
  if (code === 'en') return word;
  const first = senses.find((s) => stripHtml(s.meaning));
  if (!first) return word;
  const short = shortGlossTitle(first.meaning);
  if (short) return short.toLowerCase();
  const raw = stripHtml(glossBody(first.meaning)).toLowerCase().match(/\p{L}[\p{L}-]*/gu) || [];
  const picked = raw.filter((w) => w.length >= 3 && !STOP.has(w)).slice(0, 3);
  return picked.length ? picked.join(' ') : word;
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

/**
 * Whether a short file title is about `word`: it is one of the first three words of a title of
 * six words at most ("Mallard Afloat", "Afloat at Dartmouth"), not a passing mention in a long
 * caption ("Tower lodge, once quite famous because of its, albeit tenuous, …") or part of a
 * compound name ("Adamant-1-yl phosphaethine").
 */
export function titledWith(title: string, word: string): boolean {
  const w = String(word || '').toLowerCase();
  const tokens = String(title || '').split(/\s+/).map((t) => t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').toLowerCase()).filter(Boolean);
  if (!tokens.length || tokens.length > 6) return false;
  return tokens.slice(0, 3).some((t) => t === w || (!t.includes('-') && stem(t) === stem(w)));
}

/** Whether `word` sits in `title` as part of a capitalised name ("Serendipity Beach"). */
export function properName(title: string, word: string): boolean {
  const w = String(word || '').toLowerCase();
  const tokens = String(title || '').split(/[\s,.;:()]+/).filter(Boolean);
  const isCap = (t: string | undefined) => !!t && /^\p{Lu}/u.test(t) && !STOP.has(t.toLowerCase());
  // "… school in Holon": a capitalised word after "in", "at" or "near" is a place.
  const place = (i: number) => i > 0 && /^\p{Lu}/u.test(tokens[i]) && /^(in|at|near|from)$/.test(tokens[i - 1]);
  // A capitalised word before it counts too ("EAH Blunt" is a man), unless the word itself is in
  // lower case after a title's first word ("Static equilibrium").
  const capAfterCap = (i: number) => i > 0 && isCap(tokens[i - 1]) && /^\p{Lu}/u.test(tokens[i]);
  return tokens.some((t, i) => t.toLowerCase() === w && (isCap(tokens[i + 1]) || capAfterCap(i) || place(i)));
}

export interface CommonsPage {
  title: string;
  index?: number;
  imageinfo?: ImageInfo[];
}

/**
 * Commons search hits ranked for a word: two points per gloss word shared with the file's
 * name, description and categories, two when the name contains the search word, up to one for
 * search rank; five off for a logo, map, chart or scan, four off for a portrait of a named
 * person. Files that are not images, and hits that name neither the search word nor a gloss
 * word, are dropped; every other hit stays, so a search with any fitting hit yields a picture.
 * `needGloss` (the word also names a city, a film or a person) drops hits sharing no gloss word.
 */
export function rankCommonsFiles(
  pages: CommonsPage[],
  query: string,
  lemma: string,
  gloss: string[],
  opts: { needGloss?: boolean } = {},
): Array<{ file: string; title: string; info: ImageInfo; score: number }> {
  const list = [...(pages || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const n = list.length || 1;
  const words = String(query || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  return list
    .map((p, i) => {
      const info = p.imageinfo?.[0];
      if (!info || !info.thumburl || (info.mime && !/^image\/(jpeg|png|gif|webp|tiff|svg)/.test(info.mime))) return null;
      const file = p.title.replace(/^File:/i, '');
      const name = commonsFileTitle(file);
      const meta = info.extmetadata || {};
      const description = stripHtml(meta.ImageDescription?.value || '').slice(0, 400);
      const categories = stripHtml(meta.Categories?.value || '');
      const tokens = contentTokens(`${name} ${description} ${categories.replace(/\|/g, ' ')}`, lemma);
      const shared = nearOverlap(gloss, tokens);
      const inName = words.some((w) => sharesWord(name, w));
      // A hit that names neither the search word nor a gloss word matched on something else.
      if (!shared && !inName && !words.some((w) => sharesWord(`${description} ${categories}`, w))) return null;
      if (opts.needGloss && !shared) return null;
      // Without a gloss word, the word must name what the file shows, not a place, band or boat
      // called by it: "Serendipity Beach", "Serendipity Singers".
      if (!shared && (properName(name, lemma) || !titledWith(name, lemma))) return null;
      let score = shared * 2 + (1 - i / n);
      if (inName) score += 2;
      if (badMatch(BAD_FILE, name, lemma) || badMatch(BAD_CATEGORY, categories, lemma)) score -= 5;
      if (PERSON_CATEGORY.test(categories)) score -= 4;
      return { file, title: name, info, score };
    })
    .filter((x): x is { file: string; title: string; info: ImageInfo; score: number } => !!x)
    .sort((a, b) => b.score - a.score);
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
  const section = wiktionaryLanguageSection(wikitext, lang);
  if (!section || !/^={3,}\s*Etymology\s+2\s*=+/im.test(section)) return senses.map(() => 0);
  const lines: Array<{ ety: number; tokens: string[] }> = [];
  let ety = 0;
  for (const line of section.split('\n')) {
    const h = line.match(/^={3,}\s*Etymology(?:\s+(\d+))?\s*=+\s*$/i);
    if (h) {
      ety = Number(h[1] || 1);
      continue;
    }
    if (ety && /^#\s*[^:*#\s]/.test(line)) lines.push({ ety, tokens: contentTokens(wikiToText(line.replace(/^#+\s*/, '')), lemma) });
  }
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

/** `majorSenses(...).order`. */
export function majorSenseIndexes(senses: SenseInput[], lemma: string, max = 4): number[] {
  return majorSenses(senses, lemma, max).order;
}

/**
 * Whether a Wikipedia article titled with the word, or naming it ("Chemical equilibrium",
 * "Bank (geography)"), is about this sense: a usable lead image, no disambiguation page, person,
 * work or place, and enough words shared with the gloss in its description, qualifier and first
 * sentences. A title that only contains the word, or a later sense, needs more shared words.
 */
export function acceptSenseArticle(
  page: WikipediaPage,
  lemma: string,
  gloss: string,
  opts: { strict?: boolean; anyImage?: boolean } = {},
): boolean {
  if (!page || page.missing) return false;
  if (!opts.anyImage && !acceptConceptPage(page)) return false;
  if (page.pageprops?.disambiguation !== undefined || /disambiguation/i.test(page.title)) return false;
  if (BAD_DESCRIPTION.test(String(page.description || '')) || BAD_DESCRIPTION.test(titleParts(page.title).qualifier)) return false;
  const { base, qualifier } = titleParts(page.title);
  const exact = sameWord(base, lemma);
  // "Chemical equilibrium" names the sense; "Cow–calf operation" names something else.
  const extra = base.split(/[\s–-]+/).filter((w) => w && !sameWord(w, lemma)).length;
  if (!exact && (!sharesWord(base, lemma) || extra > 1)) return false;
  const g = contentTokens(glossBody(gloss), lemma);
  const d = contentTokens(`${page.description || ''} ${qualifier} ${exact ? '' : base}`, lemma);
  const e = contentTokens(String(page.extract || ''), lemma);
  const od = overlap(g, d);
  const oe = overlap(g, e);
  if (exact && !opts.strict) return od >= 1 || oe >= 2;
  return od >= 2 || (od >= 1 && oe >= 2) || oe >= 3;
}

// ---------------------------------------------------------------- stand-in words

/** Two stems are the same word when one starts the other ("balanc" and "balance"). */
function nearWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  // Five letters at least: "part" must not match "particle".
  return s.length >= 5 && l.startsWith(s) && l.length - s.length <= 3;
}

function nearOverlap(a: string[], b: string[]): number {
  return a.filter((x) => b.some((y) => nearWord(x, y))).length;
}

export interface StandIns {
  /** Words whose picture may stand in for the sense, best first. */
  words: string[];
  /** The whole gloss is such words ("Mental balance.", "Floating."), not a description. */
  whole: boolean;
}

/**
 * Words of a gloss whose picture can stand in for an abstract sense. Only short clauses count,
 * the ones that name the meaning with a word or two: "Mental balance." gives "balance", the
 * clause "at sea" in "In a vessel at sea or on another body of water; at sea" gives "sea". A
 * longer clause describes the sense, and its words are arguments, not the meaning ("system" in
 * "the condition of a system in which competing influences are balanced"). Inside a clause the
 * words Wiktionary links come first, then its other content words; abstract heads ("state",
 * "act", "quality") and the word itself are left out.
 */
export function standInWords(meaning: string, lemma: string, limit = 4): StandIns {
  const out: string[] = [];
  const add = (raw: string, linked: boolean) => {
    const w = String(raw || '').replace(/_/g, ' ').replace(/#.*$/, '').trim();
    // An unlinked verb form ("turning", "balanced") is skipped: "Turning" on Wikipedia is
    // machining. A link names its base word ("floating" links to "float").
    if (!linked && /^[a-z]+(ing|ed)$/i.test(w)) return;
    if (!w || w.length < 3 || /[:/]/.test(w) || out.some((x) => x.toLowerCase() === w.toLowerCase())) return;
    const words = w.toLowerCase().split(/\s+/);
    if (words.length > 3 || words.every((x) => STOP.has(x))) return;
    if (words.length === 1 && (STOP.has(words[0]) || ABSTRACT_HEADS.has(stem(words[0])))) return;
    if (sameWord(w, lemma)) return;
    out.push(w);
  };
  // The first sentence only: "Someone who is beautiful. Can be used as a term of address." is a
  // usage note after the meaning.
  const html = String(meaning || '').replace(/&[a-z0-9#]+;/gi, ' ').split(/\.\s+(?=[A-Z<])/)[0];
  const clauses = html.split(';').filter((c) => stripHtml(c));
  let short = 0;
  for (const clause of clauses) {
    const words = contentTokens(glossBody(clause), lemma).filter((t) => !ABSTRACT_HEADS.has(t));
    if (!words.length || words.length > 2) continue;
    short += 1;
    for (const m of clause.matchAll(/<a\b([^>]*)>/gi)) {
      const title = m[1].match(/\btitle="([^"]*)"/i);
      const href = m[1].match(/\bhref="\/wiki\/([^"]*)"/i);
      let target = title ? title[1] : href ? href[1] : '';
      try {
        target = decodeURIComponent(target);
      } catch {
        /* keep as is */
      }
      add(stripHtml(target), true);
    }
    for (const w of stripHtml(glossBody(stripHtml(clause))).toLowerCase().match(/\p{L}[\p{L}-]*/gu) || []) {
      if (w.length >= 3 && !/ly$/.test(w)) add(w, false);
    }
  }
  return { words: out.slice(0, limit), whole: short > 0 && short === clauses.length };
}

/** Lead pictures of Wiktionary entries, many titles in one request (Wiktionary runs PageImages too). */
export function buildWiktionaryPageImagesUrl(titles: string[]): string {
  return (
    'https://en.wiktionary.org/w/api.php?action=query&format=json&formatversion=2&redirects=1' +
    `&prop=pageimages&piprop=name&pilicense=free&pilimit=50&titles=${encodeURIComponent(titles.join('|'))}&origin=*`
  );
}

/** Wikipedia articles for many titles at once, without extracts (TextExtracts serves 20 at most). */
export function buildWikipediaBriefTitlesUrl(titles: string[], lang = 'en'): string {
  return (
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=pageimages|pageprops|description&piprop=name|thumbnail&pithumbsize=${THUMB_WIDTH}&pilicense=free&pilimit=50` +
    `&ppprop=disambiguation&titles=${encodeURIComponent(titles.join('|'))}&origin=*`
  );
}

/** Categories that make a file no picture of a thing; icons and diagrams are fine here ("Scale icons"). */
const RECORD_BAD_CATEGORY =
  /\b(logos?|text logos|maps?|locator maps|flags?|coats? of arms|screenshots?|signatures?|seals?|album covers?|book covers?|scans?|documents?|texts?|manuscripts?|title pages?)\b/i;

/** Printed matter and insignia: magazine pages, postcards' address sides, emblems and badges. */
const PRINT_CATEGORY = /\b(billboard|magazines?|newspapers?|emblems?|badges?|insignia|postmarks?|address sides?|stamps of|banknotes?|coins of|posters?)\b/i;

/** "One who …", "a person …": a gloss about people, where a portrait is the right picture. */
const PERSON_GLOSS = /\b(one who|someone|somebody|person|people|man|woman|men|women|child|children|boy|girl|individual|expert|master|player|worker|follower|member)\b/i;

/**
 * How much a file's Commons record must show before its picture is used. `portrait`: it is not
 * a portrait of a named person, unless the gloss is about people (Wikipedia and Commons matches
 * of the word itself). `clean`: also no logo, map, flag, scan or document (the lead picture of
 * the article on a stand-in word). `named`: also its name, description or categories name the
 * stand-in word, a gloss word or the word itself (Wiktionary's picture for a stand-in word).
 */
export type RecordCheck = 'portrait' | 'clean' | 'named';

export function verifyPictureRecord(
  file: string,
  info: ImageInfo | undefined,
  opts: { word?: string; gloss: string[]; lemma: string; personGloss?: boolean; level: RecordCheck },
): boolean {
  if (!info) return false;
  const meta = info.extmetadata || {};
  const name = commonsFileTitle(file);
  const categories = stripHtml(meta.Categories?.value || '');
  const description = stripHtml(meta.ImageDescription?.value || '').slice(0, 400);
  if (!opts.personGloss && PERSON_CATEGORY.test(categories)) return false;
  if (opts.level === 'portrait') return true;
  if (badMatch(BAD_FILE, name, opts.lemma) || badMatch(RECORD_BAD_CATEGORY, categories, opts.word || opts.lemma)) return false;
  if (opts.level === 'clean') return true;
  const tokens = contentTokens(`${name} ${description} ${categories.replace(/\|/g, ' ')}`);
  const wanted = [...contentTokens(opts.word || ''), ...opts.gloss, ...contentTokens(opts.lemma)];
  return nearOverlap(wanted, tokens) > 0;
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

/** The same page asks for "at most 3 concurrent requests"; a notebook of cards asks for dozens at once. */
const MAX_IN_FLIGHT = 3;
const RETRY_MS = 1500;
let inFlight = 0;
const waiting: Array<() => void> = [];

async function throttled<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight += 1;
  try {
    return await run();
  } finally {
    inFlight -= 1;
    waiting.shift()?.();
  }
}

/** Failed requests so far; a result computed while one failed is not cached (see `fetchSenseImages`). */
let failures = 0;

const jsonCache = new Map<string, Promise<unknown>>();

function getJson<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T | null> {
  const hit = jsonCache.get(url);
  if (hit) return hit as Promise<T | null>;
  const { http, headers } = client();
  const once = () => throttled(() => http.requestJson<T>(url, { headers, timeoutMs }));
  const p = once()
    .catch(async (err: unknown) => {
      // Rate limited or overloaded: one more try after a pause.
      if (!/\b(429|503)\b/.test(String((err as Error)?.message || err))) throw err;
      await new Promise((r) => setTimeout(r, RETRY_MS));
      return once();
    })
    .catch((): null => {
      failures += 1;
      jsonCache.delete(url);
      return null;
    });
  if (jsonCache.size > 300) jsonCache.clear();
  jsonCache.set(url, p);
  return p;
}

/** Wiktionary pages asked for together (a screen of cards) come in one request, four at most. */
const WIKTIONARY_BATCH = 4;

async function wiktionaryPage(lemma: string): Promise<string> {
  const q = await batchedTitleQuery(
    'wiktionary-page',
    (titles) => buildWiktionaryUrl(titles.join('|')),
    [lemma],
    WIKTIONARY_BATCH,
    WIKTIONARY_TIMEOUT_MS,
  );
  const page = q ? (resolveTitle(q, lemma) as { revisions?: Array<{ slots?: { main?: { content?: string } } }> } | undefined) : undefined;
  return page?.revisions?.[0]?.slots?.main?.content || '';
}

async function wikipediaPages(url: string): Promise<WikipediaPage[]> {
  const res = await getJson<{ query?: { pages?: WikipediaPage[] } }>(url);
  return res?.query?.pages || [];
}

async function titleQuery(url: string): Promise<TitleQuery | null> {
  const res = await getJson<{ query?: TitleQuery }>(url);
  return res?.query || null;
}

async function articleImageFiles(title: string, lang: string): Promise<string[]> {
  const res = await getJson<{ query?: { pages?: Array<{ images?: Array<{ title: string }> }> } }>(
    buildArticleImagesUrl(title, lang),
  );
  return (res?.query?.pages?.[0]?.images || []).map((i) => i.title);
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

async function commonsSearch(query: string, opts: { fullText?: boolean } = {}): Promise<CommonsPage[]> {
  if (!query.trim()) return [];
  const res = await getJson<{ query?: { pages?: CommonsPage[] } }>(buildCommonsSearchUrl(query, opts));
  return res?.query?.pages || [];
}

/**
 * Title queries asked within a few milliseconds of each other (the cards on screen, the senses
 * of one lookup) go out as one request of up to 50 titles. Each caller gets the whole answer and
 * reads its own titles from it with `resolveTitle`.
 */
const BATCH_WINDOW_MS = 12;
const BATCH_MAX = 50;
interface TitleBatch {
  titles: string[];
  waiters: Array<(q: TitleQuery | null) => void>;
  timer: ReturnType<typeof setTimeout> | null;
}
const titleBatches = new Map<string, TitleBatch>();

function flushBatch(kind: string, build: (titles: string[]) => string, timeoutMs = TIMEOUT_MS): void {
  const batch = titleBatches.get(kind);
  if (!batch) return;
  titleBatches.delete(kind);
  if (batch.timer) clearTimeout(batch.timer);
  void getJson<{ query?: TitleQuery }>(build(batch.titles), timeoutMs).then((res) => {
    for (const w of batch.waiters) w(res?.query || null);
  });
}

function batchedTitleQuery(
  kind: string,
  build: (titles: string[]) => string,
  titles: string[],
  max = BATCH_MAX,
  timeoutMs = TIMEOUT_MS,
): Promise<TitleQuery | null> {
  const wanted = Array.from(new Set(titles.filter(Boolean)));
  if (!wanted.length) return Promise.resolve(null);
  if (wanted.length > max) return getJson<{ query?: TitleQuery }>(build(wanted.slice(0, max)), timeoutMs).then((r) => r?.query || null);
  const open = titleBatches.get(kind);
  if (open && new Set([...open.titles, ...wanted]).size > max) flushBatch(kind, build, timeoutMs);
  let batch = titleBatches.get(kind);
  if (!batch) {
    batch = { titles: [], waiters: [], timer: null };
    titleBatches.set(kind, batch);
    batch.timer = setTimeout(() => flushBatch(kind, build, timeoutMs), BATCH_WINDOW_MS);
  }
  for (const t of wanted) if (!batch.titles.includes(t)) batch.titles.push(t);
  const b = batch;
  return new Promise((resolve) => b.waiters.push(resolve));
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
    pages?: Array<{ title: string; missing?: boolean; imageinfo?: ImageInfo[] }>;
  } | null;
  const res = { query: q || undefined };
  for (const p of res?.query?.pages || []) {
    if (p.missing || !p.imageinfo?.[0]) continue;
    const key = p.title.replace(/^File:/, '').toLowerCase();
    out.set(key, p.imageinfo[0]);
    if (infoCache.size > 600) infoCache.clear();
    infoCache.set(key, p.imageinfo[0]);
  }
  return out;
}

function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** In-memory results; `until` is set once a result with no picture lands. */
const resultCache = new Map<string, { p: Promise<Array<SenseImage | null>>; until: number }>();

async function readPersisted(key: string): Promise<Array<SenseImage | null> | null> {
  const store = getLookupCache();
  if (!store) return null;
  try {
    const hit = await store.get(key);
    if (!hit || !Array.isArray(hit.value)) return null;
    const ttl = hit.value.some(Boolean) ? PERSIST_TTL_MS : EMPTY_TTL_MS;
    if (Date.now() - hit.savedAt > ttl) return null;
    return hit.value as Array<SenseImage | null>;
  } catch {
    return null;
  }
}

function writePersisted(key: string, value: Array<SenseImage | null>): void {
  const store = getLookupCache();
  if (!store) return;
  void Promise.resolve()
    .then(() => store.set(key, value, Date.now()))
    .catch((): undefined => undefined);
}

// ---------------------------------------------------------------- public API

interface Pick {
  file: string;
  title: string;
  /** Check the file's Commons record before showing it (anything not curated by Wiktionary). */
  check?: { word?: string; level: RecordCheck };
}

/** File info for picks, in one call; a pick whose record fails `verifyPictureRecord` is dropped. */
async function pickImages(
  picks: Array<Pick | null>,
  senses: SenseInput[],
  lemma: string,
): Promise<Array<SenseImage | null>> {
  const files = picks.filter(Boolean).map((p) => (p as Pick).file);
  if (!files.length) return picks.map((): null => null);
  const infos = await imageInfos(files);
  return picks.map((p, i) => {
    if (!p) return null;
    const info = infos.get(p.file.toLowerCase());
    if (p.check) {
      const meaning = senses[i]?.meaning || '';
      const ok = verifyPictureRecord(p.file, info, {
        word: p.check.word,
        gloss: contentTokens(glossBody(meaning), lemma),
        lemma,
        personGloss: PERSON_GLOSS.test(stripHtml(meaning)),
        level: p.check.level,
      });
      if (!ok) return null;
    }
    return imageFromInfo(p.file, p.title, info);
  });
}

async function resolveSenseImages(
  lemma: string,
  senses: SenseInput[],
  max: number,
  lang: string,
  emit: (list: Array<SenseImage | null>) => void = () => undefined,
): Promise<Array<SenseImage | null>> {
  const picks: Array<Pick | null> = senses.map((): null => null);
  const code = String(lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  const isEnglish = code === 'en';

  // Wiktionary's own pictures come first; ask for the page before anything else.
  const wiktTextP = wiktionaryPage(lemma);

  // The noun senses Wikipedia may illustrate: concrete ones among the first three nouns.
  const concrete = senses.map((s) => isConcreteNounSense(s, lemma));
  const nounIdx = senses
    .map((s, i) => (canonicalSensePos(s.partOfSpeech) === 'noun' && stripHtml(s.meaning) ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, 3);
  const firstNoun = nounIdx.length ? nounIdx[0] : -1;
  const candidates = nounIdx.filter((i) => concrete[i]);
  // English: the article titled with the lemma. Another language: the article titled with
  // the one- or two-word English gloss of the first candidate sense.
  const titleFor = (i: number): string => (isEnglish ? lemma : shortGlossTitle(senses[i].meaning));
  const titleWord = candidates.length ? titleFor(candidates[0]) : '';
  const titlePagesP = titleWord ? wikipediaPages(buildWikipediaTitleUrl(titleWord)) : Promise.resolve([]);
  // A word with no concrete noun sense rarely gets a strict match, so its fallback query, its
  // sense searches and its stand-in queries start now, beside the Wiktionary request.
  const fallbackReq = fallbackTitleQuery(lemma, senses, code);
  const early = !candidates.length;
  const earlyFallback = early && fallbackReq ? fallbackTitles(fallbackReq) : null;

  // The senses that each deserve a picture: entry heads ("bank" of money, "bank" of a river),
  // other parts of speech, and senses unlike the ones before them.
  // Until the Wiktionary page says which senses are separate words, the order of parts of speech
  // decides; the early searches use this first guess.
  let majors = majorSenses(senses, lemma, max);
  let major = majors.order;
  const searches = new Map<number, Promise<WikipediaPage[]>>();
  const search = (i: number): Promise<WikipediaPage[]> => {
    let p = searches.get(i);
    if (!p) {
      p = wikipediaPages(buildWikipediaSearchUrl(buildSenseSearchQuery(lemma, senses[i].meaning)));
      searches.set(i, p);
    }
    return p;
  };
  // Entry and part-of-speech heads may borrow a picture of a word their gloss names; a finer
  // sense only when its whole gloss is that word ("Mental balance."), so "a male horse" does not.
  const standInsFor = (m: MajorSenses): Map<number, StandIns> => {
    const map = new Map<number, StandIns>();
    if (!isEnglish) return map;
    for (const i of m.order) {
      const si = standInWords(senses[i].meaning, lemma);
      if (si.words.length && (m.heads.has(i) || si.whole)) map.set(i, si);
    }
    return map;
  };
  let standIns = standInsFor(majors);
  const standInAsked = new Map<string, Promise<[TitleQuery | null, TitleQuery | null]>>();
  const standInQuery = (map: Map<number, StandIns>): Promise<[TitleQuery | null, TitleQuery | null]> => {
    const titles = Array.from(new Set(Array.from(map.values()).flatMap((x) => x.words))).slice(0, 50);
    const key = titles.join('|');
    let p = standInAsked.get(key);
    if (!p) {
      p = titles.length
        ? Promise.all([
            batchedTitleQuery('wiktionary-lead', buildWiktionaryPageImagesUrl, titles),
            batchedTitleQuery('wikipedia-brief:en', (t) => buildWikipediaBriefTitlesUrl(t, 'en'), titles),
          ])
        : Promise.resolve([null, null]);
      standInAsked.set(key, p);
    }
    return p;
  };
  if (early && isEnglish) {
    major.slice(0, 2).forEach((i) => void search(i));
    void standInQuery(standIns);
  }

  const wiktText = await wiktTextP;
  const wikt = wiktText ? extractWiktionaryImages(wiktText, code) : [];
  if (wiktText) {
    majors = majorSenses(senses, lemma, max, sensesEtymology(wiktText, code, senses, lemma));
    major = majors.order;
    standIns = standInsFor(majors);
  }
  const matches = matchWiktionaryImages(wikt, senses, lemma);
  let count = 0;
  // A minor sense gets a picture only while every major sense still bare keeps a place.
  const room = (i: number): boolean =>
    major.includes(i) ? count < max : count < max - major.filter((j) => !picks[j]).length;
  const isMajor = (i: number) => (major.includes(i) ? 0 : 1);
  for (const m of [...matches].sort((a, b) => isMajor(a.senseIndex) - isMajor(b.senseIndex))) {
    if (!room(m.senseIndex)) continue;
    const img = wikt[m.imageIndex];
    picks[m.senseIndex] = { file: img.file, title: img.caption || img.senseText };
    count += 1;
  }

  const usedFiles = new Set(picks.filter(Boolean).map((p) => (p as Pick).file.toLowerCase()));
  const tryPage = (i: number, page: WikipediaPage | null): boolean => {
    if (!page?.pageimage || picks[i] || !room(i)) return false;
    const file = page.pageimage.replace(/_/g, ' ');
    if (usedFiles.has(file.toLowerCase())) return false;
    usedFiles.add(file.toLowerCase());
    picks[i] = { file, title: page.title, check: { level: 'portrait' } };
    count += 1;
    return true;
  };

  // The titled article goes to the first candidate it fits; a later noun sense needs a
  // stronger fit than the word's first noun sense.
  const titlePages = await titlePagesP;
  if (titleWord && count < max) {
    for (const i of candidates) {
      if (picks[i]) continue;
      const exactGloss = !isEnglish && titleFor(i).toLowerCase() === titleWord.toLowerCase();
      if (!isEnglish && !exactGloss) continue;
      const page = pickWikipediaPage(titlePages, titleWord, senses[i].meaning, lemma, { exactGloss, strict: i !== firstNoun });
      if (tryPage(i, page)) break;
    }
  }

  // What Wiktionary and the titled article found goes on screen now, while the searches run.
  if (picks.some(Boolean)) {
    void pickImages(picks.slice(), senses, lemma).then((list) => {
      if (list.some(Boolean)) emit(list);
    });
  }

  // Searches, English only, run in parallel: "crane bird gruidae" finds "Crane (bird)" for a
  // concrete noun, and "equilibrium state reaction" finds "Chemical equilibrium" for a major
  // sense, whose article may name the word inside a longer title.
  if (isEnglish && count < max) {
    const concreteBare = candidates.filter((i) => !picks[i]).slice(0, 2);
    const majorBare = major.filter((i) => !picks[i] && !concreteBare.includes(i)).slice(0, 3);
    const order = [...concreteBare, ...majorBare];
    const results = await Promise.all(order.map((i) => search(i)));
    // An article about the sense without a free lead image ("Mechanical equilibrium") still has
    // pictures in its body that name the word: "Diagram of a ball placed in a stable equilibrium".
    const noLead = new Map<number, string[]>();
    order.forEach((i, k) => {
      const pages = [...results[k]].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const gloss = senses[i].meaning;
      const strict = concrete[i] ? i !== firstNoun : i !== major[0];
      const page = concrete[i] ? pickWikipediaPage(pages, lemma, gloss, lemma, { strict }) : null;
      if (tryPage(i, page)) return;
      if (tryPage(i, pages.find((p) => acceptSenseArticle(p, lemma, gloss, { strict })) || null)) return;
      // Up to two such articles: "Chemical equilibrium" has no picture naming the word, while
      // "Dynamic equilibrium" has one.
      const bodyOnly = major.includes(i)
        ? pages.filter((p) => !p.pageimage && acceptSenseArticle(p, lemma, gloss, { strict, anyImage: true })).slice(0, 2)
        : [];
      if (bodyOnly.length) noLead.set(i, bodyOnly.map((p) => p.title));
    });
    if (noLead.size && count < max) {
      const files = await articleImageFilesMany(Array.from(new Set(Array.from(noLead.values()).flat())), 'en');
      for (const [i, titles] of noLead) {
        if (picks[i] || count >= max) continue;
        const gloss = contentTokens(glossBody(senses[i].meaning), lemma);
        const file = titles
          .flatMap((t) => rankArticleImages(files.get(t) || [], lemma, gloss))
          .find((f) => !usedFiles.has(f.toLowerCase()));
        if (!file) continue;
        usedFiles.add(file.toLowerCase());
        picks[i] = { file, title: commonsFileTitle(file), check: { level: 'portrait' } };
        count += 1;
      }
    }
  }

  const out = await pickImages(picks, senses, lemma);
  out.forEach((img, i) => {
    if (!img && picks[i]) picks[i] = null;
  });
  if (out.some(Boolean)) emit(out.slice());

  // The first sense has no picture yet: the best picture for the word as a whole goes there
  // ("Wind" for the moving air, even when the verb already found "Wind instrument").
  let fallbackState: WordFallbackState | null = null;
  const head = major.length ? major[0] : firstSenseIndex(senses);
  if (!out[head]) {
    fallbackState = await resolveWordFallback(lemma, senses, code, wikt, fallbackReq, earlyFallback);
    const img = fallbackState.image;
    const taken = new Set(out.filter(Boolean).map((x) => (x as SenseImage).pageUrl));
    if (img && !taken.has(img.pageUrl)) {
      out[head] = img;
      emit(out.slice());
    }
  }

  // Major senses still bare get a picture of a word their gloss links to: a balance for the
  // "equilibrium" of competing influences, the sea for "afloat" on a vessel at sea.
  const bareMajor = major.filter((i) => !out[i] && (standIns.get(i)?.words || []).length);
  if (isEnglish && bareMajor.length && out.filter(Boolean).length < max) {
    const [wkq, wpq] = await standInQuery(standIns);
    const stand: Array<Pick | null> = senses.map((): null => null);
    const used = new Set(out.filter(Boolean).map((x) => fileOfPage((x as SenseImage).pageUrl)));
    const usedHere = new Set<string>();
    for (const i of bareMajor) {
      const si = standIns.get(i) as StandIns;
      for (const w of si.words) {
        // The article titled with the word is about its main meaning, so its lead picture fits.
        // Wiktionary's picture for the word may show another of its senses ("change" shows coins),
        // so it is used only when the whole gloss is that word ("Mental balance.") and the file's
        // own record names it ("Balanced scales of justice").
        const wp = wpq ? resolveTitle(wpq, w.charAt(0).toUpperCase() + w.slice(1)) : undefined;
        const wk = wkq ? resolveTitle(wkq, w) : undefined;
        const options: Pick[] = [];
        // A redirect to another word is another meaning: "poor" leads to "Poverty".
        if (wp && acceptConceptPage(wp) && sameWord(titleParts(wp.title).base, w)) options.push({ file: (wp.pageimage as string).replace(/_/g, ' '), title: wp.title, check: { word: w, level: 'clean' } });
        if (si.whole && wk?.pageimage) options.push({ file: wk.pageimage.replace(/_/g, ' '), title: w, check: { word: w, level: 'named' } });
        const pick = options.find((o) => !usedHere.has(o.file.toLowerCase()) && !used.has(o.file.toLowerCase()));
        if (pick) {
          usedHere.add(pick.file.toLowerCase());
          stand[i] = pick;
          break;
        }
      }
    }
    const shown = await pickImages(stand, senses, lemma);
    shown.forEach((img, i) => {
      if (img && !out[i] && out.filter(Boolean).length < max) out[i] = img;
    });
    if (shown.some(Boolean)) emit(out.slice());
  }

  // The first sense still bare: a Commons search for the word, by file name and then anywhere
  // in the record ("Static equilibrium same force" for equilibrium at rest).
  if (!out[head] && out.filter(Boolean).length < max) {
    const state = fallbackState || (await resolveWordFallback(lemma, senses, code, wikt, fallbackReq, earlyFallback));
    const taken = new Set(out.filter(Boolean).map((x) => (x as SenseImage).pageUrl));
    const img = state.image || (await commonsFallback(lemma, senses, code, state));
    if (img && !taken.has(img.pageUrl)) out[head] = img;
  }
  return out;
}

function firstSenseIndex(senses: SenseInput[]): number {
  const i = senses.findIndex((s) => stripHtml(s.meaning));
  return i >= 0 ? i : 0;
}

/** "nordsee wellen.jpg" from a Commons file page URL, to compare with picked file names. */
function fileOfPage(url: string): string {
  const tail = String(url || '').split('/File:')[1] || '';
  try {
    return decodeURIComponent(tail).replace(/_/g, ' ').toLowerCase();
  } catch {
    return tail.replace(/_/g, ' ').toLowerCase();
  }
}

interface WordFallbackState {
  image: SenseImage | null;
  /** Gloss words to rank Commons hits by (from the article when the word has no gloss). */
  gloss: string[];
  /** The word's title names something else, so Commons hits must share a gloss word. */
  ambiguous: boolean;
}

/**
 * One picture for the word, used when no sense has its own: the article titled with the word,
 * a Wiktionary picture whose caption names it, a derived noun's article, any other caption-only
 * Wiktionary picture, then a picture used in the word's article. The first four share one
 * `imageinfo` call. Portraits of named people are refused unless the gloss is about people.
 */
async function resolveWordFallback(
  lemma: string,
  senses: SenseInput[],
  lang: string,
  wikt: WiktionaryImage[],
  req: FallbackTitles | null,
  pending: Promise<TitleQuery | null> | null,
): Promise<WordFallbackState> {
  const q = req ? await (pending || fallbackTitles(req)) : null;
  const concept = req ? rankConceptPages(q, req) : [];
  const wk = rankWiktionaryFallback(wikt, senses, lemma);
  const ordered: Pick[] = [];
  const push = (file: string, title: string, level: RecordCheck) => {
    const f = file.replace(/_/g, ' ');
    if (!ordered.some((p) => p.file.toLowerCase() === f.toLowerCase())) ordered.push({ file: f, title, check: { level } });
  };
  // A caption-only Wiktionary picture must have a clean record: no scan, document or map.
  for (const c of concept.filter((x) => x.exact)) push(c.page.pageimage as string, c.page.title, 'portrait');
  for (const w of wk.filter((x) => x.strong)) push(w.image.file, w.image.caption, 'clean');
  for (const c of concept.filter((x) => !x.exact)) push(c.page.pageimage as string, c.page.title, 'portrait');
  for (const w of wk.filter((x) => !x.strong)) push(w.image.file, w.image.caption, 'clean');
  const first = firstSenseIndex(senses);
  const meaning = senses[first]?.meaning || '';
  const personGloss = PERSON_GLOSS.test(stripHtml(meaning));
  const tried = new Set<string>();
  let gloss = glossUnion(senses, lemma);
  const firstUsable = async (picks: Pick[]): Promise<SenseImage | null> => {
    const fresh = picks.filter((p) => !tried.has(p.file.toLowerCase())).slice(0, 4);
    if (!fresh.length) return null;
    for (const p of fresh) tried.add(p.file.toLowerCase());
    const infos = await imageInfos(fresh.map((p) => p.file));
    for (const p of fresh) {
      const info = infos.get(p.file.toLowerCase());
      if (p.check && !verifyPictureRecord(p.file, info, { gloss, lemma, personGloss, level: p.check.level })) continue;
      const img = imageFromInfo(p.file, p.title, info);
      if (img) return img;
    }
    return null;
  };
  const early = await firstUsable(ordered);
  if (early) return { image: early, gloss, ambiguous: false };

  // The word's article has no free lead image ("Operon", "Arbitrage"): a picture used in the
  // article that names the word, such as its diagram. When the title is a city or a
  // disambiguation page, the search hit titled with a qualifier ("Holon (philosophy)").
  let ambiguous = false;
  if (req) {
    const wikiLang = titleQueryLang(req);
    const firstGloss = senses.find((s) => stripHtml(s.meaning));
    const search =
      !wordTitleState(q, req).usable && wikiLang === 'en' && lang === 'en' && firstGloss
        ? await wikipediaPages(buildWikipediaSearchUrl(buildSenseSearchQuery(lemma, firstGloss.meaning)))
        : null;
    const article = pickWordArticle(q, req, search, lemma, senses);
    // A failed title query leaves the word's other meanings unknown: ask for a gloss word too.
    ambiguous = article.ambiguous || !q;
    if (article.page && !article.page.missing) {
      // No gloss (a notebook card for a word saved without a definition): the article's
      // description and first sentences say which sense to look for.
      if (!gloss.length) gloss = contentTokens(`${article.page.description || ''} ${article.page.extract || ''}`, lemma);
      const picks: Pick[] = [];
      if (article.page.pageimage && acceptConceptPage(article.page)) {
        picks.push({ file: article.page.pageimage.replace(/_/g, ' '), title: article.page.title, check: { level: 'portrait' } });
      }
      for (const f of rankArticleImages(await articleImageFiles(article.page.title, wikiLang), lemma, gloss)) {
        picks.push({ file: f, title: commonsFileTitle(f), check: { level: 'portrait' } });
      }
      const fromArticle = await firstUsable(picks);
      if (fromArticle) return { image: fromArticle, gloss, ambiguous };
    }
  }
  return { image: null, gloss, ambiguous };
}

/**
 * The last resort for a word with no picture: Commons files named after the word (a foreign
 * word: its English gloss), then, when none fits, files whose description or categories name
 * it. Both rank hits by shared gloss words and push down logos, maps and portraits.
 */
async function commonsFallback(lemma: string, senses: SenseInput[], lang: string, state: WordFallbackState): Promise<SenseImage | null> {
  const query = commonsSearchQuery(lemma, senses, lang);
  const personGloss = PERSON_GLOSS.test(stripHtml(senses[firstSenseIndex(senses)]?.meaning || ''));
  // A hit is a picture of something: no portrait for a word not about people, and no book page,
  // printer's ornament, scan or document ("…vicissitudes of fortune… Fleuron T063239-1.png").
  const usable = (r: { score: number; info: ImageInfo; file: string; title: string }) => {
    const categories = stripHtml(r.info.extmetadata?.Categories?.value || '');
    if (r.score <= 0 || BOOK_PICTURE.test(r.title) || /\bfleurons?\b/i.test(r.title)) return false;
    if (badMatch(RECORD_BAD_CATEGORY, categories, lemma) || badMatch(PRINT_CATEGORY, categories, lemma)) return false;
    return personGloss || !PERSON_CATEGORY.test(categories);
  };
  // Hits sharing a gloss word rank first. A photographer's title often names the idea the photo
  // shows ("Mallard Afloat", "Static equilibrium same force"), so a hit named after the word
  // stays a candidate without one, unless the word's title also names a place, work or person.
  const named = rankCommonsFiles(await commonsSearch(query), query, lemma, state.gloss, { needGloss: state.ambiguous });
  for (const r of named.filter(usable)) {
    const img = imageFromInfo(r.file, r.title, r.info);
    if (img) return img;
  }
  // Anywhere in a record is looser, so not for a word whose title names a place, work or person.
  if (!/^[\p{L}'-]+$/u.test(query) || !state.gloss.length || state.ambiguous) return null;
  const anywhere = rankCommonsFiles(await commonsSearch(query, { fullText: true }), query, lemma, state.gloss, { needGloss: true });
  for (const r of anywhere.filter(usable)) {
    const img = imageFromInfo(r.file, r.title, r.info);
    if (img) return img;
  }
  return null;
}

/**
 * One picture per sense where a faithful one exists, aligned with `senses`. At most `max`
 * (default 4) pictures per call. When no sense has its own picture, the best picture for the
 * word as a whole sits on the first sense with a gloss, so a word with any candidate anywhere
 * always shows one. Results are cached in memory and, when the core has a
 * persistent lookup cache, there for two weeks. Never rejects; a failed request means no picture.
 */
export async function fetchSenseImages(
  lemma: string,
  senses: Array<{ meaning: string; partOfSpeech?: string }>,
  opts?: {
    max?: number;
    lang?: string;
    /**
     * Called with the pictures found so far while later steps still run, so a lookup can show
     * its first pictures before the slower stand-in and Commons steps finish. Not called when
     * the result comes from a cache.
     */
    onUpdate?: (list: Array<SenseImage | null>) => void;
  },
): Promise<Array<SenseImage | null>> {
  const word = String(lemma || '').trim();
  const list = (senses || []).map((s) => ({ meaning: String(s?.meaning || ''), partOfSpeech: s?.partOfSpeech }));
  if (!word || !list.length) return list.map((): null => null);
  const max = Math.max(0, Math.min(10, opts?.max ?? 4));
  if (!max) return list.map((): null => null);
  const lang = String(opts?.lang || 'en');
  const key = `sense-images:${CACHE_VERSION}:${lang}:${word.toLowerCase()}:${max}:${hashText(
    list.map((s) => `${canonicalSensePos(s.partOfSpeech)}|${stripHtml(s.meaning)}`).join('\n'),
  )}`;
  const hit = resultCache.get(key);
  if (hit && Date.now() < hit.until) return hit.p;
  const entry = { p: Promise.resolve([] as Array<SenseImage | null>), until: Infinity };
  // A request that failed (offline, rate limited) leaves the result uncached, so the next call
  // asks again; a result with no picture is kept for EMPTY_TTL_MS only.
  const forget = () => {
    if (resultCache.get(key) === entry) resultCache.delete(key);
  };
  entry.p = (async () => {
    const saved = await readPersisted(key);
    if (saved && saved.length === list.length) {
      if (!saved.some(Boolean)) entry.until = Date.now() + EMPTY_TTL_MS;
      return saved;
    }
    const before = failures;
    try {
      const update = opts?.onUpdate;
      const out = await resolveSenseImages(word, list, max, lang, (partial) => {
        try {
          update?.(partial);
        } catch {
          /* a caller's error never stops the search */
        }
      });
      if (failures !== before) {
        forget();
        return out;
      }
      if (!out.some(Boolean)) entry.until = Date.now() + EMPTY_TTL_MS;
      writePersisted(key, out);
      return out;
    } catch {
      forget();
      return list.map((): null => null);
    }
  })();
  if (resultCache.size > 200) resultCache.clear();
  resultCache.set(key, entry);
  return entry.p;
}

/**
 * One picture for a word (the notebook's card): a sense picture checked against `gloss` when
 * one fits, otherwise the best picture for the word as a whole. Works without a gloss.
 */
export async function fetchWordImage(lemma: string, opts?: { lang?: string; gloss?: string }): Promise<SenseImage | null> {
  const gloss = String(opts?.gloss || '').trim();
  const sense = gloss ? { meaning: gloss, partOfSpeech: 'noun' } : { meaning: '' };
  const [img] = await fetchSenseImages(lemma, [sense], { max: 1, lang: opts?.lang });
  return img || null;
}

/** For tests: forget every cached request and result. */
export function clearSenseImageCache(): void {
  jsonCache.clear();
  infoCache.clear();
  resultCache.clear();
}
