/**
 * The Language row at the top of Settings, desktop and phone: a menu of System and the
 * languages Phevere's interface comes in, each named in its own language (as Android's and
 * iOS's per-app language lists do). It is a native <select> that settings-menu.ts dresses as
 * the Settings menu; the host listens for its change event.
 */
import { tHtml } from './i18n/runtime';
import { UI_LOCALES, UI_LOCALE_NAMES, type UiLanguagePref } from './i18n/locales';

export const UI_LANGUAGE_SELECT_ID = 'ui-language';

export function languageRowHtml(pref: UiLanguagePref): string {
  const options = [
    `<option value="system"${pref === 'system' ? ' selected' : ''}>${tHtml('settings.language.system')}</option>`,
    ...UI_LOCALES.map((l) => `<option value="${l}" lang="${l}"${pref === l ? ' selected' : ''}>${UI_LOCALE_NAMES[l]}</option>`),
  ].join('');
  return `<div class="sv-ledger">
      <div class="sv-row">
        <span class="sv-row__text"><label for="${UI_LANGUAGE_SELECT_ID}" class="sv-row__label">${tHtml('settings.language')}</label></span>
        <select id="${UI_LANGUAGE_SELECT_ID}" class="sv-select">${options}</select>
      </div>
    </div>`;
}

