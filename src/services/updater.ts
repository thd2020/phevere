/**
 * Updates from GitHub Releases. Every download is checked against the SHA-256 digest GitHub
 * publishes for the file before it can run.
 *
 * - auto: download in the background, install silently when Phevere quits.
 * - ask: tell the user, install when they choose to.
 * - off: check only when asked.
 *
 * The Windows installer (Setup.exe /S keeps the folder and the user's choices) and the AppImage
 * replace themselves. Other builds (macOS, deb, rpm) link to the release page instead.
 * Rollback installs the newest release below this one; automatic checks then skip the version
 * the user left until a newer one is published.
 */

import { app, dialog, net, shell, type BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';
import { loadUpdatePrefs, mergeUpdatePrefs, type UpdateMode } from './update-prefs-store';
import {
  LATEST_PAGE,
  RELEASES_API,
  assetNameFor,
  compareVersions,
  latestReleaseWithoutApi,
  newestUpdate,
  releasesFromGitHub,
  rollbackTarget,
  sha256FromSumFile,
  versionFromReleaseUrl,
  withLatest,
  type InstallTarget,
  type Release,
  type UpdateChoice,
} from './update-releases';

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';

export interface UpdateState {
  current: string;
  mode: UpdateMode;
  /** False where Phevere cannot replace itself; the action then opens the release page. */
  canInstall: boolean;
  status: UpdateStatus;
  /** True after a check that found nothing newer. */
  upToDate: boolean;
  available: { version: string; page: string } | null;
  progress: number;
  error: string | null;
  /** Version a rollback would install, or null. */
  rollback: string | null;
}

export interface UpdaterHooks {
  notify: (text: string) => void;
  /** Save the notebook and copy it aside before another version replaces this one. */
  beforeInstall: (from: string, to: string) => Promise<void>;
  /** Orderly quit (quitPhevere). */
  quit: () => void;
  changed: (state: UpdateState) => void;
  parentWindow: () => BrowserWindow | null;
}

let hooks: UpdaterHooks | null = null;
let releases: Release[] = [];
let offered: UpdateChoice | null = null;
let readyFile: string | null = null;
let status: UpdateStatus = 'idle';
let upToDate = false;
let progress = 0;
let lastError: string | null = null;
let checking: Promise<void> | null = null;
let downloading: Promise<string> | null = null;
let notifiedVersion: string | null = null;
let sessionEnding = false;

/** Dev runs (`npm start`) check and download but never install; PHEVERE_UPDATE_VERSION fakes the version. */
const dryRun = !app.isPackaged;

function currentVersion(): string {
  return (dryRun && process.env.PHEVERE_UPDATE_VERSION) || app.getVersion();
}

function installTarget(): InstallTarget {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') {
    const uninstaller = path.join(path.dirname(process.execPath), 'Uninstall Phevere.exe');
    if (dryRun || fs.existsSync(uninstaller)) return { kind: 'nsis', arch };
  }
  if (process.platform === 'linux' && process.env.APPIMAGE) return { kind: 'appimage', arch };
  return { kind: 'manual', arch };
}

function updatesDir(): string {
  return path.join(app.getPath('userData'), 'updates');
}

export function getUpdateState(): UpdateState {
  const target = installTarget();
  const back = rollbackTarget(releases, currentVersion(), target);
  return {
    current: currentVersion(),
    mode: loadUpdatePrefs().mode,
    canInstall: target.kind !== 'manual',
    status,
    upToDate,
    available: offered ? { version: offered.release.version, page: offered.release.page } : null,
    progress,
    error: lastError,
    rollback: back ? back.release.version : null,
  };
}

function emit(): void {
  try {
    hooks?.changed(getUpdateState());
  } catch {
    /* a closed window must not stop an update */
  }
}

function fail(err: unknown): void {
  status = 'error';
  lastError = err instanceof Error ? err.message : String(err);
  log.warn('updater', 'failed', { error: lastError });
  emit();
}

interface ReleaseCache {
  etag: string | null;
  json: unknown;
}

/** The last API answer, kept outside updates/ so launches do not clear it. */
function cachePath(): string {
  return path.join(app.getPath('userData'), 'update-releases.json');
}

function readCache(): ReleaseCache | null {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as ReleaseCache;
  } catch {
    return null;
  }
}

const userAgent = () => `Phevere/${app.getVersion()}`;

/**
 * The latest release without the API, which allows 60 requests an hour per IP address and is
 * often used up on shared or VPN addresses. The hash comes from the .sha256 file release.yml
 * publishes beside each installer; without one the download is refused.
 */
