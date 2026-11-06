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
import { dedupeLemmas, interleaveNew, isLearnable, isNewWord, memoryLevel, newWordAllowance, newWordsToday, reviewStateFor, type QueuePlan, type ReviewState, type StudyPace } from './review-quiz';
import { analyzeMorphemes, derivationStem } from './morphology';
import { bookWordKey, DEFAULT_DAILY_NEW, isUserBookId, type BookWordProgress, type UserBook, type WordbookSub } from './wordbook-store';
import { setMadeBookNames, shortBookTitle } from './book-names';
import { sourceGroupOf, type SourceGroupKey } from './source-context';
import { t } from './i18n/runtime';

export type { WordbookMeta };

/** A book's catalog entry, or one the learner made (`user`), with the source it came from. */
export type BookMeta = WordbookMeta & { user?: boolean; sourceKey?: string };

const madeMeta = new Map<string, BookMeta>();

function metaForMade(b: UserBook, rank: number): BookMeta {
  return {
    id: b.bookId,
    title: b.title,
    short: shortBookTitle(b.title),
    level: t('notebook.books.myBook'),
    source: '',
    sourceUrl: '',
    order: 'frequency',
    licence: '',
    licenceUrl: '',
    rank,
    count: b.words.length,
    retrieved: '',
    user: true,
    sourceKey: b.source,
  };
}

/** Registers the books the learner made, so they are named and ordered like shipped books. */
export function registerUserBooks(books: UserBook[]): void {
  madeMeta.clear();
  books
    .filter((b) => !b.deleted)
    .forEach((b, i) => madeMeta.set(b.bookId, metaForMade(b, 1000 + i)));
  setMadeBookNames(books);
}

export type WordsScope = 'mine' | 'all' | string;
export type WordStatus = 'new' | 'learning' | 'known';

/** Every book, in learning-path order. */
export const WORDBOOKS: WordbookMeta[] = WORDBOOK_CATALOG.slice().sort((a, b) => a.rank - b.rank);

