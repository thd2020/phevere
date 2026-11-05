/**
 * Connects the Android updater (../app-update.ts) to the native bridge (AppUpdate.java through
 * BridgeRouter: updateInfo, updateFetch, updateDownload, updateInstall) and to localStorage.
 * Returns null without the bridge (browser preview) and where the build has no release version.
 * The caller starts it on Android only; iOS has no update path.
 */
import {
  asMode,
  createPhoneUpdater,
  type AppInfo,
  type FetchRequest,
  type FetchResponse,
  type PhoneUpdateState,
  type PhoneUpdater,
  type ReleaseCache,
  type UpdateMode,
} from '../app-update';
import { hasNativeBridge, nativeCall } from './native';

declare global {
  interface Window {
    __pvUpdateProgress?: (done: number, total: number) => void;
  }
}

const MODE_KEY = 'phevere.mobile.updates';
const CACHE_KEY = 'phevere.mobile.update-releases';

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') as T | null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the value lasts this session only */
  }
}

let sessionMode: UpdateMode | null = null;

export async function startPhoneUpdates(opts: {
  changed(state: PhoneUpdateState): void;
  busy(): boolean;
  notify(text: string): void;
  openPage(url: string): void;
}): Promise<PhoneUpdater | null> {
  if (!hasNativeBridge()) return null;
  const updater = createPhoneUpdater({
    info: () => nativeCall<AppInfo>('updateInfo', {}),
    fetch: (req: FetchRequest) => nativeCall<FetchResponse>('updateFetch', req, 60_000),
    // An APK is large; the bridge timeout covers a slow connection.
    download: (req) => nativeCall<{ name: string }>('updateDownload', req, 60 * 60_000),
    install: (name) => nativeCall<{ needsPermission?: boolean }>('updateInstall', { name }),
    openPage: opts.openPage,
    notify: opts.notify,
    busy: opts.busy,
    loadMode: () => sessionMode ?? asMode(readJson<{ mode?: string }>(MODE_KEY)?.mode),
    saveMode: (mode) => {
      sessionMode = mode;
      writeJson(MODE_KEY, { mode });
    },
    loadCache: () => {
      const cache = readJson<ReleaseCache>(CACHE_KEY);
      return cache && Array.isArray(cache.releases) ? cache : null;
    },
    saveCache: (cache) => writeJson(CACHE_KEY, cache),
    changed: opts.changed,
  });
  try {
    if (!(await updater.init())) return null;
  } catch {
    return null;
  }
  window.__pvUpdateProgress = (done, total) => updater.progress(done, total);
  updater.start();
  return updater;
}
