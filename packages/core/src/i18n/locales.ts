/**
 * The languages Phevere's interface comes in, and how a system language list picks one.
 *
 * Each language is named in its own language, as Android, iOS, Windows and macOS list them, so
 * a person who cannot read the current interface can still find theirs.
 */

export const UI_LOCALES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt-BR'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

/** The stored preference: a locale, or `system` to follow the operating system or browser. */
export type UiLanguagePref = 'system' | UiLocale;

/** Native names, shown in the Language menu whatever the interface language is. */
export const UI_LOCALE_NAMES: Record<UiLocale, string> = {
  en: 'English', // i18n-ignore: each language is named in its own language
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español', // i18n-ignore
  fr: 'Français', // i18n-ignore
  de: 'Deutsch', // i18n-ignore
  ru: 'Русский',
  'pt-BR': 'Português (Brasil)', // i18n-ignore
};

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value);
}

export function asUiLanguagePref(value: unknown): UiLanguagePref {
  return isUiLocale(value) ? value : 'system';
}

/**
 * The interface locale for one BCP 47 tag, or null when Phevere has no translation for its
 * language. Chinese goes by script first (zh-Hant, then the regions that write Traditional
 * characters), and any Portuguese gets the Brazilian translation, the only one there is.
 */
export function matchUiLocale(tag: string): UiLocale | null {
  const raw = String(tag || '').trim().replace(/_/g, '-');
  if (!raw) return null;
  let locale: Intl.Locale | null = null;
  try {
    locale = new Intl.Locale(raw);
  } catch {
    return null;
  }
  const lang = locale.language.toLowerCase();
  if (lang === 'zh') {
    const script = (locale.script || '').toLowerCase();
    if (script === 'hant') return 'zh-TW';
    if (script === 'hans') return 'zh-CN';
    const region = (locale.region || '').toUpperCase();
    return region === 'TW' || region === 'HK' || region === 'MO' ? 'zh-TW' : 'zh-CN';
  }
  if (lang === 'pt') return 'pt-BR';
  return isUiLocale(lang) ? lang : null;
}

/**
 * The first of the person's languages that Phevere speaks, in their order (as Chrome and
 * Android choose an app's language), or English when none matches.
 */
export function resolveUiLocale(pref: UiLanguagePref | string | undefined, system: readonly string[] = []): UiLocale {
  if (isUiLocale(pref)) return pref;
  for (const tag of system) {
    const hit = matchUiLocale(tag);
    if (hit) return hit;
  }
  return 'en';
}
