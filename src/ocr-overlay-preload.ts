/**
 * Preload for the fullscreen OCR region picker.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ocrOverlayAPI', {
  complete: (region: { x: number; y: number; width: number; height: number }) => {
    ipcRenderer.send('ocr-overlay-complete', region);
  },
  cancel: (reason?: string) => {
    ipcRenderer.send('ocr-overlay-cancel', reason || '');
  },
});
