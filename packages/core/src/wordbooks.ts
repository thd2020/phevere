/**
 * Word books: the catalog shipped in `packages/core/wordbooks/` (built by
 * scripts/build-wordbooks.js, sources in docs/WORDBOOKS.md) and the pure model the Words views
 * share on desktop and phone.
 *
 * A scope is what the Words tab shows: 'mine' (My words), one book id, or 'all' (My words plus
 * every subscribed book, each word once). Every scope becomes a list of NotebookEntry, so List,
 * Families, Map, Cards and Review work unchanged. A saved word appears as its `vocab` row; a book
 * word that is not saved appears with the id `wb:<headword>` and the progress from `book_words`.
 */
import { WORDBOOK_CATALOG, type WordbookMeta } from './wordbook-catalog';
import { clean, dayStart, DAY, type NotebookEntry } from './notebook-shared';
import { isNewWord, memoryLevel, startReview, type ReviewState } from './review-quiz';
import { bookWordKey, DEFAULT_DAILY_NEW, type BookWordProgress, type WordbookSub } from './wordbook-store';

export type { WordbookMeta };

export type WordsScope = 'mine' | 'all' | string;
export type WordStatus = 'new' | 'learning' | 'known';

/** Every book, in learning-path order. */
export const WORDBOOKS: WordbookMeta[] = WORDBOOK_CATALOG.slice().sort((a, b) => a.rank - b.rank);

export function wordbookMeta(id: string): WordbookMeta | undefined {
  return WORDBOOKS.find((b) => b.id === id);
}

type BookFile = { words: string[] };
const LOADERS: Record<string, () => Promise<BookFile | { default: BookFile }>> = {
  starter: () => import('../wordbooks/starter.json'),
  zhongkao: () => import('../wordbooks/zhongkao.json'),
  gaokao: () => import('../wordbooks/gaokao.json'),
  cet4: () => import('../wordbooks/cet4.json'),
  cet6: () => import('../wordbooks/cet6.json'),
  kaoyan: () => import('../wordbooks/kaoyan.json'),
  ngsl: () => import('../wordbooks/ngsl.json'),
  nawl: () => import('../wordbooks/nawl.json'),
  tsl: () => import('../wordbooks/tsl.json'),
  bsl: () => import('../wordbooks/bsl.json'),
};

const loaded = new Map<string, string[]>();

/** The book's headwords in order, loaded on first use (each book is its own chunk). */
export async function loadWordbook(id: string): Promise<string[]> {
  const have = loaded.get(id);
  if (have) return have;
  const load = LOADERS[id];
  if (!load) return [];
  const mod = await load();
  const words = ((mod as { default?: BookFile }).default || (mod as BookFile)).words || [];
  loaded.set(id, words);
  return words;
}

/** For tests and for shells that load the words another way. */
export function registerWordbookWords(id: string, words: string[]): void {
  loaded.set(id, words);
}

/* ------------------------------------------------------------------ context */

export interface WordsContext {
  /** My words, every row. */
  mine: NotebookEntry[];
  /** Progress on unsaved book words, by lowercase headword. */
  progress: Map<string, BookWordProgress>;
  /** Active subscriptions, in learning-path order. */
  subs: WordbookSub[];
  /** Words of each subscribed book, as loaded. */
  books: Map<string, string[]>;
  /** Lowercase headword to the subscribed books that list it. */
  index: Map<string, string[]>;
  /** Lowercase lemma to the My words row. */
  saved: Map<string, NotebookEntry>;
}

export interface WordsEntry extends NotebookEntry {
  /** Subscribed books that list the word. */
  books?: string[] | null;
  /** Marked "already know it". */
  known?: boolean;
  saved?: boolean;
}

