/**
 * Shared SQLite DDL — keep in sync with `src/services/local-db-worker.cjs` migrate().
 *
 * Word books (wordbook-store.ts) add two tables beside `vocab`: `wordbook_subs`, the books the
 * learner subscribed to with a daily goal each, and `book_words`, review progress for book words
 * that are not in My words, keyed by the lowercase headword. A word saved to My words keeps its
 * progress on its `vocab` row; nothing in `vocab` changes.
 */

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
  reps INTEGER DEFAULT 0,
  stability REAL,
  difficulty REAL,
  state INTEGER,
  lapses INTEGER DEFAULT 0,
  last_review INTEGER,
  learning_steps INTEGER DEFAULT 0,
  device TEXT
);
CREATE INDEX IF NOT EXISTS idx_vocab_lemma ON vocab(lemma);
CREATE INDEX IF NOT EXISTS idx_vocab_updated ON vocab(updated_at DESC);
CREATE TABLE IF NOT EXISTS vocab_deleted (
  id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS wordbook_subs (
  book_id TEXT PRIMARY KEY,
  daily_new INTEGER DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS book_words (
  lemma TEXT PRIMARY KEY,
  known INTEGER DEFAULT 0,
  review_due INTEGER,
  review_interval INTEGER DEFAULT 0,
  ease REAL DEFAULT 2.5,
  reps INTEGER DEFAULT 0,
  stability REAL,
  difficulty REAL,
  state INTEGER,
  lapses INTEGER DEFAULT 0,
  last_review INTEGER,
  learning_steps INTEGER DEFAULT 0,
  definition TEXT,
  reading TEXT,
  part_of_speech TEXT,
  created_at INTEGER,
  updated_at INTEGER NOT NULL
);
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

/**
 * Columns added after the first release (FSRS memory, the saving device). A notebook created before them gets each
 * missing one with ALTER TABLE ADD COLUMN, so no row is rewritten or lost. Older apps ignore them.
 */
export const VOCAB_ADDED_COLUMNS: ReadonlyArray<readonly [name: string, type: string]> = [
  ['stability', 'REAL'],
  ['difficulty', 'REAL'],
  ['state', 'INTEGER'],
  ['lapses', 'INTEGER DEFAULT 0'],
  ['last_review', 'INTEGER'],
  ['learning_steps', 'INTEGER DEFAULT 0'],
  /** Name of the device the word was first saved on. */
  ['device', 'TEXT'],
];

/** ALTER TABLE statements for the columns `existing` (from PRAGMA table_info) lacks. */
export function vocabColumnMigrations(existing: Iterable<string>): string[] {
  const have = new Set([...existing].map((c) => String(c).toLowerCase()));
  return VOCAB_ADDED_COLUMNS.filter(([name]) => !have.has(name)).map(([name, type]) => `ALTER TABLE vocab ADD COLUMN ${name} ${type}`);
}
