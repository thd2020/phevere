/**
 * Speech worker (Electron utilityProcess). Same engines as the Android app:
 *   - eSpeak NG (WebAssembly build of 1.52) for the built-in "Mechanical" voice and for
 *     IPA chips, which pass phonemes as [[...]].
 *   - Kokoro v1.0 through sherpa-onnx for the downloadable neural voices.
 * Runs apart from the main process so onnxruntime here never meets the OCR one, and a
 * slow synthesis never blocks the UI.
 *
 *   - Kokoro read straight from IPA (engine 'kokoro-ipa') through onnxruntime-node, for
 *     IPA chips when a neural voice is chosen. sherpa-onnx only takes text, and it ships
 *     its own onnxruntime.dll, so this engine runs in a second worker started with --ort.
 *
 * argv: --espeak <dir with espeak-ng.js> [--sherpa <dir with sherpa-onnx-node>] [--ort <dir with onnxruntime-node>]
 * Request:  { id, engine: 'espeak' | 'kokoro' | 'kokoro-ipa', text, voice?, speed?, model? }
 *           { id, engine: 'unpack', archive, dest }   (Kokoro .tar.bz2 downloads)
 * Response: { id, ok, wav?: Uint8Array, error? }
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
}

const espeakDir = arg('--espeak');
const sherpaDir = arg('--sherpa');
const ortDir = arg('--ort');

let espeakFactory = null;
async function espeak(text, voice, speed) {
  if (!espeakFactory) {
    // The package is ESM; import() through a file URL keeps it out of any bundler.
    const mod = await import(pathToFileURL(path.join(espeakDir, 'espeak-ng.js')).href);
    espeakFactory = mod.default;
  }
  const wpm = String(Math.round(160 * Math.min(2, Math.max(0.5, speed || 1))));
  // No -q: quiet mode also skips writing the WAV.
  const inst = await espeakFactory({
    arguments: ['-v', voice || 'en-us', '-s', wpm, '-w', 'out.wav', text],
    print() {},
    printErr() {},
  });
  return inst.FS.readFile('out.wav');
}

let sherpa = null;
let kokoro = null;
let kokoroDir = '';
function kokoroEngine(dir, modelFile) {
  if (!sherpaDir) throw new Error('Neural voices are not available on this system');
  if (!sherpa) sherpa = require(path.join(sherpaDir, 'sherpa-onnx.js'));
  if (kokoro && kokoroDir === dir) return kokoro;
  const f = (name) => path.join(dir, name);
  kokoro = new sherpa.OfflineTts({
    model: {
      kokoro: {
        model: f(modelFile),
        voices: f('voices.bin'),
        tokens: f('tokens.txt'),
        dataDir: f('espeak-ng-data'),
        lexicon: `${f('lexicon-us-en.txt')},${f('lexicon-zh.txt')}`,
      },
      numThreads: 2,
      debug: false,
    },
  });
  kokoroDir = dir;
  return kokoro;
}

let ort = null;
let ipaSession = null;
let ipaModel = '';
let ipaVocab = null;
let ipaVoices = null;
/** Kokoro from phoneme symbols: tokens are [0, ...ids, 0], style is voices[speaker][count]. */
async function kokoroFromPhonemes(model, phonemes, speaker, speed) {
  if (!ortDir) throw new Error('Neural IPA voice is not available on this system');
  if (!ort) ort = require(ortDir);
  const modelPath = path.join(model.dir, model.file);
  if (!ipaSession || ipaModel !== modelPath) {
    ipaSession = await ort.InferenceSession.create(modelPath);
    ipaModel = modelPath;
    ipaVocab = new Map();
    for (const line of fs.readFileSync(path.join(model.dir, 'tokens.txt'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^(.+) (\d+)$/);
      if (m) ipaVocab.set(m[1], Number(m[2]));
    }
    ipaVoices = fs.readFileSync(path.join(model.dir, 'voices.bin'));
  }
  const ids = [];
  for (const ch of Array.from(String(phonemes || ''))) {
    if (ipaVocab.has(ch)) ids.push(ipaVocab.get(ch));
  }
  if (!ids.length) throw new Error('No phonemes to speak');
  const n = Math.min(ids.length, 509);
  // voices.bin is float32 [speakers][510][256]; the row is picked by token count.
  const offset = ((speaker || 0) * 510 + n) * 256 * 4;
  if (offset + 1024 > ipaVoices.length) throw new Error('Unknown neural speaker');
  const style = new Float32Array(ipaVoices.buffer.slice(ipaVoices.byteOffset + offset, ipaVoices.byteOffset + offset + 1024));
  const tokens = BigInt64Array.from([0, ...ids.slice(0, n), 0].map(BigInt));
  const out = await ipaSession.run({
    tokens: new ort.Tensor('int64', tokens, [1, tokens.length]),
    style: new ort.Tensor('float32', style, [1, 256]),
    speed: new ort.Tensor('float32', Float32Array.from([speed || 1]), [1]),
  });
  const audio = out.audio || out[ipaSession.outputNames[0]];
  if (!audio || !audio.data || !audio.data.length) throw new Error('No speech generated for this IPA');
  return toWav(audio.data, 24000);
}

function toWav(samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

/**
 * Unpack a .tar.bz2 in JavaScript. Windows' tar.exe (bsdtar) stalls on these archives,
 * and doing it here keeps the main process responsive for the ~20 s it takes.
 */
function unpack(archive, dest) {
  const bz2 = require('unbzip2-stream');
  const tar = require('tar-stream');
  const root = path.resolve(dest);
  return new Promise((resolve, reject) => {
    const ex = tar.extract();
    ex.on('entry', (header, stream, next) => {
      const out = path.resolve(root, header.name);
      if (!out.startsWith(root + path.sep) && out !== root) {
        stream.resume();
        stream.on('end', next);
        return;
      }
      if (header.type === 'directory') {
        fs.mkdirSync(out, { recursive: true });
        stream.resume();
        stream.on('end', next);
        return;
      }
      if (header.type !== 'file') {
        stream.resume();
        stream.on('end', next);
        return;
      }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const w = fs.createWriteStream(out);
      w.on('error', reject);
      w.on('finish', next);
      stream.pipe(w);
    });
    ex.on('finish', resolve);
    ex.on('error', reject);
    const input = fs.createReadStream(archive);
    input.on('error', reject);
    const decoder = bz2();
    decoder.on('error', reject);
    input.pipe(decoder).pipe(ex);
  });
}

async function handle(msg) {
  if (msg.engine === 'unpack') {
    await unpack(msg.archive, msg.dest);
    return new Uint8Array(0);
  }
  if (msg.engine === 'kokoro-ipa') {
    return kokoroFromPhonemes(msg.model, msg.text, msg.speaker, msg.speed);
  }
  if (msg.engine === 'kokoro') {
    const engine = kokoroEngine(msg.model.dir, msg.model.file);
    // Electron forbids external ArrayBuffers from native addons.
    const audio = engine.generate({ text: msg.text, sid: msg.speaker || 0, speed: msg.speed || 1, enableExternalBuffer: false });
    if (!audio.samples || !audio.samples.length) throw new Error('No speech generated for this text');
    return toWav(audio.samples, audio.sampleRate);
  }
  return espeak(msg.text, msg.voice, msg.speed);
}

process.parentPort.on('message', async (e) => {
  const msg = e.data || {};
  try {
    const wav = await handle(msg);
    process.parentPort.postMessage({ id: msg.id, ok: true, wav: new Uint8Array(wav || []) });
  } catch (err) {
    process.parentPort.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
});
