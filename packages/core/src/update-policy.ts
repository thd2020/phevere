/**
 * Update rules shared by the desktop updater (src/services/app-updater.ts) and the Android
 * check (apps/mobile/src/app-update.ts): which modes a build offers, when a release is offered,
 * which version a rollback installs, how often to check, and how to read a release's
 * update metadata file (latest.yml, written by scripts/update-metadata.js).
 */

/** Automatic installs in the background, Ask installs after the user confirms, Off never checks. */
export type UpdateMode = 'auto' | 'ask' | 'off';

/** How this copy of Phevere was installed, which decides what an update can do. */
export type UpdateTarget = 'windows' | 'appimage' | 'deb' | 'rpm' | 'mac' | 'android' | 'none';

export interface UpdateCapabilities {
  modes: UpdateMode[];
  rollback: boolean;
}

/**
 * Windows (NSIS) and AppImage replace themselves without a prompt, so they get all three modes.
 * deb and rpm need the administrator password to install, and the unsigned macOS build cannot
 * replace itself, so they only ask. Android always shows the system install prompt, so its
 * Automatic mode downloads in the background and then shows that prompt. Android cannot install
 * a lower version code over a higher one, and rpm tools refuse a lower version, so neither rolls back.
 */
export function updateCapabilities(target: UpdateTarget): UpdateCapabilities {
  switch (target) {
    case 'windows':
    case 'appimage':
      return { modes: ['auto', 'ask', 'off'], rollback: true };
    case 'deb':
      return { modes: ['ask', 'off'], rollback: true };
    case 'rpm':
    case 'mac':
      return { modes: ['ask', 'off'], rollback: false };
    case 'android':
      return { modes: ['auto', 'ask', 'off'], rollback: false };
    default:
      return { modes: [], rollback: false };
  }
}

/** The stored mode when this build offers it, otherwise Automatic, otherwise Ask. */
export function effectiveMode(stored: unknown, target: UpdateTarget): UpdateMode {
  const { modes } = updateCapabilities(target);
  if (!modes.length) return 'off';
  if (typeof stored === 'string' && (modes as string[]).includes(stored)) return stored as UpdateMode;
  return modes.includes('auto') ? 'auto' : 'ask';
}

export const UPDATE_MODE_LABELS: Record<UpdateMode, string> = {
  auto: 'Automatic',
  ask: 'Ask first',
  off: 'Off',
};

/** What the updater remembers between launches. */
export interface UpdateState {
  mode?: UpdateMode;
  /** When the last check finished without an error (ms since the epoch). */
  lastCheck?: number;
  /** The version that ran last time, to notice that an update was installed. */
  lastRunVersion?: string;
  /** The version that ran before the last update; a rollback installs it. */
  previousVersion?: string;
  /** Set by a rollback: this version and older ones are not offered again. */
  skipVersion?: string;
  /** The newest version the user was already told about, so Ask notifies once per release. */
  notifiedVersion?: string;
  /** Checks that failed in a row, for the back-off. */
  failures?: number;
}

/** Major.minor.patch with an optional prerelease; null when the text is not a version. */
export function parseVersion(v: unknown): { nums: [number, number, number]; pre: string } | null {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' };
}

/** Semver order: -1, 0 or 1. A version that does not parse sorts below every real version. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const xp = x.pre.split('.');
  const yp = y.pre.split('.');
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    if (xp[i] === undefined) return -1;
    if (yp[i] === undefined) return 1;
    const xn = /^\d+$/.test(xp[i]);
    const yn = /^\d+$/.test(yp[i]);
    if (xn && yn && Number(xp[i]) !== Number(yp[i])) return Number(xp[i]) < Number(yp[i]) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    if (xp[i] !== yp[i]) return xp[i] < yp[i] ? -1 : 1;
  }
  return 0;
}

/** The newest version that shipped without the updater. A rollback never goes back that far. */
export const LAST_VERSION_WITHOUT_UPDATER = '4.0.0';

/**
 * Called once at startup. Records the version that ran before an update, drops a recorded
 * previous version that is no longer older than this one (after a rollback), and clears the
 * skipped version once something newer than it runs.
 */
export function recordLaunch(state: UpdateState, current: string): UpdateState {
  const next: UpdateState = { ...state };
  const last = state.lastRunVersion;
  if (last && parseVersion(last) && compareVersions(current, last) > 0) next.previousVersion = last;
  if (next.previousVersion && compareVersions(next.previousVersion, current) >= 0) delete next.previousVersion;
  if (next.skipVersion && compareVersions(current, next.skipVersion) > 0) delete next.skipVersion;
  next.lastRunVersion = current;
  return next;
}

/** True when `latest` should be offered: newer than what runs, and newer than a rolled-back version. */
export function isUpdateOffered(latest: string, current: string, skipVersion?: string): boolean {
  if (!parseVersion(latest) || compareVersions(latest, current) <= 0) return false;
  return !skipVersion || compareVersions(latest, skipVersion) > 0;
}

/** Before a rollback starts: skip the version being left until a newer one is published. */
export function startRollback(state: UpdateState, from: string): UpdateState {
  return { ...state, skipVersion: from };
}

