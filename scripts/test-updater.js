/**
 * Updates from GitHub Releases (src/services/update-releases.ts, updater.ts): which release is
 * offered or rolled back to, the skipped version, checksum verification of downloads, the
 * install-on-quit path and the notebook backup hook. Electron and GitHub are faked; nothing installs.
 *
 * Run: node scripts/test-updater.js          (add --live to also read the real release list)
 */
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const build = (entry) =>
  esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    write: false,
  }).outputFiles[0].text;

function load(code, electron) {
  const mod = { exports: {} };
  const req = (name) => (name === 'electron' ? electron : require(name));
  new Function('module', 'exports', 'require', code)(mod, mod.exports, req);
  return mod.exports;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const good = Buffer.from('a verified installer');
const github = (overrides = {}) => [
  { tag_name: 'v4.1.0', html_url: 'https://example.test/v4.1.0', prerelease: true, assets: [] },
  { tag_name: 'v4.0.0', html_url: 'https://example.test/v4.0.0', assets: [
    { name: 'Phevere-Setup-4.0.0-x64.exe', browser_download_url: 'https://dl.test/4.0.0.exe', size: good.length, digest: `sha256:${overrides.digest || sha(good)}` },
    { name: 'Phevere-4.0.0-x64.AppImage', browser_download_url: 'https://dl.test/4.0.0.AppImage', size: 1, digest: null },
  ] },
  { tag_name: 'v3.0.0', html_url: 'https://example.test/v3.0.0', assets: [
    { name: 'Phevere-Setup-3.0.0-x64.exe', browser_download_url: 'https://dl.test/3.0.0.exe', size: good.length, digest: `sha256:${sha(good)}` },
  ] },
  { tag_name: 'v2.3.0', html_url: 'https://example.test/v2.3.0', draft: true, assets: [] },
  { tag_name: 'nightly', assets: [] },
];

// --- Choosing releases -------------------------------------------------------------------------
const rel = load(build('src/services/update-releases.ts'));
const releases = rel.releasesFromGitHub(github());
assert.deepEqual(releases.map((r) => r.version), ['4.0.0', '3.0.0'], 'drafts, prereleases and odd tags are left out');
assert.equal(rel.compareVersions('4.0.10', '4.0.9') > 0, true);
const win = { kind: 'nsis', arch: 'x64' };
assert.equal(rel.newestUpdate(releases, '3.0.0', win).release.version, '4.0.0');
assert.equal(rel.newestUpdate(releases, '4.0.0', win), null, 'nothing newer than the running version');
assert.equal(rel.newestUpdate(releases, '3.0.0', win, '4.0.0'), null, 'the version rolled back from is skipped');
assert.equal(rel.newestUpdate(releases, '3.0.0', { kind: 'nsis', arch: 'arm64' }), null, 'no arm64 installer, no offer');
assert.equal(rel.newestUpdate(releases, '3.0.0', { kind: 'manual', arch: 'x64' }).asset, null, 'manual builds get the page only');
assert.equal(rel.rollbackTarget(releases, '4.0.0', win).release.version, '3.0.0');
assert.equal(rel.rollbackTarget(releases, '3.0.0', win), null, 'no older release with an installer');
assert.equal(rel.rollbackTarget(releases, '4.0.0', { kind: 'manual', arch: 'x64' }), null);
assert.equal(releases[0].assets.find((a) => a.name.endsWith('.AppImage')).sha256, null);

// --- The updater with a fake Electron ----------------------------------------------------------
/** A body that sends the first `cut` bytes, then fails like a dropped connection. */
function brokenBody(buf, cut) {
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new Uint8Array(buf.subarray(0, cut)));
      } else {
        controller.error(new Error('net::ERR_CONNECTION_CLOSED'));
      }
    },
  });
}

