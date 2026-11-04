/**
 * Pictures for dictionary senses. The rules, with the practice they follow, are in
 * docs/SENSE_IMAGES.md: one picture beside each sense that names something you can show, taken
 * from a source that names the same thing, and none when nothing fits.
 *
 * Keyless sources, all licence-clean because every file comes from Wikimedia Commons:
 *
 * 1. Wiktionary's own sense images. Editors place `[[File:...|thumb|caption]]` in an entry and
 *    often tie the caption to a sense with `{{senseno|en|ID}}`, where the definition line carries
 *    `{{senseid|en|ID}}`. We match the caption (or the linked definition line) against our
 *    glosses by shared content words. Curated by lexicographers, so a match may illustrate any
 *    part of speech.
 * 2. English: the articles that name the word, from the title query (the word itself) and from
 *    its disambiguation page ("Crane (bird)", "Crane (machine)", "Chemical equilibrium"). Each
 *    article goes to the noun sense it fits best when that sense also fits it best
 *    (`matchSenseArticles`). The picture is the article's free lead image or, when it has none,
 *    its Wikidata item's P18. Only when the word has no disambiguation page does a search for
 *    `lemma + gloss keywords` look for an article for up to two concrete senses.
 * 3. Another language: the English article titled with a concrete sense's one- or two-word gloss.
 *
 * Wiktionary, the title query and the disambiguation links go out side by side; Wikidata (only
 * for matched articles without a lead image) and the searches share the second round; one
 * batched `imageinfo` call ends it. Crane costs four requests in two rounds.
 *
 * These strict matches reject on doubt and may place up to three pictures. When none of them
 * finds anything, a whole-word fallback still gives the word one picture (on its first sense),
 * the best-ranked candidate from, in order:
 *
 * a. the Wikipedia article titled with the word, even an abstract one ("Justice", "Happiness");
 * b. a Wiktionary picture on the word's own page whose caption names the word or a gloss word;
 * c. the article titled with a derived noun ("inspect" gives "Inspection", "run" "Running",
 *    "beautiful" "Beauty", "ephemeral" "Ephemerality");
 * d. any other caption-only Wiktionary picture on the page;
 * e. a picture used in the word's article that names the word or a gloss word, such as the
 *    diagram "Lac Operon.svg" on "Operon", whose lead has no free image. When the title is a
 *    disambiguation page or names something else ("Holon" is a city), the article is the search
 *    hit titled with a qualifier whose description fits the gloss ("Holon (philosophy)");
 * f. a Commons file search for the word in file names (a foreign word: its English gloss),
 *    photos and drawings, ranked by how many gloss words its title, description and topic
 *    categories share, with logos, maps, flags, diagrams and portraits of named people pushed
 *    down. A hit must share a gloss word: file names match spelling, not meaning.
 *
 * A portrait of a named person is never the word's picture, and a word whose senses are all
 * function words ("however") stops after steps a to d.
 *
 * Steps a to d cost one batched Wikipedia `titles=` request; step e one `prop=images` request
 * (and a search when the title is not the word's article); step f one Commons search. Each runs
 * only when the steps before it find nothing. File metadata (thumb URL, size, author, licence)
 * comes from one batched Commons `imageinfo` call, or with the Commons search itself.
 *
 * Requests go out at most three at a time with an identifying User-Agent, as Wikimedia's rate
 * limits ask. A result computed while a request failed is not cached, and a result with no
 * picture is kept for six hours only, so a word that got nothing is tried again.
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
// v4: results saved under v3 may hold a free-text Commons hit or a portrait the 2026-11-04 rules reject.
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
    'etc his her him she you your our ours mine yours known whatever whichever ' +
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
  /\b(film|movie|album|song|band|novel|book|magazine|newspaper|company|corporation|brand|manufacturer|rapper|singer|musician|actor|actress|politician|footballer|television|tv series|episode|video game|software|programming language|surname|given name|disambiguation|village|town|city|municipality|commune|county|district|province|state of|river in|mountain in|record label|organi[sz]ation|sports team|football club|collective|ethnic group|born|died|fictional|website|operating system|census|neighbourhood|neighborhood)\b/i;

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
  if (!isPicturableNounSense(sense)) return false;
  const body = glossBody(sense.meaning);
  if (/\bof being\b/i.test(body)) return false;
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
  pageprops?: { disambiguation?: string; wikibase_item?: string };
}

const WIKI_PAGE_PROPS =
  `prop=pageimages|pageprops|description|extracts&piprop=name|thumbnail&pithumbsize=${THUMB_WIDTH}` +
  '&pilicense=free&ppprop=disambiguation|wikibase_item&exintro=1&explaintext=1&exsentences=2&exlimit=max';

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
 */
