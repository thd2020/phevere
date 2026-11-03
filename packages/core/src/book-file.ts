/**
 * The .pvbook container: one word book per file, for export, import and sharing.
 *
 *   offset  size  field
 *   0       4     magic "PVBK"
 *   4       1     version (1)
 *   5       1     flags: 1 compressed (deflate), 2 encrypted (AES-256-GCM), 4 signed (Ed25519)
 *   6       2     reserved, 0
 *   8       4     payload length, little-endian
 *   12      n     payload
 *   12+n    8+64  when signed: key id (8 bytes) and an Ed25519 signature of bytes 0 to 12+n
 *
 * The payload is the book as JSON (`BookPayload`), deflated when compressed. When encrypted it
 * is a 12-byte IV followed by AES-GCM ciphertext of the (compressed) JSON; the key belongs to
 * the account and comes from the server, so only a signed-in reader with the book can open it.
 * Books Phevere sells are encrypted and signed by the Holarky server; a reader's own books are
 * only compressed. See docs/BOOK_FORMAT.md.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

export const BOOK_FILE_EXTENSION = 'pvbook';
const MAGIC = [0x50, 0x56, 0x42, 0x4b]; // PVBK
const VERSION = 1;
export const BOOK_FLAG_COMPRESSED = 1;
export const BOOK_FLAG_ENCRYPTED = 2;
export const BOOK_FLAG_SIGNED = 4;
const HEADER = 12;
const KEY_ID = 8;
const SIGNATURE = 64;

/** A saved word with everything Phevere keeps about it. */
export interface BookWord {
  lemma: string;
  reading?: string;
  definition?: string;
  partOfSpeech?: string;
  sourceLang?: string;
  targetLang?: string;
  sources?: string[];
  note?: string;
  tags?: string[];
  context?: unknown;
  device?: string;
  createdAt?: number;
  updatedAt?: number;
  /** Marked "already know it" in a word book. */
  known?: boolean;
  /** The schedule as it stood, for words with no answer history (saved before 4.0). */
  schedule?: Record<string, number | null>;
}

export interface BookPayload {
  format: 'phevere-book';
  version: 1;
  exportedAt: number;
  app?: string;
  book: {
    /** 'mine' is My words, 'user' a book the reader made, 'catalog' one of Phevere's books. */
    kind: 'mine' | 'user' | 'catalog';
    id: string;
    title: string;
    source?: string;
    /** Daily new-word goal. */
    goal?: number;
  };
  words: BookWord[];
  /** The answer history of these words, from which each schedule is rebuilt on import. */
  answers: unknown[];
}

/** Thrown for a book that needs the account (encrypted) or a signature this app cannot check. */
export class BookLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookLockedError';
  }
}

export interface BookOpenOptions {
  /** The AES-256 key for an encrypted book, by key id; undefined when the account has none. */
  bookKey?: (keyId: string) => Promise<Uint8Array | undefined>;
  /** Ed25519 public keys of the Holarky server, by key id. */
  publicKeys?: Record<string, Uint8Array>;
}

/** WebCrypto, in Node 18+ and every WebView; typed loosely because core builds without the DOM types. */
function subtle(): any {
  const c = (globalThis as { crypto?: { subtle?: unknown } }).crypto;
  if (!c?.subtle) throw new BookLockedError('This device cannot open protected books.');
  return c.subtle;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Write a reader's own book: compressed, not encrypted or signed. */
export function encodeBookFile(payload: BookPayload): Uint8Array {
  const body = deflateSync(strToU8(JSON.stringify(payload)), { level: 9 });
  const out = new Uint8Array(HEADER + body.length);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out[5] = BOOK_FLAG_COMPRESSED;
  new DataView(out.buffer).setUint32(8, body.length, true);
  out.set(body, HEADER);
  return out;
}

export function isBookFile(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER && MAGIC.every((b, i) => bytes[i] === b);
}

/** Read a .pvbook. Throws BookLockedError for a book that needs the account to open. */
export async function decodeBookFile(bytes: Uint8Array, opts: BookOpenOptions = {}): Promise<BookPayload> {
  if (!isBookFile(bytes)) throw new Error('Not a Phevere book file.');
  if (bytes[4] !== VERSION) throw new Error('This book was made by a newer Phevere; update to open it.');
  const flags = bytes[5];
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (HEADER + length > bytes.length) throw new Error('This book file is incomplete.');
  let body = bytes.subarray(HEADER, HEADER + length);
  let keyId = '';
  if (flags & BOOK_FLAG_SIGNED) {
    const end = HEADER + length;
    if (end + KEY_ID + SIGNATURE > bytes.length) throw new Error('This book file is incomplete.');
    keyId = hex(bytes.subarray(end, end + KEY_ID));
    const pub = opts.publicKeys?.[keyId];
    if (!pub) throw new BookLockedError('This book comes from the Phevere store; sign in with Plus to open it.');
    const key = await subtle().importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    const ok = await subtle().verify('Ed25519', key, bytes.subarray(end + KEY_ID, end + KEY_ID + SIGNATURE), bytes.subarray(0, end));
    if (!ok) throw new Error('This book file was changed after it was issued.');
  }
  if (flags & BOOK_FLAG_ENCRYPTED) {
    const raw = await opts.bookKey?.(keyId);
    if (!raw) throw new BookLockedError('This book needs Plus. Sign in with the account that has it.');
    const key = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: body.subarray(0, 12) }, key, body.subarray(12));
    body = new Uint8Array(plain);
  }
  if (flags & BOOK_FLAG_COMPRESSED) body = inflateSync(body);
  let payload: BookPayload;
  try {
    payload = JSON.parse(strFromU8(body));
  } catch {
    throw new Error('This book file is damaged.');
  }
  if (payload?.format !== 'phevere-book' || !payload.book || !Array.isArray(payload.words)) {
    throw new Error('Not a Phevere book file.');
  }
  if (!Array.isArray(payload.answers)) payload.answers = [];
  return payload;
}

/** A file name for a book: its title without characters file systems refuse. */
export function bookFileName(title: string): string {
  const base = String(title || 'Words').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Words';
  return `${base}.${BOOK_FILE_EXTENSION}`;
}
