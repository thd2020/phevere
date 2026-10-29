/**
 * Notebook sync through the Holarky account ('phevere/vocab').
 *
 * Every row is a record { id, updatedAt, deleted, data }. A sync pushes rows and tombstones
 * changed since the last push, then pulls everything newer than the stored cursor. Both sides
 * keep the newest updatedAt per id; on a tie the server's copy wins, so devices converge.
 * The same word saved on two devices gets two ids; after each pull, rows sharing a lemma are
 * merged into the smallest id and the others become tombstones, the same way on every device.
 */

import type { SyncChange, SyncResult } from './holarky-account';
import { getVocabDb } from './runtime';
import { ensureVocabReady, rowToEntry, type VocabEntry } from './vocab-store';

export const VOCAB_SYNC_NAMESPACE = 'phevere/vocab';
const PAGE = 500;

type SyncRecord = SyncChange<Partial<VocabEntry>>;

/** The part of HolarkyAccount sync needs, so tests can pass a fake. */
export interface VocabSyncAccount {
  getUser(): Promise<{ id: string } | null>;
  sync<T>(namespace: string, cursor: number, changes: SyncChange<T>[]): Promise<SyncResult<T>>;
}

export interface VocabSyncResult {
  /** Local rows and deletions sent. */
  pushed: number;
  /** Remote edits and deletions applied here. */
  received: number;
  /** Duplicate rows for one word folded into one. */
  merged: number;
  at: number;
}

let running: Promise<VocabSyncResult> | null = null;

/** Runs one sync; concurrent calls share it. */
export function syncVocab(account: VocabSyncAccount, now: () => number = Date.now): Promise<VocabSyncResult> {
  if (!running) {
    running = runSync(account, now).finally(() => {
      running = null;
    });
  }
  return running;
}

async function readState(key: string): Promise<string | null> {
  const row = await getVocabDb().queryOne(`SELECT value FROM sync_state WHERE key = ?`, [key]);
  return row && row.value != null ? String(row.value) : null;
}

async function writeState(key: string, value: string): Promise<void> {
  await getVocabDb().runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [key, value]);
}

async function runSync(account: VocabSyncAccount, now: () => number): Promise<VocabSyncResult> {
  await ensureVocabReady();
  const user = await account.getUser();
  if (!user) throw new Error('Not signed in');

  // Sync state belongs to one account. A different account starts over and receives this
  // device's notebook as new entries.
  if ((await readState('vocab.user')) !== user.id) {
    await writeState('vocab.user', user.id);
    await writeState('vocab.cursor', '0');
    await writeState('vocab.pushedAt', '0');
  }
  let cursor = Number(await readState('vocab.cursor')) || 0;
  const pushedAt = Number(await readState('vocab.pushedAt')) || 0;

  const startedAt = now();
  const outgoing = await localChangesSince(pushedAt);
  let received = 0;
  const exchange = async (changes: SyncRecord[]) => {
    let offset = 0;
    let more = true;
    while (more || offset < changes.length) {
      const res = await account.sync<Partial<VocabEntry>>(VOCAB_SYNC_NAMESPACE, cursor, changes.slice(offset, offset + PAGE));
      offset += PAGE;
      for (const change of res.changes) if (await applyRemote(change)) received += 1;
      cursor = res.cursor;
      await writeState('vocab.cursor', String(cursor));
      more = res.more;
    }
  };

  await exchange(outgoing);
  await writeState('vocab.pushedAt', String(startedAt));

  // Folding duplicates edits rows here; send those edits now rather than on the next sync.
  const mergeAt = now();
  const merged = await mergeDuplicateLemmas(mergeAt);
  let pushed = outgoing.length;
  if (merged) {
    const followUp = await localChangesSince(mergeAt - 1);
    pushed += followUp.length;
    await exchange(followUp);
  }
  return { pushed, received, merged, at: now() };
}

async function localChangesSince(since: number): Promise<SyncRecord[]> {
  const db = getVocabDb();
  const rows = await db.queryAll(`SELECT * FROM vocab WHERE updated_at > ?`, [since]);
  const tombs = await db.queryAll(`SELECT id, deleted_at FROM vocab_deleted WHERE deleted_at > ?`, [since]);
  return [
    ...rows.map((row) => {
      const entry = rowToEntry(row);
      return { id: entry.id, updatedAt: entry.updatedAt, deleted: false, data: entry };
    }),
    ...tombs.map((t) => ({ id: String(t.id), updatedAt: Number(t.deleted_at), deleted: true, data: null as Partial<VocabEntry> | null })),
  ];
}

