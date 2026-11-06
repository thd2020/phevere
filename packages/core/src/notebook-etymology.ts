/**
 * Origins and deep roots for notebook words, read from Wiktionary's etymology templates.
 *
 * The morpheme tables in `morphology.ts` only catch classical roots that show in the spelling,
 * so most everyday words ("churn", "boulder") land in no family. Wiktionary records where each
 * word came from ({{inh|en|ang|...}}, {{bor|en|fr|...}}) and, for most inherited and Latin or
 * Greek words, the Proto-Indo-European root ({{root|en|ine-pro|*bʰer-}}). One request per word
 * gives both; results are kept in a small persistent cache so each word is traced once.
 */
import {
  buildEtymology,
  etymonTemplateLinks,
  extractEnglishEtymologySections,
  extractLanguageSection,
  languageName,
  scanTemplates,
  templateToLink,
  type EtymologyLink,
} from './etymology';
import { getHttp, isCoreConfigured } from './runtime';

export interface WordEtymon {
  /** Where the word came from, bucketed: "Latin", "Greek", "Old English", "Old Norse", "Arabic". */
  origin: string;
  /** Languages it passed through on the way, nearest first: ["French"] for Latin via French. */
  via: string[];
  /** Proto-Indo-European roots, as written on Wiktionary: "*bʰer-". */
  roots: string[];
  /**
   * The earlier words it came from, nearest first, as [Wiktionary language code, word as
   * written]: attest has [["frm", "attester"], ["la", "attēstor"]]. Two saved words that came
   * from the same word share its root, whether or not the spelling shows it.
   */
  sources?: Array<[string, string]>;
}

export interface EtymonStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const STORE_KEY = 'phevere.etymons.v1';
const ROOT_GLOSS_KEY = 'phevere.pie-glosses.v2';
const UA = 'Phevere/3.0 (https://github.com/thd2020/phevere)';
/** Words with no etymology on Wiktionary are retried after this long. */
const MISS_RETRY_MS = 14 * 86_400_000;

const BUCKET: Record<string, string> = {
  Latin: 'Latin', 'Classical Latin': 'Latin', 'Late Latin': 'Latin', 'Medieval Latin': 'Latin',
  'New Latin': 'Latin', 'Vulgar Latin': 'Latin', 'Ecclesiastical Latin': 'Latin',
  'Ancient Greek': 'Greek', 'Byzantine Greek': 'Greek', Greek: 'Greek', 'Koine Greek': 'Greek',
  'Old French': 'French', 'Middle French': 'French', 'Anglo-Norman': 'French', French: 'French',
  'Old Northern French': 'French',
  'Old English': 'Old English', 'Middle English': 'Old English',
  'Old Norse': 'Old Norse', 'Old Swedish': 'Old Norse', 'Old Danish': 'Old Norse',
  'Middle Dutch': 'Dutch', Dutch: 'Dutch', 'Middle Low German': 'Low German',
};

/** Wiktionary family codes used when a source is only known as a branch. */
const FAMILY_CODE: Record<string, string> = {
  gem: 'Germanic', gmw: 'Germanic', gmq: 'Old Norse', roa: 'French', itc: 'Latin', grk: 'Greek', sem: 'Semitic',
  frk: 'Frankish', 'gmq-osw': 'Old Norse', 'gmq-oda': 'Old Norse',
};

const PASSED_THROUGH = new Set(['inherited', 'borrowed', 'learned borrowing', 'semi-learned borrowing', 'derived', 'calque']);

/** Etymology-only variants ("la-new", "ang-ang") fall back to their main language's code. */
const MAIN_CODE: Record<string, string> = { la: 'la', ang: 'ang', enm: 'enm', grc: 'grc', fro: 'fro', frm: 'frm', non: 'non' };

function bucket(link: EtymologyLink): string {
  const code = link.languageCode || '';
  if (!code || code === 'en' || code.endsWith('-pro')) return '';
  const main = MAIN_CODE[code.split('-')[0]];
  const known = languageName(code);
  const name = (known && known !== code ? known : '') || FAMILY_CODE[code] || (main ? languageName(main) : '') || '';
  if (!name || /^Proto-/.test(name)) return '';
  return BUCKET[name] || name;
}

