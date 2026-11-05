/**
 * Connects the Android updater (../app-update.ts) to the native bridge (AppUpdate.java via
 * BridgeRouter: updateInfo, updateDownload, updateInstall) and the stored update state.
 * Returns null on iOS, in the browser preview and in debug builds.
 */
import { createPhoneUpdater, type PhoneUpdater } from '../app-update';
import { createHttpClient } from './http';
import { hasNativeBridge, nativeCall } from './native';
import { loadUpdateState, saveUpdateState } from './prefs';

declare global {
  interface Window {
    __pvUpdateProgress?: (done: number, total: number) => void;
  }
}

type AppInfo = { versionName?: string; debuggable?: boolean; installsAllowed?: boolean };

export async function startPhoneUpdates(opts: {
  onChange(): void;
  busy(): boolean;
  /** In-app message while the app is open; a system notification otherwise. */
  announce(version: string): void;
}): Promise<PhoneUpdater | null> {
  if (!hasNativeBridge()) return null;
  let info: AppInfo;
  try {
    info = await nativeCall<AppInfo>('updateInfo', {});
  } catch {
    return null;
  }
  const http = createHttpClient();
  const updater = createPhoneUpdater({
    version: info.versionName || '',
    debuggable: info.debuggable !== false,
    async fetchText(url) {
      const res = await http.requestText(url, { timeoutMs: 15_000 });
      return { status: res.status, text: res.text };
    },
    // An APK is large; the bridge timeout covers a slow connection.
    download: (req) => nativeCall<{ name: string }>('updateDownload', req, 30 * 60_000),
    install: (name) => nativeCall<{ needsPermission?: boolean }>('updateInstall', { name }),
    async canInstall() {
      const next = await nativeCall<AppInfo>('updateInfo', {});
      return next.installsAllowed !== false;
    },
    announce: opts.announce,
    busy: opts.busy,
    loadState: loadUpdateState,
    saveState: saveUpdateState,
    onChange: opts.onChange,
  });
  if (!updater.supported) return null;
  window.__pvUpdateProgress = (done, total) => updater.progress(done, total);
  updater.start();
  return updater;
}
