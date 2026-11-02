/** Read files out of an uncompressed tar archive held in memory (ustar, pax and GNU long names). */

function readOctal(buf: Uint8Array, start: number, len: number): number {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf[start + i];
    if (c === 0) break;
    if (c === 32) continue;
    s += String.fromCharCode(c);
  }
  return s ? parseInt(s, 8) : 0;
}

function utf8(bytes: Uint8Array): string {
  // Names are ASCII in practice; decode UTF-8 by hand so this runs without TextDecoder.
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) break;
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b >= 0xc0 && b < 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++i] & 0x3f));
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
    } else {
      out += '�';
    }
  }
  return out;
}

function paxPath(data: Uint8Array): string | null {
  const text = utf8(data);
  const m = text.match(/(?:^|\n)\d+ path=([^\n]*)\n/);
  return m ? m[1] : null;
}

export interface TarFile {
  /** Path inside the archive. */
  path: string;
  /** File name without directories. */
  name: string;
  bytes: Uint8Array;
}

/** Regular files whose name (or path) passes `want`. */
export function extractTar(bytes: Uint8Array, want: (name: string, path: string) => boolean): TarFile[] {
  const out: TarFile[] = [];
  let offset = 0;
  let nextPath: string | null = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header[0] === 0) break;
    const name = utf8(header.subarray(0, 100));
    const prefix = header[257] === 0x75 /* "ustar" */ ? utf8(header.subarray(345, 500)) : '';
    const size = readOctal(header, 124, 12);
    const type = header[156];
    offset += 512;
    const data = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (type === 0x78 /* x */) {
      nextPath = paxPath(data) || nextPath;
      continue;
    }
    if (type === 0x67 /* g */) continue;
    if (type === 0x4c /* L: GNU long name */) {
      nextPath = utf8(data);
      continue;
    }
    const path = nextPath || (prefix ? `${prefix}/${name}` : name);
    nextPath = null;
    if (type !== 0 && type !== 0x30 /* 0 */ && type !== 0x37 /* 7 */) continue;
    const base = path.split(/[/\\]/).pop() || path;
    if (want(base, path)) out.push({ path, name: base, bytes: data });
  }
  return out;
}
