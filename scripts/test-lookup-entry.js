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

  // Edge punctuation stays when Wiktionary has a page with that exact title (its REST answers of
  // 2026-11-05, shortened): "etc." is a word, "hello," is not. "etc" is Wiktionary's
  // "Alternative form of etc.", so it opens etc.; no list of abbreviations decides any of it.
  const rest = {
    'etc.': { en: [{ partOfSpeech: 'Phrase', language: 'English', definitions: [{ definition: 'Abbreviation of <i>et cetera</i> (“and so on”).' }] }] },
    etc: { en: [{ partOfSpeech: 'Phrase', language: 'English', definitions: [{ definition: '<span class="form-of-definition">Alternative form of <a href="/wiki/etc.">etc.</a></span>' }] }] },
    hello: { en: [{ partOfSpeech: 'Interjection', language: 'English', definitions: [{ definition: 'A greeting said when meeting someone.' }] }] },
    'C++': { en: [{ partOfSpeech: 'Proper noun', language: 'English', definitions: [{ definition: 'A programming language derived from C.' }] }] },
    C: { en: [{ partOfSpeech: 'Letter', language: 'English', definitions: [{ definition: 'The third letter of the English alphabet.' }] }] },
    // A full stop after a word with a page of its own ends a sentence: "no." is no, though
    // Wiktionary also has "no." (number). "it." has pages only in other languages. "e.g." keeps
    // its last stop because the same mark is inside the word.
    'no.': { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'Alternative form of <a rel="mw:WikiLink" href="/wiki/No." title="No.">No.</a>' }] }] },
    'No.': { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'Abbreviation of <a rel="mw:WikiLink" href="/wiki/number" title="number">number</a>.' }] }] },
    no: {
      en: [
        {
          partOfSpeech: 'Determiner',
          language: 'English',
          definitions: [{ definition: 'Not any.' }, { definition: 'Not a.' }, { definition: 'Alternative form of <a rel="mw:WikiLink" href="/wiki/no." title="no.">no.</a>' }],
        },
      ],
    },
    'it.': { de: [{ partOfSpeech: 'Abbreviation', language: 'German', definitions: [{ definition: 'Abkürzung von italienisch' }] }] },
    it: { en: [{ partOfSpeech: 'Pronoun', language: 'English', definitions: [{ definition: 'The thing being discussed.' }] }] },
    'e.g.': { en: [{ partOfSpeech: 'Adverb', language: 'English', definitions: [{ definition: 'For example.' }] }] },
    "'em": { en: [{ partOfSpeech: 'Pronoun', language: 'English', definitions: [{ definition: 'Them.' }] }] },
    em: { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'The name of the Latin-script letter M.' }] }] },
    'e.g': { en: [{ partOfSpeech: 'Adverb', language: 'English', definitions: [{ definition: 'An initialism of exempli gratia.' }] }] },
  };
  const kaikki = {
    etc: { word: 'etc', lang_code: 'en', pos: 'phrase', senses: [{ tags: ['alt-of', 'alternative'], alt_of: [{ word: 'etc.' }], glosses: ['Alternative form of etc..'] }] },
  };
  routes.json.unshift([
    (u) => u.hostname === 'en.wiktionary.org' && u.pathname.startsWith('/api/rest_v1/page/definition/'),
    (u) => {
      const title = decodeURIComponent(u.pathname.slice('/api/rest_v1/page/definition/'.length));
      if (rest[title]) return rest[title];
      throw notFound();
    },
  ]);
  routes.text.push([
    (u) => u.hostname === 'kaikki.org',
    (u) => {
      const w = decodeURIComponent(u.pathname.split('/').pop().replace(/\.jsonl$/, ''));
      if (kaikki[w]) return JSON.stringify(kaikki[w]);
      throw notFound();
    },
  ]);
  const exact = new DictionaryService();
  const etc = await exact.lookup('etc.', 'zh');
  assert.equal(etc.word, 'etc.', '"etc." is looked up as typed');
  assert.match(etc.definitions[0].meaning, /et cetera/);
  const bare = await exact.lookup('etc', 'zh');
  assert.equal(bare.word, 'etc.', '"etc" opens the word it is another form of');
  assert.equal(bare.metadata.formFrom, 'etc');
  const hello = await exact.lookup('hello,', 'zh');
  assert.equal(hello.word, 'hello', 'a comma is not part of hello');
  const cpp = await exact.lookup('C++', 'zh');
  assert.equal(cpp.word, 'C++');
  assert.match(cpp.definitions[0].meaning, /programming language/, 'C++ is not the letter C');
  assert.equal((await exact.lookup('no.', 'zh')).word, 'no', '"no." at the end of a sentence is no');
  assert.equal((await exact.lookup('it.', 'zh')).word, 'it', 'a page with no English section is not the typed title');
  assert.equal((await exact.lookup('e.g.', 'zh')).word, 'e.g.', 'the last stop of e.g. belongs to it');
  assert.equal((await exact.lookup("'em", 'zh')).word, "'em", 'an apostrophe with a page of its own stays');
  console.log('Lookup entry passed: "Did you mean" stays through later updates; "etc.", "e.g." and "C++" open as typed; "hello,", "no." and "it." open hello, no and it.');
  // The service keeps safety-net timers for lookups; they would hold the process open.
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
