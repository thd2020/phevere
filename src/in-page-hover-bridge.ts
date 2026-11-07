/**
 * Hover lookup in every Phevere window. Each preload calls this, so the main window, Settings, the
 * pop-ups, the quick panel, the scanned-text window and opened web pages all hand the word under a
 * resting pointer to the main process, and answer the trigger shortcut pressed over them.
 */
import { ipcRenderer } from 'electron';
import { wireInPageHover } from './in-page-hover';

export function installInPageHover(): void {
  const start = (): void =>
    wireInPageHover(
      (x, y, word, requested) => ipcRenderer.send('in-page-hover', { x, y, text: word, requested: requested === true }),
      (answer) => {
        ipcRenderer.removeAllListeners('hover-word-request');
        ipcRenderer.on('hover-word-request', (_event, p: { x: number; y: number; screenX: number; screenY: number }) =>
          answer(p.x, p.y, p.screenX, p.screenY),
        );
      },
    );
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
