/**
 * Preload for the quick translation panel.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { exposeUiLanguage } from './ui-language-bridge';
import { installInPageHover } from './in-page-hover-bridge';

exposeUiLanguage();
installInPageHover();

export interface QuickPanelOpen {
  text: string;
  from: string;
  to: string;
  providers: Array<{ id: string; label: string }>;
  languages: Array<{ code: string; name: string }>;
}

contextBridge.exposeInMainWorld('quickPanelAPI', {
  onOpen: (cb: (payload: QuickPanelOpen) => void) => {
    ipcRenderer.on('quick-panel-open', (_e, payload: QuickPanelOpen) => cb(payload));
  },
  translate: (from: string, to: string, provider: string): Promise<{ text: string; language: string; detected?: string } | null> =>
    ipcRenderer.invoke('quick-panel-translate', { from, to, provider }),
  choose: (text: string) => ipcRenderer.send('quick-panel-choose', text),
  cancel: () => ipcRenderer.send('quick-panel-cancel'),
  resize: (height: number) => ipcRenderer.send('quick-panel-resize', height),
});
