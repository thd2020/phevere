/**
 * Plain plurals (packages/core/src/dictionary.ts simplePluralTarget): a word whose Wiktionary
 * senses only say "plural of X" is shown and saved as X; a plural with senses of its own stays.
 * Also checks that Wiktionary's own senses for a form survive stripCrossLemmaSenses, and that
 * saved plain plurals fold into their singular once (vocab-sync.ts foldStoredPlurals).
 *
 * Run: node scripts/test-plural-forms.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const CORE = path.join(__dirname, '..', 'packages', 'core', 'src');
require.extensions['.ts'] = function compileTs(module, filename) {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};
const { simplePluralTarget } = require(path.join(CORE, 'dictionary.ts'));
const { stripCrossLemmaSenses } = require(path.join(CORE, 'definition-merge.ts'));

const W = 'Wiktionary';
const result = (defs) => ({ word: 'x', definitions: defs.map(([pos, meaning, source = W]) => ({ partOfSpeech: pos, meaning, source })) });

// "acronyms": a plural and an -s verb form of one word; Datamuse and the Free Dictionary add the
// base word's own senses, which do not count.
assert.strictEqual(
  simplePluralTarget(result([
    ['noun', '<span class="form-of-definition">plural of <a href="/wiki/acronym">acronym</a></span>'],
    ['verb', 'third-person singular simple present indicative of acronym'],
    ['verb', 'To form into an acronym.', 'Datamuse · Free Dictionary API'],
  ])),
  'acronym',
);
// Only an -s verb form is not a plural.
assert.strictEqual(simplePluralTarget(result([['verb', 'third-person singular simple present indicative of run']])), null);
// "bacteria" and "glasses" have senses of their own.
assert.strictEqual(simplePluralTarget(result([['noun', 'plural of bacterium'], ['noun', 'A type, species, or strain of bacterium.']])), null);
assert.strictEqual(simplePluralTarget(result([['noun', 'plural of glass'], ['noun', 'Spectacles, frames bearing two lenses.']])), null);
// No Wiktionary sense: nothing to decide on.
assert.strictEqual(simplePluralTarget(result([['noun', 'plural of cat', 'Datamuse']])), null);
// Two different singulars ("axes": axe and axis) is not one plain plural.
assert.strictEqual(simplePluralTarget(result([['noun', 'plural of axe'], ['noun', 'plural of axis']])), null);

const kept = stripCrossLemmaSenses('glasses', [
  { partOfSpeech: 'noun', meaning: 'plural of glass', source: W },
  { partOfSpeech: 'noun', meaning: 'Spectacles, frames bearing two lenses.', source: 'Datamuse · Wiktionary' },
  { partOfSpeech: 'noun', meaning: 'An amorphous solid made by melting sand.', source: 'Free Dictionary API' },
]).map((d) => d.meaning);
assert.ok(kept.includes('Spectacles, frames bearing two lenses.'), "Wiktionary's own sense for the form stays");
assert.ok(!kept.some((m) => /amorphous/.test(m)), "the base word's sense from another source goes");

// Saved plain plurals, on a notebook of their own.
(async () => {
  const esbuild = require('esbuild');
  const initSqlJs = require('sql.js');
  const bundle = esbuild.buildSync({
    stdin: {
      contents: `
        export { configureCore } from './src/runtime';
        export { addVocab, listVocab, reviewVocab, findByLemma } from './src/vocab-store';
        export { foldStoredPlurals } from './src/vocab-sync';
        export { VOCAB_SCHEMA_SQL } from './src/schema';
      `,
      resolveDir: path.join(__dirname, '..', 'packages', 'core'),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    loader: { '.json': 'json' },
  }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
  const core = mod.exports;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const stmt of core.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) db.run(stmt);
  const queryAll = async (sql, params = []) => {
    const st = db.prepare(sql);
    try {
      st.bind(params);
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally {
      st.free();
    }
  };
  let n = 0;
  core.configureCore({
    http: {},
    sha256Hex: () => '',
    vocabDb: { ready: async () => {}, initError: () => null, queryAll, queryOne: async (q, p) => (await queryAll(q, p))[0] || null, runWrite: async (q, p = []) => db.run(q, p) },
    deviceName: () => 'test',
    newId: () => `id-${String(++n).padStart(3, '0')}`,
  });
  await core.addVocab({ lemma: 'scrap', definition: 'a small piece' });
  const scraps = await core.addVocab({ lemma: 'scraps', definition: 'plural of scrap', reading: '/skɹæps/' });
  await core.reviewVocab(scraps.id, 3);
  await core.addVocab({ lemma: 'symmetries', definition: 'plural of symmetry' });
  await core.addVocab({ lemma: 'alumni', definition: 'plural of alum' });
  await core.addVocab({ lemma: 'bacteria', definition: 'plural of bacterium\nA type, species, or strain of bacterium.' });
  assert.strictEqual(await core.foldStoredPlurals(), 2, 'scraps and symmetries');
  const scrap = await core.findByLemma('scrap');
  assert.strictEqual(scrap.definition, 'a small piece', "the singular's meaning wins");
  assert.ok(scrap.reps >= 1, "the plural's progress comes along");
  assert.strictEqual(await core.findByLemma('scraps'), null);
  assert.ok((await queryAll('SELECT id FROM vocab_deleted')).length === 1, 'the folded row leaves a tombstone for sync');
  const sym = await core.findByLemma('symmetry');
  assert.ok(sym && !sym.definition, "a new singular waits for its own meaning");
  assert.ok(await core.findByLemma('alumni'), 'an irregular plural is not trusted to its saved gloss');
  assert.ok(await core.findByLemma('bacteria'), 'a plural with senses of its own stays');
  assert.strictEqual(await core.foldStoredPlurals(), 0, 'once per notebook');
  console.log('Plural forms passed: plain plurals redirect, plurals with their own senses stay, saved plurals fold once.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
