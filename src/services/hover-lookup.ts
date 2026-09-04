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
    const anchorX = x;
    const anchorY = y;

    if (this.opts.getWordAtPoint) {
      try {
        // Win32 UIA wants physical pixels; Electron cursor points are DIP.
        // Never use the UIA bounding rect as the popup anchor — those rects are
        // physical and on HiDPI they pin the strip to a workArea corner.
        const nativePt =
          process.platform === 'win32' ? cursorToNative(x, y) : { x, y };
        const hit = this.opts.getWordAtPoint(nativePt.x, nativePt.y);
        if (hit && hit.text && isLookupWorthy(hit.text)) {
          const q = normalizeQuery(hit.text);
          if (q.kind === 'word' && q.trimmed) {
            text = q.trimmed;
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
      coordSpace: 'dip',
      confidence: 0.85,
    });
  }
}

const HOVER_OCR_MAX_HALF_W = 360;
const HOVER_OCR_MAX_HALF_H = 80;

function cursorToNative(x: number, y: number): { x: number; y: number } {
  try {
    return screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
  } catch {
    return { x, y };
  }
}

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

/**
 * Hover OCR: same probe for every PP-OCR pack.
 * 1) Line strip to find a glyph height under the cursor.
 * 2) Recrop a window sized from that height (not the det-box width — v5 boxes
 *    are tighter than v4 at the same unclip).
 * 3) Pick the token at the cursor in that window.
 */
function boxTouchesImageEdge(
  b: { x: number; y: number; width: number; height: number },
  imgW: number,
  imgH: number,
  pad = 3,
): boolean {
  return b.x <= pad || b.y <= pad || b.x + b.width >= imgW - pad || b.y + b.height >= imgH - pad;
}

async function ocrWordUnderCursor(x: number, y: number, halfW: number): Promise<string> {
  const halfWidth = Math.max(80, halfW);
  const halfHeight = Math.max(48, Math.round(halfWidth / 5));

  const run = async (hw: number, hh: number) => {
    const capture = await captureAroundPoint(x, y, hw, hh);
    if (!capture) return null;
    const ocr = await ocrEngine.recognize(capture.png);
    const { px, py, scale } = cursorInCapture(capture, x, y);
    const size = capture.image.getSize();
    return { ocr, px, py, scale, imgW: size.width, imgH: size.height };
  };

  const locate = await run(halfWidth, halfHeight);
  if (!locate) return '';

  const hit = lineNearPoint(locate.ocr, locate.px, locate.py);
  const clipped = !!(hit?.bounds && boxTouchesImageEdge(hit.bounds, locate.imgW, locate.imgH));
  let emDip = hit?.bounds ? Math.max(10, hit.bounds.height / (locate.scale || 1)) : 16;
  if (clipped) emDip = Math.max(emDip, emDip * 1.8, 28);
  const cjk = !!(hit?.text && /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(hit.text)
    && !/[A-Za-z]{3,}/.test(hit.text));
  const wordHalfW = Math.min(
    HOVER_OCR_MAX_HALF_W,
    Math.max(halfWidth, Math.round(cjk ? emDip * 2 : emDip * 8), clipped ? 240 : 0),
  );
  const wordHalfH = Math.min(
    HOVER_OCR_MAX_HALF_H,
    Math.max(halfHeight, Math.round((emDip * 5) / 4), clipped ? 56 : 0),
  );
  const sameCrop = Math.abs(wordHalfW - halfWidth) < 8 && Math.abs(wordHalfH - halfHeight) < 8;
  const pass = sameCrop ? locate : (await run(wordHalfW, wordHalfH)) || locate;
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
