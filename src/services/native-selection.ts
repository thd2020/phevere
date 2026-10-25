/**
 * Pure Native Text Selection Service
 *
 * Windows: Microsoft UI Automation (native-addon).
 * macOS: Accessibility / AX + CGEvent tap (draft backend, same JS payload).
 * Linux: PRIMARY selection — Wayland data-control or X11 XFixes, plus AT-SPI
 *        for the hover word (native-addon `linux_selection_monitor`).
 * Debounce lives in the native layer (~500ms). This file adds rate limits and
 * typing filters, then emits SelectionEvent into the shared context hub.
 */

import { BrowserWindow, clipboard, screen } from 'electron';
import { execFile } from 'child_process';
import { wrapConsole } from '../logger';
import { isLookupWorthy, sanitize, foldLookupKey } from './text-normalize';
import { ContextEvent, selectionToContext } from './context-capture';

const console = wrapConsole('native-selection');

/** Selection producer payload — a ContextEvent with selection/manual origin. */
export type SelectionEvent = ContextEvent & {
  origin: 'selection' | 'manual';
  /** @deprecated Use origin; kept for older IPC consumers. */
  source?: 'native' | 'manual';
};

/** UIA word under a point. `bounds` is the word box in physical pixels, when the host reports one. */
export interface WordAtPoint {
  text: string;
  x: number;
  y: number;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface NativeSelectionService {
  start(): Promise<void>;
  stop(): Promise<void>;
  onSelection(callback: (event: SelectionEvent) => void): void;
  isSupported(): boolean;
  getStatus(): { isRunning: boolean; platform: string; method: string };
  /** Optional: word under cursor for hover lookup (Linux answers async from a helper process). */
  getWordAtPoint?(x: number, y: number): WordAtPoint | Promise<WordAtPoint>;
  /** macOS TCC; other platforms true. */
  isAccessibilityTrusted?(prompt?: boolean): boolean;
  /** macOS: AX prompt so this binary appears in the Accessibility list. */
  requestAccessibilityPrompt?(): boolean;
  /** Linux: PRIMARY right now as a selection event (`phevere --lookup-selection`). */
  readCurrentSelection?(): Promise<SelectionEvent | null>;
}

/**
 * Shared path for any native addon that exposes start/stop/onSelection({text,x,y}).
 */
class AddonBackedNativeSelectionService implements NativeSelectionService {
  private static readonly MAX_SELECTION_LENGTH = 2000;
  private static readonly TYPING_PATTERN_WINDOW_MS = 2500;

  private isRunning = false;
  private selectionCallbacks: ((event: SelectionEvent) => void)[] = [];
  private lastSelection = '';
  private lastSelectionTime = 0;
  private lastSeenText = '';
  private lastSeenAt = 0;
  protected nativeAddon: any = null;

  constructor(
    private readonly platformId: 'win32' | 'darwin' | 'linux',
    private readonly platformLabel: string,
    private readonly methodLabel: string,
    private readonly missingAddonMessage: string,
  ) {
    this.loadNativeAddon();
  }

  private loadNativeAddon(): void {
    try {
      const NativeSelectionMonitor = require('../../native-addon');
      this.nativeAddon = new NativeSelectionMonitor();
      console.log(`[NATIVE-SERVICE] ${this.methodLabel} addon loaded`);
    } catch (error) {
      console.error(`[NATIVE-SERVICE] Failed to load ${this.methodLabel} addon:`, error);
      this.nativeAddon = null;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[NATIVE-SERVICE] Already running');
      return;
    }

    if (!this.nativeAddon) {
      throw new Error(this.missingAddonMessage);
    }

    this.nativeAddon.onSelection((payload: { text: string; x: number; y: number; space?: string }) => {
      const { text, x, y, space } = payload || { text: '', x: 0, y: 0 };
      this.handleSelection(text, 'native', x, y, space);
    });

    const success = this.nativeAddon.start();
    if (!success) {
      if (this.platformId === 'darwin') {
        throw new Error(
          'macOS Accessibility is off. Enable Electron (dev) or Phevere (packaged) in Privacy → Accessibility.',
        );
      }
      throw new Error(this.startFailureMessage());
    }

    this.isRunning = true;
    console.log(`[NATIVE-SERVICE] ${this.methodLabel} monitoring started`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.nativeAddon && typeof this.nativeAddon.stop === 'function') {
      try {
        this.nativeAddon.stop();
      } catch (error) {
        console.error('[NATIVE-SERVICE] Error stopping addon:', error);
      }
    }
  }

