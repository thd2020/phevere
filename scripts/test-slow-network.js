/**
 * Lookups on a slow connection (packages/core/src/net.ts and dictionary.ts): with every request
 * taking two to three seconds, and some never answering, a lookup still opens the entry it opens
 * on a fast network. Pictures on a slow network are checked in scripts/test-sense-images.js, and
 * the numbers for a word-book sample come from scripts/measure-lookups.js.
 *
 * Run: node scripts/test-slow-network.js   (--core <dir> runs it against another packages/core/src)
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { withLatency } = require('./latency-http');

const coreArg = process.argv.indexOf('--core');
const coreDir = coreArg > 0 ? path.resolve(process.argv[coreArg + 1]) : path.join(__dirname, '../packages/core/src');
const compiled = esbuild.buildSync({
  entryPoints: [path.join(coreDir, 'index.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  nodePaths: [path.join(__dirname, '../node_modules')],
  external: ['cmu-pronouncing-dictionary'],
}).outputFiles[0].text;
const script = new vm.Script(compiled);

/** A fresh copy of core (an app start) on a fake network whose answers come from `rest` and `free`. */
function app(net) {
  const mod = { exports: {} };
  script.runInContext(vm.createContext({
    module: mod, exports: mod.exports, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    require: (name) => (name === 'cmu-pronouncing-dictionary' ? { dictionary: {} } : require(name)),
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Date, Error, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Intl,
  }));
  const core = mod.exports;
  const notFound = () => new core.DictionaryError('HTTP 404', 'HTTP_404', false);
  const answer = (u) => {
    if (u.hostname === 'en.wiktionary.org' && u.pathname.startsWith('/api/rest_v1/page/definition/')) {
      const title = decodeURIComponent(u.pathname.slice('/api/rest_v1/page/definition/'.length));
      if (rest[title]) return JSON.parse(JSON.stringify(rest[title]));
      throw notFound();
    }
    if (u.hostname === 'api.dictionaryapi.dev') {
      const w = decodeURIComponent(u.pathname.split('/').pop());
      if (free[w]) return JSON.parse(JSON.stringify(free[w]));
      throw notFound();
    }
    if (u.hostname === 'en.wiktionary.org' && u.pathname === '/w/api.php') return { parse: { wikitext: { '*': '' } } };
    // WordNet's sense, through Datamuse, which the lookup gives two and a half seconds on a normal network.
    if (u.hostname === 'api.datamuse.com' && u.searchParams.get('sp') === 'cat' && u.searchParams.get('md') === 'dr') {
      return [{ word: 'cat', defs: ['n\tA spiteful woman gossip.'] }];
    }
    if (u.hostname === 'api.datamuse.com') return [];
    throw notFound();
  };
  const fake = {
    requestJson: async (url) => answer(new URL(url)),
    requestText: async (url) => {
      try {
        return { ok: true, status: 200, text: JSON.stringify(answer(new URL(url))) };
      } catch {
        return { ok: false, status: 404, text: '' };
      }
    },
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  };
  const slow = withLatency(fake, { ...net, errorClass: core.DictionaryError });
  core.configureCore({ sha256Hex: (t) => t, http: slow.http, lookupCache: { get: () => null, set: () => {} } });
  return { core, service: new core.DictionaryService(), net: slow };
}