export function buildSenseSearchQuery(lemma: string, gloss: string): string {
  const words = contentTokens(glossBody(gloss), lemma);
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

// ---------------------------------------------------------------- sense to article

/**
 * The articles a disambiguation page lists, with lead image, short description and Wikidata
 * item, in one request. "Crane (disambiguation)" redirects to "Crane" when that title is the
 * disambiguation page itself, and `redirects=1` follows it. Lead images stop after 50 pages
 * (`pilimit`); a matched page without one asks Wikidata instead.
 */
export function buildDisambiguationLinksUrl(lemma: string): string {
  const word = String(lemma || '').trim();
  const title = `${word.charAt(0).toUpperCase()}${word.slice(1)} (disambiguation)`;
  return (
    'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1' +
    '&generator=links&gplnamespace=0&gpllimit=max&prop=pageimages|pageprops|description' +
    '&piprop=name&pilimit=max&pilicense=free&ppprop=disambiguation|wikibase_item' +
    `&titles=${encodeURIComponent(title)}&origin=*`
  );
}

/**
 * Wikidata items' page images, many items per request. Wikidata takes an item's page image from
 * its P18 ("image") first and only then from flag, coat-of-arms, logo and map properties, so
 * the caller drops logos, maps and flags by file name.
 * https://phabricator.wikimedia.org/T249811
 */
export function buildWikidataImagesUrl(ids: string[]): string {
  return (
    'https://www.wikidata.org/w/api.php?action=query&format=json&formatversion=2&prop=pageimages' +
    `&piprop=name&pilimit=max&titles=${encodeURIComponent(ids.join('|'))}&origin=*`
  );
}

export type ArticleKind = 'exact' | 'qualifier' | 'compound';

/**
 * How an article title names the word: the word itself ("Bat"), the word with a qualifier
 * ("Crane (machine)"), or a compound whose head is the word, written in Wikipedia's sentence
 * case ("Chemical equilibrium", "Baseball bat"). A capitalised head is a name ("HMS Bat",
 * "Johnnie Notions"), and a compound led by the word names something else ("Crane fly").
 */
export function articleKind(title: string, lemma: string): ArticleKind | null {
  const t = String(title || '').trim();
  if (!t || /^list of\b/i.test(t) || /disambiguation/i.test(t)) return null;
  const { base, qualifier } = titleParts(t);
  if (sameWord(base, lemma)) return qualifier ? 'qualifier' : 'exact';
  if (qualifier) return null;
  const words = base.split(/\s+/);
  if (words.length < 2 || words.length > 3) return null;
  const head = words[words.length - 1];
  if (!sameWord(head, lemma)) return null;
  if (words.slice(1).some((w) => w !== w.toLowerCase())) return null;
  return 'compound';
}

/** Words too general to tie a gloss to an article on their own. */
const WEAK_TOKENS = new Set(
  'small large piece part object item person people place area system structure group member material substance body whole set state'
    .split(' ')
    .map(stem),
);

/** "chemistry" and "chemical" both give "chem"; "mechanics" and "mechanical" give "mechan". */
function fieldRoot(w: string): string {
  const r = w.replace(/(istry|ically|ical|ics|ic|ist|ism)$/, '');
  return r.length >= 4 ? r : w;
}

/** Two stems name the same thing: equal, one a prefix (5+ letters) of the other, or the same field root. */
function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 5 && l.startsWith(s)) return true;
  return fieldRoot(a) === fieldRoot(b);
}

/** Gloss words found in an article's text; a general word ("small", "system") counts half. */
export function glossOverlap(gloss: string[], text: string[]): number {
  let n = 0;
  for (const g of gloss) if (text.some((t) => stemsMatch(g, t))) n += WEAK_TOKENS.has(g) ? 0.5 : 1;
  return n;
}