/** Form-of templates: {{plural of|en|berry}}, {{infl of|en|attenuate||ed-form}}, {{en-past of|tear}}. */
const FORM_OF = /\{\{\s*(?:en-)?[a-z -]*?(?:of|form)\s*\|\s*(?:en\s*\|\s*)?([^|}=]+)/i;

/**
 * The word to trace instead when this page has no etymology of its own: the lemma of an
 * inflected form ("berries" → "berry"), or the base of an English derivation
 * ("aggregator" → "aggregate").
 */
export function baseWord(wikitext: string): string {
  const at = wikitext.indexOf('==English==');
  const english = at >= 0 ? wikitext.slice(at).split(/\n==[^=]/)[0] : wikitext;
  const form = english.match(FORM_OF);
  if (form) return form[1].trim();
  // Affix templates are not part of the ancestry chain, so read them from the section itself.
  const section = extractEnglishEtymologySections(wikitext)[0] || '';
  for (const t of scanTemplates(section)) {
    const links = t.name === 'etymon' || t.name === 'ety' ? etymonTemplateLinks(t) : [templateToLink(t)];
    for (const link of links) {
      if (!link || link.relation !== 'affix' || (link.languageCode && link.languageCode !== 'en')) continue;
      const stems = (link.parts || []).filter((p) => !p.startsWith('-') && !p.endsWith('-') && !/[=:<]/.test(p));
      if (stems.length) return stems.sort((x, y) => y.length - x.length)[0];
    }
  }
  return '';
}

/** Origin, route and PIE roots from a parsed etymology chain. */
export function etymonFromChain(chain: EtymologyLink[] | undefined): WordEtymon {
  const route: string[] = [];
  const roots: string[] = [];
  const sources: Array<[string, string]> = [];
  for (const link of chain || []) {
    if (link.relation === 'root' && link.languageCode === 'ine-pro' && link.term) {
      if (!roots.includes(link.term)) roots.push(link.term);
      continue;
    }
    if (!PASSED_THROUGH.has(link.relation)) continue;
    if (link.languageCode === 'ine-pro' && link.term && link.relation === 'derived' && !roots.includes(link.term)) {
      roots.push(link.term);
      continue;
    }
    const code = link.languageCode || '';
    const term = (link.term || '').replace(/<[^>]*>/g, '').trim();
    if (code && code !== 'en' && term && !sources.some(([c, t]) => c === code && t === term)) sources.push([code, term]);
    const b = bucket(link);
    if (b && route[route.length - 1] !== b) route.push(b);
  }
  // The deepest attested language is the origin; Middle and Old English on their own mean the
  // word is native. Anything English that sits before a foreign source is just the route in.
  const foreign = route.filter((b) => b !== 'Old English');
  const origin = foreign.length ? foreign[foreign.length - 1] : route.length ? 'Old English' : '';
  const via = foreign.slice(0, -1).filter((b, i, all) => all.indexOf(b) === i && b !== origin).reverse();
  return { origin, via, roots: roots.slice(0, 2), sources: sources.slice(0, 6) };
}

/**
 * The Wiktionary page of an earlier word: reconstructions live under "Reconstruction:", and
 * Latin, Old English and Ancient Greek entries are titled without length marks (attēstor is
 * at "attestor", ġyldan at "gyldan").
 */
export function sourcePageTitle(code: string, term: string): string {
  const bare = term.replace(/^\*/, '');
  if (code.endsWith('-pro')) {
    const name = languageName(code);
    return name && name !== code ? `Reconstruction:${name}/${bare}` : '';
  }
  let t = bare.normalize('NFD').replace(/[̄̆]/g, '');
  if (/^(la|ang|enm)(-|$)/.test(code)) t = t.replace(/[̀́̇]/g, '');
  return t.normalize('NFC');
}

/**
 * The Proto-Indo-European roots an earlier word's own entry names ({{root|la|ine-pro|*bʰer-}}).
 * `older` is the word that one came from in turn, as the saved word's chain writes it.
 *
 * A page with several numbered etymologies holds unrelated homographs (Middle English "foul"
 * is both foul and fowl), so only the etymology that names `older` is read, and none when that
 * does not pick out exactly one. A preposition or prefix (Latin "ex", "sub") is the first part
 * of a compound, not its stem, so its root is not the word's.
 */
export function rootsOnSourcePage(wikitext: string, code: string, older?: string): string[] {
  const name = languageName(code) || '';
  let section = code.endsWith('-pro') ? wikitext : extractLanguageSection(wikitext, name);
  const heads = [...section.matchAll(/^(={3,})\s*Etymology\s+\d+\s*\1\s*$/gim)];
  if (heads.length > 1) {
    const blocks = heads.map((h, i) => section.slice(h.index, heads[i + 1]?.index));
    const named = older ? blocks.filter((b) => b.includes(older)) : [];
    if (named.length !== 1) return [];
    section = named[0];
  }
  const pos = [...section.matchAll(/^={3,}\s*([A-Za-z ]+?)\s*={3,}\s*$/gm)].map((m) => m[1].toLowerCase());
  const stem = pos.some((p) => /^(noun|proper noun|verb|adjective|participle|numeral)$/.test(p));
  if (!stem && pos.some((p) => /^(preposition|prefix|conjunction|particle)$/.test(p))) return [];
  const roots: string[] = [];
  const add = (r: string | undefined) => {
    const root = String(r || '').replace(/<[^>]*>/g, '').trim();
    if (root.startsWith('*') && !roots.includes(root)) roots.push(root);
  };
  for (const t of scanTemplates(section)) {
    if (t.name === 'root' && t.positional[1] === 'ine-pro') t.positional.slice(2).forEach(add);
    else if (/^(inh|der|uder)\+?$/.test(t.name) && t.positional[1] === 'ine-pro') add(t.positional[2]);
    else if (t.name === 'etymon' || t.name === 'ety') for (const k of etymonTemplateLinks(t)) if (k.languageCode === 'ine-pro') add(k.term);
  }
  return roots.slice(0, 2);
}

function localStore(): EtymonStore | null {
  const ls = (globalThis as any).localStorage;
  if (!ls) return null;
  return {
    get: (k) => {
      try {
        return ls.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        ls.setItem(k, v);
      } catch {
        /* storage full or blocked: the next session traces again */
      }
    },
  };
}

/**
 * Version 2 (2026-11-06) records the words each word came from and reads their pages for a
 * Proto-Indo-European root when the word's own page names none. Words traced by version 1 are
 * traced again once.
 */
const ETYMON_VERSION = 2;

type Cached = WordEtymon & { at: number; miss?: boolean; base?: string; v?: number };

let memo: Record<string, Cached> | null = null;
let store: EtymonStore | null = null;

function cacheMap(): Record<string, Cached> {
  if (memo) return memo;
  store = store || localStore();
  try {
    memo = JSON.parse(store?.get(STORE_KEY) || '{}') || {};
  } catch {
    memo = {};
  }
  return memo!;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, 1500);
}

