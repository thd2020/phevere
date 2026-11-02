/**
 * Minimal .xz decoder (LZMA2 filter only, which is what xz writes for plain files).
 * The phone has gzip through DecompressionStream but nothing for xz, and FreeDict
 * publishes only .tar.xz. Integrity checks are skipped; a corrupt stream throws.
 *
 * Format: https://tukaani.org/xz/xz-file-format.txt
 * LZMA: the reference decoder in the LZMA SDK (DOC/lzma-specification.txt).
 */

const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
const CHECK_SIZES = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];
const FILTER_LZMA2 = 0x21;

const NUM_STATES = 12;
const POS_STATES_MAX = 16;
const END_POS_MODEL_INDEX = 14;
const NUM_FULL_DISTANCES = 128;
const NUM_ALIGN_BITS = 4;
const MATCH_MIN_LEN = 2;

class OutBuffer {
  buf: Uint8Array;
  pos = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(Math.max(1 << 16, size));
  }
  ensure(extra: number): void {
    const need = this.pos + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }
}

class RangeDecoder {
  range = 0;
  code = 0;
  pos = 0;
  constructor(private input: Uint8Array) {}

  init(pos: number): void {
    this.pos = pos;
    if (this.input[this.pos++] !== 0) throw new Error('xz: corrupt LZMA chunk');
    this.range = 0xffffffff;
    this.code = 0;
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.input[this.pos++]) >>> 0;
  }

  private normalize(): void {
    if (this.range < 0x1000000) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.input[this.pos++]) >>> 0;
    }
  }

  bit(probs: Uint16Array, i: number): number {
    const p = probs[i];
    const bound = (this.range >>> 11) * p;
    let b: number;
    if (this.code < bound) {
      this.range = bound;
      probs[i] = p + ((2048 - p) >>> 5);
      b = 0;
    } else {
      this.range -= bound;
      this.code -= bound;
      probs[i] = p - (p >>> 5);
      b = 1;
    }
    this.normalize();
    return b;
  }

  direct(numBits: number): number {
    let res = 0;
    for (let i = 0; i < numBits; i++) {
      this.range = this.range >>> 1;
      this.code = (this.code - this.range) >>> 0;
      let b = 1;
      if (this.code & 0x80000000) {
        this.code = (this.code + this.range) >>> 0;
        b = 0;
      }
      this.normalize();
      res = ((res << 1) | b) >>> 0;
    }
    return res;
  }

  tree(probs: Uint16Array, base: number, numBits: number): number {
    let m = 1;
    for (let i = 0; i < numBits; i++) m = (m << 1) + this.bit(probs, base + m);
    return m - (1 << numBits);
  }

  reverseTree(probs: Uint16Array, base: number, numBits: number): number {
    let m = 1;
    let sym = 0;
    for (let i = 0; i < numBits; i++) {
      const b = this.bit(probs, base + m);
      m = (m << 1) + b;
      sym |= b << i;
    }
    return sym;
  }
}

class LenDecoder {
  choice = new Uint16Array(2);
  low = new Uint16Array(POS_STATES_MAX << 3);
  mid = new Uint16Array(POS_STATES_MAX << 3);
  high = new Uint16Array(256);
  reset(): void {
    this.choice.fill(1024);
    this.low.fill(1024);
    this.mid.fill(1024);
    this.high.fill(1024);
  }
  decode(rc: RangeDecoder, posState: number): number {
    if (rc.bit(this.choice, 0) === 0) return rc.tree(this.low, posState << 3, 3);
    if (rc.bit(this.choice, 1) === 0) return 8 + rc.tree(this.mid, posState << 3, 3);
    return 16 + rc.tree(this.high, 0, 8);
  }
}

class Lzma2Decoder {
  private lc = 0;
  private lp = 0;
  private pb = 0;
  private literal = new Uint16Array(0x300 << 4);
  private isMatch = new Uint16Array(NUM_STATES << 4);
  private isRep = new Uint16Array(NUM_STATES);
  private isRepG0 = new Uint16Array(NUM_STATES);
  private isRepG1 = new Uint16Array(NUM_STATES);
  private isRepG2 = new Uint16Array(NUM_STATES);
  private isRep0Long = new Uint16Array(NUM_STATES << 4);
  private posSlot = new Uint16Array(4 << 6);
  private posDecoders = new Uint16Array(1 + NUM_FULL_DISTANCES - END_POS_MODEL_INDEX);
  private align = new Uint16Array(1 << NUM_ALIGN_BITS);
  private lenDec = new LenDecoder();
  private repLenDec = new LenDecoder();
  private state = 0;
  private rep0 = 0;
  private rep1 = 0;
  private rep2 = 0;
  private rep3 = 0;
  private dictStart = 0;
  private needProps = true;