/**
 * How well an article fits a gloss: gloss words in its title's other words, qualifier and short
 * description; or, when its first sentences share two or more, half that count.
 */
export function senseArticleScore(page: WikipediaPage, gloss: string, lemma: string): number {
  const g = contentTokens(glossBody(gloss), lemma);
  if (!g.length) return 0;
  const { base, qualifier } = titleParts(page.title);
  const own = glossOverlap(g, contentTokens(`${base} ${qualifier} ${page.description || ''}`, lemma));
  const extract = page.extract ? glossOverlap(g, contentTokens(page.extract, lemma)) : 0;
  return Math.max(own, extract >= 2 ? extract / 2 : 0);
}

/** A noun sense with a gloss, no slang or figurative label, and not a "form of" line. */
export function isPicturableNounSense(sense: SenseInput): boolean {
  if (canonicalSensePos(sense.partOfSpeech) !== 'noun') return false;
  const plain = stripHtml(sense.meaning);
  if (!plain || plain.length < 3) return false;
  if (BAD_LABELS.test(glossLabels(sense.meaning))) return false;
  return !/\b(plural of|form of|spelling of|abbreviation of|initialism of|clipping of|short for|ellipsis of|synonym of)\b/i.test(
    glossBody(sense.meaning),
  );
}

export interface ArticleMatch {
  senseIndex: number;
  page: WikipediaPage;
  kind: ArticleKind;
  score: number;
}

const KIND_ORDER: Record<ArticleKind, number> = { exact: 0, qualifier: 1, compound: 2 };

/**
 * Pair senses with articles that name the word, the way a learner's dictionary puts one picture
 * beside the sense it shows. An article goes to a sense only when each is the other's best fit
 * and they share at least one gloss word; a sense whose best article is taken, or has no
 * picture, stays bare rather than borrow a weaker one. The article titled with the word itself
 * may only illustrate a concrete sense (`concrete`); a qualified or compound title names one
 * specific topic ("Chemical equilibrium") and may illustrate any noun sense.
 */
export function matchSenseArticles(
  senses: SenseInput[],
  pages: WikipediaPage[],
  lemma: string,
  opts: { concrete?: boolean[]; skip?: Set<number> } = {},
): ArticleMatch[] {
  const seen = new Set<string>();
  const cands: Array<{ page: WikipediaPage; kind: ArticleKind; order: number }> = [];
  (pages || []).forEach((page, order) => {
    if (!page || page.missing || seen.has(page.title)) return;
    if (page.pageprops && page.pageprops.disambiguation !== undefined) return;
    const kind = articleKind(page.title, lemma);
    if (!kind) return;
    // A listed article with no short description is a stub or a list; there is nothing to match.
    if (kind !== 'exact' && !String(page.description || '').trim()) return;
    const { qualifier } = titleParts(page.title);
    if (BAD_DESCRIPTION.test(String(page.description || '')) || BAD_DESCRIPTION.test(qualifier)) return;
    seen.add(page.title);
    cands.push({ page, kind, order });
  });
  if (!cands.length) return [];
  // Senses that already have a picture still compete, so their article is not handed down to
  // a weaker sense ("A branch office of such an institution" does not get the bank building).
  const eligible = senses.map((s) => isPicturableNounSense(s));
  const score = senses.map((s, i) =>
    cands.map((c) => {
      if (!eligible[i]) return 0;
      if (c.kind === 'exact' && opts.concrete && !opts.concrete[i]) return 0;
      return senseArticleScore(c.page, s.meaning, lemma);
    }),
  );
  // A compound names a kind of the thing ("Central bank", "Piggy bank"), so a concrete sense
  // needs two shared words before a kind's picture stands for it; an abstract sense names a
  // field, and one word ties it to the field's own article ("Chemical equilibrium").
  const needed = (i: number, kind: ArticleKind) => (kind === 'compound' && (!opts.concrete || opts.concrete[i]) ? 2 : 1);
  const better = (a: number, b: number) =>
    KIND_ORDER[cands[a].kind] - KIND_ORDER[cands[b].kind] || cands[a].order - cands[b].order;
  const bestPage = score.map((row) => {
    let best = -1;
    row.forEach((v, p) => {
      if (v <= 0) return;
      if (best < 0 || v > row[best] || (v === row[best] && better(p, best) < 0)) best = p;
    });
    return best;
  });
  const out: ArticleMatch[] = [];
  cands.forEach((c, p) => {
    let bestSense = -1;
    score.forEach((row, i) => {
      if (row[p] > 0 && (bestSense < 0 || row[p] > score[bestSense][p])) bestSense = i;
    });
    if (bestSense < 0 || opts.skip?.has(bestSense) || bestPage[bestSense] !== p) return;
    if (score[bestSense][p] < needed(bestSense, c.kind)) return;
    out.push({ senseIndex: bestSense, page: c.page, kind: c.kind, score: score[bestSense][p] });
  });
  return out.sort((a, b) => a.senseIndex - b.senseIndex);
}

