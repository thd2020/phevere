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
  old('a', 'CODON', 'noun', 'A triplet of nucleotides.', 1);
  old('b', 'Bunny', 'noun', 'A rabbit.', 2);
  old('c', 'bunny', 'noun', '', 3);
  old('d', 'serendipity', 'noun', 'Happy chance.', 4);
  // Saved by older code: a space before punctuation, Wiktionary stylesheet text, the law sense twice.
  old('e', 'moratorium', 'noun', [
    '(law) An authorization to a debtor, permitting temporary suspension of payments.',
    'A suspension of an ongoing activity .',
    'An authorization to a debtor , permitting temporary suspension of payments. .mw-parser-output .defdate{font-size:smaller}',
    '延期偿付',
  ].join('\n'), 5);

  // The first list runs the one-time pass: CODON and Bunny change, Bunny and bunny merge.
  const list = await store.listVocab(50);
  const lemmas = list.map((e) => e.lemma).sort();
  assert.deepEqual(lemmas, ['bunny', 'codon', 'moratorium', 'serendipity']);
  assert.equal(
    list.find((e) => e.lemma === 'moratorium').definition,
    ['(law) An authorization to a debtor, permitting temporary suspension of payments.', 'A suspension of an ongoing activity.', '延期偿付'].join('\n'),
    'saved definitions are tidied once: spacing, stylesheet text, the repeated sense',
  );
  const bunny = list.find((e) => e.lemma === 'bunny');
  assert.equal(bunny.definition, 'A rabbit.', 'the merged row keeps the saved definition');
  assert.ok(list.find((e) => e.lemma === 'codon').updatedAt > 1, 'a changed row syncs to other devices');
  assert.equal(list.find((e) => e.lemma === 'serendipity').updatedAt, 4, 'an unchanged row is left alone');
  assert.equal(await sync.normalizeStoredLemmas(), 0, 'the pass runs once');
  // The same tidy applies to a row synced from a device on an older app; one sense in two wordings is one line.
  assert.equal(
    sync.tidyDefinition(['Calculation ; computation .', '(of a book or document) Not abridged, shortened, expurgated or condensed; complete.', 'Of a book or document, not abridged, shortened, expurgated or condensed; complete.'].join('\n')),
    ['Calculation; computation.', '(of a book or document) Not abridged, shortened, expurgated or condensed; complete.'].join('\n'),
  );

  // New saves are normalized, and a save of an existing word in another case updates it.
  const saved = await store.addVocab({ lemma: '“Mitochondria,”', partOfSpeech: 'noun', sourceLang: 'en', definition: 'organelles' });
  assert.equal(saved.lemma, 'mitochondria');
  const again = await store.addVocab({ lemma: 'CODON', partOfSpeech: 'noun', sourceLang: 'en' });
  assert.equal(again.id, 'a');
  assert.equal(again.lemma, 'codon');
  assert.equal((await store.listVocab(50)).length, 5);

  // A finished lookup replaces a saved definition, unless the row has senses from a dictionary the
  // lookup did not have (Webster 1913 installed only on the PC that saved the word).
  const webster = "Webster's Unabridged 1913 (GCIDE)";
  await store.addVocab({ lemma: 'decrepit', sourceLang: 'en', definition: 'Weakened.\nBroken down with age.', sources: ['Wiktionary', webster] });
  const here = { sourceLang: 'en', definition: 'Weakened.\n老态龙钟的', sources: ['Free Dictionary API', 'Wiktionary', 'Chinese Wiktionary'] };
  assert.equal(await store.refreshFromLookup(['decrepit'], here), null, 'a lookup without Webster leaves its senses');
  assert.match((await store.findByLemma('decrepit', 'en')).definition, /Broken down with age/);
  const withPack = await store.refreshFromLookup(['decrepit'], { ...here, definition: 'Weakened.\nFeeble.', sources: ['Wiktionary', webster] });
  assert.equal(withPack.definition, 'Weakened.\nFeeble.', 'a lookup that has Webster replaces the row');
  await store.addVocab({ lemma: 'rout', sourceLang: 'en', definition: 'A defeat.', sources: ['Wiktionary', 'Datamuse'] });
  assert.equal((await store.refreshFromLookup(['rout'], { sourceLang: 'en', definition: 'A disorderly retreat.', sources: ['Wiktionary'] })).definition, 'A disorderly retreat.', 'online sources do not hold a row back');

  console.log('vocab-lemma ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
