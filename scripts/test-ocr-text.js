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
assert.strictEqual(
  finalizeOcrLines([
    { text: 'cent', bounds: { x: 0, y: 0, width: 40, height: 20 } },
    { text: 'rifu', bounds: { x: 41, y: 0, width: 40, height: 20 } },
  ]).text,
  'centrifu',
);

// Hover OCR strict point-matching (no snapping to distant boxes or adjacent stacked lines).
const esbuild = require('esbuild');
const engineBundle = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'services', 'ocr-engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['electron', '@phevere/core/*', '@gutenye/ocr-node', 'onnxruntime-node', 'sharp'],
}).outputFiles[0].text;
const engMod = { exports: {} };
const stubs = {
  electron: {
    app: { isPackaged: false, getPath: () => '.', getAppPath: () => '.' },
    nativeImage: { createFromBuffer: () => ({}) },
    net: {},
  },
  '@phevere/core/i18n/runtime': { t: (k) => k },
  '@phevere/core/ocr-layout': { buildOcrPage: () => ({}), ocrPageText: () => '', pageLines: () => [] },
};
vm.runInNewContext(engineBundle, {
  module: engMod,
  exports: engMod.exports,
  console,
  process,
  Buffer,
  URL,
  __dirname: path.join(__dirname, '..', 'src', 'services'),
  require: (name) => stubs[name] || require(name),
});
const { lineNearPoint, textNearPoint } = engMod.exports;

const stackedResult = {
  text: 'Artwork by majamari\nMF Books Mushoku Tensei: Jobless Reincarnation',
  lines: [
    { text: 'Artwork by majamari', bounds: { x: 100, y: 10, width: 120, height: 12 } },
    { text: 'MF Books Mushoku Tensei: Jobless Reincarnation', bounds: { x: 80, y: 23, width: 220, height: 12 } },
  ],
};
assert.strictEqual(lineNearPoint(stackedResult, 20, 16, { strict: true }), undefined, 'strict mode returns undefined far left of boxes');
assert.strictEqual(textNearPoint(stackedResult, 20, 16, { strict: true }), '', 'strict mode returns empty string outside boxes');
assert.strictEqual(textNearPoint(stackedResult, 160, 60, { strict: true }), '', 'strict mode returns empty string vertically away from lines');
assert.strictEqual(lineNearPoint(stackedResult, 150, 16, { strict: true }).text, 'Artwork by majamari', 'picks top stacked row');
assert.strictEqual(lineNearPoint(stackedResult, 150, 29, { strict: true }).text, 'MF Books Mushoku Tensei: Jobless Reincarnation', 'picks bottom stacked row');
assert.strictEqual(textNearPoint(stackedResult, 215, 29, { strict: true }), 'Jobless', 'picks word inside second row');

console.log('ocr-text ok');
