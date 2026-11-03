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
const speech = load('src/services/speech.ts', (name) => {
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
