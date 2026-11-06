/**
 * Multi-monitor–safe popup placement.
 * UIA / Win32 points are physical pixels; BrowserWindow and
 * `screen.getCursorScreenPoint()` use Electron DIP.
 */

import { screen, type BrowserWindow, type Rectangle } from 'electron';
import type { ContextEvent } from './context-capture';

export type ScreenCoordSpace = 'dip' | 'physical';

/**
 * Move a window, and repeat the move once if Windows put it somewhere else. Moving onto a
 * display with another scale factor sends WM_DPICHANGED, and Chromium then rescales the
 * rectangle it was given (electron/electron#27651, #18622; the workaround there is a
 * second setBounds). A strip reused across a 100% and a 150% monitor landed far from the
 * word without it.
 */
export function setWindowBounds(win: Pick<BrowserWindow, 'setBounds' | 'getBounds'>, rect: Rectangle): void {
  win.setBounds(rect, false);
  if (process.platform !== 'win32') return;
  const got = win.getBounds();
  if (got.x !== rect.x || got.y !== rect.y || got.width !== rect.width || got.height !== rect.height) {
    win.setBounds(rect, false);
  }
}

export function eventCoordSpace(
  event?: Pick<ContextEvent, 'origin' | 'coordSpace'> | null,
): ScreenCoordSpace {
  if (event?.coordSpace === 'dip' || event?.coordSpace === 'physical') {
    return event.coordSpace;
  }
  // Untagged UIA selection anchors are physical; hover / OCR / renderer screenX are DIP.
  if (event?.origin === 'selection') return 'physical';
  return 'dip';
}

/**
 * Linux X11 / Xwayland: Electron has no screenToDipPoint. X root pixels are DIP
 * times the display's scale factor (Chromium applies one scale per X screen).
 */
function linuxScaleAt(x: number, y: number, space: ScreenCoordSpace): number {
  for (const d of screen.getAllDisplays()) {
    const s = d.scaleFactor || 1;
    const k = space === 'physical' ? s : 1;
    const b = d.bounds;
    if (x >= b.x * k && x < (b.x + b.width) * k && y >= b.y * k && y < (b.y + b.height) * k) return s;
  }
  return screen.getPrimaryDisplay().scaleFactor || 1;
}

export function physicalToDip(x: number, y: number): { x: number; y: number } {
  if (process.platform === 'linux') {
    const s = linuxScaleAt(x, y, 'physical');
    return { x: Math.round(x / s), y: Math.round(y / s) };
  }
  try {
    return screen.screenToDipPoint({ x: Math.round(x), y: Math.round(y) });
  } catch {
    return { x: Math.round(x), y: Math.round(y) };
  }
}

export function dipToPhysical(x: number, y: number): { x: number; y: number } {
  if (process.platform === 'linux') {
    const s = linuxScaleAt(x, y, 'dip');
    return { x: Math.round(x * s), y: Math.round(y * s) };
  }
  try {
    return screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
  } catch {
    return { x: Math.round(x), y: Math.round(y) };
  }
}

/** The anchor in DIP and its display; an anchor far off that display falls back to the pointer. */
function anchorOnScreen(x: number, y: number, space: ScreenCoordSpace) {
  let dip =
    space === 'dip'
      ? { x: Math.round(x), y: Math.round(y) }
      : physicalToDip(x, y);

  if (!Number.isFinite(dip.x) || !Number.isFinite(dip.y)) {
    dip = screen.getCursorScreenPoint();
  }

  const display = screen.getDisplayNearestPoint(dip);
  const { x: wx, y: wy, width: ww, height: wh } = display.workArea;

  if (
    dip.x < wx - 50 ||
    dip.y < wy - 50 ||
    dip.x > wx + ww + 50 ||
    dip.y > wy + wh + 50
  ) {
    dip = screen.getCursorScreenPoint();
  }
  return { dip, display };
}

/**
 * Place a popup near a screen point, then clamp it inside the nearest display's workArea.
 * Never divide by the primary scaleFactor — that pins mixed-DPI / secondary-monitor
 * selections to the left screen.
 */
