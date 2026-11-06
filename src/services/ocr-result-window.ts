/**
 * The scanned-text window: one per scanned image, showing the picture with its recognised
 * text in place (src/ocr-result.ts). Each window asks for its own page once it has loaded.
 */
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen } from 'electron';
import * as fs from 'fs';
import type { OcrPage } from '@phevere/core/ocr-layout';

type Entry = { image: string; page: OcrPage };

const pages = new Map<number, Entry>();
let wired = false;

function wire(): void {
  if (wired) return;
  wired = true;
  ipcMain.handle('ocr-result-data', (e) => pages.get(e.sender.id) || null);
  ipcMain.handle('ocr-result-copy-text', (_e, text: string) => {
    clipboard.writeText(String(text || ''));
  });
  ipcMain.handle('ocr-result-copy-image', (_e, png: ArrayBuffer) => {
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)));
  });
  ipcMain.handle('ocr-result-save-image', async (e, png: ArrayBuffer) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { defaultPath: 'Scanned text.png', filters: [{ name: 'PNG image', extensions: ['png'] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { saved: false };
    await fs.promises.writeFile(r.filePath, Buffer.from(png));
    return { saved: true };
  });
}

/**
 * Open the window for one scanned PNG near the given screen point (DIP), sized to the
 * picture within the work area.
 */
export function openOcrResultWindow(opts: {
  png: Buffer;
  page: OcrPage;
  entry: string;
  preload: string;
  near?: { x: number; y: number };
  icon?: Electron.NativeImage | string;
}): BrowserWindow {
  wire();
  const point = opts.near || screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  const barH = 56;
  const pad = 32;
  const w = Math.round(Math.min(area.width * 0.9, Math.max(560, opts.page.width + pad + 16)));
  const fitW = Math.min(opts.page.width, w - pad);
  const h = Math.round(Math.min(area.height * 0.9, Math.max(420, (fitW * opts.page.height) / Math.max(1, opts.page.width) + barH + pad + 40)));
  const x = Math.round(Math.min(Math.max(area.x, point.x - w / 2), area.x + area.width - w));
  const y = Math.round(Math.min(Math.max(area.y, point.y - h / 2), area.y + area.height - h));
  const win = new BrowserWindow({
    x,
    y,
    width: w,
    height: h,
    minWidth: 420,
    minHeight: 320,
    show: false,
    title: 'Scanned text',
    autoHideMenuBar: true,
    backgroundColor: '#f4f0ea',
    ...(opts.icon ? { icon: opts.icon } : {}),
    webPreferences: {
      preload: opts.preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  const id = win.webContents.id;
  pages.set(id, { image: `data:image/png;base64,${opts.png.toString('base64')}`, page: opts.page });
  win.on('closed', () => pages.delete(id));
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  void win.loadURL(opts.entry);
  return win;
}
