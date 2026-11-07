/**
 * Preload for the scanned-text window (ocr-result.ts): the page to show, clipboard and save,
 * lookups through the same channel as selecting text in the main window, and translation.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { exposeUiLanguage } from './ui-language-bridge';
import { installInPageHover } from './in-page-hover-bridge';

exposeUiLanguage();
installInPageHover();

contextBridge.exposeInMainWorld('ocrResultAPI', {
  data: (): Promise<{ image: string; page: unknown } | null> => ipcRenderer.invoke('ocr-result-data'),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('ocr-result-copy-text', text),
  copyImage: (png: ArrayBuffer): Promise<void> => ipcRenderer.invoke('ocr-result-copy-image', png),
  saveImage: (png: ArrayBuffer): Promise<{ saved: boolean }> => ipcRenderer.invoke('ocr-result-save-image', png),
  lookup: (x: number, y: number, text: string) => ipcRenderer.send('show-popup', { x, y, text }),
  translateInfo: (): Promise<{ languages: { code: string; name: string }[] }> => ipcRenderer.invoke('ocr-result-tr-info'),
  translateTarget: (sample: string): Promise<string> => ipcRenderer.invoke('ocr-result-tr-target', sample),
  setTranslateTarget: (code: string): Promise<void> => ipcRenderer.invoke('ocr-result-tr-set', code),
  translate: (texts: string[], to: string, id: number): Promise<unknown> => ipcRenderer.invoke('ocr-result-tr', texts, to, id),
  cancelTranslate: (id: number) => ipcRenderer.send('ocr-result-tr-cancel', id),
});
