/**
 * The interface language (userData/ui-language.json): `system`, the default, or one locale.
 * `system` follows the operating system's preferred languages in their order.
 *
 * The main process reads the file once and keeps the choice in memory. Each window gets it as a
 * command-line switch (webPreferences.additionalArguments), which its preload reads with no IPC.
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { asUiLanguagePref, resolveUiLocale, type UiLanguagePref, type UiLocale } from '@phevere/core/i18n/locales';

const FILE_NAME = 'ui-language.json';

/** The switches a window's preload reads (src/ui-language-bridge.ts). */
export const UI_LOCALE_SWITCH = '--phevere-ui-locale=';
export const UI_PREF_SWITCH = '--phevere-ui-pref=';

export interface UiLanguageState {
  pref: UiLanguagePref;
  locale: UiLocale;
}

let state: UiLanguageState | null = null;

function filePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

function readPref(): UiLanguagePref {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as { language?: unknown };
    return asUiLanguagePref(raw.language);
  } catch {
    return 'system';
  }
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

/** The setting and the locale it resolves to, read from disk the first time only. */
export function uiLanguageState(): UiLanguageState {
  if (!state) {
    const pref = readPref();
    state = { pref, locale: resolveUiLocale(pref, systemLanguages()) };
  }
  return state;
}

/** Save a new setting; returns the state every window should switch to. */
export function setUiLanguagePref(pref: UiLanguagePref): UiLanguageState {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ language: pref }, null, 2), 'utf8');
  state = { pref, locale: resolveUiLocale(pref, systemLanguages()) };
  return state;
}

/** webPreferences.additionalArguments for a new window. */
export function uiLanguageArguments(): string[] {
  const s = uiLanguageState();
  return [`${UI_LOCALE_SWITCH}${s.locale}`, `${UI_PREF_SWITCH}${s.pref}`];
}