// ---------------------------------------------------------------- whole-word fallback

/** File names that are rarely a picture of the thing: maps, flags, logos, seals, signatures. */
const BAD_FILE = /\b(map|maps|locator|location map|flag|flags|coat of arms|logo|logos|wordmark|seal|signature|emblem|icon|blank|noun project)\b/i;

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
   * The word's own title names something else (a city, a film, a person) or is a disambiguation
   * page, so a file named after the word is no evidence; Commons hits must share a gloss word.
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
  return { exact, usable: !disambiguation && !elsewhere, ambiguous: disambiguation || elsewhere };
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
export function buildCommonsSearchUrl(query: string): string {
  const q = String(query || '').trim();
  const text = /^[\p{L}'-]+$/u.test(q) ? `intitle:${q}` : q;
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
 * Commons categories that say what a file shows, without the bookkeeping ones ("Artworks with
 * known accession number", "Images from the Metropolitan Museum of Art", "Self-published work"),
 * whose words otherwise match a gloss: "known" tied "The Mistaken Notion" to "notion".
 */
export function topicCategories(raw: string): string {
  return stripHtml(raw)
    .split('|')
    .filter(
      (c) =>
        c &&
        !/\b(with|without|missing|needing|uploaded|images from|photos from|files from|files by|self-published|featured|quality|taken with|taken on|pd|cc|gfdl|licen[cs]e|copyright|accession|template|valid svg|translated|retouched|derivative|lab)\b/i.test(c),
    )
    .join('|');
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
      const categories = topicCategories(meta.Categories?.value || '');
      const tokens = contentTokens(`${name} ${description} ${categories.replace(/\|/g, ' ')}`, lemma);
      const shared = overlap(gloss, tokens);
      const inName = words.some((w) => sharesWord(name, w));
      // A hit that names neither the search word nor a gloss word matched on something else.
      if (!shared && !inName && !words.some((w) => sharesWord(`${description} ${categories}`, w))) return null;
      if (opts.needGloss && !shared) return null;
      let score = shared * 2 + (1 - i / n);
      if (inName) score += 2;
      if (badMatch(BAD_FILE, name, lemma) || badMatch(BAD_CATEGORY, categories, lemma)) score -= 5;
      if (PERSON_CATEGORY.test(categories)) score -= 4;
      return { file, title: name, info, score };
    })
    .filter((x): x is { file: string; title: string; info: ImageInfo; score: number } => !!x)
    .sort((a, b) => b.score - a.score);
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
    '&iiextmetadatafilter=Artist|LicenseShortName|Categories' +
    `&titles=${encodeURIComponent(titles)}&origin=*`
  );
}

/**
 * "Portraits of Horace Walpole" or "Sean Combs in 2023": a picture of one named person. Such a
 * picture shows who coined or bears the word, not what it means, so the whole-word fallback
 * skips it (Wiktionary keeps Orwell off "newspeak" for the same reason).
 */
const NAMED_PERSON =
  /(^|\|)[^|]*\b[Pp]ortraits? of \p{Lu}[\p{L}.'-]*(?: \p{Lu}[\p{L}.'-]*)+(?=\||$)|(^|\|)\p{Lu}[\p{L}.'-]+(?: \p{Lu}[\p{L}.'-]+)+ in \d{4}(?=\||$)/u;

