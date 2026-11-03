/**
 * Word book sync through the Holarky account ('phevere/wordbooks'), beside the notebook's own
 * namespace so older apps that know only 'phevere/vocab' never see these records. It is free.
 *
 * Records are `sub:<bookId>`: a subscription and its daily goal. Like vocab-sync, each side keeps
 * the newest updatedAt per id and the server wins a tie. Nothing is ever deleted: unsubscribing is
 * an edit.
 *
 * Progress on book words is learning progress, so it no longer travels here. It is in the answer
 * history, which syncs in 'phevere/progress' for Plus accounts (progress-sync.ts); "Already know
 * it" is an answer there too. `word:<headword>` records that older apps still send are ignored,
 * and the server strips their review fields anyway.
 *
 * A book the learner made is `book:<id>`: { name, source, words, deleted, createdAt, parts }, the
 * headwords and nothing about progress. The server caps a record at 64 KB of JSON, so a long
 * list continues in `book:<id>:1`, `book:<id>:2` and so on, all sent with the same updatedAt. The
 * receiving side keeps the pieces in sync_state until every one has arrived, then writes the book.
 */
import type { SyncChange } from './holarky-account';
import { getVocabDb } from './runtime';
import type { VocabSyncAccount } from './vocab-sync';
import { ensureVocabReady } from './vocab-store';
import { rowToSub, rowToUserBook, writeSub, writeUserBook, type WordbookSub } from './wordbook-store';

export const WORDBOOK_SYNC_NAMESPACE = 'phevere/wordbooks';
const PAGE = 500;

type SubData = Omit<WordbookSub, 'bookId' | 'updatedAt'>;
type BookData = { name: string; source?: string; words: string[]; deleted: boolean; createdAt: number; parts: number };
type PartData = { words: string[] };
type Record_ = SyncChange<SubData | BookData | PartData>;

/** JSON characters per record's word list, well under the server's 64 KB cap. */
export const BOOK_PART_CHARS = 40000;

/** Splits a word list into pieces whose JSON stays under `max` characters. */
export function splitWords(words: string[], max = BOOK_PART_CHARS): string[][] {
  const parts: string[][] = [[]];
  let size = 2;
  for (const w of words) {
    const add = JSON.stringify(w).length + 1;
    if (size + add > max && parts[parts.length - 1].length) {
      parts.push([]);
      size = 2;
    }
    parts[parts.length - 1].push(w);
    size += add;
  }
  return parts;
}

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
    const res = await account.sync<SubData | BookData | PartData>(WORDBOOK_SYNC_NAMESPACE, cursor, outgoing.slice(offset, offset + PAGE));
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
  const books = (await db.queryAll(`SELECT * FROM user_books WHERE updated_at > ?`, [since])).map(rowToUserBook);
  return [
    ...subs.map((s) => {
      const { bookId, updatedAt, ...data } = s;
      return { id: `sub:${bookId}`, updatedAt, deleted: false, data };
    }),
    ...books.flatMap((b) => {
      const parts = splitWords(b.words);
      const head: Record_ = {
        id: `book:${b.bookId}`,
        updatedAt: b.updatedAt,
        deleted: false,
        data: { name: b.title, source: b.source, words: parts[0], deleted: b.deleted, createdAt: b.createdAt, parts: parts.length },
      };
      return [head, ...parts.slice(1).map((p, i) => ({ id: `book:${b.bookId}:${i + 1}`, updatedAt: b.updatedAt, deleted: false, data: { words: p } }))];
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
  // Progress on book words travels in the answer history now; older apps' word: records are ignored.
  if (change.id.startsWith('book:')) {
    const rest = change.id.slice(5);
    const m = /^(.+):(\d+)$/.exec(rest);
    const bookId = m ? m[1] : rest;
    const part = m ? Number(m[2]) : 0;
    if (!bookId) return false;
    const words = Array.isArray(data.words) ? data.words.map(String) : [];
    await writeState(`ub.${bookId}.${part}`, JSON.stringify({ ...data, words, updatedAt: change.updatedAt }));
    return assembleBook(bookId);
  }
  return false;
}

/** Writes a made book once its first record and every continuation with the same updatedAt are here. */
async function assembleBook(bookId: string): Promise<boolean> {
  const db = getVocabDb();
  const read = async (n: number) => {
    const raw = await readState(`ub.${bookId}.${n}`);
    try {
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const head = await read(0);
  if (!head) return false;
  const at = Number(head.updatedAt) || 0;
  const parts = Math.max(1, Math.min(1000, Number(head.parts) || 1));
  const words = [...((head.words as string[]) || [])];
  for (let n = 1; n < parts; n++) {
    const p = await read(n);
    if (!p || Number(p.updatedAt) !== at) return false;
    words.push(...((p.words as string[]) || []));
  }
  const clear = async () => {
    for (let n = 0; n < parts; n++) await db.runWrite(`DELETE FROM sync_state WHERE key = ?`, [`ub.${bookId}.${n}`]);
  };
  const local = await db.queryOne(`SELECT updated_at FROM user_books WHERE book_id = ?`, [bookId]);
  if (local && Number(local.updated_at) > at) {
    await clear();
    return false;
  }
  await writeUserBook({
    bookId,
    title: String(head.name || '').trim() || 'My word book',
    words,
    source: typeof head.source === 'string' ? head.source : undefined,
    deleted: head.deleted === true,
    createdAt: Number(head.createdAt) || at,
    updatedAt: at,
  });
  await clear();
  return true;
}
