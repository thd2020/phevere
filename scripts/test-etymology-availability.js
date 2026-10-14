/* Run: node scripts/test-etymology-availability.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const compiled = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../packages/core/src/index.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['cmu-pronouncing-dictionary'],
}).outputFiles[0].text;
const fixture = { exports: {} };
vm.runInNewContext(compiled, {
  module: fixture, exports: fixture.exports, console: { log() {}, warn() {}, error() {} },
  require: name => name === 'cmu-pronouncing-dictionary' ? { dictionary: {} } : require(name),
  setTimeout: (callback, ms, ...args) => {
    // Exercise the outer source deadline without making this test wait ten seconds.
    const timer = setTimeout(callback, ms === 10000 ? 5 : ms, ...args);
    if (ms >= 20000) timer.unref();
    return timer;
  }, clearTimeout, Date, Error, URL, URLSearchParams,
});
const { configureCore, DictionaryService, DictionaryError } = fixture.exports;
let response = { ok: false, status: 403, text: '<title>Just a moment...</title>' };
let rejection;
const persisted = new Map();
configureCore({
  sha256Hex: text => text,
  http: {
    requestText: async () => { if (rejection) throw rejection; return response; },
    requestJson: async () => ({}), requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array() }),
  },
  lookupCache: { get: key => persisted.get(key) || null, set: (key, value, savedAt) => persisted.set(key, { value, savedAt }) },
});
const service = new DictionaryService();
const url = 'https://www.etymonline.com/word/orientation';
const unavailable = result => JSON.parse(JSON.stringify(result.unavailable));
const plain = JSON.parse(JSON.stringify({
  word: 'orientation', definitions: [{ source: 'Free Dictionary API', partOfSpeech: 'noun', meaning: 'A direction or position.' }],
  translations: [{ language: 'zh', text: '方向' }], examples: [], sources: ['Free Dictionary API'],
  metadata: { sourceStatus: { freeDictionary: 'ok' }, expectedSources: ['freeDictionary'] },
}));
(async () => {
  for (const status of [403, 429, 500]) {
    response = { ok: false, status, text: '' };
    const result = await service.fetchEtymologyFromEtymonline('orientation');
    assert.deepEqual(unavailable(result), { source: 'Etymonline', status: status === 500 ? 'unavailable' : 'blocked', url, code: `HTTP_${status}` });
    assert.equal(result.text, undefined, 'An HTTP failure must not become etymology prose.');
  }
  rejection = new Error('Connection failed');
  assert.equal((await service.fetchEtymologyFromEtymonline('orientation')).unavailable.code, 'NETWORK_ERROR');
  rejection = new DictionaryError('Request timed out', 'TIMEOUT', true);
  assert.equal((await service.fetchEtymologyFromEtymonline('orientation')).unavailable.code, 'TIMEOUT');
  rejection = undefined;
  response = { ok: false, status: 404, text: '' };
  assert.equal(await service.fetchEtymologyFromEtymonline('orientation'), undefined);
  response = { ok: true, status: 200, text: '<html><title>Empty entry</title></html>' };
  assert.equal(await service.fetchEtymologyFromEtymonline('orientation'), undefined);
  response = { ok: true, status: 200, text: '<section class="prose-lg"><p>From an earlier word for facing east, later extended to direction.</p></section>' };
  const success = await service.fetchEtymologyFromEtymonline('orientation');
  assert.ok(success.text.includes('facing east')); assert.equal(success.unavailable, undefined);

  service.fetchEtymologyFromWikitext = async () => ({ text: 'From orient and a noun-forming suffix.' });
  service.fetchEtymologyFromYoudao = async () => '[童理民 · 中文]\n该词的词义从东向扩大为方向。';
  response = { ok: false, status: 403, text: '' };
  const combined = await service.fetchEtymologyFromMultipleSources('orientation');
  assert.ok(combined.text.includes('[Wiktionary]')); assert.ok(combined.text.includes('[童理民 · 中文]'));
  assert.equal(combined.unavailable[0].code, 'HTTP_403');
  assert.ok(!combined.text.includes('[Etymonline]'), 'Blocked provider prose must not be invented.');
  response = { ok: true, status: 200, text: '<meta property="og:description" content="An early noun for establishing direction from the east."/>' };
  assert.equal((await service.fetchEtymologyFromMultipleSources('orientation')).unavailable, undefined, 'Success clears provider failure.');
  const originalFetch = service.fetchEtymologyFromEtymonline;
  service.fetchEtymologyFromEtymonline = () => new Promise(() => {});
  assert.equal((await service.fetchEtymologyFromMultipleSources('orientation')).unavailable[0].code, 'TIMEOUT');
  service.fetchEtymologyFromEtymonline = originalFetch;

  const failed = { ...plain, metadata: { ...plain.metadata, etymologyUnavailable: combined.unavailable } };
  assert.equal(service.isIncompleteSourceCache(failed), true);
  assert.equal(service.isIncompleteSourceCache(plain), false);
  assert.notEqual(service.updateSignature(failed), service.updateSignature(plain));
  service.aggregateDictionaryDataParallel = async () => failed;
  await service.lookup('orientation', 'zh', ['Free Dictionary API'], { sourceLanguage: 'en' });
  const saved = [...persisted.values()][0];
  assert.ok(saved, 'The result with real definitions remains cacheable.');
  const remaining = 14 * 24 * 60 * 60 * 1000 - (Date.now() - saved.savedAt);
  assert.ok(remaining > 590000 && remaining <= 600000, 'A failed provider persists for ten minutes, not fourteen days.');
  const restored = new DictionaryService();
  await restored.lookup('orientation', 'zh', ['Free Dictionary API'], { sourceLanguage: 'en' });
  assert.ok([...restored.cache.values()][0].ttl <= 600000, 'Restoring a partial disk entry must not extend its memory lifetime to one day.');

  response = { ok: false, status: 403, text: '' };
  const streamed = new DictionaryService();
  streamed.fetchEtymologyFromWikitext = service.fetchEtymologyFromWikitext;
  streamed.fetchEtymologyFromYoudao = service.fetchEtymologyFromYoudao;
  streamed.getBestTranslation = async () => ({ language: 'zh', text: '方向', source: 'Fixture' });
  streamed.getFreeDictionaryData = async () => ({
    definitions: plain.definitions,
    pronunciations: [{ ipa: '/fə/', accent: 'us', source: 'Fixture' }, { ipa: '/fə/', accent: 'uk', source: 'Fixture' }],
  });
  const final = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Streaming failure metadata did not arrive.')), 2000);
    streamed.aggregateDictionaryDataParallel('orientation', 'zh', 'en', ['Free Dictionary API'], undefined, {
      onUpdate: result => {
        if (result.metadata.pendingEtymology) return;
        clearTimeout(deadline); resolve(result);
      },
    }).catch(error => { clearTimeout(deadline); reject(error); });
  });
  const update = await final;
  assert.equal(update.metadata.etymologyUnavailable[0].code, 'HTTP_403');
  assert.ok(update.etymology.includes('[Wiktionary]')); assert.ok(update.etymology.includes('[童理民 · 中文]'));
  assert.equal(update.metadata.pendingEtymology, false);
  console.log('Etymology availability passed: HTTP failures, network, deadlines, genuine misses, success, other sources and retry cache lifetime.');
})().catch(error => { console.error(error); process.exitCode = 1; });