const rest = {
  cat: { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'A small domesticated carnivorous mammal.' }] }] },
  'etc.': { en: [{ partOfSpeech: 'Phrase', language: 'English', definitions: [{ definition: 'Abbreviation of <i>et cetera</i> (“and so on”).' }] }] },
  etc: { en: [{ partOfSpeech: 'Phrase', language: 'English', definitions: [{ definition: '<span class="form-of-definition">Alternative form of <a href="/wiki/etc.">etc.</a></span>' }] }] },
  hello: { en: [{ partOfSpeech: 'Interjection', language: 'English', definitions: [{ definition: 'A greeting said when meeting someone.' }] }] },
};
const free = {
  cat: [{ word: 'cat', phonetics: [], meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A feline animal kept as a pet.' }] }] }],
};

const senses = (r) => (r.definitions || []).filter((d) => d.source !== 'Fallback' && d.source !== 'Timeout').map((d) => d.meaning);

const cases = {
  // Every request two and a half to three seconds: the dictionaries answer after the first
  // paint's usual wait. The lookup waits for them instead of calling the word unknown.
  async 'definitions at 3 s a request'() {
    let latest = null;
    const cat = await app({ delay: [2500, 3000], seed: 'cat' }).service.lookup('cat', 'zh', undefined, { onUpdate: (r) => (latest = r) });
    assert.ok(senses(cat).length >= 2, `cat on a slow network keeps its senses (${JSON.stringify(senses(cat))})`);
    assert.ok(!cat.metadata.suggestions, 'and offers no "Did you mean"');
    // Datamuse gets two and a half seconds on a normal network; the lookup's first answers show
    // the connection is slow, so its budget grows and its sense arrives too.
    const gossip = (r) => !!r && senses(r).some((m) => /gossip/.test(m));
    for (let i = 0; i < 50 && !gossip(cat) && !gossip(latest); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.ok(gossip(cat) || gossip(latest), "Datamuse's sense arrives at 3 s as well");
  },
  // A comma is still not part of the word.
  async '"hello," at 2 s'() {
    const hello = await app({ delay: [1900, 2100], seed: 'hello' }).service.lookup('hello,', 'zh');
    assert.equal(hello.word, 'hello', '"hello," opens hello');
  },
  // A hung request is answered by its backup a round trip later, not after its whole timeout,
  // and the backup never makes more than three requests open to one host.
  async 'a hung request'() {
    const hung = app({ delay: [200, 300], hang: 1, hangOnly: (url, n) => n === 1 && url.includes('dictionaryapi'), seed: 'hang' });
    const started = Date.now();
    let feline = 0;
    const seen = (r) => {
      if (!feline && senses(r).some((m) => /feline/.test(m))) feline = Date.now() - started;
    };
    seen(await hung.service.lookup('cat', 'zh', undefined, { onUpdate: seen }));
    while (!feline && Date.now() - started < 9000) await new Promise((r) => setTimeout(r, 100));
    assert.ok(feline, 'the Free Dictionary sense arrives through the backup request');
    assert.ok(feline < 5000, `a round trip after the backup went out (${feline} ms; the request's timeout is 6 s)`);
    for (const [host, n] of Object.entries(hung.net.maxInFlight)) assert.ok(n <= 3 || !/wik/.test(host), `${host}: ${n} in flight`);
  },
  // The adaptive budgets: a host answering in two seconds stretches a budget of one and a half.
  async 'budgets follow the round trip'() {
    const { core } = app({});
    const after = (ms) => ({ requestJson: () => new Promise((r) => setTimeout(() => r({}), ms)), requestText: async () => ({}), requestBytes: async () => ({}) });
    assert.equal(core.budgetMs(1500, 'example.org'), 1500, 'no round trips yet: the budget as set');
    await core.trackHttp(after(20)).requestJson('https://example.org/a');
    assert.equal(core.budgetMs(2500, 'example.org'), 2500, 'a fast host leaves the budget as set');
    await core.trackHttp(after(2000)).requestJson('https://slow.example.org/a');
    assert.ok(core.budgetMs(1500, 'slow.example.org') >= 2000, 'a two-second host stretches it past two seconds');
  },
};

// Wiktionary answers nothing at all (blocked, or its address resolves to nowhere) while the other
// dictionaries answer at once. A word with a comma waits for the exact-title check only a few of
// the typical round trips, and a word no dictionary knows still ends as no definitions.
// These run after the cases above, so their copies of core do not hold up the others' timers.
const dead = {};
const wiktionaryDown = (seed) => ({ delay: [150, 250], hang: 1, hangOnly: (url) => url.includes('wiktionary.org'), seed });
dead['"cat," with Wiktionary down'] = async () => {
  const started = Date.now();
  const cat = await app(wiktionaryDown('down-a')).service.lookup('cat,', 'zh');
  const took = Date.now() - started;
  assert.equal(cat.word, 'cat', '"cat," opens cat');
  assert.ok(senses(cat).some((m) => /feline/.test(m)), 'with the Free Dictionary sense');
  assert.ok(took < 9000, `the exact-title check gives up a few round trips in (${took} ms; each request's timeout and backup take 9 s)`);
};
dead['a word nobody knows with Wiktionary down'] = async () => {
  const started = Date.now();
  const r = await app(wiktionaryDown('down-b')).service.lookup('qwzxv', 'zh');
  const took = Date.now() - started;
  assert.ok(!r.metadata.timedOut, `ends as no definitions, not "Lookup timed out" (${took} ms)`);
  assert.ok(took < 10000, `within ten seconds (${took} ms)`);
};
// Nothing answers at all (Wi-Fi without internet). Before any host has answered, the guess at the
// round trip grows with the wait but stops at three seconds, so a budget asked again keeps its end.
dead['budgets on a connection that answers nothing'] = async () => {
  const { core } = app({});
  const dead = { requestJson: (url, o) => new Promise((_, reject) => setTimeout(() => reject(new core.DictionaryError('timed out', 'TIMEOUT', true)), o.timeoutMs)), requestText: async () => ({}), requestBytes: async () => ({}) };
  core.trackHttp(dead).requestJson('https://nowhere.example.org/a', { timeoutMs: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 6000));
  const b = core.budgetMs(1500, 'unseen.example.org');
  assert.ok(b <= 3000, `six seconds into a request nobody answers, a 1.5 s budget is ${b} ms`);
};
// A host's first answer only brings a waiting backup forward. A first answer of 2.5 s gives an RTO
// of 7.5 s; a hung request beside it still gets its backup three seconds in, not 7.5.
dead['a slow first answer and a hung neighbour'] = async () => {
  const { core } = app({});
  let n = 0;
  const http = core.trackHttp({
    requestJson: (url, o) => {
      n += 1;
      if (url.endsWith('/a')) return new Promise((r) => setTimeout(() => r('a'), 2500));
      if (n === 2) return new Promise((_, reject) => setTimeout(() => reject(new core.DictionaryError('timed out', 'TIMEOUT', true)), o.timeoutMs));
      return new Promise((r) => setTimeout(() => r('b'), 2000));
    },
    requestText: async () => ({}),
    requestBytes: async () => ({}),
  });
  const started = Date.now();
  const [, b] = await Promise.all([http.requestJson('https://first.example.org/a', { timeoutMs: 10000 }), http.requestJson('https://first.example.org/b', { timeoutMs: 10000 }).catch((e) => e.message)]);
  const took = Date.now() - started;
  assert.equal(b, 'b', 'the hung request is answered by its backup');
  assert.ok(took < 7000, `three seconds and a round trip in (${took} ms)`);
};
// A request answered by its backup: the original answering late is not a round trip (Karn), or one
// hung request would put the host's next backups six seconds out.
dead['a late answer after its backup'] = async () => {
  const { core } = app({});
  let n = 0;
  const http = core.trackHttp({
    requestJson: () => {
      n += 1;
      const ms = n === 11 ? 5500 : 300;
      return new Promise((r) => setTimeout(() => r({}), ms));
    },
    requestText: async () => ({}),
    requestBytes: async () => ({}),
  });
  for (let i = 0; i < 10; i += 1) await http.requestJson('https://late.example.org/a');
  const before = core.rtoMs('late.example.org');
  await http.requestJson('https://late.example.org/b');
  await new Promise((r) => setTimeout(r, 6000));
  const after = core.rtoMs('late.example.org');
  assert.ok(after <= before + 200, `the host's RTO stays ${before} ms (now ${after} ms)`);
};

// "etc." is a title of its own; with Wiktionary two or three seconds away it is still opened as
// typed, and so it is when the first request for its page never answers.
const etcNets = {
  '2 s': { delay: [1900, 2100], seed: 'etc-a' },
  'a hang': { delay: [300, 500], hang: 1, hangOnly: (url, n) => n === 1 && url.endsWith('/definition/etc.'), seed: 'etc-b' },
  '3 s and hangs': { delay: [2500, 3000], hang: 1, hangOnly: (url, n) => n === 1 && url.includes('/definition/etc'), seed: 'etc-c' },
};
for (const [label, net] of Object.entries(etcNets)) {
  cases[`"etc." with ${label}`] = async () => {
    const etc = await app(net).service.lookup('etc.', 'zh');
    assert.equal(etc.word, 'etc.', `"etc." opens etc. (${label})`);
    assert.ok(!etc.metadata.formFrom, `and not as a form of etc (${label})`);
    assert.match(senses(etc)[0] || '', /et cetera/, `with its own sense (${label})`);
  };
}

(async () => {
  const t0 = Date.now();
  // Each case runs in its own copy of core, all of a batch at once.
  const failed = [];
  for (const batch of [cases, dead]) {
    const names = Object.keys(batch);
    const results = await Promise.allSettled(names.map((n) => batch[n]()));
    failed.push(...results.map((r, i) => [names[i], r]).filter(([, r]) => r.status === 'rejected'));
  }
  for (const [name, r] of failed) console.error(`FAIL ${name}: ${r.reason && r.reason.message}`);
  if (failed.length) process.exit(1);
  console.log(`Slow network passed in ${Math.round((Date.now() - t0) / 1000)} s: definitions arrive at 3 s a request, "etc." opens etc. with 2 to 3 s and hangs, a hung request is answered by its backup, a Wiktionary that answers nothing holds no lookup for long.`);
  // The service keeps safety-net timers for lookups; they would hold the process open.
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
