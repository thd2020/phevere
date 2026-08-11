/**
 * Local SQLite via sql.js — prefer asm.js build (no WASM file) for packaged Electron,
 * with WASM as optional fast path when sql-wasm.wasm is present in resources.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { wrapConsole } from '../logger';

const console = wrapConsole('local-db');
const nodeRequire = createRequire(__filename);

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

type SqlJsInit = (cfg?: {
  locateFile?: (f: string) => string;
}) => Promise<{ Database: new (data?: ArrayLike<number> | null) => SqlJsDatabase }>;

let db: SqlJsDatabase | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let dbPath = '';
let initError: string | null = null;

function resolveDbPath(): string {
  try {
    return path.join(app.getPath('userData'), 'phevere.sqlite');
  } catch {
    return path.join(process.cwd(), 'phevere.sqlite');
  }
}

function resolveWasmPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'sql-wasm.wasm'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function resolveSqlAsmPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'sql-asm.js'),
    path.join(process.resourcesPath || '', 'sql.js', 'sql-asm.js'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-asm.js'),
    // Webpack main lands in .webpack/main → repo root is ../..
    path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-asm.js'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-asm.js'),
  ];
  try {
    const appPath = app.getAppPath();
    candidates.push(path.join(appPath, 'node_modules', 'sql.js', 'dist', 'sql-asm.js'));
    if (appPath.includes('app.asar')) {
      candidates.push(
        path.join(appPath.replace('app.asar', 'app.asar.unpacked'), 'node_modules', 'sql.js', 'dist', 'sql-asm.js'),
      );
    }
  } catch {
    /* ignore */
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function tryRequireSqlJs(specifier: string): SqlJsInit | null {
  try {
    return nodeRequire(specifier) as SqlJsInit;
  } catch (e) {
    console.warn('require failed', specifier, e);
    return null;
  }
}

function loadSqlJsInit(): { init: SqlJsInit; mode: 'asm' | 'wasm' } {
  // Prefer absolute asm path first — survives Electron packaging better than package exports.
  const asmFile = resolveSqlAsmPath();
  if (asmFile) {
    const abs = tryRequireSqlJs(asmFile);
    if (abs) {
      console.log('sql.js asm loaded from', asmFile);
      return { init: abs, mode: 'asm' };
    }
  }

  const asm =
    tryRequireSqlJs('sql.js/dist/sql-asm.js') ||
    tryRequireSqlJs('sql.js/dist/sql-asm.js'.replace(/\//g, path.sep));
  if (asm) return { init: asm, mode: 'asm' };

  const wasm =
    tryRequireSqlJs('sql.js') ||
    tryRequireSqlJs(path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js'));
  if (wasm) return { init: wasm, mode: 'wasm' };

  throw new Error(
    'sql.js not found. Reinstall the app or ensure sql-asm.js is shipped (extraResources / asarUnpack).',
  );
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

export function getLocalDbInitError(): string | null {
  return initError;
}

export async function getLocalDb(): Promise<SqlJsDatabase> {
  if (db) return db;
  if (initError) throw new Error(initError);

  try {
    dbPath = resolveDbPath();
    const { init, mode } = loadSqlJsInit();
    const wasmPath = resolveWasmPath();
    const SQL = await init(
      mode === 'wasm' && wasmPath
        ? {
            locateFile: (file: string) => {
              if (file.endsWith('.wasm') && fs.existsSync(wasmPath)) return wasmPath;
              return path.join(path.dirname(wasmPath), file);
            },
          }
        : undefined,
    );

    if (fs.existsSync(dbPath)) {
      const buf = fs.readFileSync(dbPath);
      db = new SQL.Database(new Uint8Array(buf));
    } else {
      db = new SQL.Database();
    }
    migrate(db);
    scheduleSave();
    console.log('Local SQLite ready', { dbPath, mode, wasmPath });
    void importPackagedSeeds().catch((e) => console.warn('seed import skipped', e));
    return db;
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error);
    console.error('Local SQLite init failed', initError);
    throw error instanceof Error ? error : new Error(initError);
  }
}

/** One-shot import of resources/seed dumps shipped with the installer. */
async function importPackagedSeeds(): Promise<void> {
  const marker = path.join(path.dirname(dbPath), '.phevere-seed-imported');
  if (fs.existsSync(marker)) return;

  const seedDirs = [
    path.join(process.resourcesPath || '', 'seed'),
    path.join(process.cwd(), 'resources', 'seed'),
  ];
  const seedDir = seedDirs.find((d) => d && fs.existsSync(d));
  if (!seedDir) {
    fs.writeFileSync(marker, String(Date.now()));
    return;
  }

  const files = fs.readdirSync(seedDir).filter((f) => !f.startsWith('.') && f !== 'README.md');
  if (!files.length) {
    fs.writeFileSync(marker, String(Date.now()));
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const offline = require('./offline-dict-store') as typeof import('./offline-dict-store');
  for (const file of files) {
    const full = path.join(seedDir, file);
    try {
      if (/\.(json|jsonl|ndjson)$/i.test(file)) {
        await offline.importJsonFile(full, { name: file, packId: `seed-${file}` });
      } else if (/\.(txt|u8)$/i.test(file) && /cedict/i.test(file)) {
        await offline.importCedictTextFile(full, `seed-${file}`);
      }
    } catch (e) {
      console.warn('Failed to import seed', file, e);
    }
  }
  fs.writeFileSync(marker, String(Date.now()));
  console.log('Seed packs imported', { seedDir, count: files.length });
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
