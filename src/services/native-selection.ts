/**
 * Pure Native Text Selection Service - UIAutomation Implementation
 * 
 * This service implements REAL native text selection monitoring using Microsoft UI Automation
 * with debounced selection detection (500ms delay) to prevent spam from word-by-word selection.
 * 
 * Goal: Detect when user selects text and get the selected text without requiring any copying
 * or additional actions. Uses intelligent debouncing like Youdao Dictionary.
 */

import { screen } from 'electron';
import { wrapConsole } from '../logger';
import { isLookupWorthy, sanitize } from './text-normalize';

const console = wrapConsole('native-selection');

export interface SelectionEvent {
  text: string;
  x: number;
  y: number;
  timestamp: number;
  source: 'native' | 'manual';
}

export interface NativeSelectionService {
  start(): Promise<void>;
  stop(): Promise<void>;
  onSelection(callback: (event: SelectionEvent) => void): void;
  isSupported(): boolean;
  getStatus(): { isRunning: boolean; platform: string; method: string };
}

/**
 * Windows Native Selection Service - UIAutomation Implementation
 * Uses Microsoft UI Automation with debounced selection detection
 */
export class WindowsNativeSelectionService implements NativeSelectionService {
  /** A lookup query is never a whole document. */
  private static readonly MAX_SELECTION_LENGTH = 2000;
  /** How long two consecutive selections stay comparable for typing detection. */
  private static readonly TYPING_PATTERN_WINDOW_MS = 2500;

  private isRunning = false;
  private selectionCallbacks: ((event: SelectionEvent) => void)[] = [];
  private lastSelection = '';
  private lastSelectionTime = 0;
  /** Every selection the native layer reported, accepted or not. */
  private lastSeenText = '';
  private lastSeenAt = 0;
  private nativeAddon: any = null;

  constructor() {
    console.log('[UIA-SERVICE] WindowsNativeSelectionService created');
    this.loadNativeAddon();
  }

  private loadNativeAddon(): void {
    try {
      // Load the UIAutomation native addon
      const NativeSelectionMonitor = require('../../native-addon');
      this.nativeAddon = new NativeSelectionMonitor();
      console.log('[UIA-SERVICE] UIAutomation native addon loaded successfully');
    } catch (error) {
      console.error('[UIA-SERVICE] Failed to load UIAutomation native addon:', error);
      console.error('[UIA-SERVICE] UIAutomation is required for text selection monitoring');
      this.nativeAddon = null;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[UIA-SERVICE] Already running');
      return;
    }

    console.log('[UIA-SERVICE] Starting UIAutomation selection monitoring');

    if (!this.nativeAddon) {
      throw new Error('UIAutomation native addon not available. Please ensure the native addon is built correctly.');
    }

    await this.startUIAutomationMonitoring();
    this.isRunning = true;
  }

