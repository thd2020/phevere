/**
 * Local SQLite via sql.js in a worker thread.
 *
 * The notebook file can be tens of MB (CC-CEDICT). Loading it on Electron's
 * main thread freezes IPC — popup resize, dictionary-lookup, and toolstrip
 * clicks all look dead until sql.js finishes.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { wrapConsole } from '../logger';

const console = wrapConsole('local-db');

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

let worker: Worker | null = null;
let dbPath = '';
let initError: string | null = null;
let initPromise: Promise<void> | null = null;
let ready = false;
let saveTimer: NodeJS.Timeout | null = null;
let rpcSeq = 0;
const pending = new Map<number, Pending>();

function resolveDbPath(): string {
  try {
    return path.join(app.getPath('userData'), 'phevere.sqlite');
  } catch {
    return path.join(process.cwd(), 'phevere.sqlite');
  }
}

function resolveSqlAsmPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'sql-asm.js'),
    path.join(process.resourcesPath || '', 'sql.js', 'sql-asm.js'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-asm.js'),
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

function resolveWorkerPath(): string {
  const candidates = [
    path.join(__dirname, 'local-db-worker.cjs'),
    path.join(process.cwd(), 'src', 'services', 'local-db-worker.cjs'),
    path.join(__dirname, '..', '..', 'src', 'services', 'local-db-worker.cjs'),
  ];
  const src = candidates.find((c) => fs.existsSync(c));
  if (!src) {
    throw new Error('local-db-worker.cjs not found next to the main bundle');
  }
  // worker_threads cannot execute files inside app.asar
  if (src.includes('app.asar')) {
    const dest = path.join(path.dirname(resolveDbPath()), 'local-db-worker.cjs');
    fs.copyFileSync(src, dest);
    return dest;
  }
  return src;
}

function rpc<T>(op: string, extra: Record<string, unknown> = {}): Promise<T> {
  if (!worker) return Promise.reject(new Error('DB worker not started'));
  const id = ++rpcSeq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    worker!.postMessage({ id, op, ...extra });
  });
}

function attachWorker(w: Worker): void {
  w.on('message', (msg: { type?: string; id?: number; ok?: boolean; rows?: unknown; error?: string; vocabCount?: number; offlineCount?: number; bytes?: number; msg?: string; meta?: unknown; level?: string }) => {
    if (msg.type === 'ready') {
      ready = true;
      console.log('Local SQLite ready (worker)', {
        dbPath,
        bytes: msg.bytes,
        vocabCount: msg.vocabCount,
        offlineCount: msg.offlineCount,
      });
      return;
    }
    if (msg.type === 'fatal') {
      initError = msg.error || 'worker fatal';
      ready = false;
      console.error('Local SQLite worker fatal', initError);
      return;
    }
    if (msg.type === 'log') {
      if (msg.level === 'warn') console.warn(msg.msg, msg.meta);
      else console.log(msg.msg, msg.meta);
      return;
    }
    if (typeof msg.id !== 'number') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.ok) waiter.resolve(msg.rows);
    else waiter.reject(new Error(msg.error || 'db rpc failed'));
  });
  w.on('error', (err) => {
    console.error('Local SQLite worker error', err);
    initError = err.message;
  });
  w.on('exit', (code) => {
    if (code !== 0) {
      console.warn('Local SQLite worker exited', { code });
      ready = false;
      worker = null;
    }
  });
}

async function doInit(): Promise<void> {
  dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  let bytes = 0;
  try {
    if (fs.existsSync(dbPath)) bytes = fs.statSync(dbPath).size;
  } catch {
    /* ignore */
  }
  console.log('Opening local DB in worker', { dbPath, bytes });

  const w = new Worker(resolveWorkerPath(), {
    workerData: {
      dbPath,
      sqlAsmPath: resolveSqlAsmPath(),
    },
  });
  worker = w;
  attachWorker(w);

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sqlite worker open timed out')), 120000);
    const onMsg = (msg: { type?: string; error?: string }) => {
      if (msg.type === 'ready') {
        clearTimeout(t);
        w.off('message', onMsg);
        resolve();
      } else if (msg.type === 'fatal') {
        clearTimeout(t);
        w.off('message', onMsg);
        reject(new Error(msg.error || 'worker fatal'));
      }
    };
    w.on('message', onMsg);
  });

  void importPackagedSeeds().catch((e) => console.warn('seed import skipped', e));
}

export function isLocalDbReady(): boolean {
  return ready;
}

export function getLocalDbInitError(): string | null {
  return initError;
}

export function clearLocalDbInitError(): void {
  initError = null;
  initPromise = null;
}

/** Wait until the worker has the DB open. Does not block the main thread during sql.js parse. */
export async function getLocalDb(): Promise<void> {
  if (ready && worker) return;
  if (initPromise) return initPromise;

  if (initError) {
    console.warn('Retrying local DB after prior error', initError);
    initError = null;
  }

  initPromise = doInit()
    .then(() => {
      initError = null;
    })
    .catch((error) => {
      initError = error instanceof Error ? error.message : String(error);
      initPromise = null;
      ready = false;
      console.error('Local SQLite init failed', initError);
      throw error instanceof Error ? error : new Error(initError);
    });

  return initPromise;
}

function scheduleSave(): void {
  if (!ready) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persist().catch((error) => console.warn('persist failed', error));
  }, 400);
}

export async function flushPersist(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!ready || !worker) return;
  await persist();
}

/** Persist then kill the sql.js worker so Quit does not leave a Node thread. */
export async function closeLocalDb(): Promise<void> {
  try {
    await flushPersist();
  } catch {
    /* ignore */
  }
  const w = worker;
  worker = null;
  ready = false;
  initPromise = null;
  if (!w) return;
  try {
    await Promise.race([w.terminate(), new Promise<void>((resolve) => setTimeout(resolve, 400))]);
  } catch {
    /* ignore */
  }
}

export async function persist(): Promise<void> {
  if (!ready) return;
  await rpc('persist');
}

export async function runWrite(sql: string, params: unknown[] = []): Promise<void> {
  await getLocalDb();
  await rpc('run', { sql, params });
  scheduleSave();
}

/** One transaction of many parameterized statements (offline pack import). */
export async function runBatch(sql: string, paramsList: unknown[][]): Promise<number> {
  await getLocalDb();
  if (!paramsList.length) return 0;
  const result = await rpc<{ count?: number }>('runBatch', { sql, paramsList });
  scheduleSave();
  return Number(result?.count) || paramsList.length;
}

export async function queryAll<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await getLocalDb();
  const rows = await rpc<T[]>('query', { sql, params });
  return rows || [];
}

export async function queryOne<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await queryAll<T>(sql, params);
  return rows[0] || null;
}

export function markDirty(): void {
  scheduleSave();
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