export function buildWordsContext(
  mine: NotebookEntry[],
  progress: BookWordProgress[] | Map<string, BookWordProgress>,
  subs: WordbookSub[],
  books: Map<string, string[]>,
): WordsContext {
  const rank = (id: string) => wordbookMeta(id)?.rank ?? 99;
  const active = subs.filter((s) => s.active && books.has(s.bookId)).sort((a, b) => rank(a.bookId) - rank(b.bookId));
  const index = new Map<string, string[]>();
  for (const s of active) {
    for (const w of books.get(s.bookId) || []) {
      const k = bookWordKey(w);
      const list = index.get(k);
      if (list) {
        if (!list.includes(s.bookId)) list.push(s.bookId);
      } else index.set(k, [s.bookId]);
    }
  }
  const saved = new Map<string, NotebookEntry>();
  for (const e of mine) {
    const k = bookWordKey(e.lemma);
    if (k && !saved.has(k)) saved.set(k, e);
  }
  const prog = progress instanceof Map ? progress : new Map(progress.map((p) => [bookWordKey(p.lemma), p]));
  return { mine, progress: prog, subs: active, books, index, saved };
}

/** The entry a headword shows as: its My words row when saved, otherwise the book progress. */
export function bookEntry(word: string, ctx: WordsContext): WordsEntry {
  const k = bookWordKey(word);
  const books = ctx.index.get(k);
  const p = ctx.progress.get(k);
  const mine = ctx.saved.get(k);
  if (mine) return { ...mine, books, known: !!p?.known, saved: true };
  return {
    id: `wb:${k}`,
    lemma: clean(word),
    definition: p?.definition,
    reading: p?.reading,
    partOfSpeech: p?.partOfSpeech,
    sourceLang: 'en',
    createdAt: p?.createdAt ?? 0,
    reviewDue: p?.reviewDue ?? null,
    reviewInterval: p?.reviewInterval ?? null,
    reps: p?.reps ?? 0,
    stability: p?.stability ?? null,
    difficulty: p?.difficulty ?? null,
    state: p?.state ?? null,
    lapses: p?.lapses ?? null,
    lastReview: p?.lastReview ?? null,
    books,
    known: !!p?.known,
    saved: false,
  };
}

export function isBookOnlyId(id: string): boolean {
  return String(id || '').startsWith('wb:');
}

export function wordStatus(e: WordsEntry): WordStatus {
  if (e.known) return 'known';
  const level = memoryLevel(e);
  if (level === 0) return 'new';
  return level === 3 ? 'known' : 'learning';
}

/** The words a scope shows. Book order for a book, newest first for My words. */
export function scopeEntries(scope: WordsScope, ctx: WordsContext): WordsEntry[] {
  const withBooks = (e: NotebookEntry): WordsEntry => {
    const k = bookWordKey(e.lemma);
    return { ...e, books: ctx.index.get(k), known: !!ctx.progress.get(k)?.known, saved: true };
  };
  if (scope === 'mine') return ctx.mine.map(withBooks);
  if (scope === 'all') {
    const out = ctx.mine.map(withBooks);
    const seen = new Set(out.map((e) => bookWordKey(e.lemma)));
    for (const s of ctx.subs) {
      for (const w of ctx.books.get(s.bookId) || []) {
        const k = bookWordKey(w);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(bookEntry(w, ctx));
      }
    }
    return out;
  }
  return (ctx.books.get(scope) || []).map((w) => bookEntry(w, ctx));
}

/* ----------------------------------------------------------------- progress */

export interface BookProgress {
  bookId: string;
  total: number;
  known: number;
  learning: number;
  /** New words started today. */
  startedToday: number;
  /** New words still to start today, by the daily goal. */
  newToday: number;
  /** Reviews due by the end of today. */
  due: number;
  dailyNew: number;
}

function startedOn(e: WordsEntry, today: number): boolean {
  if (e.saved) return false;
  return !isNewWord(e) && Number(e.createdAt || 0) >= today;
}

export function bookProgress(bookId: string, ctx: WordsContext, now = Date.now()): BookProgress {
  const today = dayStart(now);
  const end = today + DAY;
  const sub = ctx.subs.find((s) => s.bookId === bookId);
  const dailyNew = sub?.dailyNew ?? DEFAULT_DAILY_NEW;
  let known = 0;
  let learning = 0;
  let started = 0;
  let fresh = 0;
  let due = 0;
  const words = ctx.books.get(bookId) || [];
  for (const w of words) {
    const e = bookEntry(w, ctx);
    const st = wordStatus(e);
    if (st === 'known') known += 1;
    else if (st === 'learning') learning += 1;
    else fresh += 1;
    if (startedOn(e, today)) started += 1;
    if (st !== 'new' && !e.known && e.reviewDue != null && Number(e.reviewDue) < end) due += 1;
  }
  return {
    bookId,
    total: words.length,
    known,
    learning,
    startedToday: started,
    newToday: Math.min(fresh, Math.max(0, dailyNew - started)),
    due,
    dailyNew,
  };
}