  constructor(private input: Uint8Array, private out: OutBuffer) {}

  private setProps(b: number): void {
    if (b > 224) throw new Error('xz: bad LZMA properties');
    this.lc = b % 9;
    b = (b / 9) | 0;
    this.lp = b % 5;
    this.pb = (b / 5) | 0;
    if (this.lc + this.lp > 4) throw new Error('xz: bad LZMA2 properties');
    const size = 0x300 << (this.lc + this.lp);
    if (this.literal.length !== size) this.literal = new Uint16Array(size);
  }

  private resetState(): void {
    this.literal.fill(1024);
    this.isMatch.fill(1024);
    this.isRep.fill(1024);
    this.isRepG0.fill(1024);
    this.isRepG1.fill(1024);
    this.isRepG2.fill(1024);
    this.isRep0Long.fill(1024);
    this.posSlot.fill(1024);
    this.posDecoders.fill(1024);
    this.align.fill(1024);
    this.lenDec.reset();
    this.repLenDec.reset();
    this.state = 0;
    this.rep0 = this.rep1 = this.rep2 = this.rep3 = 0;
  }

  /** Decodes one LZMA2 stream starting at `pos`; returns the position after its end marker. */
  decode(pos: number): number {
    const input = this.input;
    for (;;) {
      if (pos >= input.length) throw new Error('xz: truncated LZMA2 stream');
      const control = input[pos++];
      if (control === 0x00) return pos;
      if (control === 0x01 || control === 0x02) {
        if (control === 0x01) this.dictStart = this.out.pos;
        const size = ((input[pos] << 8) | input[pos + 1]) + 1;
        pos += 2;
        this.out.ensure(size);
        this.out.buf.set(input.subarray(pos, pos + size), this.out.pos);
        this.out.pos += size;
        pos += size;
        continue;
      }
      if (control < 0x80) throw new Error('xz: bad LZMA2 control byte');
      const unpacked = ((control & 0x1f) << 16) + (input[pos] << 8) + input[pos + 1] + 1;
      const packed = ((input[pos + 2] << 8) | input[pos + 3]) + 1;
      pos += 4;
      const mode = (control >> 5) & 3;
      if (mode === 3) this.dictStart = this.out.pos;
      if (mode >= 2) {
        this.setProps(input[pos++]);
        this.needProps = false;
      } else if (this.needProps) {
        throw new Error('xz: LZMA2 chunk without properties');
      }
      if (mode >= 1) this.resetState();
      this.decodeChunk(pos, unpacked);
      pos += packed;
    }
  }