export function isNamedPersonPicture(info: ImageInfo | undefined): boolean {
  return NAMED_PERSON.test(stripHtml(info?.extmetadata?.Categories?.value || ''));
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

function getJson<T>(url: string): Promise<T | null> {
  const hit = jsonCache.get(url);
  if (hit) return hit as Promise<T | null>;
  const { http, headers } = client();
  const once = () => throttled(() => http.requestJson<T>(url, { headers, timeoutMs: TIMEOUT_MS }));
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

async function wiktionaryImages(lemma: string, lang: string): Promise<WiktionaryImage[]> {
  const res = await getJson<{
    query?: { pages?: Array<{ missing?: boolean; revisions?: Array<{ slots?: { main?: { content?: string } } }> }> };
  }>(buildWiktionaryUrl(lemma));
  const page = res?.query?.pages?.[0];
  const text = page?.revisions?.[0]?.slots?.main?.content || '';
  return text ? extractWiktionaryImages(text, lang) : [];
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

/** Pages a disambiguation page links to; null when the request failed. */
async function disambiguationPages(lemma: string): Promise<WikipediaPage[] | null> {
  const res = await getJson<{ query?: { pages?: WikipediaPage[] } }>(buildDisambiguationLinksUrl(lemma));
  return res ? res.query?.pages || [] : null;
}

/** Each Wikidata item's page image file, by item id. */
async function wikidataImages(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter((id) => /^Q\d+$/.test(id)))).slice(0, 50);
  if (!unique.length) return out;
  const res = await getJson<{ query?: { pages?: Array<{ title: string; pageimage?: string }> } }>(buildWikidataImagesUrl(unique));
  for (const p of res?.query?.pages || []) if (p.pageimage) out.set(p.title, p.pageimage.replace(/_/g, ' '));
  return out;
}

async function commonsSearch(query: string): Promise<CommonsPage[]> {
  if (!query.trim()) return [];
  const res = await getJson<{ query?: { pages?: CommonsPage[] } }>(buildCommonsSearchUrl(query));
  return res?.query?.pages || [];
}

async function imageInfos(files: string[]): Promise<Map<string, ImageInfo>> {
  const out = new Map<string, ImageInfo>();
  const unique = Array.from(new Set(files.map((f) => f.replace(/_/g, ' '))));
  if (!unique.length) return out;
  const res = await getJson<{
    query?: {
      normalized?: Array<{ from: string; to: string }>;
      pages?: Array<{ title: string; missing?: boolean; imageinfo?: ImageInfo[] }>;
    };
  }>(buildImageInfoUrl(unique));
  for (const p of res?.query?.pages || []) {
    if (p.missing || !p.imageinfo?.[0]) continue;
    out.set(p.title.replace(/^File:/, '').toLowerCase(), p.imageinfo[0]);
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
}

interface Pending {
  /** The Commons file, or empty while it waits for the Wikidata item's image. */
  file: string;
  item?: string;
  title: string;
}

/** Parts of speech no picture dictionary illustrates: "however", "of", "they". */
const FUNCTION_POS = new Set(['adverb', 'conjunction', 'preposition', 'pronoun', 'determiner', 'article', 'particle', 'interjection']);

function onlyFunctionWords(senses: SenseInput[]): boolean {
  const pos = senses.filter((s) => stripHtml(s.meaning)).map((s) => canonicalSensePos(s.partOfSpeech));
  return pos.length > 0 && pos.every((p) => FUNCTION_POS.has(p));
}

async function resolveSenseImages(
  lemma: string,
  senses: SenseInput[],
  max: number,
  lang: string,
): Promise<Array<SenseImage | null>> {
  const code = String(lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  if (code !== 'en') return resolveForeignSenseImages(lemma, senses, max, code);

  // Round one, side by side: the Wiktionary entry, the articles titled with the word and its
  // derived nouns, and the articles the word's disambiguation page lists.
  const concrete = senses.map((s) => isConcreteNounSense(s, lemma));
  const fallbackReq = fallbackTitleQuery(lemma, senses, code);
  const titleP = fallbackReq ? titleQuery(fallbackReq.url) : Promise.resolve(null);
  const linksP = senses.some((s) => isPicturableNounSense(s)) ? disambiguationPages(lemma) : Promise.resolve([]);
  const wikt = await wiktionaryImages(lemma, code);

  const picks: Array<Pending | null> = senses.map((): null => null);
  for (const m of matchWiktionaryImages(wikt, senses, lemma)) {
    const img = wikt[m.imageIndex];
    picks[m.senseIndex] = { file: img.file, title: img.caption || img.senseText };
  }

  const [q, links] = await Promise.all([titleP, linksP]);
  const word: { usable: boolean; exact?: WikipediaPage } = q && fallbackReq ? wordTitleState(q, fallbackReq) : { usable: false };
  const pages = [...(word.usable && word.exact ? [word.exact] : []), ...(links || [])];
  const skip = new Set(picks.map((p, i) => (p ? i : -1)).filter((i) => i >= 0));
  const leadFile = (page: WikipediaPage): string => {
    const file = String(page.pageimage || '').replace(/_/g, ' ');
    return file && !badMatch(BAD_FILE, commonsFileTitle(file), lemma) ? file : '';
  };
  for (const m of matchSenseArticles(senses, pages, lemma, { concrete, skip })) {
    const file = leadFile(m.page);
    const item = m.page.pageprops?.wikibase_item;
    if (file || item) picks[m.senseIndex] = { file, item: file ? undefined : item, title: m.page.title };
  }

  // Round two, side by side: Wikidata images for matched articles without a free lead image,
  // and, for a word with no disambiguation page, a search ("crane bird gruidae") for up to two
  // concrete senses still bare among the first three nouns.
  const nounIdx = senses
    .map((s, i) => (canonicalSensePos(s.partOfSpeech) === 'noun' && stripHtml(s.meaning) ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, 3);
  const firstNoun = nounIdx.length ? nounIdx[0] : -1;
  const bare = links && links.length ? [] : nounIdx.filter((i) => concrete[i] && !picks[i]).slice(0, 2);
  const items = picks.filter((p): p is Pending => !!p && !p.file && !!p.item).map((p) => p.item as string);
  const [itemFiles, searched] = await Promise.all([
    wikidataImages(items),
    Promise.all(bare.map((i) => wikipediaPages(buildWikipediaSearchUrl(buildSenseSearchQuery(lemma, senses[i].meaning))))),
  ]);
  bare.forEach((i, k) => {
    const page = pickWikipediaPage(searched[k], lemma, senses[i].meaning, lemma, { strict: i !== firstNoun });
    const file = page ? leadFile(page) : '';
    if (page && file) picks[i] = { file, title: page.title };
  });

  // One picture per file, at most `max`, earliest senses first.
  const used = new Set<string>();
  let kept = 0;
  const final: Array<Pick | null> = picks.map((p) => {
    if (!p) return null;
    let file = p.file;
    if (!file && p.item) {
      const f = itemFiles.get(p.item) || '';
      file = f && !badMatch(BAD_FILE, commonsFileTitle(f), lemma) ? f : '';
    }
    if (!file || used.has(file.toLowerCase()) || kept >= max) return null;
    used.add(file.toLowerCase());
    kept += 1;
    return { file, title: p.title };
  });

  let out: Array<SenseImage | null> = senses.map((): null => null);
  const files = final.filter(Boolean).map((p) => (p as Pick).file);
  if (files.length) {
    const infos = await imageInfos(files);
    out = final.map((p) => (p ? imageFromInfo(p.file, p.title, infos.get(p.file.toLowerCase())) : null));
  }
  if (out.some(Boolean)) return out;

  // No sense-specific picture: the best picture for the word as a whole goes on the first sense.
  const fallback = await resolveWordFallback(lemma, senses, code, wikt, fallbackReq, Promise.resolve(q));
  if (fallback) out[firstSenseIndex(senses)] = fallback;
  return out;
}

/**
 * A word in another language: Wiktionary's own pictures, then the English article titled with a
 * concrete sense's one- or two-word gloss ("猫" gives "cat", which gives "Cat").
 */
async function resolveForeignSenseImages(
  lemma: string,
  senses: SenseInput[],
  max: number,
  code: string,
): Promise<Array<SenseImage | null>> {
  const picks: Array<Pick | null> = senses.map((): null => null);
  const concrete = senses.map((s) => isConcreteNounSense(s, lemma));
  const nounIdx = senses
    .map((s, i) => (canonicalSensePos(s.partOfSpeech) === 'noun' && stripHtml(s.meaning) ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, 3);
  const firstNoun = nounIdx.length ? nounIdx[0] : -1;
  const candidates = nounIdx.filter((i) => concrete[i]);
  const titleFor = (i: number): string => shortGlossTitle(senses[i].meaning);
  const titleWord = candidates.length ? titleFor(candidates[0]) : '';
  const titlePagesP = titleWord ? wikipediaPages(buildWikipediaTitleUrl(titleWord)) : Promise.resolve([]);
  // A word with no concrete noun sense rarely gets a strict match, so its fallback query
  // starts now, beside the Wiktionary request, instead of after it.
  const fallbackReq = fallbackTitleQuery(lemma, senses, code);
  const earlyFallback = !candidates.length && fallbackReq ? titleQuery(fallbackReq.url) : null;

  const wikt = await wiktionaryImages(lemma, code);
  let count = 0;
  for (const m of matchWiktionaryImages(wikt, senses, lemma)) {
    if (count >= max) break;
    const img = wikt[m.imageIndex];
    picks[m.senseIndex] = { file: img.file, title: img.caption || img.senseText };
    count += 1;
  }

  const usedFiles = new Set(picks.filter(Boolean).map((p) => (p as Pick).file.toLowerCase()));
  const titlePages = await titlePagesP;
  if (titleWord && count < max) {
    for (const i of candidates) {
      if (picks[i] || titleFor(i).toLowerCase() !== titleWord.toLowerCase()) continue;
      const page = pickWikipediaPage(titlePages, titleWord, senses[i].meaning, lemma, { exactGloss: true, strict: i !== firstNoun });
      const file = page?.pageimage ? page.pageimage.replace(/_/g, ' ') : '';
      if (!page || !file || usedFiles.has(file.toLowerCase())) continue;
      usedFiles.add(file.toLowerCase());
      picks[i] = { file, title: page.title };
      count += 1;
      break;
    }
  }

  const files = picks.filter(Boolean).map((p) => (p as Pick).file);
  let out: Array<SenseImage | null> = senses.map((): null => null);
  if (files.length) {
    const infos = await imageInfos(files);
    out = picks.map((p) => (p ? imageFromInfo(p.file, p.title, infos.get(p.file.toLowerCase())) : null));
  }
  if (out.some(Boolean)) return out;
  const fallback = await resolveWordFallback(lemma, senses, code, wikt, fallbackReq, earlyFallback);
  if (fallback) out[firstSenseIndex(senses)] = fallback;
  return out;
}

function firstSenseIndex(senses: SenseInput[]): number {
  const i = senses.findIndex((s) => stripHtml(s.meaning));
  return i >= 0 ? i : 0;
}

/**
 * One picture for the word, used when no sense has its own: the article titled with the word,
 * a Wiktionary picture whose caption names it, a derived noun's article, any other caption-only
 * Wiktionary picture, then the best Commons search hit. The first four share one `imageinfo`
 * call; the Commons search carries its own file metadata and runs only when they all fail. A
 * portrait of a named person (Horace Walpole on "Serendipity") is never the word's picture, and
 * a word whose senses are all function words ("however") goes no further than its own article
 * and Wiktionary entry.
 */
async function resolveWordFallback(
  lemma: string,
  senses: SenseInput[],
  lang: string,
  wikt: WiktionaryImage[],
  req: FallbackTitles | null,
  pending: Promise<TitleQuery | null> | null,
): Promise<SenseImage | null> {
  const q = req ? await (pending || titleQuery(req.url)) : null;
  const concept = req ? rankConceptPages(q, req) : [];
  const wk = rankWiktionaryFallback(wikt, senses, lemma);
  const ordered: Pick[] = [];
  const push = (file: string, title: string) => {
    const f = file.replace(/_/g, ' ');
    if (!ordered.some((p) => p.file.toLowerCase() === f.toLowerCase())) ordered.push({ file: f, title });
  };
  for (const c of concept.filter((x) => x.exact)) push(c.page.pageimage as string, c.page.title);
  for (const w of wk.filter((x) => x.strong)) push(w.image.file, w.image.caption);
  for (const c of concept.filter((x) => !x.exact)) push(c.page.pageimage as string, c.page.title);
  for (const w of wk.filter((x) => !x.strong)) push(w.image.file, w.image.caption);
  const tried = new Set<string>();
  const firstUsable = async (picks: Pick[]): Promise<SenseImage | null> => {
    const fresh = picks.filter((p) => !tried.has(p.file.toLowerCase())).slice(0, 4);
    if (!fresh.length) return null;
    for (const p of fresh) tried.add(p.file.toLowerCase());
    const infos = await imageInfos(fresh.map((p) => p.file));
    for (const p of fresh) {
      const info = infos.get(p.file.toLowerCase());
      if (isNamedPersonPicture(info)) continue;
      const img = imageFromInfo(p.file, p.title, info);
      if (img) return img;
    }
    return null;
  };
  const early = await firstUsable(ordered);
  if (early) return early;
  if (onlyFunctionWords(senses)) return null;

  // The word's article has no free lead image ("Operon", "Arbitrage"): a picture used in the
  // article that names the word, such as its diagram. When the title is a city or a
  // disambiguation page, the search hit titled with a qualifier ("Holon (philosophy)").
  let gloss = glossUnion(senses, lemma);
  if (req) {
    const wikiLang = titleQueryLang(req);
    const firstGloss = senses.find((s) => stripHtml(s.meaning));
    const search =
      !wordTitleState(q, req).usable && wikiLang === 'en' && lang === 'en' && firstGloss
        ? await wikipediaPages(buildWikipediaSearchUrl(buildSenseSearchQuery(lemma, firstGloss.meaning)))
        : null;
    const article = pickWordArticle(q, req, search, lemma, senses);
    if (article.page && !article.page.missing) {
      // No gloss (a notebook card for a word saved without a definition): the article's
      // description and first sentences say which sense to look for.
      if (!gloss.length) gloss = contentTokens(`${article.page.description || ''} ${article.page.extract || ''}`, lemma);
      const picks: Pick[] = [];
      if (article.page.pageimage && acceptConceptPage(article.page)) {
        picks.push({ file: article.page.pageimage.replace(/_/g, ' '), title: article.page.title });
      }
      for (const f of rankArticleImages(await articleImageFiles(article.page.title, wikiLang), lemma, gloss)) {
        picks.push({ file: f, title: commonsFileTitle(f) });
      }
      const fromArticle = await firstUsable(picks);
      if (fromArticle) return fromArticle;
    }
  }

  // A Commons search matches file names, not meanings ("The Mistaken Notion" is a painting's
  // title), so a hit must share a gloss word as well as name the word: no gloss, no hit.
  if (!gloss.length) return null;
  const query = commonsSearchQuery(lemma, senses, lang);
  const ranked = rankCommonsFiles(await commonsSearch(query), query, lemma, gloss, { needGloss: true });
  for (const r of ranked) {
    if (isNamedPersonPicture(r.info)) continue;
    const img = imageFromInfo(r.file, r.title, r.info);
    if (img) return img;
  }
  return null;
}

/**
 * One picture per sense where a faithful one exists, aligned with `senses`. At most `max`
 * (default 3) pictures per call. When no sense has its own picture, the best picture for the
 * word as a whole sits on the first sense with a gloss, so a word with any candidate anywhere
 * always shows one. Results are cached in memory and, when the core has a
 * persistent lookup cache, there for two weeks. Never rejects; a failed request means no picture.
 */
export async function fetchSenseImages(
  lemma: string,
  senses: Array<{ meaning: string; partOfSpeech?: string }>,
  opts?: { max?: number; lang?: string },
): Promise<Array<SenseImage | null>> {
  const word = String(lemma || '').trim();
  const list = (senses || []).map((s) => ({ meaning: String(s?.meaning || ''), partOfSpeech: s?.partOfSpeech }));
  if (!word || !list.length) return list.map((): null => null);
  const max = Math.max(0, Math.min(10, opts?.max ?? 3));
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
      const out = await resolveSenseImages(word, list, max, lang);
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
  resultCache.clear();
}
