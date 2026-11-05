/**
 * In-app updates: the shared rules (packages/core/src/update-policy.ts), the desktop flow
 * (src/services/update-controller.ts), the release metadata (scripts/update-metadata.js), and a
 * dry run of electron-updater against a local feed: it checks, downloads and verifies the
 * SHA-512, refuses a tampered file, and downgrades only when asked. No installer is run.
 *
 * Run: node scripts/test-app-update.js
 */
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');
const { writeUpdateMetadata, channelFor } = require('./update-metadata');

const root = path.join(__dirname, '..');

function load(entry) {
  const text = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    alias: { '@phevere/core': path.join(root, 'packages/core/src/update-policy.ts') },
  }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', text)(mod, mod.exports, require);
  return mod.exports;
}

const core = load('packages/core/src/update-policy.ts');
const { UpdateController } = load('src/services/update-controller.ts');

function policy() {
  const { compareVersions: cmp } = core;
  assert.equal(cmp('4.1.0', '4.0.9'), 1);
  assert.equal(cmp('v4.1.0', '4.1.0'), 0);
  assert.equal(cmp('4.1.0-beta.2', '4.1.0'), -1);
  assert.equal(cmp('4.1.0-beta.10', '4.1.0-beta.2'), 1);
  assert.equal(cmp('10.0.0', '9.9.9'), 1);
  assert.equal(cmp('junk', '0.0.1'), -1);

  // Modes per install type; Automatic is the default wherever it exists.
  assert.deepEqual(core.updateCapabilities('windows'), { modes: ['auto', 'ask', 'off'], rollback: true });
  assert.deepEqual(core.updateCapabilities('mac').modes, ['ask', 'off']);
  assert.equal(core.updateCapabilities('rpm').rollback, false);
  assert.equal(core.updateCapabilities('android').rollback, false);
  assert.deepEqual(core.updateCapabilities('none').modes, []);
  assert.equal(core.effectiveMode(undefined, 'windows'), 'auto');
  assert.equal(core.effectiveMode('auto', 'mac'), 'ask');
  assert.equal(core.effectiveMode('off', 'deb'), 'off');
  assert.equal(core.effectiveMode('bogus', 'appimage'), 'auto');

  // An update records the version it replaced; a rollback drops it again.
  let s = core.recordLaunch({}, '4.1.0');
  assert.deepEqual(s, { lastRunVersion: '4.1.0' });
  s = core.recordLaunch(s, '4.2.0');
  assert.equal(s.previousVersion, '4.1.0');
  s = core.recordLaunch(s, '4.2.0');
  assert.equal(s.previousVersion, '4.1.0', 'a restart keeps the recorded version');
  s = core.startRollback(s, '4.2.0');
  assert.equal(s.skipVersion, '4.2.0');
  s = core.recordLaunch(s, '4.1.0');
  assert.equal(s.previousVersion, undefined, 'after rolling back there is no older recorded version');
  assert.equal(s.skipVersion, '4.2.0');

  // The version rolled back from is skipped until something newer is published.
  assert.equal(core.isUpdateOffered('4.2.0', '4.1.0', s.skipVersion), false);
  assert.equal(core.isUpdateOffered('4.2.1', '4.1.0', s.skipVersion), true);
  assert.equal(core.isUpdateOffered('4.1.0', '4.1.0'), false);
  assert.equal(core.isUpdateOffered('4.0.9', '4.1.0'), false);
  s = core.recordLaunch(s, '4.2.1');
  assert.equal(s.skipVersion, undefined, 'running a newer version clears the skip');

  // Rollback target: the recorded version, else the newest older release with the updater.
  const published = ['v4.3.0', 'v4.2.0', 'v4.1.0-beta.1', 'v4.1.0', 'v4.0.0', 'v3.9.0'];
  assert.equal(core.rollbackTarget({ previousVersion: '4.1.0' }, '4.3.0', published), '4.1.0');
  assert.equal(core.rollbackTarget({}, '4.3.0', published), '4.2.0');
  assert.equal(core.rollbackTarget({ previousVersion: '3.9.0' }, '4.3.0', published), '4.2.0', 'versions without the updater are never chosen');
  assert.equal(core.rollbackTarget({}, '4.1.0', published), null, '4.0.0 has no updater');
  assert.equal(core.rollbackTarget({ previousVersion: '4.1.0' }, '4.3.0', ['v4.3.0', 'v4.2.0']), '4.2.0', 'a deleted release is passed over');
  assert.equal(core.rollbackTarget({ previousVersion: '4.1.0' }, '4.3.0'), '4.1.0');
  assert.equal(core.rollbackTarget({}, '4.3.0'), null);

  // Timing: startup delay, no re-check within the gap, doubling back-off capped at the interval.
  const T = core.UPDATE_TIMING;
  const now = 10 * 24 * 3600_000;
  assert.equal(core.nextCheckDelay({ now, startup: true }), T.startupDelayMs);
  assert.equal(core.nextCheckDelay({ now, startup: true, lastCheck: now - 60_000 }), T.minGapMs - 60_000);
  assert.equal(core.nextCheckDelay({ now }), T.intervalMs);
  assert.equal(core.nextCheckDelay({ now, failures: 1 }), T.retryBaseMs);
  assert.equal(core.nextCheckDelay({ now, failures: 3 }), 4 * T.retryBaseMs);
  assert.equal(core.nextCheckDelay({ now, failures: 30 }), T.intervalMs);
  assert.equal(core.nextCheckDelay({ now, failures: 1, retryAfterMs: T.intervalMs }), T.intervalMs);
  assert.equal(core.nextCheckDelay({ now, failures: 1, startup: true }), T.startupDelayMs);
}

