/**
 * One word book in, one word book out (.pvbook, see book-file.ts). A book is My words, a book
 * the reader made, or one of Phevere's books; its file carries the words with everything kept
 * about them, and their answer history, from which each word's schedule is rebuilt on import
 * (the same path sync takes). Answers are merged by id, so importing a file twice changes nothing.
 */
import { insertAnswer, listAnswerHistory, answerKey, type AnswerRecord } from './answer-history';
import { bookFileName, encodeBookFile, type BookPayload, type BookWord } from './book-file';
import { getVocabDb } from './runtime';
import { addVocab, listVocab, type VocabEntry } from './vocab-store';
import { WORDBOOK_CATALOG } from './wordbook-catalog';
import { vocabLangKey } from './vocab-lang';
import { loadWordbook } from './wordbooks';
import { t } from './i18n/runtime';
import {
  bookWordKey,
  cacheBookWordMeaning,
  createUserBook,
  deleteUserBook,
  listBookProgress,
  listUserBooks,
  listWordbookSubs,
  rebuildWordSchedule,
  setWordbookGoal,
  subscribeWordbook,
  writeBookWord,
  type BookWordProgress,
  type UserBook,
} from './wordbook-store';

export type BookScope = { kind: 'mine' } | { kind: 'user'; id: string } | { kind: 'catalog'; id: string };

const SCHEDULE_KEYS = ['reviewDue', 'reviewInterval', 'ease', 'reps', 'stability', 'difficulty', 'state', 'lapses', 'lastReview', 'learningSteps'] as const;

function scheduleOf(src: Record<string, unknown>): Record<string, number | null> | undefined {
  const out: Record<string, number | null> = {};
  let any = false;
  for (const k of SCHEDULE_KEYS) {
    const v = src[k];
    if (v == null) continue;
    out[k] = Number(v);
    any = true;
  }
  return any && Number(src.reps || 0) > 0 ? out : undefined;
}

function wordFromEntry(e: VocabEntry): BookWord {
  return {
    lemma: e.lemma,
    reading: e.reading,
    definition: e.definition,
    partOfSpeech: e.partOfSpeech,
    sourceLang: e.sourceLang,
    targetLang: e.targetLang,
    sources: e.sources,
    note: e.note,
    tags: e.tags,
    context: e.context || undefined,
    device: e.device,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    schedule: scheduleOf(e as unknown as Record<string, unknown>),
  };
}

function wordFromProgress(lemma: string, p: BookWordProgress | undefined): BookWord {
  if (!p) return { lemma };
  return {
    lemma,
    definition: p.definition,
    reading: p.reading,
    partOfSpeech: p.partOfSpeech,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : undefined,
    updatedAt: p.updatedAt,
    known: p.known || undefined,
    schedule: scheduleOf(p as unknown as Record<string, unknown>),
  };
}

async function answersFor(lemmas: Iterable<string>): Promise<AnswerRecord[]> {
  const want = new Set(Array.from(lemmas, (l) => answerKey(l)));
  if (!want.size) return [];
  return (await listAnswerHistory()).filter((r) => want.has(answerKey(r.lemma)));
}

/** The book as a .pvbook file and the name to save it under. */
export async function exportBookFile(scope: BookScope, app = 'Phevere'): Promise<{ bytes: Uint8Array; fileName: string; count: number }> {
  let book: BookPayload['book'];
  let words: BookWord[];
  if (scope.kind === 'mine') {
    const entries = await listVocab(1_000_000);
    book = { kind: 'mine', id: 'mine', title: t('notebook.myWords') };
    words = entries.map(wordFromEntry);
  } else {
    const progress = new Map((await listBookProgress()).map((p) => [p.lemma, p]));
    const saved = new Map((await listVocab(1_000_000)).map((e) => [bookWordKey(e.lemma), e]));
    let lemmas: string[];
    if (scope.kind === 'user') {
      const ub = (await listUserBooks()).find((b) => b.bookId === scope.id);
      if (!ub) throw new Error(t('notebook.books.error.gone'));
      book = { kind: 'user', id: ub.bookId, title: ub.title, source: ub.source };
      lemmas = ub.words;
    } else {
      const meta = WORDBOOK_CATALOG.find((b) => b.id === scope.id);
      if (!meta) throw new Error(t('notebook.books.error.unknown'));
      const sub = (await listWordbookSubs()).find((s) => s.bookId === scope.id);
      book = { kind: 'catalog', id: meta.id, title: meta.title, source: meta.source, goal: sub?.dailyNew };
      lemmas = await loadWordbook(meta.id);
    }
    // A word saved in My words carries its full record; others carry their book progress.
    words = lemmas.map((l) => {
      const e = saved.get(bookWordKey(l));
      return e ? { ...wordFromEntry(e), known: progress.get(bookWordKey(l))?.known || undefined } : wordFromProgress(l, progress.get(bookWordKey(l)));
    });
  }
  const answers = await answersFor(words.map((w) => w.lemma));
  const payload: BookPayload = { format: 'phevere-book', version: 1, exportedAt: Date.now(), app, book, words, answers };
  return { bytes: encodeBookFile(payload), fileName: bookFileName(book.title), count: words.length };
}

/* ------------------------------------------------------------------ import */

export interface BookConflict {
  /** The reader's book with the same name, which "replace" would overwrite. */
  existingId: string;
  title: string;
}

