/**
 * Pictures for dictionary senses.
 *
 * Two keyless sources, both licence-clean because every file comes from Wikimedia Commons:
 *
 * 1. Wiktionary's own sense images. Editors place `[[File:...|thumb|caption]]` in an entry and
 *    often tie the caption to a sense with `{{senseno|en|ID}}`, where the definition line carries
 *    `{{senseid|en|ID}}`. We match the caption (or the linked definition line) against our
 *    glosses by shared content words. Curated by lexicographers, so a match may illustrate any
 *    part of speech.
 * 2. Wikipedia's lead image, only for concrete noun senses: the article titled with the lemma
 *    (or, for a foreign word, with its one-word English gloss), then a search for `lemma + gloss
 *    keywords`. A page counts only when its title is the lemma (optionally with a qualifier such
 *    as "Crane (bird)") and its short description or first sentences share words with the gloss.
 *    `pilicense=free` keeps non-free lead images out.
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
 * e. a Commons file search for the word (a foreign word: its English gloss), bitmaps only,
 *    ranked by how many gloss words its title, description and categories share, with logos,
 *    maps, flags, diagrams and portraits of named people pushed down.
 *
 * Steps a to d cost one batched Wikipedia `titles=` request; step e one Commons search, made
 * only when a to d find nothing. File metadata (thumb URL, size, author, licence) comes from
 * one batched Commons `imageinfo` call, or with the Commons search itself.
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
const CACHE_VERSION = 'v2';
const PERSIST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
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
  /\b(film|movie|album|song|band|novel|book|magazine|newspaper|company|corporation|brand|manufacturer|rapper|singer|musician|actor|actress|politician|footballer|television|tv series|episode|video game|software|programming language|surname|given name|disambiguation|village|town|city|municipality|commune|county|district|province|state of|river in|mountain in|record label|organi[sz]ation|sports team|football club|ethnic group|born|died|fictional|website|operating system|census|neighbourhood|neighborhood)\b/i;

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

export function buildCommonsSearchUrl(query: string): string {
  return (
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2' +
    `&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}` +
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
 */