export function placePopupNearPoint(
  x: number,
  y: number,
  popupWidth: number,
  popupHeight: number,
  opts?: { offsetX?: number; offsetY?: number; space?: ScreenCoordSpace }
): { x: number; y: number; displayId: number } {
  const offsetX = opts?.offsetX ?? 18;
  const offsetY = opts?.offsetY ?? 14;
  const space: ScreenCoordSpace = opts?.space ?? 'physical';
  const { dip, display } = anchorOnScreen(x, y, space);
  const { x: wx, y: wy, width: ww, height: wh } = display.workArea;

  let popupX = dip.x - Math.floor(popupWidth / 2) + offsetX;
  let popupY = dip.y + offsetY;

  popupX = Math.max(wx + 10, Math.min(popupX, wx + ww - popupWidth - 10));
  popupY = Math.max(wy + 10, Math.min(popupY, wy + wh - popupHeight - 10));

  return { x: Math.round(popupX), y: Math.round(popupY), displayId: display.id };
}

/** Space below the anchor point, as for the strip. */
const PANEL_GAP_BELOW = 14;
/** The anchor is on or under the word, so a panel above it clears a line of text. */
const PANEL_GAP_ABOVE = 28;
/** Space between the word and a panel beside it. */
const PANEL_GAP_SIDE = 24;
/** The full pop-up is never made shorter than this to fit above or below a word. */
const PANEL_MIN_HEIGHT = 200;
const SCREEN_MARGIN = 10;

export type PanelSide = 'below' | 'above' | 'right' | 'left';

/**
 * Place the full lookup pop-up next to the word without covering it: below the word, or
 * above it when the room below is too short. When neither has the full height, the
 * pop-up takes the larger of the two and is made shorter to fit (its entry scrolls).
 * It stays inside the work area of the display the word is on.
 *
 * `prefer` keeps the side the pop-up already has while its entry changes height, as long
 * as that side has room for the minimum height; otherwise a pop-up opened above a word
 * jumped below it once a short entry loaded, and back on a longer tab.
 */
export function placePanelNearPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  opts?: { space?: ScreenCoordSpace; prefer?: PanelSide }
): { x: number; y: number; height: number; displayId: number; side: PanelSide } {
  const { dip, display } = anchorOnScreen(x, y, opts?.space ?? 'physical');
  const wa = display.workArea;
  const left = wa.x + SCREEN_MARGIN;
  const top = wa.y + SCREEN_MARGIN;
  const right = wa.x + wa.width - SCREEN_MARGIN;
  const bottom = wa.y + wa.height - SCREEN_MARGIN;
  const clamp = (v: number, lo: number, hi: number): number => Math.round(Math.max(lo, Math.min(v, hi)));
  const at = (px: number, py: number, h: number, side: PanelSide) =>
    ({ x: Math.round(px), y: Math.round(py), height: Math.round(h), displayId: display.id, side });
  const across = clamp(dip.x - Math.floor(width / 2) + 18, left, right - width);

  const below = dip.y + PANEL_GAP_BELOW;
  const roomBelow = bottom - below;
  const roomAbove = dip.y - PANEL_GAP_ABOVE - top;
  if (opts?.prefer === 'below' && Math.min(height, PANEL_MIN_HEIGHT) <= roomBelow) {
    return at(across, below, Math.min(height, roomBelow), 'below');
  }
  if (opts?.prefer === 'above' && Math.min(height, PANEL_MIN_HEIGHT) <= roomAbove) {
    const h = Math.min(height, roomAbove);
    return at(across, dip.y - PANEL_GAP_ABOVE - h, h, 'above');
  }
  if (height <= roomBelow) return at(across, below, height, 'below');
  if (height <= roomAbove) return at(across, dip.y - PANEL_GAP_ABOVE - height, height, 'above');
  if (Math.max(roomBelow, roomAbove) >= PANEL_MIN_HEIGHT) {
    return roomBelow >= roomAbove
      ? at(across, below, roomBelow, 'below')
      : at(across, top, roomAbove, 'above');
  }
  // A screen too short even for that: beside the word, as tall as the screen allows.
  const h = Math.min(height, bottom - top);
  const level = clamp(dip.y - Math.floor(h / 2), top, bottom - h);
  if (dip.x + PANEL_GAP_SIDE + width <= right) return at(dip.x + PANEL_GAP_SIDE, level, h, 'right');
  if (dip.x - PANEL_GAP_SIDE - width >= left) return at(dip.x - PANEL_GAP_SIDE - width, level, h, 'left');
  return at(across, clamp(below, top, bottom - h), h, 'below');
}
