import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type MonitorMode = 'off' | 'on' | 'shortcut';

export interface MonitorSettings {
  mode: MonitorMode;
  cycleShortcut: string;
  triggerShortcut: string;
  /** Hover-to-word lookup (UIA / OCR under cursor). */
  hoverEnabled: boolean;
  /** Toggle OCR region overlay. */
  ocrShortcut: string;
  /** Toggle hover lookup. */
  hoverShortcut: string;
}

const FILE_NAME = 'monitor-settings.json';

export const monitorDefaults: MonitorSettings = {
  mode: 'on',
  /** Avoid Ctrl+Shift+D — Chrome uses it for “bookmark all tabs”. */
  cycleShortcut: 'CommandOrControl+Alt+Shift+M',
  triggerShortcut: 'CommandOrControl+Alt+Shift+Y',
  hoverEnabled: true,
  ocrShortcut: 'CommandOrControl+Shift+O',
  hoverShortcut: 'CommandOrControl+Shift+H',
};

function resolvePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

function pickShortcut(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function loadMonitorSettings(): MonitorSettings {
  const fp = resolvePath();
  try {
    if (!fs.existsSync(fp)) {
      return { ...monitorDefaults };
    }
    const raw = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(raw) as Partial<MonitorSettings>;
    return {
      mode: data.mode === 'off' || data.mode === 'on' || data.mode === 'shortcut' ? data.mode : monitorDefaults.mode,
      cycleShortcut: pickShortcut(data.cycleShortcut, monitorDefaults.cycleShortcut),
      triggerShortcut: pickShortcut(data.triggerShortcut, monitorDefaults.triggerShortcut),
      hoverEnabled: typeof data.hoverEnabled === 'boolean' ? data.hoverEnabled : monitorDefaults.hoverEnabled,
      ocrShortcut: pickShortcut(data.ocrShortcut, monitorDefaults.ocrShortcut),
      hoverShortcut: pickShortcut(data.hoverShortcut, monitorDefaults.hoverShortcut),
    };
  } catch {
    return { ...monitorDefaults };
  }
}

export function saveMonitorSettingsFile(next: MonitorSettings): void {
  const fp = resolvePath();
  try {
    fs.writeFileSync(fp, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

export function mergeMonitorSettings(partial: Partial<MonitorSettings>, current: MonitorSettings): MonitorSettings {
  const merged: MonitorSettings = {
    mode: partial.mode !== undefined ? partial.mode : current.mode,
    cycleShortcut: partial.cycleShortcut !== undefined ? partial.cycleShortcut : current.cycleShortcut,
    triggerShortcut: partial.triggerShortcut !== undefined ? partial.triggerShortcut : current.triggerShortcut,
    hoverEnabled: partial.hoverEnabled !== undefined ? partial.hoverEnabled : current.hoverEnabled,
    ocrShortcut: partial.ocrShortcut !== undefined ? partial.ocrShortcut : current.ocrShortcut,
    hoverShortcut: partial.hoverShortcut !== undefined ? partial.hoverShortcut : current.hoverShortcut,
  };
  if (merged.mode !== 'off' && merged.mode !== 'on' && merged.mode !== 'shortcut') {
    merged.mode = current.mode;
  }
  if (!merged.cycleShortcut.trim()) merged.cycleShortcut = monitorDefaults.cycleShortcut;
  if (!merged.triggerShortcut.trim()) merged.triggerShortcut = monitorDefaults.triggerShortcut;
  if (!merged.ocrShortcut.trim()) merged.ocrShortcut = monitorDefaults.ocrShortcut;
  if (!merged.hoverShortcut.trim()) merged.hoverShortcut = monitorDefaults.hoverShortcut;
  return merged;
}