export function wordbookMeta(id: string): BookMeta | undefined {
  return WORDBOOKS.find((b) => b.id === id) || madeMeta.get(id);
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
  shipped: Map<string, string[]>,
  userBooks?: UserBook[],
): WordsContext {
  // Books the learner made carry their own words.
  let books = shipped;
  if (userBooks) {
    registerUserBooks(userBooks);
    books = new Map(shipped);
    for (const b of userBooks) {
      if (b.deleted) books.delete(b.bookId);
      else books.set(b.bookId, b.words);
    }
  }
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

/** The words of a scope that Learn studies and counts (`isLearnable`); Words still shows every entry. */
export function learnScopeEntries(scope: WordsScope, ctx: WordsContext): WordsEntry[] {
  return scopeEntries(scope, ctx).filter(isLearnable);
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
  /** The learner's pace (`studyPace`): today's new words then fit beside today's reviews. */
  pace?: StudyPace | null;
}

/** Roots and stems of a word, for spotting family links ("nation" in "nationality", spect in inspect). */
function familyKeys(word: string): string[] {
  const keys: string[] = [];
  for (const m of analyzeMorphemes(word)) if (m.kind === 'root' && m.label.length >= 3) keys.push(`r:${m.label.toLowerCase()}`);
  const stem = derivationStem(word);
  if (stem.length >= 5) keys.push(`s:${stem.slice(0, 5)}`);
  return keys;
}

/** Why a new word was picked: the other books that list it and a started word of its family. */
export interface NewWordReason {
  books: number;
  family: string | null;
}

/**
 * The shipped books below each book's level. A word of 考研 that 中考 or 高考 already teaches is
 * one the learner most likely knows, so it waits until the book's own words run out.
 */
const LEVEL_BELOW: Record<string, string[]> = {
  zhongkao: ['starter'],
  gaokao: ['starter', 'zhongkao'],
  cet4: ['starter', 'zhongkao', 'gaokao'],
  cet6: ['starter', 'zhongkao', 'gaokao', 'cet4'],
  kaoyan: ['starter', 'zhongkao', 'gaokao'],
  ngsl: ['starter'],
};

export function levelBelow(bookId: string): string[] {
  return LEVEL_BELOW[bookId] || [];
}

/** Loads the books below each book's level, so new words can be picked at the book's own level. */
export async function primeBookLevels(bookIds: string[]): Promise<void> {
  const ids = new Set(bookIds.flatMap(levelBelow));
  for (const id of ids) await loadWordbook(id);
}

const belowCache = new Map<string, Set<string>>();

/** Words of the books below a book's level that are loaded; empty until `primeBookLevels`. */
function wordsBelow(bookId: string): Set<string> {
  const ids = levelBelow(bookId).filter((id) => loaded.has(id));
  const key = `${bookId}:${ids.join(',')}`;
  const hit = belowCache.get(key);
  if (hit) return hit;
  const set = new Set<string>();
  for (const id of ids) for (const w of loaded.get(id) || []) set.add(bookWordKey(w));
  belowCache.set(key, set);
  return set;
}

/**
 * New book words for today, picked across the scope's books as one pool. Each book offers the
 * next words at its own level first, in its own order (frequency order for every shipped book):
 * a word that a lower-level book such as 中考 or 高考 also lists comes only after those, since
 * the learner most likely knows it, and "Already know it" sets aside any that slip through. Within
 * that, words of a family you have started, and words more of your books list, move a little
 * forward. Each book's daily goal sets how many words the pool gives.
 */
export function pickNewBookWords(bookIds: string[], ctx: WordsContext, now = Date.now(), dueCount = 0, reasons?: Map<string, NewWordReason>, cap = Infinity): WordsEntry[] {
  let quota = 0;
  let goals = 0;
  const cands = new Map<string, { e: WordsEntry; rank: number }>();
  for (const id of bookIds) {
    const p = bookProgress(id, ctx, now);
    quota += p.newToday;
    goals += p.dailyNew;
    if (!p.newToday) continue;
    const window = p.newToday * 4 + 20;
    const below = wordsBelow(id);
    const level: string[] = [];
    const common: string[] = [];
    for (const w of ctx.books.get(id) || []) {
      if (level.length >= window) break;
      const k = bookWordKey(w);
      if (ctx.saved.has(k)) continue;
      const prog = ctx.progress.get(k);
      if (prog && (prog.known || Number(prog.reps) > 0 || prog.lastReview != null || Number(prog.state) > 0)) continue;
      if (below.has(k)) {
        if (common.length < window) common.push(w);
      } else level.push(w);
    }
    const ordered = [...level, ...common].slice(0, window);
    ordered.forEach((w, n) => {
      const k = bookWordKey(w);
      const rank = n / window;
      const prev = cands.get(k);
      if (!prev || rank < prev.rank) cands.set(k, { e: bookEntry(w, ctx), rank });
    });
  }
  quota = Math.min(quota, newWordAllowance(goals, dueCount), cap);
  if (!quota || !cands.size) return [];
  // Families of the words already saved or started.
  const fam = new Map<string, string>();
  const studied = [...ctx.mine.map((e) => clean(e.lemma)), ...[...ctx.progress.values()].filter((p) => p.known || Number(p.reps) > 0 || p.lastReview != null).map((p) => p.lemma)];
  for (const w of studied) for (const key of familyKeys(w)) if (!fam.has(key)) fam.set(key, w);
  const scored = [...cands.entries()].map(([k, c]) => {
    const books = c.e.books?.length || 1;
    const kin = familyKeys(k).map((key) => fam.get(key)).find((w) => w && w.toLowerCase() !== k) || null;
    reasons?.set(c.e.id, { books, family: kin });
    return { e: c.e, score: c.rank - 0.08 * (books - 1) - (kin ? 0.15 : 0) };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, quota).map((s) => s.e);
}

/**
 * Today's plan for a scope. Due words come from everywhere in the scope, most overdue first, one
 * form of each word. New words: My words' own new words oldest first up to its goal, then book
 * words picked across the scope's books (`pickNewBookWords`); fewer of both when many reviews are
 * due. Once the learner's pace is known, the new words of the whole scope fit beside today's
 * reviews together (`newWordsToday`), shared between My words and the books by their goals. New
 * words are spread evenly among the reviews.
 */
export function scopeReviewPlan(scope: WordsScope, ctx: WordsContext, opts: ScopeReviewOptions = {}): QueuePlan {
  const now = opts.now ?? Date.now();
  const end = dayStart(now) + DAY;
  const entries = learnScopeEntries(scope, ctx);
  const due = dedupeLemmas(
    entries
      .filter((e) => !isNewWord(e) && !(e.known && !e.saved) && e.reviewDue != null && Number(e.reviewDue) < end)
      .sort((x, y) => Number(x.reviewDue) - Number(y.reviewDue)),
  );
  let mineFresh: WordsEntry[] = [];
  let mineLeft = 0;
  let mineWaiting = 0;
  const withMine = scope === 'mine' || scope === 'all';
  const bookIds = scope === 'mine' ? [] : scope === 'all' ? ctx.subs.map((s) => s.bookId) : [scope];
  const progress = bookIds.map((id) => bookProgress(id, ctx, now));
  const mineGoal = withMine ? opts.mineGoal ?? DEFAULT_DAILY_NEW : 0;
  const bookGoals = progress.reduce((s, p) => s + p.dailyNew, 0);
  // The day's room for new words, shared by goal; without a pace each part keeps its own rule.
  const room = opts.pace ? newWordsToday(mineGoal + bookGoals, due.length, opts.pace) : Infinity;
  const mineRoom = Number.isFinite(room) ? Math.round((room * mineGoal) / Math.max(1, mineGoal + bookGoals)) : Infinity;
  const bookRoom = Number.isFinite(room) ? room - mineRoom : Infinity;
  if (withMine) {
    const goal = mineGoal;
    mineLeft = Math.max(0, goal - (opts.mineStartedToday ?? 0));
    const allowed = Math.min(mineLeft, newWordAllowance(goal, due.length), mineRoom);
    const waiting = dedupeLemmas(
      ctx.mine
        .filter((e) => isNewWord(e) && clean(e.lemma) && isLearnable(e) && !ctx.progress.get(bookWordKey(e.lemma))?.known)
        .sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0))
        .map((e) => ({ ...e, saved: true, books: ctx.index.get(bookWordKey(e.lemma)) })),
    );
    mineWaiting = waiting.length;
    mineFresh = waiting.slice(0, allowed);
  }
  const bookFresh = pickNewBookWords(bookIds, ctx, now, due.length, undefined, bookRoom);
  const fresh = dedupeLemmas([...due, ...mineFresh, ...bookFresh]).slice(due.length);
  const bookQuota = progress.reduce((s, p) => s + p.newToday, 0);
  // Held back by the reviews (they come once the reviews are done) or by the learner's usual day
  // (they wait for tomorrow). Only words that exist wait: a goal of ten with three unstarted words
  // holds back at most three.
  const bookByReviews = Math.min(bookQuota, newWordAllowance(bookGoals, due.length));
  const bookAllowed = Math.min(bookByReviews, bookRoom);
  const mineAvail = Math.min(mineLeft, mineWaiting);
  const mineByReviews = Math.min(mineAvail, newWordAllowance(mineGoal, due.length));
  const mineAllowed = Math.min(mineByReviews, mineRoom);
  const heldBack = mineAvail - mineByReviews + (bookQuota - bookByReviews);
  const heldForToday = mineByReviews - mineAllowed + (bookByReviews - bookAllowed);
  return { ids: interleaveNew(due, fresh).map((e) => e.id), due: due.length, fresh: fresh.length, heldBack, heldForToday };
}

