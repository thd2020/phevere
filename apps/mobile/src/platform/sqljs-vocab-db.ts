import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { VOCAB_SCHEMA_SQL, vocabColumnMigrations, type VocabDb } from '@phevere/core';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { hasNativeBridge, nativeCall } from './native';

/**
 * The notebook as a sql.js database in this page's memory, saved to one file on the phone.
 *
 * Android runs up to three pages at once over that file: the app, and the pop-up over another
 * app (floating or as a bottom sheet). Each holds its own copy, so a page must never write a
 * copy older than the file. The native side keeps a version number for the file: a page writes
 * with the version it read, a stale write is refused, and the page then reloads the file and
 * applies its own changes again (the statements since its last save) before writing. Every
 * write is announced to the other pages (`__pvNotebookChanged`), which reload at once.
 */

const DB_FILE = 'phevere.sqlite';
const SAVE_MS = 400;
const LS_KEY = 'phevere.sqlite.b64';
/** A conflict means someone else wrote; more than a few in a row means something is wrong. */
const MAX_ATTEMPTS = 4;

/** A statement, or a change made straight on the database that can be made again (an offline pack). */
type Stmt = { sql: string; params: unknown[] } | { apply: (d: Database) => void | Promise<void> };

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let initError: string | null = null;
let readyPromise: Promise<void> | null = null;

/** The file's version this copy holds; null without the native notebook (browser, older shell). */
let version: number | null = null;
/** Statements run since the last write that reached the file, for replaying onto a newer file. */
let log: Stmt[] = [];
let dirty = false;
/** One write or reload at a time. */
let chain: Promise<void> = Promise.resolve();
const reloadListeners = new Set<() => void>();

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function migrate(database: Database): void {
  for (const stmt of VOCAB_SCHEMA_SQL.split(';')) {
    const sql = stmt.trim();
    if (sql) database.run(sql);
  }
  const info = database.exec('PRAGMA table_info(vocab)')[0];
  const nameAt = info ? info.columns.indexOf('name') : -1;
  const cols = info && nameAt >= 0 ? info.values.map((row) => String(row[nameAt])) : [];
  for (const sql of vocabColumnMigrations(cols)) database.run(sql);
}

function isUnknownMethod(err: unknown): boolean {
  return err instanceof Error && /Unknown method/i.test(err.message);
}

/**
 * The stored notebook and its version. A file that exists but cannot be read is an error:
 * starting an empty notebook would overwrite the learner's words on the next save.
 */
async function readStored(): Promise<{ bytes: Uint8Array | null; version: number | null }> {
  if (hasNativeBridge()) {
    try {
      const res = await nativeCall<{ b64?: string | null; version?: number }>('notebookRead', {});
      return { bytes: res.b64 ? base64ToBytes(res.b64) : null, version: Number(res.version) || 0 };
    } catch (err) {
      if (!isUnknownMethod(err)) throw err;
    }
    const res = await nativeCall<{ b64?: string | null }>('readFile', { name: DB_FILE });
    return { bytes: typeof res.b64 === 'string' && res.b64 ? base64ToBytes(res.b64) : null, version: null };
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    return { bytes: raw ? base64ToBytes(raw) : null, version: null };
  } catch {
    return { bytes: null, version: null };
  }
}

/** Writes the bytes; false when the file has moved on since `version` (nothing written). */
async function writeStored(bytes: Uint8Array): Promise<boolean> {
  const data = bytesToBase64(bytes);
  if (hasNativeBridge()) {
    if (version != null) {
      const res = await nativeCall<{ ok?: boolean; conflict?: boolean; version?: number }>('notebookWrite', { b64: data, base: version });
      if (res.conflict) return false;
      version = Number(res.version);
      return true;
    }
    await nativeCall('writeFile', { name: DB_FILE, b64: data });
    return true;
  }
  localStorage.setItem(LS_KEY, data);
  return true;
}

function openBytes(bytes: Uint8Array | null): Database {
  const next = bytes && bytes.length ? new SQL!.Database(bytes) : new SQL!.Database();
  migrate(next);
  return next;
}

/** Swaps in the file's newer notebook and makes this page's unsaved changes on it again. */
async function reload(): Promise<void> {
  const stored = await readStored();
  const next = openBytes(stored.bytes);
  // A statement run while a replay waits is added to the log, and this loop reaches it too.
  for (const s of log) {
    try {
      if ('apply' in s) await s.apply(next);
      else next.run(s.sql, s.params as never[]);
    } catch (err) {
      // The other page changed the same row (a word saved in both): its version stands.
      console.warn('[sqljs-db] replay skipped', err);
    }
  }
  const old = db;
  db = next;
  version = stored.version;
  old?.close();
  for (const fn of reloadListeners) {
    try {
      fn();
    } catch (err) {
      console.warn('[sqljs-db] reload listener failed', err);
    }
  }
}

