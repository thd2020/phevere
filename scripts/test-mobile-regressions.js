/* Run: node scripts/test-mobile-regressions.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const esbuild = require('esbuild');

/** The interface strings and the Language setting's helpers app.ts calls: the real ones, in English. */
const i18n = (() => {
  const code = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'packages/core/src/i18n/index.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false,
  }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
})();

function load(file, imports, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps/mobile/src', file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => {
    assert.ok(name in imports, `Missing mock ${name}`);
    return imports[name];
  // The Language setting reads the phone's languages at start-up.
  }, URL, URLSearchParams, console, navigator: { language: 'en', languages: ['en'], userAgent: '' }, ...globals }, { filename: file });
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
    ...i18n,
    listVocab: () => notebook,
    listEmptyDefinitions: async () => [], listEmptyReadings: async () => [],
    findByLemma: async () => null, saveLemma: (result) => result.word, morphemeOf: () => null, primeBookLevels: async () => undefined,
    // Pictures are not under test here either.
    prefetchSenseImages: () => {}, fetchSenseImages: async () => [], hideSenseImage: async () => {}, unhideSenseImage: async () => {},
    hydratePictures: () => {}, pictureSrc: () => '',
    dictionaryService: {
      getSupportedLanguages: () => [], getEnabledSources: () => [],
      lookup: (q, lang, sources, options) => new Promise((resolve) => lookups.push({ q, options, resolve })),
    },
    wikipediaService: { search: async () => [] },
    // Notebook views are not under test here; the shell only needs the calls to exist.
    disposeNotebookMaps: () => {},
    readNotebookView: (v) => ({ view: v === 'review' || !v ? 'list' : v, learn: v === 'review' }),
    readCardLayouts: () => ({}),
    withCardLayout: (all, list, layout) => ({ ...all, [list]: layout }),
    listWordbookSubs: async () => [], listUserBooks: async () => [], listBookProgress: async () => [],
    buildWordsContext: () => ({ mine: [], progress: new Map(), subs: [], books: new Map(), index: new Map(), saved: new Map() }),
    // Settings → Learn: stored options and the microphone check.
    readLearnPrefs: () => ({ countdown: 0, speaking: true }), writeLearnPrefs: (p) => JSON.stringify(p),
    microphoneAvailable: async () => false, watchMicrophone: () => {}, wireNumberWheels: () => {},
    setAppIconSource: () => {},
  };
  // The notebook file shared with the other page: a write there reaches this page.
  const reloadListeners = [];
  const notebookStore = {
    flushNotebook: async () => {},
    onNotebookReloaded: (fn) => { reloadListeners.push(fn); return () => {}; },
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
  const accountCalls = [];
  const account = new Proxy({}, { get: (_t, name) => (...args) => { accountCalls.push(String(name)); } });
  const app = load('app.ts', {
    './lexicon-scroll': load('lexicon-scroll.ts', {}),
    './platform/configure-core': {}, '@phevere/core': core, './incoming-text': incoming,
    // Scan only: the in-place text view and its page model (test-ocr-layout.js covers them).
    '@phevere/core/ocr-view': { OcrView: class {} }, '@phevere/core/ocr-layout': { pageLines: () => [] }, '@phevere/core/ocr-translate': { pageTarget: async () => 'en', translateUnits: async () => [] },
    './platform/audio': { recordedUrls: () => [], prefetchRecorded: () => {} }, './platform/native': native, './platform/notebook-io': {},
    './platform/offline': { listCatalogStatus: async () => [], markInstalledPacksOnCore: async () => {} },
    './platform/prefs': { loadPrefs: () => prefs, savePrefs: () => {}, applyPrefsToCore: () => {} },
    // The pop-up never starts the updater; test-mobile-update.js covers it.
    './platform/updates': { startPhoneUpdates: async () => { throw new Error('the pop-up must not check for updates'); } },
    './app-update': { updateStatusText: () => '' },
    './views': {
      esc: (s) => s, lookupBody: ({ result }) => JSON.stringify(result), appBarHtml: (_t, q) => q, popupBarHtml: () => '', lexiconSenses: (r) => (r && r.definitions) || [],
      // Settings state the shell creates at start-up; its shape does not matter here.
      emptyLibraryState: () => ({ openDetails: new Set(), packProgress: null, inspecting: null, inspectorEntering: false, packDetails: new Map() }),
      keyPresent: () => false,
    },
    './platform/account': account,
    './platform/app-icons': { appIconSource: () => () => '' },
    './platform/sqljs-vocab-db': notebookStore,
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
  // The app saved a word while the pop-up was open: the pop-up shows it, and leaves syncing to the app.
  assert.equal(reloadListeners.length, 1, 'the page listens for the other page’s writes');
  reloadListeners[0]();
  await tick();
  // The pop-up never starts the account or syncs; the full app does that.
  assert.deepEqual(accountCalls, [], 'the pop-up must not touch the Holarky account');
}

/**
 * One history for Back in the full app. A lookup opened from Recent or from a Words row is a
 * step; a tab tapped in the bottom bar is not, and Back from it goes to Recent, as with
 * Android's Navigation library. Only Recent lets the app close, and the native shell hears when
 * Back would leave.
 */
async function backHistory() {
  const backFlags = [];
  const lookups = [];
  const events = {};
  const root = { innerHTML: '', addEventListener: (name, handler) => { events[name] = handler; } };
  const document = {
    documentElement: { dataset: {}, classList: { toggle: () => {} } },
    getElementById: (id) => (id === 'app' ? root : null),
    querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
  };
  const window = {
    location: { search: '', href: 'https://example.test/', origin: 'https://example.test' },
    addEventListener: () => {}, setTimeout, clearTimeout, requestAnimationFrame: (f) => setTimeout(f, 0), scrollTo: () => {},
  };
  const globals = { window, document };
  const incoming = load('incoming-text.ts', {}, globals);
  const prefs = { floatingStrip: false, sources: {}, sourceLang: 'auto', targetLang: 'zh', wikiLang: 'en', senseImages: false };
  const known = {
    ...i18n,
    listVocab: async () => [], listEmptyDefinitions: async () => [], listEmptyReadings: async () => [],
    findByLemma: async () => null, saveLemma: (result) => result.word, morphemeOf: () => null, primeBookLevels: async () => undefined,
    dictionaryService: {
      getSupportedLanguages: () => [], getEnabledSources: () => [], getSourceStats: () => ({ sources: [] }),
      lookup: (q, lang, sources, options) => new Promise((resolve) => lookups.push({ q, options, resolve })),
    },
    wikipediaService: { search: async () => [] },
    readNotebookView: (v) => ({ view: v === 'review' || !v ? 'list' : v, learn: v === 'review' }),
    readCardLayouts: () => ({}), withCardLayout: (all) => all,
    listWordbookSubs: async () => [], listUserBooks: async () => [], listBookProgress: async () => [],
    buildWordsContext: () => ({ mine: [], progress: new Map(), subs: [], books: new Map(), index: new Map(), saved: new Map() }),
    readLearnPrefs: () => ({ countdown: 0, speaking: true }), writeLearnPrefs: (p) => JSON.stringify(p),
    microphoneAvailable: async () => false, watchMicrophone: () => {},
    closeTreeInspector: () => false, treeInspectorOpen: () => false, menuOpen: () => false, closeMenu: () => {},
    HOLARKY_ACCOUNT: {},
  };
  // Views and the rest of core only draw; they need to exist.
  const core = new Proxy(known, { get: (t, name) => (name in t ? t[name] : () => '') });
  const native = {
    hasNativeBridge: () => true, installNativeCallbacks: () => {}, applyInsets: () => {},
    nativeCall: async (method, params) => {
      if (method === 'getCapturePrefs') return { platform: 'android', floatingStrip: false };
      if (method === 'setBackEnabled') backFlags.push(params.on);
      return {};
    },
  };
  const views = new Proxy({
    esc: (s) => s,
    appBarHtml: (tab, q) => (tab === 'lookup' ? `[q:${q}]` : ''),
    navHtml: (tab) => `[tab:${tab}]`,
    emptyLibraryState: () => ({ openDetails: new Set(), packProgress: null, inspecting: null, inspectorEntering: false, packDetails: new Map() }),
    keyPresent: () => false,
  }, { get: (t, name) => (name in t ? t[name] : () => '') });
  const app = load('app.ts', {
    './lexicon-scroll': load('lexicon-scroll.ts', {}),
    './platform/configure-core': {}, '@phevere/core': core, './incoming-text': incoming,
    '@phevere/core/ocr-view': { OcrView: class {} }, '@phevere/core/ocr-layout': { pageLines: () => [] }, '@phevere/core/ocr-translate': { pageTarget: async () => 'en', translateUnits: async () => [] },
    './platform/audio': {}, './platform/native': native, './platform/notebook-io': {},
    './platform/offline': { listCatalogStatus: async () => [], markInstalledPacksOnCore: async () => {} },
    './platform/prefs': { loadPrefs: () => prefs, savePrefs: () => {}, applyPrefsToCore: () => {} },
    './platform/updates': { startPhoneUpdates: async () => ({ state: () => null, resume: () => {} }) },
    './platform/app-icons': { appIconSource: () => () => '' },
    './platform/sqljs-vocab-db': { flushNotebook: async () => {}, onNotebookReloaded: () => () => {} },
    './app-update': { updateStatusText: () => '' },
    './views': views,
    './platform/account': new Proxy({}, { get: () => () => {} }),
  }, globals);
  await app.startApp();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
  const where = () => `${/\[tab:(\w+)\]/.exec(root.innerHTML)[1]} ${/\[q:([^\]]*)\]/.exec(root.innerHTML)?.[1] ?? ''}`.trim();
  const tap = (act, data = {}) => {
    const el = { dataset: { act, ...data }, classList: { contains: () => false }, closest: () => null };
    events.click({ target: { closest: (sel) => (sel === '[data-act]' ? el : null) } });
  };
  await wait();
  assert.equal(where(), 'lookup', 'the app starts on Lookup with Recent');
  assert.equal(backFlags.at(-1), false, 'on the start screen Back is left to the system');
  tap('lookup', { q: 'apple' });
  await wait();
  assert.equal(where(), 'lookup apple');
  assert.equal(backFlags.at(-1), true, 'away from the start screen Back stays in the app');
  // The lookup's own tabs are views of the word, not steps.
  tap('result-tab', { tab: 'translation' });
  await wait();
  tap('result-tab', { tab: 'lexicon' });
  await wait();
  tap('tab', { tab: 'notebook' });
  await wait();
  assert.equal(where(), 'notebook');
  tap('lookup', { q: 'pear' });
  await wait();
  assert.equal(where(), 'lookup pear');
  const steps = [];
  for (let i = 0; i < 5; i++) {
    const went = window.__pvBack();
    await wait();
    steps.push(went ? where() : 'leave');
    if (!went) break;
  }
  assert.deepEqual(steps, ['notebook', 'lookup', 'leave'], 'a word opened from Words goes back there; Words goes back to Recent, then the app leaves');
  assert.equal(backFlags.at(-1), false);
  // Recent is the root: a lookup from it and Back return to Recent, the next Back leaves.
  tap('lookup', { q: 'plum' });
  await wait();
  assert.equal(window.__pvBack(), true);
  await wait();
  assert.equal(where(), 'lookup');
  assert.equal(window.__pvBack(), false);
  // Tabs tapped in the bar are not steps: from Learn and then Settings, Back goes to Recent.
  tap('tab', { tab: 'learn' });
  await wait();
  tap('tab', { tab: 'settings' });
  await wait();
  assert.equal(where(), 'settings');
  assert.equal(window.__pvBack(), true);
  await wait();
  assert.equal(where(), 'lookup', 'Back from a bar tab goes to Recent');
  assert.equal(window.__pvBack(), false);
  // A word left on Lookup, then Words, then Lookup from the bar: Back goes to Recent, not Words.
  tap('lookup', { q: 'date' });
  await wait();
  tap('tab', { tab: 'notebook' });
  await wait();
  tap('tab', { tab: 'lookup' });
  await wait();
  assert.equal(where(), 'lookup date');
  assert.equal(window.__pvBack(), true);
  await wait();
  assert.equal(where(), 'lookup');
  // Re-tapping the tab already shown leaves nothing behind: a word opened from Words after it
  // still goes back to Words.
  tap('tab', { tab: 'notebook' });
  await wait();
  tap('tab', { tab: 'notebook' });
  await wait();
  tap('lookup', { q: 'lime' });
  await wait();
  assert.equal(window.__pvBack(), true);
  await wait();
  assert.equal(where(), 'notebook');
  assert.equal(window.__pvBack(), true);
  await wait();
  assert.equal(where(), 'lookup');
  // The bar's back arrow takes back the step that led to the word, as Back would.
  tap('lookup', { q: 'fig' });
  await wait();
  tap('lookup', { q: 'kiwi' });
  await wait();
  tap('back');
  await wait();
  assert.equal(where(), 'lookup fig');
  assert.equal(window.__pvBack(), true);
  await wait();
  assert.equal(where(), 'lookup', 'after the arrow, Back goes on further back');
  for (const l of lookups) l.resolve({ word: l.q });
}

async function audioFallback() {
  const calls = [];
  let failSpeech = false;
  const audio = load('platform/audio.ts', {
    '@phevere/core': {
      accentToBcp47: () => 'en-GB',
      ipaToEspeakPhonemes: (ipa) => (ipa ? "h@l'oU" : ''),
      ipaToKokoroPhonemes: (ipa, accent) => (ipa ? `k:${accent}` : ''),
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
  // A clip stopped by a newer press ends quietly: no synthetic voice over the newer one.
  await audio.playRecorded({ word: 'hello' }, prefs, undefined, () => false);
  assert.deepEqual(calls.map((c) => c.method), ['playUrl']);
  calls.length = 0;
  // IPA chips voice their own IPA mechanically, even when the source sent a clip.
  await audio.speakIpa({ ipa: 'həˈləʊ', accent: 'uk', audioUrl: 'clip' }, prefs, 'hello');
  assert.deepEqual(calls.map((c) => c.method), ['speak']);
  assert.equal(calls[0].params.text, "h@l'oU");
  assert.equal(calls[0].params.phonemes, true);
  assert.equal(calls[0].params.lang, 'en-GB');
  // A neural voice reads the same chip from its Kokoro phonemes with the UK speaker.
  assert.equal(calls[0].params.kokoro, 'k:uk');
  assert.equal(calls[0].params.speaker, 20);
  failSpeech = true;
  await assert.rejects(audio.speakText('hello', prefs), /unavailable/);
}

(async () => {
  await require('./test-notebook-csv')();
  await startupAndGestures(true);
  await startupAndGestures(false);
  await backHistory();
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

  console.log('Mobile regressions passed: cold/warm share, stale lookup, Back history, no extra toolbar, independent definition scrolling, swipe expansion, audio fallback, eSpeak IPA mapping, Wiktionary IPA parsing.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