/** Today's queue for a scope (`scopeReviewPlan` ids). */
export function scopeReviewQueue(scope: WordsScope, ctx: WordsContext, opts: ScopeReviewOptions = {}): string[] {
  return scopeReviewPlan(scope, ctx, opts).ids;
}

/** A review session for a scope, ready for `reviewHtml`: the first round of today's plan. */
export function startScopeReview(scope: WordsScope, ctx: WordsContext, opts: ScopeReviewOptions = {}): ReviewState {
  return reviewStateFor(scopeReviewPlan(scope, ctx, opts), opts.now ?? Date.now());
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

/** "Already know it" on the current question: drops it and remembers it, so the round's summary can undo it. */
export function markKnownInReview(state: ReviewState, lemma: string): void {
  const l = clean(lemma);
  if (l && !(state.knownMarked || []).includes(l)) state.knownMarked = [...(state.knownMarked || []), l];
  dropCurrentReview(state);
}

/* ------------------------------------------------------------------ sources */

export interface SourceGroup extends SourceGroupKey {
  /** Saved words from this source, in the order they were saved. */
  entries: NotebookEntry[];
  /** When the last of them was saved. */
  latest: number;
  /** The book made from this source, if any. */
  bookId?: string;
}

/**
 * My words grouped by where they were saved: one group per document, otherwise per web site,
 * otherwise per app, most recently used first.
 */
export function sourceGroups(ctx: Pick<WordsContext, 'mine'> & Partial<WordsContext>): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const e of ctx.mine) {
    const key = sourceGroupOf(e.context);
    if (!key) continue;
    const at = Number(e.createdAt || e.updatedAt || 0);
    const g = groups.get(key.key);
    if (g) {
      g.entries.push(e);
      g.latest = Math.max(g.latest, at);
      if (!g.appId && key.appId) g.appId = key.appId;
    } else groups.set(key.key, { ...key, entries: [e], latest: at });
  }
  const made = new Map<string, string>();
  for (const m of madeMeta.values()) if (m.sourceKey && (!ctx.subs || ctx.subs.some((s) => s.bookId === m.id))) made.set(m.sourceKey, m.id);
  return [...groups.values()]
    .map((g) => ({
      ...g,
      entries: g.entries.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)),
      bookId: made.get(g.key),
    }))
    .sort((a, b) => b.latest - a.latest || b.entries.length - a.entries.length);
}

export { isUserBookId };
