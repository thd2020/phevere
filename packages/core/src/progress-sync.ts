/**
 * Learning-progress sync through the Holarky account ('phevere/progress'), a Plus feature.
 *
 * Saved words and word-book subscriptions sync free (vocab-sync.ts, wordbook-sync.ts) and carry no
 * progress: the server strips review fields from both. Progress travels only as the answer history
 * (answer-history.ts): each answer is an append-only event `ev:<id>` that never changes once
 * stored. After a pull, every word that received answers from another device has its schedule
 * rebuilt by replaying its merged history, so all devices land on the same FSRS state.
 *
 * Without Plus the server answers 402 `plus_required`; the sync reports that instead of failing and
 * the answers stay on the device, marked unsent, to go up once Plus is active. When the server
 * empties the collection after Plus lapsed, it sends `state:purged` as a deletion; everything local
 * is then sent again.
 */
import { isPlusRequired, PROGRESS_NAMESPACE, type ProgressRecord, type SyncChange, type SyncResult } from './holarky-account';
import { getVocabDb } from './runtime';
import { ensureVocabReady } from './vocab-store';
import { answerKey, insertAnswer, rowToAnswer, skillFor, type AnswerKind, type AnswerRecord } from './answer-history';
import { rebuildWordSchedule } from './wordbook-store';
import type { ScheduleFields } from './review-schedule';

export const PROGRESS_SYNC_NAMESPACE = PROGRESS_NAMESPACE;
const PAGE = 500;

/** The part of HolarkyAccount progress sync needs, so tests can pass a fake. */
export interface ProgressSyncAccount {
  getUser(): Promise<{ id: string } | null>;
  sync<T>(namespace: string, cursor: number, changes: SyncChange<T>[]): Promise<SyncResult<T>>;
}

export type ProgressSyncResult =
  | { status: 'synced'; pushed: number; received: number; rebuilt: number }
  /** Plus is not active; `keptUntil` is when the server deletes what it holds (null: nothing kept). */
  | { status: 'plus_required'; keptUntil: number | null };

/** The event sent for one answer. Field names follow the server's ProgressEvent. */
export function answerToEvent(r: AnswerRecord): SyncChange<ProgressRecord> {
  const data: Record<string, unknown> = {
    lemma: r.lemma,
    reviewedAt: r.answeredAt,
    questionType: r.kind ?? 'unknown',
    correct: r.correct,
  };
  if (r.wordId) data.wordId = r.wordId;
  if (r.ms != null) data.responseMs = r.ms;
  if (r.grade != null) data.grade = r.grade;
  if (r.skill) data.skill = r.skill;
  if (r.bookId) data.bookId = r.bookId;
  if (r.device) data.device = r.device;
  if (r.prior) data.prior = r.prior;
  return { id: `ev:${r.id}`, updatedAt: r.answeredAt, deleted: false, data };
}

/** The answer an event describes, or null when it is not one this app understands. */
export function eventToAnswer(change: SyncChange<ProgressRecord>): AnswerRecord | null {
  if (!change.id.startsWith('ev:') || change.deleted || !change.data) return null;
  const e = change.data as Record<string, unknown>;
  const lemma = typeof e.lemma === 'string' ? answerKey(e.lemma) : '';
  const at = Number(e.reviewedAt);
  if (!lemma || !Number.isFinite(at) || at <= 0) return null;
  const kind = typeof e.questionType === 'string' && e.questionType !== 'unknown' ? (e.questionType as AnswerKind) : null;
  const grade = Number(e.grade);
  return {
    id: change.id.slice(3),
    lemma,
    wordId: typeof e.wordId === 'string' ? e.wordId : null,
    bookId: typeof e.bookId === 'string' ? e.bookId : null,
    answeredAt: at,
    kind,
    skill: skillFor(kind),
    correct: e.correct === true,
    ms: Number.isFinite(Number(e.responseMs)) && e.responseMs != null ? Number(e.responseMs) : null,
    grade: Number.isInteger(grade) && grade >= 1 && grade <= 4 ? (grade as 1 | 2 | 3 | 4) : null,
    device: typeof e.device === 'string' ? e.device : null,
    prior: e.prior && typeof e.prior === 'object' ? (e.prior as ScheduleFields) : null,
  };
}

async function readState(key: string): Promise<string | null> {
  const row = await getVocabDb().queryOne(`SELECT value FROM sync_state WHERE key = ?`, [key]);
  return row && row.value != null ? String(row.value) : null;
}

async function writeState(key: string, value: string): Promise<void> {
  await getVocabDb().runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [key, value]);
}

let running: Promise<ProgressSyncResult> | null = null;

/** Runs one progress sync; concurrent calls share it. */
export function syncProgress(account: ProgressSyncAccount): Promise<ProgressSyncResult> {
  if (!running) {
    running = runSync(account).finally(() => {
      running = null;
    });
  }
  return running;
}

async function runSync(account: ProgressSyncAccount): Promise<ProgressSyncResult> {
  await ensureVocabReady();
  const db = getVocabDb();
  const user = await account.getUser();
  if (!user) throw new Error('Not signed in');
  // Progress belongs to one account: a different account starts over and gets this device's answers.
  if ((await readState('progress.user')) !== user.id) {
    await writeState('progress.user', user.id);
    await writeState('progress.cursor', '0');
    await db.runWrite(`UPDATE answer_history SET synced = 0`);
  }
  let cursor = Number(await readState('progress.cursor')) || 0;
  let pushed = 0;
  let received = 0;
  const touched = new Set<string>();
  try {
    for (let round = 0; round < 2; round++) {
      let purged = false;
      const outgoing = (await db.queryAll(`SELECT * FROM answer_history WHERE synced = 0 ORDER BY answered_at ASC, id ASC`)).map(rowToAnswer);
      let offset = 0;
      let more = true;
      while (more || offset < outgoing.length) {
        const batch = outgoing.slice(offset, offset + PAGE);
        const res = await account.sync<ProgressRecord>(PROGRESS_SYNC_NAMESPACE, cursor, batch.map(answerToEvent));
        offset += PAGE;
        if (batch.length) {
          for (const r of batch) await db.runWrite(`UPDATE answer_history SET synced = 1 WHERE id = ?`, [r.id]);
          pushed += batch.length;
        }
        for (const change of res.changes) {
          if (change.id === 'state:purged' && change.deleted) {
            purged = true;
            continue;
          }
          const answer = eventToAnswer(change);
          if (answer && (await insertAnswer(answer, true))) {
            received += 1;
            touched.add(answer.lemma);
          }
        }
        cursor = res.cursor;
        await writeState('progress.cursor', String(cursor));
        more = res.more;
      }
      // The server emptied the collection (Plus had lapsed): send everything again, once.
      if (!purged) break;
      await db.runWrite(`UPDATE answer_history SET synced = 0`);
    }
  } catch (err) {
    // isPlusRequired checks the class; an error from another copy of the client has the code only.
    if (isPlusRequired(err) || (err as { code?: unknown })?.code === 'plus_required') {
      const details = ((err as { details?: unknown }).details || {}) as { keptUntil?: unknown };
      const kept = Number(details.keptUntil);
      return { status: 'plus_required', keptUntil: Number.isFinite(kept) && kept > 0 ? kept : null };
    }
    throw err;
  }
  let rebuilt = 0;
  for (const lemma of touched) if (await rebuildWordSchedule(lemma)) rebuilt += 1;
  return { status: 'synced', pushed, received, rebuilt };
}
