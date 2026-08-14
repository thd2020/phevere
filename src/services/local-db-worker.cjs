/**
 * sql.js lives here — never on Electron's main thread.
 * A 40MB+ CC-CEDICT file freezes IPC (popup resize, dictionary-lookup) if opened on main.
 */
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

if (!parentPort) {
  throw new Error('local-db-worker must run as a worker_thread');
}

/** @type {any} */
let db = null;
let dbPath = '';

function loadSqlInit() {
  const asmFile = workerData && workerData.sqlAsmPath;
  if (asmFile && fs.existsSync(asmFile)) {
    return require(asmFile);
  }
  try {
    return require('sql.js/dist/sql-asm.js');
  } catch {
    return require('sql.js');
  }
}

function migrate(database) {
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
  database.run(`CREATE INDEX IF NOT EXISTS idx_offline_head_lang ON offline_entries(headword, language);`);
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

function openBytes(SQL, filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    if (st.size < 16) return null;
    const buf = fs.readFileSync(filePath);
    if (!buf.length) return null;
    return new SQL.Database(new Uint8Array(buf));
  } catch (error) {
    parentPort.postMessage({ type: 'log', level: 'warn', msg: 'failed to open sqlite', meta: { filePath, err: String(error) } });
    return null;
  }
}

function persist() {
  if (!db || !dbPath) return;
  const data = db.export();
  if (!data || data.length < 16) return;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.tmp`;
  const bak = `${dbPath}.bak`;
  fs.writeFileSync(tmp, Buffer.from(data));
  try {
    if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 16) {
      try {
        fs.copyFileSync(dbPath, bak);
      } catch {
        /* ignore */
      }
    }
    fs.renameSync(tmp, dbPath);
  } catch {
    fs.copyFileSync(tmp, dbPath);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function queryAll(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params || []);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function boot() {
  dbPath = workerData.dbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const init = loadSqlInit();
  const SQL = await init();
  db =
    openBytes(SQL, dbPath) ||
    openBytes(SQL, `${dbPath}.bak`) ||
    openBytes(SQL, `${dbPath}.tmp`) ||
    new SQL.Database();
  migrate(db);
  let vocabCount = 0;
  let offlineCount = 0;
  try {
    vocabCount = Number(db.exec('SELECT COUNT(*) AS n FROM vocab')?.[0]?.values?.[0]?.[0] || 0);
    offlineCount = Number(db.exec('SELECT COUNT(*) AS n FROM offline_entries')?.[0]?.values?.[0]?.[0] || 0);
  } catch {
    /* ignore */
  }
  parentPort.postMessage({ type: 'ready', vocabCount, offlineCount, bytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0 });
}

parentPort.on('message', (msg) => {
  const id = msg && msg.id;
  try {
    if (!db) throw new Error('DB not ready');
    switch (msg.op) {
      case 'query':
        parentPort.postMessage({ id, ok: true, rows: queryAll(msg.sql, msg.params) });
        break;
      case 'run':
        db.run(msg.sql, msg.params || []);
        parentPort.postMessage({ id, ok: true });
        break;
      case 'runBatch': {
        const sql = msg.sql;
        const paramsList = Array.isArray(msg.paramsList) ? msg.paramsList : [];
        db.exec('BEGIN');
        try {
          for (let i = 0; i < paramsList.length; i++) {
            db.run(sql, paramsList[i] || []);
          }
          db.exec('COMMIT');
        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw error;
        }
        parentPort.postMessage({ id, ok: true, rows: { count: paramsList.length } });
        break;
      }
      case 'persist':
        persist();
        parentPort.postMessage({ id, ok: true });
        break;
      case 'exec': {
        const result = db.exec(msg.sql);
        parentPort.postMessage({ id, ok: true, result });
        break;
      }
      default:
        throw new Error(`unknown op ${msg.op}`);
    }
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

boot().catch((error) => {
  parentPort.postMessage({ type: 'fatal', error: error instanceof Error ? error.message : String(error) });
});
