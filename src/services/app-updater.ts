/**
 * Updates from GitHub releases. Windows (NSIS) and AppImage install silently, deb and rpm
 * install through a password prompt, and the unsigned macOS build opens the DMG download.
 * electron-updater does the download, the SHA-512 check and the install; the flow lives in
 * update-controller.ts. Settings → Updates talks to it over the updates-* IPC channels.
 *
 * electron-updater reads `resources/app-update.yml` (packaging/app-update.yml, copied by
 * forge.config.js) for its cache folder. That file names no publisherName, so an unsigned
 * Setup.exe is installed without a signature check; add publisherName there once releases are
 * Authenticode-signed and electron-updater will refuse updates signed by anyone else.
 */

import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { AppUpdater, BaseUpdater, Logger } from 'electron-updater';
import type { UpdateMode, UpdateState, UpdateTarget } from '@phevere/core';
import { log } from '../logger';
import { UpdateController, type UpdaterPort, type UpdateView } from './update-controller';

const OWNER = 'thd2020';
const REPO = 'phevere';
const RELEASES = `https://github.com/${OWNER}/${REPO}/releases`;
const STATE_FILE = 'update-state.json';

let controller: UpdateController | null = null;

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE);
}

function loadState(): UpdateState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return raw && typeof raw === 'object' ? (raw as UpdateState) : {};
  } catch {
    return {};
  }
}

function saveState(state: UpdateState): void {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    log.warn('updater', 'Could not save update state', { err: String(err) });
  }
}

function succeeds(cmd: string, args: string[]): boolean {
  try {
    return spawnSync(cmd, args, { stdio: 'ignore', timeout: 5_000 }).status === 0;
  } catch {
    return false;
  }
}

/** How this copy was installed. Unpackaged, portable and hand-built copies get no updates. */
export function detectUpdateTarget(): UpdateTarget {
  if (!app.isPackaged) return 'none';
  if (process.platform === 'darwin') return 'mac';
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return 'none';
  if (process.platform === 'win32') {
    // The NSIS install puts "Uninstall Phevere.exe" next to Phevere.exe; a zip copy has none.
    return fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Phevere.exe')) ? 'windows' : 'none';
  }
  if (process.platform === 'linux') {
    if (process.env.APPIMAGE) return 'appimage';
    if (succeeds('dpkg-query', ['-S', process.execPath])) return 'deb';
    if (succeeds('rpm', ['-qf', process.execPath])) return 'rpm';
  }
  return 'none';
}

/** The metadata file electron-updater reads for this platform and architecture. */
function channelFile(): string {
  if (process.platform === 'linux') return process.arch === 'x64' ? 'latest-linux.yml' : `latest-linux-${process.arch}.yml`;
  return 'latest.yml';
}

const updaterLogger: Logger = {
  info: (m?: unknown) => log.info('updater', String(m)),
  warn: (m?: unknown) => log.warn('updater', String(m)),
  error: (m?: unknown) => log.error('updater', String(m)),
  debug: (m: string) => log.debug('updater', m),
};

function createUpdater(target: UpdateTarget): BaseUpdater {
  // Loaded on first use, so macOS and unpackaged runs never load electron-updater.
  const eu = require('electron-updater') as typeof import('electron-updater');
  const updater: BaseUpdater =
    target === 'windows'
      ? new eu.NsisUpdater()
      : target === 'appimage'
        ? new eu.AppImageUpdater()
        : target === 'deb'
          ? new eu.DebUpdater()
          : new eu.RpmUpdater();
  updater.logger = updaterLogger;
  updater.autoDownload = false;
  // Installing on quit is done by quitPhevere() (index.ts), which ends with app.exit and so
  // never reaches the quit event electron-updater listens for.
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  // Releases publish no blockmaps, so every update is a full download.
  updater.disableDifferentialDownload = true;
  return updater;
}

/** Wraps an electron-updater instance for the controller. */
function port(updater: BaseUpdater, target: UpdateTarget): UpdaterPort {
  let listener: ((p: { percent: number }) => void) | null = null;
  return {
    async check() {
      const result = await (updater as AppUpdater).checkForUpdates();
      return result?.updateInfo?.version ?? null;
    },
    async download(onProgress) {
      if (listener) updater.removeListener('download-progress', listener);
      listener = (p) => onProgress(Math.max(0, Math.min(1, (p.percent || 0) / 100)));
      updater.on('download-progress', listener);
      try {
        await updater.downloadUpdate();
      } finally {
        updater.removeListener('download-progress', listener);
        listener = null;
      }
    },
    quitAndInstall(relaunch) {
      // Silent on Windows: without /S the interactive setup window would open. deb and rpm
      // ask for the password through pkexec in either case.
      updater.quitAndInstall(target === 'windows' || target === 'appimage', relaunch);
    },
    installOnQuit() {
      updater.install(true, false);
    },
  };
}

