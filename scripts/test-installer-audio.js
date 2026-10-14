const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { Writable } = require('node:stream');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-installer-audio-'));
  const file = path.join(directory, 'install-options.json');
  const selected = [];
  let install = async (voice) => { selected.push(voice); };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/installer-provisioning.ts'), 'utf8');
  const compiled = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code;
  const module = { exports: {} };
  const logger = { info() {}, warn() {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Error, require: (name) => {
    if (name === 'electron') return { app: { getPath: () => directory } };
    if (name === '../logger') return { log: logger };
    if (name === './speech') return { installAndSelectVoice: (voice) => install(voice) };
    return require(name);
  } });
  const run = module.exports.provisionInstallerAudio;
  const write = (options) => fs.writeFileSync(file, JSON.stringify(options));
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  try {
    await run();
    write({ audioModel: 'none', startWithWindows: true });
    await run();
    assert.equal(selected.length, 0, 'No selection must preserve the current voice');
    write({ audioModel: 'constructor' });
    await run();
    assert.equal(selected.length, 0, 'Unknown selections must not execute');
    write({ audioModel: 'kokoro-compact', startWithWindows: true });
    await run();
    assert.deepEqual(selected, ['compact']);
    assert.equal(read().startWithWindows, true);
    assert.equal(read().audioProvisioning.status, 'complete');
    await run();
    assert.equal(selected.length, 1, 'Completed choices must not repeat');
    write({ audioModel: 'kokoro-full' });
    install = async () => { throw new Error('Network unavailable'); };
    await run();
    assert.equal(read().audioProvisioning.status, 'failed');
    assert.equal(read().audioProvisioning.error, 'Network unavailable');
    install = async (voice) => { selected.push(voice); };
    await run();
    assert.deepEqual(selected, ['compact', 'full']);
    assert.equal(read().audioProvisioning.status, 'complete');
    write({ audioModel: 'kokoro-compact' });
    install = async () => { write({ audioModel: 'none', startWithWindows: false }); };
    await run();
    assert.equal(read().audioModel, 'none', 'A newer installer choice must survive an earlier download');
    assert.equal(read().audioProvisioning, undefined);
    fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ audioModel: 'kokoro-full' }));
    install = async (voice) => { selected.push(voice); };
    await run();
    assert.equal(read().audioProvisioning.status, 'complete');
    fs.writeFileSync(file, '{');
    await run();
    const speechSource = fs.readFileSync(path.join(__dirname, '../src/services/speech.ts'), 'utf8');
    const speechModule = { exports: {} };
    let requests = 0;
    let fetchModel = async () => { requests++; throw new Error('Network unavailable'); };
    let diskFailure = false;
    const testFs = { ...fs, existsSync: (name) => String(name).includes('sherpa-onnx') || fs.existsSync(name),
      createWriteStream: (name) => diskFailure
        ? new Writable({ write(_chunk, _encoding, done) { done(new Error('Disk full')); } })
        : fs.createWriteStream(name) };
    vm.runInNewContext(esbuild.transformSync(speechSource, { loader: 'ts', format: 'cjs' }).code,
      { module: speechModule, exports: speechModule.exports, process, __dirname: path.join(__dirname, '../src/services'),
        Error, AbortController, setTimeout, clearTimeout, require: (name) => {
          if (name === 'electron') return { app: { getPath: () => directory }, net: { fetch: (...args) => fetchModel(...args) } };
          if (name === '../logger') return { log: logger };
          if (name === '@phevere/core') return { ipaToEspeakPhonemes: () => '' };
          if (name === 'fs') return testFs;
          return require(name);
        } });
    const speech = speechModule.exports;
    const first = speech.installAndSelectVoice('compact');
    const second = speech.installAndSelectVoice('compact');
    const failures = await Promise.allSettled([first, second]);
    assert.equal(requests, 1, 'Settings and installer must share one download');
    assert.ok(failures.every((result) => result.status === 'rejected'));
    assert.equal(speech.listVoices().find((row) => row.id === 'compact').error, 'Network unavailable');
    diskFailure = true;
    fetchModel = async () => {
      requests++;
      return { ok: true, headers: { get: () => '8' }, body: new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.enqueue(new Uint8Array([5, 6, 7, 8]));
        controller.close();
      } }) };
    };
    await assert.rejects(speech.installAndSelectVoice('compact'), /Disk full/);
    assert.equal(requests, 2, 'A failed download must allow a retry');
    assert.equal(speech.getAudioPrefs().voice, 'mechanical', 'Failures must preserve an available voice');
    console.log('Installer audio passed opt-in, completion, retry, malformed input, BOM, and replacement queue checks.');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
