/**
 * Foreground window bounds via Win32 (koffi). Used for “read this window” OCR.
 */

import { screen } from 'electron';
import { ContextBounds } from './context-capture';
import { wrapConsole } from '../logger';

const console = wrapConsole('foreground-window');

type Rect = { left: number; top: number; right: number; bottom: number };

let getForegroundWindow: (() => number | bigint) | null = null;
let getWindowRect: ((hwnd: number | bigint, rect: Rect) => number | boolean) | null = null;

function ensureApi(): boolean {
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

/**
 * DIP bounds of the foreground top-level window, or null if unavailable / tiny.
 */
export function getForegroundWindowBoundsDip(): ContextBounds | null {
  if (!ensureApi() || !getForegroundWindow || !getWindowRect) return null;

  try {
    const hwnd = getForegroundWindow();
    if (!hwnd || hwnd === 0) return null;

    const rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    const ok = getWindowRect(hwnd, rect);
    if (!ok) return null;

    const tl = screen.screenToDipPoint({ x: rect.left, y: rect.top });
    const br = screen.screenToDipPoint({ x: rect.right, y: rect.bottom });
    const width = Math.round(br.x - tl.x);
    const height = Math.round(br.y - tl.y);
    if (width < 40 || height < 40) return null;

    return {
      x: Math.round(tl.x),
      y: Math.round(tl.y),
      width,
      height,
    };
  } catch (error) {
    console.warn('GetWindowRect failed', error);
    return null;
  }
}
