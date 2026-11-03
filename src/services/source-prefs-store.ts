/**
 * Dictionary sources switched on or off in Settings → Sources (userData/source-prefs.json).
 * Only the switches the reader changed are stored; every other source keeps its default.
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const FILE_NAME = 'source-prefs.json';

function resolvePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

export function loadSourcePrefs(): Record<string, boolean> {
  try {
    const raw = JSON.parse(fs.readFileSync(resolvePath(), 'utf8'));
    const out: Record<string, boolean> = {};
    for (const [name, on] of Object.entries(raw || {})) if (typeof on === 'boolean') out[name] = on;
    return out;
  } catch {
    return {};
  }
}

export function saveSourcePref(name: string, enabled: boolean): void {
  const prefs = { ...loadSourcePrefs(), [name]: enabled };
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(prefs, null, 2), 'utf8');
}