async function fetchLatestWithoutApi(target: InstallTarget): Promise<Release | null> {
  const pageUrl = await latestRedirect();
  const version = pageUrl ? versionFromReleaseUrl(pageUrl) : null;
  if (!pageUrl || !version) return null;
  const name = assetNameFor(target, version);
  let sha256: string | null = null;
  if (name) {
    const release = latestReleaseWithoutApi(version, pageUrl, target, null);
    const sums = await net.fetch(`${release.assets[0].url}.sha256`, { headers: { 'User-Agent': userAgent() } });
    if (sums.ok) sha256 = sha256FromSumFile(await sums.text(), name);
  }
  return latestReleaseWithoutApi(version, pageUrl, target, sha256);
}

/** Where releases/latest redirects. net.fetch hides the final URL, so read the 302 with net.request. */
function latestRedirect(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = net.request({ url: LATEST_PAGE, method: 'HEAD', redirect: 'manual' });
    req.setHeader('User-Agent', userAgent());
    req.on('redirect', (_status, _method, url) => {
      resolve(url);
      req.abort();
    });
    req.on('response', () => resolve(null));
    req.on('error', () => resolve(null));
    req.end();
  });
}

/** The release list from the API (an unchanged list answers 304 and costs no request), else the fallback. */
async function fetchReleases(target: InstallTarget): Promise<Release[]> {
  const cache = readCache();
  let apiError: string;
  try {
    const res = await net.fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': userAgent(),
        ...(cache?.etag ? { 'If-None-Match': cache.etag } : {}),
      },
    });
    if (res.status === 304 && cache) return releasesFromGitHub(cache.json);
    if (res.ok) {
      const json = await res.json();
      fs.writeFileSync(cachePath(), JSON.stringify({ etag: res.headers.get('etag'), json }), 'utf8');
      return releasesFromGitHub(json);
    }
    apiError = `GitHub answered ${res.status}`;
  } catch (err) {
    apiError = err instanceof Error ? err.message : String(err);
  }
  log.info('updater', 'API unavailable, reading the latest release page', { apiError });
  const latest = await fetchLatestWithoutApi(target).catch((): null => null);
  const list = withLatest(cache ? releasesFromGitHub(cache.json) : [], latest);
  if (!list.length) throw new Error(apiError);
  return list;
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Download the choice's file into userData/updates and verify it. Reuses a verified earlier download. */
async function download(choice: UpdateChoice): Promise<string> {
  const asset = choice.asset;
  if (!asset) throw new Error('This release has no installer for this computer.');
  if (!asset.sha256) throw new Error(`GitHub lists no checksum for ${asset.name}, so it was not installed.`);
  const dir = updatesDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, asset.name);
  for (const name of fs.readdirSync(dir)) {
    if (name !== asset.name) fs.rmSync(path.join(dir, name), { force: true, recursive: true });
  }
  if (fs.existsSync(file) && (await sha256Of(file)) === asset.sha256) return file;

  status = 'downloading';
  progress = 0;
  lastError = null;
  emit();
  const part = `${file}.part`;
  const res = await net.fetch(asset.url, { headers: { 'User-Agent': `Phevere/${app.getVersion()}` } });
  if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || asset.size || 1;
  const hash = createHash('sha256');
  const out = fs.createWriteStream(part);
  const reader = res.body.getReader();
  let received = 0;
  let lastEmit = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!out.write(Buffer.from(value))) await new Promise<void>((r) => out.once('drain', () => r()));
      received += value.length;
      progress = Math.min(0.99, received / total);
      if (Date.now() - lastEmit > 250) {
        lastEmit = Date.now();
        emit();
      }
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
    reader.releaseLock();
  }
  if (hash.digest('hex') !== asset.sha256) {
    fs.rmSync(part, { force: true });
    throw new Error(`${asset.name} did not match GitHub's checksum, so it was deleted.`);
  }
  fs.renameSync(part, file);
  progress = 1;
  log.info('updater', 'downloaded', { file, version: choice.release.version });
  return file;
}

function downloadOnce(choice: UpdateChoice): Promise<string> {
  if (!downloading) {
    downloading = download(choice).finally(() => {
      downloading = null;
    });
  }
  return downloading;
}

