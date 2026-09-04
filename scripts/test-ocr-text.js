/**
 * Sanity checks for src/services/ocr-text.ts (no Electron).
 * Run: node scripts/test-ocr-text.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ocr-text.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require });
const { glueSpacedLetters, finalizeOcrLines } = mod.exports;

assert.strictEqual(glueSpacedLetters('c e n t r i f i c'), 'centrific');
assert.strictEqual(glueSpacedLetters('hello world'), 'hello world');
assert.strictEqual(glueSpacedLetters('I am'), 'I am');
assert.strictEqual(glueSpacedLetters('t h e  t e m p o r a r y'), 'the temporary');
assert.strictEqual(
  finalizeOcrLines([
    { text: 'hello', bounds: { x: 0, y: 0, width: 40, height: 12 } },
    { text: 'world', bounds: { x: 48, y: 0, width: 40, height: 12 } },
  ]).text,
  'hello world',
);
assert.strictEqual(
  finalizeOcrLines([
    { text: 'hello', bounds: { x: 0, y: 0, width: 40, height: 12 } },
    { text: 'world', bounds: { x: 48, y: 0, width: 40, height: 12 } },
  ]).lines.length,
  2,
);
assert.strictEqual(
  finalizeOcrLines([
    { text: 'c', bounds: { x: 0, y: 0, width: 8, height: 12 } },
    { text: 'e', bounds: { x: 9, y: 0, width: 8, height: 12 } },
    { text: 'n', bounds: { x: 18, y: 0, width: 8, height: 12 } },
  ]).text,
  'cen',
);
console.log('ocr-text ok');
