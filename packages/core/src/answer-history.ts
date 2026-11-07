/**
 * Answer history: one append-only row per quiz answer and per "Already know it", on every device.
 *
 * The history is the record of learning. A word's FSRS schedule is a function of it: replaying
 * the graded answers in time order through `scheduleReview` gives the same state the live updates
 * wrote, because ts-fsrs is deterministic (its interval fuzz is seeded from the review time, the
 * repetition count and the memory state). So after histories from two devices are merged, each
 * word's schedule can be rebuilt (`rebuildWordSchedule`) instead of picking one device's copy.
 *
 * Words reviewed before the history existed carry a `prior` on their first graded answer: the
 * schedule as it stood just before, so replay starts from there instead of from a new card.
 *
 * Rows are keyed by the lowercase headword, because progress belongs to the word: the same word
 * can be a `vocab` row on one device and a `book_words` row on another, and duplicate `vocab`
 * rows for one lemma fold together after sync.
 */
import { getDeviceName, getNewId, getVocabDb } from './runtime';
import { scheduleReview, type ReviewGrade, type ScheduleFields, type ScheduleUpdate } from './review-schedule';
import { sameLemma, type QuestionKind } from './review-quiz';

export type Skill = 'meaning' | 'spelling' | 'listening';
export const SKILLS: Skill[] = ['meaning', 'spelling', 'listening'];

/** A question kind, or `known` for "Already know it" (correct says whether it was set or undone). */
export type AnswerKind = QuestionKind | 'known';

export interface AnswerRecord {
  id: string;
  /** Lowercase headword. */
  lemma: string;
  /** The `vocab` row id when the word was in My words. */
  wordId: string | null;
  /** The word book the session was studying, if any. */
  bookId: string | null;
  answeredAt: number;
  kind: AnswerKind | null;
  skill: Skill | null;
  correct: boolean;
  /** Response time in milliseconds. */
  ms: number | null;
  /** The grade that was saved (null for `known`). */
  grade: ReviewGrade | null;
  device: string | null;
  /** The schedule before this answer, on a word's first graded answer when it was already started. */
  prior: ScheduleFields | null;
}

/** What the shells know about an answer beyond its grade. */
export interface AnswerDetails {
  kind?: QuestionKind;
  correct?: boolean;
  ms?: number;
  bookId?: string | null;
}

const PRIOR_FIELDS = ['createdAt', 'reviewDue', 'reviewInterval', 'ease', 'reps', 'stability', 'difficulty', 'state', 'lapses', 'lastReview', 'learningSteps'] as const;

/**
 * Meaning from choice questions (and the flash card), spelling from typed recall, listening from
 * the questions that play the word. There is no speaking check.
 */
export function skillFor(kind: AnswerKind | null | undefined): Skill | null {
  switch (kind) {
    case 'meaning-choice':
    case 'word-choice':
    case 'cloze-choice':
    case 'synonym-choice':
    case 'antonym-choice':
    case 'flash':
      return 'meaning';
    case 'recall':
    case 'cloze':
    case 'word-form':
    case 'spell-tiles':
      return 'spelling';
    case 'listen-choice':
    case 'listen-type':
      return 'listening';
    default:
      return null;
  }
}

