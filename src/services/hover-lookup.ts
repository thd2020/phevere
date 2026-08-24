/**
 * Hover-to-lookup: when the cursor dwells over a word, emit a ContextEvent.
 *
 * Prefer UIA RangeFromPoint (selectable text). If that returns nothing, OCR a
 * small rectangle under the cursor (unselectable UI).
 */

import { screen, BrowserWindow } from 'electron';
import { wrapConsole } from '../logger';
import { isLookupWorthy, normalizeQuery } from './text-normalize';
import { contextCaptureHub } from './context-capture';
import { captureScreenRegion } from './screen-capture';
import { ocrEngine, textNearPoint } from './ocr-engine';

const console = wrapConsole('hover-lookup');

export interface HoverLookupOptions {
  /** Mouse must stay within this many DIP pixels. */
  moveTolerancePx?: number;
  /** Dwell before probing the word under the cursor. */
  dwellMs?: number;
  /** Minimum gap between hover popups. */
  cooldownMs?: number;
  /** Half-size of the OCR fallback crop around the cursor. */
  ocrRadiusPx?: number;
  /** Skip while any of these windows are focused. */
  isBlocked?: () => boolean;
  /** UIA word-at-point; returns empty when unavailable. */
  getWordAtPoint?: (x: number, y: number) => { text: string; x: number; y: number };
}

const DEFAULTS = {
  moveTolerancePx: 6,
  dwellMs: 450,
  cooldownMs: 900,
  /** Tight enough that PP-OCR sees one line; long Latin words still fit. */
  ocrRadiusPx: 64,
};

export class HoverLookupService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private anchor = { x: 0, y: 0 };
  private dwellStartedAt = 0;
  private dwellConsumed = false;
  private lastEmitText = '';
  private lastEmitAt = 0;
  private probing = false;
  private readonly opts: Required<Omit<HoverLookupOptions, 'isBlocked' | 'getWordAtPoint'>> &
    Pick<HoverLookupOptions, 'isBlocked' | 'getWordAtPoint'>;

  constructor(options: HoverLookupOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const pos = screen.getCursorScreenPoint();
    this.anchor = { x: pos.x, y: pos.y };
    this.dwellStartedAt = Date.now();
    this.dwellConsumed = false;
    this.timer = setInterval(() => void this.tick(), 80);
    console.log('Hover lookup started');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('Hover lookup stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private resetDwell(x: number, y: number): void {
    this.anchor = { x, y };
    this.dwellStartedAt = Date.now();
    this.dwellConsumed = false;
  }

  private async tick(): Promise<void> {
    if (!this.running || this.probing) return;

    const pos = screen.getCursorScreenPoint();

    if (this.opts.isBlocked && this.opts.isBlocked()) {
      this.resetDwell(pos.x, pos.y);
      return;
    }

    const dx = Math.abs(pos.x - this.anchor.x);
    const dy = Math.abs(pos.y - this.anchor.y);
    if (dx > this.opts.moveTolerancePx || dy > this.opts.moveTolerancePx) {
      this.resetDwell(pos.x, pos.y);
      return;
    }

    if (this.dwellConsumed) return;
    if (Date.now() - this.dwellStartedAt < this.opts.dwellMs) return;

    this.dwellConsumed = true;
    this.probing = true;
    try {
      await this.probe(this.anchor.x, this.anchor.y);
    } finally {
      this.probing = false;
    }
  }

  private async probe(x: number, y: number): Promise<void> {
    const now = Date.now();
    if (now - this.lastEmitAt < this.opts.cooldownMs) return;

    let text = '';
    let anchorX = x;
    let anchorY = y;

    if (this.opts.getWordAtPoint) {
      try {
        const hit = this.opts.getWordAtPoint(x, y);
        if (hit && hit.text && isLookupWorthy(hit.text)) {
          const q = normalizeQuery(hit.text);
          if (q.kind === 'word' && q.trimmed) {
            text = q.trimmed;
            anchorX = typeof hit.x === 'number' ? hit.x : x;
            anchorY = typeof hit.y === 'number' ? hit.y : y;
          }
        }
      } catch (error) {
        console.warn('getWordAtPoint failed', error);
      }
    }

    if (!text) {
      const r = this.opts.ocrRadiusPx;
      const capture = await captureScreenRegion({
        x: x - r,
        y: y - r,
        width: r * 2,
        height: r * 2,
      });
      if (capture) {
        const ocr = await ocrEngine.recognize(capture.png);
        const scale = capture.scaleFactor || 1;
        const picked = textNearPoint(ocr, r * scale, r * scale);
        if (picked && isLookupWorthy(picked)) {
          text = picked.trim();
        }
      }
    }

    if (!text) return;
    if (text === this.lastEmitText && now - this.lastEmitAt < this.opts.cooldownMs * 3) {
      return;
    }

    this.lastEmitText = text;
    this.lastEmitAt = now;

    contextCaptureHub.emit({
      text,
      x: anchorX,
      y: anchorY,
      timestamp: Date.now(),
      origin: 'hover',
      confidence: 0.85,
    });
  }
}

/** True when Phevere's own chrome has focus (don't hover-lookup ourselves). */
export function phevereWindowFocused(
  main: BrowserWindow | null,
  popups: BrowserWindow[],
  settings: BrowserWindow | null,
  overlay: BrowserWindow | null,
  external: BrowserWindow[]
): boolean {
  const focused = BrowserWindow.getFocusedWindow();
  if (!focused) return false;
  return (
    focused === main ||
    focused === settings ||
    focused === overlay ||
    popups.includes(focused) ||
    external.includes(focused)
  );
}