/** What importing would collide with: a made book with the same title, or a book already added. */
export async function findBookConflict(payload: BookPayload): Promise<BookConflict | null> {
  const b = payload.book;
  if (b.kind === 'mine') return null;
  if (b.kind === 'catalog') {
    const sub = (await listWordbookSubs()).find((s) => s.bookId === b.id);
    return sub ? { existingId: b.id, title: b.title } : null;
  }
  const want = b.title.trim().toLowerCase();
  const same = (await listUserBooks()).find((u) => u.title.trim().toLowerCase() === want);
  return same ? { existingId: same.bookId, title: same.title } : null;
}

/** A title not taken yet: "Reading list (2)", "(3)" and so on. */
function freeTitle(title: string, taken: UserBook[]): string {
  const names = new Set(taken.map((u) => u.title.trim().toLowerCase()));
  if (!names.has(title.trim().toLowerCase())) return title;
  for (let n = 2; n < 1000; n++) {
    const next = `${title} (${n})`;
    if (!names.has(next.toLowerCase())) return next;
  }
  return `${title} (${Date.now()})`;
}

function isAnswer(r: any): r is AnswerRecord {
  return r && typeof r.id === 'string' && typeof r.lemma === 'string' && Number.isFinite(Number(r.answeredAt));
}

export interface BookImportResult {
  kind: BookPayload['book']['kind'];
  bookId: string;
  title: string;
  words: number;
  /** Words new to this device (for My words, those not saved here before). */
  added: number;
  answers: number;
}

function fillsGap(e: VocabEntry, w: BookWord): boolean {
  return (!e.definition && !!w.definition) || (!e.reading && !!w.reading) || (!e.partOfSpeech && !!w.partOfSpeech) || (!e.note && !!w.note) || (!e.context && !!w.context);
}

/**
 * Import a decoded book. `mode` settles a same-name book: 'replace' overwrites the reader's book,
 * 'keep-both' imports this one under a free title. My words always merges.
 */
export async function importBookPayload(payload: BookPayload, mode: 'replace' | 'keep-both' = 'keep-both'): Promise<BookImportResult> {
  const b = payload.book;
  const words = payload.words.filter((w) => w && typeof w.lemma === 'string' && w.lemma.trim());
  let bookId = b.id;
  let title = b.title;
  let added = 0;
  if (b.kind === 'mine') {
    // A word already saved is left alone (no new save time to sync) unless the file fills a gap.
    // By spelling and language: a Danish "give" in the file is new beside a saved English "give".
    const have = new Map((await listVocab(1_000_000)).map((e) => [vocabLangKey(e), e]));
    for (const w of words) {
      const e = have.get(vocabLangKey({ lemma: w.lemma, sourceLang: w.sourceLang }));
      if (e && !fillsGap(e, w)) continue;
      if (!e) added += 1;
      await addVocab({
        lemma: w.lemma,
        reading: w.reading,
        definition: w.definition,
        partOfSpeech: w.partOfSpeech,
        sourceLang: w.sourceLang,
        targetLang: w.targetLang,
        sources: w.sources,
        note: w.note,
        tags: w.tags,
        context: (w.context as any) || undefined,
        createdAt: w.createdAt,
        device: w.device,
      });
    }
  } else if (b.kind === 'user') {
    const mine = await listUserBooks();
    const conflict = await findBookConflict(payload);
    if (conflict && mode === 'replace') await deleteUserBook(conflict.existingId);
    else if (conflict) title = freeTitle(title, mine);
    const made = await createUserBook(title, words.map((w) => w.lemma), b.source);
    bookId = made.bookId;
  } else {
    const meta = WORDBOOK_CATALOG.find((m) => m.id === b.id);
    if (!meta) throw new Error('This word book is not in this version of Phevere.');
    await subscribeWordbook(meta.id, b.goal);
    if (b.goal) await setWordbookGoal(meta.id, b.goal);
    title = meta.title;
  }

  // A meaning that came with the book (an Anki card's back) is what the quiz will ask.
  if (b.kind !== 'mine') {
    for (const w of words) {
      if (w.definition) await cacheBookWordMeaning(w.lemma, { definition: w.definition, reading: w.reading, partOfSpeech: w.partOfSpeech });
    }
  }

  // Progress: merge the answers, then rebuild each word's schedule from its whole history.
  let answers = 0;
  for (const r of payload.answers) if (isAnswer(r) && (await insertAnswer(r))) answers += 1;
  const withHistory = new Set(payload.answers.filter(isAnswer).map((r) => answerKey(r.lemma)));
  for (const w of words) {
    const key = bookWordKey(w.lemma);
    if (withHistory.has(key)) {
      await rebuildWordSchedule(key);
      continue;
    }
    // Saved before 4.0: no history, so the schedule it had comes along as it was.
    if (!w.schedule && !w.known) continue;
    if (b.kind === 'mine') {
      if (!w.schedule) continue;
      const s = w.schedule;
      await getVocabDb().runWrite(
        `UPDATE vocab SET review_due = ?, review_interval = ?, ease = ?, reps = ?, stability = ?, difficulty = ?, state = ?, lapses = ?,
         last_review = ?, learning_steps = ? WHERE lower(lemma) = ? AND COALESCE(reps, 0) = 0`,
        [s.reviewDue ?? null, s.reviewInterval ?? 0, s.ease ?? 2.5, s.reps ?? 0, s.stability ?? null, s.difficulty ?? null, s.state ?? null, s.lapses ?? 0, s.lastReview ?? null, s.learningSteps ?? 0, key],
      );
    } else {
      await writeBookWord({ lemma: key, known: !!w.known, ...(w.schedule || {}), createdAt: w.createdAt, updatedAt: Date.now() } as BookWordProgress);
    }
  }
  return { kind: b.kind, bookId, title, words: words.length, added: b.kind === 'mine' ? added : words.length, answers };
}
