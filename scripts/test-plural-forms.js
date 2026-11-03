/**
 * Plain plurals (packages/core/src/dictionary.ts simplePluralTarget): a word whose Wiktionary
 * senses only say "plural of X" is shown and saved as X; a plural with senses of its own stays.
 * Also checks that Wiktionary's own senses for a form survive stripCrossLemmaSenses.
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

console.log('Plural forms passed: plain plurals redirect, plurals with their own senses stay.');
