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

  // "i.e." is detected as Italian, but Wiktionary has an English entry: that one opens, and the
  // entry offers the other language, which opens on request (REST answer of 2026-11-06, shortened).
  rest['i.e.'] = {
    // The English key also holds Translingual entries (as for "run"); it is still called English.
    en: [
      { partOfSpeech: 'Adverb', language: 'English', definitions: [{ definition: 'That is, namely, in other words.' }] },
      { partOfSpeech: 'Symbol', language: 'Translingual', definitions: [{ definition: 'A sign used in texts.' }] },
      { partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'An instance of saying “i.e.”.' }] },
    ],
    it: [{ partOfSpeech: 'Adverb', language: 'Italian', definitions: [{ definition: 'abbreviation of isto es' }] }],
    other: [{ partOfSpeech: 'Adverb', language: 'Middle English', definitions: [{ definition: 'that is' }] }],
  };
  routes.json.unshift([(u) => u.hostname === 'translate.googleapis.com' && u.searchParams.get('q') === 'i.e.', () => [[['cioè', 'i.e.']], null, 'it']]);
  const ie = await new DictionaryService().lookup('i.e.', 'zh');
  assert.equal(ie.detectedLanguage, 'en', 'a word with an English entry opens in English');
  assert.match(ie.definitions[0].meaning, /That is/);
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(ie.languages), [{ code: 'en', name: 'English', current: true }, { code: 'it', name: 'Italian' }], 'the other language is offered; "other" is not a language');
  const ieIt = await new DictionaryService().lookup('i.e.', 'zh', undefined, { sourceLanguage: 'it' });
  assert.equal(ieIt.detectedLanguage, 'it');
  assert.match(ieIt.definitions[0].meaning, /isto es/, 'the Italian entry opens when asked for');
  assert.ok(!ieIt.definitions.some((d) => /That is/.test(d.meaning)), 'without the English senses');
  assert.deepEqual(plain(ieIt.languages.find((l) => l.current)), { code: 'it', name: 'Italian', current: true });

  // "savings": Wiktionary has only "plural of saving"; WordNet, through Datamuse, defines the plural
  // itself (both as answered on 2026-11-05). It keeps its own entry and its money sense comes first.
  rest.savings = { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: '<span class="form-of-definition">plural of <a href="/wiki/saving">saving</a></span>' }] }] };
  kaikki.savings = { word: 'savings', lang_code: 'en', pos: 'noun', senses: [{ tags: ['form-of', 'plural'], form_of: [{ word: 'saving' }], glosses: ['plural of saving'] }] };
  routes.json.unshift([
    (u) => u.hostname === 'api.datamuse.com' && u.pathname === '/words' && u.searchParams.get('sp') === 'savings',
    () => [{ word: 'savings', tags: ['f:30.1'], defs: ['n\ta fund of money put by as a reserve'] }],
  ]);
  const savings = await new DictionaryService().lookup('savings', 'zh');
  assert.equal(savings.word, 'savings', 'a plural with a sense of its own keeps its entry');
  const senses = savings.definitions.map((d) => d.meaning);
  assert.match(senses[0], /fund of money/, 'its own sense first');
  const plural = senses.findIndex((m) => /plural of/.test(m));
  assert.ok(plural > 0, `"plural of saving" after it (${senses.join(' | ')})`);

  // "Mr" is spelt with its capital: "mr" in English is only Marathi's code and millirem (Wiktionary,
  // 2026-11-05). "State" at the start of a sentence is still state, which is a word of its own.
  const formOf = (lemma) => `<span class="form-of-definition use-with-mention">Abbreviation of <a href="/wiki/${lemma}">${lemma}</a>.</span>`;
  rest['Mr.'] = { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: formOf('Mister') }] }] };
  rest.Mr = { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: formOf('Mister') }, { definition: formOf('March') }] }] };
  rest.mr = {
    en: [
      { partOfSpeech: 'Symbol', language: 'English', definitions: [{ definition: 'ISO 639-1 language code for Marathi.' }] },
      { partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: formOf('millirem') }] },
    ],
  };
  rest.State = { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'A political entity that regulates society.' }] }] };
  rest.state = { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'A condition; a set of circumstances.' }] }] };
  const caps = new DictionaryService();
  const mr = await caps.lookup('Mr.', 'zh');
  assert.equal(mr.word, 'Mr', '"Mr." keeps its capital');
  assert.match(mr.definitions[0].meaning, /Mister/, 'and opens with mister, not the language code');
  assert.ok(!mr.definitions.some((d) => /Marathi/.test(d.meaning)), '"mr" is another word');
  const state = await caps.lookup('State', 'zh');
  assert.equal(state.word, 'state', 'a capital at the start of a sentence still folds');

  // "U.K." is asked for as typed: Wiktionary has no page "u.k." (2026-11-05).
  rest['U.K.'] = { en: [{ partOfSpeech: 'Proper noun', language: 'English', definitions: [{ definition: 'Initialism of <a href="/wiki/United_Kingdom">United Kingdom</a>.' }] }] };
  const uk = await new DictionaryService().lookup('U.K.', 'zh');
  assert.equal(uk.word, 'U.K.');
  assert.match(uk.definitions[0].meaning, /United Kingdom/, 'the typed title is the page asked for');

  // A misspelling still opens its word when the page also has another sense: moving form-of
  // senses last must not move "Misspelling of" away from the top.
  rest.accomodate = {
    en: [
      {
        partOfSpeech: 'Verb',
        language: 'English',
        definitions: [
          { definition: '<span class="form-of-definition">Misspelling of <a href="/wiki/accommodate">accommodate</a>.</span>' },
          { definition: '(Scotland) <a href="/wiki/accommodated">accommodated</a>' },
        ],
      },
    ],
  };
  rest.accommodate = { en: [{ partOfSpeech: 'Verb', language: 'English', definitions: [{ definition: 'To provide housing for.' }] }] };
  const fixed = await new DictionaryService().lookup('accomodate', 'zh');
  assert.equal(fixed.word, 'accommodate', 'a misspelling opens its word');
  console.log('Lookup entry passed: "Did you mean" stays through later updates; "etc.", "e.g." and "C++" open as typed; "hello,", "no." and "it." open hello, no and it; "i.e." opens in English and in Italian on request.');
  // The service keeps safety-net timers for lookups; they would hold the process open.
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
