/**
 * Screen capture helpers (docs/OCR_CONTEXT_CAPTURE.md Phase 1).
 * Uses Electron desktopCapturer + nativeImage.crop — portable, no native deps.
 */

import { desktopCapturer, screen, nativeImage, NativeImage } from 'electron';
import { createHash } from 'crypto';
import { ContextBounds } from './context-capture';
import { wrapConsole } from '../logger';
import {
  ensureMacScreenRecordingForCapture,
  getMacScreenRecordingStatus,
  promptOpenMacScreenRecordingSettings,
} from './mac-screen-recording';

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
 * Linux Wayland: KWin ScreenShot2 captures without a dialog when the installed
 * desktop entry grants it (deb / rpm). Elsewhere desktopCapturer goes through the
 * screencast portal, which asks the user to pick a screen on every capture.
 */
function captureViaKwin(bounds: ContextBounds): CaptureResult | null {
  if (process.platform !== 'linux' || !process.env.WAYLAND_DISPLAY) return null;
  let shot: { width: number; height: number; data: Buffer } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    shot = require('../../native-addon').captureArea?.(bounds.x, bounds.y, bounds.width, bounds.height) || null;
  } catch {
    shot = null;
  }
  if (!shot || shot.width < 4 || shot.height < 4) return null;
  const image = nativeImage.createFromBitmap(shot.data, { width: shot.width, height: shot.height });
  const png = image.toPNG();
  const display = screen.getDisplayNearestPoint({ x: Math.round(bounds.x), y: Math.round(bounds.y) });
  return {
    image,
    png,
    bounds: { ...bounds },
    displayId: display.id,
    imageHash: hashPng(png),
    scaleFactor: shot.width / bounds.width,
  };
}

let silentCaptureProbe: boolean | null = null;

/**
 * False only on a Wayland session where every capture would open the portal
 * picker. Hover OCR fires on its own, so it must not run there.
 */
export function canCaptureWithoutPrompt(): boolean {
  if (process.platform !== 'linux' || !process.env.WAYLAND_DISPLAY) return true;
  if (silentCaptureProbe === null) {
    silentCaptureProbe = captureViaKwin({ x: 0, y: 0, width: 8, height: 8 }) !== null;
    console.log('Silent screen capture on Wayland', silentCaptureProbe ? 'via KWin' : 'unavailable (portal only)');
  }
  return silentCaptureProbe;
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

  const viaKwin = captureViaKwin(bounds);
  if (viaKwin) return viaKwin;

  if (!(await ensureMacScreenRecordingForCapture())) {
    return null;
  }

  const point = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
  const display = screen.getDisplayNearestPoint(point);
  const scale = display.scaleFactor || 1;
  const { x: dx, y: dy, width: dw, height: dh } = display.bounds;

  const thumbW = Math.max(1, Math.round(dw * scale));
  const thumbH = Math.max(1, Math.round(dh * scale));

  let sources: Electron.DesktopCapturerSource[];
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbW, height: thumbH },
    });
  } catch (error) {
    // Wayland portal dismissed or timed out.
    console.warn('desktopCapturer.getSources failed', String(error));
    return null;
  }

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
    if (process.platform === 'darwin' && getMacScreenRecordingStatus() === 'denied') {
      await promptOpenMacScreenRecordingSettings();
    }
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
