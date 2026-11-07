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
import type { WordAtPoint } from './native-selection';

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
  /** Primary button state; a press after a selection ends that selection's hold on hover. */
  isMouseDown?: () => boolean;
  /** Longest a selection keeps hover quiet when no press is seen. */
  selectionHoldMs?: number;
  /**
   * A result counts only while the pointer is still this close (DIP) to where the dwell
   * started. UIA and OCR take hundreds of ms, and a word read after the pointer left
   * would open the strip where the pointer used to be.
   */
  staleTolerancePx?: number;
  /** UIA word-at-point; returns empty when unavailable. */
  getWordAtPoint?: (x: number, y: number) => WordAtPoint | Promise<WordAtPoint>;
  /** A read asked for (requestNow) landed on a Phevere window, at this DIP point: that page reads its own word. */
  onOwnWindow?: (x: number, y: number) => void;
  /**
   * Pointer in DIP. Default: Electron's. Plasma Wayland passes KWin's, because
   * Xwayland's copy freezes while the pointer is over a native Wayland window.
   */
  cursor?: { point: () => { x: number; y: number }; start?: () => void; stop?: () => void };
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
  selectionHoldMs: 60_000,
  staleTolerancePx: 24,
};

/** How long a {@link HoverLookupService.requestNow} waits for the running probe to finish. */
const FORCED_PROBE_MS = 2500;

