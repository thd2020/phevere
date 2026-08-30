/** Shared SQLite DDL — keep in sync with `src/services/local-db-worker.cjs` migrate(). */

export const VOCAB_SCHEMA_SQL = `
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
CREATE INDEX IF NOT EXISTS idx_vocab_lemma ON vocab(lemma);
CREATE INDEX IF NOT EXISTS idx_vocab_updated ON vocab(updated_at DESC);
CREATE TABLE IF NOT EXISTS offline_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  headword TEXT NOT NULL COLLATE NOCASE,
  language TEXT NOT NULL DEFAULT 'en',
  pos TEXT,
  definition TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  extra TEXT
);
CREATE INDEX IF NOT EXISTS idx_offline_head ON offline_entries(headword);
CREATE INDEX IF NOT EXISTS idx_offline_head_lang ON offline_entries(headword, language);
CREATE INDEX IF NOT EXISTS idx_offline_pack ON offline_entries(pack_id);
CREATE TABLE IF NOT EXISTS offline_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  source TEXT,
  entry_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;
