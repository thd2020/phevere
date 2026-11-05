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
// Periphrastic forms are phrases, not entries: "more redundant" is text, "redundanter" a link.
const degrees = inflectionsHtml(
  { formOf: [], tables: [{ pos: 'adjective', rows: [{ label: 'Comparative', forms: ['more redundant', 'redundanter'] }, { label: 'Superlative', forms: ['most redundant'] }], grids: [] }] },
  'redundant',
  'lookup',
);
assert.doesNotMatch(degrees, /data-lookup="more redundant"|data-lookup="most redundant"/, 'a multi-word form is not a link');
assert.match(degrees, /more redundant/, 'but it is still shown');
assert.match(degrees, /data-lookup="redundanter"/, 'a one-word form stays a link');
// "better is the comparative of good and well": two links, not one to "good and well".
const better = inflectionsHtml({ formOf: [{ label: 'comparative', lemma: 'good and well' }], tables: [] }, 'better', 'lookup');
assert.doesNotMatch(better, /data-lookup="good and well"/, 'two lemmas are not one link');
assert.match(better, /data-lookup="good"[^>]*>good<\/span> and <span[^>]*data-lookup="well"/, 'each lemma is its own link');
assert.match(inflectionsHtml({ formOf: [{ label: 'form', lemma: 'look up' }], tables: [] }, 'looked up', 'lookup'), /data-lookup="look up"/, 'a phrasal lemma stays one link');

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
assert.match(fam, /Built from<\/span> <span[^>]*role="link"[^>]*data-lookup="-y"/);
assert.match(fam, /Derived words <span class="lx-count">15<\/span>/);
assert.match(fam, /<summary>All 15<\/summary>/);
assert.equal((fam.match(/data-lookup="run\d+"/g) || []).length, 15);
assert.equal(wordFamilyHtml([], 'act'), '');

// Sense labels as Wiktionary prints them, on the gloss's line; sources once under the senses.
{
  const { senseLabelLead, definitionSourcesHtml } = load('lexicon-parts');
  assert.equal(
    senseLabelLead('(usually uncountable, politics) The capitalist class.'),
    '<span class="sense-label lx-nolink">(<i>usually uncountable</i>, <i>politics</i>)</span> The capitalist class.',
  );
  assert.equal(senseLabelLead('The (main) city.'), 'The (main) city.', 'only a leading bracket is a label');
  assert.equal(
    definitionSourcesHtml(['Free Dictionary', 'Wiktionary', 'Free Dictionary', 'Datamuse']),
    '<p class="lx-sources">Definitions from Free Dictionary, Wiktionary and Datamuse</p>',
  );
  assert.equal(definitionSourcesHtml(['Wiktionary']), '<p class="lx-sources">Definitions from Wiktionary</p>');
  assert.equal(definitionSourcesHtml([]), '');
}

// Word family from kaikki.org's parse of the page (the "redundant" and "dichotomy" entries of
// 2026-11-05, shortened): derived and related terms, without the words a Thesaurus page adds.
{
  const { familyFromKaikki } = load('word-family');
  const redundant = JSON.stringify({
    word: 'redundant', lang_code: 'en', pos: 'adj',
    derived: [{ word: 'redundantly' }, { word: 'nonredundant' }, { word: 'redundant array of independent disks' }],
    related: [{ word: 'redound', tags: ['verb'] }, { word: 'redundance' }, { word: 'redundancy' }, { word: 'turgid', source: 'Thesaurus:redundant' }],
  });
  const groups = Object.fromEntries(familyFromKaikki(redundant, 'redundant').map((g) => [g.relation, g.items.map((i) => i.word)]));
  assert.ok(groups.related.includes('redundancy'), 'redundancy is in the family of redundant');
  assert.ok(!groups.related.includes('turgid'), 'a Thesaurus synonym is not family');
  assert.deepEqual(groups.phrases, ['redundant array of independent disks'], 'a multi-word derived term is a phrase');
  const dichotomy = JSON.stringify({ word: 'dichotomy', lang_code: 'en', pos: 'noun', derived: [{ word: 'dichotomize' }, { word: 'dichotomous' }, { word: 'false dichotomy' }] });
  assert.ok(familyFromKaikki(dichotomy, 'dichotomy').find((g) => g.relation === 'derived').items.some((i) => i.word === 'dichotomize'));
  const other = JSON.stringify({ word: 'redundant', lang_code: 'fr', pos: 'adj', derived: [{ word: 'redondance' }] });
  assert.deepEqual(familyFromKaikki(other, 'redundant', 'en'), [], 'another language section is not read');
}

