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

  // Convert DIP region → physical pixels relative to this display.
  const cropX = Math.max(0, Math.round((bounds.x - dx) * scale));
  const cropY = Math.max(0, Math.round((bounds.y - dy) * scale));
  const cropW = Math.min(full.getSize().width - cropX, Math.round(bounds.width * scale));
  const cropH = Math.min(full.getSize().height - cropY, Math.round(bounds.height * scale));

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
    scaleFactor: scale,
  };
}
