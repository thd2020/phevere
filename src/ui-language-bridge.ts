/**
 * Preload side of the interface language, shared by every window's preload: the language at
 * load, the setting, and changes.
 *
 * The main process puts the language on the window's command line (ui-language-store.ts,
 * webPreferences.additionalArguments), so reading it needs no IPC. Those switches stay as they
 * were when the window opened, so after a change the new state is kept in the page's
 * sessionStorage, which a reload keeps and which wins over the switches.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface UiLanguageState {
  pref: string;
  locale: string;
}

const LOCALE_SWITCH = '--phevere-ui-locale=';
const PREF_SWITCH = '--phevere-ui-pref=';
const SESSION_KEY = 'phevere.uiLanguage';

function fromSwitches(): UiLanguageState | null {
  const argv = (typeof process !== 'undefined' && process.argv) || [];
  const locale = argv.find((a) => a.startsWith(LOCALE_SWITCH))?.slice(LOCALE_SWITCH.length);
  const pref = argv.find((a) => a.startsWith(PREF_SWITCH))?.slice(PREF_SWITCH.length);
  return locale ? { locale, pref: pref || 'system' } : null;
}

function fromSession(): UiLanguageState | null {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
    return raw && typeof raw.locale === 'string' ? { locale: raw.locale, pref: String(raw.pref || 'system') } : null;
  } catch {
    return null;
  }
}

export function exposeUiLanguage(): void {
  const initial: UiLanguageState = fromSession() || fromSwitches() || { pref: 'system', locale: 'en' };
  ipcRenderer.on('ui-language-changed', (_e, state: UiLanguageState) => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      /* storage blocked: the switches apply after a reload */
    }
  });
  contextBridge.exposeInMainWorld('uiLanguageAPI', {
    initial: (): UiLanguageState => initial,
    set: (pref: string): Promise<UiLanguageState> => ipcRenderer.invoke('ui-language-set', pref),
    onChange: (cb: (state: UiLanguageState) => void) => {
      ipcRenderer.on('ui-language-changed', (_e, state: UiLanguageState) => cb(state));
    },
  });
}
