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
let calls = 0;
function service() {
  const result = new DictionaryService();
  // Stub provider work; exercise the real lookup, memory cache and persistent cache.
  result.lookupWithCandidates = async (query, _target, _lang, _sources, _holder, opts) => {
    calls++;
    return {
      word: query.trimmed,
      definitions: [{ partOfSpeech: 'noun', meaning: 'A cache fixture.', source: 'Wiktionary' }],
      translations: [{ text: '缓存测试', language: 'zh' }], examples: [], sources: ['Wiktionary'],
      etymology: opts.skipEtymology ? undefined : '[童理民 · 中文]\nA complete attributed etymology.',
      metadata: { sourceStatus: { wiktionary: 'ok' }, expectedSources: ['wiktionary'] },
    };
  };
  return result;
}
async function lookup(instance, word, skipEtymology) {
  return instance.lookup(word, 'zh', undefined, { skipEtymology, sourceLanguage: 'en' });
}
(async () => {
  const first = service();
  assert.equal((await lookup(first, 'etymology', true)).etymology, undefined);
  assert.ok((await lookup(first, 'etymology', false)).etymology, 'memory skip result must not answer a full lookup');
  assert.equal(calls, 2);
  await lookup(first, 'etymology', false);
  assert.equal(calls, 2, 'repeat full lookup should still use its own cache');
  await lookup(first, 'origin', true);
  const restarted = service();
  assert.ok((await lookup(restarted, 'origin', false)).etymology, 'persisted skip result must not answer a full lookup');
  assert.equal(calls, 4);
  assert.ok((await lookup(restarted, 'etymology', false)).etymology);
  assert.equal(calls, 4, 'full cache survives a service restart');
  assert.equal((await lookup(restarted, 'etymology', true)).etymology, undefined);
  assert.equal(calls, 4, 'skip cache also survives independently');
  console.log('Etymology cache passed: skip/full memory and persistent lookups remain separate.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const timer of timers) clearTimeout(timer);
});
