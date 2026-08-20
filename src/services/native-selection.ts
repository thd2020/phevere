/**
 * Pure Native Text Selection Service
 *
 * Windows: Microsoft UI Automation (native-addon).
 * macOS: Accessibility / AX + CGEvent tap (draft backend, same JS payload).
 * Debounce lives in the native layer (~500ms). This file adds rate limits and
 * typing filters, then emits SelectionEvent into the shared context hub.
 */

import { screen } from 'electron';
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

export interface NativeSelectionService {
  start(): Promise<void>;
  stop(): Promise<void>;
  onSelection(callback: (event: SelectionEvent) => void): void;
  isSupported(): boolean;
  getStatus(): { isRunning: boolean; platform: string; method: string };
  /** Optional: word under cursor for hover lookup. */
  getWordAtPoint?(x: number, y: number): { text: string; x: number; y: number };
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
  private nativeAddon: any = null;

  constructor(
    private readonly platformId: 'win32' | 'darwin',
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

    this.nativeAddon.onSelection((payload: { text: string; x: number; y: number }) => {
      const { text, x, y } = payload || { text: '', x: 0, y: 0 };
      this.handleSelection(text, 'native', x, y);
    });

    const success = this.nativeAddon.start();
    if (!success) {
      if (this.platformId === 'darwin') {
        throw new Error(
          'macOS Accessibility is off. System Settings → Privacy & Security → Accessibility — enable Electron (dev) or Phevere (packaged), then restart.',
        );
      }
      throw new Error(`Failed to start ${this.methodLabel} monitoring`);
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

  getWordAtPoint(x: number, y: number): { text: string; x: number; y: number } {
    if (!this.nativeAddon || typeof this.nativeAddon.getWordAtPoint !== 'function') {
      return { text: '', x, y };
    }
    try {
      const result = this.nativeAddon.getWordAtPoint(x, y);
      return {
        text: (result && result.text) || '',
        x: typeof result?.x === 'number' ? result.x : x,
        y: typeof result?.y === 'number' ? result.y : y,
      };
    } catch (error) {
      console.warn('[NATIVE-SERVICE] getWordAtPoint failed', error);
      return { text: '', x, y };
    }
  }

  private handleSelection(text: string, _source: 'native', selX?: number, selY?: number): void {
    try {
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

      let anchorPosition = screen.getCursorScreenPoint();
      if (selX != null && selY != null) {
        anchorPosition = { x: selX, y: selY };
      }

      const selectionEvent: SelectionEvent = {
        ...selectionToContext(text, anchorPosition.x, anchorPosition.y, 'native'),
        origin: 'selection',
        source: 'native',
      };

      this.selectionCallbacks.forEach((callback) => {
        try {
          callback(selectionEvent);
        } catch (error) {
          console.error('[NATIVE-SERVICE] Error in callback:', error);
        }
      });
    } catch (error) {
      console.error('[NATIVE-SERVICE] Error handling selection:', error);
    }
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

/** Placeholder — AT-SPI / X11 selection is not drafted yet. */
export class LinuxNativeSelectionService implements NativeSelectionService {
  private isRunning = false;
  private selectionCallbacks: ((event: SelectionEvent) => void)[] = [];

  constructor() {
    console.log('[NATIVE-SERVICE] LinuxNativeSelectionService created');
  }

  async start(): Promise<void> {
    console.log('[NATIVE-SERVICE] Linux native selection not implemented yet');
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }

  onSelection(callback: (event: SelectionEvent) => void): void {
    this.selectionCallbacks.push(callback);
  }

  isSupported(): boolean {
    return process.platform === 'linux';
  }

  getStatus(): { isRunning: boolean; platform: string; method: string } {
    return {
      isRunning: this.isRunning,
      platform: 'linux',
      method: 'not-implemented',
    };
  }
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
