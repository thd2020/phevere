/**
 * Android updates from GitHub Releases, with the desktop's release rules
 * (@phevere/core/update-releases). The native side (AppUpdate.java) reads GitHub, downloads and
 * verifies the APK and opens the system installer; this module decides what and when.
 *
 * - auto: on an unmetered network, download the APK in the background, verify it, then show the
 *   system install prompt. Android always asks before installing a sideloaded APK.
 * - ask: notify, and download only after the user taps Update now.
 * - off: check only on Check now.
 *
 * Android cannot install a lower versionCode without an uninstall, which deletes the notebook, so
 * there is no rollback. Debug builds carry a key no release APK matches, so they get the release
 * page instead of an install.
 */
import {
  DOWNLOAD_BASE,
  LATEST_PAGE,
  RELEASES_API,
  assetNameFor,
  latestReleaseWithoutApi,
  newestUpdate,
  parseVersion,
  releasesFromGitHub,
  sha256FromSumFile,
  versionFromReleaseUrl,
  withLatest,
  type InstallTarget,
  type Release,
  type UpdateChoice,
} from '@phevere/core/update-releases';
import { formatPercent, t, type MessageKey } from '@phevere/core/i18n/runtime';

export const FIRST_CHECK_MS = 30_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** How soon a waiting install prompt looks again for a moment when the app is in front and idle. */
const IDLE_RETRY_MS = 10_000;

export type UpdateMode = 'auto' | 'ask' | 'off';
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

/** The modes in the order Settings lists them; labelKey is read when the section is drawn. */
export const UPDATE_MODES: Array<{ id: UpdateMode; labelKey: MessageKey }> = [
  { id: 'auto', labelKey: 'mobile.update.mode.auto' },
  { id: 'ask', labelKey: 'mobile.update.mode.ask' },
  { id: 'off', labelKey: 'mobile.update.mode.off' },
];

export interface PhoneUpdateState {
  current: string;
  mode: UpdateMode;
  /** False on a debug build: the action then opens the release page. */
  canInstall: boolean;
  status: UpdateStatus;
  upToDate: boolean;
  available: { version: string; page: string } | null;
  progress: number;
  error: string | null;
  /** The last install opened Install unknown apps instead of the installer. */
  needsPermission: boolean;
}

export interface AppInfo {
  versionName: string;
  debuggable: boolean;
  installsAllowed: boolean;
  metered: boolean;
}

export interface FetchRequest {
  url: string;
  etag?: string;
  head?: boolean;
  /** False reads a redirect's Location instead of following it. */
  redirect?: boolean;
}

export interface FetchResponse {
  status: number;
  text: string;
  etag: string;
  location: string;
}

export interface ReleaseCache {
  etag: string | null;
  releases: Release[];
}

