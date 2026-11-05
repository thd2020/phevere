/**
 * Whole lookups through DictionaryService on a fake network (packages/core/src/dictionary.ts):
 * a word with no entry keeps its "Did you mean …" suggestions on every later update, as the
 * translation and other late pieces arrive after the empty result.
 *
 * Run: node scripts/test-lookup-entry.js
 */
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
  require: (name) => (name === 'cmu-pronouncing-dictionary' ? { dictionary: {} } : require(name)),
  setTimeout, clearTimeout, setInterval, clearInterval, Date, Error, URL, URLSearchParams, TextEncoder, TextDecoder,
});
const { configureCore, DictionaryService, DictionaryError } = fixture.exports;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notFound = () => new DictionaryError('HTTP 404', 'HTTP_404', false);

/** Answers by host and path; anything not listed is a 404. `json` routes may be async. */
const routes = { json: [], text: [] };
const requested = [];
configureCore({
  sha256Hex: (text) => text,
  http: {
    requestJson: async (url) => {
      requested.push(url);
      for (const [test, answer] of routes.json) if (test(new URL(url))) return answer(new URL(url));
      throw notFound();
    },
    requestText: async (url) => {
      requested.push(url);
      for (const [test, answer] of routes.text) if (test(new URL(url))) return { ok: true, status: 200, text: await answer(new URL(url)) };
      return { ok: false, status: 404, text: '' };
    },
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  },
  lookupCache: { get: () => null, set: () => {} },
});

(async () => {
  // "coverness" has no entry anywhere; Datamuse offers spellings; the translation comes late.
  routes.json.push(
    [(u) => u.hostname === 'api.datamuse.com' && u.pathname === '/sug', () => [{ word: 'governess' }, { word: 'covertness' }]],
    [
      (u) => u.hostname === 'translate.googleapis.com',
      async () => {
        await sleep(400);
        return [[['覆盖', 'coverness', null, null, 1]], null, 'en'];
      },
    ],
  );
  const service = new DictionaryService();
  const updates = [];
  const result = await service.lookup('coverness', 'zh', undefined, { onUpdate: (r) => updates.push(r) });
  assert.equal((result.definitions || []).filter((d) => d.source !== 'Fallback').length, 0, 'coverness has no senses');
  assert.equal(result.metadata.suggestions[0], 'governess', 'the closest spelling first');
  await sleep(1500);
  const after = updates.filter((r) => (r.translations || []).some((t) => t.text));
  assert.ok(after.length, 'the translation arrives as a later update');
  for (const r of after) assert.deepEqual(r.metadata.suggestions, result.metadata.suggestions, 'every later update keeps the suggestions');
  console.log('Lookup entry passed: "Did you mean" stays through later updates.');
  // The service keeps safety-net timers for lookups; they would hold the process open.
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
