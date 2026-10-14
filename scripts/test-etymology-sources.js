/* Run: node scripts/test-etymology-sources.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../packages/core/src/etymology-sources.ts'), 'utf8');
const moduleFixture = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: moduleFixture, exports: moduleFixture.exports });
const { groupYoudaoEtymologies, serializeEtymologySources } = moduleFixture.exports;
const prefix = 'An identical introduction that exceeds forty-eight characters. ';
const first = `${prefix}First explanation.`;
const second = `${prefix}A different explanation.`;
const groups = groupYoudaoEtymologies({
  zh: [
    { source: '童理民', desc: '词源学', value: first },
    { source: '童理民', desc: '词源学', value: second },
    { source: '童理民', desc: '词源，词源学', value: 'Third independent explanation.' },
    { source: '童理民', value: first.replaceAll(' ', '  ') },
    { source: '另一作者', value: first },
    { source: '有道', value: 'Youdao supplied explanation.' },
    { value: 'Another unattributed explanation.' },
    { source: '童理民', value: 'tiny' },
    null,
  ],
  en: [
    { source: 'wiktionary', value: 'From Middle English and Old French.' },
    { source: 'Wiktionary', value: 'From Middle English and Old French.' },
    { source: '童理民', value: 'An English contribution by the same author.' },
  ],
  fr: [{ source: 'Auteur', value: 'Une explication française.' }],
  invalid: { value: 'Not an entry array.' },
});
assert.equal(groups.length, 6);
assert.equal(groups[0].label, '童理民 · 中文');
assert.equal(groups[0].body, `${first}\n\n${second}\n\nThird independent explanation.`);
assert.equal(groups[1].label, '另一作者 · 中文');
assert.equal(groups[1].body, first, 'attribution must survive identical text from different authors');
assert.equal(groups[2].label, 'Youdao · 中文');
assert.equal(groups[2].body, 'Youdao supplied explanation.\n\nAnother unattributed explanation.');
assert.equal(groups[3].label, 'Wiktionary · English');
assert.equal(groups[3].body, 'From Middle English and Old French.');
assert.equal(groups[4].label, '童理民 · English');
assert.equal(groups[5].label, 'Auteur · fr');
const serialized = serializeEtymologySources(groups);
assert.equal(serialized.split('\n\n--- Alternative etymology ---\n\n').length, 6);
assert.ok(!serialized.includes('词源学'), 'headword gloss must not become source identity');
assert.ok(!serialized.includes('中文 2'));
for (const input of [undefined, null, [], {}, 'invalid']) {
  assert.equal(groupYoudaoEtymologies(input).length, 0);
  assert.equal(serializeEtymologySources(groupYoudaoEtymologies(input)), undefined);
}
console.log('Etymology source grouping passed: authors, languages, full-text deduplication and serialization.');
