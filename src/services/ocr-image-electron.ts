/**
 * GutenYe OCR image backend on Electron's nativeImage (Skia) instead of sharp.
 *
 * Linux only. sharp's prebuilt libvips carries its own GLib; Electron has the
 * system GLib loaded already, and the two GObject type systems collide
 * (VIPS_IS_OBJECT assertion → abort). OCR only needs decode, resize and RGBA
 * buffers, which nativeImage provides.
 */

import { nativeImage } from 'electron';
import * as fs from 'fs';

interface ImageRawData {
  data: Uint8Array | Buffer;
  width: number;
  height: number;
}

type ImageRawBaseCtor = new (data: ImageRawData) => ImageRawData;

/** nativeImage bitmaps are BGRA (Skia N32 on little-endian); GutenYe wants RGBA. Swaps in place. */
function swapRedBlue(buf: Buffer): Buffer {
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i];
    buf[i] = buf[i + 2];
    buf[i + 2] = r;
  }
  return buf;
}

function toNative(img: ImageRawData): Electron.NativeImage {
  const bgra = swapRedBlue(Buffer.from(img.data));
  return nativeImage.createFromBitmap(bgra, { width: img.width, height: img.height });
}

function fromNative(native: Electron.NativeImage): ImageRawData {
  const { width, height } = native.getSize();
  return { data: swapRedBlue(native.toBitmap()), width, height };
}

/** sharp `fit: 'contain'`: scale inside the box, centre, pad with opaque black. */
function resizeContain(img: ImageRawData, width?: number, height?: number): ImageRawData {
  const w = width ?? Math.max(1, Math.round((img.width * (height as number)) / img.height));
  const h = height ?? Math.max(1, Math.round((img.height * (width as number)) / img.width));
  const scale = Math.min(w / img.width, h / img.height);
  const sw = Math.max(1, Math.round(img.width * scale));
  const sh = Math.max(1, Math.round(img.height * scale));
  const scaled =
    sw === img.width && sh === img.height
      ? { data: Buffer.from(img.data), width: sw, height: sh }
      : fromNative(toNative(img).resize({ width: sw, height: sh, quality: 'best' }));
  if (sw === w && sh === h) return scaled;

  const out = Buffer.alloc(w * h * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const left = Math.floor((w - sw) / 2);
  const top = Math.floor((h - sh) / 2);
  const src = Buffer.from(scaled.data);
  for (let y = 0; y < sh; y += 1) {
    src.copy(out, ((top + y) * w + left) * 4, y * sw * 4, (y + 1) * sw * 4);
  }
  return { data: out, width: w, height: h };
}

export function createElectronImageRaw(ImageRawBase: ImageRawBaseCtor): unknown {
  class ElectronImageRaw extends ImageRawBase {
    static async open(path: string): Promise<ElectronImageRaw> {
      const native = nativeImage.createFromPath(path);
      if (native.isEmpty()) throw new Error(`Cannot decode image: ${path}`);
      return new ElectronImageRaw(fromNative(native));
    }

    async write(path: string): Promise<void> {
      await fs.promises.writeFile(path, toNative(this).toPNG());
    }

    async resize(size: { width?: number; height?: number }): Promise<this> {
      const next = resizeContain(this, size.width, size.height);
      this.data = next.data;
      this.width = next.width;
      this.height = next.height;
      return this;
    }

    /** Debug overlay only (debugOutputDir); not drawn here. */
    async drawBox(): Promise<this> {
      return this;
    }
  }
  return ElectronImageRaw;
}