/* ------------------------------------------------------------------- review */

export interface ScopeReviewOptions {
  now?: number;
  /** My words' daily goal and how many of its new words were started today. */
  mineGoal?: number;
  mineStartedToday?: number;
}

/**
 * Today's queue for a scope. Due words come from everywhere in the scope, most overdue first.
 * New words come from each book in its own order up to the book's daily goal (less what was
 * started today), and from My words oldest first up to its goal; in All books the sources take
 * turns. New words are spread evenly among the reviews.
 */
export function scopeReviewQueue(scope: WordsScope, ctx: WordsContext, opts: ScopeReviewOptions = {}): string[] {
  const now = opts.now ?? Date.now();
  const end = dayStart(now) + DAY;
  const entries = scopeEntries(scope, ctx);
  const due = entries
    .filter((e) => !isNewWord(e) && !(e.known && !e.saved) && e.reviewDue != null && Number(e.reviewDue) < end)
    .sort((x, y) => Number(x.reviewDue) - Number(y.reviewDue));
  const sources: WordsEntry[][] = [];
  if (scope === 'mine' || scope === 'all') {
    const goal = opts.mineGoal ?? DEFAULT_DAILY_NEW;
    sources.push(
      ctx.mine
        .filter((e) => isNewWord(e) && clean(e.lemma))
        .sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0))
        .slice(0, Math.max(0, goal - (opts.mineStartedToday ?? 0)))
        .map((e) => ({ ...e, saved: true })),
    );
  }
  const bookIds = scope === 'mine' ? [] : scope === 'all' ? ctx.subs.map((s) => s.bookId) : [scope];
  for (const id of bookIds) {
    const left = bookProgress(id, ctx, now).newToday;
    const list: WordsEntry[] = [];
    for (const w of ctx.books.get(id) || []) {
      if (list.length >= left) break;
      const e = bookEntry(w, ctx);
      if (!e.known && isNewWord(e) && !e.saved) list.push(e);
    }
    sources.push(list);
  }
  // Take turns, one word from each source, skipping a word another source already gave.
  const fresh: WordsEntry[] = [];
  const taken = new Set<string>();
  for (let i = 0, more = true; more; i++) {
    more = false;
    for (const src of sources) {
      if (i >= src.length) continue;
      more = true;
      const e = src[i];
      if (taken.has(e.id)) continue;
      taken.add(e.id);
      fresh.push(e);
    }
  }
  if (!due.length || !fresh.length) return [...due, ...fresh].map((e) => e.id);
  const out: WordsEntry[] = [];
  const step = Math.max(1, Math.floor(due.length / fresh.length));
  let f = 0;
  due.forEach((e, i) => {
    out.push(e);
    if ((i + 1) % step === 0 && f < fresh.length) out.push(fresh[f++]);
  });
  return [...out, ...fresh.slice(f)].map((e) => e.id);
}

/** A review session for a scope, ready for `reviewHtml`. */
export function startScopeReview(scope: WordsScope, ctx: WordsContext, opts: ScopeReviewOptions = {}): ReviewState {
  const now = opts.now ?? Date.now();
  return { ...startReview([], 0, now), queue: scopeReviewQueue(scope, ctx, opts) };
}

/** Queued book words still without a meaning, next first; the shell looks them up ahead of time. */
export function reviewNeedsMeaning(state: ReviewState, entries: NotebookEntry[], ahead = 3): string[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: string[] = [];
  for (let i = state.index; i < state.queue.length && out.length < ahead; i++) {
    const e = byId.get(state.queue[i]);
    if (e && isBookOnlyId(e.id) && !clean(e.definition) && !out.includes(e.lemma)) out.push(e.lemma);
  }
  return out;
}

/** Drops the current question without grading it ("already know it"). */
export function dropCurrentReview(state: ReviewState): void {
  if (state.index >= state.queue.length) return;
  state.queue.splice(state.index, 1);
  state.question = null;
  state.answer = null;
  state.revealed = false;
}