  onSelection(callback: (event: SelectionEvent) => void): void {
    this.selectionCallbacks.push(callback);
  }

  isSupported(): boolean {
    return process.platform === this.platformId && this.nativeAddon !== null;
  }

  getStatus(): { isRunning: boolean; platform: string; method: string } {
    return {
      isRunning: this.isRunning,
      platform: this.platformLabel,
      method: this.nativeAddon ? this.methodLabel : 'not-available',
    };
  }

  protected startFailureMessage(): string {
    return `Failed to start ${this.methodLabel} monitoring`;
  }

  /** Platform hook: drop a selection before any filter runs. */
  protected shouldIgnoreSelection(): boolean {
    return false;
  }

  /** Platform hook: where the popup anchors. Native x, y are physical unless the addon says otherwise. */
  protected resolveAnchor(
    selX: number | undefined,
    selY: number | undefined,
    _space: string | undefined,
  ): { point: { x: number; y: number }; coordSpace: 'dip' | 'physical' } {
    if (selX != null && selY != null) return { point: { x: selX, y: selY }, coordSpace: 'physical' };
    return { point: screen.getCursorScreenPoint(), coordSpace: 'dip' };
  }

  getWordAtPoint(x: number, y: number): WordAtPoint | Promise<WordAtPoint> {
    if (!this.nativeAddon || typeof this.nativeAddon.getWordAtPoint !== 'function') {
      return { text: '', x, y };
    }
    const normalize = (result: any): WordAtPoint => ({
      text: (result && result.text) || '',
      x: typeof result?.x === 'number' ? result.x : x,
      y: typeof result?.y === 'number' ? result.y : y,
      ...(result?.bounds && typeof result.bounds.width === 'number' ? { bounds: result.bounds } : {}),
    });
    try {
      const result = this.nativeAddon.getWordAtPoint(x, y);
      if (result && typeof result.then === 'function') {
        return (result as Promise<unknown>).then(normalize, (error) => {
          console.warn('[NATIVE-SERVICE] getWordAtPoint failed', error);
          return { text: '', x, y };
        });
      }
      return normalize(result);
    } catch (error) {
      console.warn('[NATIVE-SERVICE] getWordAtPoint failed', error);
      return { text: '', x, y };
    }
  }

  isAccessibilityTrusted(prompt = false): boolean {
    if (this.platformId !== 'darwin') return true;
    try {
      return !!(this.nativeAddon && typeof this.nativeAddon.isTrusted === 'function' && this.nativeAddon.isTrusted(prompt));
    } catch {
      return false;
    }
  }

  requestAccessibilityPrompt(): boolean {
    return this.isAccessibilityTrusted(true);
  }