export function rankCommonsFiles(
  pages: CommonsPage[],
  query: string,
  lemma: string,
  gloss: string[],
): Array<{ file: string; title: string; info: ImageInfo; score: number }> {
  const list = [...(pages || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const n = list.length || 1;
  const words = String(query || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  return list
    .map((p, i) => {
      const info = p.imageinfo?.[0];
      if (!info || !info.thumburl || (info.mime && !/^image\/(jpeg|png|gif|webp|tiff)/.test(info.mime))) return null;
      const file = p.title.replace(/^File:/i, '');
      const name = commonsFileTitle(file);
      const meta = info.extmetadata || {};
      const description = stripHtml(meta.ImageDescription?.value || '').slice(0, 400);
      const categories = stripHtml(meta.Categories?.value || '');
      const tokens = contentTokens(`${name} ${description} ${categories.replace(/\|/g, ' ')}`, lemma);
      const shared = overlap(gloss, tokens);
      const inName = words.some((w) => sharesWord(name, w));
      // A hit that names neither the search word nor a gloss word matched on something else.
      if (!shared && !inName && !words.some((w) => sharesWord(`${description} ${categories}`, w))) return null;
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
    '&iiextmetadatafilter=Artist|LicenseShortName' +
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

function imageFromInfo(file: string, title: string, info: ImageInfo | undefined): SenseImage | null {
  if (!info || !info.thumburl || !info.url) return null;
  if (info.mime && !/^image\//.test(info.mime)) return null;
  const isSvg = /svg/.test(info.mime || '') || /\.svg$/i.test(file);
  const thumb = bareUrl(info.thumburl);
  let url = bareUrl(info.url);
  if (((info.width || 0) > LARGE_WIDTH || isSvg) && thumb.includes(`/${THUMB_WIDTH}px-`)) {
    url = thumb.replace(`/${THUMB_WIDTH}px-`, `/${LARGE_WIDTH}px-`);
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

function client(): { http: HttpClient; headers?: Record<string, string> } {
  if (isCoreConfigured()) return { http: getHttp(), headers: { 'Api-User-Agent': API_UA } };
  return { http: fetchClient };
}

const jsonCache = new Map<string, Promise<unknown>>();

function getJson<T>(url: string): Promise<T | null> {
  const hit = jsonCache.get(url);
  if (hit) return hit as Promise<T | null>;
  const { http, headers } = client();
  const p = http
    .requestJson<T>(url, { headers, timeoutMs: TIMEOUT_MS })
    .catch((): null => {
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

const resultCache = new Map<string, Promise<Array<SenseImage | null>>>();

async function readPersisted(key: string): Promise<Array<SenseImage | null> | null> {
  const store = getLookupCache();
  if (!store) return null;
  try {
    const hit = await store.get(key);
    if (!hit || Date.now() - hit.savedAt > PERSIST_TTL_MS || !Array.isArray(hit.value)) return null;
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

async function resolveSenseImages(
  lemma: string,
  senses: SenseInput[],
  max: number,
  lang: string,
): Promise<Array<SenseImage | null>> {
  const picks: Array<Pick | null> = senses.map((): null => null);
  const code = String(lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  const isEnglish = code === 'en';

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
  // A word with no concrete noun sense rarely gets a strict match, so its fallback query
  // starts now, beside the Wiktionary request, instead of after it.
  const fallbackReq = fallbackTitleQuery(lemma, senses, code);
  const earlyFallback = !candidates.length && fallbackReq ? titleQuery(fallbackReq.url) : null;

  const wikt = await wiktionaryImages(lemma, code);
  const matches = matchWiktionaryImages(wikt, senses, lemma);
  let count = 0;
  for (const m of matches) {
    if (count >= max) break;
    const img = wikt[m.imageIndex];
    picks[m.senseIndex] = { file: img.file, title: img.caption || img.senseText };
    count += 1;
  }

  const usedFiles = new Set(picks.filter(Boolean).map((p) => (p as Pick).file.toLowerCase()));
  const tryPage = (i: number, page: WikipediaPage | null): boolean => {
    if (!page?.pageimage) return false;
    const file = page.pageimage.replace(/_/g, ' ');
    if (usedFiles.has(file.toLowerCase())) return false;
    usedFiles.add(file.toLowerCase());
    picks[i] = { file, title: page.title };
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

  // Searches ("crane bird gruidae" finds "Crane (bird)") for up to two candidates still bare,
  // run in parallel, English only.
  const bare = isEnglish ? candidates.filter((i) => !picks[i]).slice(0, Math.min(2, max - count)) : [];
  if (bare.length) {
    const results = await Promise.all(
      bare.map((i) => wikipediaPages(buildWikipediaSearchUrl(buildSenseSearchQuery(lemma, senses[i].meaning)))),
    );
    bare.forEach((i, k) => {
      if (count >= max) return;
      tryPage(i, pickWikipediaPage(results[k], lemma, senses[i].meaning, lemma, { strict: i !== firstNoun }));
    });
  }

  const files = picks.filter(Boolean).map((p) => (p as Pick).file);
  let out: Array<SenseImage | null> = senses.map((): null => null);
  if (files.length) {
    const infos = await imageInfos(files);
    out = picks.map((p) => (p ? imageFromInfo(p.file, p.title, infos.get(p.file.toLowerCase())) : null));
  }
  if (out.some(Boolean)) return out;

  // No sense-specific picture: the best picture for the word as a whole goes on the first sense.
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
 * call; the Commons search carries its own file metadata and runs only when they all fail.
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
  const tryFiles = ordered.slice(0, 4);
  if (tryFiles.length) {
    const infos = await imageInfos(tryFiles.map((p) => p.file));
    for (const p of tryFiles) {
      const img = imageFromInfo(p.file, p.title, infos.get(p.file.toLowerCase()));
      if (img) return img;
    }
  }
  const query = commonsSearchQuery(lemma, senses, lang);
  const ranked = rankCommonsFiles(await commonsSearch(query), query, lemma, glossUnion(senses, lemma));
  for (const r of ranked) {
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
  if (hit) return hit;
  const p = (async () => {
    const saved = await readPersisted(key);
    if (saved && saved.length === list.length) return saved;
    try {
      const out = await resolveSenseImages(word, list, max, lang);
      writePersisted(key, out);
      return out;
    } catch {
      resultCache.delete(key);
      return list.map((): null => null);
    }
  })();
  if (resultCache.size > 200) resultCache.clear();
  resultCache.set(key, p);
  return p;
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
