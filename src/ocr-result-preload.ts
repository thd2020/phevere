/**
 * Preload for the scanned-text window (ocr-result.ts): the page to show, clipboard and save,
 * and lookups through the same channel as selecting text in the main window.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ocrResultAPI', {
  data: (): Promise<{ image: string; page: unknown } | null> => ipcRenderer.invoke('ocr-result-data'),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('ocr-result-copy-text', text),
  copyImage: (png: ArrayBuffer): Promise<void> => ipcRenderer.invoke('ocr-result-copy-image', png),
  saveImage: (png: ArrayBuffer): Promise<{ saved: boolean }> => ipcRenderer.invoke('ocr-result-save-image', png),
  lookup: (x: number, y: number, text: string) => ipcRenderer.send('show-popup', { x, y, text }),
});
