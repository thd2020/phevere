/**
 * Screen capture helpers (docs/OCR_CONTEXT_CAPTURE.md Phase 1).
 * Uses Electron desktopCapturer + nativeImage.crop — portable, no native deps.
 */

import { desktopCapturer, screen, nativeImage, NativeImage } from 'electron';
import { createHash } from 'crypto';
import { ContextBounds } from './context-capture';
import { wrapConsole } from '../logger';

const console = wrapConsole('screen-capture');

export interface CaptureResult {
  image: NativeImage;
  png: Buffer;
  bounds: ContextBounds;
  displayId: number;
  imageHash: string;
  /** Physical pixels used for the thumbnail / crop. */
  scaleFactor: number;
}

function hashPng(png: Buffer): string {
  return createHash('sha1').update(png).digest('hex').slice(0, 16);
}

/**
 * Capture a rectangle in **DIP** screen coordinates (Electron's usual space).
 * Internally converts to physical pixels using the display's scaleFactor.
 */
export async function captureScreenRegion(bounds: ContextBounds): Promise<CaptureResult | null> {
  if (bounds.width < 4 || bounds.height < 4) {
    console.warn('Region too small', bounds);
    return null;
  }

  const point = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
  const display = screen.getDisplayNearestPoint(point);
  const scale = display.scaleFactor || 1;
  const { x: dx, y: dy, width: dw, height: dh } = display.bounds;

  const thumbW = Math.max(1, Math.round(dw * scale));
  const thumbH = Math.max(1, Math.round(dh * scale));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH },
  });

  // Match by display id when possible; fall back to primary / first.
  const displayIdStr = String(display.id);
  let source = sources.find((s) => s.display_id === displayIdStr);
  if (!source) {
    source = sources.find((s) => s.id.includes(displayIdStr)) || sources[0];
  }
  if (!source) {
    console.error('No desktopCapturer screen source');
    return null;
  }

  const full = source.thumbnail;
  if (full.isEmpty()) {
    console.error('Empty thumbnail from desktopCapturer');
    return null;
  }

  // Packaged Electron on Windows often returns a thumbnail whose pixel size
  // does not match thumbnailSize (DIP vs physical). Crop in *that* bitmap's
  // space or OCR sees sliced glyphs ("c e n t r i f i c").
  const fullSize = full.getSize();
  const sx = dw > 0 ? fullSize.width / dw : scale;
  const sy = dh > 0 ? fullSize.height / dh : scale;
  const usedScale = (sx + sy) / 2;
  if (Math.abs(fullSize.width - thumbW) > 2 || Math.abs(fullSize.height - thumbH) > 2) {
    console.log('desktopCapturer thumbnail size ≠ request; cropping in bitmap space', {
      requested: { w: thumbW, h: thumbH },
      actual: fullSize,
      usedScale,
      displayScale: scale,
    });
  }

  const cropX = Math.max(0, Math.round((bounds.x - dx) * sx));
  const cropY = Math.max(0, Math.round((bounds.y - dy) * sy));
  const cropW = Math.min(fullSize.width - cropX, Math.max(0, Math.round(bounds.width * sx)));
  const cropH = Math.min(fullSize.height - cropY, Math.max(0, Math.round(bounds.height * sy)));

  if (cropW < 4 || cropH < 4) {
    console.warn('Crop too small after scale', { cropX, cropY, cropW, cropH });
    return null;
  }

  let cropped: NativeImage;
  try {
    cropped = full.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
  } catch (error) {
    console.error('nativeImage.crop failed', error);
    return null;
  }

  const png = cropped.toPNG();
  return {
    image: cropped,
    png,
    bounds: { ...bounds },
    displayId: display.id,
    imageHash: hashPng(png),
    scaleFactor: usedScale,
  };
}

/**
 * Capture a rectangle centered on a DIP screen point (explicit “grab under cursor”).
 */
export async function captureAroundPoint(
  x: number,
  y: number,
  halfWidth = 140,
  halfHeight = 56,
): Promise<CaptureResult | null> {
  const display = screen.getDisplayNearestPoint({ x, y });
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  const left = Math.max(dx, Math.round(x - halfWidth));
  const top = Math.max(dy, Math.round(y - halfHeight));
  const right = Math.min(dx + dw, Math.round(x + halfWidth));
  const bottom = Math.min(dy + dh, Math.round(y + halfHeight));
  return captureScreenRegion({
    x: left,
    y: top,
    width: Math.max(4, right - left),
    height: Math.max(4, bottom - top),
  });
}