async function metadata(dir) {
  const files = {
    'Phevere-Setup-4.1.0-x64.exe': 'x64 setup',
    'Phevere-Setup-4.1.0-arm64.exe': 'arm64 setup',
    'Phevere-4.1.0-x64.AppImage': 'x64 appimage',
    'Phevere-4.1.0-arm64.AppImage': 'arm64 appimage',
    'phevere_4.1.0_amd64.deb': 'amd64 deb',
    'phevere_4.1.0_arm64.deb': 'arm64 deb',
    'phevere-4.1.0-1.x86_64.rpm': 'x86_64 rpm',
    'phevere-4.1.0-1.arm64.rpm': 'arm64 rpm',
    'Phevere-4.1.0-android.apk': 'apk',
    'Phevere-4.1.0-darwin-arm64.dmg': 'dmg',
    'Phevere-Setup-4.0.0-x64.exe': 'old setup',
    'Phevere-OCR-PP-OCRv4.tar.gz': 'ocr',
  };
  const input = path.join(dir, 'assets');
  fs.mkdirSync(input, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(input, name), body);
  const out = path.join(dir, 'meta');
  const written = await writeUpdateMetadata({
    version: 'v4.1.0',
    files: Object.keys(files).map((n) => path.join(input, n)),
    outDir: out,
    releaseDate: '2026-11-04T08:00:00.000Z',
  });
  assert.deepEqual(written.map((f) => path.basename(f)), ['latest-android.yml', 'latest-linux-arm64.yml', 'latest-linux.yml', 'latest.yml']);

  const sha = (body) => crypto.createHash('sha512').update(body).digest('base64');
  const yaml = require('js-yaml');
  const win = yaml.load(fs.readFileSync(path.join(out, 'latest.yml'), 'utf8'));
  assert.equal(win.version, '4.1.0');
  assert.deepEqual(win.files.map((f) => f.url), ['Phevere-Setup-4.1.0-arm64.exe', 'Phevere-Setup-4.1.0-x64.exe']);
  const x64 = win.files.find((f) => f.url.endsWith('x64.exe'));
  assert.equal(x64.sha512, sha('x64 setup'));
  assert.equal(x64.size, Buffer.byteLength('x64 setup'));
  assert.equal(win.path, 'Phevere-Setup-4.1.0-x64.exe');
  assert.equal(win.sha512, x64.sha512);
  assert.equal(win.releaseDate, '2026-11-04T08:00:00.000Z');

  const linux = yaml.load(fs.readFileSync(path.join(out, 'latest-linux.yml'), 'utf8'));
  assert.deepEqual(linux.files.map((f) => f.url), ['Phevere-4.1.0-x64.AppImage', 'phevere_4.1.0_amd64.deb', 'phevere-4.1.0-1.x86_64.rpm']);
  assert.equal(linux.path, 'Phevere-4.1.0-x64.AppImage');
  const arm = yaml.load(fs.readFileSync(path.join(out, 'latest-linux-arm64.yml'), 'utf8'));
  assert.ok(arm.files.every((f) => /arm64/.test(f.url)));
  assert.equal(arm.files.length, 3);

  // The phone app reads its file with the shared parser.
  const apkMeta = core.parseUpdateMetadata(fs.readFileSync(path.join(out, 'latest-android.yml'), 'utf8'));
  assert.equal(apkMeta.version, '4.1.0');
  assert.equal(core.pickUpdateFile(apkMeta.files, 'apk').sha512, sha('apk'));
  const winMeta = core.parseUpdateMetadata(fs.readFileSync(path.join(out, 'latest.yml'), 'utf8'));
  assert.equal(core.pickUpdateFile(winMeta.files, 'exe', 'arm64').url, 'Phevere-Setup-4.1.0-arm64.exe');
  assert.equal(core.pickUpdateFile(winMeta.files, 'exe', 'x64').url, 'Phevere-Setup-4.1.0-x64.exe');
  assert.equal(core.parseUpdateMetadata('version: 4.1.0\n'), null);

  // Only one Windows architecture published: no latest.yml, so ARM64 never gets the x64 Setup.
  const partial = await writeUpdateMetadata({
    version: '4.1.0',
    files: ['Phevere-Setup-4.1.0-x64.exe', 'Phevere-4.1.0-x64.AppImage'].map((n) => path.join(input, n)),
    outDir: path.join(dir, 'partial'),
  });
  assert.deepEqual(partial.map((f) => path.basename(f)), ['latest-linux.yml']);

  assert.equal(channelFor('Phevere-Setup-4.1.0-x64.exe', '4.1.0'), 'latest.yml');
  assert.equal(channelFor('Phevere-Setup-4.0.0-x64.exe', '4.1.0'), null);
  assert.equal(channelFor('Phevere-4.1.0-darwin-x64.dmg', '4.1.0'), null);
  return out;
}

