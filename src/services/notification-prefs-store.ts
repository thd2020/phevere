/**
 * OS / tray notification toggles (userData/notification-prefs.json).
 * In-app toasts and OCR progress windows are not gated here, and neither is the
 * message that answers a shortcut that could not do its job (no image on the
 * clipboard, a quick translation that failed): those always show.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type NotificationKind = 'clipboardImage' | 'hoverToggle' | 'updates';

export interface NotificationPrefs {
  clipboardImage: boolean;
  hoverToggle: boolean;
  updates: boolean;
}

const FILE_NAME = 'notification-prefs.json';

export const notificationPrefsDefaults: NotificationPrefs = {
  clipboardImage: true,
  hoverToggle: true,
  updates: true,
};

function asBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  return fallback;
}

function resolvePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

export function loadNotificationPrefs(): NotificationPrefs {
  try {
    const p = resolvePath();
    if (!fs.existsSync(p)) return { ...notificationPrefsDefaults };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<NotificationPrefs>;
    return {
      clipboardImage: asBool(raw.clipboardImage, notificationPrefsDefaults.clipboardImage),
      hoverToggle: asBool(raw.hoverToggle, notificationPrefsDefaults.hoverToggle),
      updates: asBool(raw.updates, notificationPrefsDefaults.updates),
    };
  } catch {
    return { ...notificationPrefsDefaults };
  }
}

export function saveNotificationPrefs(next: NotificationPrefs): NotificationPrefs {
  const prefs: NotificationPrefs = {
    clipboardImage: !!next.clipboardImage,
    hoverToggle: !!next.hoverToggle,
    updates: next.updates !== false,
  };
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(prefs, null, 2), 'utf8');
  return prefs;
}

export function mergeNotificationPrefs(
  patch: Partial<NotificationPrefs>,
  base = loadNotificationPrefs(),
): NotificationPrefs {
  return saveNotificationPrefs({
    clipboardImage: patch.clipboardImage ?? base.clipboardImage,
    hoverToggle: patch.hoverToggle ?? base.hoverToggle,
    updates: patch.updates ?? base.updates,
  });
}
