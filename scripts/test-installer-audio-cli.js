const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

(async () => {
  const events = [];
  const selected = [];
  let stopped = 0;
  let progress = 0;
  let fail = false;
  let tick;
  const timers = new Set();
  const speech = {
    async installAndSelectVoice(voice) {
      selected.push(voice);
      progress = 0.45;
      tick();
      await new Promise((resolve) => setImmediate(resolve));
      if (fail) throw new Error('Network unavailable');
      progress = 1;
    },
    listVoices: () => [{ id: 'compact', progress }, { id: 'full', progress }],
    stopSpeechWorker: () => { stopped++; },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/installer-audio-cli.ts'), 'utf8');
  vm.runInNewContext(esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, Error,
    require: (name) => name === './speech' ? speech : require(name),
    process: { stdout: { write(line, callback) { setImmediate(() => { events.push(JSON.parse(line)); callback(); }); } } },
    setInterval(callback, interval) { assert.equal(interval, 250); tick = callback; const timer = {}; timers.add(timer); return timer; },
    clearInterval(timer) { timers.delete(timer); },
  });
  const { installerAudioModelArgument: argument, runInstallerAudioCommand: run } = module.exports;
  assert.equal(argument(['Phevere.exe']), undefined);
  assert.equal(argument(['Phevere.exe', '--install-audio-model=kokoro-compact']), 'kokoro-compact');
  assert.equal(argument(['Phevere.exe', '--install-audio-model=']), '');
  assert.equal(await run('kokoro-compact'), 0);
  assert.deepEqual(selected, ['compact']);
  assert.deepEqual(events.map((entry) => entry.event), ['audio-model-progress', 'audio-model-progress', 'audio-model-complete']);
  assert.equal(events[1].progress, 0.45);
  assert.equal(events[2].progress, 1);
  assert.equal(timers.size, 0);
  fail = true;
  events.length = 0;
  assert.equal(await run('kokoro-full'), 1);
  assert.equal(events.at(-1).event, 'audio-model-error');
  assert.equal(events.at(-1).error, 'Network unavailable');
  assert.equal(timers.size, 0);
  const count = selected.length;
  assert.equal(await run('none'), 0);
  assert.equal(selected.length, count);
  assert.equal(await run('invalid'), 1);
  assert.equal(selected.length, count);
  assert.equal(stopped, 4, 'Every subprocess path must stop its speech worker');
  console.log('Installer audio CLI passed model parsing, progress flushing, success/failure exits, no-selection preservation, and worker cleanup.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