  protected handleSelection(text: string, _source: 'native', selX?: number, selY?: number, space?: string): void {
    try {
      if (this.shouldIgnoreSelection()) return;
      const previousSeen = this.lastSeenText;
      const previousSeenAt = this.lastSeenAt;
      this.lastSeenText = text;
      this.lastSeenAt = Date.now();

      if (!this.isValidTextSelection(text, previousSeen, previousSeenAt)) {
        return;
      }

      const now = Date.now();
      const timeSinceLastSelection = now - (this.lastSelectionTime || 0);

      const MIN_RETRIGGER_INTERVAL_MS = 300;
      if (
        timeSinceLastSelection < MIN_RETRIGGER_INTERVAL_MS &&
        foldLookupKey(text) === foldLookupKey(this.lastSelection || '')
      ) {
        return;
      }

      if (this.lastSelection === text && timeSinceLastSelection < 800) {
        return;
      }

      if (
        this.lastSelection &&
        text !== this.lastSelection &&
        foldLookupKey(text) === foldLookupKey(this.lastSelection)
      ) {
        this.lastSelection = text;
        this.lastSelectionTime = now;
        return;
      }

      this.lastSelection = text;
      this.lastSelectionTime = now;

      const { point: anchorPosition, coordSpace } = this.resolveAnchor(selX, selY, space);

      const selectionEvent: SelectionEvent = {
        ...selectionToContext(text, anchorPosition.x, anchorPosition.y, 'native'),
        origin: 'selection',
        source: 'native',
        coordSpace,
      };

      this.emitToCallbacks(selectionEvent);
    } catch (error) {
      console.error('[NATIVE-SERVICE] Error handling selection:', error);
    }
  }

  protected emitToCallbacks(selectionEvent: SelectionEvent): void {
    this.selectionCallbacks.forEach((callback) => {
      try {
        callback(selectionEvent);
      } catch (error) {
        console.error('[NATIVE-SERVICE] Error in callback:', error);
      }
    });
  }

  private isValidTextSelection(text: string, previousSeen: string, previousSeenAt: number): boolean {
    if (!isLookupWorthy(text)) {
      return false;
    }
    if (sanitize(text).length > AddonBackedNativeSelectionService.MAX_SELECTION_LENGTH) {
      return false;
    }
    if (this.looksLikeTyping(text, previousSeen, previousSeenAt)) {
      console.log('[NATIVE-SERVICE] Skipping selection that looks like in-progress typing');
      return false;
    }
    return true;
  }

  private looksLikeTyping(text: string, previousSeen: string, previousSeenAt: number): boolean {
    if (!previousSeen || previousSeen === text) return false;
    if (Date.now() - previousSeenAt > AddonBackedNativeSelectionService.TYPING_PATTERN_WINDOW_MS) {
      return false;
    }
    const delta = Math.abs(text.length - previousSeen.length);
    if (delta === 0 || delta > 2) return false;
    const [shorter, longer] =
      text.length < previousSeen.length ? [text, previousSeen] : [previousSeen, text];
    return longer.startsWith(shorter);
  }
}

export class WindowsNativeSelectionService extends AddonBackedNativeSelectionService {
  constructor() {
    super(
      'win32',
      'windows',
      'ui-automation',
      'UIAutomation native addon not available. Please ensure the native addon is built correctly.',
    );
  }
}

export class MacOSNativeSelectionService extends AddonBackedNativeSelectionService {
  constructor() {
    super(
      'darwin',
      'macos',
      'accessibility',
      'macOS Accessibility addon not available. On a Mac run npm run build-native (Xcode CLT).',
    );
  }
}

/**
 * Linux: the addon watches PRIMARY (Wayland data-control on KDE / wlroots, else
 * X11 XFixes) and answers getWordAtPoint over AT-SPI. Same filters as Win/Mac.
 */
export class LinuxNativeSelectionService extends AddonBackedNativeSelectionService {
  constructor() {
    super(
      'linux',
      'linux',
      'primary-selection',
      'Linux selection addon not available. Install libx11-dev libxfixes-dev libatspi2.0-dev libwayland-dev, then npm run build-native.',
    );
  }

  getStatus(): { isRunning: boolean; platform: string; method: string } {
    const status = super.getStatus();
    const backend = this.nativeAddon?.getBackend?.();
    if (backend && backend.backend && backend.backend !== 'none') {
      status.method = `primary-selection/${backend.protocol || backend.backend}`;
    }
    return status;
  }

  protected startFailureMessage(): string {
    return (
      'No selection source on this desktop. Select-to-look-up needs KDE Plasma, a wlroots compositor, or an X11 session. ' +
      'On GNOME Wayland, bind "phevere --lookup-selection" to a keyboard shortcut.'
    );
  }

