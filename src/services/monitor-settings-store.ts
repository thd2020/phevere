import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type MonitorMode = 'off' | 'on' | 'shortcut';

export interface MonitorSettings {
  mode: MonitorMode;
  cycleShortcut: string;
  triggerShortcut: string;
}

const FILE_NAME = 'monitor-settings.json';

const DEFAULTS: MonitorSettings = {
  mode: 'on',
  /** Avoid Ctrl+Shift+D — Chrome uses it for “bookmark all tabs”. */
  cycleShortcut: 'CommandOrControl+Alt+Shift+M',
  triggerShortcut: 'CommandOrControl+Alt+Shift+Y',
};

function resolvePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

export function loadMonitorSettings(): MonitorSettings {
  const fp = resolvePath();
  try {
    if (!fs.existsSync(fp)) {
      return { ...DEFAULTS };
    }
    const raw = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(raw) as Partial<MonitorSettings>;
    return {
      mode: data.mode === 'off' || data.mode === 'on' || data.mode === 'shortcut' ? data.mode : DEFAULTS.mode,
      cycleShortcut: typeof data.cycleShortcut === 'string' && data.cycleShortcut.trim() ? data.cycleShortcut.trim() : DEFAULTS.cycleShortcut,
      triggerShortcut:
        typeof data.triggerShortcut === 'string' && data.triggerShortcut.trim()
          ? data.triggerShortcut.trim()
          : DEFAULTS.triggerShortcut,
    };
  } catch {
    return { ...DEFAULTS };
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
  };
  if (merged.mode !== 'off' && merged.mode !== 'on' && merged.mode !== 'shortcut') {
    merged.mode = current.mode;
  }
  if (!merged.cycleShortcut.trim()) merged.cycleShortcut = DEFAULTS.cycleShortcut;
  if (!merged.triggerShortcut.trim()) merged.triggerShortcut = DEFAULTS.triggerShortcut;
  return merged;
}

export const monitorDefaults = DEFAULTS;