function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function persistNow(): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (!db || !dirty) return;
    const upto = log.length;
    dirty = false;
    let ok = false;
    try {
      ok = await writeStored(db.export());
    } catch (err) {
      dirty = true;
      throw err;
    }
    if (ok) {
      log = log.slice(upto);
      if (log.length) dirty = true;
      return;
    }
    dirty = true;
    await reload();
  }
  throw new Error('The notebook kept changing while saving');
}

function persist(): Promise<void> {
  return serial(persistNow);
}

function scheduleSave(): void {
  if (!db) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist().catch((err) => console.warn('[sqljs-db] persist failed', err));
  }, SAVE_MS);
}

/** Writes pending changes now, rather than after the short wait that batches them. */
export function flushNotebook(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return persist();
}

/** Whether this page holds changes the file does not have yet. */
export function notebookPending(): boolean {
  return dirty || saveTimer != null;
}

/** Reloads when another page wrote the file since this copy was read. */
async function refresh(): Promise<void> {
  if (!db || version == null || !hasNativeBridge()) return;
  await serial(async () => {
    let current: number;
    try {
      current = Number((await nativeCall<{ version?: number }>('notebookVersion', {}, 5000)).version);
    } catch {
      return;
    }
    if (current === version) return;
    await reload();
  });
  if (dirty) scheduleSave();
}

/** Called after this page swapped in a notebook another page wrote. */
export function onNotebookReloaded(fn: () => void): () => void {
  reloadListeners.add(fn);
  return () => reloadListeners.delete(fn);
}

async function open(): Promise<void> {
  SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const stored = await readStored();
  db = openBytes(stored.bytes);
  version = stored.version;
}

/** A throwaway database over a file's bytes (an Anki package's collection), read-only use. */
export async function openSqliteBytes(bytes: Uint8Array): Promise<{ all(sql: string): Array<Record<string, unknown>>; close(): void }> {
  if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const temp = new SQL.Database(bytes);
  return {
    all(sql: string) {
      const res = temp.exec(sql)[0];
      return res ? res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]]))) : [];
    },
    close: () => temp.close(),
  };
}

/**
 * A change made straight on the database, too large to log statement by statement (an offline
 * pack's rows). `task` runs with no reload or save in between, so the database it is given
 * stays the open one. `replay` makes the same change on a newer file if the other page writes
 * before this one has saved.
 */
export function writeDirect(task: (d: Database) => Promise<void>, replay: (d: Database) => void | Promise<void>): Promise<void> {
  return serial(async () => {
    await sqlJsVocabDb.ready();
    if (!db) throw new Error('notebook db not open');
    await task(db);
    if (version != null) log.push({ apply: replay });
    dirty = true;
    scheduleSave();
  });
}

if (typeof window !== 'undefined') {
  const hooks = window as unknown as {
    __pvNotebookChanged?: (v: number) => void;
    __pvFlushNotebook?: () => boolean;
  };
  // Another page wrote the notebook.
  hooks.__pvNotebookChanged = (v) => {
    if (version == null || v === version) return;
    void refresh().catch((err) => console.warn('[sqljs-db] reload failed', err));
  };
  // The pop-up is closing: true when there is something to write, and native waits for
  // "notebookFlushed"; false when it may close at once.
  hooks.__pvFlushNotebook = () => {
    if (!notebookPending()) return false;
    void flushNotebook()
      .catch((err) => console.warn('[sqljs-db] persist failed', err))
      .finally(() => {
        if (hasNativeBridge()) void nativeCall('notebookFlushed', {}).catch(() => undefined);
      });
    return true;
  };
}
if (typeof document !== 'undefined') {
  // Leaving the app (home, recents, the screen off): write now, while the page still runs.
  // Coming back: pick up what the pop-up saved meanwhile.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (notebookPending()) void flushNotebook().catch((err) => console.warn('[sqljs-db] persist failed', err));
    } else void refresh().catch(() => undefined);
  });
}

export const sqlJsVocabDb: VocabDb = {
  async ready() {
    if (db) return;
    if (readyPromise) return readyPromise;
    readyPromise = open().catch((err) => {
      initError = err instanceof Error ? err.message : String(err);
      readyPromise = null;
      throw err;
    });
    return readyPromise;
  },
  initError: () => initError,
  async queryAll(sql, params = []) {
    await sqlJsVocabDb.ready();
    if (!db) return [];
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params as never[]);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
      return rows;
    } finally {
      stmt.free();
    }
  },
  async queryOne(sql, params = []) {
    const rows = await sqlJsVocabDb.queryAll(sql, params);
    return rows[0] || null;
  },
  async runWrite(sql, params = []) {
    await sqlJsVocabDb.ready();
    if (!db) throw new Error('notebook db not open');
    db.run(sql, params as never[]);
    if (version != null) log.push({ sql, params: [...params] });
    dirty = true;
    scheduleSave();
  },
  refresh,
};
