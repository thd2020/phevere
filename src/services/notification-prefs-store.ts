/**
 * OS / tray notification toggles (userData/notification-prefs.json).
 * In-app toasts and OCR progress windows are not gated here.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type NotificationKind = 'clipboardImage' | 'clipboardEmpty' | 'hoverToggle';

export interface NotificationPrefs {
  clipboardImage: boolean;
  clipboardEmpty: boolean;
  hoverToggle: boolean;
}

const FILE_NAME = 'notification-prefs.json';

export const notificationPrefsDefaults: NotificationPrefs = {
  clipboardImage: true,
  clipboardEmpty: true,
  hoverToggle: true,
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
      clipboardEmpty: asBool(raw.clipboardEmpty, notificationPrefsDefaults.clipboardEmpty),
      hoverToggle: asBool(raw.hoverToggle, notificationPrefsDefaults.hoverToggle),
    };
  } catch {
    return { ...notificationPrefsDefaults };
  }
}

export function saveNotificationPrefs(next: NotificationPrefs): NotificationPrefs {
  const prefs: NotificationPrefs = {
    clipboardImage: !!next.clipboardImage,
    clipboardEmpty: !!next.clipboardEmpty,
    hoverToggle: !!next.hoverToggle,
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
    clipboardEmpty: patch.clipboardEmpty ?? base.clipboardEmpty,
    hoverToggle: patch.hoverToggle ?? base.hoverToggle,
  });
}
