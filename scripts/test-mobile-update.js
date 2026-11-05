/**
 * Android updates (apps/mobile/src/app-update.ts with packages/core/src/update-releases.ts):
 * release choice, version compare, checksum failures, the metered rule, the three modes, the
 * rate-limit fallback and ETag cache, Install unknown apps, debug builds, and the Settings section
 * on Android, iOS and the browser. The native bridge and GitHub are faked; nothing installs.
 *
 * Run: node scripts/test-mobile-update.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const bundle = (entry) => {
  const code = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
};
const up = bundle('apps/mobile/src/app-update.ts');
const tick = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

const HASH = 'a'.repeat(64);
const apk = (v, digest = `sha256:${HASH}`) => ({
  name: `Phevere-${v}-android.apk`,
  browser_download_url: `https://github.com/thd2020/phevere/releases/download/v${v}/Phevere-${v}-android.apk`,
  size: 1000,
  digest,
});
const github = (digest) => [
  { tag_name: 'v4.3.0', html_url: 'https://github.com/thd2020/phevere/releases/tag/v4.3.0', prerelease: true, assets: [apk('4.3.0')] },
  // A desktop-only release: no APK, so the phone passes over it.
  { tag_name: 'v4.2.0', html_url: 'https://github.com/thd2020/phevere/releases/tag/v4.2.0', assets: [
    { name: 'Phevere-Setup-4.2.0-x64.exe', browser_download_url: 'https://dl.test/x.exe', size: 1, digest: `sha256:${HASH}` },
  ] },
  { tag_name: 'v4.1.0', html_url: 'https://github.com/thd2020/phevere/releases/tag/v4.1.0', assets: [apk('4.1.0', digest)] },
  { tag_name: 'v4.0.0', html_url: 'https://github.com/thd2020/phevere/releases/tag/v4.0.0', assets: [apk('4.0.0')] },
];

// --- Versions and release choice ---------------------------------------------------------------
assert.equal(up.installedVersion('4.0.0'), '4.0.0');
assert.equal(up.installedVersion('4.1.0-dev.812+abc123'), '4.1.0', 'a debug versionName compares on its release part');
assert.equal(up.installedVersion(''), '');
const rel = bundle('packages/core/src/update-releases.ts');
assert.ok(rel.compareVersions('4.0.10', '4.0.9') > 0);
assert.ok(rel.compareVersions('v4.1.0', '4.0.12') > 0);
const list = rel.releasesFromGitHub(github());
const target = { kind: 'apk', arch: '' };
assert.equal(rel.assetNameFor(target, '4.1.0'), 'Phevere-4.1.0-android.apk');
assert.equal(rel.newestUpdate(list, '4.0.0', target).release.version, '4.1.0', 'skips the prerelease and the release without an APK');
assert.equal(rel.newestUpdate(list, '4.1.0', target), null);
assert.equal(rel.newestUpdate(list, '4.2.0', target), null, 'nothing above the installed version has an APK');
assert.equal(rel.rollbackTarget(list, '4.1.0', target), null, 'Android has no rollback');

// --- Metered rule and modes --------------------------------------------------------------------
assert.equal(up.shouldCheck('auto', false, true), false, 'Automatically skips a metered network');
assert.equal(up.shouldCheck('auto', true, true), true, 'Check now runs on a metered network');
assert.equal(up.shouldCheck('auto', false, false), true);
assert.equal(up.shouldCheck('ask', false, true), true, 'Ask first only checks, so it runs on mobile data');
assert.equal(up.shouldCheck('off', false, false), false, 'Off checks nothing by itself');
assert.equal(up.shouldCheck('off', true, false), true);
assert.equal(up.asMode('nonsense'), 'auto', 'the default is Automatically, as on the desktop');

// --- The updater with a fake bridge ------------------------------------------------------------
function harness({ mode = 'auto', metered = false, debuggable = false, api = 'ok', digest, sumFile = true, cache = null,
  downloadError = null, installsAllowed = true, busy = false, versionName = '4.0.0' } = {}) {
  const h = { fetches: [], downloads: [], installs: [], notes: [], pages: [], states: [], timers: [], mode, cache, busy, installsAllowed };
  h.updater = up.createPhoneUpdater({
    info: async () => ({ versionName: debuggable ? `${versionName}-dev.5+abc` : versionName, debuggable, installsAllowed: h.installsAllowed, metered }),
    fetch: async (req) => {
      h.fetches.push(req);
      if (req.url.startsWith('https://api.github.com/')) {
        if (api === 'limited') return { status: 403, text: '{"message":"API rate limit exceeded"}', etag: '', location: '' };
        if (req.etag === 'W/"1"') return { status: 304, text: '', etag: req.etag, location: '' };
        return { status: 200, text: JSON.stringify(github(digest)), etag: 'W/"1"', location: '' };
      }
      if (req.url === 'https://github.com/thd2020/phevere/releases/latest') {
        assert.equal(req.redirect, false, 'the latest redirect is read, not followed');
        return { status: 302, text: '', etag: '', location: 'https://github.com/thd2020/phevere/releases/tag/v4.1.0' };
      }
      if (req.url.endsWith('Phevere-4.1.0-android.apk.sha256')) {
        return sumFile ? { status: 200, text: `${'b'.repeat(64)}  Phevere-4.1.0-android.apk\n`, etag: '', location: '' } : { status: 404, text: '', etag: '', location: '' };
      }
      throw new Error(`unexpected ${req.url}`);
    },
    download: async (req) => {
      h.downloads.push(req);
      h.updater.progress(500, 1000);
      if (downloadError) throw new Error(downloadError);
      return { name: req.name };
    },
    install: async (name) => {
      h.installs.push(name);
      return h.installsAllowed ? { started: true } : { needsPermission: true };
    },
    openPage: (url) => h.pages.push(url),
    notify: (text) => h.notes.push(text),
    busy: () => h.busy,
    loadMode: () => h.mode,
    saveMode: (m) => { h.mode = m; },
    loadCache: () => h.cache,
    saveCache: (c) => { h.cache = c; },
    changed: (s) => h.states.push(s),
    setTimer: (fn, ms) => { h.timers.push({ fn, ms }); return h.timers.length; },
  });
  h.last = () => h.updater.state();
  return h;
}

(async () => {
  // Automatically on Wi-Fi: download, verify (native), then the system prompt.
  let h = harness();
  assert.equal(await h.updater.init(), true);
  h.updater.start();
  assert.equal(h.timers[0].ms, up.FIRST_CHECK_MS, 'the first check waits after start-up');
  h.timers[0].fn();
  await tick();
  assert.equal(h.timers[1].ms, up.CHECK_EVERY_MS, 'then every six hours');
  assert.deepEqual(h.downloads, [{
    url: 'https://github.com/thd2020/phevere/releases/download/v4.1.0/Phevere-4.1.0-android.apk',
    name: 'Phevere-4.1.0-android.apk', sha256: HASH, size: 1000,
  }]);
  assert.ok(h.states.some((s) => s.status === 'downloading' && s.progress === 0.5), 'progress reaches the panel');
  assert.deepEqual(h.installs, ['Phevere-4.1.0-android.apk'], 'the system install prompt opens');
  assert.equal(h.last().status, 'ready');
  assert.equal(up.updateStatusText(h.last()), '4.1.0 is ready to install');
  assert.equal(up.updateActionText(h.last()), 'Install');
  assert.deepEqual(h.notes, ['Phevere 4.1.0 is ready to install.']);
  // A later check finds the same release: no second download, prompt or notification.
  await h.updater.check();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.installs.length, 1, 'automatic prompts come once per release');
  assert.equal(h.notes.length, 1);
  assert.equal(h.fetches.filter((f) => f.etag === 'W/"1"').length, 1, 'the next check sends the ETag and gets 304');
  // Install taps open the prompt again.
  await h.updater.install();
  assert.equal(h.installs.length, 2);

  // Automatically on mobile data: automatic checks skip, Check now downloads.
  h = harness({ metered: true });
  await h.updater.init();
  h.updater.start();
  h.timers[0].fn();
  await tick();
  assert.equal(h.fetches.length, 0, 'no request on a metered network');
  await h.updater.check();
  assert.equal(h.downloads.length, 1, 'Check now downloads even on mobile data');

  // Ask first: notify, no download until Update now.
  h = harness({ mode: 'ask' });
  await h.updater.init();
  h.updater.start();
  h.timers[0].fn();
  await tick();
  assert.equal(h.downloads.length, 0);
  assert.deepEqual(h.notes, ['Phevere 4.1.0 is available.']);
  assert.equal(up.updateStatusText(h.last()), '4.1.0 is available');
  assert.equal(up.updateActionText(h.last()), 'Update now');
  await h.updater.install();
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(h.installs, ['Phevere-4.1.0-android.apk']);
  // A manual check in Ask first tells only the panel.
  h = harness({ mode: 'ask' });
  await h.updater.init();
  await h.updater.check();
  assert.deepEqual(h.notes, []);

  // Off: nothing by itself; Check now shows what is available without downloading.
  h = harness({ mode: 'off' });
  await h.updater.init();
  h.updater.start();
  h.timers[0].fn();
  await tick();
  assert.equal(h.fetches.length, 0);
  await h.updater.check();
  assert.equal(h.last().available.version, '4.1.0');
  assert.equal(h.downloads.length, 0);
  assert.deepEqual(h.notes, []);
  // Switching modes saves and checks; Off does not.
  h.updater.setMode('ask');
  assert.equal(h.mode, 'ask');

  // Up to date: nothing above 4.1.0 has an APK.
  h = harness({ versionName: '4.1.0' });
  await h.updater.init();
  await h.updater.check();
  assert.equal(h.last().upToDate, true);
  assert.equal(up.updateStatusText(h.last()), 'Up to date');
  assert.equal(up.updateActionText(h.last()), '');
  assert.equal(h.downloads.length, 0);

  // Checksum failure: the native side deletes the file and refuses; nothing installs.
  h = harness({ downloadError: "Phevere-4.1.0-android.apk did not match GitHub's checksum, so it was deleted." });
  await h.updater.init();
  await h.updater.check();
  assert.equal(h.last().status, 'error');
  assert.match(up.updateStatusText(h.last()), /did not match GitHub's checksum/);
  assert.deepEqual(h.installs, []);
  assert.equal(up.updateActionText(h.last()), 'Update now', 'the user can try again');

  // No checksum from GitHub: no download at all.
  h = harness({ digest: null });
  await h.updater.init();
  await h.updater.check();
  assert.equal(h.downloads.length, 0);
  assert.match(h.last().error, /GitHub lists no checksum for Phevere-4\.1\.0-android\.apk/);

  // Different signing key (a release over a differently signed install): a plain error.
  h = harness({ downloadError: 'This update is signed with a different key than the Phevere on this phone, so Android cannot install it over this copy.' });
  await h.updater.init();
  await h.updater.check();
  assert.match(up.updateStatusText(h.last()), /signed with a different key/);
  assert.deepEqual(h.installs, []);

  // Rate-limited API: the latest redirect and the .sha256 file stand in.
  h = harness({ api: 'limited' });
  await h.updater.init();
  await h.updater.check();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].sha256, 'b'.repeat(64), 'the hash comes from the .sha256 file');
  assert.equal(h.downloads[0].url, 'https://github.com/thd2020/phevere/releases/download/v4.1.0/Phevere-4.1.0-android.apk');
  // ... without the .sha256 file (the APK is not up yet) the release is not offered at all.
  h = harness({ api: 'limited', sumFile: false });
  await h.updater.init();
  await h.updater.check();
  assert.equal(h.downloads.length, 0);
  assert.equal(h.last().error, null, 'no error: there is simply no update yet');
  assert.equal(h.last().available, null);
  assert.equal(h.notes.length, 0, 'no notice for a release the phone cannot install');
  // ... a cached list from an earlier answer still counts.
  h = harness({ api: 'limited', cache: { etag: 'W/"0"', releases: rel.releasesFromGitHub(github()) } });
  await h.updater.init();
  await h.updater.check();
  assert.equal(h.downloads[0].sha256, HASH, 'the cached digest wins over the fallback for the same version');

  // Install unknown apps is off: the settings page opens, and returning with it on prompts.
  h = harness({ installsAllowed: false });
  await h.updater.init();
  await h.updater.check();
  assert.equal(h.installs.length, 1);
  assert.equal(h.last().needsPermission, true);
  assert.equal(up.updateStatusText(h.last()), 'Install unknown apps is off for Phevere');
  h.installsAllowed = true;
  await h.updater.resume();
  await tick();
  assert.equal(h.installs.length, 2, 'the prompt opens after returning from the settings page');
  assert.equal(h.last().needsPermission, false);

  // A lookup is running or the app is in the background: the prompt waits.
  h = harness({ busy: true });
  await h.updater.init();
  await h.updater.check();
  assert.equal(h.installs.length, 0);
  h.busy = false;
  h.timers.at(-1).fn();
  await tick();
  assert.equal(h.installs.length, 1);

  // Debug build: no Automatically, no download; the action opens the release page.
  h = harness({ debuggable: true });
  await h.updater.init();
  assert.equal(h.last().current, '4.0.0');
  assert.equal(h.last().mode, 'ask', 'Automatically shows as Ask first on a build that cannot install');
  await h.updater.check();
  assert.equal(h.downloads.length, 0);
  assert.equal(up.updateActionText(h.last()), 'Download…');
  await h.updater.install();
  assert.deepEqual(h.pages, ['https://github.com/thd2020/phevere/releases/tag/v4.1.0']);
  h.updater.setMode('auto');
  assert.equal(h.mode, 'auto', 'unchanged: setMode(auto) is ignored');
  assert.equal(h.last().canInstall, false);

  // --- Settings section ------------------------------------------------------------------------
  const panels = loadPanels();
  const android = { platform: 'android', canDrawOverlays: true, notificationsGranted: true };
  const ids = (capture, on) => panels.settingsSections(capture, on).map((s) => s.id);
  assert.ok(ids(android, true).includes('updates'));
  assert.ok(!ids(android, false).includes('updates'), 'no updater, no section');
  assert.ok(!ids({ platform: 'ios', canDrawOverlays: false }, true).includes('updates'), 'never on iOS');
  assert.ok(!ids({ platform: 'web', canDrawOverlays: false }, true).includes('updates'), 'never in the browser');
  const prefs = { notifyIncoming: true, notifySaved: true, notifyOcr: true, notifyUpdates: true };
  const ready = { current: '4.0.0', mode: 'auto', canInstall: true, status: 'ready', upToDate: false,
    available: { version: '4.1.0', page: 'p' }, progress: 1, error: null, needsPermission: false };
  const html = panels.settingsBody(prefs, [], [], '', android, 'updates', null, undefined, ready);
  assert.match(html, /Phevere 4\.0\.0/);
  assert.match(html, /4\.1\.0 is ready to install/);
  assert.match(html, /data-act="update-install">Install</);
  assert.match(html, /role="radiogroup" aria-labelledby="update-mode-label"/, 'Install updates is a segmented choice');
  assert.match(html, /value="auto" checked \/>Automatically<\/label><label class="sv-seg__item"><input type="radio" name="update-mode" value="ask" \/>Ask first<\/label><label class="sv-seg__item"><input type="radio" name="update-mode" value="off" \/>Off<\/label>/);
  assert.match(html, /data-act="update-check"/);
  assert.doesNotMatch(html, /[Rr]oll ?back/, 'no rollback control on the phone');
  const debug = panels.settingsBody(prefs, [], [], '', android, 'updates', null, undefined, { ...ready, canInstall: false, mode: 'ask', status: 'idle' });
  assert.doesNotMatch(debug, /value="auto"/, 'Automatically is left out where it cannot work');
  const ios = panels.settingsBody(prefs, [], [], '', { platform: 'ios', canDrawOverlays: false }, 'updates', null, undefined, ready);
  assert.doesNotMatch(ios, /update-mode|data-section="updates"/, 'iOS falls back to another section');
  const notes = panels.settingsBody(prefs, [], [], '', android, 'notifications', null, undefined, ready);
  assert.match(notes, /Update ready or available/);
  assert.doesNotMatch(panels.settingsBody(prefs, [], [], '', android, 'notifications', null, undefined, null), /Update ready/);

  console.log('Mobile update passed: release choice, versions, metered rule, Automatically, Ask first, Off, checksum and signing errors, rate-limit fallback, ETag cache, Install unknown apps, idle prompt, debug builds, Settings section on Android, iOS and the browser.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** settings-panels.ts with the shared row helpers stubbed, as test-mobile-regressions.js does. */
function loadPanels() {
  const file = path.join(root, 'apps/mobile/src/settings-panels.ts');
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const row = (r) => `<row>${r.label || r.name || ''}</row>`;
  const core = {
    API_PROVIDERS: [], SOURCE_INFO: {}, TRANSLATION_ENGINES: [], apiKeysPanelHtml: () => '', choiceRowHtml: row,
    groupCatalogByLanguage: () => [], navRowHtml: row, rangeRowHtml: row, switchRowHtml: row,
    segRowHtml: bundle('packages/core/src/settings-kit.ts').segRowHtml,
    offlineShelvesHtml: () => '', packInspectorHtml: () => '', sourcesPanelHtml: () => '',
  };
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    require: (name) => {
      if (name === '@phevere/core') return core;
      if (name === './app-update') return up;
      throw new Error(`Missing mock ${name}`);
    },
  }, { filename: file });
  return mod.exports;
}
