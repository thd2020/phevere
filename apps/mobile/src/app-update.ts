/**
 * Android updates from GitHub releases. The release workflow publishes latest-android.yml
 * (scripts/update-metadata.js) beside the APK. Automatic downloads the APK in the background
 * and then shows the system install prompt; Ask first tells the user and installs only after
 * they tap Update; Off never checks. Android cannot install an older version code over a newer
 * one, so there is no rollback. The rules are shared with the desktop (update-policy.ts).
 */
import {
  effectiveMode,
  isUpdateOffered,
  nextCheckDelay,
  parseUpdateMetadata,
  pickUpdateFile,
  recordLaunch,
  updateCapabilities,
  type UpdateFile,
  type UpdateMode,
  type UpdateState,
} from '@phevere/core';

export const ANDROID_FEED = 'https://github.com/thd2020/phevere/releases/latest/download/latest-android.yml';
const RELEASE_DOWNLOAD = 'https://github.com/thd2020/phevere/releases/download/';
/** How soon a deferred install prompt looks again for a quiet moment. */
const IDLE_RETRY_MS = 10_000;

export type PhonePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';

export interface PhoneUpdateView {
  version: string;
  mode: UpdateMode;
  modes: UpdateMode[];
  lastCheck: number | null;
  phase: PhonePhase;
  /** The release on offer. */
  available: string | null;
  /** Download progress, 0 to 1. */
  progress: number;
  /** The last install prompt was replaced by the "install unknown apps" page. */
  needsPermission: boolean;
}

export interface PhoneUpdateDeps {
  version: string;
  /** Debug builds carry a debug signature that a release APK cannot replace. */
  debuggable: boolean;
  fetchText(url: string): Promise<{ status: number; text: string }>;
  download(req: { url: string; name: string; sha512: string; size: number }): Promise<{ name: string }>;
  /** Shows the system prompt; needsPermission when the "install unknown apps" page opened instead. */
  install(name: string): Promise<{ needsPermission?: boolean }>;
  /** Called for Ask first when a release first appears. */
  announce(version: string): void;
  /** True while a lookup runs or the app is in the background, so no prompt interrupts it. */
  busy(): boolean;
  /** Whether Android now lets Phevere install apps (after the permission page). */
  canInstall(): Promise<boolean>;
  loadState(): UpdateState;
  saveState(state: UpdateState): void;
  onChange(): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Offer {
  version: string;
  file: UpdateFile;
}

export function createPhoneUpdater(deps: PhoneUpdateDeps) {
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimer || ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const supported = !deps.debuggable && !!deps.version;
  const target = supported ? 'android' : 'none';
  let state: UpdateState = recordLaunch(deps.loadState(), deps.version);
  if (supported) deps.saveState(state);
  let phase: PhonePhase = 'idle';
  let offer: Offer | null = null;
  let downloaded: string | null = null;
  let progress = 0;
  let needsPermission = false;
  let timer: unknown = null;
  let idleTimer: unknown = null;
  /** Automatic prompts once per release per session; the user can still tap Install. */
  let promptedVersion = '';
  let installWhenReady = false;

  const mode = (): UpdateMode => effectiveMode(state.mode, target);
  const save = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    deps.saveState(state);
  };
  const set = (next: PhonePhase) => {
    phase = next;
    deps.onChange();
  };

  function schedule(startup: boolean, retryAfterMs?: number): void {
    if (timer != null) clearTimer(timer);
    timer = null;
    if (!supported || mode() === 'off') return;
    const ms = nextCheckDelay({ now: now(), lastCheck: state.lastCheck, failures: state.failures, startup, retryAfterMs });
    timer = setTimer(() => {
      timer = null;
      void check(false);
    }, ms);
  }

  async function check(manual: boolean): Promise<void> {
    if (!supported || (!manual && mode() === 'off')) return;
    if (phase === 'checking' || phase === 'downloading') return;
    set('checking');
    let retryAfterMs: number | undefined;
    try {
      const res = await deps.fetchText(ANDROID_FEED);
      if (res.status === 403 || res.status === 429) {
        retryAfterMs = 4 * 60 * 60_000;
        throw new Error(`HTTP ${res.status}`);
      }
      // A release still uploading has no metadata yet: nothing to offer.
      const meta = res.status === 404 ? null : res.status >= 200 && res.status < 300 ? parseUpdateMetadata(res.text) : undefined;
      if (meta === undefined) throw new Error(`HTTP ${res.status}`);
      const file = meta ? pickUpdateFile(meta.files, 'apk') : null;
      save({ lastCheck: now(), failures: 0 });
      if (!meta || !file || !isUpdateOffered(meta.version, deps.version, state.skipVersion)) {
        offer = null;
        set('up-to-date');
      } else {
        const fresh = offer?.version !== meta.version;
        offer = { version: meta.version, file };
        if (fresh && downloaded !== meta.version) downloaded = null;
        set(downloaded === meta.version ? 'ready' : 'available');
        if (mode() === 'auto') await fetchUpdate(false);
        else if (state.notifiedVersion !== meta.version) {
          save({ notifiedVersion: meta.version });
          deps.announce(meta.version);
        }
      }
    } catch {
      save({ failures: (state.failures || 0) + 1 });
      set(offer && downloaded === offer.version ? 'ready' : 'error');
    }
    schedule(false, retryAfterMs);
  }

