/* Run: node scripts/test-native-selection-repeat.js. Duplicate filtering must not swallow a new selection. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/services/native-selection.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

let now = 100000;
let addonCallback = null;
class FakeAddon {
  onSelection(cb) { addonCallback = cb; }
  start() { return true; }
  stop() {}
}
const stubs = {
  electron: { BrowserWindow: {}, clipboard: {}, screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) } },
  child_process: { execFile() {} },
  '../logger': { wrapConsole: () => ({ log() {}, warn() {}, error() {} }) },
  './text-normalize': {
    isLookupWorthy: (t) => !!String(t || '').trim(),
    sanitize: (t) => String(t || '').trim(),
    foldLookupKey: (t) => String(t || '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase(),
  },
  './context-capture': { selectionToContext: (text, x, y) => ({ text, x, y, timestamp: now }) },
  '../../native-addon': FakeAddon,
};
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod,
  exports: mod.exports,
  require: (name) => {
    if (!(name in stubs)) throw new Error(`Unexpected require ${name}`);
    return stubs[name];
  },
  process: { platform: 'win32' },
  Date: { now: () => now },
  console,
});

(async () => {
  const service = new mod.exports.WindowsNativeSelectionService();
  const emitted = [];
  service.onSelection((event) => emitted.push(event.text));
  await service.start();
  const select = (text, gapMs) => { now += gapMs; addonCallback({ text, x: 1, y: 1 }); };

  select('hello', 0);
  select('hello,', 400);
  assert.deepEqual(emitted, ['hello'], 'a punctuated variant of the same gesture is one selection');

  // Meanwhile hover, OCR or a manual lookup may have become the last word in main.
  select('Hello', 5000);
  assert.deepEqual(emitted, ['hello', 'Hello'],
    'a later selection of the same lemma is a new selection and must be emitted');

  select('Hello', 300);
  assert.deepEqual(emitted, ['hello', 'Hello'], 'an exact repeat within 800 ms is still dropped');

  console.log('Native selection repeat passed: same-gesture variant dropped, later same-lemma selection emitted, exact repeat dropped.');
})().catch((error) => { console.error(error); process.exit(1); });