/** Write the cache at the end of a run, so a run that finishes is never lost to a pending timer. */
function saveNow(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  store?.set(STORE_KEY, JSON.stringify(memo || {}));
}

/** Use a different store than localStorage (tests, or a shell with its own storage). */
export function setEtymonStore(s: EtymonStore | null): void {
  store = s;
  memo = null;
}

/** What is known about a word already, without a request. */
export function cachedEtymon(lemma: string): WordEtymon | null {
  const hit = cacheMap()[lemma.toLowerCase()];
  return hit && !hit.miss ? hit : null;
}

/** The page text, '' when the page has none, or null when the request failed or was throttled. */
async function getText(url: string): Promise<string | null> {
  try {
    if (isCoreConfigured()) {
      const res = await getHttp().requestText(url, { headers: { 'Api-User-Agent': UA }, timeoutMs: 8000 });
      return res.ok ? res.text : null;
    }
    const res = await fetch(url, { headers: { 'Api-User-Agent': UA } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Several pages' wikitext in one request (the API takes up to 50 titles; 20 keeps responses
 * small). Keys are the titles asked for; '' means the page does not exist. Null on failure.
 */
async function wikitexts(titles: string[]): Promise<Map<string, string> | null> {
  const url =
    'https://en.wiktionary.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main' +
    `&format=json&formatversion=2&redirects=1&maxlag=5&origin=*&titles=${encodeURIComponent(titles.join('|'))}`;
  const text = await getText(url);
  if (text == null) return null;
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (json?.error || !json?.query) return null;
  // Follow "normalized" (first letter case) and "redirects" back to the title we asked for.
  const back = new Map<string, string>();
  for (const n of json.query.normalized || []) back.set(n.to, back.get(n.from) || n.from);
  for (const r of json.query.redirects || []) back.set(r.to, back.get(r.from) || r.from);
  const out = new Map<string, string>(titles.map((t) => [t, '']));
  for (const page of json.query.pages || []) {
    const asked = back.get(page.title) || page.title;
    const content = page.revisions?.[0]?.slots?.main?.content;
    if (typeof content === 'string') out.set(asked, content);
  }
  return out;
}

export interface TraceProgress {
  done: number;
  total: number;
}

let running: Promise<number> | null = null;

/**
 * Trace the words not traced yet, twenty pages per request and one request at a time
 * (Wikimedia asks API clients to run requests in series), calling `onProgress` as results come
 * in. A failed or throttled request stops the run without recording anything, so those words
 * are tried again next time. A second call while one is running waits for the first.
 */
export function traceEtymons(lemmas: string[], onProgress?: (p: TraceProgress) => void): Promise<number> {
  if (running) return running;
  const map = cacheMap();
  const now = Date.now();
  const todo = [...new Set(lemmas.map((l) => l.trim().toLowerCase()))].filter((l) => {
    if (!/^[a-z][a-z' -]*$/.test(l)) return false;
    const hit = map[l];
    return !hit || (hit.miss && now - hit.at > MISS_RETRY_MS) || (!hit.miss && (hit.v || 1) < ETYMON_VERSION);
  });
  if (!todo.length) return Promise.resolve(0);
  running = (async () => {
    let done = 0;
    let recorded = 0;
    let failures = 0;
    let total = todo.length;
    const followed = new Set<string>();
    for (let i = 0; i < todo.length; ) {
      const batch = todo.slice(i, i + 20);
      const pages = await wikitexts(batch);
      if (!pages) {
        if (++failures >= 5) break;
        await sleep(8000 * 2 ** (failures - 1));
        continue;
      }
      failures = 0;
      for (const lemma of batch) {
        const text = pages.get(lemma) || '';
        const chain = text ? buildEtymology(text)?.chain : undefined;
        const e = etymonFromChain(chain);
        // A word saved in another language ("juventas") has no English entry; the words its
        // foreign entry came from, and the lemma it is a form of, say nothing about English roots.
        const english = /^==\s*English\s*==\s*$/m.test(text);
        if (!english) delete e.sources;
        const found = !!(e.origin || e.roots.length);
        const base = found || !english ? '' : baseWord(text).toLowerCase();
        map[lemma] = { ...e, at: Date.now(), v: ETYMON_VERSION, ...(found ? {} : { miss: true }), ...(base && base !== lemma ? { base } : {}) };
        recorded += 1;
        // Trace the base too (once), unless it is already known.
        if (base && base !== lemma && !followed.has(base) && (!map[base] || map[base].miss)) {
          followed.add(base);
          if (!todo.includes(base)) todo.push(base);
        }
      }
      i += batch.length;
      done = Math.min(total, done + batch.length);
      scheduleSave();
      onProgress?.({ done, total });
      await sleep(700);
    }
    // An inflected or derived word takes its base's origin and roots.
    for (const hit of Object.values(map)) {
      const base = hit.base ? map[hit.base] : undefined;
      if (hit.miss && base && !base.miss) {
        hit.origin = base.origin;
        hit.via = base.via;
        hit.roots = base.roots;
        hit.sources = base.sources;
        delete hit.miss;
      }
    }
    // Most English entries name no Proto-Indo-European root, but the Latin, Greek or Old English
    // word they came from often does: "transfer" names *bʰer- itself, "cerebrate" leaves it to
    // Latin cerebrum. For each word traced in this run that has no root yet, read the pages of
    // the words it came from, nearest first, and take the first root named.
    const traced = todo.map((l) => map[l]).filter((h): h is Cached => !!h && !h.miss && h.v === ETYMON_VERSION);
    const wanted = new Map<Cached, string[]>();
    for (const hit of traced) {
      if (hit.roots.length || !hit.sources?.length) continue;
      const titles = hit.sources.map(([code, term]) => (code === 'ine-pro' ? '' : sourcePageTitle(code, term)));
      if (titles.some(Boolean)) wanted.set(hit, titles);
    }
    const titles = [...new Set([...wanted.values()].flat().filter(Boolean))];
    const sourcePages = new Map<string, string>();
    total += titles.length;
    onProgress?.({ done, total });
    let complete = true;
    for (let i = 0; i < titles.length; ) {
      const batch = titles.slice(i, i + 20);
      const pages = await wikitexts(batch);
      if (!pages) {
        if (++failures >= 5) {
          complete = false;
          break;
        }
        await sleep(8000 * 2 ** (failures - 1));
        continue;
      }
      failures = 0;
      for (const [t, text] of pages) sourcePages.set(t, text);
      i += batch.length;
      done += batch.length;
      onProgress?.({ done, total });
      await sleep(700);
    }
    for (const [hit, pageTitles] of wanted) {
      for (let k = 0; k < pageTitles.length; k++) {
        const text = sourcePages.get(pageTitles[k]);
        const roots = text ? rootsOnSourcePage(text, hit.sources![k][0], hit.sources![k + 1]?.[1]) : [];
        if (roots.length) {
          hit.roots = roots;
          break;
        }
      }
      // Pages that never arrived are read again next time.
      if (!complete && !hit.roots.length) hit.v = 1;
    }
    for (const hit of Object.values(map)) {
      const base = hit.base ? map[hit.base] : undefined;
      if (base && !hit.roots.length && base.roots.length) hit.roots = base.roots;
    }
    saveNow();
    return recorded;
  })().finally(() => {
    running = null;
  });
  return running;
}

let glossMemo: Record<string, string> | null = null;

/** The first sense on a root's Wiktionary reconstruction page: "*bʰer-" → "to carry, bear". */
export function cachedRootGloss(root: string): string {
  if (!glossMemo) {
    try {
      glossMemo = JSON.parse((store || localStore())?.get(ROOT_GLOSS_KEY) || '{}') || {};
    } catch {
      glossMemo = {};
    }
  }
  return glossMemo![root] || '';
}

export function rootGlossFromWikitext(text: string): string {
  const line = text.split('\n').find((l) => /^#\s*[^:*#]/.test(l));
  if (!line) return '';
  return line
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?(<\/ref>|$)/gi, '')
    .replace(/\[https?:[^\]]*\]?/g, '')
    .replace(/^#\s*/, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?|<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.]+|[\s,;:.]+$/g, '')
    .slice(0, 60);
}

/** Fetch the glosses not asked for yet; returns how many were recorded (some may be ''). */
export async function traceRootGlosses(roots: string[]): Promise<number> {
  cachedRootGloss('');
  const todo = [...new Set(roots)].filter((r) => r && !(r in glossMemo!));
  let recorded = 0;
  const page = (root: string) => `Reconstruction:Proto-Indo-European/${root.replace(/^\*/, '')}`;
  // Twenty pages per request, like the words themselves.
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    const pages = await wikitexts(batch.map(page));
    if (!pages) break;
    for (const root of batch) glossMemo![root] = rootGlossFromWikitext(pages.get(page(root)) || '');
    recorded += batch.length;
    if (i + 20 < todo.length) await sleep(700);
  }
  if (recorded) (store || localStore())?.set(ROOT_GLOSS_KEY, JSON.stringify(glossMemo));
  return recorded;
}