function fakeDeps(over = {}) {
  const timers = [];
  const calls = { notify: [], installs: [], quitInstall: [], open: [], downloads: 0, saved: null, checks: 0 };
  let latest = '4.1.0';
  let checkError = null;
  let downloadError = null;
  let busy = false;
  let state = over.state || {};
  const updater = {
    async check() {
      calls.checks++;
      if (checkError) throw checkError;
      return latest;
    },
    async download(onProgress) {
      calls.downloads++;
      onProgress(0.5);
      if (downloadError) throw downloadError;
      onProgress(1);
    },
    quitAndInstall(relaunch) { calls.quitInstall.push({ relaunch, feed: 'main' }); },
    installOnQuit() { calls.installs.push('quit'); },
  };
  const deps = {
    target: 'windows',
    version: '4.0.1',
    now: () => 1_000_000_000,
    loadState: () => state,
    saveState: (s) => { state = s; calls.saved = s; },
    updater: () => updater,
    rollbackUpdater: (version) => ({
      async check() { return version; },
      async download(onProgress) { onProgress(1); },
      quitAndInstall(relaunch) { calls.quitInstall.push({ relaunch, feed: version, skip: state.skipVersion }); },
      installOnQuit() {},
    }),
    latestVersion: async () => latest,
    publishedVersions: async () => ['v4.1.0', 'v4.0.1', 'v4.0.0'],
    hasUpdateFile: async () => true,
    isBusy: () => busy,
    notify: (m) => calls.notify.push(m),
    confirmRollback: async () => true,
    openDownload: (v) => calls.open.push(v),
    onChange: () => {},
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    log: () => {},
    ...over,
  };
  return {
    deps,
    calls,
    timers,
    get state() { return state; },
    setLatest: (v) => { latest = v; },
    failCheck: (e) => { checkError = e; },
    failDownload: (e) => { downloadError = e; },
    setBusy: (b) => { busy = b; },
    runTimers: async () => { const due = timers.splice(0); for (const t of due) t.fn(); await new Promise((r) => setImmediate(r)); },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

async function controller() {
  // Automatic: the startup timer checks, downloads, and the update installs on quit.
  {
    const f = fakeDeps();
    const c = new UpdateController(f.deps);
    assert.equal(c.view().mode, 'auto');
    c.start();
    assert.equal(f.timers.length, 1);
    assert.equal(f.timers[0].ms, 45_000);
    await f.runTimers();
    await flush();
    assert.equal(c.view().phase, 'ready');
    assert.equal(c.view().action, 'restart');
    assert.equal(f.calls.downloads, 1);
    assert.deepEqual(f.calls.notify, [], 'Automatic is silent');
    assert.equal(f.state.lastCheck, 1_000_000_000);
    c.onQuit();
    assert.deepEqual(f.calls.installs, ['quit']);
    c.onQuit();
    assert.equal(f.calls.installs.length, 1, 'installs once');
  }
  // Ask: notifies once per version, downloads only after the button, and waits for a pop-up.
  {
    const f = fakeDeps({ state: { mode: 'ask' } });
    const c = new UpdateController(f.deps);
    await c.check(false);
    assert.equal(c.view().phase, 'available');
    assert.equal(c.view().action, 'update');
    assert.equal(f.calls.downloads, 0);
    assert.deepEqual(f.calls.notify, ['Phevere 4.1.0 is available']);
    f.timers.splice(0);
    await c.check(false);
    assert.equal(f.calls.notify.length, 1, 'one notice per release');
    c.onQuit();
    assert.equal(f.calls.installs.length, 0, 'Ask never installs on quit');
    f.setBusy(true);
    await c.install();
    assert.equal(f.calls.downloads, 1);
    assert.equal(c.view().phase, 'installing');
    assert.equal(f.calls.quitInstall.length, 0, 'waits while a lookup pop-up is open');
    f.setBusy(false);
    await f.runTimers();
    assert.deepEqual(f.calls.quitInstall, [{ relaunch: true, feed: 'main' }]);
  }
  // Off: no timer; Check now still works and offers the button without a notice.
  {
    const f = fakeDeps({ state: { mode: 'off' } });
    const c = new UpdateController(f.deps);
    c.start();
    assert.equal(f.timers.length, 0);
    await c.check(true);
    assert.equal(c.view().action, 'update');
    assert.equal(f.timers.length, 0);
    assert.deepEqual(f.calls.notify, []);
    c.setMode('auto');
    await flush();
    assert.equal(c.view().phase, 'ready', 'switching to Automatic downloads the offered update');
  }
  // Failures back off; a rate limit waits the full interval; a release without the file is not a failure.
  {
    const f = fakeDeps();
    const c = new UpdateController(f.deps);
    f.failCheck(Object.assign(new Error('offline'), { code: 'ENOTFOUND' }));
    await c.check(false);
    assert.equal(c.view().phase, 'check-failed');
    assert.equal(f.state.failures, 1);
    assert.equal(f.timers[0].ms, 5 * 60_000);
    await c.check(false);
    assert.equal(f.timers[0].ms, 10 * 60_000);
    f.failCheck(Object.assign(new Error('rate'), { statusCode: 403 }));
    await c.check(false);
    assert.equal(f.timers[0].ms, 4 * 3600_000);
    f.failCheck(Object.assign(new Error('no file'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }));
    await c.check(false);
    assert.equal(c.view().phase, 'up-to-date');
    assert.equal(f.state.failures, 0);
  }
  // A failed download leaves the button to retry.
  {
    const f = fakeDeps({ state: { mode: 'ask' } });
    const c = new UpdateController(f.deps);
    await c.check(true);
    f.failDownload(new Error('sha512 checksum mismatch'));
    await c.install();
    assert.equal(c.view().phase, 'download-failed');
    assert.equal(c.view().action, 'update');
  }
  // Rollback: confirms, downloads that release, records the skip before installing, then skips it.
  {
    const f = fakeDeps({ version: '4.1.0', state: { lastRunVersion: '4.0.1', mode: 'auto' } });
    const c = new UpdateController(f.deps);
    assert.equal(f.state.previousVersion, '4.0.1');
    c.start();
    await flush();
    await flush();
    assert.equal(c.view().rollbackTo, '4.0.1');
    await c.rollback();
    assert.deepEqual(f.calls.quitInstall, [{ relaunch: true, feed: '4.0.1', skip: '4.1.0' }]);
    // The next launch runs 4.0.1 and must not reinstall 4.1.0.
    const g = fakeDeps({ version: '4.0.1', state: f.state });
    const d = new UpdateController(g.deps);
    await d.check(false);
    assert.equal(d.view().phase, 'up-to-date');
    assert.equal(g.calls.downloads, 0);
    g.setLatest('4.1.1');
    await d.check(false);
    await flush();
    assert.equal(d.view().phase, 'ready', 'a newer release is installed again');
  }
  // Rollback cancelled in the dialog does nothing; builds without rollback show no target.
  {
    const f = fakeDeps({ version: '4.1.0', state: { previousVersion: '4.0.1' }, confirmRollback: async () => false });
    const c = new UpdateController(f.deps);
    c.start();
    await flush();
    await flush();
    await c.rollback();
    assert.equal(f.calls.quitInstall.length, 0);
    assert.equal(f.state.skipVersion, undefined);
    const r = fakeDeps({ target: 'rpm', version: '4.1.0', state: { previousVersion: '4.0.1' } });
    const rc = new UpdateController(r.deps);
    rc.start();
    await flush();
    assert.equal(rc.view().rollbackTo, null);
    assert.deepEqual(rc.view().modes, ['ask', 'off']);
  }
  // macOS: Ask notifies; the button opens the download instead of installing.
  {
    const f = fakeDeps({ target: 'mac', state: { mode: 'auto' } });
    const c = new UpdateController(f.deps);
    assert.equal(c.view().mode, 'ask');
    await c.check(false);
    assert.equal(c.view().action, 'download');
    await c.install();
    assert.deepEqual(f.calls.open, ['4.1.0']);
    assert.equal(f.calls.downloads, 0);
  }
  // Unpackaged or portable copies: no modes, no timer, nothing checked.
  {
    const f = fakeDeps({ target: 'none' });
    const c = new UpdateController(f.deps);
    c.start();
    await c.check(true);
    assert.equal(f.calls.checks, 0);
    assert.deepEqual(c.view().modes, []);
  }
}

/** electron-updater against a local HTTP feed, without Electron and without running an installer. */
async function dryRun(dir, metaDir) {
  if (process.platform !== 'win32' && process.platform !== 'linux') return 'skipped (macOS uses no electron-updater)';
  const euPath = require.resolve('electron-updater');
  const eu = require(euPath);
  // electron-updater's own executor with Node's http in place of Electron's net module.
  const { ElectronHttpExecutor } = require(path.join(path.dirname(euPath), 'electronHttpExecutor.js'));
  class NodeExecutor extends ElectronHttpExecutor {
    createRequest(options, callback) {
      return http.request(options, callback);
    }
  }
  const feed = path.join(dir, 'feed');
  fs.mkdirSync(feed, { recursive: true });
  const assets = path.join(dir, 'assets');
  for (const f of fs.readdirSync(assets)) fs.copyFileSync(path.join(assets, f), path.join(feed, f));
  for (const f of fs.readdirSync(metaDir)) fs.copyFileSync(path.join(metaDir, f), path.join(feed, f));
  let tamper = false;
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].slice(1));
    const file = path.join(feed, path.basename(name));
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const body = tamper && !name.endsWith('.yml') ? Buffer.from('tampered bytes') : fs.readFileSync(file);
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const config = path.join(dir, 'app-update.yml');
  fs.writeFileSync(config, 'provider: generic\nurl: http://127.0.0.1/\nupdaterCacheDirName: phevere-updater-test\n');
  const appAdapter = (version) => ({
    version,
    name: 'Phevere',
    isPackaged: true,
    appUpdateConfigPath: config,
    userDataPath: path.join(dir, 'user'),
    baseCachePath: path.join(dir, `cache-${version}`),
    whenReady: () => Promise.resolve(),
    relaunch: () => { throw new Error('relaunch must not run'); },
    quit: () => { throw new Error('quit must not run'); },
    onQuit: () => {},
  });
  const make = (version) => {
    if (process.platform === 'linux') process.env.APPIMAGE = path.join(dir, 'Phevere-4.0.1-x64.AppImage');
    const updater = process.platform === 'win32'
      ? new eu.NsisUpdater(null, appAdapter(version))
      : new eu.AppImageUpdater(null, appAdapter(version));
    updater.httpExecutor = new NodeExecutor();
    updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.disableWebInstaller = true;
    updater.disableDifferentialDownload = true;
    updater.setFeedURL({ provider: 'generic', url });
    return updater;
  };
  const expected = process.platform === 'win32' ? `Phevere-Setup-4.1.0-${process.arch}.exe` : `Phevere-4.1.0-${process.arch}.AppImage`;
  try {
    const up = make('4.0.1');
    const result = await up.checkForUpdates();
    assert.equal(result.updateInfo.version, '4.1.0');
    assert.equal(result.isUpdateAvailable, true);
    const [downloaded] = await up.downloadUpdate();
    assert.equal(path.basename(downloaded).toLowerCase().endsWith(process.platform === 'win32' ? '.exe' : '.appimage'), true);
    assert.equal(fs.readFileSync(downloaded, 'utf8'), fs.readFileSync(path.join(feed, expected), 'utf8'), `picks ${expected}`);

    // Same version: nothing offered. Newer installed: nothing unless downgrade is allowed (rollback).
    assert.equal((await make('4.1.0').checkForUpdates()).isUpdateAvailable, false);
    assert.equal((await make('4.2.0').checkForUpdates()).isUpdateAvailable, false);
    const back = make('4.2.0');
    back.allowDowngrade = true;
    assert.equal((await back.checkForUpdates()).isUpdateAvailable, true);

    // A file that does not match its SHA-512 is rejected.
    tamper = true;
    const bad = make('4.0.0');
    await bad.checkForUpdates();
    await assert.rejects(bad.downloadUpdate(), /sha512 checksum mismatch/);
    return `checked, downloaded and verified ${expected}`;
  } finally {
    server.close();
  }
}

(async () => {
  policy();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-update-test-'));
  try {
    const metaDir = await metadata(dir);
    await controller();
    const dry = await dryRun(dir, metaDir);
    console.log(`app-update: policy, metadata and flow ok; electron-updater dry run ${dry}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
