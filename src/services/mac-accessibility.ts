/**
 * macOS will not let an app flip Privacy → Accessibility (TCC). The usable
 * “one-click” path is: prompt, jump straight to that pane, then retry start
 * when the user enables Electron / Phevere.
 */
import { app, dialog, shell } from 'electron';
import { t } from '@phevere/core/i18n/runtime';
import { log } from '../logger';

/** Opens the Accessibility list in System Settings (Ventura+) / System Preferences. */
export const MAC_AX_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

export function macAccessibilityAppLabel(): string {
  return app.isPackaged ? 'Phevere' : 'Electron';
}

export async function openMacAccessibilitySettings(): Promise<void> {
  await shell.openExternal(MAC_AX_SETTINGS_URL);
}

export async function promptOpenMacAccessibilitySettings(): Promise<boolean> {
  const label = macAccessibilityAppLabel();
  const r = await dialog.showMessageBox({
    type: 'info',
    title: t('main.mac.accessibility.title'),
    message: t('main.mac.accessibility.message', { app: label }),
    detail: t('main.mac.accessibility.detail', { app: label }),
    buttons: [t('main.mac.openSystemSettings'), t('main.mac.notNow')],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response !== 0) return false;
  try {
    await openMacAccessibilitySettings();
    return true;
  } catch (err) {
    log.warn('main', 'Could not open Accessibility settings', { err: String(err) });
    return false;
  }
}