  /** Our own windows have in-app lookup; the Windows addon skips its own PID the same way. */
  protected shouldIgnoreSelection(): boolean {
    const focused = BrowserWindow.getFocusedWindow();
    const ours = Boolean(focused && !focused.isDestroyed());
    if (ours) console.log('[NATIVE-SERVICE] Selection while a Phevere window has focus; in-app lookup handles it');
    return ours;
  }

  protected resolveAnchor(
    selX: number | undefined,
    selY: number | undefined,
    space: string | undefined,
  ): { point: { x: number; y: number }; coordSpace: 'dip' | 'physical' } {
    if (selX != null && selY != null && space === 'dip') return { point: { x: selX, y: selY }, coordSpace: 'dip' };
    if (selX != null && selY != null && space === 'physical') {
      return { point: { x: selX, y: selY }, coordSpace: 'physical' };
    }
    return { point: this.cursorDip(), coordSpace: 'dip' };
  }

  /** KWin knows the pointer even over native Wayland windows; Electron's copy can be stale there. */
  private cursorDip(): { x: number; y: number } {
    const kwin = this.nativeAddon?.getCursorPos?.(150);
    if (kwin && Number.isFinite(kwin.x) && Number.isFinite(kwin.y)) return { x: kwin.x, y: kwin.y };
    return screen.getCursorScreenPoint();
  }

  /**
   * `phevere --lookup-selection` (a desktop shortcut). Reads PRIMARY now, even when
   * monitoring is off: the shortcut press is the trigger. GNOME Wayland has no
   * background PRIMARY read, so this is the path there.
   */
  async readCurrentSelection(): Promise<SelectionEvent | null> {
    let text = '';
    try {
      text = this.nativeAddon?.getCurrentSelection?.() || '';
    } catch {
      text = '';
    }
    if (!text.trim()) {
      try {
        text = clipboard.readText('selection');
      } catch {
        text = '';
      }
    }
    if (!text.trim() && process.env.WAYLAND_DISPLAY) text = await readWlPastePrimary();
    text = text || '';
    if (!isLookupWorthy(text) || sanitize(text).length > 2000) return null;
    const pt = this.cursorDip();
    return {
      ...selectionToContext(text, pt.x, pt.y, 'native'),
      origin: 'selection',
      source: 'native',
      coordSpace: 'dip',
    };
  }
}

function readWlPastePrimary(): Promise<string> {
  return new Promise((resolve) => {
    execFile('wl-paste', ['--primary', '--no-newline'], { timeout: 1500 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

export function createNativeSelectionService(): NativeSelectionService {
  console.log(`[NATIVE-SERVICE] Creating native selection service for platform: ${process.platform}`);

  switch (process.platform) {
    case 'win32':
      return new WindowsNativeSelectionService();
    case 'darwin':
      return new MacOSNativeSelectionService();
    case 'linux':
      return new LinuxNativeSelectionService();
    default:
      console.log(`[NATIVE-SERVICE] Platform ${process.platform} not supported, using mock service`);
      return new MockNativeSelectionService();
  }
}

class MockNativeSelectionService implements NativeSelectionService {
  private isRunning = false;
  private selectionCallbacks: ((event: SelectionEvent) => void)[] = [];

  async start(): Promise<void> {
    console.log('[NATIVE-SERVICE] Mock service started (platform not supported)');
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    console.log('[NATIVE-SERVICE] Mock service stopped');
    this.isRunning = false;
  }

  onSelection(callback: (event: SelectionEvent) => void): void {
    this.selectionCallbacks.push(callback);
    console.log('[NATIVE-SERVICE] Mock service callback registered');
  }

  isSupported(): boolean {
    return false;
  }

  getStatus(): { isRunning: boolean; platform: string; method: string } {
    return {
      isRunning: this.isRunning,
      platform: 'mock',
      method: 'not-supported',
    };
  }
}
