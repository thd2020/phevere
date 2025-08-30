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
  private isRunning = false;
  private selectionCallbacks: ((event: SelectionEvent) => void)[] = [];
  private lastSelection = '';
  private lastSelectionTime = 0;
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
      // Validate the selection
      if (!this.isValidTextSelection(text)) {
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
  private isValidTextSelection(text: string): boolean {
    if (!text || text.trim().length === 0) {
      return false;
    }

    const trimmedText = text.trim();
    
    // Allow single character selections for Chinese/Japanese/Korean
    const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(trimmedText);
    
    // Skip very short selections only for Latin text
    if (trimmedText.length < 2 && !isCJK) {
      return false;
    }

    // Skip selections that are just whitespace
    if (/^\s+$/.test(trimmedText)) {
      return false;
    }

    // More permissive check - allow text with letters, numbers, or CJK characters
    const hasValidContent = /[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff]/.test(trimmedText);
    if (!hasValidContent) {
      return false;
    }

    // Skip selections that are just numbers (but allow numbers with text)
    if (/^\d+$/.test(trimmedText) && trimmedText.length < 4) {
      return false;
    }

    return true;
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