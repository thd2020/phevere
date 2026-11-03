/**
 * The PP-OCRv4 OCR pack: models that text recognition (hover lookup, Scan) needs.
 *
 * Desktop packages ship without it. The app downloads one tar.gz, checks every
 * file against the SHA-256 below, and installs it under userData/ocr-packs/pp-ocrv4.
 *
 * Sources, in order: this version's GitHub release asset, the latest release's
 * asset (both built by scripts/make-ocr-pack.js), then the same three files from
 * the @gutenye/ocr-models npm tarball on npmmirror and npmjs for networks where
 * github.com is slow. The hashes, not the source, decide whether a file is good.
 *
 * Older installers put the same files in resources/ocr-models. The Windows
 * installer carries that folder across upgrades (packaging/installer.nsh,
 * PV_KEEP_OCR_MODELS) and the OCR engine still reads it (legacyPackRoots).
 */

import { app, net } from 'electron';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { createGunzip } from 'zlib';
import { log } from '../logger';
import { getOcrPackRoot } from './ocr-settings-store';

// Shared with scripts/make-ocr-pack.js, which builds the release asset.
import manifest from './ocr-pack-manifest.json';

type PackFile = { name: string; size: number; sha256: string };

export const OCR_PACK_DIR = 'pp-ocrv4';
export const OCR_PACK_ASSET: string = manifest.asset;
const RELEASES = 'https://github.com/thd2020/phevere/releases';
const NPM_TARBALL: string = manifest.npmTarball;
export const OCR_PACK_FILES: readonly PackFile[] = manifest.files;

/** Bytes on disk once installed (the download is about the same size). */
export const OCR_PACK_BYTES = OCR_PACK_FILES.reduce((sum, f) => sum + f.size, 0);

export type OcrPackState = {
  installed: boolean;
  installing: boolean;
  progress: number;
  error: string | null;
  /** Folder the engine loads from, or null when the pack is missing. */
  root: string | null;
};

function hasModels(dir: string): boolean {
  try {
    return OCR_PACK_FILES.every((f) => fs.statSync(path.join(dir, f.name)).size > 0);
  } catch {
    return false;
  }
}

export function installedPackRoot(): string {
  return getOcrPackRoot(OCR_PACK_DIR);
}

/**
 * Folders an older install may hold: resources/ocr-models from the bundled-model
 * installers (kept across NSIS upgrades), then the source tree in development.
 */
export function legacyPackRoots(): string[] {
  const roots = [path.join(process.resourcesPath || '', 'ocr-models')];
  if (!app.isPackaged) {
    roots.push(path.join(app.getAppPath(), 'resources', 'ocr-models'), path.join(process.cwd(), 'resources', 'ocr-models'));
  }
  return roots;
}

/** Where the PP-OCRv4 models are, preferring the downloaded pack. */
export function findOcrPackRoot(): string | null {
  for (const dir of [installedPackRoot(), ...legacyPackRoots()]) {
    if (dir && hasModels(dir)) return dir;
  }
  return null;
}

let job: Promise<string> | null = null;
let progress = 0;
let lastError: string | null = null;
const listeners = new Set<(state: OcrPackState) => void>();

export function getOcrPackState(): OcrPackState {
  const root = findOcrPackRoot();
  return { installed: !!root, installing: !!job, progress: job ? progress : root ? 1 : 0, error: job ? null : lastError, root };
}

/** Called with every progress step and once when an install ends. */
export function onOcrPackChange(listener: (state: OcrPackState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  const state = getOcrPackState();
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      /* a closed window must not stop the install */
    }
  }
}

function sources(): string[] {
  return [
    `${RELEASES}/download/v${app.getVersion()}/${OCR_PACK_ASSET}`,
    `${RELEASES}/latest/download/${OCR_PACK_ASSET}`,
    `https://registry.npmmirror.com/${NPM_TARBALL}`,
    `https://registry.npmjs.org/${NPM_TARBALL}`,
  ];
}

/** Read one gzip'd tar stream and write the pack files it contains into `dest`. */
async function extractPack(body: Readable, dest: string): Promise<void> {
  // tar-stream is pure JavaScript and bundled by webpack.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tar = require('tar-stream');
  const wanted = new Map<string, PackFile>(OCR_PACK_FILES.map((f) => [f.name, f]));
  const found = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    const extract = tar.extract();
    extract.on('entry', (header: { name: string; type: string }, stream: Readable, next: (err?: Error) => void) => {
      const file = header.type === 'file' ? wanted.get(path.posix.basename(header.name)) : undefined;
      if (!file || found.has(file.name)) {
        stream.on('end', () => next());
        stream.resume();
        return;
      }
      const hash = createHash('sha256');
      const out = fs.createWriteStream(path.join(dest, file.name));
      stream.on('data', (chunk: Buffer) => hash.update(chunk));
      out.on('error', (err) => next(err));
      out.on('finish', () => {
        if (hash.digest('hex') !== file.sha256) return next(new Error(`${file.name} did not match its checksum`));
        found.add(file.name);
        next();
      });
      stream.pipe(out);
    });
    extract.on('finish', () => resolve());
    extract.on('error', reject);
    const gunzip = createGunzip();
    gunzip.on('error', reject);
    body.on('error', reject);
    body.pipe(gunzip).pipe(extract);
  });
  const missing = OCR_PACK_FILES.filter((f) => !found.has(f.name)).map((f) => f.name);
  if (missing.length) throw new Error(`The download is missing ${missing.join(', ')}`);
}

async function downloadFrom(url: string, staging: string): Promise<void> {
  const res = await net.fetch(url, { headers: { 'User-Agent': `Phevere/${app.getVersion()}` } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || OCR_PACK_BYTES;
  const reader = res.body.getReader();
  let received = 0;
  let lastEmit = 0;
  const chunks = async function* () {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        progress = Math.min(0.98, received / total);
        if (Date.now() - lastEmit > 150) {
          lastEmit = Date.now();
          emit();
        }
        yield Buffer.from(value);
      }
    } finally {
      await reader.cancel().catch(() => { /* the stream may already be closed */ });
      reader.releaseLock();
    }
  };
  await extractPack(Readable.from(chunks()), staging);
}

async function install(): Promise<string> {
  const dest = installedPackRoot();
  const staging = `${dest}.download`;
  const failures: string[] = [];
  for (const url of sources()) {
    progress = 0;
    emit();
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
      await downloadFrom(url, staging);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(staging, dest);
      log.info('ocr-pack', 'installed', { url, dest });
      return dest;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push(`${url}: ${reason}`);
      log.warn('ocr-pack', 'source failed', { url, reason });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  log.warn('ocr-pack', 'all sources failed', { failures });
  throw new Error('Could not download the OCR pack. Check the connection and try again.');
}

/** Download, verify and install the pack. Concurrent callers share one download. */
export function installOcrPack(): Promise<string> {
  if (!job) {
    lastError = null;
    job = install()
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        throw err;
      })
      .finally(() => {
        job = null;
        emit();
      });
    emit();
  }
  return job;
}
