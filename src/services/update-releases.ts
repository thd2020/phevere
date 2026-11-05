/**
 * Which GitHub release to install: newer ones for updates, the newest older one for rollback.
 * No Electron imports, so scripts/test-updater.js can run it under plain Node.
 */

export const RELEASES_API = 'https://api.github.com/repos/thd2020/phevere/releases?per_page=50';
/** Redirects to the latest release's page. Not counted against the API's 60 requests an hour. */
export const LATEST_PAGE = 'https://github.com/thd2020/phevere/releases/latest';
export const DOWNLOAD_BASE = 'https://github.com/thd2020/phevere/releases/download';

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  /** Lower-case hex SHA-256 from GitHub's asset digest, or null when GitHub has none. */
  sha256: string | null;
}

export interface Release {
  version: string;
  page: string;
  assets: ReleaseAsset[];
}

/** How this copy of Phevere was installed. Only the Windows installer and AppImage replace themselves. */
export type InstallKind = 'nsis' | 'appimage' | 'manual';

export interface InstallTarget {
  kind: InstallKind;
  arch: string;
}

export interface UpdateChoice {
  release: Release;
  /** Null for a manual install, which only links to the release page. */
  asset: ReleaseAsset | null;
}

export function parseVersion(raw: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(raw || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Published, non-prerelease releases with a plain x.y.z tag, newest first. */
export function releasesFromGitHub(json: unknown): Release[] {
  if (!Array.isArray(json)) return [];
  const out: Release[] = [];
  for (const r of json as any[]) {
    if (!r || r.draft || r.prerelease) continue;
    const parsed = parseVersion(r.tag_name);
    if (!parsed) continue;
    const assets: ReleaseAsset[] = (Array.isArray(r.assets) ? r.assets : []).map((a: any) => {
      const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(a?.digest || ''));
      return {
        name: String(a?.name || ''),
        url: String(a?.browser_download_url || ''),
        size: Number(a?.size) || 0,
        sha256: digest ? digest[1].toLowerCase() : null,
      };
    });
    out.push({ version: parsed.join('.'), page: String(r.html_url || ''), assets });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/** File name release.yml gives the installer for this target, as in Phevere-Setup-4.0.0-x64.exe. */
export function assetNameFor(target: InstallTarget, version: string): string | null {
  if (target.kind === 'nsis') return `Phevere-Setup-${version}-${target.arch}.exe`;
  if (target.kind === 'appimage') return `Phevere-${version}-${target.arch}.AppImage`;
  return null;
}

/** "https://github.com/…/releases/tag/v4.0.0" → "4.0.0". */
export function versionFromReleaseUrl(url: string): string | null {
  const m = /\/releases\/tag\/(v?\d+\.\d+\.\d+)\/?$/.exec(String(url || ''));
  const parsed = m ? parseVersion(m[1]) : null;
  return parsed ? parsed.join('.') : null;
}

/** The hash from a sha256sum line ("<hex>  <name>") for `name`, or null. */
export function sha256FromSumFile(text: string, name: string): string | null {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

/**
 * The latest release as seen without the API: its version from the redirect, this target's
 * installer at its predictable URL, and the hash from the .sha256 file published beside it.
 */
export function latestReleaseWithoutApi(
  version: string,
  pageUrl: string,
  target: InstallTarget,
  sha256: string | null,
): Release {
  const name = assetNameFor(target, version);
  return {
    version,
    page: pageUrl,
    assets: name ? [{ name, url: `${DOWNLOAD_BASE}/v${version}/${name}`, size: 0, sha256 }] : [],
  };
}

/** Releases from the cached API list, with `latest` in front when the cache predates it. */
export function withLatest(cached: Release[], latest: Release | null): Release[] {
  if (!latest || cached.some((r) => r.version === latest.version)) return cached;
  return [latest, ...cached].sort((a, b) => compareVersions(b.version, a.version));
}

function choiceFor(release: Release, target: InstallTarget): UpdateChoice | null {
  const name = assetNameFor(target, release.version);
  if (!name) return { release, asset: null };
  const asset = release.assets.find((a) => a.name === name && a.url);
  return asset ? { release, asset } : null;
}

/**
 * Newest release above `current` that this install can use. `skipped` is the version the user
 * rolled back from; automatic checks pass over it and anything older.
 */
export function newestUpdate(
  releases: Release[],
  current: string,
  target: InstallTarget,
  skipped: string | null = null,
): UpdateChoice | null {
  for (const release of releases) {
    if (compareVersions(release.version, current) <= 0) return null;
    if (skipped && compareVersions(release.version, skipped) <= 0) return null;
    const choice = choiceFor(release, target);
    if (choice) return choice;
  }
  return null;
}

/** Newest release below `current` that has an installer for this target. */
export function rollbackTarget(releases: Release[], current: string, target: InstallTarget): UpdateChoice | null {
  if (target.kind === 'manual') return null;
  for (const release of releases) {
    if (compareVersions(release.version, current) >= 0) continue;
    const choice = choiceFor(release, target);
    if (choice) return choice;
  }
  return null;
}
