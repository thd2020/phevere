/* Run: node scripts/test-source-cache.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const compiled = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../packages/core/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['cmu-pronouncing-dictionary'],
}).outputFiles[0].text;

const mod = { exports: {} };
vm.runInNewContext(compiled, {
  module: mod,
  exports: mod.exports,
  console: { log() {}, warn() {}, error() {} },
  require: (name) => (name === 'cmu-pronouncing-dictionary' ? { dictionary: {} } : require(name)),
  setTimeout,
  clearTimeout,
  Date,
  Error,
  URL,
  URLSearchParams,
});

const { DictionaryService, DictionaryError, configureCore } = mod.exports;

const disk = new Map();
configureCore({
  sha256Hex: (t) => t,
  http: {
    requestJson: async () => { throw new DictionaryError('HTTP 404', 'HTTP_404', false); },
    requestText: async () => ({ ok: false, status: 404, text: '' }),
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  },
  lookupCache: {
    get: (key) => disk.get(key) || null,
    set: (key, value, savedAt) => {
      disk.set(key, { value, savedAt });
    },
  },
});

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  // 1. Only fetched results ('ok' and confirmed 'empty') are stored in src-bucket:v2:<word>;
  // failed sources are never cached and retry immediately on the next lookup.
  let freeDictCount = 0;
  let wiktCount = 0;
  let datamuseCount = 0;
  let translateCount = 0;
  let freeDictShouldFail = true;
  let translateShouldFail = true;

  const wireMocks = (svc) => {
    svc.getFreeDictionaryData = async () => {
      freeDictCount += 1;
      if (freeDictShouldFail) throw new DictionaryError('502 Bad Gateway', 'HTTP_502', true);
      return {
        definitions: [{ partOfSpeech: 'noun', meaning: 'Recovered definition.', source: 'Free Dictionary API' }],
        pronunciations: [
          { ipa: '/rɪˈkʌv/', accent: 'us', source: 'Free Dictionary API' },
          { ipa: '/rɪˈkʌv/', accent: 'uk', source: 'Free Dictionary API' },
        ],
      };
    };
    svc.getWiktionaryData = async () => {
      wiktCount += 1;
      return {
        definitions: [{ partOfSpeech: 'noun', meaning: 'Wiktionary sense.', source: 'Wiktionary' }],
        pronunciations: [
          { ipa: '/rɪˈkʌv/', accent: 'us', source: 'Wiktionary' },
          { ipa: '/rɪˈkʌv/', accent: 'uk', source: 'Wiktionary' },
        ],
      };
    };
    // Confirmed 404 -> returns empty (no error) -> stored as status: 'empty'.
    svc.getDatamuseData = async () => {
      datamuseCount += 1;
      return { definitions: [], synonyms: [] };
    };
    svc.getBestTranslation = async () => {
      translateCount += 1;
      if (translateShouldFail) return null;
      return { text: '恢复', language: 'zh', source: 'MyMemory' };
    };
  };

  const svc = new DictionaryService();
  wireMocks(svc);

  const settle = (inst, word) =>
    new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Lookup timed out for ${word}`)), 2000);
      let latest;
      inst
        .lookup(word, 'zh', ['Free Dictionary API', 'Wiktionary', 'Datamuse'], {
          skipEtymology: true,
          sourceLanguage: 'en',
          onUpdate: (r) => {
            latest = r;
            if (!r.metadata.pendingTranslation && !r.metadata.pendingPronunciation) {
              clearTimeout(deadline);
              resolve(r);
            }
          },
        })
        .then((initial) => {
          if (!initial.metadata.pendingTranslation && !initial.metadata.pendingPronunciation) {
            clearTimeout(deadline);
            resolve(initial);
          }
        }, (err) => {
          clearTimeout(deadline);
          reject(err);
        });
      void latest;
    });

  // First lookup: FreeDict fails, Translation fails, Wiktionary ok, Datamuse confirmed empty.
  const first = await settle(svc, 'retryable');
  assert.ok(first.definitions.some((d) => d.source === 'Wiktionary'));
  assert.ok(!first.definitions.some((d) => d.source === 'Free Dictionary API'));
  assert.equal(first.translations.length, 0);
  await flushMicrotasks();

  const bucketAfterFirst = disk.get('src-bucket:v2:retryable')?.value;
  assert.ok(bucketAfterFirst && bucketAfterFirst.v === 2, 'word bucket exists in store');
  assert.equal(bucketAfterFirst.sources['wiktionary:retryable']?.status, 'ok');
  assert.equal(bucketAfterFirst.sources['datamuse:retryable']?.status, 'empty');
  assert.equal(bucketAfterFirst.sources['freeDictionary:retryable'], undefined, 'failed source must NOT be cached');
  assert.equal(
    bucketAfterFirst.sources['translation:auto:en->zh:retryable'],
    undefined,
    'failed translation must NOT be cached',
  );

  // Repeated failures (5x) must never trigger any host-level backoff/skip.
  for (let i = 0; i < 4; i += 1) {
    await settle(svc, 'retryable');
  }
  assert.equal(freeDictCount, 5, 'failed FreeDict retried on every single lookup');
  assert.equal(translateCount, 5, 'failed translation retried on every single lookup');
  assert.equal(wiktCount, 1, 'healthy Wiktionary remained cached across all 5 lookups');
  assert.equal(datamuseCount, 1, 'confirmed empty Datamuse remained cached across all 5 lookups');

  // Recover both failed sources right away and verify immediate pickup on next lookup.
  freeDictShouldFail = false;
  translateShouldFail = false;
  const recovered = await settle(svc, 'retryable');
  assert.ok(recovered.definitions.some((d) => d.source === 'Free Dictionary API'), 'recovered FreeDict included');
  assert.equal(recovered.translations[0]?.text, '恢复', 'recovered translation included');
  assert.equal(freeDictCount, 6);
  assert.equal(translateCount, 6);
  assert.equal(wiktCount, 1);
  assert.equal(datamuseCount, 1);
  await flushMicrotasks();

  const bucketAfterRecover = disk.get('src-bucket:v2:retryable')?.value;
  assert.equal(bucketAfterRecover.sources['freeDictionary:retryable']?.status, 'ok');
  assert.equal(bucketAfterRecover.sources['translation:auto:en->zh:retryable']?.status, 'ok');

  // Restart service: everything comes from disk bucket with zero network calls.
  const restarted = new DictionaryService();
  wireMocks(restarted);
  const cached = await restarted.lookup('retryable', 'zh', ['Free Dictionary API', 'Wiktionary', 'Datamuse'], {
    skipEtymology: true,
    sourceLanguage: 'en',
  });
  assert.ok(cached.definitions.some((d) => d.source === 'Free Dictionary API'));
  assert.ok(cached.definitions.some((d) => d.source === 'Wiktionary'));
  assert.equal(cached.translations[0]?.text, '恢复');
  assert.equal(cached.metadata.pendingTranslation, false);
  assert.equal(freeDictCount, 6);
  assert.equal(wiktCount, 1);
  assert.equal(datamuseCount, 1);
  assert.equal(translateCount, 6);

  console.log('Unified per-source cache passed: only ok/empty saved, failures retry immediately without host backoff.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
