/**
 * Update settings (userData/update-prefs.json): how releases install, and the version a rollback left.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type UpdateMode = 'auto' | 'ask' | 'off';

export interface UpdatePrefs {
  mode: UpdateMode;
  /** Version the user rolled back from. Automatic checks offer only releases above it. */
  skipped: string | null;
}

const FILE_NAME = 'update-prefs.json';

export const updatePrefsDefaults: UpdatePrefs = { mode: 'auto', skipped: null };

function asMode(raw: unknown): UpdateMode {
  return raw === 'ask' || raw === 'off' || raw === 'auto' ? raw : updatePrefsDefaults.mode;
}

function resolvePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

export function loadUpdatePrefs(): UpdatePrefs {
  try {
    const p = resolvePath();
    if (!fs.existsSync(p)) return { ...updatePrefsDefaults };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<UpdatePrefs>;
    return { mode: asMode(raw.mode), skipped: typeof raw.skipped === 'string' ? raw.skipped : null };
  } catch {
    return { ...updatePrefsDefaults };
  }
}

export function mergeUpdatePrefs(patch: Partial<UpdatePrefs>, base = loadUpdatePrefs()): UpdatePrefs {
  const prefs: UpdatePrefs = {
    mode: asMode(patch.mode ?? base.mode),
    skipped: patch.skipped === undefined ? base.skipped : patch.skipped,
  };
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(prefs, null, 2), 'utf8');
  return prefs;
}
