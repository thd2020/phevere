/**
 * Synthetic copy and paste into the app that has focus, for quick translation.
 *
 * Windows sends keybd_event through user32, macOS posts CGEvents (the app already needs
 * Accessibility for selection lookup), and Linux runs xdotool when it is installed. A global
 * shortcut fires while its keys are still down, and Ctrl+C sent with Alt held arrives as
 * Ctrl+Alt+C, so every call first waits for the modifiers to come up.
 */
import { execFile, execFileSync } from 'child_process';

type Win32 = {
  keybdEvent: (vk: number, scan: number, flags: number, extra: number) => void;
  getAsyncKeyState: (vk: number) => number;
  getForegroundWindow: () => number | bigint;
  setForegroundWindow: (hwnd: number | bigint) => boolean;
};

type Darwin = {
  createKeyboardEvent: (source: null, key: number, down: boolean) => unknown;
  setFlags: (event: unknown, flags: bigint) => void;
  post: (tap: number, event: unknown) => void;
  release: (ref: unknown) => void;
  flagsState: (state: number) => bigint;
};

const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;
const KEYEVENTF_KEYUP = 0x2;
const MODIFIER_VKS = [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN];

const kCGEventFlagMaskCommand = 0x100000n;
const kCGEventFlagMaskModifiers = 0x20000n | 0x40000n | 0x80000n | 0x100000n;
const kVK_ANSI_C = 8;
const kVK_ANSI_V = 9;

let win32: Win32 | null | undefined;
let darwin: Darwin | null | undefined;
let xdotool: boolean | undefined;

function loadWin32(): Win32 | null {
  if (win32 !== undefined) return win32;
  win32 = null;
  if (process.platform !== 'win32') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as { load: (name: string) => { func: (sig: string) => (...args: any[]) => any } };
    const user32 = koffi.load('user32.dll');
    win32 = {
      keybdEvent: user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'),
      getAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)'),
      getForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      setForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(uintptr_t hWnd)'),
    };
  } catch (error) {
    console.warn('key-synth: user32 unavailable', error);
    win32 = null;
  }
  return win32;
}

function loadDarwin(): Darwin | null {
  if (darwin !== undefined) return darwin;
  darwin = null;
  if (process.platform !== 'darwin') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as { load: (name: string) => { func: (sig: string) => (...args: any[]) => any } };
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
    darwin = {
      createKeyboardEvent: cg.func('void *CGEventCreateKeyboardEvent(void *source, uint16_t virtualKey, bool keyDown)'),
      setFlags: cg.func('void CGEventSetFlags(void *event, uint64_t flags)'),
      post: cg.func('void CGEventPost(uint32_t tap, void *event)'),
      release: cf.func('void CFRelease(void *cf)'),
      flagsState: cg.func('uint64_t CGEventSourceFlagsState(int32_t stateID)'),
    };
  } catch (error) {
    console.warn('key-synth: CoreGraphics unavailable', error);
    darwin = null;
  }
  return darwin;
}

function hasXdotool(): boolean {
  if (xdotool !== undefined) return xdotool;
  try {
    execFileSync('xdotool', ['version'], { stdio: 'ignore', timeout: 1500 });
    xdotool = true;
  } catch {
    xdotool = false;
  }
  return xdotool;
}

/** Whether this machine can send copy and paste to other apps. */
export function canSynthesizeKeys(): boolean {
  if (process.platform === 'win32') return !!loadWin32();
  if (process.platform === 'darwin') return !!loadDarwin();
  if (process.platform === 'linux') return hasXdotool();
  return false;
}

function modifiersHeld(): boolean {
  const w = loadWin32();
  if (w) return MODIFIER_VKS.some((vk) => (w.getAsyncKeyState(vk) & 0x8000) !== 0);
  const d = loadDarwin();
  if (d) return (BigInt(d.flagsState(0)) & kCGEventFlagMaskModifiers) !== 0n;
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait (up to `timeoutMs`) until Shift, Ctrl, Alt, Win and Cmd are all up. */
export async function waitForModifiersReleased(timeoutMs = 1200): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (modifiersHeld() && Date.now() < until) await sleep(15);
  // Still held after the wait: lift them for the synthetic chord on Windows.
  const w = loadWin32();
  if (w && modifiersHeld()) {
    for (const vk of MODIFIER_VKS) if (w.getAsyncKeyState(vk) & 0x8000) w.keybdEvent(vk, 0, KEYEVENTF_KEYUP, 0);
  }
}

function chord(letter: 'c' | 'v'): void {
  const w = loadWin32();
  if (w) {
    const vk = letter === 'c' ? 0x43 : 0x56;
    w.keybdEvent(VK_CONTROL, 0, 0, 0);
    w.keybdEvent(vk, 0, 0, 0);
    w.keybdEvent(vk, 0, KEYEVENTF_KEYUP, 0);
    w.keybdEvent(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
    return;
  }
  const d = loadDarwin();
  if (d) {
    const key = letter === 'c' ? kVK_ANSI_C : kVK_ANSI_V;
    for (const down of [true, false]) {
      const ev = d.createKeyboardEvent(null, key, down);
      if (!ev) continue;
      d.setFlags(ev, kCGEventFlagMaskCommand);
      d.post(0, ev);
      d.release(ev);
    }
    return;
  }
  if (process.platform === 'linux' && hasXdotool()) {
    execFile('xdotool', ['key', '--clearmodifiers', `ctrl+${letter}`], () => undefined);
  }
}

/** Copy the selection in the focused app. */
export async function sendCopy(): Promise<void> {
  await waitForModifiersReleased();
  chord('c');
}

/** Paste the clipboard into the focused app. */
export async function sendPaste(): Promise<void> {
  await waitForModifiersReleased();
  chord('v');
}

/** The foreground window handle on Windows, so focus can go back to it after the panel. */
export function foregroundWindowHandle(): number | bigint | null {
  const w = loadWin32();
  if (!w) return null;
  try {
    return w.getForegroundWindow() || null;
  } catch {
    return null;
  }
}

/** Give focus back to a window recorded with `foregroundWindowHandle`. */
export function focusWindowHandle(hwnd: number | bigint | null): boolean {
  const w = loadWin32();
  if (!w || !hwnd) return false;
  try {
    return w.setForegroundWindow(hwnd);
  } catch {
    return false;
  }
}
