/**
 * Picture loading on an unsteady connection:
 *
 * - packages/core/src/picture-load.ts: a picture whose request fails is asked for again and shows
 *   once it loads; one that fails every try comes through the app's HTTP client as a blob URL;
 *   one that fails that too is reported as failed and not asked for again at once, unless a
 *   card asks again on purpose. At most 48 blob URLs are kept; older ones are revoked.
 * - packages/core/src/net.ts: a request still waiting for one of its host's slots is dropped when
 *   nobody wants it any more, holds no slot and leaves the host's round trips alone.
 * - packages/core/src/sense-images.ts: a card that scrolls away (its signal aborted) sends none of
 *   its queued requests, and the next card for that word asks again instead of reusing the
 *   cut-short result. A card asking again after a failed search builds the failed pool again.
 *
 * Run: node scripts/test-picture-loading.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const src = (name) => path.join(__dirname, '..', 'packages', 'core', 'src', name);
const transpile = (name) =>
  ts.transpileModule(fs.readFileSync(src(name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

function loadModule(name, imports, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(transpile(name), {
    module: mod,
    exports: mod.exports,
    require: (n) => (n in imports ? imports[n] : require(n)),
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    Intl,
    console: { ...console, warn: () => {} },
    ...globals,
  });
  return mod.exports;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** An image element whose loads fail while `fail(url)` says so. */
function fakeImage(fail) {
  return class {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 0;
      this.complete = false;
    }
    decode() {
      return Promise.resolve();
    }
    set src(url) {
      this._src = url;
      setTimeout(() => {
        if (fail(url)) return this.onerror && this.onerror();
        this.naturalWidth = 330;
        this.complete = true;
        if (this.onload) this.onload();
      }, 5);
    }
    get src() {
      return this._src;
    }
  };
}