export function answerKey(lemma: string): string {
  return String(lemma || '').trim().toLowerCase();
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function isStarted(s: ScheduleFields | null | undefined): boolean {
  if (!s) return false;
  return Number(s.reps) > 0 || s.lastReview != null || Number(s.state) > 0;
}

function priorOf(s: ScheduleFields): ScheduleFields {
  const out: Record<string, number | null> = {};
  for (const k of PRIOR_FIELDS) out[k] = num((s as Record<string, unknown>)[k]);
  return out as ScheduleFields;
}

export function rowToAnswer(row: Record<string, unknown>): AnswerRecord {
  let prior: ScheduleFields | null = null;
  if (row.prior) {
    try {
      prior = JSON.parse(String(row.prior));
    } catch {
      prior = null;
    }
  }
  const grade = num(row.grade);
  return {
    id: String(row.id),
    lemma: String(row.lemma),
    wordId: row.word_id ? String(row.word_id) : null,
    bookId: row.book_id ? String(row.book_id) : null,
    answeredAt: Number(row.answered_at) || 0,
    kind: row.kind ? (String(row.kind) as AnswerKind) : null,
    skill: row.skill ? (String(row.skill) as Skill) : null,
    correct: Number(row.correct) === 1,
    ms: num(row.ms),
    grade: grade != null && grade >= 1 && grade <= 4 ? (grade as ReviewGrade) : null,
    device: row.device ? String(row.device) : null,
    prior,
  };
}

/**
 * Inserts a record; a record already present (same id, say from a second pull) is left alone.
 * `synced` marks a record the server already holds (one pulled from it), so it is not sent back.
 * Returns whether the record was new here.
 */
export async function insertAnswer(r: AnswerRecord, synced = false): Promise<boolean> {
  const db = getVocabDb();
  if (await db.queryOne(`SELECT 1 AS x FROM answer_history WHERE id = ?`, [r.id])) return false;
  await db.runWrite(
    `INSERT OR IGNORE INTO answer_history (id, lemma, word_id, book_id, answered_at, kind, skill, correct, ms, grade, device, prior, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.id,
      answerKey(r.lemma),
      r.wordId,
      r.bookId,
      r.answeredAt,
      r.kind,
      r.skill,
      r.correct ? 1 : 0,
      r.ms,
      r.grade,
      r.device,
      r.prior ? JSON.stringify(r.prior) : null,
      synced ? 1 : 0,
    ],
  );
  return true;
}

async function hasGradedAnswer(key: string): Promise<boolean> {
  const row = await getVocabDb().queryOne(`SELECT 1 AS x FROM answer_history WHERE lemma = ? AND grade IS NOT NULL LIMIT 1`, [key]);
  return !!row;
}

/**
 * Records one graded answer. `before` is the word's schedule just before the answer; when this is
 * the word's first graded answer and the word was already started, it is kept as `prior`.
 */
export async function logGradedAnswer(
  lemma: string,
  grade: ReviewGrade,
  answeredAt: number,
  before: ScheduleFields | null,
  details: AnswerDetails = {},
  wordId: string | null = null,
): Promise<AnswerRecord> {
  const key = answerKey(lemma);
  const prior = isStarted(before) && !(await hasGradedAnswer(key)) ? priorOf(before!) : null;
  const rec: AnswerRecord = {
    id: getNewId(),
    lemma: key,
    wordId,
    bookId: details.bookId ?? null,
    answeredAt,
    kind: details.kind ?? null,
    skill: skillFor(details.kind),
    correct: details.correct ?? grade > 1,
    ms: details.ms != null ? Math.max(0, Math.round(details.ms)) : null,
    grade,
    device: getDeviceName() || null,
    prior,
  };
  await insertAnswer(rec);
  return rec;
}

/** Records "Already know it" (known) or its undo. */
export async function logKnownAnswer(lemma: string, known: boolean, answeredAt: number, bookId: string | null = null): Promise<AnswerRecord> {
  const rec: AnswerRecord = {
    id: getNewId(),
    lemma: answerKey(lemma),
    wordId: null,
    bookId,
    answeredAt,
    kind: 'known',
    skill: null,
    correct: known,
    ms: null,
    grade: null,
    device: getDeviceName() || null,
    prior: null,
  };
  await insertAnswer(rec);
  return rec;
}

/* ------------------------------------------------------- headword changes */

const ALIAS_KEY = 'lemma-aliases';

async function readAliases(): Promise<Record<string, string>> {
  const row = await getVocabDb().queryOne(`SELECT value FROM sync_state WHERE key = ?`, [ALIAS_KEY]);
  try {
    const map = row?.value ? JSON.parse(String(row.value)) : {};
    return map && typeof map === 'object' ? map : {};
  } catch {
    return {};
  }
}

/**
 * Remembers that answers under one headword now belong to another (a saved "gleaned" folded into
 * "glean", "paparazzi" into "paparazzo"), so answers that arrive later from a device that still
 * uses the old headword attach to the same card (`localLemma`).
 */
export async function recordLemmaAliases(pairs: Array<[string, string]>): Promise<void> {
  const map = await readAliases();
  let changed = false;
  for (const [from, to] of pairs) {
    const a = answerKey(from);
    const b = answerKey(to);
    if (!a || !b || a === b || map[a] === b) continue;
    map[a] = b;
    changed = true;
  }
  if (changed) await getVocabDb().runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [ALIAS_KEY, JSON.stringify(map)]);
}

/**
 * The headword this device keeps an incoming answer under. A recorded alias wins; otherwise a
 * headword that is not saved here but is another form or spelling of a saved word (an answer to
 * "vicissitudes" when this device saved "vicissitude") goes to that word. Anything else is kept.
 */
export async function localLemma(lemma: string): Promise<string> {
  let key = answerKey(lemma);
  if (!key) return key;
  const aliases = await readAliases();
  for (let i = 0; i < 5 && aliases[key] && aliases[key] !== key; i++) key = aliases[key];
  const db = getVocabDb();
  if (await db.queryOne(`SELECT 1 AS x FROM vocab WHERE lower(lemma) = ? LIMIT 1`, [key])) return key;
  const near = await db.queryAll(`SELECT lemma FROM vocab WHERE lower(lemma) LIKE ? LIMIT 200`, [`${key.slice(0, 2).replace(/[%_]/g, '')}%`]);
  const match = near
    .map((r) => answerKey(String(r.lemma)))
    .filter((l) => l !== key && sameLemma(l, key))
    .sort((a, b) => a.length - b.length)[0];
  return match || key;
}

/** The history, oldest first; one word's when `lemma` is given. */
export async function listAnswerHistory(opts: { lemma?: string; since?: number } = {}): Promise<AnswerRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.lemma) {
    where.push('lemma = ?');
    params.push(answerKey(opts.lemma));
  }
  if (opts.since != null) {
    where.push('answered_at >= ?');
    params.push(opts.since);
  }
  const rows = await getVocabDb().queryAll(
    `SELECT * FROM answer_history ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY answered_at ASC, id ASC`,
    params,
  );
  return rows.map(rowToAnswer);
}

/* ------------------------------------------------------------------ replay */

export interface ReplayResult {
  /** The schedule after the last graded answer; null when the word was never graded. */
  schedule: ScheduleUpdate | null;
  /** "Already know it" as last set. */
  known: boolean;
  /** When the word was started: the prior's start or the first graded answer. */
  startedAt: number | null;
}

function byTime(a: AnswerRecord, b: AnswerRecord): number {
  return a.answeredAt - b.answeredAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Rebuilds a word's schedule from its history: graded answers in time order through FSRS, from a
 * new card or from the prior schedule the first graded answer carries. Deterministic, so every
 * device that holds the same history gets the same state.
 */
export function replaySchedule(history: AnswerRecord[]): ReplayResult {
  const sorted = [...history].sort(byTime);
  let fields: ScheduleFields = {};
  let schedule: ScheduleUpdate | null = null;
  let known = false;
  let startedAt: number | null = null;
  for (const r of sorted) {
    if (r.kind === 'known') {
      known = r.correct;
      continue;
    }
    if (r.grade == null) continue;
    if (!schedule && r.prior) {
      fields = { ...r.prior };
      startedAt = num(r.prior.createdAt) ?? num(r.prior.lastReview) ?? r.answeredAt;
    }
    if (startedAt == null) startedAt = r.answeredAt;
    schedule = scheduleReview(fields, r.grade, r.answeredAt);
    fields = { ...fields, ...schedule };
  }
  return { schedule, known, startedAt };
}

/** The history grouped by word, each oldest first. */
export function historyByWord(history: AnswerRecord[]): Map<string, AnswerRecord[]> {
  const out = new Map<string, AnswerRecord[]>();
  for (const r of history) {
    const k = answerKey(r.lemma);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  for (const list of out.values()) list.sort(byTime);
  return out;
}

/* ----------------------------------------------------------------- mastery */

export interface SkillScore {
  /** 0 to 1: recent answers weigh most (each answer moves the score halfway to 1 or 0). */
  score: number;
  answers: number;
  correct: number;
  mastered: boolean;
  lastAt: number;
}

/** Two right answers in a row from scratch, or three after a miss. */
export const MASTERY_THRESHOLD = 0.75;

/** Per word and skill, how well the word is held, from the answers that tested that skill. */
export function skillMastery(history: AnswerRecord[]): Map<string, Partial<Record<Skill, SkillScore>>> {
  const out = new Map<string, Partial<Record<Skill, SkillScore>>>();
  for (const r of [...history].sort(byTime)) {
    const skill = r.skill ?? skillFor(r.kind);
    if (!skill || r.grade == null) continue;
    const k = answerKey(r.lemma);
    const word = out.get(k) || {};
    const prev = word[skill] || { score: 0, answers: 0, correct: 0, mastered: false, lastAt: 0 };
    const score = prev.score / 2 + (r.correct ? 0.5 : 0);
    word[skill] = {
      score,
      answers: prev.answers + 1,
      correct: prev.correct + (r.correct ? 1 : 0),
      mastered: score >= MASTERY_THRESHOLD - 1e-9,
      lastAt: r.answeredAt,
    };
    out.set(k, word);
  }
  return out;
}
