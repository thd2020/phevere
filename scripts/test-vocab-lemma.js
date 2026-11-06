/* Run: node scripts/test-vocab-lemma.js
 * Saved headwords go into dictionary form on save and, once, for rows saved before. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const initSqlJs = require('sql.js');

const coreDir = path.join(__dirname, '..', 'packages', 'core', 'src');
const cache = new Map();

function load(name) {
  const base = path.join(coreDir, name.replace(/^\.\//, ''));
  const file = fs.existsSync(base + '.ts') ? base + '.ts' : path.join(base, 'index.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (dep) => (dep.startsWith('.') ? load(path.relative(coreDir, path.resolve(path.dirname(file), dep))) : require(dep)));
  return mod.exports;
}

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const { VOCAB_SCHEMA_SQL } = load('schema');
  for (const stmt of VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) db.run(stmt);
  const rows = (sql, params = []) => {
    const st = db.prepare(sql);
    st.bind(params);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    st.free();
    return out;
  };
  const vocabDb = {
    ready: async () => {},
    initError: () => null,
    queryAll: async (sql, params) => rows(sql, params),
    queryOne: async (sql, params) => rows(sql, params)[0] || null,
    runWrite: async (sql, params = []) => db.run(sql, params),
  };
  let n = 0;
  load('runtime').configureCore({ http: {}, sha256Hex: () => '', vocabDb, newId: () => `id${++n}` });
  const store = load('vocab-store');
  const sync = load('vocab-sync');

  // Rows from before this change, written as the old code saved them.
  const old = (id, lemma, pos, def, t) =>
    db.run(
      `INSERT INTO vocab (id, lemma, part_of_speech, definition, source_lang, created_at, updated_at) VALUES (?, ?, ?, ?, 'en', ?, ?)`,
      [id, lemma, pos, def, t, t],
    );
  old('a', 'CODON', 'noun', 'a triplet of nucleotides', 1);
  old('b', 'Bunny', 'noun', 'a rabbit', 2);
  old('c', 'bunny', 'noun', '', 3);
  old('d', 'serendipity', 'noun', 'happy chance', 4);

  // The first list runs the one-time pass: CODON and Bunny change, Bunny and bunny merge.
  const list = await store.listVocab(50);
  const lemmas = list.map((e) => e.lemma).sort();
  assert.deepEqual(lemmas, ['bunny', 'codon', 'serendipity']);
  const bunny = list.find((e) => e.lemma === 'bunny');
  assert.equal(bunny.definition, 'a rabbit', 'the merged row keeps the saved definition');
  assert.ok(list.find((e) => e.lemma === 'codon').updatedAt > 1, 'a changed row syncs to other devices');
  assert.equal(list.find((e) => e.lemma === 'serendipity').updatedAt, 4, 'an unchanged row is left alone');
  assert.equal(await sync.normalizeStoredLemmas(), 0, 'the pass runs once');

  // New saves are normalized, and a save of an existing word in another case updates it.
  const saved = await store.addVocab({ lemma: '“Mitochondria,”', partOfSpeech: 'noun', sourceLang: 'en', definition: 'organelles' });
  assert.equal(saved.lemma, 'mitochondria');
  const again = await store.addVocab({ lemma: 'CODON', partOfSpeech: 'noun', sourceLang: 'en' });
  assert.equal(again.id, 'a');
  assert.equal(again.lemma, 'codon');
  assert.equal((await store.listVocab(50)).length, 4);

  console.log('vocab-lemma ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