  private decodeChunk(pos: number, unpacked: number): void {
    const rc = new RangeDecoder(this.input);
    rc.init(pos);
    const out = this.out;
    out.ensure(unpacked);
    const buf = out.buf;
    const end = out.pos + unpacked;
    const pbMask = (1 << this.pb) - 1;
    const lpMask = (1 << this.lp) - 1;
    const lc = this.lc;
    let state = this.state;
    let rep0 = this.rep0;
    let rep1 = this.rep1;
    let rep2 = this.rep2;
    let rep3 = this.rep3;
    let op = out.pos;

    while (op < end) {
      const posState = op & pbMask;
      if (rc.bit(this.isMatch, (state << 4) + posState) === 0) {
        const prev = op > this.dictStart ? buf[op - 1] : 0;
        const base = 0x300 * (((op & lpMask) << lc) + (prev >> (8 - lc)));
        let sym = 1;
        if (state >= 7) {
          let matchByte = buf[op - rep0 - 1];
          do {
            const matchBit = (matchByte >> 7) & 1;
            matchByte <<= 1;
            const b = rc.bit(this.literal, base + ((1 + matchBit) << 8) + sym);
            sym = (sym << 1) | b;
            if (matchBit !== b) break;
          } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | rc.bit(this.literal, base + sym);
        buf[op++] = sym - 0x100;
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        continue;
      }

      let len: number;
      if (rc.bit(this.isRep, state) !== 0) {
        if (op === this.dictStart) throw new Error('xz: corrupt LZMA data');
        if (rc.bit(this.isRepG0, state) === 0) {
          if (rc.bit(this.isRep0Long, (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11;
            buf[op] = buf[op - rep0 - 1];
            op++;
            continue;
          }
        } else {
          let dist: number;
          if (rc.bit(this.isRepG1, state) === 0) {
            dist = rep1;
          } else {
            if (rc.bit(this.isRepG2, state) === 0) {
              dist = rep2;
            } else {
              dist = rep3;
              rep3 = rep2;
            }
            rep2 = rep1;
          }
          rep1 = rep0;
          rep0 = dist;
        }
        len = this.repLenDec.decode(rc, posState);
        state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2;
        rep2 = rep1;
        rep1 = rep0;
        len = this.lenDec.decode(rc, posState);
        state = state < 7 ? 7 : 10;
        rep0 = this.decodeDistance(rc, len);
        if (rep0 === 0xffffffff) break;
      }
      len += MATCH_MIN_LEN;
      if (rep0 >= op - this.dictStart) throw new Error('xz: match distance out of range');
      if (op + len > end) throw new Error('xz: match crosses LZMA2 chunk');
      let src = op - rep0 - 1;
      for (let i = 0; i < len; i++) buf[op++] = buf[src++];
    }

    out.pos = op;
    this.state = state;
    this.rep0 = rep0;
    this.rep1 = rep1;
    this.rep2 = rep2;
    this.rep3 = rep3;
  }

  private decodeDistance(rc: RangeDecoder, len: number): number {
    const lenState = len < 3 ? len : 3;
    const slot = rc.tree(this.posSlot, lenState << 6, 6);
    if (slot < 4) return slot;
    const numDirect = (slot >>> 1) - 1;
    let dist = ((2 | (slot & 1)) << numDirect) >>> 0;
    if (slot < END_POS_MODEL_INDEX) {
      return (dist + rc.reverseTree(this.posDecoders, dist - slot, numDirect)) >>> 0;
    }
    dist = (dist + ((rc.direct(numDirect - NUM_ALIGN_BITS) << NUM_ALIGN_BITS) >>> 0)) >>> 0;
    return (dist + rc.reverseTree(this.align, 0, NUM_ALIGN_BITS)) >>> 0;
  }
}

function readVarint(input: Uint8Array, at: { pos: number }): number {
  let value = 0;
  let mul = 1;
  for (let i = 0; i < 9; i++) {
    const b = input[at.pos++];
    value += (b & 0x7f) * mul;
    if (!(b & 0x80)) return value;
    mul *= 128;
  }
  throw new Error('xz: bad varint');
}

export function isXz(bytes: Uint8Array): boolean {
  return XZ_MAGIC.every((b, i) => bytes[i] === b);
}

/** Decompress a whole .xz file (one or more concatenated streams). */
export function xzDecompress(input: Uint8Array): Uint8Array {
  const out = new OutBuffer(input.length * 6);
  let pos = 0;
  while (pos + 12 <= input.length) {
    if (!XZ_MAGIC.every((b, i) => input[pos + i] === b)) {
      if (pos > 0 && input[pos] === 0) {
        pos += 4; // stream padding
        continue;
      }
      throw new Error('xz: not an xz file');
    }
    const checkType = input[pos + 7] & 0x0f;
    const checkSize = CHECK_SIZES[checkType];
    pos += 12;
    // Blocks until the index indicator (a zero header-size byte).
    while (input[pos] !== 0x00) {
      const headerStart = pos;
      const headerSize = (input[pos] + 1) * 4;
      const flags = input[pos + 1];
      const at = { pos: pos + 2 };
      if (flags & 0x40) readVarint(input, at);
      if (flags & 0x80) readVarint(input, at);
      const filters = (flags & 0x03) + 1;
      let lzma2 = false;
      for (let f = 0; f < filters; f++) {
        const id = readVarint(input, at);
        const propSize = readVarint(input, at);
        if (id === FILTER_LZMA2 && f === filters - 1) lzma2 = true;
        else throw new Error(`xz: unsupported filter 0x${id.toString(16)}`);
        at.pos += propSize;
      }
      if (!lzma2) throw new Error('xz: no LZMA2 filter');
      pos = headerStart + headerSize;
      const blockStart = pos;
      pos = new Lzma2Decoder(input, out).decode(pos);
      // Block padding to a multiple of four, then the check.
      while ((pos - blockStart) % 4) pos++;
      pos += checkSize;
    }
    // Index: indicator, record count, records, padding, CRC32; then the 12-byte footer.
    const at = { pos: pos + 1 };
    const records = readVarint(input, at);
    for (let r = 0; r < records; r++) {
      readVarint(input, at);
      readVarint(input, at);
    }
    pos = at.pos;
    while ((pos - 0) % 4) pos++;
    pos += 4 + 12;
  }
  return out.buf.subarray(0, out.pos);
}