async function scenario({ digest, mode = 'auto', skipped = null, api = 'ok', sumFile = true, cache = null, drops = 0 } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-updater-'));
  if (mode !== 'auto' || skipped) fs.writeFileSync(path.join(userData, 'update-prefs.json'), JSON.stringify({ mode, skipped }));
  if (cache) fs.writeFileSync(path.join(userData, 'update-releases.json'), JSON.stringify(cache));
  const fetched = [];
  const headers = [];
  const electron = {
    app: { isPackaged: false, getPath: () => userData, getVersion: () => '3.0.0', relaunch() {} },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    shell: { openExternal: async () => {} },
    net: {
      // releases/latest answers 302; the updater reads it with net.request because net.fetch hides the target.
      request: ({ url }) => {
        fetched.push(url);
        const handlers = {};
        return {
          setHeader() {},
          on(name, fn) { handlers[name] = fn; },
          abort() {},
          end() { setImmediate(() => handlers.redirect(302, 'HEAD', 'https://github.com/thd2020/phevere/releases/tag/v4.0.0')); },
        };
      },
      fetch: async (url, init = {}) => {
        fetched.push(url);
        headers.push(init.headers || {});
        if (url.startsWith('https://api.github.com/')) {
          if (api === 'limited') return new Response('{"message":"API rate limit exceeded"}', { status: 403 });
          if (api === 'unchanged') return new Response(null, { status: 304 });
          return new Response(JSON.stringify(github({ digest })), { status: 200, headers: { etag: '"abc"' } });
        }
        if (url.endsWith('.sha256')) {
          return sumFile ? new Response(`${sha(good)}  Phevere-Setup-4.0.0-x64.exe
`, { status: 200 }) : new Response('Not Found', { status: 404 });
        }
        const range = /^bytes=(\d+)-$/.exec((init.headers || {}).Range || '');
        const from = range ? Number(range[1]) : 0;
        const rest = good.subarray(from);
        if (drops > 0) {
          drops--;
          return new Response(brokenBody(rest, 5), { status: range ? 206 : 200 });
        }
        return new Response(rest, { status: range ? 206 : 200, headers: { 'content-length': String(rest.length) } });
      },
    },
  };
  process.env.PHEVERE_UPDATE_VERSION = '3.0.0';
  const updater = load(build('src/services/updater.ts'), electron);
  const events = { notes: [], backups: [], quits: 0 };
  updater.startUpdater({
    notify: (t) => events.notes.push(t),
    beforeInstall: async (from, to) => events.backups.push(`${from}->${to}`),
    quit: () => { events.quits++; },
    changed: () => {},
    parentWindow: () => null,
  });
  return { updater, userData, events, fetched, headers };
}

