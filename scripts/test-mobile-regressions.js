/* Run: node scripts/test-mobile-regressions.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps/mobile/src', file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => {
    assert.ok(name in imports, `Missing mock ${name}`);
    return imports[name];
  }, URL, URLSearchParams, console, ...globals }, { filename: file });
  return module.exports;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function startupAndGestures(floatingStrip) {
  const calls = [];
  const lookups = [];
  const events = {};
  const classes = new Set();
  const root = { innerHTML: '', addEventListener: (name, handler) => { events[name] = handler; } };
  const document = {
    documentElement: { dataset: {}, classList: { toggle: (key, on) => on ? classes.add(key) : classes.delete(key) } },
    getElementById: (id) => id === 'app' ? root : null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
  };
  const window = {
    location: { search: '?mode=strip', href: 'https://example.test/?mode=strip', origin: 'https://example.test' },
    addEventListener: () => {}, setTimeout: () => 1, clearTimeout: () => {},
  };
  const globals = { window, document };
  const incoming = load('incoming-text.ts', {}, globals);
  const prefs = { floatingStrip, sources: {}, sourceLang: 'auto', targetLang: 'zh', wikiLang: 'en' };
  let releaseNotebook;
  const notebook = new Promise((resolve) => { releaseNotebook = resolve; });
  const core = {
    listVocab: () => notebook,
    listEmptyDefinitions: async () => [], listEmptyReadings: async () => [],
    findByLemma: async () => null, saveLemma: (result) => result.word,
    dictionaryService: {
      getSupportedLanguages: () => [], getEnabledSources: () => [],
      lookup: (q, lang, sources, options) => new Promise((resolve) => lookups.push({ q, options, resolve })),
    },
    wikipediaService: { search: async () => [] },
  };
  const native = {
    hasNativeBridge: () => true, installNativeCallbacks: () => {}, applyInsets: () => {},
    nativeCall: async (method, params) => {
      calls.push({ method, params });
      if (method === 'getCapturePrefs') return { platform: 'android', floatingStrip };
      if (method === 'getPendingText') {
        assert.equal(typeof window.__pvIncoming, 'function', 'handler must exist before native handshake');
        return { text: 'first', origin: 'process-text' };
      }
      return {};
    },
  };
  const app = load('app.ts', {
    './platform/configure-core': {}, '@phevere/core': core, './incoming-text': incoming,
    './platform/audio': {}, './platform/native': native, './platform/notebook-io': {},
    './platform/offline': { listCatalogStatus: async () => [], markInstalledPacksOnCore: async () => {} },
    './platform/prefs': { loadPrefs: () => prefs, savePrefs: () => {}, applyPrefsToCore: () => {} },
    './views': { esc: (s) => s, lookupBody: ({ result }) => JSON.stringify(result), searchHtml: (q) => q },
  }, globals);
  const boot = app.startApp();
  await tick();
  assert.equal(lookups[0].q, 'first', 'cold-start query must run even while notebook initialization is blocked');
  window.__pvIncoming('second', 'share');
  assert.equal(lookups[1].q, 'second');
  lookups[1].options.onUpdate({ word: 'second' });
  lookups[0].options.onUpdate({ word: 'stale' });
  lookups[0].resolve({ word: 'stale' });
  await tick();
  assert.ok(root.innerHTML.includes('second'));
  assert.ok(!root.innerHTML.includes('stale'), 'late results must not replace the latest shared word');
  events.touchstart({ touches: [{ clientX: 50, clientY: 250 }] });
  events.touchend({ changedTouches: [{ clientX: 55, clientY: 100 }] });
  assert.equal(calls.filter((c) => c.method === 'expandStrip').length, floatingStrip ? 0 : 1);
  events.click({ target: { closest: () => ({ dataset: { act: 'compact-strip' } }) } });
  assert.ok(classes.has('strip-compact'));
  assert.ok(calls.some((c) => c.method === 'resizeStrip' && c.params.compact));
  window.__pvIncoming('third', 'process-text');
  assert.ok(!classes.has('strip-compact'), 'new shared words reopen compact results');
  releaseNotebook([]);
  await boot;
}

async function audioFallback() {
  const calls = [];
  let failSpeech = false;
  const audio = load('platform/audio.ts', {
    '@phevere/core': { accentToBcp47: () => 'en-GB', recordedPronunciationUrls: () => ['bad-clip'] },
    './native': { hasNativeBridge: () => true, nativeCall: async (method, params) => {
      calls.push({ method, params });
      if (method === 'playUrl' || failSpeech) throw new Error('unavailable');
    } },
  });
  const prefs = { audioEnabled: true, audioSpeed: 1 };
  await audio.playRecorded({ word: 'hello' }, prefs);
  assert.deepEqual(calls.map((c) => c.method), ['playUrl', 'speak']);
  assert.equal(calls[1].params.text, 'hello');
  calls.length = 0;
  await audio.speakIpa({ accent: 'uk', audioUrl: 'broken' }, prefs, 'hello');
  assert.equal(calls[1].params.lang, 'en-GB');
  failSpeech = true;
  await assert.rejects(audio.speakText('hello', prefs), /unavailable/);
}

(async () => {
  await startupAndGestures(true);
  await startupAndGestures(false);
  await audioFallback();
  console.log('Mobile regressions passed: cold/warm share, stale lookup, popup controls, swipe expansion, audio fallback.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
