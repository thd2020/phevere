/**
 * Multi-monitor–safe popup placement.
 * UIA / Win32 points are physical pixels; BrowserWindow and
 * `screen.getCursorScreenPoint()` use Electron DIP.
 */

import { screen } from 'electron';
import type { ContextEvent } from './context-capture';

export type ScreenCoordSpace = 'dip' | 'physical';

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

export function physicalToDip(x: number, y: number): { x: number; y: number } {
  try {
    return screen.screenToDipPoint({ x: Math.round(x), y: Math.round(y) });
  } catch {
    return { x: Math.round(x), y: Math.round(y) };
  }
}

export function dipToPhysical(x: number, y: number): { x: number; y: number } {
  try {
    return screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
  } catch {
    return { x: Math.round(x), y: Math.round(y) };
  }
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

  let popupX = dip.x - Math.floor(popupWidth / 2) + offsetX;
  let popupY = dip.y + offsetY;

  popupX = Math.max(wx + 10, Math.min(popupX, wx + ww - popupWidth - 10));
  popupY = Math.max(wy + 10, Math.min(popupY, wy + wh - popupHeight - 10));

  return { x: Math.round(popupX), y: Math.round(popupY), displayId: display.id };
}
