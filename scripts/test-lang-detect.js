/* Run: node scripts/test-lang-detect.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'packages/core/src/lang-detect.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { detectLanguageLocal, englishCandidateWords, isAmbiguousHan, isPlainLatinWord, remoteFitsScript } = mod.exports;

const sure = (text, lang) => {
  const g = detectLanguageLocal(text);
  assert.deepEqual(g, { lang, confident: true }, `${text} → ${JSON.stringify(g)}`);
};
const guess = (text, lang) => {
  const g = detectLanguageLocal(text);
  assert.equal(g.lang, lang, `${text} → ${JSON.stringify(g)}`);
  assert.equal(g.confident, false, `${text} should be unsettled`);
};

// Han only: Japanese shinjitai and kokuji settle it; simplified-only forms settle Chinese.
sure('要対応', 'ja');
sure('駅', 'ja');
sure('働く', 'ja');
sure('人々', 'ja');
sure('経験', 'ja');
sure('这个', 'zh');
sure('对应', 'zh');
sure('我们', 'zh');
sure('经验', 'zh');
guess('学生', 'zh');
guess('勉強', 'zh');

// Kana and Hangul.
sure('食べる', 'ja');
sure('コーヒー', 'ja');
sure('사랑', 'ko');

// Other scripts.
sure('собака', 'ru');
sure('їжак', 'uk');
sure('љубав', 'sr');
sure('كتاب', 'ar');
sure('کتاب', 'fa');
sure('שלום', 'he');
sure('नमस्ते', 'hi');
sure('καλημέρα', 'el');
sure('สวัสดี', 'th');

// Latin letters that belong to few languages.
sure('Straße', 'de');
sure('mañana', 'es');
sure('não', 'pt');
sure('œuvre', 'fr');
sure('łódź', 'pl');
sure('Tiếng Việt', 'vi');
sure('győr', 'hu');
sure('řeka', 'cs');
sure('teşekkür', 'tr');
sure('the cat is on the mat', 'en');
sure('der Hund und die Katze', 'de');

// Plain ASCII words cannot be told apart locally.
guess('serendipity', 'en');
guess('Haus', 'en');
assert.equal(isPlainLatinWord('Haus'), true);
assert.equal(isPlainLatinWord('two words'), false);
assert.equal(isPlainLatinWord('Straße'), false);

// Short Latin text the English word list can settle, accents folded; strong letters cannot.
assert.deepEqual(englishCandidateWords('café'), ['cafe']);
assert.deepEqual(englishCandidateWords('naïve'), ['naive']);
assert.deepEqual(englishCandidateWords('machine learning'), ['machine', 'learning']);
assert.deepEqual(englishCandidateWords("I like it"), ['i', 'like', 'it']);
assert.equal(englishCandidateWords('Straße'), null);
assert.equal(englishCandidateWords('mañana'), null);
assert.equal(englishCandidateWords('собака'), null);
assert.equal(englishCandidateWords('one two three four five six seven'), null);

// Han text with nothing telling is settled locally as Chinese.
assert.equal(isAmbiguousHan('学生'), true);
assert.equal(isAmbiguousHan('中国'), true);
assert.equal(isAmbiguousHan('要対応'), false);
assert.equal(isAmbiguousHan('我们'), false);
assert.equal(isAmbiguousHan('食べる'), false);

// A remote answer must fit the script.
assert.equal(remoteFitsScript('Haus', 'de'), true);
assert.equal(remoteFitsScript('Haus', 'zh-CN'), false);
assert.equal(remoteFitsScript('学生', 'ja'), true);
assert.equal(remoteFitsScript('学生', 'fr'), false);
assert.equal(remoteFitsScript('собака', 'ru'), true);
assert.equal(remoteFitsScript('собака', 'en'), false);

console.log('lang-detect: ok');
