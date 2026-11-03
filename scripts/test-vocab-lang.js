/**
 * Sanity checks for packages/core/src/vocab-lang.ts
 * Run: node scripts/test-vocab-lang.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'src', 'vocab-lang.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require });
const { formatVocabLangPair, inferVocabGlossLang } = mod.exports;

assert.strictEqual(
  formatVocabLangPair({
    sourceLang: 'en',
    targetLang: 'zh',
    definition: 'A spinning toy.',
    sources: ['Free Dictionary', 'Wiktionary'],
  }),
  'en → en',
);
assert.strictEqual(
  inferVocabGlossLang({
    sourceLang: 'zh',
    targetLang: 'en',
    definition: 'centrifuge',
    sources: ['CC-CEDICT'],
  }),
  'en',
);
assert.strictEqual(
  formatVocabLangPair({
    sourceLang: 'en',
    targetLang: 'zh',
    definition: '离心机',
    sources: ['Google'],
  }),
  'en → zh',
);
// Glosses from the Japanese and Russian Wiktionaries are tagged by their script.
assert.strictEqual(inferVocabGlossLang({ sourceLang: 'ja', targetLang: 'en', definition: '大学などで教育を受ける者。', sources: ['Japanese Wiktionary'] }), 'ja');
assert.strictEqual(inferVocabGlossLang({ sourceLang: 'ru', targetLang: 'en', definition: 'жилое здание', sources: ['Russian Wiktionary'] }), 'ru');
assert.strictEqual(inferVocabGlossLang({ sourceLang: 'zh', targetLang: 'en', definition: '在學校讀書的人', sources: ['Chinese Wiktionary'] }), 'zh');
console.log('vocab-lang ok');
