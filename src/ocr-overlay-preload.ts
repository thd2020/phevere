/**
 * Preload for the fullscreen OCR region picker.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ocrOverlayAPI', {
  complete: (region: { x: number; y: number; width: number; height: number }) => {
    ipcRenderer.send('ocr-overlay-complete', region);
  },
  cancel: () => {
    ipcRenderer.send('ocr-overlay-cancel');
  },
});
