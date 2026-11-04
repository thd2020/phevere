/**
 * Suggestions for a search field: the commonest English words that begin with what was typed.
 *
 * The shipped word books answer at once and offline. Each frequency-ordered book is a slice of
 * the English frequency list, so a word's place in the book stands for its rank: NGSL's order
 * is used as is, and the other books are scaled to the vocabulary size they cover. Online,
 * Datamuse's prefix search with corpus frequencies (`sp=equi*&md=fp`) widens the list. (Its
 * `/sug` autocomplete ranks by how often people look a word up, "thrust" first for "th", and
 * echoes misspellings back, so it is not used.) When nothing begins with what was typed, the
 * closest common spellings are offered instead: "recieve" suggests "receive".
 * Proper nouns and inflected forms whose base is also listed are left out.
 */
import { WORDBOOKS, loadWordbook } from './wordbooks';
import { getHttp, isCoreConfigured } from './runtime';
import { typoDistance } from './vocab-lemma';

/** Rough size of the vocabulary each frequency-ordered book is drawn from. */
const BOOK_SPAN: Record<string, number> = {
  starter: 1200,
  zhongkao: 2000,
  gaokao: 4000,
  cet4: 6000,
  cet6: 9000,
  kaoyan: 9000,
  bsl: 12000,
  tsl: 12000,
};

let index: Promise<Array<{ w: string; r: number }>> | null = null;
let ready: Array<{ w: string; r: number }> | null = null;
type Ranked = { w: string; r: number };
/** Per typed prefix: Datamuse's words with an estimated rank, and corrections when none begin with it. */
type Remote = { words: Ranked[]; fixes: string[] };
const remote = new Map<string, Remote>();
const pending = new Map<string, Promise<Remote>>();
/** Zipf's law: a word used f times per million is roughly the (60000 / f)th commonest. */
const ZIPF = 60000;

function rankWords(books: Array<{ id: string; order?: string; words: string[] }>): Array<{ w: string; r: number }> {
  const rank = new Map<string, number>();
  const put = (w: string, r: number) => {
    const k = w.trim().toLowerCase();
    if (!k || !/^[a-z][a-z' -]*$/.test(k)) return;
    const have = rank.get(k);
    if (have === undefined || r < have) rank.set(k, r);
  };
  for (const b of books) {
    const n = b.words.length || 1;
    b.words.forEach((w, i) => {
      if (b.id === 'ngsl') put(w, i);
      else if (b.order === 'frequency') put(w, 3000 + (i / n) * (BOOK_SPAN[b.id] ?? 12000));
      else put(w, 30000 + i);
    });
  }
  return [...rank].map(([w, r]) => ({ w, r })).sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));
}

/** Load the word books once; later calls share the same promise. */
export function warmSuggestions(): Promise<void> {
  if (!index) {
    index = Promise.all(
      WORDBOOKS.map(async (m) => ({ id: m.id, order: m.order, words: await loadWordbook(m.id) })),
    ).then((books) => {
      ready = rankWords(books);
      return ready;
    });
  }
  return index.then((): void => undefined);
}

/** Binary search for the first word at or after `prefix` in the sorted index. */
function localMatches(prefix: string, max: number): string[] {
  return localRanked(prefix, max).map((h) => h.w);
}

function localRanked(prefix: string, max: number): Ranked[] {
  if (!ready) return [];
  let lo = 0;
  let hi = ready.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ready[mid].w < prefix) lo = mid + 1;
    else hi = mid;
  }
  const hits: Array<{ w: string; r: number }> = [];
  for (let i = lo; i < ready.length && ready[i].w.startsWith(prefix); i++) hits.push(ready[i]);
  return hits.sort((a, b) => a.r - b.r || a.w.length - b.w.length).slice(0, max);
}

/** "changes", "changed", "victims", "studies": a form whose base is also a candidate. */
function isInflectionOf(w: string, has: (b: string) => boolean): boolean {
  const bases: string[] = [];
  if (w.endsWith('ies')) bases.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) bases.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) bases.push(w.slice(0, -1));
  if (w.endsWith('ied')) bases.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('ed')) bases.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) bases.push(w.slice(0, -3), `${w.slice(0, -3)}e`);
  // "equipped", "stopping": the doubled final consonant.
  const doubled = /([b-df-hj-np-tv-z])\1(?:ed|ing)$/.exec(w);
  if (doubled) bases.push(w.slice(0, doubled.index + 1));
  return bases.some((b) => b.length > 1 && has(b));
}