/** Start the installer for `file`. Returns false on a dev run, which only logs the command. */
function launchInstaller(file: string, relaunch: boolean): boolean {
  const target = installTarget();
  if (dryRun) {
    log.info('updater', 'dry run: would install', { file, target: target.kind, relaunch });
    return false;
  }
  if (target.kind === 'nsis') {
    // /S keeps the install folder, shortcuts and component choices; --force-run reopens Phevere.
    const child = spawn(file, ['/S', ...(relaunch ? ['--force-run'] : [])], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }
  if (target.kind === 'appimage' && process.env.APPIMAGE) {
    const dest = process.env.APPIMAGE;
    const staged = `${dest}.new`;
    fs.copyFileSync(file, staged);
    fs.chmodSync(staged, 0o755);
    fs.renameSync(staged, dest);
    fs.rmSync(file, { force: true });
    if (relaunch) app.relaunch({ execPath: dest, args: [] });
    return true;
  }
  return false;
}

async function install(choice: UpdateChoice, file: string): Promise<void> {
  status = 'installing';
  emit();
  await hooks?.beforeInstall(currentVersion(), choice.release.version);
  log.info('updater', 'installing', { from: currentVersion(), to: choice.release.version });
  if (launchInstaller(file, true)) {
    hooks?.quit();
    return;
  }
  status = 'ready';
  emit();
}

/** Check GitHub. Automatic checks respect the mode and the skipped version; a manual check shows any newer release. */
export function checkForUpdates(manual = false): Promise<void> {
  if (checking) return checking;
  checking = (async () => {
    const prefs = loadUpdatePrefs();
    if (!manual && prefs.mode === 'off') return;
    if (status !== 'downloading' && status !== 'installing') status = 'checking';
    lastError = null;
    emit();
    try {
      releases = await fetchReleases(installTarget());
    } catch (err) {
      fail(new Error(`Could not reach GitHub. ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    const target = installTarget();
    const choice = newestUpdate(releases, currentVersion(), target, manual ? null : prefs.skipped);
    offered = choice;
    upToDate = !choice;
    if (!choice) {
      readyFile = null;
      status = 'idle';
      emit();
      return;
    }
    const fresh = notifiedVersion !== choice.release.version;
    notifiedVersion = choice.release.version;
    const skippedChoice = prefs.skipped !== null && newestUpdate(releases, currentVersion(), target, prefs.skipped) === null;
    if (prefs.mode === 'auto' && choice.asset && !skippedChoice) {
      try {
        readyFile = await downloadOnce(choice);
        status = 'ready';
        emit();
        if (fresh) hooks?.notify(`Phevere ${choice.release.version} is ready. It installs when Phevere quits.`);
      } catch (err) {
        fail(err);
      }
      return;
    }
    status = 'idle';
    emit();
    if (fresh && !manual) hooks?.notify(`Phevere ${choice.release.version} is available.`);
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/** Install the offered release now and reopen Phevere, or open its page where Phevere cannot install. */
export async function installUpdateNow(): Promise<UpdateState> {
  const choice = offered;
  if (!choice) return getUpdateState();
  if (!choice.asset) {
    await shell.openExternal(choice.release.page);
    return getUpdateState();
  }
  try {
    const file = readyFile ?? (await downloadOnce(choice));
    readyFile = file;
    mergeUpdatePrefs({ skipped: null });
    await install(choice, file);
  } catch (err) {
    fail(err);
  }
  return getUpdateState();
}

/** Ask, then install the newest older release and reopen Phevere. */
export async function rollBack(): Promise<UpdateState> {
  const choice = rollbackTarget(releases, currentVersion(), installTarget());
  if (!choice) return getUpdateState();
  const from = currentVersion();
  const to = choice.release.version;
  const options = {
    type: 'warning' as const,
    buttons: [`Roll back to ${to}`, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Replace Phevere ${from} with ${to}?`,
    detail:
      `Your notebook is copied to the backups folder first and stays in place. ` +
      `${to} may drop details that only ${from} records, such as review history, for words it changes. ` +
      `Automatic updates skip ${from} until a newer version is published.`,
  };
  const parent = hooks?.parentWindow();
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response !== 0) return getUpdateState();
  try {
    const file = await downloadOnce(choice);
    mergeUpdatePrefs({ skipped: from });
    offered = null;
    readyFile = null;
    await install(choice, file);
  } catch (err) {
    fail(err);
  }
  return getUpdateState();
}

export function setUpdateMode(mode: UpdateMode): UpdateState {
  mergeUpdatePrefs({ mode });
  emit();
  if (mode !== 'off') void checkForUpdates();
  return getUpdateState();
}

/** Windows logoff or shutdown: never start an installer the session will kill halfway. */
export function noteSessionEnding(): void {
  sessionEnding = true;
}

/** Called at the start of quitPhevere: in auto mode, a downloaded update installs now, without reopening. */
export async function installPendingOnQuit(): Promise<void> {
  if (sessionEnding || status !== 'ready' || !readyFile || !offered) return;
  if (loadUpdatePrefs().mode !== 'auto') return;
  try {
    await hooks?.beforeInstall(currentVersion(), offered.release.version);
    launchInstaller(readyFile, false);
  } catch (err) {
    log.warn('updater', 'install on quit failed', { error: String(err) });
  }
}

export function startUpdater(h: UpdaterHooks): void {
  hooks = h;
  // A finished update or rollback leaves its installer behind; keep only downloads newer than this version.
  try {
    for (const name of fs.readdirSync(updatesDir())) {
      const version = /(d+.d+.d+)/.exec(name)?.[1];
      if (!version || compareVersions(version, currentVersion()) <= 0) {
        fs.rmSync(path.join(updatesDir(), name), { recursive: true, force: true });
      }
    }
  } catch {
    /* no downloads yet */
  }
  if (dryRun && !process.env.PHEVERE_UPDATE_VERSION) return;
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
}
