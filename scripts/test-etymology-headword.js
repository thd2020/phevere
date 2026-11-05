/**
 * The Etymology tab shows a history only for the looked-up word itself, or for the same word
 * with other accents or case, never for a neighbour a source puts in its place. Offline, on
 * responses saved on 2026-11-04 (Etymonline's API for "coverness", Youdao's jsonapi for
 * "coverness" and "governess", Wiktionary's parse API for "don’t" and "coverness") and on
 * pages written to the same shape.
 *
 * Run: node scripts/test-etymology-headword.js
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
  setTimeout, clearTimeout, Date, Error, URL, URLSearchParams,
});
const { configureCore, DictionaryService } = fixture.exports;

const ok = (body) => ({ ok: true, status: 200, text: typeof body === 'string' ? body : JSON.stringify(body) });
const missing = { ok: false, status: 404, text: '' };

// Etymonline's API: a word it lacks comes back "replaced" by another ("coverness" by cover).
const etymonlineApi = {
  coverness: { data: { items: [{ id: 'etymonline_v_null', type: 0, thumbnail: false, replaced: 'cover', down_weight: false }] }, code: 200, message: 'success' },
  'café': { data: { items: [{ id: 'etymonline_v_null', type: 0, thumbnail: false, replaced: 'cafe', down_weight: false }] }, code: 200, message: 'success' },
  cafe: { data: { items: [{ vocabularies: [{ word: 'cafe', property: '(n.)', etymology_plain: '1802, "coffee-house," from French café "coffee."' }] }] }, code: 200 },
  cover: { data: { items: [{ vocabularies: [{ word: 'cover', property: '(v.)', etymology_plain: 'c. 1200, from Old French covrir "to cover, protect."' }] }] }, code: 200 },
};
// Etymonline's word pages, the fallback when the API does not answer.
const page = (word, text) =>
  `<html><head><link rel="canonical" href="https://www.etymonline.com/word/${encodeURIComponent(word)}"/></head>` +
  `<body><section class="prose-lg"><p>${text}</p></section></body></html>`;
// Youdao's jsonapi with the etym dictionary: nothing for "coverness"; "governess" names its word.
const youdao = {
  coverness: { input: 'coverness', meta: { input: 'coverness', guessLanguage: 'eng', isHasSimpleDict: '0', le: 'en', lang: 'eng', dicts: ['meta'] }, le: 'en', lang: 'eng' },
  governess: { input: 'governess', le: 'en', etym: { etyms: { zh: [{ source: '童理民', word: 'governess', value: 'govern, 管理。-ess, 表女性。用于指家庭女教师。', url: '', desc: '家庭女教师' }] }, word: 'governess' }, lang: 'eng' },
  // Written to the same shape: a block about another word.
  covreness: { input: 'covreness', le: 'en', etym: { etyms: { zh: [{ source: '有道', word: 'cover', value: '来自古法语 covrir，覆盖，遮蔽。' }] }, word: 'cover' }, lang: 'eng' },
};
// Wiktionary's parse API does not follow redirects; a missing page is an error.
const wiktionary = {
  'don’t': { parse: { title: 'don’t', pageid: 455725, wikitext: { '*': "#REDIRECT [[don't]]" } } },
  coverness: { error: { code: 'missingtitle', info: "The page you specified doesn't exist." } },
};

let apiDown = false;
const requested = [];
configureCore({
  sha256Hex: (text) => text,
  http: {
    requestText: async (url) => {
      requested.push(url);
      const u = new URL(url);
      if (u.hostname === 'www.etymonline.com' && u.pathname === '/api/etymology') {
        if (apiDown) return { ok: false, status: 503, text: '' };
        const hit = etymonlineApi[u.searchParams.get('word')];
        return ok(hit || { code: 10001, message: 'Resource does not exist' });
      }
      if (u.hostname === 'www.etymonline.com' && u.pathname.startsWith('/word/')) {
        const word = decodeURIComponent(u.pathname.slice('/word/'.length));
        // As if the site redirected a word it lacks to its neighbour, and the client followed.
        if (word === 'coverness') return ok(page('cover', 'c. 1200, from Old French covrir "to cover, protect."'));
        if (word === 'cafe') return ok(page('cafe', '1802, "coffee-house," from French café "coffee."'));
        return missing;
      }
      if (u.hostname === 'dict.youdao.com') {
        const hit = youdao[u.searchParams.get('q')];
        return hit ? ok(hit) : ok({ input: u.searchParams.get('q') });
      }
      return missing;
    },
    requestJson: async (url) => {
      requested.push(url);
      const u = new URL(url);
      if (u.hostname === 'en.wiktionary.org') return wiktionary[u.searchParams.get('page')] || wiktionary.coverness;
      return {};
    },
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  },
  lookupCache: { get: () => null, set: () => {} },
});

(async () => {
  const service = new DictionaryService();

  // Etymonline's API: "coverness" is not cover; "café" is cafe without the accent.
  assert.equal(await service.fetchEtymologyFromEtymonline('coverness'), undefined, 'no etymology of cover for coverness');
  assert.ok(requested.every((u) => !/word=cover$/.test(u)), 'the substitute is not even asked for');
  const cafe = await service.fetchEtymologyFromEtymonline('café');
  assert.match(cafe.text, /coffee-house/);

  // Etymonline's word page, when the API is down: a page about another word is a miss.
  apiDown = true;
  assert.equal(await service.fetchEtymologyFromEtymonline('coverness'), undefined, 'the page names cover, not coverness');
  assert.match((await service.fetchEtymologyFromEtymonline('cafe')).text, /coffee-house/, 'a page about the word itself still counts');
  apiDown = false;

  // Youdao: nothing for coverness; a block about another word is dropped; the word's own stays.
  assert.equal(await service.fetchEtymologyFromYoudao('coverness'), undefined);
  assert.equal(await service.fetchEtymologyFromYoudao('covreness'), undefined, 'a block naming cover is not covreness');
  assert.match(await service.fetchEtymologyFromYoudao('governess'), /\[童理民 · 中文\]\ngovern, 管理/);

  // Wiktionary: a missing page and a redirect page give no etymology of their own.
  assert.equal(await service.fetchEtymologyFromWikitext('coverness'), undefined);
  assert.equal(await service.fetchEtymologyFromWikitext('don’t'), undefined, 'a redirect is not followed to another page');

  // All sources together: the Etymology tab for coverness stays empty.
  assert.equal(await service.fetchEtymologyFromMultipleSources('coverness'), undefined);

  console.log('Etymology headword passed: Etymonline, Youdao and Wiktionary show no other word\'s history.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
