/**
 * Persistent lookup cache for the desktop (userData/lookup-cache/), the counterpart of the
 * phone's localStorage cache. Core keeps dictionary results and sense pictures here for up to
 * two weeks, so a restart does not ask Wikimedia and the dictionaries for everything again.
 *
 * One small file per key, named by the key's SHA-1, so a write never rewrites the whole cache.
 * Files older than 15 days, and the oldest beyond MAX_FILES, are removed at startup.
 */
import { app } from 'electron';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { LookupCacheStore } from '@phevere/core';

const DIR_NAME = 'lookup-cache';
const MAX_AGE_MS = 15 * 86_400_000;
const MAX_FILES = 6000;

let dir: string | null = null;

function cacheDir(): string {
  if (dir) return dir;
  let base: string;
  try {
    base = app.getPath('userData');
  } catch {
    base = process.cwd();
  }
  dir = path.join(base, DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileFor(key: string): string {
  return path.join(cacheDir(), `${createHash('sha1').update(key).digest('hex')}.json`);
}

/** Drop expired entries and keep the newest MAX_FILES. Runs once, off the startup path. */
export function pruneLookupCache(): void {
  setTimeout(() => {
    void (async () => {
      try {
        const d = cacheDir();
        const names = (await fs.promises.readdir(d)).filter((n) => n.endsWith('.json'));
        const now = Date.now();
        const rows: Array<{ file: string; at: number }> = [];
        for (const n of names) {
          const file = path.join(d, n);
          try {
            const st = await fs.promises.stat(file);
            if (now - st.mtimeMs > MAX_AGE_MS) await fs.promises.unlink(file);
            else rows.push({ file, at: st.mtimeMs });
          } catch {
            /* removed meanwhile */
          }
        }
        rows.sort((a, b) => b.at - a.at);
        for (const r of rows.slice(MAX_FILES)) await fs.promises.unlink(r.file).catch((): undefined => undefined);
      } catch {
        /* no cache folder yet */
      }
    })();
  }, 15_000);
}

export const fileLookupCache: LookupCacheStore = {
  async get(key) {
    try {
      const raw = await fs.promises.readFile(fileFor(key), 'utf8');
      const hit = JSON.parse(raw);
      return hit && typeof hit.savedAt === 'number' ? { value: hit.value, savedAt: hit.savedAt } : null;
    } catch {
      return null;
    }
  },
  async set(key, value, savedAt) {
    let body: string;
    try {
      body = JSON.stringify({ value, savedAt });
    } catch {
      return;
    }
    const file = fileFor(key);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fs.promises.writeFile(tmp, body, 'utf8');
      await fs.promises.rename(tmp, file);
    } catch {
      await fs.promises.unlink(tmp).catch((): undefined => undefined);
    }
  },
};
