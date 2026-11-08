/* Run: node scripts/test-definition-merge.js
 * Two dictionaries' wording of one sense folds into one sense with both citations; senses that
 * differ in a content word, or where one narrows the other, stay apart. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

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

const { mergeSimilarDefinitions: merge } = load('definition-merge');
const sense = (meaning, source, partOfSpeech = 'adjective') => ({ partOfSpeech, meaning, source });
const label = (text) => `<span class="usage-label-sense">(<a>${text}</a>)</span> `;

// "unabridged": a qualifier in brackets in one source and written into the sense in the other.
const unabridged = merge([
  sense(`${label('of a book or document')}Not abridged, shortened, expurgated or condensed; complete.`, 'Free Dictionary'),
  sense(`${label('literature, publishing')}Of a book or document, not abridged, shortened, expurgated or condensed; complete.`, 'Wiktionary'),
  sense('Not abridged, or shortened; full; complete; entire; whole.', "Webster's Unabridged 1913 (GCIDE)"),
]);
assert.equal(unabridged.length, 2, 'the bracketed qualifier and the written-out one are one sense');
assert.deepEqual(unabridged[0].sources, ['Free Dictionary', 'Wiktionary']);
// Plural and singular, and a domain label one source adds.
assert.equal(merge([sense('A disorderly retreat of defeated troops.', 'WordNet', 'noun'), sense('(military) Disorderly retreats of defeated troop.', 'Wiktionary', 'noun')]).length, 1);
// British and American spelling, in a short sense too.
assert.equal(merge([sense('The colour of the sky.', 'A', 'noun'), sense('The color of the sky.', 'B', 'noun')]).length, 1);
assert.equal(merge([sense('To organise a meeting of members.', 'A', 'verb'), sense('To organize a meeting of the members.', 'B', 'verb')]).length, 1);

// Apart: one content word differs.
assert.equal(merge([
  sense('An instrument used for measuring the temperature of the air.', 'A', 'noun'),
  sense('An instrument used for measuring the pressure of the air.', 'B', 'noun'),
]).length, 2);
// Apart: one sense narrows the other a lot.
assert.equal(merge([
  sense('A person who teaches music.', 'A', 'noun'),
  sense('A person who teaches music to children in schools.', 'B', 'noun'),
]).length, 2);
// Apart: transitive and intransitive senses.
assert.equal(merge([
  sense('To cause someone to become very angry.', 'A', 'verb'),
  sense('To become very angry.', 'B', 'verb'),
]).length, 2);
// Apart: a negation is a content word.
assert.equal(merge([sense('Abridged, shortened or condensed; incomplete.', 'A'), sense('Not abridged, shortened or condensed; incomplete.', 'B')]).length, 2);
// Apart: same words, different part of speech.
assert.equal(merge([sense('A complete and unabridged edition of a book.', 'A', 'noun'), sense('A complete and unabridged edition of a book.', 'B', 'verb')]).length, 2);

console.log('Definition merge passed: bracketed qualifiers, plurals, domain labels; apart on a different word, a narrower sense, transitivity, negation, part of speech.');