function merge(prefix: string, fromRemote: Remote | undefined, max: number): string[] {
  // A word known to both takes the better of the book rank and the corpus estimate.
  const best = new Map<string, number>();
  for (const e of [...localRanked(prefix, max * 4), ...(fromRemote?.words || [])]) {
    if (!e.w.startsWith(prefix)) continue;
    const have = best.get(e.w);
    if (have === undefined || e.r < have) best.set(e.w, e.r);
  }
  const ranked = [...best].sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).map(([w]) => w);
  const out: string[] = [];
  const seen = new Set<string>([prefix]);
  const add = (w: string) => {
    const k = w.toLowerCase();
    if (seen.has(k) || out.length >= max) return;
    seen.add(k);
    out.push(w);
  };
  // What was typed looks misspelt: corrections first, and no rare spellings after them.
  const misspelt = !ranked.length || !!fromRemote?.fixes.length;
  if (misspelt) for (const w of [...localCorrections(prefix, max), ...(fromRemote?.fixes || [])]) add(w);
  for (const w of ranked) {
    if (misspelt && (best.get(w) ?? 0) > ZIPF / 0.1) continue;
    if (!isInflectionOf(w, (b) => best.has(b))) add(w);
  }
  return out;
}

function key(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** What can be shown right now without waiting: remote results if cached, else the books. */
export function peekSuggestions(q: string, max = 6): string[] {
  const k = key(q);
  if (!k) return [];
  return merge(k, remote.get(k), max);
}

type DatamuseRow = { word?: string; tags?: string[] };

async function fetchRemote(k: string): Promise<Remote> {
  const http = getHttp();
  const rows = await http
    .requestJson<DatamuseRow[]>(`https://api.datamuse.com/words?sp=${encodeURIComponent(`${k}*`)}&md=fp&max=300`, { timeoutMs: 2500 })
    .catch((): DatamuseRow[] => []);
  const listed = (Array.isArray(rows) ? rows : []).filter(
    (r) => r.word && freq(r) > 0.003 && !(r.tags || []).includes('prop') && (k.includes(' ') || !r.word.includes(' ')),
  );
  const words = listed.map((r) => ({ w: String(r.word).toLowerCase(), r: ZIPF / freq(r) }));
  // When every match is rarer than one use in ten million words ("recieve", "recieved"), and
  // the typed word itself is rare ("accomodate"), it is probably misspelt: look for close
  // common spellings too.
  const exact = listed.find((r) => r.word === k);
  const common = (exact && freq(exact) >= 0.5) || listed.some((r) => r.word !== k && freq(r) >= 0.1);
  if (common || localMatches(k, 1).length || k.length < 4) return { words, fixes: [] };
  const near = await http
    .requestJson<DatamuseRow[]>(`https://api.datamuse.com/words?sp=${encodeURIComponent(k)}&md=f&max=10`, { timeoutMs: 2500 })
    .catch((): DatamuseRow[] => []);
  const fixes = (Array.isArray(near) ? near : [])
    .filter((r) => r.word && freq(r) >= 0.5 && typoDistance(r.word, k) <= 2)
    .sort((a, b) => freq(b) - freq(a))
    .map((r) => String(r.word));
  return { words, fixes };
}

function freq(r: DatamuseRow): number {
  return Number((r.tags || []).find((t) => t.startsWith('f:'))?.slice(2) || 0);
}

/** Common words within a typo or two of `k`, for when nothing begins with it. */
function localCorrections(k: string, max: number): string[] {
  if (!ready || k.length < 4 || /\s/.test(k)) return [];
  const limit = k.length >= 8 ? 2 : 1;
  return ready
    .filter((e) => Math.abs(e.w.length - k.length) <= limit && e.w[0] === k[0])
    .map((e) => ({ ...e, d: typoDistance(e.w, k) }))
    .filter((e) => e.d <= limit)
    .sort((a, b) => a.d - b.d || a.r - b.r)
    .slice(0, max)
    .map((e) => e.w);
}

/** Suggestions for `q`, asking Datamuse once per prefix. Never rejects. */
export async function suggestWords(q: string, max = 6): Promise<string[]> {
  const k = key(q);
  if (!k || k.length > 40) return [];
  await warmSuggestions();
  if (!remote.has(k) && isCoreConfigured() && /^[a-z][a-z' -]*$/.test(k)) {
    let p = pending.get(k);
    if (!p) {
      p = fetchRemote(k);
      pending.set(k, p);
    }
    const got = await p;
    pending.delete(k);
    if (remote.size > 400) remote.clear();
    remote.set(k, got);
  }
  return merge(k, remote.get(k), max);
}

/** For tests: rank a fixed set of books without loading the shipped ones. */
export function _setSuggestionBooks(books: Array<{ id: string; order?: string; words: string[] }>): void {
  ready = rankWords(books);
  index = Promise.resolve(ready);
  remote.clear();
}
