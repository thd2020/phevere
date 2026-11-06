/**
 * Preload side of the interface language, shared by every window's preload: the language at
 * load (read synchronously, so the first paint is already translated), the setting, and changes.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface UiLanguageState {
  pref: string;
  locale: string;
}

export function exposeUiLanguage(): void {
  let initial: UiLanguageState = { pref: 'system', locale: 'en' };
  try {
    initial = ipcRenderer.sendSync('ui-language-sync') || initial;
  } catch {
    /* main not ready: English */
  }
  contextBridge.exposeInMainWorld('uiLanguageAPI', {
    initial: (): UiLanguageState => initial,
    set: (pref: string): Promise<UiLanguageState> => ipcRenderer.invoke('ui-language-set', pref),
    onChange: (cb: (state: UiLanguageState) => void) => {
      ipcRenderer.on('ui-language-changed', (_e, state: UiLanguageState) => cb(state));
    },
  });
}
