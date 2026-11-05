/**
 * The desktop update flow without Electron: checks on a timer, Automatic and Ask behaviour,
 * the skipped version after a rollback, and the rollback itself. src/services/app-updater.ts
 * supplies electron-updater, storage, notifications and the window checks.
 * Tests: scripts/test-app-update.js.
 */

import {
  effectiveMode,
  isUpdateOffered,
  nextCheckDelay,
  recordLaunch,
  rollbackTarget,
  startRollback,
  updateCapabilities,
  UPDATE_TIMING,
  type UpdateMode,
  type UpdateState,
  type UpdateTarget,
} from '@phevere/core';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'check-failed'
  | 'download-failed'
  | 'rollback-failed';

/** What the Settings page shows. */
export interface UpdateView {
  version: string;
  modes: UpdateMode[];
  mode: UpdateMode;
  lastCheck: number | null;
  phase: UpdatePhase;
  /** The newer version that is offered, when there is one. */
  available: string | null;
  /** 0 to 1 while downloading. */
  progress: number | null;
  /** Which button the page shows next to Check now. */
  action: 'update' | 'download' | 'restart' | null;
  /** The version "Roll back" installs, or null when there is none. */
  rollbackTo: string | null;
}

/** One electron-updater instance, reduced to what the flow uses. */
export interface UpdaterPort {
  /** Latest version on the feed, or null when the feed has nothing for this build. */
  check(): Promise<string | null>;
  download(onProgress: (fraction: number) => void): Promise<void>;
  /** Runs the downloaded installer and quits; `relaunch` starts the new version afterwards. */
  quitAndInstall(relaunch: boolean): void;
  /** Runs the downloaded installer without relaunching; used while Phevere quits. */
  installOnQuit(): void;
}

export interface UpdateDeps {
  target: UpdateTarget;
  version: string;
  now(): number;
  loadState(): UpdateState;
  saveState(state: UpdateState): void;
  /** The updater for the normal GitHub feed (not used on macOS). */
  updater(): UpdaterPort;
  /** An updater whose feed is one release's own update file, allowed to downgrade. */
  rollbackUpdater(version: string): UpdaterPort;
  /** macOS: the newest release's version from GitHub. */
  latestVersion(): Promise<string | null>;
  /** Published versions, newest first, for choosing a rollback target. */
  publishedVersions(): Promise<string[]>;
  /** True when that release has the update file this build needs. */
  hasUpdateFile(version: string): Promise<boolean>;
  /** A lookup pop-up or the OCR overlay is open; installs wait for it. */
  isBusy(): boolean;
  notify(message: string): void;
  confirmRollback(version: string): Promise<boolean>;
  openDownload(version: string): void;
  onChange(view: UpdateView): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  log(level: 'info' | 'warn', message: string, meta?: Record<string, unknown>): void;
}

/** electron-updater error codes that mean the release has no update file yet, not a failure. */
const NO_FEED_CODES = new Set([
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
]);

function errorInfo(err: unknown): { code?: string; status?: number; message: string } {
  const e = err as { code?: unknown; statusCode?: unknown; message?: unknown };
  return {
    code: typeof e?.code === 'string' ? e.code : undefined,
    status: typeof e?.statusCode === 'number' ? e.statusCode : undefined,
    message: String(e?.message ?? err).slice(0, 300),
  };
}

const BUSY_POLL_MS = 3_000;

export class UpdateController {
  private state: UpdateState;
  private mode: UpdateMode;
  private phase: UpdatePhase = 'idle';
  private available: string | null = null;
  private progress: number | null = null;
  private timer: unknown = null;
  private rollbackTo: string | null = null;
  private installing = false;
  /** Ask, Off, or the button: install as soon as the download finishes. */
  private installAfterDownload = false;
  private readonly caps;

  constructor(private readonly deps: UpdateDeps) {
    this.caps = updateCapabilities(deps.target);
    this.state = recordLaunch(deps.loadState() || {}, deps.version);
    this.mode = effectiveMode(this.state.mode, deps.target);
    this.deps.saveState(this.state);
  }

  /** Starts the timer; the first check runs after the startup delay. */
  start(): void {
    if (!this.caps.modes.length) return;
    this.schedule(true);
    void this.refreshRollbackTarget();
  }

