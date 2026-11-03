/**
 * Word book sync through the Holarky account ('phevere/wordbooks'), beside the notebook's own
 * namespace so older apps that know only 'phevere/vocab' never see these records.
 *
 * Records are `sub:<bookId>` (a subscription and its daily goal) and `word:<headword>` (progress
 * on a book word that is not in My words). Like vocab-sync, each side keeps the newest updatedAt
 * per id and the server wins a tie. Nothing is ever deleted: unsubscribing is an edit. The cached
 * meaning of a book word stays on the device.
 */
import type { SyncChange } from './holarky-account';
import { getVocabDb } from './runtime';
import type { VocabSyncAccount } from './vocab-sync';
import { ensureVocabReady } from './vocab-store';
import { bookWordKey, rowToBookWord, rowToSub, writeBookWord, writeSub, type BookWordProgress, type WordbookSub } from './wordbook-store';

export const WORDBOOK_SYNC_NAMESPACE = 'phevere/wordbooks';
const PAGE = 500;

type SubData = Omit<WordbookSub, 'bookId' | 'updatedAt'>;
type WordData = Omit<BookWordProgress, 'lemma' | 'updatedAt' | 'definition' | 'reading' | 'partOfSpeech'>;
type Record_ = SyncChange<SubData | WordData>;

export interface WordbookSyncResult {
  pushed: number;
  received: number;
}

async function readState(key: string): Promise<string | null> {
  const row = await getVocabDb().queryOne(`SELECT value FROM sync_state WHERE key = ?`, [key]);
  return row && row.value != null ? String(row.value) : null;
}

async function writeState(key: string, value: string): Promise<void> {
  await getVocabDb().runWrite(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [key, value]);
}

let running: Promise<WordbookSyncResult> | null = null;

/** Runs one sync; concurrent calls share it. */
export function syncWordbooks(account: VocabSyncAccount, now: () => number = Date.now): Promise<WordbookSyncResult> {
  if (!running) {
    running = runSync(account, now).finally(() => {
      running = null;
    });
  }
  return running;
}

async function runSync(account: VocabSyncAccount, now: () => number): Promise<WordbookSyncResult> {
  await ensureVocabReady();
  const user = await account.getUser();
  if (!user) throw new Error('Not signed in');
  if ((await readState('wordbooks.user')) !== user.id) {
    await writeState('wordbooks.user', user.id);
    await writeState('wordbooks.cursor', '0');
    await writeState('wordbooks.pushedAt', '0');
  }
  let cursor = Number(await readState('wordbooks.cursor')) || 0;
  const pushedAt = Number(await readState('wordbooks.pushedAt')) || 0;
  const startedAt = now();
  const outgoing = await localChangesSince(pushedAt);
  let received = 0;
  let offset = 0;
  let more = true;
  while (more || offset < outgoing.length) {
    const res = await account.sync<SubData | WordData>(WORDBOOK_SYNC_NAMESPACE, cursor, outgoing.slice(offset, offset + PAGE));
    offset += PAGE;
    for (const change of res.changes) if (await applyRemote(change)) received += 1;
    cursor = res.cursor;
    await writeState('wordbooks.cursor', String(cursor));
    more = res.more;
  }
  await writeState('wordbooks.pushedAt', String(startedAt));
  return { pushed: outgoing.length, received };
}

async function localChangesSince(since: number): Promise<Record_[]> {
  const db = getVocabDb();
  const subs = (await db.queryAll(`SELECT * FROM wordbook_subs WHERE updated_at > ?`, [since])).map(rowToSub);
  const words = (await db.queryAll(`SELECT * FROM book_words WHERE updated_at > ?`, [since])).map(rowToBookWord);
  return [
    ...subs.map((s) => {
      const { bookId, updatedAt, ...data } = s;
      return { id: `sub:${bookId}`, updatedAt, deleted: false, data };
    }),
    ...words.map((w) => {
      const { lemma, updatedAt, definition: _d, reading: _r, partOfSpeech: _p, ...data } = w;
      return { id: `word:${lemma}`, updatedAt, deleted: false, data };
    }),
  ];
}

async function applyRemote(change: { id: string; updatedAt: number; deleted: boolean; data: unknown }): Promise<boolean> {
  if (change.deleted || !change.data || typeof change.data !== 'object') return false;
  const db = getVocabDb();
  const data = change.data as Record<string, unknown>;
  if (change.id.startsWith('sub:')) {
    const bookId = change.id.slice(4);
    const local = await db.queryOne(`SELECT updated_at FROM wordbook_subs WHERE book_id = ?`, [bookId]);
    if (!bookId || (local && Number(local.updated_at) > change.updatedAt)) return false;
    await writeSub({
      bookId,
      dailyNew: Number(data.dailyNew) >= 0 ? Number(data.dailyNew) : 10,
      active: data.active !== false,
      createdAt: Number(data.createdAt) || change.updatedAt,
      updatedAt: change.updatedAt,
    });
    return true;
  }
  if (change.id.startsWith('word:')) {
    const key = bookWordKey(change.id.slice(5));
    const local = await db.queryOne(`SELECT updated_at FROM book_words WHERE lemma = ?`, [key]);
    if (!key || (local && Number(local.updated_at) > change.updatedAt)) return false;
    await writeBookWord({ ...(data as WordData), lemma: key, known: data.known === true, updatedAt: change.updatedAt });
    return true;
  }
  return false;
}