(async () => {
  {
    const { updater, userData, events } = await scenario();
    await updater.checkForUpdates();
    const state = updater.getUpdateState();
    assert.equal(state.status, 'ready', state.error || '');
    assert.equal(state.available.version, '4.0.0');
    assert.equal(state.rollback, null, 'no release below 3.0.0 has an installer');
    const file = path.join(userData, 'updates', 'Phevere-Setup-4.0.0-x64.exe');
    assert.deepEqual(fs.readFileSync(file), good, 'the verified download is kept for install');
    assert.match(events.notes[0], /4\.0\.0 is ready/);
    await updater.checkForUpdates();
    assert.equal(events.notes.length, 1, 'one notice per version');
    await updater.installPendingOnQuit();
    assert.deepEqual(events.backups, ['3.0.0->4.0.0'], 'the notebook is backed up before installing on quit');
    fs.rmSync(userData, { recursive: true, force: true });
  }
  {
    const { updater, userData } = await scenario({ digest: 'f'.repeat(64) });
    await updater.checkForUpdates();
    const state = updater.getUpdateState();
    assert.equal(state.status, 'error');
    assert.match(state.error, /did not match GitHub's checksum/);
    assert.deepEqual(fs.readdirSync(path.join(userData, 'updates')), [], 'a bad download is deleted');
    fs.rmSync(userData, { recursive: true, force: true });
  }
  {
    const { updater, userData, events, fetched } = await scenario({ mode: 'ask' });
    await updater.checkForUpdates();
    assert.equal(updater.getUpdateState().status, 'idle');
    assert.equal(updater.getUpdateState().available.version, '4.0.0');
    assert.equal(fetched.length, 1, 'ask mode does not download on its own');
    assert.match(events.notes[0], /4\.0\.0 is available/);
    await updater.installUpdateNow();
    assert.deepEqual(events.backups, ['3.0.0->4.0.0']);
    assert.equal(updater.getUpdateState().status, 'ready', 'a dev run stops before launching the installer');
    fs.rmSync(userData, { recursive: true, force: true });
  }
  {
    const { updater, userData, fetched } = await scenario({ mode: 'off' });
    await updater.checkForUpdates();
    assert.equal(fetched.length, 0, 'off: no automatic check');
    await updater.checkForUpdates(true);
    assert.equal(updater.getUpdateState().available.version, '4.0.0', 'Check now still works when off');
    fs.rmSync(userData, { recursive: true, force: true });
  }
  {
    const { updater, userData, events } = await scenario({ skipped: '4.0.0' });
    await updater.checkForUpdates();
    assert.equal(updater.getUpdateState().available, null, 'automatic checks pass over the skipped version');
    await updater.checkForUpdates(true);
    const state = updater.getUpdateState();
    assert.equal(state.available.version, '4.0.0', 'Check now offers it');
    assert.equal(state.status, 'idle', 'but does not download it in the background');
    assert.equal(events.notes.length, 0);
    fs.rmSync(userData, { recursive: true, force: true });
  }

  {
    const { updater, userData, headers } = await scenario({ drops: 2 });
    await updater.checkForUpdates();
    assert.equal(updater.getUpdateState().status, 'ready', updater.getUpdateState().error || '');
    const ranges = headers.map((h) => h.Range).filter(Boolean);
    assert.deepEqual(ranges, ['bytes=5-', 'bytes=10-'], 'a dropped download resumes where it stopped');
    assert.deepEqual(fs.readFileSync(path.join(userData, 'updates', 'Phevere-Setup-4.0.0-x64.exe')), good);
    fs.rmSync(userData, { recursive: true, force: true });
  }
  {
    const { updater, userData } = await scenario({ drops: 9 });
    await updater.checkForUpdates();
    const state = updater.getUpdateState();
    assert.equal(state.status, 'error');
    assert.match(state.error, /resumes where it stopped/);
    assert.ok(fs.existsSync(path.join(userData, 'updates', 'Phevere-Setup-4.0.0-x64.exe.part')), 'the partial file is kept for the next check');
    fs.rmSync(userData, { recursive: true, force: true });
  }
  {
    const { updater, userData, fetched } = await scenario({ api: 'limited' });
    await updater.checkForUpdates();
    const state = updater.getUpdateState();
    assert.equal(state.status, 'ready', state.error || '');
    assert.ok(fetched.includes(rel.LATEST_PAGE), 'a rate-limited API falls back to the latest release page');
    assert.ok(fetched.some((u) => u.endsWith('Phevere-Setup-4.0.0-x64.exe.sha256')), 'and to the .sha256 beside the installer');
    fs.rmSync(userData, { recursive: true, force: true });
  }
  {
    const { updater, userData } = await scenario({ api: 'limited', sumFile: false });
    await updater.checkForUpdates();
    const state = updater.getUpdateState();
    assert.equal(state.status, 'error');
    assert.match(state.error, /no checksum/, 'without a .sha256 file nothing is downloaded');
    fs.rmSync(userData, { recursive: true, force: true });
  }
  {
    const { updater, userData, headers } = await scenario({ api: 'unchanged', mode: 'ask', cache: { etag: '"abc"', json: github() } });
    await updater.checkForUpdates();
    assert.equal(headers[0]['If-None-Match'], '"abc"', 'the cached ETag is sent');
    assert.equal(updater.getUpdateState().available.version, '4.0.0', 'a 304 answer uses the cached list');
    fs.rmSync(userData, { recursive: true, force: true });
  }
  {
    const { updater, userData } = await scenario({ api: 'limited', mode: 'ask', cache: { etag: null, json: github().slice(2) } });
    process.env.PHEVERE_UPDATE_VERSION = '4.0.0';
    await updater.checkForUpdates(true);
    assert.equal(updater.getUpdateState().rollback, '3.0.0', 'rollback works from the cached list while the API is limited');
    process.env.PHEVERE_UPDATE_VERSION = '3.0.0';
    fs.rmSync(userData, { recursive: true, force: true });
  }

  if (process.argv.includes('--live')) {
    const page = await fetch(rel.LATEST_PAGE, { method: 'HEAD', headers: { 'User-Agent': 'Phevere-test' } });
    const pageVersion = rel.versionFromReleaseUrl(page.url);
    assert.ok(pageVersion, `the latest page redirects to a release tag, got ${page.url}`);
    console.log(`Live: the latest page names ${pageVersion}.`);
    // The API part needs GH_TOKEN where the shared 60-an-hour limit is used up.
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    const res = await fetch(rel.RELEASES_API, { headers: { 'User-Agent': 'Phevere-test', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    assert.equal(res.ok, true, `GitHub answered ${res.status}`);
    const live = rel.releasesFromGitHub(await res.json());
    assert.equal(live[0].version, pageVersion, 'the API and the latest page agree');
    const latest = live[0];
    const back = rel.rollbackTarget(live, latest.version, win);
    const offer = rel.newestUpdate(live, back.release.version, win);
    assert.equal(offer.release.version, latest.version);
    assert.ok(offer.asset.sha256, 'the latest Windows installer has a GitHub digest');
    for (const kind of [win, { kind: 'nsis', arch: 'arm64' }, { kind: 'appimage', arch: 'x64' }, { kind: 'appimage', arch: 'arm64' }]) {
      const c = rel.newestUpdate(live, '0.0.1', kind);
      assert.ok(c && c.asset && c.asset.sha256, `${kind.kind} ${kind.arch}: installer with digest in ${latest.version}`);
    }
    console.log(`Live: ${latest.version} is offered over ${back.release.version}; rollback from ${latest.version} installs ${back.release.version}.`);
  }
  console.log('Updater passed: release choice, skipped version, rollback target, checksum check, ask/off modes, install on quit, backup hook, resumed downloads, and the fallback when the API is rate-limited.');
  process.exit(0); // the updater's 6-hour timer would keep Node running
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