  view(): UpdateView {
    const ready = this.phase === 'ready';
    const offered = this.available && (this.phase === 'available' || this.phase === 'download-failed');
    return {
      version: this.deps.version,
      modes: this.caps.modes,
      mode: this.mode,
      lastCheck: this.state.lastCheck ?? null,
      phase: this.phase,
      available: this.available,
      progress: this.progress,
      action: ready ? 'restart' : offered ? (this.deps.target === 'mac' ? 'download' : 'update') : null,
      rollbackTo: this.caps.rollback && !this.installing ? this.rollbackTo : null,
    };
  }

  setMode(mode: UpdateMode): UpdateView {
    if (!this.caps.modes.includes(mode)) return this.view();
    this.mode = mode;
    this.save({ mode });
    this.deps.log('info', 'Update mode changed', { mode });
    if (mode === 'off') {
      this.clearTimer();
    } else if (mode === 'auto' && this.phase === 'available' && this.available) {
      void this.download(false);
    } else if (!this.timer) {
      this.schedule(true);
    }
    return this.emit();
  }

  /** One check. `manual` is the Check now button: it also works in Off and never notifies. */
  async check(manual = false): Promise<UpdateView> {
    if (!this.caps.modes.length || this.installing) return this.view();
    if (this.phase === 'checking' || this.phase === 'downloading') return this.view();
    if (this.phase === 'ready') {
      if (!manual) this.schedule(false);
      return this.view();
    }
    this.clearTimer();
    this.phase = 'checking';
    this.emit();
    let retryAfterMs: number | undefined;
    try {
      const latest = this.deps.target === 'mac' ? await this.deps.latestVersion() : await this.deps.updater().check();
      this.save({ lastCheck: this.deps.now(), failures: 0 });
      this.onLatest(latest, manual);
    } catch (err) {
      const info = errorInfo(err);
      if (info.code && NO_FEED_CODES.has(info.code)) {
        this.deps.log('info', 'Latest release has no update file yet', { code: info.code });
        this.save({ lastCheck: this.deps.now(), failures: 0 });
        this.onLatest(null, manual);
      } else {
        if (info.status === 403 || info.status === 429) retryAfterMs = UPDATE_TIMING.intervalMs;
        this.save({ failures: (this.state.failures || 0) + 1 });
        this.phase = 'check-failed';
        this.deps.log('warn', 'Update check failed', { ...info, failures: this.state.failures });
      }
    }
    this.schedule(false, retryAfterMs);
    void this.refreshRollbackTarget();
    return this.emit();
  }

  private onLatest(latest: string | null, manual: boolean): void {
    if (!latest || !isUpdateOffered(latest, this.deps.version, this.state.skipVersion)) {
      this.available = null;
      this.phase = 'up-to-date';
      if (latest) this.deps.log('info', 'No update offered', { latest, skip: this.state.skipVersion || null });
      return;
    }
    this.available = latest;
    this.phase = 'available';
    this.deps.log('info', 'Update available', { latest, mode: this.mode });
    if (this.mode === 'auto' && this.deps.target !== 'mac') {
      void this.download(false);
      return;
    }
    if (!manual && this.state.notifiedVersion !== latest) {
      this.save({ notifiedVersion: latest });
      this.deps.notify(`Phevere ${latest} is available`);
    }
  }

  /** The button next to Check now: update (download, then install), restart, or open the download. */
  async install(): Promise<UpdateView> {
    if (this.installing) return this.view();
    if (this.deps.target === 'mac') {
      if (this.available) this.deps.openDownload(this.available);
      return this.view();
    }
    if (this.phase === 'ready') {
      this.installWhenIdle(() => this.deps.updater().quitAndInstall(true));
      return this.view();
    }
    if (this.available && (this.phase === 'available' || this.phase === 'download-failed')) {
      await this.download(true);
    }
    return this.view();
  }