export class HoverLookupService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private anchor = { x: 0, y: 0 };
  private dwellStartedAt = 0;
  private dwellConsumed = false;
  private lastEmitText = '';
  private lastEmitAt = 0;
  private lastEmitPoint: { x: number; y: number } | null = null;
  /** The last word's strip closed with the pointer still on it; stay quiet there until it leaves. */
  private quietUntilLeave = false;
  /** Until this time the next tick probes at once, skipping the dwell and the repeat checks. */
  private forcedUntil = 0;
  private probing = false;
  /** Bumped by every selection, so a probe that started before it cannot emit after it. */
  private generation = 0;
  private heldAt = 0;
  private heldSawRelease = false;
  private readonly opts: Required<
    Omit<HoverLookupOptions, 'isBlocked' | 'getWordAtPoint' | 'onOwnWindow' | 'skipOcr' | 'cursor' | 'isMouseDown'>
  > &
    Pick<HoverLookupOptions, 'isBlocked' | 'getWordAtPoint' | 'onOwnWindow' | 'skipOcr' | 'cursor' | 'isMouseDown'>;

  constructor(options: HoverLookupOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.opts.cursor?.start?.();
    const pos = this.cursorPoint();
    this.anchor = { x: pos.x, y: pos.y };
    this.dwellStartedAt = Date.now();
    this.dwellConsumed = false;
    this.timer = setInterval(() => void this.tick(), 80);
    console.log('Hover lookup started');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.opts.cursor?.stop?.();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('Hover lookup stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * A text selection outranks hover. Drop any probe already running and stay quiet
   * until the next mouse press (which clears or replaces the selection).
   */
  holdForSelection(): void {
    this.generation += 1;
    this.heldAt = Date.now();
    this.heldSawRelease = !this.opts.isMouseDown?.();
  }

  /** True while the latest selection still holds hover off. */
  isHeldBySelection(): boolean {
    if (!this.heldAt) return false;
    if (Date.now() - this.heldAt > this.opts.selectionHoldMs) {
      this.heldAt = 0;
      return false;
    }
    return true;
  }

  /** The press that ends a hold must start after the selection, not be the drag that made it. */
  private watchSelectionHold(): boolean {
    if (!this.isHeldBySelection()) return false;
    const down = !!this.opts.isMouseDown?.();
    if (!down) {
      this.heldSawRelease = true;
      return true;
    }
    if (this.heldSawRelease) {
      this.heldAt = 0;
      return false;
    }
    return true;
  }

  /** True while the pointer is still on the spot (DIP) a hover word was read at. */
  pointerNear(x: number, y: number): boolean {
    const pos = this.cursorPoint();
    const t = this.opts.staleTolerancePx;
    return Math.abs(pos.x - x) <= t && Math.abs(pos.y - y) <= t;
  }

  /**
   * Read the word under the pointer now instead of after a dwell. The trigger shortcut
   * uses this when the stored hover word is somewhere the pointer has left.
   */
  requestNow(): void {
    if (!this.running) return;
    this.forcedUntil = Date.now() + FORCED_PROBE_MS;
    if (!this.probing) {
      const pos = this.cursorPoint();
      this.resetDwell(pos.x, pos.y);
    }
    void this.tick();
  }

  /**
   * The strip that showed the last hover word closed, so that word may open it again.
   * A click that closed it usually leaves the pointer on the word; then the word opens
   * again only after the pointer has left it, or the strip would come straight back.
   */
  forgetLastEmit(): void {
    const last = this.lastEmitPoint;
    if (last && this.pointerNear(last.x, last.y)) {
      this.quietUntilLeave = true;
      return;
    }
    this.lastEmitText = '';
    this.lastEmitPoint = null;
    this.quietUntilLeave = false;
  }

  private cursorPoint(): { x: number; y: number } {
    return this.opts.cursor ? this.opts.cursor.point() : screen.getCursorScreenPoint();
  }

  private resetDwell(x: number, y: number): void {
    this.anchor = { x, y };
    this.dwellStartedAt = Date.now();
    this.dwellConsumed = false;
  }

  private async tick(): Promise<void> {
    if (!this.running || this.probing) return;

    const pos = this.cursorPoint();

    // A trigger pressed during a selection hold or a drag is not carried over to
    // wherever the pointer is once it ends.
    if (this.watchSelectionHold()) {
      this.forcedUntil = 0;
      this.resetDwell(pos.x, pos.y);
      return;
    }

    if (this.opts.isBlocked && this.opts.isBlocked()) {
      this.forcedUntil = 0;
      this.resetDwell(pos.x, pos.y);
      return;
    }

    const last = this.lastEmitPoint;
    if (this.quietUntilLeave && last && !this.pointerNear(last.x, last.y)) this.forgetLastEmit();

    const forced = Date.now() < this.forcedUntil;
    const dx = Math.abs(pos.x - this.anchor.x);
    const dy = Math.abs(pos.y - this.anchor.y);
    if (dx > this.opts.moveTolerancePx || dy > this.opts.moveTolerancePx) {
      this.resetDwell(pos.x, pos.y);
      if (!forced) return;
    }

    if (!forced) {
      if (this.dwellConsumed) return;
      if (Date.now() - this.dwellStartedAt < this.opts.dwellMs) return;
      // Wait out the cooldown without spending the dwell. When probe() returned early
      // for it, the dwell still counted as used, and a word hovered soon after the last
      // one never opened until the pointer moved again.
      if (Date.now() - this.lastEmitAt < this.opts.cooldownMs) return;
    }

    this.forcedUntil = 0;
    this.dwellConsumed = true;
    this.probing = true;
    try {
      await this.probe(this.anchor.x, this.anchor.y, forced);
    } finally {
      this.probing = false;
    }
  }

  private async probe(x: number, y: number, forced = false): Promise<void> {
    const now = Date.now();
    const generation = this.generation;

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
        const hit = await this.opts.getWordAtPoint(nativePt.x, nativePt.y);
        // Phevere's own window or dialog: no OCR either, the page handles its own words.
        if (hit?.own) {
          if (forced) this.opts.onOwnWindow?.(x, y);
          return;
        }
        if (hit && hit.text && !wordBoxHolds(hit, nativePt)) {
          console.log('UIA word is beside the cursor; reading pixels instead', hit.text);
        } else if (hit && hit.text && isLookupWorthy(hit.text)) {
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
    // UIA and OCR take hundreds of ms; a selection made meanwhile wins.
    if (generation !== this.generation || this.isHeldBySelection() || this.opts.isBlocked?.()) return;
    // The pointer left while UIA or OCR ran. The dwell at the new spot looks that word up.
    if (!this.pointerNear(anchorX, anchorY)) return;
    // Jitter inside one word restarts the dwell; that must not move the strip. The same
    // word somewhere else, or after its strip closed, is a new lookup.
    const last = this.lastEmitPoint;
    const t = this.opts.staleTolerancePx;
    if (
      !forced &&
      text === this.lastEmitText &&
      last &&
      Math.abs(last.x - anchorX) <= t &&
      Math.abs(last.y - anchorY) <= t &&
      (this.quietUntilLeave || now - this.lastEmitAt < this.opts.cooldownMs * 3)
    ) {
      return;
    }

    this.lastEmitText = text;
    this.lastEmitAt = now;
    this.lastEmitPoint = { x: anchorX, y: anchorY };
    this.quietUntilLeave = false;
    // A probe already running when the trigger came, and still under the pointer, answers it.
    const requested = forced || Date.now() < this.forcedUntil;
    this.forcedUntil = 0;

    contextCaptureHub.emit({
      text,
      x: anchorX,
      y: anchorY,
      timestamp: Date.now(),
      origin: 'hover',
      coordSpace: 'dip',
      confidence: 0.85,
      ...(requested ? { requested: true } : {}),
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

/**
 * Chromium answers RangeFromPoint with the neighbouring word at some page zooms and
 * window positions. Trust the UIA word only when its box contains the cursor.
 */
function wordBoxHolds(hit: WordAtPoint, pt: { x: number; y: number }): boolean {
  const b = hit.bounds;
  if (!b || !(b.width > 0) || !(b.height > 0)) return true;
  const pad = 2;
  return pt.x >= b.x - pad && pt.x <= b.x + b.width + pad && pt.y >= b.y - pad && pt.y <= b.y + b.height + pad;
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

/** True when the OCR overlay has focus, or the pointer is over the focused Phevere window. */
export function phevereWindowFocused(
  _main: BrowserWindow | null,
  _popups: BrowserWindow[],
  _settings: BrowserWindow | null,
  overlay: BrowserWindow | null,
  _external: BrowserWindow[]
): boolean {
  const focused = BrowserWindow.getFocusedWindow();
  if (!focused) return false;
  if (overlay && focused === overlay) return true;
  // The pointer over the focused Phevere window: probing it would block the main thread that
  // window's own input runs through, and the page looks up its own words.
  const p = screen.getCursorScreenPoint();
  const b = focused.getBounds();
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}