export interface PhoneUpdateDeps {
  info(): Promise<AppInfo>;
  fetch(req: FetchRequest): Promise<FetchResponse>;
  /** Downloads and verifies; answers the file name in the app's cache. */
  download(req: { url: string; name: string; sha256: string; size: number }): Promise<{ name: string }>;
  /** Shows the system prompt; needsPermission when Install unknown apps opened instead. */
  install(name: string): Promise<{ needsPermission?: boolean }>;
  openPage(url: string): void;
  /** A release appeared or finished downloading. */
  notify(text: string): void;
  /** True while a lookup runs or the app is in the background, so no prompt interrupts it. */
  busy(): boolean;
  loadMode(): UpdateMode;
  saveMode(mode: UpdateMode): void;
  loadCache(): ReleaseCache | null;
  saveCache(cache: ReleaseCache): void;
  changed(state: PhoneUpdateState): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

/** "4.1.0-dev.812+abc" (a debug build) → "4.1.0". */
export function installedVersion(versionName: string): string {
  const base = String(versionName || '').split(/[-+]/)[0];
  return parseVersion(base) ? base : '';
}

export function asMode(raw: unknown): UpdateMode {
  return raw === 'ask' || raw === 'off' || raw === 'auto' ? raw : 'auto';
}

/** Automatic checks skip Off, and skip a metered network in Automatically; Check now always runs. */
export function shouldCheck(mode: UpdateMode, manual: boolean, metered: boolean): boolean {
  if (manual) return true;
  if (mode === 'off') return false;
  return !(mode === 'auto' && metered);
}

const APK: InstallTarget = { kind: 'apk', arch: '' };

export function createPhoneUpdater(deps: PhoneUpdateDeps) {
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimer || ((fn: () => void, ms: number) => setTimeout(fn, ms));
  let current = '';
  let canInstall = false;
  let releases: Release[] = [];
  let offered: UpdateChoice | null = null;
  let readyName: string | null = null;
  let status: UpdateStatus = 'idle';
  let upToDate = false;
  let progress = 0;
  let lastError: string | null = null;
  let needsPermission = false;
  let checking: Promise<void> | null = null;
  let downloading: Promise<string> | null = null;
  let notifiedVersion: string | null = null;
  /** Automatic prompts come once per release per session; Install still works after that. */
  let promptedVersion: string | null = null;
  let installWhenReady = false;
  let lastCheck = 0;
  let idleTimer: unknown = null;

  function state(): PhoneUpdateState {
    return {
      current,
      mode: canInstall ? deps.loadMode() : deps.loadMode() === 'auto' ? 'ask' : deps.loadMode(),
      canInstall,
      status,
      upToDate,
      available: offered ? { version: offered.release.version, page: offered.release.page } : null,
      progress,
      error: lastError,
      needsPermission,
    };
  }

  function emit(): void {
    try {
      deps.changed(state());
    } catch {
      /* a repaint must not stop an update */
    }
  }

  function fail(err: unknown): void {
    status = 'error';
    lastError = err instanceof Error ? err.message : String(err);
    emit();
  }

  /**
   * The latest release from the releases/latest redirect and the .sha256 file beside the APK.
   * Throws when GitHub cannot be reached; null means GitHub answered but the APK is not ready.
   */
  async function latestWithoutApi(): Promise<Release | null> {
    const res = await deps.fetch({ url: LATEST_PAGE, head: true, redirect: false });
    const version = res.location ? versionFromReleaseUrl(res.location) : null;
    if (!version) throw new Error(t('mobile.update.githubAnswered', { status: String(res.status) }));
    const name = assetNameFor(APK, version) as string;
    // The Android job uploads after the desktop ones and can fail: until the APK and its .sha256
    // are there, the release is not one the phone can install, so it is not offered.
    const sums = await deps.fetch({ url: `${DOWNLOAD_BASE}/v${version}/${name}.sha256` });
    const sha256 = sums.status === 200 ? sha256FromSumFile(sums.text, name) : null;
    if (!sha256) return null;
    return latestReleaseWithoutApi(version, res.location, APK, sha256);
  }

  /** The release list from the API (an unchanged list answers 304), else the fallback. */
  async function fetchReleases(): Promise<Release[]> {
    const cache = deps.loadCache();
    let apiError: string;
    try {
      const res = await deps.fetch({ url: RELEASES_API, etag: cache?.etag || undefined });
      if (res.status === 304 && cache) return cache.releases;
      if (res.status === 200) {
        const list = releasesFromGitHub(JSON.parse(res.text));
        deps.saveCache({ etag: res.etag || null, releases: list });
        return list;
      }
      apiError = t('mobile.update.githubAnswered', { status: String(res.status) });
    } catch (err) {
      apiError = err instanceof Error ? err.message : String(err);
    }
    let latest: Release | null;
    try {
      latest = await latestWithoutApi();
    } catch {
      if (cache && cache.releases.length) return cache.releases;
      throw new Error(apiError);
    }
    return withLatest(cache ? cache.releases : [], latest);
  }

  function downloadOnce(choice: UpdateChoice): Promise<string> {
    if (!downloading) {
      const asset = choice.asset!;
      status = 'downloading';
      progress = 0;
      lastError = null;
      emit();
      downloading = (async () => {
        if (!asset.sha256) throw new Error(t('mobile.update.noChecksum', { file: asset.name }));
        const out = await deps.download({ url: asset.url, name: asset.name, sha256: asset.sha256, size: asset.size });
        progress = 1;
        return out.name;
      })().finally(() => {
        downloading = null;
      });
    }
    return downloading;
  }

  async function prompt(): Promise<void> {
    if (!readyName || !offered) return;
    promptedVersion = offered.release.version;
    installWhenReady = false;
    try {
      const out = await deps.install(readyName);
      needsPermission = !!out.needsPermission;
      emit();
    } catch (err) {
      readyName = null;
      fail(err);
    }
  }

  /** Shows the install prompt now, or as soon as the app is in front and idle. */
  function promptWhenIdle(): void {
    if (status !== 'ready' || !readyName || !offered) return;
    if (!installWhenReady && promptedVersion === offered.release.version) return;
    if (deps.busy()) {
      if (idleTimer == null) {
        idleTimer = setTimer(() => {
          idleTimer = null;
          promptWhenIdle();
        }, IDLE_RETRY_MS);
      }
      return;
    }
    void prompt();
  }

  function check(manual = false): Promise<void> {
    if (checking) return checking;
    checking = (async () => {
      const mode = deps.loadMode();
      let metered = true;
      try {
        metered = (await deps.info()).metered;
      } catch {
        /* unknown network: treat as metered */
      }
      if (!shouldCheck(mode, manual, metered)) return;
      lastCheck = now();
      if (status !== 'downloading') status = 'checking';
      lastError = null;
      emit();
      try {
        releases = await fetchReleases();
      } catch (err) {
        fail(new Error(t('mobile.update.unreachable', { detail: err instanceof Error ? err.message : String(err) })));
        return;
      }
      const choice = newestUpdate(releases, current, APK);
      if (choice?.release.version !== offered?.release.version) readyName = null;
      offered = choice;
      upToDate = !choice;
      if (!choice) {
        if (!downloading) status = 'idle';
        emit();
        return;
      }
      const version = choice.release.version;
      const fresh = notifiedVersion !== version;
      notifiedVersion = version;
      if (mode === 'auto' && canInstall) {
        try {
          readyName = readyName ?? (await downloadOnce(choice));
          status = 'ready';
          emit();
          if (fresh) deps.notify(t('mobile.update.notify.ready', { version }));
          promptWhenIdle();
        } catch (err) {
          fail(err);
        }
        return;
      }
      if (!downloading) status = readyName ? 'ready' : 'idle';
      emit();
      if (fresh && !manual) deps.notify(t('mobile.update.notify.available', { version }));
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  return {
    /** Reads the installed version; false where this build has no version to compare. */
    async init(): Promise<boolean> {
      const info = await deps.info();
      current = installedVersion(info.versionName);
      canInstall = !info.debuggable;
      return !!current;
    },
    start(): void {
      const tick = () => {
        void check(false);
        setTimer(tick, CHECK_EVERY_MS);
      };
      setTimer(tick, FIRST_CHECK_MS);
    },
    state,
    check: () => check(true),
    /** Update now or Install: download if needed, then the system prompt. Debug builds open the page. */
    async install(): Promise<void> {
      const choice = offered;
      if (!choice) return;
      if (!canInstall || !choice.asset) {
        deps.openPage(choice.release.page);
        return;
      }
      installWhenReady = true;
      try {
        readyName = readyName ?? (await downloadOnce(choice));
        status = 'ready';
        emit();
        promptWhenIdle();
      } catch (err) {
        fail(err);
      }
    },
    setMode(mode: UpdateMode): void {
      if (!canInstall && mode === 'auto') return;
      deps.saveMode(mode);
      emit();
      if (mode !== 'off') void check(false);
    },
    progress(done: number, total: number): void {
      if (status !== 'downloading' || !(total > 0)) return;
      progress = Math.max(0, Math.min(0.99, done / total));
      emit();
    },
    /** The app came back to the front: resume after Install unknown apps, or catch up on a check. */
    async resume(): Promise<void> {
      if (needsPermission) {
        try {
          if ((await deps.info()).installsAllowed) {
            needsPermission = false;
            installWhenReady = true;
            emit();
          }
        } catch {
          /* ask again on the next tap */
        }
      }
      promptWhenIdle();
      if (lastCheck && now() - lastCheck >= CHECK_EVERY_MS) void check(false);
    },
  };
}

export type PhoneUpdater = ReturnType<typeof createPhoneUpdater>;

/** The line under the version, as on the desktop; empty when there is nothing to say. */
export function updateStatusText(s: PhoneUpdateState): string {
  const next = s.available?.version;
  if (s.status === 'checking') return t('mobile.update.status.checking');
  if (s.status === 'downloading') {
    return t('mobile.update.status.downloading', { version: next || '', percent: formatPercent(Math.round(s.progress * 100) / 100) });
  }
  if (s.status === 'error') return s.error || t('mobile.update.status.failed');
  if (s.status === 'ready') {
    return s.needsPermission ? t('mobile.update.status.needsPermission') : t('mobile.update.status.ready', { version: next || '' });
  }
  if (next) return t('mobile.update.status.available', { version: next });
  if (s.upToDate) return t('mobile.update.status.upToDate');
  return '';
}

/** The action button's label, or '' when it is hidden. */
export function updateActionText(s: PhoneUpdateState): string {
  if (!s.available || s.status === 'checking' || s.status === 'downloading') return '';
  if (!s.canInstall) return t('mobile.update.action.download');
  return s.status === 'ready' ? t('mobile.update.action.install') : t('mobile.update.action.updateNow');
}
