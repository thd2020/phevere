/**
 * Detect whether an Electron-style accelerator chord is physically held.
 * Used so "shortcut" monitor mode only opens the popup when the user holds
 * the trigger while finishing a selection (select-then-trigger still uses
 * Electron globalShortcut).
 *
 * - Windows: GetAsyncKeyState via koffi
 * - macOS: CGEventSourceKeyState via koffi
 * - Other platforms: returns true (shortcut mode behaves like "on")
 *
 * If koffi cannot load (e.g. native binary not unpacked from ASAR), returns **false**
 * so we never treat "keys held" — avoids double popups with the global trigger shortcut.
 */

export interface ParsedAccelerator {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  keyVk: number | null;
  keyToken: string;
}

let getAsyncKeyState: ((vk: number) => number) | null | undefined;
let cgEventSourceKeyState: ((stateId: number, keyCode: number) => number) | null | undefined;
let cgEventSourceButtonState: ((stateId: number, button: number) => number) | null | undefined;
let warnedKoffiUnavailable = false;

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

function loadDarwin(): ((stateId: number, keyCode: number) => number) | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  if (cgEventSourceKeyState === null) {
    return null;
  }
  if (cgEventSourceKeyState !== undefined) {
    return cgEventSourceKeyState;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as {
      load: (name: string) => { func: (sig: string) => (stateId: number, keyCode: number) => number };
    };
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    cgEventSourceKeyState = cg.func('uint8 CGEventSourceKeyState(int32, uint16)');
    try {
      cgEventSourceButtonState = cg.func('uint8 CGEventSourceButtonState(int32, uint32)');
    } catch {
      cgEventSourceButtonState = null;
    }
    return cgEventSourceKeyState;
  } catch {
    cgEventSourceKeyState = null;
    return null;
  }
}

function isVkDown(fn: (vk: number) => number, vk: number): boolean {
  return ((fn(vk) as number) & 0x8000) !== 0;
}

const kCGEventSourceStateCombinedSessionState = 0;