  private async startUIAutomationMonitoring(): Promise<void> {
    try {
      
      // Set up callback for debounced selection events
      this.nativeAddon.onSelection((payload: { text: string; x: number; y: number }) => {
        const { text, x, y } = payload || { text: '', x: 0, y: 0 };
        this.handleSelection(text, 'native', x, y);
      });

      // Start UIAutomation monitoring
      const success = this.nativeAddon.start();

      if (success) {
        console.log('[UIA-SERVICE] ✅ UIAutomation monitoring started successfully');
      } else {
        throw new Error('Failed to start UIAutomation monitoring');
      }
    } catch (error) {
      console.error('[UIA-SERVICE] ❌ Error starting UIAutomation:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[UIA-SERVICE] Stopping UIAutomation selection monitoring');
    this.isRunning = false;

    // Stop native addon if running
    if (this.nativeAddon && typeof this.nativeAddon.stop === 'function') {
      try {
        this.nativeAddon.stop();
        console.log('[UIA-SERVICE] UIAutomation stopped');
      } catch (error) {
        console.error('[UIA-SERVICE] Error stopping UIAutomation:', error);
      }
    }
  }

  onSelection(callback: (event: SelectionEvent) => void): void {
    this.selectionCallbacks.push(callback);
  }

  isSupported(): boolean {
    return process.platform === 'win32' && this.nativeAddon !== null;
  }

  getStatus(): { isRunning: boolean; platform: string; method: string } {
    return {
      isRunning: this.isRunning,
      platform: 'windows',
      method: this.nativeAddon ? 'ui-automation' : 'not-available'
    };
  }

  /**
   * Handle selection events from native addon
   */
  private handleSelection(text: string, source: 'native', selX?: number, selY?: number): void {
    try {
      const previousSeen = this.lastSeenText;
      const previousSeenAt = this.lastSeenAt;
      this.lastSeenText = text;
      this.lastSeenAt = Date.now();

      if (!this.isValidTextSelection(text, previousSeen, previousSeenAt)) {
        return;
      }
      
      // Check for duplicate selections - allow duplicates after some time
      const now = Date.now();
      const timeSinceLastSelection = now - (this.lastSelectionTime || 0);

      // More aggressive rate limiting to prevent bursts
      const MIN_RETRIGGER_INTERVAL_MS = 300; // increased from 200ms to prevent bursts
      if (timeSinceLastSelection < MIN_RETRIGGER_INTERVAL_MS) {
        return;
      }

      // Additional check: if we just processed the same text very recently, be more restrictive
      if (this.lastSelection === text && timeSinceLastSelection < 800) {
        return;
      }
      
      // Update last selection and time
      this.lastSelection = text;
      this.lastSelectionTime = now;
      
      // Use selection bounds if provided, otherwise fall back to cursor position
      let anchorPosition = screen.getCursorScreenPoint();
      if (selX != null && selY != null) {
        // Use the provided selection coordinates as the anchor point
        anchorPosition = { x: selX, y: selY };
      }
      
      // Create selection event
      const selectionEvent: SelectionEvent = {
        text,
        x: anchorPosition.x,
        y: anchorPosition.y,
        timestamp: Date.now(),
        source
      };

      // Notify all callbacks
      this.selectionCallbacks.forEach((callback) => {
        try {
          callback(selectionEvent);
        } catch (error) {
          console.error(`[UIA-SERVICE] Error in callback:`, error);
        }
      });
      
    } catch (error) {
      console.error('[UIA-SERVICE] Error handling selection:', error);
    }
  }

  /**
   * Validate if the selected text is worth processing
   */
  private isValidTextSelection(text: string, previousSeen: string, previousSeenAt: number): boolean {
    if (!isLookupWorthy(text)) {
      return false;
    }

    if (sanitize(text).length > WindowsNativeSelectionService.MAX_SELECTION_LENGTH) {
      return false;
    }

    if (this.looksLikeTyping(text, previousSeen, previousSeenAt)) {
      console.log('[UIA-SERVICE] Skipping selection that looks like in-progress typing');
      return false;
    }

    return true;
  }

  /**
   * Second line of defence behind the native input gate: while someone types,
   * consecutive "selections" grow or shrink one character at a time. A real
   * selection almost never arrives as a one-character extension of the last one.
   */
  private looksLikeTyping(text: string, previousSeen: string, previousSeenAt: number): boolean {
    if (!previousSeen || previousSeen === text) return false;
    if (Date.now() - previousSeenAt > WindowsNativeSelectionService.TYPING_PATTERN_WINDOW_MS) {
      return false;
    }

    const delta = Math.abs(text.length - previousSeen.length);
    if (delta === 0 || delta > 2) return false;

    const [shorter, longer] =
      text.length < previousSeen.length ? [text, previousSeen] : [previousSeen, text];
    return longer.startsWith(shorter);
  }
}

/**
 * macOS Native Selection Service - Placeholder for future implementation
 */
export class MacOSNativeSelectionService implements NativeSelectionService {
  private isRunning = false;
  private selectionCallbacks: ((event: SelectionEvent) => void)[] = [];

  constructor() {
    console.log('[NATIVE-SERVICE] MacOSNativeSelectionService created');
  }

  async start(): Promise<void> {
    console.log('[NATIVE-SERVICE] macOS native selection not implemented yet');
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }

  onSelection(callback: (event: SelectionEvent) => void): void {
    this.selectionCallbacks.push(callback);
  }

  isSupported(): boolean {
    return process.platform === 'darwin';
  }

  getStatus(): { isRunning: boolean; platform: string; method: string } {
    return {
      isRunning: this.isRunning,
      platform: 'macos',
      method: 'not-implemented'
    };
  }
}

/**
 * Linux Native Selection Service - Placeholder for future implementation
 */
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
      method: 'not-implemented'
    };
  }
}

/**
 * Factory function to create the appropriate native selection service
 */
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

/**
 * Mock service for unsupported platforms or testing
 */
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
      method: 'not-supported'
    };
  }
}