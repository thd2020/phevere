/**
 * Translation-tab provider preference (userData/translation-prefs.json).
 * Auto tries free Google then MyMemory; Youdao/DeepL still need keys.
 * Stored from Settings → Sources (not the lookup popup).
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type TranslationProvider = 'auto' | 'youdao' | 'deepl' | 'google' | 'mymemory';

export interface TranslationPrefs {
  provider: TranslationProvider;
}

const FILE_NAME = 'translation-prefs.json';

export const TRANSLATION_PROVIDERS: TranslationProvider[] = ['auto', 'youdao', 'deepl', 'google', 'mymemory'];

export const translationPrefsDefaults: TranslationPrefs = {
  provider: 'auto',
};

export function parseTranslationProvider(raw: unknown): TranslationProvider {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'youdao' || s === 'deepl' || s === 'google' || s === 'mymemory' || s === 'auto') return s;
  return 'auto';
}

function resolvePath(): string {
  try {
    return path.join(app.getPath('userData'), FILE_NAME);
  } catch {
    return path.join(process.cwd(), FILE_NAME);
  }
}

export function loadTranslationPrefs(): TranslationPrefs {
  try {
    const p = resolvePath();
    if (!fs.existsSync(p)) return { ...translationPrefsDefaults };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { provider: parseTranslationProvider(raw?.provider) };
  } catch {
    return { ...translationPrefsDefaults };
  }
}

export function saveTranslationPrefs(next: TranslationPrefs): void {
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ provider: parseTranslationProvider(next.provider) }, null, 2), 'utf8');
}
