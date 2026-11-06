/* Run: node scripts/test-speech-stream.js. Long-text speech: sentence chunks, one chunk ahead, cancellation. */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
function load(file, requireFn) {
  const code = esbuild.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: requireFn, console, process, Buffer, setTimeout, clearTimeout,
    setImmediate, AbortController, Promise, Error, Intl, Uint8Array, Map, Set, WeakMap, Object, Number, String, Math, Array, JSON,
    __dirname: path.join(root, 'src', 'services'),
  });
  return module.exports;
}

const { splitSpeechText } = load('packages/core/src/speech-chunks.ts', require);

// ---- splitting ----
const PARA = 'The committee met on Tuesday to review the proposal for the new library. Several members raised concerns about the cost, which had risen sharply since the first estimate was published last spring. Others argued that the town\'s residents had waited long enough. After a long discussion, the chair suggested a compromise. The vote was close, but the motion passed. Work is expected to begin early next year.';
{
  const chunks = splitSpeechText(PARA);
  assert.equal(chunks[0], 'The committee met on Tuesday to review the proposal for the new library.', 'first chunk is the first sentence');
  assert.ok(chunks.length >= 2 && chunks.length < 6, `sentences are grouped: ${chunks.length}`);
  for (const c of chunks.slice(1)) assert.ok(c.length <= 300, `chunk within limit: ${c.length}`);
  assert.equal(chunks.join(' '), PARA, 'no text is lost or reordered');
}
{
  const zh = '委员会周二开会审议新图书馆的建设方案。几位委员对费用表示担忧。投票结果很接近，但动议获得通过。';
  const chunks = splitSpeechText(zh);
  assert.equal(chunks[0], '委员会周二开会审议新图书馆的建设方案。');
  assert.equal(chunks.join(''), zh);
}
{
  const long = 'word '.repeat(200).trim() + '.';
  const chunks = splitSpeechText(long);
  assert.ok(chunks[0].length <= 160, 'a very long first sentence is cut for a quick start');
  for (const c of chunks) assert.ok(c.length <= 300);
  assert.equal(chunks.join(' '), long);
}
{
  // With growth, each chunk is at most 1.5 times the one before (floor 40), so it can
  // synthesize while the previous one plays.
  const zh = '委员会周二开会审议了新图书馆的建设方案和预算。几位委员认为费用自去年春天第一次估算以来上涨太快，另一些委员则认为镇上的居民已经等了很多年，旧阅览室又小又潮湿而且周末不开放，经过长时间讨论，主席提出先建一层的折中办法，最终以一票之差获得通过。';
  for (const [text, sep] of [[PARA + ' ' + PARA, ' '], [zh, '']]) {
    const chunks = splitSpeechText(text, { max: 300, growth: 1.5 });
    assert.equal(chunks.join(sep), text, 'no text is lost or reordered');
    for (let i = 1; i < chunks.length; i++) {
      assert.ok(chunks[i].length <= Math.max(40, Math.round(chunks[i - 1].length * 1.5)), `chunk ${i} grows gradually: ${chunks.map((c) => c.length)}`);
    }
  }
  assert.ok(splitSpeechText(zh, { max: 300, growth: 1.5 }).length >= 3, 'a long second sentence is split at clause marks');
  // A long first sentence keeps CJK text unspaced when its tail is carried over.
  const longZh = '这是一个很长的句子，'.repeat(20) + '结束。';
  assert.equal(splitSpeechText(longZh).join(''), longZh);
}
// The module runs in its own vm realm, so compare arrays as JSON.
assert.equal(JSON.stringify(splitSpeechText('  hello  ')), '["hello"]', 'a single word stays one chunk');
assert.equal(JSON.stringify(splitSpeechText('')), '[]');

