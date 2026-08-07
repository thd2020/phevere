/**
 * Clipboard bitmap helpers (docs/OCR_CONTEXT_CAPTURE.md Phase 6).
 */

import { clipboard, nativeImage } from 'electron';
import { createHash } from 'crypto';
import { wrapConsole } from '../logger';

const console = wrapConsole('clipboard-image');

export interface ClipboardImageCapture {
  png: Buffer;
  imageHash: string;
  width: number;
  height: number;
}

function hashPng(png: Buffer): string {
  return createHash('sha1').update(png).digest('hex').slice(0, 16);
}

/** Read the current clipboard image if present and non-empty. */
export function readClipboardImage(): ClipboardImageCapture | null {
  try {
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return null;
    const size = img.getSize();
    if (size.width < 8 || size.height < 8) return null;
    const png = img.toPNG();
    if (!png || png.length < 32) return null;
    return {
      png,
      imageHash: hashPng(png),
      width: size.width,
      height: size.height,
    };
  } catch (error) {
    console.warn('readClipboardImage failed', error);
    return null;
  }
}

/** Load a local image file into PNG for OCR. */
export function loadImageFileAsPng(filePath: string): ClipboardImageCapture | null {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (!img || img.isEmpty()) return null;
    const size = img.getSize();
    if (size.width < 8 || size.height < 8) return null;
    const png = img.toPNG();
    return {
      png,
      imageHash: hashPng(png),
      width: size.width,
      height: size.height,
    };
  } catch (error) {
    console.warn('loadImageFileAsPng failed', error);
    return null;
  }
}

/** Decode a data URL or raw base64 PNG/JPEG buffer from the renderer. */
export function pngFromBase64(data: string): ClipboardImageCapture | null {
  try {
    const raw = data.includes(',') ? data.split(',')[1] : data;
    const buf = Buffer.from(raw, 'base64');
    const img = nativeImage.createFromBuffer(buf);
    if (!img || img.isEmpty()) return null;
    const size = img.getSize();
    const png = img.toPNG();
    return {
      png,
      imageHash: hashPng(png),
      width: size.width,
      height: size.height,
    };
  } catch (error) {
    console.warn('pngFromBase64 failed', error);
    return null;
  }
}
