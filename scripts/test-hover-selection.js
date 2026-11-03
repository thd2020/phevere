/* Run: node scripts/test-hover-selection.js. A text selection outranks hover lookup. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/services/hover-lookup.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

const emitted = [];
let now = 1000;
const stubs = {
  electron: { screen: { getCursorScreenPoint: () => ({ x: 10, y: 10 }) }, BrowserWindow: {} },
  '../logger': { wrapConsole: () => ({ log() {}, warn() {} }) },
  './text-normalize': {
    isLookupWorthy: (t) => !!String(t || '').trim(),
    normalizeQuery: (t) => ({ kind: 'word', trimmed: String(t).trim() }),
  },
  './context-capture': { contextCaptureHub: { emit: (event) => emitted.push(event.text) } },
  './screen-capture': { captureAroundPoint: async () => null },
  './ocr-engine': { ocrEngine: {}, lineNearPoint: () => null, textNearPoint: () => '' },
};
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod,
  exports: mod.exports,
  require: (name) => stubs[name] || require(name),
  process: { platform: 'linux' },
  Date: { now: () => now },
  setInterval: () => 0,
  clearInterval: () => {},
  console,
});
const { HoverLookupService } = mod.exports;
let finished = false;
process.on('exit', (code) => {
  if (!finished && code === 0) {
    console.error('Hover selection test stopped before its last check (a probe never settled).');
    process.exitCode = 1;
  }
});

let mouseDown = false;
let resolveWord = null;
const hover = new HoverLookupService({
  dwellMs: 0,
  cooldownMs: 0,
  cursor: { point: () => ({ x: 10, y: 10 }) },
  isMouseDown: () => mouseDown,
  // Production blocks hover while the button is held (drag-select).
  isBlocked: () => mouseDown,
  getWordAtPoint: () => new Promise((resolve) => { resolveWord = resolve; }),
});
hover.start();

(async () => {
  // A dwell starts a slow UIA probe; the user selects a word before it answers.
  const first = hover.tick();
  assert.ok(resolveWord, 'the dwell must start a probe');
  hover.holdForSelection();
  resolveWord({ text: 'previous', x: 10, y: 10 });
  await first;
  assert.deepEqual(emitted, [], 'a probe that started before the selection must not emit after it');

  // While the selection stands, dwelling probes nothing.
  resolveWord = null;
  now += 500;
  await hover.tick();
  await hover.tick();
  assert.equal(resolveWord, null, 'no probe while a selection holds hover');
  assert.equal(hover.isHeldBySelection(), true);

  // A drag that is still held when the selection lands does not end the hold.
  mouseDown = true;
  hover.holdForSelection();
  await hover.tick();
  assert.equal(hover.isHeldBySelection(), true, 'the selecting drag itself must not release the hold');
  mouseDown = false;
  await hover.tick();
  assert.equal(hover.isHeldBySelection(), true);

  // The next press (a click elsewhere) ends the hold; hover works again.
  mouseDown = true;
  await hover.tick();
  assert.equal(hover.isHeldBySelection(), false, 'a new press releases the hold');
  mouseDown = false;
  resolveWord = null;
  const next = hover.tick();
  assert.ok(resolveWord, 'hover probes again after the press');
  resolveWord({ text: 'hovered', x: 10, y: 10 });
  await next;
  assert.deepEqual(emitted, ['hovered']);

  // A hold expires on its own when no press is seen.
  hover.holdForSelection();
  now += 60_001;
  assert.equal(hover.isHeldBySelection(), false, 'the hold expires after selectionHoldMs');

  hover.stop();
  finished = true;
  console.log('Hover selection passed: in-flight probe dropped, hold until next press, drag not counted, expiry.');
})().catch((error) => { console.error(error); process.exit(1); });
