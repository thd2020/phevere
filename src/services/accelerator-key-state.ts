/**
 * Windows: detect whether an Electron-style accelerator chord is physically held
 * (GetAsyncKeyState). Used so "shortcut" monitor mode only opens the popup when
 * the user holds the trigger while finishing a selection.
 *
 * Other platforms: returns true (shortcut mode behaves like "on" until per-OS support exists).
 */

export interface ParsedAccelerator {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  keyVk: number | null;
}

let getAsyncKeyState: ((vk: number) => number) | null | undefined;

function loadWin32(): ((vk: number) => number) | null {
  if (process.platform !== 'win32') {
    return null;
  }
  if (getAsyncKeyState === null) {
    return null;
  }
  if (getAsyncKeyState !== undefined) {
    return getAsyncKeyState;
  }
  try {
    // Webpack marks `koffi` external — resolved at runtime in the main process.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as { load: (name: string) => { func: (sig: string) => (vk: number) => number } };
    const user32 = koffi.load('user32.dll');
    getAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int)');
    return getAsyncKeyState;
  } catch {
    getAsyncKeyState = null;
    return null;
  }
}

function isVkDown(fn: (vk: number) => number, vk: number): boolean {
  return ((fn(vk) as number) & 0x8000) !== 0;
}

/** Electron accelerator token → Windows virtual key (best effort). */
export function keyNameToVk(name: string): number | null {
  const raw = name.trim();
  if (!raw) return null;
  const u = raw.toUpperCase();

  if (u.length === 1 && u >= 'A' && u <= 'Z') {
    return u.charCodeAt(0);
  }
  if (u.length === 1 && u >= '0' && u <= '9') {
    return u.charCodeAt(0);
  }

  const f = /^F(\d{1,2})$/i.exec(u);
  if (f) {
    const n = parseInt(f[1], 10);
    if (n >= 1 && n <= 24) {
      return 0x6f + n;
    }
  }

  const named: Record<string, number> = {
    SPACE: 0x20,
    TAB: 0x09,
    ENTER: 0x0d,
    RETURN: 0x0d,
    ESCAPE: 0x1b,
    ESC: 0x1b,
    BACKSPACE: 0x08,
    DELETE: 0x2e,
    UP: 0x26,
    DOWN: 0x28,
    LEFT: 0x25,
    RIGHT: 0x27,
    HOME: 0x24,
    END: 0x23,
    PAGEUP: 0x21,
    PAGEDOWN: 0x22,
    PLUS: 0xbb,
    '=': 0xbb,
    MINUS: 0xbd,
    COMMA: 0xbc,
    PERIOD: 0xbe,
    SLASH: 0xbf,
    SEMICOLON: 0xba,
    '[': 0xdb,
    ']': 0xdd,
    '\\': 0xdc,
    QUOTE: 0xde,
    '`': 0xc0,
  };
  if (named[u] !== undefined) {
    return named[u];
  }

  return null;
}

/**
 * Parse an Electron accelerator string into modifier flags + primary key VK.
 * Returns null if the string cannot be parsed.
 */
export function parseElectronAccelerator(accelerator: string): ParsedAccelerator | null {
  const s = accelerator.trim();
  if (!s) return null;

  const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  const keys: string[] = [];

  for (const p of parts) {
    const n = p.toLowerCase();
    if (n === 'commandorcontrol' || n === 'cmdorctrl') {
      ctrl = true;
      continue;
    }
    if (n === 'command' || n === 'cmd') {
      meta = true;
      continue;
    }
    if (n === 'control' || n === 'ctrl') {
      ctrl = true;
      continue;
    }
    if (n === 'shift') {
      shift = true;
      continue;
    }
    if (n === 'alt' || n === 'option') {
      alt = true;
      continue;
    }
    if (n === 'super') {
      meta = true;
      continue;
    }
    keys.push(p);
  }

  if (keys.length !== 1) {
    return null;
  }

  const keyVk = keyNameToVk(keys[0]);
  return { ctrl, shift, alt, meta, keyVk };
}

/**
 * True if every part of the accelerator appears to be held (Windows).
 * If parsing fails or key VK is unknown, returns true so we do not block popups unexpectedly.
 */
export function isAcceleratorPhysicallyHeld(accelerator: string): boolean {
  if (process.platform !== 'win32') {
    return true;
  }

  const fn = loadWin32();
  if (!fn) {
    return true;
  }

  const parsed = parseElectronAccelerator(accelerator);
  if (!parsed || parsed.keyVk == null) {
    return true;
  }

  const { ctrl, shift, alt, meta, keyVk } = parsed;

  if (ctrl && !isVkDown(fn, 0x11)) return false;
  if (shift && !isVkDown(fn, 0x10)) return false;
  if (alt && !isVkDown(fn, 0x12)) return false;
  if (meta && !isVkDown(fn, 0x5b) && !isVkDown(fn, 0x5c)) return false;
  if (!isVkDown(fn, keyVk)) return false;

  return true;
}
