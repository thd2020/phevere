/**
 * Requests a scanned page's translation makes, through DictionaryService on a fake network
 * (packages/core/src/dictionary.ts translateBatch, packages/core/src/ocr-translate.ts): paragraphs
 * go to Google's list endpoint in groups, an answer that does not line up falls back to one
 * paragraph a request, a lookup's translation goes ahead of a scan's, and a scan stopped while
 * it waits sends nothing more.
 *
 * Run: node scripts/test-scan-translate-requests.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const compiled = esbuild.buildSync({
  stdin: {
    contents: "export * from './packages/core/src/index'; export * from './packages/core/src/ocr-translate';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  external: ['cmu-pronouncing-dictionary'],
}).outputFiles[0].text;
const mod = { exports: {} };
vm.runInNewContext(compiled, {
  module: mod, exports: mod.exports, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
  require: (name) => (name === 'cmu-pronouncing-dictionary' ? { dictionary: {} } : require(name)),
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Date, Error, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Intl,
});
const { configureCore, DictionaryService, DictionaryError, PageTranslation, translateUnits } = mod.exports;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Every request, with when it went out; `answer(url, init)` makes the reply. */
const sent = [];
let answer = () => {
  throw new DictionaryError('HTTP 404', 'HTTP_404', false);
};
configureCore({
  sha256Hex: (t) => t,
  lookupCache: { get: () => null, set: () => {} },
  http: {
    requestJson: async (url, init) => {
      sent.push({ url, init, at: Date.now() });
      return answer(new URL(url), init || {});
    },
    requestText: async () => ({ ok: false, status: 404, text: '' }),
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  },
});

/** Google's endpoints: the list one answers [translation, language] per q; the single one a sentence array. */
const google = ({ mangle } = {}) => async (u, init) => {
  if (u.hostname !== 'translate.googleapis.com') throw new DictionaryError('HTTP 404', 'HTTP_404', false);
  await sleep(5);
  if (u.pathname === '/translate_a/t') {
    const qs = new URLSearchParams(String(init.body || '')).getAll('q');
    const out = qs.map((q) => [`~${q}`, 'en']);
    return mangle ? out.slice(1) : out;
  }
  if (u.pathname === '/translate_a/single') {
    const q = u.searchParams.get('q');
    return [[[`~${q}`, q, null, null, 1]], null, 'en'];
  }
  throw new DictionaryError('HTTP 404', 'HTTP_404', false);
};

const units = (texts) => texts.map((text, index) => ({ index, text, lineIds: [index], area: { x: 0, y: 0, w: 1, h: 1, angle: 0 }, vertical: false, size: 1, pitch: 1, align: 'start' }));

// A long page: 150 sentences of an article and 50 short labels (menu items, table headings).
const labels = ['Office chairs', 'Standing desks', 'Monitor arms', 'Desk lamps', 'Filing cabinets', 'Whiteboards', 'Region', 'Revenue', 'Status', 'Growth'];
const page = [
  ...Array.from({ length: 150 }, (_, i) => `The river carried sand and gravel through the valley in the flood of year ${1900 + i}, and the banks were wider after it.`),
  ...Array.from({ length: 50 }, (_, i) => `${labels[i % labels.length]} ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ''}`),
];

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`not ok - ${name}\n  ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n  ') : e}`);
  }
}

(async () => {
  await test('a page of 200 paragraphs: a request a paragraph, plus language checks, before; a handful in groups now', async () => {
    answer = google();
    // Before: as the first version of Translate did it, one detectLanguage and one translateText a paragraph.
    const old = new DictionaryService();
    sent.length = 0;
    for (const t of page) {
      const from = await old.detectLanguage(t).catch(() => '');
      await old.translateText(t, 'zh', from || 'auto');
    }
    const before = sent.length;
    // Now: the run, through translateUnits and translateBatch.
    const svc = new DictionaryService();
    sent.length = 0;
    const run = new PageTranslation(units(page), 'zh', (texts, to, wanted) => translateUnits(svc, texts, to, { wanted }), () => {});
    await run.run();
    const after = sent.length;
    assert.strictEqual(run.done, 200);
    assert.ok(before >= 200, `before: ${before}`);
    assert.ok(after <= 20, `after: ${after}`);
    assert.ok(sent.every((r) => r.url.includes('/translate_a/t?') && r.init.method === 'POST'), 'only the list endpoint');
    console.log(`  200 paragraphs: ${before} requests before, ${after} now`);
  });

  await test('an answer that does not line up with the paragraphs falls back to one paragraph a request', async () => {
    answer = google({ mangle: true });
    const svc = new DictionaryService();
    sent.length = 0;
    const r = await translateUnits(svc, ['Office chairs', 'Standing desks', 'Desk lamps'], 'de');
    assert.strictEqual(JSON.stringify(r.map((x) => x && x.text)), JSON.stringify(['~Office chairs', '~Standing desks', '~Desk lamps']));
    assert.strictEqual(sent.filter((s) => s.url.includes('/translate_a/t?')).length, 1);
    assert.strictEqual(sent.filter((s) => s.url.includes('/translate_a/single')).length, 3);
  });

  await test("a lookup's translation goes ahead of a scan's", async () => {
    answer = async (u, init) => {
      await sleep(u.pathname === '/translate_a/single' ? 60 : 5);
      return google()(u, init);
    };
    const svc = new DictionaryService();
    sent.length = 0;
    const lookup = svc.translateText('Hello there, my friend', 'zh', 'en');
    await sleep(1);
    const scan = svc.translateBatch(['Office chairs', 'Desk lamps'], 'zh', { wanted: () => true });
    const [hit, batch] = await Promise.all([lookup, scan]);
    assert.ok(hit && batch && batch.length === 2);
    const single = sent.findIndex((s) => s.url.includes('/translate_a/single'));
    const list = sent.findIndex((s) => s.url.includes('/translate_a/t?'));
    assert.ok(single >= 0 && list > single, 'the scan waited');
    assert.ok(sent[list].at - sent[single].at >= 50, 'until the lookup had its answer');
  });

  await test('a scan stopped while it waits sends nothing more', async () => {
    answer = async (u, init) => {
      await sleep(40);
      return google()(u, init);
    };
    const svc = new DictionaryService();
    sent.length = 0;
    const lookup = svc.translateText('Hello there, my friend', 'zh', 'en');
    let wanted = true;
    const scan = svc.translateBatch(['Office chairs'], 'zh', { wanted: () => wanted });
    wanted = false;
    await lookup;
    await assert.rejects(scan, (e) => e && e.code === 'CANCELLED');
    assert.ok(!sent.some((s) => s.url.includes('/translate_a/t?')), 'never sent');
    // A run stopped part-way (Translate off, the view closed, the language changed) asks nothing more.
    answer = google();
    sent.length = 0;
    let run;
    const many = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} about rivers and the valleys they carve over many thousands of years.`);
    run = new PageTranslation(units(many), 'fr', (texts, to, w) => translateUnits(svc, texts, to, { wanted: w }), () => run.stop());
    await run.run();
    const atStop = sent.length;
    assert.ok(run.pending > 0 && atStop <= 2, `${atStop} sent, ${run.pending} left`);
    await sleep(30);
    assert.strictEqual(sent.length, atStop);
  });

  if (failures) {
    console.error(`\n${failures} failed`);
    process.exit(1);
  }
  console.log('\nscan-translate-requests: all passed');
})();
