// Wall-clock limits: a shared CI runner can lag a few hundred milliseconds behind the timers it is
// asked to keep, so its limits get a quarter more room. Budgets that are computed, not timed, keep theirs.
const SLACK = process.env.CI ? 1.25 : 1;
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

/**
 * A fresh copy of core (an app start) on a fake network whose answers come from `rest` and `free`.
 * `opts.pack`: an offline pack with these words. `opts.link`: `{ state }`, where state is 'up',
 * 'silent' (nothing answers: each request runs out its timeout) or 'refused' (each request fails
 * at once, as when no name resolves), or a function of the URL giving one of those. It is read
 * when a request's delay is over, so it can change while the test runs.
 */
function app(net, opts = {}) {
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
    if (u.hostname === 'translate.googleapis.com' && u.pathname === '/translate_a/single') return [[['你好，世界', u.searchParams.get('q'), null, null]], null, 'en'];
    if (u.hostname === 'translate.googleapis.com' && u.pathname === '/translate_a/t') return ['你好，世界'];
    if (u.hostname === 'api.mymemory.translated.net') return { responseStatus: 200, responseData: { translatedText: '你好世界' } };
    throw notFound();
  };
  const link = opts.link || { state: 'up' };
  const stateOf = (url) => (typeof link.state === 'function' ? link.state(url) : link.state);
  const reach = async (url, o) => {
    const state = stateOf(url);
    if (state === 'refused') throw new core.DictionaryError('Request failed: getaddrinfo ENOTFOUND', 'NETWORK_ERROR', true);
    if (state === 'silent') {
      await new Promise((r) => setTimeout(r, (o && o.timeoutMs) || 8000));
      throw new core.DictionaryError('Request failed: timed out', 'NETWORK_ERROR', true);
    }
    return answer(new URL(url));
  };
  const fake = {
    requestJson: (url, o) => reach(url, o),
    requestText: async (url, o) => {
      try {
        return { ok: true, status: 200, text: JSON.stringify(await reach(url, o)) };
      } catch (e) {
        if (e && e.code !== 'HTTP_404') throw e;
        return { ok: false, status: 404, text: '' };
      }
    },
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  };
  const slow = withLatency(fake, { ...net, errorClass: core.DictionaryError });
  const pack = opts.pack || {};
  core.configureCore({
    sha256Hex: (t) => t,
    http: slow.http,
    lookupCache: { get: () => null, set: () => {} },
    lookupOffline: async (hw) => (pack[hw] ? [{ headword: hw, language: 'en', pos: 'noun', definition: pack[hw], packId: 'wordnet', packName: 'WordNet' }] : []),
  });
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
  harbour: [{
    word: 'harbour',
    phonetics: [{ text: '/ˈhɑːbə/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/harbour-uk.mp3' }],
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A sheltered expanse of water.' }] }],
  }],
};
rest.harbour = { en: [{ partOfSpeech: 'Noun', language: 'English', definitions: [{ definition: 'A sheltered place for ships.' }] }] };
/** Numbers the cases measured, printed at the end. */
const measured = [];

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
    assert.ok(feline < 5000 * SLACK, `a round trip after the backup went out (${feline} ms; the request's timeout is 6 s)`);
    for (const [host, n] of Object.entries(hung.net.maxInFlight)) assert.ok(n <= 3 || !/wik/.test(host), `${host}: ${n} in flight`);
  },
  // The Free Dictionary, which carries the recording, answers two and a half to three seconds after
  // Wiktionary has painted the senses. A press on the speaker at first paint used to find no clip
  // and speak with the synthetic voice; it now waits for the clip, and a word that has none speaks
  // as soon as the dictionaries are in.
  async 'a press before the recording has come'() {
    const { core, service } = app({ delay: [2500, 3000], only: (url) => url.includes('dictionaryapi'), seed: 'harbour' });
    const started = Date.now();
    const first = await service.lookup('harbour', 'zh');
    const paintMs = Date.now() - started;
    assert.equal(core.recordedPronunciationUrls(first.pronunciations).length, 0, `no clip at first paint (${paintMs} ms)`);
    assert.ok(first.metadata.pendingPronunciation, 'and the result says more is coming');
    const pressed = Date.now();
    const urls = await core.awaitRecordings((onUpdate) => service.lookup('harbour', 'zh', undefined, { onUpdate }));
    const waitMs = Date.now() - pressed;
    assert.equal(urls.length, 1, 'the press gets the recording');
    assert.match(urls[0], /harbour-uk\.mp3$/);
    const cat = app({ delay: [2500, 3000], only: (url) => url.includes('dictionaryapi'), seed: 'cat' });
    const catPaint = await cat.service.lookup('cat', 'zh');
    const catPressed = Date.now();
    assert.equal((await cat.core.awaitRecordings((onUpdate) => cat.service.lookup('cat', 'zh', undefined, { onUpdate }))).length, 0, 'cat has no recording');
    const catMs = Date.now() - catPressed;
    assert.ok(catPaint.metadata.pendingPronunciation, 'cat also paints before its dictionaries are in');
    assert.ok(catMs < core.RECORDING_WAIT_MS, `a word with no recording does not wait out the limit (${catMs} ms)`);
    measured.push(`harbour: first paint ${paintMs} ms, recording ${waitMs} ms after the press; cat (no recording): voice ${catMs} ms after the press`);
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
  assert.ok(took < 9000 * SLACK, `the exact-title check gives up a few round trips in (${took} ms; each request's timeout and backup take 9 s)`);
};
dead['a word nobody knows with Wiktionary down'] = async () => {
  const started = Date.now();
  const r = await app(wiktionaryDown('down-b')).service.lookup('qwzxv', 'zh');
  const took = Date.now() - started;
  assert.ok(!r.metadata.timedOut, `ends as no definitions, not "Lookup timed out" (${took} ms)`);
  assert.ok(took < 10000 * SLACK, `within ten seconds (${took} ms)`);
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
  assert.ok(took < 7000 * SLACK, `three seconds and a round trip in (${took} ms)`);
};
// A host that was slow and then stops answering keeps its last RTO. A budget of several round
// trips to it still ends within half a minute; the lookup's deadline (seven) would be 105 s.
dead['budgets after a slow host stops answering'] = async () => {
  const { core } = app({});
  const http = core.trackHttp({ requestJson: () => new Promise((r) => setTimeout(() => r({}), 4000)), requestText: async () => ({}), requestBytes: async () => ({}) });
  await Promise.all([http.requestJson('https://was-slow.example.org/a', { timeoutMs: 20000, hedge: false }), http.requestJson('https://was-slow.example.org/b', { timeoutMs: 20000, hedge: false })]);
  const b = core.budgetMs(12000, 'was-slow.example.org', 7);
  assert.ok(core.rtoMs('was-slow.example.org') >= 8000, 'the host is slow');
  assert.ok(b <= 30000, `seven round trips to it are ${b} ms`);
};
// A slow host whose next request gets no answer at all (the VPN dropped) is not slow any more but
// silent: its budgets go back to those of a host that has not answered.
dead['a slow host that falls silent'] = async () => {
  const { core } = app({});
  let silent = false;
  const http = core.trackHttp({
    requestJson: (url, o) => new Promise((resolve, reject) => setTimeout(() => (silent ? reject(new core.DictionaryError('timed out', 'TIMEOUT', true)) : resolve({})), silent ? 50 : 4000)),
    requestText: async () => ({}),
    requestBytes: async () => ({}),
  });
  // Another slow host, not asked again after the connection dies.
  const hosts = ['silent.example.org', 'not-asked.example.org'];
  await Promise.all(hosts.flatMap((h) => ['a', 'b'].map((p) => http.requestJson(`https://${h}/${p}`, { timeoutMs: 20000, hedge: false }))));
  const slow = core.budgetMs(1500, 'silent.example.org', 2);
  silent = true;
  await http.requestJson('https://silent.example.org/c', { hedge: false }).catch(() => {});
  const after = core.budgetMs(1500, 'silent.example.org', 2);
  // One host failing while the other has not been asked says nothing about the other: it is
  // still slow, and a host never asked is taken to be like it (Wiktionary blocked, the rest slow).
  const oneDown = core.budgetMs(1500, 'never-asked.example.org', 2);
  assert.ok(slow >= 15000, `two round trips to the slow host: ${slow} ms`);
  assert.ok(after <= 6000, `and once it falls silent: ${after} ms`);
  assert.ok(oneDown >= 15000, `a host never asked, one host down: ${oneDown} ms`);
  // A second host failing too, with nothing answering since: the connection is silent, and the
  // slow round trips of the host not asked since are not taken as typical any more.
  await http.requestJson('https://other.example.org/d', { hedge: false }).catch(() => {});
  const unseen = core.budgetMs(1500, 'never-asked.example.org', 2);
  assert.ok(core.connectionSilent(), 'the connection counts as silent');
  assert.ok(unseen <= 6000, `a host never asked, after the silence: ${unseen} ms`);
  assert.ok(core.budgetMs(1500, 'not-asked.example.org', 2) <= 6000, 'nor the host that was slow before it');
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

// A connection that answers nothing at all (Wi-Fi without internet) right after the app starts,
// with the word in a downloaded pack: the pack's senses show about as fast as on a normal network,
// not after the waits a slow connection gets. The same for a word picked from a sentence ("hello,"),
// whose exact-title check runs beside the lookup.
const pack = { cat: 'A small feline (offline pack).', hello: 'A greeting (offline pack).', dog: 'A canine (offline pack).' };
const timedLookup = async (service, word, opts = {}) => {
  const started = Date.now();
  let first = 0;
  const seen = (r) => {
    if (!first && senses(r).some((m) => !/timed out/i.test(m))) first = Date.now() - started;
  };
  const r = await service.lookup(word, 'zh', undefined, { ...opts, onUpdate: seen });
  seen(r);
  return { r, first, took: Date.now() - started };
};
dead['an offline pack on a dead connection'] = async () => {
  const { r, first } = await timedLookup(app({}, { pack, link: { state: 'silent' } }).service, 'cat');
  assert.ok(senses(r).some((m) => /offline pack/.test(m)), 'the pack sense shows');
  assert.ok(first && first < 2500 * SLACK, `within two and a half seconds of an app start (${first} ms; 4.2.0 took 7 s)`);
};
dead['"hello," from a sentence, an offline pack, a dead connection'] = async () => {
  const { r, first } = await timedLookup(app({}, { pack, link: { state: 'silent' } }).service, 'hello,');
  assert.equal(r.word, 'hello', '"hello," opens hello');
  assert.ok(first && first < 3000 * SLACK, `within three seconds (${first} ms; 4.2.0 took 13 s)`);
};
// No pack: "No definitions found" comes once the connection is known to answer nothing. Right
// after an app start nothing has been measured, so that takes six seconds without an answer.
dead['no pack, a dead connection'] = async () => {
  const { r, took } = await timedLookup(app({}, { link: { state: 'silent' } }).service, 'cat');
  assert.ok(!senses(r).length && !r.metadata.timedOut, 'no definitions, not "Lookup timed out"');
  assert.ok(took < 8000 * SLACK, `within eight seconds (${took} ms; 4.2.0 took 16 s)`);
};
// A slow connection (two seconds a request) that then dies, as a VPN drops: the next lookup goes out
// with the slow connection's long timeouts, but the waits end once nothing answers on two hosts.
dead['the first lookup after a slow connection dies'] = async () => {
  const link = { state: 'up' };
  const { service } = app({ delay: [1900, 2100], seed: 'dies' }, { link });
  await service.lookup('cat', 'zh');
  await service.lookup('hello', 'zh');
  link.state = 'silent';
  const { took } = await timedLookup(service, 'dog');
  assert.ok(took < 8000 * SLACK, `the next word ends within eight seconds (${took} ms; 4.2.0 took 22 to 27 s)`);
};
// Phone offline (requests fail at once), two lookups, then back online: the sources are not
// skipped for minutes, so the next word has its definitions.
dead['back online after two failed lookups'] = async () => {
  const link = { state: 'refused' };
  const { service } = app({}, { link });
  await service.lookup('fish', 'zh');
  await service.lookup('dog', 'zh');
  link.state = 'up';
  const { r } = await timedLookup(service, 'cat');
  const all = senses(r);
  assert.ok(all.some((m) => /mammal/.test(m)) && all.some((m) => /feline/.test(m)), `Wiktionary and the Free Dictionary both answer (${JSON.stringify(all)})`);
};
// A word with a full stop that no dictionary knows, Wiktionary answering nothing, the others fast.
dead['"qwzxv." with Wiktionary down'] = async () => {
  const link = { state: (u) => (u.includes('wiktionary.org') ? 'silent' : 'up') };
  const { r, took } = await timedLookup(app({ delay: [150, 250], seed: 'qwzxv' }, { link }).service, 'qwzxv.');
  assert.ok(!senses(r).length && !r.metadata.timedOut, 'no definitions');
  assert.ok(took < 8000 * SLACK, `within eight seconds (${took} ms; 4.2.0 took 22 s)`);
};
// Quick translation with Google blocked (it answers nothing) and MyMemory two seconds away: the next
// engine starts a round trip in, and the translation after that starts with MyMemory.
dead['quick translation with Google blocked'] = async () => {
  const link = { state: (u) => (u.includes('translate.googleapis.com') ? 'silent' : 'up') };
  const { service } = app({ delay: [1900, 2100], seed: 'tx' }, { link });
  for (const [i, text] of ['Hello there, world', 'See you tomorrow'].entries()) {
    const started = Date.now();
    const hit = await service.translateText(text, 'zh', 'en', 'auto');
    const took = Date.now() - started;
    assert.equal(hit && hit.source, 'MyMemory', `MyMemory translates (${i + 1})`);
    assert.ok(took < (i ? 3000 : 6000) * SLACK, `translation ${i + 1} in ${took} ms (4.2.0: 17 s each)`);
  }
};
dead['quick translation when the chosen engine is down'] = async () => {
  const link = { state: (u) => (u.includes('mymemory') ? 'silent' : 'up') };
  const { service } = app({ delay: [300, 500], seed: 'tx2' }, { link });
  const hit = await service.translateText('Hello there, world', 'zh', 'en', 'mymemory');
  assert.ok(hit && /Google/.test(hit.source), `another engine answers (${hit && hit.source}; 4.2.0 gave nothing after 11 s)`);
};

// These run last, on their own, so their lookups do not slow the timed cases above.
const last = {};
// A link whose first answers take five seconds (a satellite link, a VPN setting up) is slow, not
// dead: right after an app start "etc." still opens etc. and "hello," keeps its sense.
last['a five-second link right after an app start'] = async () => {
  const net = (seed) => ({ delay: [4500, 5500], seed });
  const etc = await app(net('sat-etc')).service.lookup('etc.', 'zh');
  assert.equal(etc.word, 'etc.', '"etc." opens etc.');
  let latest = null;
  const hello = await app(net('sat-hello')).service.lookup('hello,', 'zh', undefined, { onUpdate: (r) => (latest = r) });
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(hello.word, 'hello', '"hello," opens hello');
  assert.ok(senses(latest || hello).some((m) => /greeting/.test(m)), `and keeps its sense (${JSON.stringify(senses(latest || hello))})`);
};
// Right after an app start on a slow connection, a word with marks ("U.S.", "C++", "hello,") is
// looked up beside its exact-title check. Wikimedia still never has more than three open at once.
last['three requests at most to Wiktionary on a slow cold start'] = async () => {
  for (const word of ['U.S.', 'C++', 'hello,', 'etc.']) {
    const { service, net } = app({ delay: [1000, 3000], hang: 0.05, seed: `cap-${word}` });
    await service.lookup(word, 'zh');
    await new Promise((r) => setTimeout(r, 4000));
    for (const [host, n] of Object.entries(net.maxInFlight)) assert.ok(n <= 3 || !/wik/.test(host), `${word}: ${host} had ${n} open`);
  }
};
// A source skipped because it fails while others answer stays skipped when some other host falls
// silent too (Google Translate blocked): only the whole connection answering again, or a network
// change, ends the skip.
last['a skip outlives another host falling silent'] = async () => {
  const link = { state: (u) => (u.includes('wiktionary.org') ? 'refused' : 'up') };
  const { core, service, net } = app({ delay: [100, 200], seed: 'skip' }, { link });
  await service.lookup('fish', 'zh');
  await service.lookup('dog', 'zh');
  const hung = core.trackHttp({ requestJson: () => new Promise(() => {}), requestText: async () => ({}), requestBytes: async () => ({}) });
  for (const p of ['a', 'b']) hung.requestJson(`https://blocked.example.org/${p}`, { hedge: false, timeoutMs: 60000 }).catch(() => {});
  for (let i = 0; i < 80 && !core.hostSilent('blocked.example.org'); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.ok(core.hostSilent('blocked.example.org'), 'the other host counts as silent');
  const before = net.log.filter((r) => r.url.includes('wiktionary.org')).length;
  await service.lookup('cat', 'zh');
  const after = net.log.filter((r) => r.url.includes('wiktionary.org')).length;
  assert.equal(after - before, 0, `Wiktionary is still skipped (${after - before} requests)`);
  core.noteNetworkChange();
  await service.lookup('cow', 'zh');
  assert.ok(net.log.filter((r) => r.url.includes('wiktionary.org')).length > after, 'and asked again after a network change');
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
  for (const batch of [cases, dead, last]) {
    const names = Object.keys(batch);
    const results = await Promise.allSettled(names.map((n) => batch[n]()));
    failed.push(...results.map((r, i) => [names[i], r]).filter(([, r]) => r.status === 'rejected'));
  }
  for (const [name, r] of failed) console.error(`FAIL ${name}: ${r.reason && r.reason.message}`);
  if (failed.length) process.exit(1);
  console.log(`Slow network passed in ${Math.round((Date.now() - t0) / 1000)} s: definitions arrive at 3 s a request, "etc." opens etc. with 2 to 3 s and hangs, a hung request is answered by its backup, a speaker pressed before the recording came gets the recording, a Wiktionary that answers nothing holds no lookup for long.`);
  for (const line of measured) console.log(`  ${line}`);
  // The service keeps safety-net timers for lookups; they would hold the process open.
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
