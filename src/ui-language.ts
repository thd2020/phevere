/**
 * Renderer side of the interface language, for every desktop window: load the window's
 * language before it draws, and follow a change made in Settings.
 *
 * A change reloads the window by default, which redraws every string it built (the main
 * window, Settings and the pop-up build much of their markup once). A window whose content
 * would be lost passes `onChange` to translate in place instead.
 */
import { setUiLocale, translateDom } from '@phevere/core/i18n/runtime';

interface UiLanguageState {
  pref: string;
  locale: string;
}

interface UiLanguageApi {
  initial(): UiLanguageState;
  set(pref: string): Promise<UiLanguageState>;
  onChange(cb: (state: UiLanguageState) => void): void;
}

function api(): UiLanguageApi | null {
  return (window as unknown as { uiLanguageAPI?: UiLanguageApi }).uiLanguageAPI || null;
}

let ready: Promise<void> | null = null;

/** Resolves once the window's catalogue is loaded and static markup (data-i18n) is translated. */
export function windowLanguageReady(onChange?: () => void): Promise<void> {
  if (ready) return ready;
  const bridge = api();
  const start = bridge ? bridge.initial() : { pref: 'system', locale: 'en' };
  ready = setUiLocale(start.locale).then(() => {
    const run = () => translateDom(document);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  });
  let shown = start.locale;
  bridge?.onChange((state) => {
    if (state.locale === shown) return;
    shown = state.locale;
    void setUiLocale(state.locale).then(() => {
      if (onChange) {
        translateDom(document);
        onChange();
      } else {
        location.reload();
      }
    });
  });
  return ready;
}

export function uiLanguagePref(): string {
  return api()?.initial().pref || 'system';
}

export function setUiLanguagePref(pref: string): Promise<UiLanguageState> | null {
  return api()?.set(pref) || null;
}
