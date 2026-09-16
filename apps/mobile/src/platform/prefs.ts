import { dictionaryService, type TranslationProvider } from '@phevere/core';

const KEY = 'phevere.mobile.prefs';

export interface MobilePrefs {
  sources: Record<string, boolean>;
  translationProvider: TranslationProvider;
  sourceLang: string;
  targetLang: string;
  wikiLang: string;
  googleKey: string;
  deeplKey: string;
  youdaoKey: string;
  youdaoSecret: string;
  oxfordId: string;
  oxfordKey: string;
  wordsKey: string;
  collinsKey: string;
  collinsHost: string;
  audioEnabled: boolean;
  audioSpeed: number;
  floatingStrip: boolean;
  notifyIncoming: boolean;
  notifySaved: boolean;
  notifyOcr: boolean;
}

export const defaultPrefs = (): MobilePrefs => ({
  sources: {},
  translationProvider: 'auto',
  sourceLang: 'auto',
  targetLang: 'zh',
  wikiLang: 'en',
  googleKey: '',
  deeplKey: '',
  youdaoKey: '',
  youdaoSecret: '',
  oxfordId: '',
  oxfordKey: '',
  wordsKey: '',
  collinsKey: '',
  collinsHost: '',
  audioEnabled: true,
  audioSpeed: 1,
  floatingStrip: false,
  notifyIncoming: true,
  notifySaved: true,
  notifyOcr: true,
});

export function loadPrefs(): MobilePrefs {
  const base = defaultPrefs();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<MobilePrefs> & {
      notifyClipboardImage?: boolean;
      notifyClipboardEmpty?: boolean;
      notifyHoverToggle?: boolean;
    };
    const merged: MobilePrefs = { ...base, ...parsed, sources: { ...base.sources, ...(parsed.sources || {}) } };
    if (parsed.notifyIncoming === undefined && parsed.notifyClipboardImage !== undefined) {
      merged.notifyIncoming = parsed.notifyClipboardImage;
    }
    if (parsed.notifySaved === undefined && parsed.notifyClipboardEmpty !== undefined) {
      merged.notifySaved = parsed.notifyClipboardEmpty;
    }
    if (parsed.notifyOcr === undefined && parsed.notifyHoverToggle !== undefined) {
      merged.notifyOcr = parsed.notifyHoverToggle;
    }
    return merged;
  } catch {
    return base;
  }
}

export function savePrefs(prefs: MobilePrefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

export function applyPrefsToCore(prefs: MobilePrefs): void {
  if (prefs.googleKey) dictionaryService.setApiKey(prefs.googleKey);
  if (prefs.deeplKey) dictionaryService.setDeepLApiKey(prefs.deeplKey);
  if (prefs.youdaoKey || prefs.youdaoSecret) {
    dictionaryService.setYoudaoCredentials(prefs.youdaoKey, prefs.youdaoSecret);
  }
  if (prefs.oxfordId || prefs.oxfordKey) {
    dictionaryService.setOxfordCredentials(prefs.oxfordId, prefs.oxfordKey);
  }
  if (prefs.wordsKey) dictionaryService.setWordsApiCredentials(prefs.wordsKey);
  if (prefs.collinsKey) {
    dictionaryService.setCollinsApiCredentials(prefs.collinsKey, prefs.collinsHost);
  }
  for (const [name, enabled] of Object.entries(prefs.sources)) {
    dictionaryService.setSourceEnabled(name, enabled);
  }
}
