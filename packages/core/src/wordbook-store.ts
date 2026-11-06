/**
 * Word book storage: which books the learner subscribed to, and review progress on book words.
 *
 * My words stay in `vocab`, untouched. A word book is a fixed list shipped with the app
 * (`wordbooks.ts`), so only two things are stored per learner:
 *
 * - `wordbook_subs`: one row per book ever subscribed, with its daily goal for new words.
 *   Unsubscribing clears `active` rather than deleting the row, so the change syncs like any
 *   other edit and resubscribing keeps the goal.
 * - `book_words`: FSRS progress, keyed by the lowercase headword, for book words that are not in
 *   My words. A word saved to My words is scheduled on its `vocab` row instead, and its book
 *   progress moves there when it is saved (`saveBookWord`). Progress belongs to the word, not
 *   to a book, so learning "ability" once counts in every book that lists it.
 *
 * The `definition`, `reading` and `part_of_speech` columns cache what a lookup returned, so a
 * quiz can show the meaning; they stay on this device and do not change `updated_at`.
 *
 * A learner can also make a book (`user_books`), usually from a source in the Words tab: a title,
 * the source it came from, and its headwords in order. It is subscribed like a shipped book and
 * its words keep their progress where every word does, so a made book holds no progress itself.
 */
import { getNewId, getVocabDb } from './runtime';
import { scheduleReview, type ReviewGrade, type ScheduleFields } from './review-schedule';
import { listAnswerHistory, logGradedAnswer, logKnownAnswer, replaySchedule, type AnswerDetails, type AnswerRecord } from './answer-history';
import { addVocab, ensureVocabReady, findByLemma, notifyVocabChanged, type VocabAddInput, type VocabEntry } from './vocab-store';
import { t } from './i18n/runtime';

export interface WordbookSub {
  bookId: string;
  dailyNew: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BookWordProgress extends ScheduleFields {
  lemma: string;
  /** Marked "already know it": never asked as a new word. */
  known: boolean;
  definition?: string;
  reading?: string;
  partOfSpeech?: string;
  /** First review, which is when the word was started. */
  createdAt?: number;
  updatedAt: number;
}

export interface BookWordMeaning {
  definition?: string;
  reading?: string;
  partOfSpeech?: string;
}

export const DEFAULT_DAILY_NEW = 10;

export function bookWordKey(lemma: string): string {
  return String(lemma || '').trim().toLowerCase();
}

const num = (v: unknown): number | undefined => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
const text = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v));

export function rowToSub(row: Record<string, unknown>): WordbookSub {
  return {
    bookId: String(row.book_id),
    dailyNew: num(row.daily_new) ?? DEFAULT_DAILY_NEW,
    active: Number(row.active) !== 0,
    createdAt: num(row.created_at) ?? 0,
    updatedAt: num(row.updated_at) ?? 0,
  };
}

export function rowToBookWord(row: Record<string, unknown>): BookWordProgress {
  return {
    lemma: String(row.lemma),
    known: Number(row.known) === 1,
    reviewDue: num(row.review_due) ?? null,
    reviewInterval: num(row.review_interval) ?? null,
    ease: num(row.ease) ?? null,
    reps: num(row.reps) ?? null,
    stability: num(row.stability) ?? null,
    difficulty: num(row.difficulty) ?? null,
    state: num(row.state) ?? null,
    lapses: num(row.lapses) ?? null,
    lastReview: num(row.last_review) ?? null,
    learningSteps: num(row.learning_steps) ?? null,
    definition: text(row.definition),
    reading: text(row.reading),
    partOfSpeech: text(row.part_of_speech),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at) ?? 0,
  };
}

/* ------------------------------------------------------------ subscriptions */

export async function listWordbookSubs(includeInactive = false): Promise<WordbookSub[]> {
  await ensureVocabReady();
  const rows = await getVocabDb().queryAll(
    `SELECT * FROM wordbook_subs ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY created_at ASC`,
  );
  return rows.map(rowToSub);
}

