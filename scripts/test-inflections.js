/* Run: node scripts/test-inflections.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const coreDir = path.join(__dirname, '..', 'packages', 'core', 'src');
const cache = new Map();

/** Load a core TS module and the core modules it imports, transpiled to CommonJS. */
function load(name) {
  const file = path.join(coreDir, name.replace(/^\.\//, '') + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (dep) => (dep.startsWith('.') ? load(dep) : require(dep)));
  return mod.exports;
}

const { inflectionsFromKaikki, selectInflections } = load('inflections');
const { inflectionsHtml, wordFamilyHtml } = load('lexicon-parts');
const { normalizeVocabLemma, closestSpelling, typoDistance } = load('vocab-lemma');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'inflections', `${name}.jsonl`), 'utf8');
const rows = (table) => Object.fromEntries(table.rows.map((r) => [r.label, r.forms]));
const pick = (name, lang, word, pos) => selectInflections(inflectionsFromKaikki(fixture(name), lang, word), pos);

// English verb and noun.
const run = pick('en-run', 'en', 'run', ['verb', 'noun']);
assert.deepEqual(run.tables.map((t) => t.pos), ['verb', 'noun']);
assert.deepEqual(rows(run.tables[0]), {
  'Third-person singular': ['runs'],
  'Present participle': ['running'],
  Past: ['ran'],
  'Past participle': ['run'],
});
assert.deepEqual(rows(run.tables[1]), { Plural: ['runs'] }, 'no possessive row: learner dictionaries do not list one');
assert.deepEqual(run.formOf, [], 'run is a lemma, not the dialect past participle of rin');

// A plural points at its lemma, and the lemma's table stands in; the rare verb "mice" is dropped.
const mice = inflectionsFromKaikki(fixture('en-mice'), 'en', 'mice');
mice.lemmaTables = inflectionsFromKaikki(fixture('en-mouse'), 'en', 'mouse').tables;
const miceSel = selectInflections(mice, ['noun', 'verb']);
assert.deepEqual(miceSel.formOf.map((f) => [f.lemma, f.label]), [['mouse', 'plural']]);
assert.equal(miceSel.tablesFor, 'mouse');
assert.deepEqual(miceSel.tables.map((t) => [t.pos, t.lemma]), [['noun', 'mouse']]);
assert.deepEqual(rows(miceSel.tables[0]).Plural, ['mice', 'mouses']);

// Degrees for adjectives; parts of speech the lookup does not show are left out.
const happy = pick('en-happy', 'en', 'happy', ['adjective']);
assert.deepEqual(happy.tables.map((t) => t.pos), ['adjective']);
assert.deepEqual(rows(happy.tables[0]).Comparative, ['happier', 'more happy']);

// A participle names its verb.
const running = pick('en-running', 'en', 'running', ['verb', 'noun', 'adjective']);
assert.deepEqual(running.formOf.map((f) => [f.lemma, f.label]), [['run', 'present participle']]);

// Cases for German and Russian nouns; persons for French verbs.
const haus = pick('de-haus', 'de', 'Haus', ['noun']);
const grid = haus.tables[0].grids[0];
assert.equal(grid.caption, 'Cases');
assert.deepEqual(grid.rows.find((r) => r.label === 'Genitive').cells, [['Hauses'], ['Häuser']]);
assert.deepEqual(grid.rows.find((r) => r.label === 'Dative').cells[1], ['Häusern']);
const sobaka = pick('ru-sobaka', 'ru', 'собака', ['noun']);
assert.equal(sobaka.tables[0].grids[0].rows.length, 6);
const manger = pick('fr-manger', 'fr', 'manger', ['verb']);
assert.deepEqual(manger.tables[0].grids[0].rows.map((r) => r.label), ['1st', '2nd', '3rd']);
assert.deepEqual(manger.tables[0].grids[0].rows[0].cells, [['mange'], ['mangeons']]);
assert.deepEqual(rows(manger.tables[0])['Past participle'], ['mangé']);


// Rendering: the form-of sentence, the lemma link, and Russian stress set as a bold vowel.
const formsHtml = inflectionsHtml(miceSel, 'mice', 'act');
assert.match(formsHtml, /<i>mice<\/i> is the plural of <button[^>]*data-q="mouse"/);
assert.match(inflectionsHtml(sobaka, 'собака', 'lookup'), /соб<b class="lx-stress">а<\/b>ка/);
assert.equal(inflectionsHtml(undefined, 'x', 'act'), '');

// Word family: closest members in a line, the rest folded, affixes and roots as "Built from".
const many = Array.from({ length: 15 }, (_, i) => ({ word: `run${i}` }));
const fam = wordFamilyHtml(
  [
    { relation: 'derived', items: many },
    { relation: 'affixes', items: [{ word: '-y' }] },
    { relation: 'roots', items: [{ word: '*h₃er-' }] },
  ],
  'lookup',
);
assert.match(fam, /Built from<\/span> <a[^>]*data-lookup="-y"/);
assert.match(fam, /Derived words <span class="lx-count">15<\/span>/);
assert.match(fam, /<summary>All 15<\/summary>/);
assert.equal((fam.match(/data-lookup="run\d+"/g) || []).length, 15);
assert.equal(wordFamilyHtml([], 'act'), '');

// Saved headwords in dictionary form.
assert.equal(normalizeVocabLemma('CODON', { pos: 'noun', lang: 'en' }), 'codon');
assert.equal(normalizeVocabLemma('Bunny,', { pos: 'noun', lang: 'en' }), 'bunny');
assert.equal(normalizeVocabLemma(' “Serendipity” ', {}), 'serendipity');
assert.equal(normalizeVocabLemma('haus', { pos: 'noun', lang: 'de' }), 'Haus');
assert.equal(normalizeVocabLemma('NASA', { pos: 'initialism', lang: 'en' }), 'NASA');
assert.equal(normalizeVocabLemma('london', { pos: 'proper noun', lang: 'en' }), 'London');
assert.equal(normalizeVocabLemma('I', { pos: 'pronoun' }), 'I');
assert.equal(normalizeVocabLemma('要対応', { lang: 'ja' }), '要対応');
assert.equal(normalizeVocabLemma('Собака', { pos: 'noun', lang: 'ru' }), 'собака');

// Typos one or two letters off.
assert.equal(typoDistance('recieve', 'receive'), 1);
assert.equal(closestSpelling('recieve', ['receive', 'relieve']), 'receive');
assert.equal(closestSpelling('acomodate', ['accommodate']), 'accommodate');
assert.equal(closestSpelling('cat', ['cart']), null, 'too short to correct');
assert.equal(closestSpelling('serendipity', ['serendipitous']), null, 'more than two edits');

console.log('inflections ok');