function isCgKeyDown(fn: (stateId: number, keyCode: number) => number, keyCode: number): boolean {
  return fn(kCGEventSourceStateCombinedSessionState, keyCode) !== 0;
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
 * Electron accelerator token → macOS ANSI CGKeyCode (HIToolbox Events.h).
 * Letter/digit codes are US-ANSI key positions, same as Carbon kVK_ANSI_*.
 */
export function keyNameToCgKeyCode(name: string): number | null {
  const raw = name.trim();
  if (!raw) return null;
  const u = raw.toUpperCase();

  const letters: Record<string, number> = {
    A: 0x00,
    S: 0x01,
    D: 0x02,
    F: 0x03,
    H: 0x04,
    G: 0x05,
    Z: 0x06,
    X: 0x07,
    C: 0x08,
    V: 0x09,
    B: 0x0b,
    Q: 0x0c,
    W: 0x0d,
    E: 0x0e,
    R: 0x0f,
    Y: 0x10,
    T: 0x11,
    O: 0x1f,
    U: 0x20,
    I: 0x22,
    P: 0x23,
    L: 0x25,
    J: 0x26,
    K: 0x28,
    N: 0x2d,
    M: 0x2e,
  };
  if (u.length === 1 && letters[u] !== undefined) {
    return letters[u];
  }

  const digits: Record<string, number> = {
    '1': 0x12,
    '2': 0x13,
    '3': 0x14,
    '4': 0x15,
    '5': 0x17,
    '6': 0x16,
    '7': 0x1a,
    '8': 0x1c,
    '9': 0x19,
    '0': 0x1d,
  };
  if (u.length === 1 && digits[u] !== undefined) {
    return digits[u];
  }

  const f = /^F(\d{1,2})$/i.exec(u);
  if (f) {
    const n = parseInt(f[1], 10);
    const fKeys: Record<number, number> = {
      1: 0x7a,
      2: 0x78,
      3: 0x63,
      4: 0x76,
      5: 0x60,
      6: 0x61,
      7: 0x62,
      8: 0x64,
      9: 0x65,
      10: 0x6d,
      11: 0x67,
      12: 0x6f,
      13: 0x69,
      14: 0x6b,
      15: 0x71,
      16: 0x6a,
      17: 0x40,
      18: 0x4f,
      19: 0x50,
      20: 0x5a,
    };
    return fKeys[n] ?? null;
  }

  const named: Record<string, number> = {
    SPACE: 0x31,
    TAB: 0x30,
    ENTER: 0x24,
    RETURN: 0x24,
    ESCAPE: 0x35,
    ESC: 0x35,
    BACKSPACE: 0x33,
    DELETE: 0x75,
    UP: 0x7e,
    DOWN: 0x7d,
    LEFT: 0x7b,
    RIGHT: 0x7c,
    HOME: 0x73,
    END: 0x77,
    PAGEUP: 0x74,
    PAGEDOWN: 0x79,
    PLUS: 0x18,
    '=': 0x18,
    MINUS: 0x1b,
    COMMA: 0x2b,
    PERIOD: 0x2f,
    SLASH: 0x2c,
    SEMICOLON: 0x29,
    '[': 0x21,
    ']': 0x1e,
    '\\': 0x2a,
    QUOTE: 0x27,
    '`': 0x32,
  };
  return named[u] ?? null;
}

const kVK_Command = 0x37;
const kVK_RightCommand = 0x36;
const kVK_Shift = 0x38;
const kVK_RightShift = 0x3c;
const kVK_Option = 0x3a;
const kVK_RightOption = 0x3d;
const kVK_Control = 0x3b;
const kVK_RightControl = 0x3e;

/**
 * Parse an Electron accelerator string into modifier flags + primary key.
 * `CommandOrControl` / `CmdOrCtrl` follow Electron: Command on macOS, Control elsewhere.
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
      if (process.platform === 'darwin') {
        meta = true;
      } else {
        ctrl = true;
      }
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

  const keyToken = keys[0];
  const keyVk = keyNameToVk(keyToken);
  return { ctrl, shift, alt, meta, keyVk, keyToken };
}

function warnKoffiOnce(api: string): void {
  if (warnedKoffiUnavailable) return;
  warnedKoffiUnavailable = true;
  console.warn(
    `[phevere] ${api} unavailable (koffi not loaded). ` +
      '"Hold trigger while selecting" is off; use select-then-trigger. ' +
      'Ensure koffi is unpacked from app.asar (see forge packagerConfig.asar.unpackDir).',
  );
}

function isHeldWin32(accelerator: string): boolean {
  const fn = loadWin32();
  if (!fn) {
    warnKoffiOnce('GetAsyncKeyState');
    return false;
  }

  const parsed = parseElectronAccelerator(accelerator);
  if (parsed?.keyVk == null) {
    return false;
  }

  const { ctrl, shift, alt, meta, keyVk } = parsed;

  if (ctrl && !isVkDown(fn, 0x11)) return false;
  if (shift && !isVkDown(fn, 0x10)) return false;
  if (alt && !isVkDown(fn, 0x12)) return false;
  if (meta && !isVkDown(fn, 0x5b) && !isVkDown(fn, 0x5c)) return false;
  if (!isVkDown(fn, keyVk)) return false;

  return true;
}

function isHeldDarwin(accelerator: string): boolean {
  const fn = loadDarwin();
  if (!fn) {
    warnKoffiOnce('CGEventSourceKeyState');
    return false;
  }

  const parsed = parseElectronAccelerator(accelerator);
  if (!parsed) {
    return false;
  }
  const keyCode = keyNameToCgKeyCode(parsed.keyToken);
  if (keyCode == null) {
    return false;
  }

  const { ctrl, shift, alt, meta } = parsed;
  if (ctrl && !isCgKeyDown(fn, kVK_Control) && !isCgKeyDown(fn, kVK_RightControl)) return false;
  if (shift && !isCgKeyDown(fn, kVK_Shift) && !isCgKeyDown(fn, kVK_RightShift)) return false;
  if (alt && !isCgKeyDown(fn, kVK_Option) && !isCgKeyDown(fn, kVK_RightOption)) return false;
  if (meta && !isCgKeyDown(fn, kVK_Command) && !isCgKeyDown(fn, kVK_RightCommand)) return false;
  if (!isCgKeyDown(fn, keyCode)) return false;

  return true;
}

/**
 * True if every part of the accelerator appears to be held.
 * On failure to load koffi or parse the accelerator, returns **false** (assume not held)
 * so shortcut mode does not open on selection alone — the global trigger path still works.
 */
export function isAcceleratorPhysicallyHeld(accelerator: string): boolean {
  if (process.platform === 'win32') {
    return isHeldWin32(accelerator);
  }
  if (process.platform === 'darwin') {
    return isHeldDarwin(accelerator);
  }
  return true;
}

const VK_LBUTTON = 0x01;
const kCGMouseButtonLeft = 0;

/** True while the primary mouse button is held (drag-select). Other platforms: false. */
export function isPrimaryMouseDown(): boolean {
  if (process.platform === 'win32') {
    const fn = loadWin32();
    if (!fn) return false;
    return isVkDown(fn, VK_LBUTTON);
  }
  if (process.platform === 'darwin') {
    loadDarwin();
    if (!cgEventSourceButtonState) return false;
    try {
      return cgEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft) !== 0;
    } catch {
      return false;
    }
  }
  return false;
}