// One example from two sources shows once, tidied: Wiktionary and the Free Dictionary API gave
// "redundant" this sentence with and without a space before the full stop (2026-11-05).
{
  const { exampleKey, tidyExample, dedupeExamples } = load('definition-merge');
  const a = 'Four employees were made redundant.';
  const b = 'Four employees were made redundant .';
  assert.equal(exampleKey(a), exampleKey(b), 'a space before the full stop is not a different sentence');
  assert.equal(exampleKey('“It’s a word—really”'), exampleKey('"it\'s a word-really."'), 'quotes, dashes, case and closing stop');
  assert.deepEqual(dedupeExamples([b, a]), [a], 'kept once, as the clean copy');
  assert.equal(tidyExample('Ask him ( politely ) , then leave .'), 'Ask him ( politely), then leave.');
  assert.equal(tidyExample(a), a, 'a clean example is left alone');
}

// Word family by frequency: Datamuse's answer for "*redund*" of 2026-11-05, shortened. Common
// words lead; coinages Datamuse does not list wait under "All" when the list is long.
(async () => {
  const { familyStem, fetchFamilyFrequencies, rankFamilyByFrequency } = load('word-family');
  assert.equal(familyStem('redundant'), 'redund');
  assert.equal(familyStem('dichotomy'), 'dichot');
  assert.equal(familyStem('time'), 'time');
  const asked = [];
  const http = {
    requestJson: async (url) => {
      asked.push(url);
      return [
        { word: 'redundant', tags: ['f:3.407348'] },
        { word: 'redundancy', tags: ['f:2.668625'] },
        { word: 'redundantly', tags: ['f:0.069678'] },
        { word: 'redundance', tags: ['f:0.041261'] },
        { word: 'cyclic redundancy check', tags: ['f:0.000000'] },
      ];
    },
  };
  const freq = await fetchFamilyFrequencies(http, 'redundant');
  assert.match(asked[0], /sp=\*redund\*&md=f/, 'one wildcard query for the stem');
  assert.equal(freq.complete, true);
  const coinages = ['redundantant', 'irredundant', 'reredundant', 'georedundant', 'semiredundant', 'redundundant', 'hyperredundant',
    'superredundant', 'multiredundant', 'preredundant', 'postredundant', 'unredundant', 'antiredundant'];
  const ranked = rankFamilyByFrequency(
    [
      { relation: 'derived', items: [...coinages.slice(0, 1), 'redundantly', ...coinages.slice(1)].map((word) => ({ word })) },
      { relation: 'related', items: ['redound', 'redundance', 'redundancy'].map((word) => ({ word })) },
      { relation: 'alternatives', items: [{ word: 'redundent' }] },
    ],
    freq,
  );
  const byRel = Object.fromEntries(ranked.map((g) => [g.relation, g.items]));
  assert.deepEqual(byRel.related.map((i) => i.word), ['redundancy', 'redundance', 'redound'], 'commonest first; a word without the stem is not called rare');
  assert.equal(byRel.derived[0].word, 'redundantly', 'the real derivative before the coinages');
  assert.ok(byRel.derived.slice(1).every((i) => i.rare), 'words with the stem that Datamuse does not list are rare');
  assert.ok(!byRel.related.some((i) => i.rare));
  assert.deepEqual(byRel.alternatives, [{ word: 'redundent' }], 'other groups keep their order');
  const famHtml = wordFamilyHtml(ranked, 'lookup');
  const line = famHtml.split('<details')[0];
  assert.match(line, /data-lookup="redundantly"/);
  assert.doesNotMatch(line, /data-lookup="redundantant"/, 'a coinage waits under All in a long list');
  assert.match(famHtml, /<summary>All 14<\/summary>[\s\S]*data-lookup="redundantant"/, 'and is still listed there');
  assert.deepEqual(rankFamilyByFrequency(ranked, null), ranked, 'no frequencies, no change');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
