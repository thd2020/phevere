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
    './lexicon-scroll': load('lexicon-scroll.ts', {}),
    './platform/configure-core': {}, '@phevere/core': core, './incoming-text': incoming,
    './platform/audio': {}, './platform/native': native, './platform/notebook-io': {},
    './platform/offline': { listCatalogStatus: async () => [], markInstalledPacksOnCore: async () => {} },
    './platform/prefs': { loadPrefs: () => prefs, savePrefs: () => {}, applyPrefsToCore: () => {} },
    './views': { esc: (s) => s, lookupBody: ({ result }) => JSON.stringify(result), appBarHtml: (_t, q) => q, popupBarHtml: () => '' },
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
  // The swipe starts on the pop-up header; swipes on the content only scroll.
  events.touchstart({ touches: [{ clientX: 50, clientY: 250 }], target: { closest: () => ({}) } });
  events.touchend({ changedTouches: [{ clientX: 55, clientY: 100 }] });
  assert.equal(calls.filter((c) => c.method === 'expandStrip').length, floatingStrip ? 0 : 1);
  assert.ok(!root.innerHTML.includes('strip-actions'), 'extra button strip must be absent');
  window.__pvIncoming('third', 'process-text');
  assert.equal(lookups[2].q, 'third');
  releaseNotebook([]);
  await boot;
}

async function audioFallback() {
  const calls = [];
  let failSpeech = false;
  const audio = load('platform/audio.ts', {
    '@phevere/core': {
      accentToBcp47: () => 'en-GB',
      ipaToEspeakPhonemes: (ipa) => (ipa ? "h@l'oU" : ''),
      recordedPronunciationUrls: () => ['bad-clip'],
    },
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
  // IPA chips voice their own IPA mechanically, even when the source sent a clip.
  await audio.speakIpa({ ipa: 'həˈləʊ', accent: 'uk', audioUrl: 'clip' }, prefs, 'hello');
  assert.deepEqual(calls.map((c) => c.method), ['speak']);
  assert.equal(calls[0].params.text, "h@l'oU");
  assert.equal(calls[0].params.phonemes, true);
  assert.equal(calls[0].params.lang, 'en-GB');
  failSpeech = true;
  await assert.rejects(audio.speakText('hello', prefs), /unavailable/);
}

(async () => {
  await startupAndGestures(true);
  await startupAndGestures(false);
  await audioFallback();
  // IPA chips: only mnemonics in eSpeak's English table, and one stressed vowel.
  const core = '../../../packages/core/src/';
  const phon = load(core + 'ipa-phonemes.ts', { './pronunciation': load(core + 'pronunciation.ts', {}) });
  const pron = load(core + 'pronunciation.ts', {});
  const wrap = pron.extractIpaFromWikitext([
    '==English==', '===Pronunciation===',
    '* {{IPA|en|/ɹæp/}}',
    '* {{a|UK|dialectal}} {{IPA|en|/ɹɒp/}}',
    "* {{IPA|en|passage=☞ This word is often pronounced ''wrop'', rhyming with ''top''.}}",
    '* {{IPA|en|/(w)ɹæp/}}', '===Verb===',
  ].join('\n')).map((p) => `${p.accent}:${p.ipa}`);
  assert.equal(JSON.stringify(wrap), JSON.stringify(['other:ɹæp', 'uk:ɹɒp', 'other:(w)ɹæp']), 'no prose IPA, no accent carry-over');
  assert.equal(phon.ipaToEspeakPhonemes('/kæt/'), "k'at");
  assert.equal(phon.ipaToEspeakPhonemes('/θɑt/'), "T'A:t");
  assert.equal(phon.ipaToEspeakPhonemes('/lɒt/'), "l'0t");
  assert.equal(phon.ipaToEspeakPhonemes('/ˈwɑɾɚ/'), "w'A:4@r");
  assert.equal(phon.ipaToEspeakPhonemes('/həˈləʊ/'), "h@l'@U");
  const { scrollLexiconTo } = load('lexicon-scroll.ts', {});
  let scrolled;
  const panel = { scrollTop: 40, getBoundingClientRect: () => ({ top: 200 }), scrollTo: (value) => { scrolled = value; } };
  const target = { getBoundingClientRect: () => ({ top: 600 }) };
  scrollLexiconTo(panel, target, false);
  assert.equal(scrolled.top, 434);
  assert.equal(scrolled.behavior, 'smooth');
  scrollLexiconTo(panel, target, true);
  assert.equal(panel.scrollTop, 434, 'only the definition column should scroll');

  console.log('Mobile regressions passed: cold/warm share, stale lookup, no extra toolbar, independent definition scrolling, swipe expansion, audio fallback, eSpeak IPA mapping, Wiktionary IPA parsing.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
