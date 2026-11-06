/**
 * The interface language (userData/ui-language.json): `system`, the default, or one locale.
 * `system` follows the operating system's preferred languages in their order.
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { asUiLanguagePref, resolveUiLocale, type UiLanguagePref, type UiLocale } from '@phevere/core/i18n/locales';

const FILE_NAME = 'ui-language.json';

function filePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

export function loadUiLanguagePref(): UiLanguagePref {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as { language?: unknown };
    return asUiLanguagePref(raw.language);
  } catch {
    return 'system';
  }
}

export function saveUiLanguagePref(pref: UiLanguagePref): void {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ language: pref }, null, 2), 'utf8');
}

/** The system's languages, most preferred first (Electron 21+), else the app locale. */
export function systemLanguages(): string[] {
  try {
    const list = app.getPreferredSystemLanguages();
    if (list && list.length) return list;
  } catch {
    /* older Electron */
  }
  try {
    return [app.getLocale()];
  } catch {
    return [];
  }
}

export function resolveDesktopLocale(pref: UiLanguagePref = loadUiLanguagePref()): UiLocale {
  return resolveUiLocale(pref, systemLanguages());
}
