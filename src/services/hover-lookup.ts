/**
 * Hover-to-lookup: when the cursor dwells over a word, emit a ContextEvent.
 *
 * Prefer UIA RangeFromPoint (selectable text). If that returns nothing, OCR a
 * line-shaped strip under the cursor (unselectable UI) and pick the word box.
 */

import { screen, BrowserWindow } from 'electron';
import { wrapConsole } from '../logger';
import { isLookupWorthy, normalizeQuery } from './text-normalize';
import { contextCaptureHub } from './context-capture';
import { captureAroundPoint } from './screen-capture';
import { ocrEngine, lineNearPoint, textNearPoint } from './ocr-engine';

const console = wrapConsole('hover-lookup');

export interface HoverLookupOptions {
  /** Mouse must stay within this many DIP pixels. */
  moveTolerancePx?: number;
  /** Dwell before probing the word under the cursor. */
  dwellMs?: number;
  /** Minimum gap between hover popups. */
  cooldownMs?: number;
  /** Half-width of the first OCR crop (DIP). Height is derived from this. */
  ocrHalfWidthPx?: number;
  /** Skip OCR fallback (selection already exists, or mouse is down). */
  skipOcr?: () => boolean;
  /** Skip while any of these windows are focused. */
  isBlocked?: () => boolean;
  /** UIA word-at-point; returns empty when unavailable. */
  getWordAtPoint?: (x: number, y: number) => { text: string; x: number; y: number };
}

const DEFAULTS = {
  moveTolerancePx: 6,
  dwellMs: 450,
  cooldownMs: 900,
  /**
   * First-pass crop is a *line strip*, not a word square. PP-OCR/DBNet finds
   * text instances; word bounds come from those boxes (glyph height), not DIP.
   */
  ocrHalfWidthPx: 180,
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
  private readonly opts: Required<Omit<HoverLookupOptions, 'isBlocked' | 'getWordAtPoint' | 'skipOcr'>> &
    Pick<HoverLookupOptions, 'isBlocked' | 'getWordAtPoint' | 'skipOcr'>;

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
      if (this.opts.skipOcr?.()) return;
      const picked = await ocrWordUnderCursor(x, y, this.opts.ocrHalfWidthPx);
      if (picked && isLookupWorthy(picked)) {
        text = picked.trim();
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

const HOVER_OCR_MAX_HALF_W = 360;
const HOVER_OCR_MAX_HALF_H = 80;

function cursorInCapture(
  capture: { bounds: { x: number; y: number }; scaleFactor: number },
  x: number,
  y: number,
): { px: number; py: number; scale: number } {
  const scale = capture.scaleFactor || 1;
  return {
    px: (x - capture.bounds.x) * scale,
    py: (y - capture.bounds.y) * scale,
    scale,
  };
}

function hitTouchesImageEdge(
  box: { x: number; y: number; width: number; height: number },
  imgW: number,
  imgH: number,
): boolean {
  const slop = Math.max(3, box.height * 0.55);
  return box.x <= slop || box.x + box.width >= imgW - slop || box.y <= slop || box.y + box.height >= imgH - slop;
}

/**
 * Hover OCR: capture a line-shaped strip, let DBNet find instances, pick the
 * box under the cursor. If that box is clipped by the crop, expand using the
 * detected glyph height (image pixels → DIP) and recognize once more.
 */
async function ocrWordUnderCursor(x: number, y: number, halfW: number): Promise<string> {
  let halfWidth = Math.max(80, halfW);
  let halfHeight = Math.max(28, Math.round(halfWidth / 5));

  const run = async (hw: number, hh: number) => {
    const capture = await captureAroundPoint(x, y, hw, hh);
    if (!capture) return null;
    const ocr = await ocrEngine.recognize(capture.png);
    const { px, py, scale } = cursorInCapture(capture, x, y);
    const size = capture.image.getSize();
    return { capture, ocr, px, py, scale, imgW: size.width, imgH: size.height };
  };

  let pass = await run(halfWidth, halfHeight);
  if (!pass) return '';

  const hit = lineNearPoint(pass.ocr, pass.px, pass.py);
  if (hit?.bounds && hitTouchesImageEdge(hit.bounds, pass.imgW, pass.imgH)) {
    const glyphDip = Math.max(12, hit.bounds.height / (pass.scale || 1));
    halfWidth = Math.min(HOVER_OCR_MAX_HALF_W, Math.max(halfWidth, Math.round(glyphDip * 10)));
    halfHeight = Math.min(HOVER_OCR_MAX_HALF_H, Math.max(halfHeight, Math.round(glyphDip * 1.6)));
    const again = await run(halfWidth, halfHeight);
    if (again) pass = again;
  }

  return textNearPoint(pass.ocr, pass.px, pass.py).trim();
}

/** True when the OCR region overlay has focus (don't hover-OCR the overlay itself). */
export function phevereWindowFocused(
  _main: BrowserWindow | null,
  _popups: BrowserWindow[],
  _settings: BrowserWindow | null,
  overlay: BrowserWindow | null,
  _external: BrowserWindow[]
): boolean {
  const focused = BrowserWindow.getFocusedWindow();
  if (!focused) return false;
  return !!(overlay && focused === overlay);
}
