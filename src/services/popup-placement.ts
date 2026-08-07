/**
 * Multi-monitor–safe popup placement.
 * UIA / Win32 points are physical pixels; BrowserWindow uses Electron DIP.
 */

import { screen } from 'electron';

/**
 * Map a screen point (physical Win32 px from UIA, or already-DIP) into Electron DIP,
 * then clamp a popup of the given size inside the nearest display's workArea.
 */
export function placePopupNearPoint(
  x: number,
  y: number,
  popupWidth: number,
  popupHeight: number,
  opts?: { offsetX?: number; offsetY?: number }
): { x: number; y: number; displayId: number } {
  const offsetX = opts?.offsetX ?? 18;
  const offsetY = opts?.offsetY ?? 14;

  // Never divide by primary scaleFactor — that breaks mixed-DPI / secondary monitors.
  let dip: { x: number; y: number };
  try {
    dip = screen.screenToDipPoint({ x: Math.round(x), y: Math.round(y) });
  } catch {
    dip = { x: Math.round(x), y: Math.round(y) };
  }

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