/** Applies one record from the server unless this device holds something newer. */
async function applyRemote(change: { id: string; updatedAt: number; deleted: boolean; data: Partial<VocabEntry> | null }): Promise<boolean> {
  const db = getVocabDb();
  const local = await db.queryOne(`SELECT updated_at FROM vocab WHERE id = ?`, [change.id]);
  if (local && Number(local.updated_at) > change.updatedAt) return false;

  if (change.deleted) {
    if (local) await db.runWrite(`DELETE FROM vocab WHERE id = ?`, [change.id]);
    await db.runWrite(`INSERT OR REPLACE INTO vocab_deleted (id, deleted_at) VALUES (?, ?)`, [change.id, change.updatedAt]);
    return true;
  }

  const tomb = await db.queryOne(`SELECT deleted_at FROM vocab_deleted WHERE id = ?`, [change.id]);
  if (tomb && Number(tomb.deleted_at) > change.updatedAt) return false;
  const e = change.data;
  if (!e || typeof e.lemma !== 'string' || !e.lemma.trim()) return false;
  await writeRow({ ...(e as VocabEntry), id: change.id, updatedAt: change.updatedAt });
  if (tomb) await db.runWrite(`DELETE FROM vocab_deleted WHERE id = ?`, [change.id]);
  return true;
}

async function writeRow(e: VocabEntry): Promise<void> {
  const list = (v: unknown) => (Array.isArray(v) && v.length ? JSON.stringify(v.map(String)) : null);
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  await getVocabDb().runWrite(
    `INSERT OR REPLACE INTO vocab (id, lemma, reading, definition, part_of_speech, source_lang, target_lang, sources, note, tags, created_at, updated_at, review_due, review_interval, ease, reps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id,
      e.lemma.trim(),
      text(e.reading),
      text(e.definition),
      text(e.partOfSpeech),
      text(e.sourceLang),
      text(e.targetLang),
      list(e.sources),
      text(e.note),
      list(e.tags),
      num(e.createdAt) ?? e.updatedAt,
      e.updatedAt,
      num(e.reviewDue),
      num(e.reviewInterval) ?? 0,
      num(e.ease) ?? 2.5,
      num(e.reps) ?? 0,
    ],
  );
}

/**
 * Folds rows that share a lemma (case-insensitive) into the row with the smallest id. Text fields
 * take the newest non-empty value, sources and tags are combined, and review progress comes from
 * the most-reviewed row. Returns how many rows were folded away.
 */
export async function mergeDuplicateLemmas(at: number): Promise<number> {
  const db = getVocabDb();
  const groups = await db.queryAll(`SELECT lower(lemma) AS k FROM vocab GROUP BY lower(lemma) HAVING COUNT(*) > 1`);
  let folded = 0;
  for (const g of groups) {
    const entries = (await db.queryAll(`SELECT * FROM vocab WHERE lower(lemma) = ?`, [g.k])).map(rowToEntry);
    if (entries.length < 2) continue;
    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const keep = entries[0];
    const newest = [...entries].sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
    const pick = <K extends keyof VocabEntry>(key: K): VocabEntry[K] | undefined =>
      newest.find((e) => typeof e[key] === 'string' && String(e[key]).trim())?.[key];
    const union = (key: 'sources' | 'tags') => {
      const all = entries.flatMap((e) => e[key] || []);
      return all.length ? [...new Set(all)] : undefined;
    };
    const studied = [...newest].sort((a, b) => (b.reps || 0) - (a.reps || 0))[0];
    await writeRow({
      id: keep.id,
      lemma: keep.lemma,
      reading: pick('reading'),
      definition: pick('definition'),
      partOfSpeech: pick('partOfSpeech'),
      sourceLang: pick('sourceLang'),
      targetLang: pick('targetLang'),
      note: pick('note'),
      sources: union('sources'),
      tags: union('tags'),
      createdAt: Math.min(...entries.map((e) => e.createdAt || at)),
      updatedAt: at,
      reviewDue: studied.reviewDue,
      reviewInterval: studied.reviewInterval,
      ease: studied.ease,
      reps: studied.reps,
    });
    for (const e of entries.slice(1)) {
      await db.runWrite(`DELETE FROM vocab WHERE id = ?`, [e.id]);
      await db.runWrite(`INSERT OR REPLACE INTO vocab_deleted (id, deleted_at) VALUES (?, ?)`, [e.id, at]);
      folded += 1;
    }
  }
  return folded;
}