async function fetchText(url: string, accept?: string): Promise<{ status: number; text: string }> {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': `Phevere/${app.getVersion()}`, ...(accept ? { Accept: accept } : {}) },
  });
  return { status: res.status, text: res.ok ? await res.text() : '' };
}

function httpError(status: number, url: string): Error {
  return Object.assign(new Error(`HTTP ${status} for ${url}`), { statusCode: status });
}

/** macOS has no update file; the newest release's tag comes from GitHub's latest-release page. */
async function latestVersion(): Promise<string | null> {
  const url = `${RELEASES}/latest`;
  const res = await fetchText(url, 'application/json');
  if (res.status === 404) return null;
  if (res.status !== 200) throw httpError(res.status, url);
  const tag = JSON.parse(res.text)?.tag_name;
  return typeof tag === 'string' ? tag.replace(/^v/, '') : null;
}

/** Tags from the releases Atom feed (the newest ten), which has no API rate limit. */
async function publishedVersions(): Promise<string[]> {
  const url = `${RELEASES}.atom`;
  const res = await fetchText(url, 'application/atom+xml');
  if (res.status !== 200) throw httpError(res.status, url);
  const tags = [...res.text.matchAll(/\/releases\/tag\/v?([0-9][^"<\s]*)/g)].map((m) => decodeURIComponent(m[1]));
  return [...new Set(tags)];
}

async function hasUpdateFile(version: string): Promise<boolean> {
  const res = await net.fetch(`${RELEASES}/download/v${version}/${channelFile()}`, {
    method: 'HEAD',
    headers: { 'User-Agent': `Phevere/${app.getVersion()}` },
  });
  return res.ok;
}

function dmgUrl(version: string): string {
  return `${RELEASES}/download/v${version}/Phevere-${version}-darwin-${process.arch}.dmg`;
}

export interface AppUpdaterHooks {
  /** A lookup pop-up or the OCR overlay is open. */
  isBusy(): boolean;
  /** Shows a system notification; clicking it runs `onClick`. */
  notify(message: string, onClick: () => void): void;
  /** Opens Settings on the Updates page. */
  openUpdatesSettings(): void;
}

function broadcast(view: UpdateView): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updates-changed', view);
  }
}

/** Creates the controller, registers the IPC handlers and starts the check timer. */
export function initAppUpdater(hooks: AppUpdaterHooks): void {
  if (controller) return;
  const target = detectUpdateTarget();
  let main: UpdaterPort | null = null;
  controller = new UpdateController({
    target,
    version: app.getVersion(),
    now: () => Date.now(),
    loadState,
    saveState,
    updater: () => (main ||= port(createUpdater(target), target)),
    rollbackUpdater: (version) => {
      const updater = createUpdater(target);
      updater.allowDowngrade = true;
      updater.setFeedURL({ provider: 'generic', url: `${RELEASES}/download/v${version}/` });
      return port(updater, target);
    },
    latestVersion,
    publishedVersions,
    hasUpdateFile,
    isBusy: hooks.isBusy,
    notify: (message) => hooks.notify(message, hooks.openUpdatesSettings),
    confirmRollback: async (version) => {
      const parent = BrowserWindow.getFocusedWindow();
      const options = {
        type: 'question' as const,
        buttons: ['Roll back', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: `Roll back to Phevere ${version}?`,
        detail: 'Phevere restarts to install it.',
      };
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return response === 0;
    },
    openDownload: (version) => void shell.openExternal(dmgUrl(version)),
    onChange: broadcast,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    log: (level, message, meta) => log[level]('updater', message, meta),
  });
  log.info('updater', 'Updates ready', { target, version: app.getVersion() });

  ipcMain.handle('updates-get', () => controller!.view());
  ipcMain.handle('updates-set-mode', (_e, mode: UpdateMode) => controller!.setMode(mode));
  ipcMain.handle('updates-check', () => controller!.check(true));
  ipcMain.handle('updates-install', () => controller!.install());
  ipcMain.handle('updates-rollback', () => controller!.rollback());

  controller.start();
}

/** Called at the start of an orderly quit: Automatic mode installs a downloaded update. */
export function installUpdateOnQuit(): void {
  try {
    controller?.onQuit();
  } catch (err) {
    log.warn('updater', 'Install on quit failed', { err: String(err) });
  }
}
