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
    const b = bucket(link);
    if (b && route[route.length - 1] !== b) route.push(b);
  }
  // The deepest attested language is the origin; Middle and Old English on their own mean the
  // word is native. Anything English that sits before a foreign source is just the route in.
  const foreign = route.filter((b) => b !== 'Old English');
  const origin = foreign.length ? foreign[foreign.length - 1] : route.length ? 'Old English' : '';
  const via = foreign.slice(0, -1).filter((b, i, all) => all.indexOf(b) === i && b !== origin).reverse();
  return { origin, via, roots: roots.slice(0, 2) };
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

type Cached = WordEtymon & { at: number; miss?: boolean; base?: string };

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
  saveTimer = setTimeout(() => {
    saveTimer = null;
    store?.set(STORE_KEY, JSON.stringify(memo || {}));
  }, 1500);
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

async function wikitext(page: string): Promise<string | null> {
  const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&redirects=1&maxlag=5&origin=*`;
  const text = await getText(url);
  if (text == null) return null;
  try {
    const json = JSON.parse(text);
    if (json?.error?.code === 'missingtitle') return '';
    if (json?.error) return null;
    return json?.parse?.wikitext?.['*'] || '';
  } catch {
    // "You are making too many requests" comes back as plain text.
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

let running: Promise<void> | null = null;

/**
 * Trace the words not traced yet, twenty pages per request and one request at a time
 * (Wikimedia asks API clients to run requests in series), calling `onProgress` as results come
 * in. A failed or throttled request stops the run without recording anything, so those words
 * are tried again next time. A second call while one is running waits for the first.
 */
export function traceEtymons(lemmas: string[], onProgress?: (p: TraceProgress) => void): Promise<void> {
  if (running) return running;
  const map = cacheMap();
  const now = Date.now();
  const todo = [...new Set(lemmas.map((l) => l.trim().toLowerCase()))].filter((l) => {
    if (!/^[a-z][a-z' -]*$/.test(l)) return false;
    const hit = map[l];
    return !hit || (hit.miss && now - hit.at > MISS_RETRY_MS);
  });
  if (!todo.length) return Promise.resolve();
  running = (async () => {
    let done = 0;
    let failures = 0;
    const total = todo.length;
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
        const found = !!(e.origin || e.roots.length);
        const base = found ? '' : baseWord(text).toLowerCase();
        map[lemma] = { ...e, at: Date.now(), ...(found ? {} : { miss: true }), ...(base && base !== lemma ? { base } : {}) };
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
        delete hit.miss;
      }
    }
    scheduleSave();
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

export async function traceRootGlosses(roots: string[]): Promise<void> {
  cachedRootGloss('');
  const todo = [...new Set(roots)].filter((r) => r && !(r in glossMemo!));
  for (const root of todo) {
    const page = `Reconstruction:Proto-Indo-European/${root.replace(/^\*/, '')}`;
    const text = await wikitext(page);
    if (text == null) break;
    glossMemo![root] = rootGlossFromWikitext(text);
    await sleep(120);
  }
  if (todo.length) (store || localStore())?.set(ROOT_GLOSS_KEY, JSON.stringify(glossMemo));
}
