/**
 * Android updates (apps/mobile/src/app-update.ts) against fake bridge calls and timers:
 * debug builds never update, Automatic downloads then prompts once, Ask first announces once
 * and installs only on request, a running lookup defers the prompt, failures back off, a
 * missing metadata file is not an error, and the permission page is not reopened in a loop.
 *
 * Run: node scripts/test-mobile-update.js
 */
const assert = require('assert/strict');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
  entryPoints: [path.join(root, 'apps', 'mobile', 'src', 'app-update.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  // Only the update rules, not the whole core package.
  alias: { '@phevere/core': path.join(root, 'packages', 'core', 'src', 'update-policy.ts') },
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
const { createPhoneUpdater, lastCheckedText, updateStatusText, ANDROID_FEED } = mod.exports;

const SHA = 'q'.repeat(86) + '==';
const yml = (v) => [
  `version: '${v}'`,
  'files:',
  `  - url: 'Phevere-${v}-android.apk'`,
  `    sha512: '${SHA}'`,
  '    size: 1234',
  `path: 'Phevere-${v}-android.apk'`,
  `sha512: '${SHA}'`,
  "releaseDate: '2026-11-04T00:00:00.000Z'",
  '',
].join('\n');

function harness(over = {}) {
  const log = { fetched: [], downloads: [], installs: [], announced: [], changes: 0 };
  let clock = 1_000_000_000_000;
  const timers = [];
  let state = over.state || {};
  const deps = {
    version: '4.0.1',
    debuggable: false,
    feed: { status: 200, text: yml('4.1.0') },
    async fetchText(url) {
      log.fetched.push(url);
      const f = deps.feed;
      if (f instanceof Error) throw f;
      return f;
    },
    async download(req) {
      log.downloads.push(req);
      if (deps.downloadFails) throw new Error('Checksum mismatch');
      return { name: req.name };
    },
    async install(name) {
      log.installs.push(name);
      return { needsPermission: !!deps.needsPermission };
    },
    canInstall: async () => !!deps.allowed,
    announce: (v) => log.announced.push(v),
    busy: () => !!deps.isBusy,
    loadState: () => state,
    saveState: (s) => { state = s; },
    onChange: () => { log.changes++; },
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, ms, at: clock + ms, done: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.done = true; },
    ...over,
  };
  const u = createPhoneUpdater(deps);
  return {
    u, deps, log,
    state: () => state,
    pending: () => timers.filter((t) => !t.done),
    advance(ms) { clock += ms; },
    async fire(pred = () => true) {
      const t = timers.find((x) => !x.done && pred(x));
      assert.ok(t, 'a pending timer');
      t.done = true;
      t.fn();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    },
  };
}

(async () => {
  // A debug build carries a debug signature: no updates and no Updates section.
  {
    const h = harness({ debuggable: true });
    assert.equal(h.u.supported, false);
    assert.equal(h.u.view(), null);
    h.u.start();
    assert.equal(h.pending().length, 0);
  }

  // Startup records the launch and waits 45 s before the first check.
  {
    const h = harness({ state: { lastRunVersion: '4.0.0' } });
    assert.equal(h.state().lastRunVersion, '4.0.1');
    h.u.start();
    assert.equal(h.pending().length, 1);
    assert.equal(h.pending()[0].ms, 45_000);
    assert.equal(h.u.view().mode, 'auto', 'Automatic is the default');
    assert.deepEqual(h.u.view().modes, ['auto', 'ask', 'off']);
  }

  // Automatic: the check downloads the APK from that release tag, then shows the prompt once.
  {
    const h = harness();
    h.u.start();
    await h.fire();
    assert.deepEqual(h.log.fetched, [ANDROID_FEED]);
    assert.equal(h.log.downloads.length, 1);
    assert.equal(h.log.downloads[0].url, 'https://github.com/thd2020/phevere/releases/download/v4.1.0/Phevere-4.1.0-android.apk');
    assert.equal(h.log.downloads[0].sha512, SHA);
    assert.equal(h.log.downloads[0].size, 1234);
    assert.deepEqual(h.log.installs, ['Phevere-4.1.0-android.apk']);
    assert.equal(h.u.view().phase, 'ready');
    assert.equal(h.log.announced.length, 0, 'Automatic does not announce');
    // The next regular check is four hours later and does not prompt again by itself.
    const next = h.pending();
    assert.equal(next.length, 1);
    assert.equal(next[0].ms, 4 * 60 * 60_000);
    await h.fire();
    assert.equal(h.log.installs.length, 1);
    // The Install button still works.
    await h.u.install();
    assert.equal(h.log.installs.length, 2);
    assert.equal(h.log.downloads.length, 1, 'the verified APK is not downloaded twice');
  }

  // Ask first: announce once per release, download and install only when asked.
  {
    const h = harness({ state: { mode: 'ask' } });
    h.u.start();
    await h.fire();
    assert.deepEqual(h.log.announced, ['4.1.0']);
    assert.equal(h.log.downloads.length, 0);
    assert.equal(h.u.view().phase, 'available');
    assert.equal(updateStatusText(h.u.view()), '4.1.0 available');
    await h.fire();
    assert.deepEqual(h.log.announced, ['4.1.0'], 'not announced again');
    await h.u.install();
    assert.equal(h.log.downloads.length, 1);
    assert.deepEqual(h.log.installs, ['Phevere-4.1.0-android.apk']);
  }

  // A running lookup defers the prompt; it shows once the app is quiet.
  {
    const h = harness();
    h.deps.isBusy = true;
    h.u.start();
    await h.fire((t) => t.ms === 45_000);
    assert.equal(h.log.downloads.length, 1);
    assert.equal(h.log.installs.length, 0);
    h.deps.isBusy = false;
    await h.fire((t) => t.ms === 10_000);
    assert.equal(h.log.installs.length, 1);
  }

  // Off never checks on its own; Check now still works.
  {
    const h = harness({ state: { mode: 'off' } });
    h.u.start();
    assert.equal(h.pending().length, 0);
    h.deps.feed = { status: 200, text: yml('4.0.1') };
    await h.u.check();
    assert.equal(h.u.view().phase, 'up-to-date');
    assert.equal(updateStatusText(h.u.view()), 'Up to date');
    assert.equal(h.pending().length, 0);
  }

  // A release still uploading has no latest-android.yml yet: up to date, not a failure.
  {
    const h = harness();
    h.deps.feed = { status: 404, text: 'Not Found' };
    await h.u.check();
    assert.equal(h.u.view().phase, 'up-to-date');
    assert.equal(h.state().failures, 0);
    assert.ok(h.state().lastCheck > 0);
  }

  // Failures back off: 5, then 10 minutes; a rate limit waits the full interval.
  {
    const h = harness();
    h.deps.feed = new Error('offline');
    await h.u.check();
    assert.equal(h.u.view().phase, 'error');
    assert.equal(updateStatusText(h.u.view()), 'Check failed');
    assert.equal(h.pending()[0].ms, 5 * 60_000);
    await h.fire();
    assert.equal(h.pending()[0].ms, 10 * 60_000);
    h.deps.feed = { status: 429, text: '' };
    await h.fire();
    assert.equal(h.pending()[0].ms, 4 * 60 * 60_000);
  }

  // A failed download (checksum) leaves an error and installs nothing.
  {
    const h = harness();
    h.deps.downloadFails = true;
    await h.u.check();
    assert.equal(h.u.view().phase, 'error');
    assert.equal(h.log.installs.length, 0);
  }

  // A rolled-back or skipped version is not offered.
  {
    const h = harness({ state: { skipVersion: '4.1.0' } });
    await h.u.check();
    assert.equal(h.u.view().phase, 'up-to-date');
    assert.equal(h.log.downloads.length, 0);
  }

  // Without "install unknown apps", the permission page opens once; coming back only prompts
  // when the permission was granted.
  {
    const h = harness();
    h.deps.needsPermission = true;
    await h.u.check();
    assert.equal(h.log.installs.length, 1);
    assert.equal(h.u.view().needsPermission, true);
    assert.equal(updateStatusText(h.u.view()), 'Allow installs from Phevere');
    h.deps.allowed = false;
    h.u.idle();
    await new Promise((r) => setImmediate(r));
    assert.equal(h.log.installs.length, 1, 'not reopened while still not allowed');
    h.deps.allowed = true;
    h.deps.needsPermission = false;
    h.u.idle();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(h.log.installs.length, 2);
    assert.equal(h.u.view().needsPermission, false);
  }

  // Switching to Automatic with an offer pending starts the download.
  {
    const h = harness({ state: { mode: 'ask' } });
    await h.u.check();
    h.u.setMode('auto');
    await new Promise((r) => setImmediate(r));
    assert.equal(h.log.downloads.length, 1);
    assert.equal(h.state().mode, 'auto');
  }

  // Progress from the bridge.
  {
    const h = harness();
    let release;
    h.deps.download = (req) => new Promise((r) => { release = () => r({ name: req.name }); });
    const running = h.u.check();
    await new Promise((r) => setImmediate(r));
    assert.equal(h.u.view().phase, 'downloading');
    h.u.progress(400, 1000);
    assert.equal(updateStatusText(h.u.view()), 'Downloading 40%');
    release();
    await running;
    assert.equal(h.u.view().phase, 'ready');
  }

  const day = new Date(2026, 10, 4, 14, 5).getTime();
  assert.equal(lastCheckedText(null, day), 'Never');
  assert.equal(lastCheckedText(day, day + 60_000), 'Today 14:05');
  assert.equal(lastCheckedText(day - 86_400_000, day), 'Yesterday 14:05');
  assert.equal(lastCheckedText(new Date(2026, 9, 30, 9, 3).getTime(), day), '30 Oct 09:03');

  console.log('Mobile update passed: debug builds, Automatic, Ask first, busy deferral, Off, missing metadata, back-off, failed download, skipped version, install permission, progress.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
