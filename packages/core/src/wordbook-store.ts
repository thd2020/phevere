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
 */
import { getVocabDb } from './runtime';
import { scheduleReview, type ReviewGrade, type ScheduleFields } from './review-schedule';
import { addVocab, ensureVocabReady, findByLemma, notifyVocabChanged, type VocabAddInput, type VocabEntry } from './vocab-store';

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

/** One review of a book word that is not in My words, scheduled with FSRS like a saved word. */
export async function reviewBookWord(lemma: string, grade: ReviewGrade, now = Date.now()): Promise<BookWordProgress> {
  await ensureVocabReady();
  const key = bookWordKey(lemma);
  const prev = (await getBookWord(key)) || { lemma: key, known: false, updatedAt: 0 };
  const next = scheduleReview({ ...prev, createdAt: prev.createdAt ?? now }, grade, now);
  await writeBookWord({ ...prev, ...next, lemma: key, createdAt: prev.createdAt ?? now, updatedAt: now });
  notifyVocabChanged();
  return (await getBookWord(key))!;
}

/** "Already know it" (or undo): a known word is never offered as a new word. */
export async function setBookWordKnown(lemma: string, known: boolean, now = Date.now()): Promise<BookWordProgress> {
  await ensureVocabReady();
  const key = bookWordKey(lemma);
  const prev = (await getBookWord(key)) || { lemma: key, known: false, updatedAt: 0 };
  // Marking a word known does not start it, so it does not count against today's new words.
  await writeBookWord({ ...prev, lemma: key, known, updatedAt: now });
  notifyVocabChanged();
  return (await getBookWord(key))!;
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