function rollbackCandidate(v: string | undefined, current: string): boolean {
  if (!v) return false;
  const p = parseVersion(v);
  if (!p || p.pre) return false;
  return compareVersions(v, current) < 0 && compareVersions(v, LAST_VERSION_WITHOUT_UPDATER) > 0;
}

/**
 * The version a rollback installs: the one that ran before the last update when it is known,
 * otherwise the newest published release older than this one. Versions without the updater
 * and prereleases are never chosen. `published` is the release list when it is known; a
 * recorded version missing from a known list (a deleted release) is passed over.
 */
export function rollbackTarget(state: UpdateState, current: string, published?: string[]): string | null {
  const list = published?.map((t) => t.replace(/^v/, ''));
  if (rollbackCandidate(state.previousVersion, current) && (!list || list.includes(state.previousVersion!))) {
    return state.previousVersion!;
  }
  if (!list) return null;
  const older = list.filter((v) => rollbackCandidate(v, current)).sort(compareVersions);
  return older.length ? older[older.length - 1] : null;
}

export const UPDATE_TIMING = {
  /** First check after startup, so the check never competes with opening the app. */
  startupDelayMs: 45_000,
  /** Regular checks. */
  intervalMs: 4 * 60 * 60_000,
  /** Restarting often does not re-check within this gap. */
  minGapMs: 30 * 60_000,
  /** First retry after a failed check; it doubles up to the regular interval. */
  retryBaseMs: 5 * 60_000,
};

/**
 * Milliseconds until the next check. At startup: after the startup delay, or later when the
 * last check was recent, whatever failed before. After failures: 5, 10, 20 … minutes, at most
 * the regular interval.
 * `retryAfterMs` comes from a rate-limit answer (HTTP 403 or 429) and wins when it is longer.
 */
export function nextCheckDelay(opts: {
  now: number;
  lastCheck?: number;
  failures?: number;
  startup?: boolean;
  retryAfterMs?: number;
}): number {
  const t = UPDATE_TIMING;
  const failures = Math.max(0, opts.failures || 0);
  let delay: number;
  if (opts.startup) {
    // A fresh start retries soon even after failures: the network may be back.
    const sinceLast = opts.lastCheck ? opts.now - opts.lastCheck : Infinity;
    delay = sinceLast >= 0 && sinceLast < t.minGapMs ? t.minGapMs - sinceLast : 0;
  } else if (failures > 0) {
    delay = Math.min(t.intervalMs, t.retryBaseMs * 2 ** (failures - 1));
  } else {
    delay = t.intervalMs;
  }
  if (opts.retryAfterMs && opts.retryAfterMs > delay) delay = opts.retryAfterMs;
  return opts.startup ? Math.max(t.startupDelayMs, delay) : delay;
}

/** One file listed in a release's update metadata. */
export interface UpdateFile {
  url: string;
  sha512: string;
  size: number;
}

export interface UpdateMetadata {
  version: string;
  files: UpdateFile[];
  releaseDate?: string;
}

function unquote(v: string): string {
  const s = v.trim();
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

/**
 * Reads the subset of electron-builder's latest.yml format that scripts/update-metadata.js
 * writes: version, releaseDate and a files list of url, sha512 and size. Null when the text
 * has no version or no files.
 */
export function parseUpdateMetadata(text: string): UpdateMetadata | null {
  const out: UpdateMetadata = { version: '', files: [] };
  let inFiles = false;
  let file: Partial<UpdateFile> | null = null;
  const flush = () => {
    if (file?.url && file.sha512) out.files.push({ url: file.url, sha512: file.sha512, size: Number(file.size) || 0 });
    file = null;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const top = /^([A-Za-z]+):\s*(.*)$/.exec(raw);
    if (top) {
      flush();
      inFiles = top[1] === 'files';
      if (top[1] === 'version') out.version = unquote(top[2]);
      if (top[1] === 'releaseDate') out.releaseDate = unquote(top[2]);
      continue;
    }
    if (!inFiles) continue;
    const item = /^\s*-\s+([A-Za-z0-9]+):\s*(.*)$/.exec(raw);
    const field = item || /^\s+([A-Za-z0-9]+):\s*(.*)$/.exec(raw);
    if (!field) continue;
    if (item) flush();
    file = file || {};
    const value = unquote(field[2]);
    if (field[1] === 'url') file.url = value;
    else if (field[1] === 'sha512') file.sha512 = value;
    else if (field[1] === 'size') file.size = Number(value);
  }
  flush();
  return parseVersion(out.version) && out.files.length ? out : null;
}

/** The file whose name ends with `extension`, preferring one that names `arch` (as electron-updater does). */
export function pickUpdateFile(files: UpdateFile[], extension: string, arch?: string): UpdateFile | null {
  const ext = `.${extension.toLowerCase()}`;
  const matching = files.filter((f) => f.url.toLowerCase().split(/[?#]/)[0].endsWith(ext));
  return (arch && matching.find((f) => f.url.includes(arch))) || matching[0] || null;
}
