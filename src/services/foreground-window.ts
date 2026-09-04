/**
 * Foreground window bounds. Used for “read this window” OCR.
 * Windows: GetForegroundWindow + GetWindowRect (koffi).
 * macOS: System Events window position/size (needs Accessibility, same as selection).
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app, screen } from 'electron';
import { ContextBounds } from './context-capture';
import { wrapConsole } from '../logger';

const console = wrapConsole('foreground-window');

type Rect = { left: number; top: number; right: number; bottom: number };

let getForegroundWindow: (() => number | bigint) | null = null;
let getWindowRect: ((hwnd: number | bigint, rect: Rect) => number | boolean) | null = null;

function resolveDarwinScript(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', 'foreground_window.applescript'),
    path.join(process.resourcesPath || '', 'foreground_window.applescript'),
    path.join(process.resourcesPath || '', 'scripts', 'foreground_window.applescript'),
    path.join(app.getAppPath(), 'scripts', 'foreground_window.applescript'),
    path.join(process.cwd(), 'scripts', 'foreground_window.applescript'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

function ensureWin32Api(): boolean {
  if (getForegroundWindow && getWindowRect) return true;
  if (process.platform !== 'win32') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as {
      load: (name: string) => { func: (sig: string) => (...args: unknown[]) => unknown };
      struct: (name: string, def: Record<string, string>) => unknown;
    };
    koffi.struct('RECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long',
    });
    const user32 = koffi.load('user32.dll');
    getForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()') as () => number | bigint;
    getWindowRect = user32.func('bool __stdcall GetWindowRect(uintptr_t hwnd, _Out_ RECT *rect)') as (
      hwnd: number | bigint,
      rect: Rect,
    ) => number | boolean;
    return true;
  } catch (error) {
    console.warn('koffi user32 unavailable', error);
    getForegroundWindow = null;
    getWindowRect = null;
    return false;
  }
}

function boundsIfLarge(x: number, y: number, width: number, height: number): ContextBounds | null {
  if (width < 40 || height < 40) return null;
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function getForegroundWindowBoundsWin32(): ContextBounds | null {
  if (!ensureWin32Api() || !getForegroundWindow || !getWindowRect) return null;

  try {
    const hwnd = getForegroundWindow();
    if (!hwnd || hwnd === 0) return null;

    const rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    const ok = getWindowRect(hwnd, rect);
    if (!ok) return null;

    const tl = screen.screenToDipPoint({ x: rect.left, y: rect.top });
    const br = screen.screenToDipPoint({ x: rect.right, y: rect.bottom });
    return boundsIfLarge(tl.x, tl.y, Math.round(br.x - tl.x), Math.round(br.y - tl.y));
  } catch (error) {
    console.warn('GetWindowRect failed', error);
    return null;
  }
}

function getForegroundWindowBoundsDarwin(): ContextBounds | null {
  const script = resolveDarwinScript();
  if (!fs.existsSync(script)) {
    console.warn('foreground_window.applescript missing', script);
    return null;
  }
  try {
    const r = spawnSync('osascript', [script, String(process.pid)], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
    });
    const line = (r.stdout || '').trim();
    if (!line) return null;
    const [xs, ys, ws, hs] = line.split('\t').map((s) => Number.parseFloat((s || '').trim()));
    if (![xs, ys, ws, hs].every((n) => Number.isFinite(n))) return null;
    return boundsIfLarge(xs, ys, Math.round(ws), Math.round(hs));
  } catch (error) {
    console.warn('osascript foreground window failed', error);
    return null;
  }
}

/**
 * DIP bounds of the foreground top-level window, or null if unavailable / tiny.
 */
export function getForegroundWindowBoundsDip(): ContextBounds | null {
  if (process.platform === 'win32') return getForegroundWindowBoundsWin32();
  if (process.platform === 'darwin') return getForegroundWindowBoundsDarwin();
  return null;
}
