/**
 * macOS Screen Recording (TCC) for desktopCapturer OCR.
 * Same one-click Settings jump as Accessibility — the OS will not grant it for us.
 */
import { app, dialog, shell, systemPreferences } from 'electron';
import { t } from '@phevere/core/i18n/runtime';
import { log } from '../logger';

export const MAC_SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

let promptedThisSession = false;

export function macScreenRecordingAppLabel(): string {
  return app.isPackaged ? 'Phevere' : 'Electron';
}

export function getMacScreenRecordingStatus(): string {
  if (process.platform !== 'darwin') return 'granted';
  try {
    return systemPreferences.getMediaAccessStatus('screen');
  } catch {
    return 'unknown';
  }
}

export function macScreenRecordingAllowed(): boolean {
  const status = getMacScreenRecordingStatus();
  return status === 'granted' || status === 'unknown' || status === 'not-determined';
}

export async function openMacScreenRecordingSettings(): Promise<void> {
  await shell.openExternal(MAC_SCREEN_RECORDING_SETTINGS_URL);
}

export async function promptOpenMacScreenRecordingSettings(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  if (promptedThisSession) return false;
  promptedThisSession = true;
  const label = macScreenRecordingAppLabel();
  const r = await dialog.showMessageBox({
    type: 'info',
    title: t('main.mac.screenRecording.title'),
    message: t('main.mac.screenRecording.message', { app: label }),
    detail: t('main.mac.screenRecording.detail', { app: label }),
    buttons: [t('main.mac.openSystemSettings'), t('main.mac.notNow')],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response !== 0) return false;
  try {
    await openMacScreenRecordingSettings();
    return true;
  } catch (err) {
    log.warn('main', 'Could not open Screen Recording settings', { err: String(err) });
    return false;
  }
}

/** False when capture cannot work; may show the Settings dialog once. */
export async function ensureMacScreenRecordingForCapture(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const status = getMacScreenRecordingStatus();
  if (status === 'granted' || status === 'not-determined' || status === 'unknown') {
    return true;
  }
  await promptOpenMacScreenRecordingSettings();
  return false;
}
