import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { VOCAB_SCHEMA_SQL, type VocabDb } from '@phevere/core';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { hasNativeBridge, nativeCall } from './native';

const DB_FILE = 'phevere.sqlite';
const SAVE_MS = 400;
const LS_KEY = 'phevere.sqlite.b64';

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let initError: string | null = null;
let readyPromise: Promise<void> | null = null;

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
}

async function readStored(): Promise<Uint8Array | null> {
  try {
    if (hasNativeBridge()) {
      const res = await nativeCall<{ b64?: string | null }>('readFile', { name: DB_FILE });
      if (typeof res.b64 === 'string' && res.b64) return base64ToBytes(res.b64);
      return null;
    }
    const raw = localStorage.getItem(LS_KEY);
    return raw ? base64ToBytes(raw) : null;
  } catch {
    return null;
  }
}

async function writeStored(bytes: Uint8Array): Promise<void> {
  const data = bytesToBase64(bytes);
  if (hasNativeBridge()) {
    await nativeCall('writeFile', { name: DB_FILE, b64: data });
    return;
  }
  localStorage.setItem(LS_KEY, data);
}

function scheduleSave(): void {
  if (!db) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persist().catch((err) => console.warn('[sqljs-db] persist failed', err));
  }, SAVE_MS);
}

async function persist(): Promise<void> {
  if (!db) return;
  await writeStored(db.export());
}

async function open(): Promise<void> {
  SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const stored = await readStored();
  db = stored && stored.length ? new SQL.Database(stored) : new SQL.Database();
  migrate(db);
}

export function getSqlDatabase(): Database | null {
  return db;
}

export function markDbDirty(): void {
  scheduleSave();
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
    scheduleSave();
  },
};