  async function fetchUpdate(userAsked: boolean): Promise<void> {
    if (!offer) return;
    if (userAsked) installWhenReady = true;
    if (downloaded !== offer.version) {
      const current = offer;
      progress = 0;
      set('downloading');
      try {
        const out = await deps.download({
          url: `${RELEASE_DOWNLOAD}v${current.version}/${encodeURIComponent(current.file.url)}`,
          name: current.file.url,
          sha512: current.file.sha512,
          size: current.file.size,
        });
        downloaded = current.version;
        offer = { ...current, file: { ...current.file, url: out.name || current.file.url } };
      } catch {
        set('error');
        return;
      }
      set('ready');
    }
    if (installWhenReady || mode() === 'auto') promptWhenIdle();
  }

  /** Shows the install prompt now, or the next time the app is idle in the foreground. */
  function promptWhenIdle(): void {
    if (!offer || downloaded !== offer.version) return;
    if (!installWhenReady && promptedVersion === offer.version) return;
    if (deps.busy()) {
      // A lookup is running or the app is in the background: look again shortly.
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

  async function prompt(): Promise<void> {
    if (!offer || downloaded !== offer.version) return;
    promptedVersion = offer.version;
    installWhenReady = false;
    try {
      const out = await deps.install(offer.file.url);
      needsPermission = !!out.needsPermission;
    } catch {
      downloaded = null;
      set('available');
      return;
    }
    deps.onChange();
  }

  return {
    supported,
    start(): void {
      schedule(true);
    },
    view(): PhoneUpdateView | null {
      if (!supported) return null;
      return {
        version: deps.version,
        mode: mode(),
        modes: updateCapabilities(target).modes,
        lastCheck: state.lastCheck ?? null,
        phase,
        available: offer?.version ?? null,
        progress,
        needsPermission,
      };
    },
    setMode(next: UpdateMode): void {
      if (!updateCapabilities(target).modes.includes(next)) return;
      save({ mode: next });
      deps.onChange();
      schedule(true);
      if (next === 'auto' && offer) void fetchUpdate(false);
    },
    check: () => check(true),
    /** "Update to …" or "Install": downloads if needed, then shows the system prompt. */
    install: () => fetchUpdate(true),
    progress(done: number, total: number): void {
      if (phase !== 'downloading' || !(total > 0)) return;
      progress = Math.max(0, Math.min(1, done / total));
      deps.onChange();
    },
    /** The app came back to the foreground or a lookup finished. */
    idle(): void {
      if (!needsPermission) {
        promptWhenIdle();
        return;
      }
      // Back from the permission page: prompt only when the permission was granted.
      void deps.canInstall().then((ok) => {
        if (!ok || !needsPermission) return;
        needsPermission = false;
        installWhenReady = true;
        deps.onChange();
        promptWhenIdle();
      }, () => undefined);
    },
  };
}

export type PhoneUpdater = ReturnType<typeof createPhoneUpdater>;

/** "Today 14:05", "Yesterday 09:12", "3 Nov 14:05" or "Never". */
export function lastCheckedText(at: number | null, now = Date.now()): string {
  if (!at) return 'Never';
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (t: number) => new Date(t).toDateString();
  if (day(at) === day(now)) return `Today ${hm}`;
  if (day(at) === day(now - 86_400_000)) return `Yesterday ${hm}`;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${d.getDate()} ${month} ${hm}`;
}

/** The short status beside Last checked; empty when there is nothing to say. */
export function updateStatusText(v: PhoneUpdateView): string {
  switch (v.phase) {
    case 'checking':
      return 'Checking…';
    case 'up-to-date':
      return 'Up to date';
    case 'available':
      return `${v.available} available`;
    case 'downloading':
      return `Downloading ${Math.round(v.progress * 100)}%`;
    case 'ready':
      return v.needsPermission ? 'Allow installs from Phevere' : `${v.available} ready to install`;
    case 'error':
      return 'Check failed';
    default:
      return '';
  }
}