  private async download(installAfter: boolean): Promise<void> {
    if (this.phase === 'downloading') {
      this.installAfterDownload ||= installAfter;
      return;
    }
    this.installAfterDownload = installAfter;
    this.phase = 'downloading';
    this.progress = 0;
    this.emit();
    try {
      await this.deps.updater().download((fraction) => {
        this.progress = fraction;
        this.emit();
      });
      this.phase = 'ready';
      this.progress = null;
      this.deps.log('info', 'Update downloaded', { version: this.available });
      this.emit();
      if (this.installAfterDownload) this.installWhenIdle(() => this.deps.updater().quitAndInstall(true));
    } catch (err) {
      this.phase = 'download-failed';
      this.progress = null;
      this.deps.log('warn', 'Update download failed', errorInfo(err));
      this.emit();
    }
  }

  /** Called while Phevere quits: Automatic installs the downloaded update now, without relaunching. */
  onQuit(): void {
    if (this.installing || this.mode !== 'auto' || this.phase !== 'ready') return;
    if (!this.caps.modes.includes('auto')) return;
    this.installing = true;
    this.deps.log('info', 'Installing the downloaded update on quit', { version: this.available });
    try {
      this.deps.updater().installOnQuit();
    } catch (err) {
      this.deps.log('warn', 'Install on quit failed', errorInfo(err));
    }
  }

  /** Installs `rollbackTo` after the user confirms; the version left is skipped from then on. */
  async rollback(): Promise<UpdateView> {
    const to = this.caps.rollback ? this.rollbackTo : null;
    if (!to || this.installing || this.phase === 'downloading') return this.view();
    if (!(await this.deps.confirmRollback(to))) return this.view();
    this.clearTimer();
    this.phase = 'downloading';
    this.progress = 0;
    this.emit();
    try {
      const updater = this.deps.rollbackUpdater(to);
      const found = await updater.check();
      if (found !== to) throw new Error(`Release ${to} offered ${found ?? 'nothing'}`);
      await updater.download((fraction) => {
        this.progress = fraction;
        this.emit();
      });
      this.deps.log('info', 'Rolling back', { from: this.deps.version, to });
      this.installWhenIdle(() => {
        this.state = startRollback(this.state, this.deps.version);
        this.deps.saveState(this.state);
        updater.quitAndInstall(true);
      });
    } catch (err) {
      this.phase = 'rollback-failed';
      this.progress = null;
      this.deps.log('warn', 'Rollback failed', errorInfo(err));
      this.schedule(false);
      this.emit();
    }
    return this.view();
  }

  /** Waits until no lookup pop-up is open, then runs the install. */
  private installWhenIdle(run: () => void): void {
    this.installing = true;
    this.phase = 'installing';
    this.progress = null;
    this.clearTimer();
    this.emit();
    const attempt = () => {
      if (this.deps.isBusy()) {
        this.deps.setTimer(attempt, BUSY_POLL_MS);
        return;
      }
      try {
        run();
      } catch (err) {
        this.installing = false;
        this.phase = this.available ? 'ready' : 'idle';
        this.deps.log('warn', 'Starting the installer failed', errorInfo(err));
        this.emit();
      }
    };
    attempt();
  }

  private async refreshRollbackTarget(): Promise<void> {
    if (!this.caps.rollback) return;
    try {
      const recorded = rollbackTarget(this.state, this.deps.version);
      let to = recorded && (await this.deps.hasUpdateFile(recorded)) ? recorded : null;
      if (!to) {
        const published = await this.deps.publishedVersions();
        const fallback = rollbackTarget({}, this.deps.version, published);
        to = fallback && (await this.deps.hasUpdateFile(fallback)) ? fallback : null;
      }
      if (to !== this.rollbackTo) {
        this.rollbackTo = to;
        this.emit();
      }
    } catch (err) {
      this.deps.log('info', 'Could not look up a rollback target', errorInfo(err));
    }
  }

  private schedule(startup: boolean, retryAfterMs?: number): void {
    this.clearTimer();
    if (this.mode === 'off' || this.installing) return;
    const ms = nextCheckDelay({
      now: this.deps.now(),
      lastCheck: this.state.lastCheck,
      failures: this.state.failures,
      startup,
      retryAfterMs,
    });
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.check(false);
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private save(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.saveState(this.state);
  }

  private emit(): UpdateView {
    const view = this.view();
    this.deps.onChange(view);
    return view;
  }
}