// ---- streaming in the main process ----
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-speech-stream-'));
const sent = [];
let worker;
function fakeWorker() {
  const w = new EventEmitter();
  w.stderr = new EventEmitter();
  w.postMessage = (msg) => {
    sent.push(msg);
    w.inFlight = (w.inFlight || 0) + 1;
    assert.equal(w.inFlight, 1, 'the worker gets one synthesis job at a time');
    setTimeout(() => {
      w.inFlight--;
      w.emit('message', { id: msg.id, ok: true, wav: new Uint8Array([msg.id]) });
    }, 20);
  };
  w.kill = () => w.emit('exit');
  return w;
}
// The interface-text runtime speech.ts imports, bundled with the English catalogue it falls back to.
const i18nRuntime = (() => {
  const code = esbuild.buildSync({
    entryPoints: [path.join(root, 'packages/core/src/i18n/runtime.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false,
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, require);
  return module.exports;
})();
const speech = load('src/services/speech.ts', (name) => {
  if (name === '@phevere/core/i18n/runtime') return i18nRuntime;
  if (name === 'electron') {
    return {
      app: { getPath: () => userData },
      net: {},
      utilityProcess: { fork: () => (worker = fakeWorker()) },
    };
  }
  if (name === '@phevere/core') return { splitSpeechText, ipaToEspeakPhonemes: (x) => x, ipaToKokoroPhonemes: () => '' };
  if (name === '../logger') return { log: { warn() {}, info() {} } };
  if (name === 'fs' || name === 'path' || name === 'crypto' || name === 'stream' || name === 'stream/promises') return require(name);
  throw new Error(`unexpected require ${name}`);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const owner = 7;
  // No neural voice is installed here, so eSpeak gets large chunks after the first sentence.
  const LONG = [PARA, PARA, PARA, PARA, PARA, PARA, PARA, PARA, PARA].join(' ');
  const { id, count } = speech.startSpeechStream(owner, { text: LONG, lang: 'en' });
  const chunks = splitSpeechText(LONG, { max: 1500 });
  assert.ok(count >= 3, `long text gives several chunks: ${count}`);
  assert.equal(count, chunks.length);

  // Only the first chunk starts before anything is asked for.
  await wait(60);
  assert.equal(sent.length, 1, 'starting a stream synthesizes only the first chunk');
  assert.equal(sent[0].text, chunks[0]);
  assert.equal(sent[0].engine, 'espeak');

  // Asking for chunk 0 schedules chunk 1, and nothing further.
  const first = await speech.speechStreamChunk(id, 0);
  assert.ok(first.length > 0);
  await wait(80);
  assert.equal(sent.length, 2, 'one chunk is synthesized ahead');
  assert.equal(sent[1].text, chunks[1]);

  // Asking for chunk 1 queues chunk 2; stopping straight away cancels it before it runs.
  void speech.speechStreamChunk(id, 1).catch(() => {});
  const ahead = sent.length;
  speech.stopSpeech(owner);
  await assert.rejects(speech.speechStreamChunk(id, 2), (e) => speech.isCancelled(e));
  await wait(80);
  assert.equal(sent.length, ahead, 'nothing is synthesized after stop');

  // A new stream from the same window replaces the old one.
  const a = speech.startSpeechStream(owner, { text: PARA });
  const b = speech.startSpeechStream(owner, { text: 'Second paragraph. It has two sentences.' });
  await assert.rejects(speech.speechStreamChunk(a.id, 0), (e) => speech.isCancelled(e));
  const before = sent.length;
  const one = speech.speechStreamChunk(b.id, 0);
  await one;
  assert.ok(sent.slice(before - 1).some((m) => m.text === 'Second paragraph.'));
  await speech.speechStreamChunk(b.id, 1);

  // Single words still go through one job.
  const n = sent.length;
  await speech.synthesize({ text: 'library', lang: 'en' });
  assert.equal(sent.length, n + 1);
  assert.equal(sent[n].text, 'library');

  speech.stopSpeechWorker();
  fs.rmSync(userData, { recursive: true, force: true });
  console.log('speech stream tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