async function pictureRetries() {
  const tries = new Map();
  const Image = fakeImage((url) => {
    const n = (tries.get(url) || 0) + 1;
    tries.set(url, n);
    return /flaky/.test(url) ? n <= 2 : /dead/.test(url);
  });
  const bytesAsked = [];
  const runtime = {
    isCoreConfigured: () => true,
    getHttp: () => ({
      requestBytes: async (url) => {
        bytesAsked.push(url);
        if (/gone/.test(url)) throw new Error('timed out');
        return { ok: true, status: 200, bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' };
      },
    }),
  };
  let blobs = 0;
  const URLWithBlobs = Object.assign(function () {}, { createObjectURL: () => `blob:picture-${++blobs}` });
  const pl = loadModule('picture-load.ts', { './runtime': runtime }, { Image, Blob: class {}, URL: URLWithBlobs });

  // Fails twice, then loads: shown from its own URL after the third try (about four seconds).
  const t0 = Date.now();
  assert.equal(await pl.loadPicture('https://upload.example/flaky.jpg'), 'https://upload.example/flaky.jpg');
  assert.equal(tries.get('https://upload.example/flaky.jpg'), 3, 'asked three times');
  assert.ok(Date.now() - t0 >= 3900, 'waits one and then three seconds between tries');
  assert.equal(pl.pictureSrc('https://upload.example/flaky.jpg'), 'https://upload.example/flaky.jpg', 'a repaint shows it at once');
  assert.equal(bytesAsked.length, 0, 'the HTTP client is not needed when the image loads');

  // Fails every try with an image element: the bytes come through the app's HTTP client.
  const dead = 'https://upload.example/dead.jpg';
  const both = [pl.loadPicture(dead), pl.loadPicture(dead)];
  const [a, b] = await Promise.all(both);
  assert.equal(a, 'blob:picture-1');
  assert.equal(b, a, 'two figures for one picture share one load');
  assert.equal(tries.get(dead), 3);
  assert.deepEqual(bytesAsked, [dead]);

  // Fails that too: reported as failed, and not asked for again straight away.
  const gone = 'https://upload.example/dead-gone.jpg';
  assert.equal(await pl.loadPicture(gone), null);
  const before = tries.get(gone);
  assert.equal(await pl.loadPicture(gone), null);
  assert.equal(tries.get(gone), before, 'a picture that failed every try waits a minute before the next');
  // A card asking again does not wait out that minute.
  assert.equal(await pl.loadPicture(gone, { again: true }), null);
  assert.equal(tries.get(gone), before + 3, 'a deliberate second ask reaches the network again');
}

async function blobsBounded() {
  const Image = fakeImage((url) => !url.startsWith('blob:'));
  const runtime = {
    isCoreConfigured: () => true,
    getHttp: () => ({ requestBytes: async () => ({ ok: true, status: 200, bytes: new Uint8Array([1]), contentType: 'image/png' }) }),
  };
  let made = 0;
  const revoked = new Set();
  const URLWithBlobs = Object.assign(function () {}, {
    createObjectURL: () => `blob:p-${++made}`,
    revokeObjectURL: (u) => revoked.add(u),
  });
  // Retries wait 1 s and 3 s; a test of sixty pictures runs them all at once.
  const pl = loadModule('picture-load.ts', { './runtime': runtime }, { Image, Blob: class {}, URL: URLWithBlobs });
  const urls = Array.from({ length: 60 }, (_, i) => `https://upload.example/b${i}.jpg`);
  const srcs = await Promise.all(urls.map((u) => pl.loadPicture(u)));
  assert.equal(srcs[59], 'blob:p-60');
  assert.equal(revoked.size, 60 - 48, 'only the newest 48 blob URLs are kept');
  assert.ok(revoked.has('blob:p-1') && !revoked.has('blob:p-60'), 'the oldest are revoked first');
  assert.equal(pl.pictureSrc(urls[0]), '', 'a revoked picture is loaded again on the next paint');
  assert.equal(pl.pictureSrc(urls[59]), 'blob:p-60');
  pl.clearPictureLoads();
  assert.equal(revoked.size, 60, 'clearing revokes the rest');
}

async function failedPoolAskedAgain() {
  const net = loadModule('net.ts', {});
  const sent = [];
  const inner = {
    requestJson: (url) => {
      sent.push(url);
      return Promise.reject(Object.assign(new Error('Request failed'), { code: 'NETWORK_ERROR' }));
    },
    requestText: async () => ({ ok: false, status: 404, text: '' }),
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  };
  const http = net.trackHttp(inner);
  const runtime = { isCoreConfigured: () => true, getHttp: () => http, getLookupCache: () => null };
  const si = loadModule('sense-images.ts', { './runtime': runtime, './net': net, './http': {} });
  const ask = (again) => si.fetchWordImage('kettle', { gloss: 'A vessel for boiling water.', pos: 'noun', again });
  assert.equal(await ask(false), null);
  const first = sent.length;
  assert.ok(first > 0);
  assert.equal(await ask(false), null);
  assert.equal(sent.length, first, 'a failed pool is reused for a few minutes');
  assert.equal(await ask(true), null);
  assert.ok(sent.length > first, 'a card asking again builds the failed pool again');
}

async function queuedRequestsDropped() {
  const net = loadModule('net.ts', {});
  const pending = [];
  const sent = [];
  const inner = {
    requestJson: (url) =>
      new Promise((resolve) => {
        sent.push(url);
        pending.push(() => resolve({ url }));
      }),
    requestText: async () => ({ ok: true, status: 200, text: '' }),
    requestBytes: async () => ({ ok: true, status: 200, bytes: new Uint8Array(), contentType: '' }),
  };
  const http = net.trackHttp(inner);
  const host = 'https://api.example';
  // One answered request gives the host a round trip.
  const first = http.requestJson(`${host}/warm`, { slot: 'first', hedge: false });
  await tick();
  pending.shift()();
  await first;
  const rto = net.rtoMs('api.example');
  assert.ok(rto > 0);
  // Three requests take the three slots; two more queue, one of them for a card that scrolls away.
  const open = [1, 2, 3].map((i) => http.requestJson(`${host}/busy${i}`, { slot: 'first', hedge: false }));
  let wanted = true;
  const card = http.requestJson(`${host}/card`, { slot: 'first', hedge: false, wanted: () => wanted }).then(
    () => 'answered',
    (e) => e.code,
  );
  const lookup = http.requestJson(`${host}/lookup`, { slot: 'first', hedge: false });
  await tick();
  assert.equal(net.inFlight('api.example'), 3);
  wanted = false;
  net.dropUnwanted();
  assert.equal(await card, 'CANCELLED', 'a queued request nobody wants fails as cancelled');
  assert.equal(net.rtoMs('api.example'), rto, 'a dropped request leaves the round trips alone');
  pending.shift()();
  await tick();
  assert.ok(sent.includes(`${host}/lookup`), 'the freed slot goes to the next wanted request');
  assert.ok(!sent.includes(`${host}/card`), 'the dropped request is never sent');
  assert.equal(net.inFlight('api.example'), 3);
  while (pending.length) pending.shift()();
  await Promise.all([...open, lookup]);
  assert.equal(net.inFlight('api.example'), 0, 'no slot is left taken');
}

async function cardScrolledAway() {
  const net = loadModule('net.ts', {});
  const sent = [];
  const hold = [];
  let holding = true;
  const inner = {
    requestJson: (url) =>
      new Promise((resolve, reject) => {
        sent.push(url);
        const answer = () => reject(Object.assign(new Error('HTTP 404'), { code: 'HTTP_404' }));
        if (holding) hold.push(answer);
        else answer();
      }),
    requestText: async () => ({ ok: false, status: 404, text: '' }),
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  };
  const http = net.trackHttp(inner);
  const runtime = { isCoreConfigured: () => true, getHttp: () => http, getLookupCache: () => null };
  const si = loadModule('sense-images.ts', { './runtime': runtime, './net': net, './http': {} });
  // Other requests fill every host's three slots, so the card's requests queue.
  const hosts = ['en.wiktionary.org', 'en.wikipedia.org', 'query.wikidata.org', 'commons.wikimedia.org'];
  const busy = hosts.flatMap((h) => [1, 2, 3].map((i) => http.requestJson(`https://${h}/busy${i}`, { slot: 'first', hedge: false }).catch(() => null)));
  await tick(30);
  const before = sent.length;
  const ctl = new AbortController();
  const card = si.fetchWordImage('kettle', { gloss: 'A vessel for boiling water.', pos: 'noun', signal: ctl.signal });
  await tick(30);
  ctl.abort();
  holding = false;
  while (hold.length) hold.shift()();
  assert.equal(await card, null);
  await Promise.all(busy);
  const kettle = (list) => list.filter((u) => /kettle/i.test(decodeURIComponent(u)));
  assert.equal(kettle(sent.slice(before)).length, 0, 'the card that scrolled away sent none of its queued requests');
  // The next card for the word asks again rather than reusing the cut-short result.
  const sentBefore = sent.length;
  await si.fetchWordImage('kettle', { gloss: 'A vessel for boiling water.', pos: 'noun' });
  assert.ok(kettle(sent.slice(sentBefore)).length > 0, 'the word is asked for again');
}

(async () => {
  await queuedRequestsDropped();
  await cardScrolledAway();
  await pictureRetries();
  await blobsBounded();
  await failedPoolAskedAgain();
  console.log('Picture loading passed: failed pictures are asked again and come through the HTTP client last, queued requests for cards scrolled away are dropped, the next card asks again, blob URLs are bounded, and a card asking again reaches the network.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
