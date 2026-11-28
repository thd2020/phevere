/* Run: node scripts/test-etymology-cache.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
  stdin: { contents: `export { DictionaryService } from './packages/core/src/dictionary';
    export { configureCore } from './packages/core/src/runtime';`, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
const mod = { exports: {} };
const timers = new Set();
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, require, console,
  setTimeout: (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; },
  clearTimeout: (timer) => { timers.delete(timer); clearTimeout(timer); },
});
const { DictionaryService, configureCore } = mod.exports;
const saved = new Map();
configureCore({
  http: { requestText: async () => { throw new Error('Unexpected network request'); } },
  sha256Hex: () => 'fixture',
  lookupCache: { get: (key) => saved.get(key), set: (key, value, savedAt) => saved.set(key, { value, savedAt }) },
});
let dictCalls = 0;
let etymCalls = 0;
function service() {
  const result = new DictionaryService();
  result.getFreeDictionaryData = async (word) => {
    dictCalls++;
    return {
      definitions: [{ partOfSpeech: 'noun', meaning: `A cache fixture for ${word}.`, source: 'Free Dictionary API' }],
      pronunciations: [
        { ipa: '/fɪks/', accent: 'us', source: 'Free Dictionary API' },
        { ipa: '/fɪks/', accent: 'uk', source: 'Free Dictionary API' },
      ],
    };
  };
  result.getWiktionaryData = async () => ({ definitions: [] });
  result.getDatamuseData = async () => ({ definitions: [], synonyms: [] });
  result.getBestTranslation = async () => ({ text: '缓存测试', language: 'zh', source: 'Fixture' });
  result.fetchEtymologyFromWikitext = async () => {
    etymCalls++;
    return { text: 'From Latin root.' };
  };
  result.fetchEtymologyFromEtymonline = async () => ({ text: '19c. fixture etymology.' });
  result.fetchEtymologyFromYoudao = async () => '[童理民 · 中文]\nA complete attributed etymology.';
  return result;
}
async function lookup(instance, word, skipEtymology) {
  let final;
  const first = await instance.lookup(word, 'zh', ['Free Dictionary API', 'Wiktionary', 'Datamuse'], {
    skipEtymology,
    sourceLanguage: 'en',
    onUpdate: (u) => { final = u; },
  });
  if (!skipEtymology && first?.metadata?.pendingEtymology) {
    for (let i = 0; i < 40 && (!final || final.metadata?.pendingEtymology); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return final || first;
  }
  return first;
}
(async () => {
  const first = service();
  assert.equal((await lookup(first, 'etymology', true)).etymology, undefined);
  assert.equal(dictCalls, 1);
  assert.equal(etymCalls, 0);
  assert.ok((await lookup(first, 'etymology', false)).etymology, 'etymology runs without re-fetching cached dictionaries');
  assert.equal(dictCalls, 1, 'cached dictionaries must not be re-fetched after a skipEtymology lookup');
  assert.equal(etymCalls, 1);
  const cachedFull = await lookup(first, 'etymology', false);
  assert.ok(cachedFull.etymology);
  assert.equal(dictCalls, 1);
  assert.equal(etymCalls, 1, 'repeat full lookup uses per-source bucket cache');
  await lookup(first, 'origin', true);
  assert.equal(dictCalls, 2);
  assert.equal(etymCalls, 1);
  const restarted = service();
  assert.ok((await lookup(restarted, 'origin', false)).etymology, 'persisted dict stays cached while missing etymology fetches');
  assert.equal(dictCalls, 2, 'persisted dict skipped re-fetch on restart');
  assert.equal(etymCalls, 2, 'unfetched etymology ran on full lookup after skip');
  assert.ok((await lookup(restarted, 'etymology', false)).etymology);
  assert.equal(dictCalls, 2);
  assert.equal(etymCalls, 2, 'full source bucket survives a service restart');
  assert.equal((await lookup(restarted, 'etymology', true)).etymology, undefined);
  assert.equal(dictCalls, 2);
  assert.equal(etymCalls, 2, 'skipEtymology stays omitted without network calls');
  console.log('Etymology cache passed: per-source buckets share dictionary hits and fetch etymology on demand.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const timer of timers) clearTimeout(timer);
});