async function upsertSub(bookId: string, patch: { dailyNew?: number; active?: boolean }, now: number): Promise<WordbookSub> {
  await ensureVocabReady();
  const db = getVocabDb();
  const row = await db.queryOne(`SELECT * FROM wordbook_subs WHERE book_id = ?`, [bookId]);
  const prev = row ? rowToSub(row) : null;
  const next: WordbookSub = {
    bookId,
    dailyNew: Math.max(0, Math.round(patch.dailyNew ?? prev?.dailyNew ?? DEFAULT_DAILY_NEW)),
    active: patch.active ?? prev?.active ?? true,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  await writeSub(next);
  notifyVocabChanged();
  return next;
}

export async function writeSub(s: WordbookSub): Promise<void> {
  await getVocabDb().runWrite(
    `INSERT OR REPLACE INTO wordbook_subs (book_id, daily_new, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [s.bookId, s.dailyNew, s.active ? 1 : 0, s.createdAt, s.updatedAt],
  );
}

export function subscribeWordbook(bookId: string, dailyNew?: number, now = Date.now()): Promise<WordbookSub> {
  return upsertSub(bookId, { active: true, dailyNew }, now);
}

export function unsubscribeWordbook(bookId: string, now = Date.now()): Promise<WordbookSub> {
  return upsertSub(bookId, { active: false }, now);
}

export function setWordbookGoal(bookId: string, dailyNew: number, now = Date.now()): Promise<WordbookSub> {
  return upsertSub(bookId, { dailyNew }, now);
}

/* ---------------------------------------------------------------- progress */

export async function listBookProgress(): Promise<BookWordProgress[]> {
  await ensureVocabReady();
  return (await getVocabDb().queryAll(`SELECT * FROM book_words`)).map(rowToBookWord);
}

async function getBookWord(key: string): Promise<BookWordProgress | null> {
  const row = await getVocabDb().queryOne(`SELECT * FROM book_words WHERE lemma = ?`, [key]);
  return row ? rowToBookWord(row) : null;
}

/** Writes the progress fields; the cached meaning on an existing row is kept. */
export async function writeBookWord(p: BookWordProgress): Promise<void> {
  const db = getVocabDb();
  const n = (v: unknown) => num(v) ?? null;
  await db.runWrite(
    `INSERT INTO book_words (lemma, known, review_due, review_interval, ease, reps, stability, difficulty, state, lapses, last_review, learning_steps,
       definition, reading, part_of_speech, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(lemma) DO UPDATE SET known = excluded.known, review_due = excluded.review_due, review_interval = excluded.review_interval,
       ease = excluded.ease, reps = excluded.reps, stability = excluded.stability, difficulty = excluded.difficulty, state = excluded.state,
       lapses = excluded.lapses, last_review = excluded.last_review, learning_steps = excluded.learning_steps,
       definition = COALESCE(excluded.definition, book_words.definition), reading = COALESCE(excluded.reading, book_words.reading),
       part_of_speech = COALESCE(excluded.part_of_speech, book_words.part_of_speech),
       created_at = COALESCE(book_words.created_at, excluded.created_at), updated_at = excluded.updated_at`,
    [
      bookWordKey(p.lemma),
      p.known ? 1 : 0,
      n(p.reviewDue),
      n(p.reviewInterval) ?? 0,
      n(p.ease) ?? 2.5,
      n(p.reps) ?? 0,
      n(p.stability),
      n(p.difficulty),
      n(p.state),
      n(p.lapses) ?? 0,
      n(p.lastReview),
      n(p.learningSteps) ?? 0,
      p.definition || null,
      p.reading || null,
      p.partOfSpeech || null,
      n(p.createdAt),
      p.updatedAt,
    ],
  );
}

/**
 * One review of a book word that is not in My words, scheduled with FSRS like a saved word and
 * recorded in the answer history.
 */
export async function reviewBookWord(lemma: string, grade: ReviewGrade, now = Date.now(), details: AnswerDetails = {}): Promise<BookWordProgress> {
  await ensureVocabReady();
  const key = bookWordKey(lemma);
  const prev = (await getBookWord(key)) || { lemma: key, known: false, updatedAt: 0 };
  const before = { ...prev, createdAt: prev.createdAt ?? now };
  const next = scheduleReview(before, grade, now);
  await writeBookWord({ ...prev, ...next, lemma: key, createdAt: prev.createdAt ?? now, updatedAt: now });
  await logGradedAnswer(key, grade, now, before, details);
  notifyVocabChanged();
  return (await getBookWord(key))!;
}

/** "Already know it" (or undo): a known word is never offered as a new word. Recorded in the history. */
export async function setBookWordKnown(lemma: string, known: boolean, now = Date.now(), bookId: string | null = null): Promise<BookWordProgress> {
  await ensureVocabReady();
  const key = bookWordKey(lemma);
  const prev = (await getBookWord(key)) || { lemma: key, known: false, updatedAt: 0 };
  // Marking a word known does not start it, so it does not count against today's new words.
  await writeBookWord({ ...prev, lemma: key, known, updatedAt: now });
  await logKnownAnswer(key, known, now, bookId);
  notifyVocabChanged();
  return (await getBookWord(key))!;
}

/**
 * Rebuilds a word's schedule from its answer history (`replaySchedule`) and writes it where the
 * word lives: its My words row when saved, otherwise its `book_words` row. Returns false when the
 * word has no history. Used after answer histories from other devices are merged in.
 */
export async function rebuildWordSchedule(lemma: string, history?: AnswerRecord[]): Promise<boolean> {
  await ensureVocabReady();
  const key = bookWordKey(lemma);
  const records = history ?? (await listAnswerHistory({ lemma: key }));
  if (!records.length) return false;
  const { schedule: s, known, startedAt } = replaySchedule(records);
  const db = getVocabDb();
  const saved = await findByLemma(key);
  if (saved) {
    if (!s) return false;
    await db.runWrite(
      `UPDATE vocab SET review_due = ?, review_interval = ?, ease = ?, reps = ?, stability = ?, difficulty = ?, state = ?, lapses = ?,
       last_review = ?, learning_steps = ? WHERE lower(lemma) = ?`,
      [s.reviewDue, s.reviewInterval, s.ease, s.reps, s.stability, s.difficulty, s.state, s.lapses, s.lastReview, s.learningSteps, key],
    );
    // "Already know it" is kept on the book row even for a saved word.
    const prev = await getBookWord(key);
    if (prev && prev.known !== known) await writeBookWord({ ...prev, known });
    return true;
  }
  const prev = (await getBookWord(key)) || { lemma: key, known: false, updatedAt: 0 };
  const sched = s ?? { reviewDue: null, reviewInterval: 0, ease: 2.5, reps: 0, stability: null, difficulty: null, state: null, lapses: 0, lastReview: null, learningSteps: 0 };
  await writeBookWord({ ...prev, ...sched, lemma: key, known, createdAt: startedAt ?? prev.createdAt, updatedAt: prev.updatedAt });
  return true;
}

/** Caches a lookup's meaning for quiz questions. Local only: `updated_at` is left alone. */
export async function cacheBookWordMeaning(lemma: string, meaning: BookWordMeaning): Promise<void> {
  await ensureVocabReady();
  const key = bookWordKey(lemma);
  if (!key || !(meaning.definition || meaning.reading)) return;
  await getVocabDb().runWrite(
    `INSERT INTO book_words (lemma, definition, reading, part_of_speech, updated_at) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(lemma) DO UPDATE SET definition = COALESCE(excluded.definition, book_words.definition),
       reading = COALESCE(excluded.reading, book_words.reading), part_of_speech = COALESCE(excluded.part_of_speech, book_words.part_of_speech)`,
    [key, meaning.definition || null, meaning.reading || null, meaning.partOfSpeech || null],
  );
}

/**
 * Saves a book word to My words. The cached meaning fills the new row, and progress made in a
 * book moves onto the `vocab` row when that row has not been reviewed yet, so the word keeps
 * its schedule.
 */
export async function saveBookWord(lemma: string, payload: Partial<VocabAddInput> = {}): Promise<VocabEntry> {
  await ensureVocabReady();
  const key = bookWordKey(lemma);
  const book = await getBookWord(key);
  const entry = await addVocab({
    ...payload,
    lemma: payload.lemma || lemma,
    definition: payload.definition || book?.definition,
    reading: payload.reading || book?.reading,
    partOfSpeech: payload.partOfSpeech || book?.partOfSpeech,
  });
  if (book && Number(book.reps) > 0 && !(Number(entry.reps) > 0) && entry.lastReview == null) {
    await getVocabDb().runWrite(
      `UPDATE vocab SET review_due = ?, review_interval = ?, ease = ?, reps = ?, stability = ?, difficulty = ?, state = ?, lapses = ?,
       last_review = ?, learning_steps = ?, updated_at = ? WHERE id = ?`,
      [
        book.reviewDue ?? null,
        book.reviewInterval ?? 0,
        book.ease ?? 2.5,
        book.reps ?? 0,
        book.stability ?? null,
        book.difficulty ?? null,
        book.state ?? null,
        book.lapses ?? 0,
        book.lastReview ?? null,
        book.learningSteps ?? 0,
        Date.now(),
        entry.id,
      ],
    );
    notifyVocabChanged();
    return (await findByLemma(entry.lemma)) || entry;
  }
  return entry;
}

/* ------------------------------------------------------------ made books */

/** Ids of books the learner made start with this, so they never clash with shipped ones. */
export const USER_BOOK_PREFIX = 'mine-';

export interface UserBook {
  bookId: string;
  title: string;
  /** Headwords in order, each once. */
  words: string[];
  /** The source it was made from ("doc:geb.pdf", "site:en.wikipedia.org"). */
  source?: string;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export function isUserBookId(id: string): boolean {
  return String(id || '').startsWith(USER_BOOK_PREFIX);
}

/** Headwords once each, in order, trimmed. */
export function uniqueWords(words: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const t = String(w || '').trim().replace(/\s+/g, ' ');
    const k = bookWordKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function rowToUserBook(row: Record<string, unknown>): UserBook {
  let words: string[] = [];
  try {
    const parsed = JSON.parse(String(row.words || '[]'));
    if (Array.isArray(parsed)) words = uniqueWords(parsed.map(String));
  } catch {
    /* an unreadable list is an empty book */
  }
  return {
    bookId: String(row.book_id),
    title: String(row.title || ''),
    words,
    source: text(row.source),
    deleted: Number(row.deleted) === 1,
    createdAt: num(row.created_at) ?? 0,
    updatedAt: num(row.updated_at) ?? 0,
  };
}

export async function writeUserBook(b: UserBook): Promise<void> {
  await getVocabDb().runWrite(
    `INSERT OR REPLACE INTO user_books (book_id, title, words, source, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [b.bookId, b.title, JSON.stringify(uniqueWords(b.words)), b.source || null, b.deleted ? 1 : 0, b.createdAt, b.updatedAt],
  );
}

export async function listUserBooks(includeDeleted = false): Promise<UserBook[]> {
  await ensureVocabReady();
  const rows = await getVocabDb().queryAll(`SELECT * FROM user_books ${includeDeleted ? '' : 'WHERE deleted = 0'} ORDER BY created_at ASC`);
  return rows.map(rowToUserBook);
}

async function getUserBook(bookId: string): Promise<UserBook | null> {
  const row = await getVocabDb().queryOne(`SELECT * FROM user_books WHERE book_id = ?`, [bookId]);
  return row ? rowToUserBook(row) : null;
}

/** Makes a book and subscribes to it, so it shows in the Words tab with its progress. */
export async function createUserBook(title: string, words: string[], source?: string, now = Date.now()): Promise<UserBook> {
  await ensureVocabReady();
  const book: UserBook = {
    bookId: `${USER_BOOK_PREFIX}${getNewId()}`,
    title: String(title || '').trim().slice(0, 80) || t('notebook.books.myBook'),
    words: uniqueWords(words),
    source,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };
  await writeUserBook(book);
  await upsertSub(book.bookId, { active: true }, now);
  return book;
}

async function editUserBook(bookId: string, edit: (b: UserBook) => Partial<UserBook>, now: number): Promise<UserBook | null> {
  await ensureVocabReady();
  const prev = await getUserBook(bookId);
  if (!prev || prev.deleted) return null;
  const next = { ...prev, ...edit(prev), updatedAt: now };
  await writeUserBook(next);
  notifyVocabChanged();
  return next;
}

export function renameUserBook(bookId: string, title: string, now = Date.now()): Promise<UserBook | null> {
  const t = String(title || '').trim().slice(0, 80);
  return editUserBook(bookId, (b) => ({ title: t || b.title }), now);
}

/** Adds words at the end; words already in the book stay where they are. */
export function addUserBookWords(bookId: string, words: string[], now = Date.now()): Promise<UserBook | null> {
  return editUserBook(bookId, (b) => ({ words: uniqueWords([...b.words, ...words]) }), now);
}

export function removeUserBookWord(bookId: string, word: string, now = Date.now()): Promise<UserBook | null> {
  const k = bookWordKey(word);
  return editUserBook(bookId, (b) => ({ words: b.words.filter((w) => bookWordKey(w) !== k) }), now);
}

/** Deletes a made book: marked deleted (so the deletion syncs) and unsubscribed. Its words keep their progress. */
export async function deleteUserBook(bookId: string, now = Date.now()): Promise<void> {
  await ensureVocabReady();
  const prev = await getUserBook(bookId);
  if (prev) await writeUserBook({ ...prev, deleted: true, updatedAt: now });
  await upsertSub(bookId, { active: false }, now);
}
