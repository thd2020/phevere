/**
 * Local SQLite via sql.js (WASM) — industrial SQLite without native rebuilds.
 * Persists to userData/phevere.sqlite for vocab notebook + offline dictionary packs.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { wrapConsole } from '../logger';

const console = wrapConsole('local-db');

type SqlJsDatabase = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  prepare: (sql: string) => {
    bind: (params: unknown[]) => void;
    step: () => boolean;
    getAsObject: () => Record<string, unknown>;
    free: () => void;
  };
  export: () => Uint8Array;
  close: () => void;
};

let db: SqlJsDatabase | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let dbPath = '';

function resolveDbPath(): string {
  try {
    return path.join(app.getPath('userData'), 'phevere.sqlite');
  } catch {
    return path.join(process.cwd(), 'phevere.sqlite');
  }
}

function resolveWasmPath(): string {
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.resourcesPath || '', 'sql-wasm.wasm'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[0];
}

async function loadSqlJs(): Promise<(cfg?: { locateFile?: (f: string) => string }) => Promise<{ Database: new (data?: ArrayLike<number> | null) => SqlJsDatabase }>> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js');
  return initSqlJs;
}

function migrate(database: SqlJsDatabase): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS vocab (
      id TEXT PRIMARY KEY,
      lemma TEXT NOT NULL,
      reading TEXT,
      definition TEXT,
      part_of_speech TEXT,
      source_lang TEXT,
      target_lang TEXT,
      sources TEXT,
      note TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      review_due INTEGER,
      review_interval INTEGER DEFAULT 0,
      ease REAL DEFAULT 2.5,
      reps INTEGER DEFAULT 0
    );
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_vocab_lemma ON vocab(lemma);`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_vocab_updated ON vocab(updated_at DESC);`);

  database.run(`
    CREATE TABLE IF NOT EXISTS offline_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      headword TEXT NOT NULL COLLATE NOCASE,
      language TEXT NOT NULL DEFAULT 'en',
      pos TEXT,
      definition TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      extra TEXT
    );
  `);
  database.run(`CREATE INDEX IF NOT EXISTS idx_offline_head ON offline_entries(headword);`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_offline_pack ON offline_entries(pack_id);`);

  database.run(`
    CREATE TABLE IF NOT EXISTS offline_packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      language TEXT NOT NULL,
      source TEXT,
      entry_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
}

function scheduleSave(): void {
  if (!db) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      persist();
    } catch (error) {
      console.warn('persist failed', error);
    }
  }, 400);
}

export function persist(): void {
  if (!db || !dbPath) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

export async function getLocalDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  dbPath = resolveDbPath();
  const initSqlJs = await loadSqlJs();
  const wasmPath = resolveWasmPath();
  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      if (file.endsWith('.wasm') && fs.existsSync(wasmPath)) return wasmPath;
      return path.join(path.dirname(wasmPath), file);
    },
  });

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();
  }
  migrate(db);
  scheduleSave();
  console.log('Local SQLite ready', { dbPath });
  return db;
}

export function runWrite(sql: string, params: unknown[] = []): void {
  if (!db) throw new Error('DB not ready');
  db.run(sql, params);
  scheduleSave();
}

export function queryAll<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  if (!db) throw new Error('DB not ready');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

export function queryOne<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows[0] || null;
}

export function markDirty(): void {
  scheduleSave();
}
