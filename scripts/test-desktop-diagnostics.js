const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-diagnostics-test-'));
  try {
    const app = new EventEmitter();
    app.getPath = () => directory;
    app.getVersion = () => 'test';
    app.setPath = (name, value) => { app[name] = value; };
    app.whenReady = () => Promise.resolve();
    const powerMonitor = new EventEmitter();
    const runtime = new EventEmitter();
    runtime.pid = 42;
    runtime.versions = { electron: '28.3.3' };
    let crashOptions;
    const electron = { app, powerMonitor, crashReporter: { start: (options) => { crashOptions = options; } } };
    const source = fs.readFileSync(path.join(__dirname, '../src/services/desktop-diagnostics.ts'), 'utf8');
    const compiled = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code;
    const module = { exports: {} };
    vm.runInNewContext(compiled, { module, exports: module.exports, process: runtime,
      require: (name) => name === 'electron' ? electron : require(name) });
    module.exports.installDesktopDiagnostics();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(crashOptions.uploadToServer, false);
    assert.equal(app.crashDumps, path.join(directory, 'diagnostics', 'crashes'));
    powerMonitor.emit('suspend');
    powerMonitor.emit('resume');
    app.emit('render-process-gone', {}, { id: 7 }, { reason: 'oom', exitCode: -1 });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 9 });
    runtime.emit('uncaughtExceptionMonitor', new Error('test failure'), 'uncaughtException');
    app.emit('before-quit');
    app.emit('will-quit');
    runtime.emit('exit', 0);
    const journal = path.join(directory, 'diagnostics', 'lifecycle.jsonl');
    const events = fs.readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map((entry) => entry.event), ['startup', 'suspend', 'resume', 'renderer-exit', 'child-exit', 'uncaught-exception', 'before-quit', 'will-quit', 'process-exit']);
    assert.equal(events[3].reason, 'oom');
    assert.equal(events[4].type, 'GPU');
    fs.writeFileSync(journal, Buffer.alloc(257 * 1024));
    powerMonitor.emit('resume');
    assert.ok(fs.existsSync(`${journal}.previous`));
    assert.equal(JSON.parse(fs.readFileSync(journal, 'utf8')).event, 'resume');
    console.log('Desktop diagnostics passed crash settings, exit/power events, and bounded journal rotation.');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
