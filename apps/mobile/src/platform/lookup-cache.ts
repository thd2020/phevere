import type { LookupCacheStore } from '@phevere/core';

/**
 * Finished lookups kept in localStorage, so they survive Android killing the WebView and
 * are shared by the app and the floating pop-up (same origin, separate JS contexts).
 * Oldest entries go first once either limit is reached.
 *
 * Sense pictures (keys starting "sense-images:") are small and numerous, one per card in Words,
 * so they keep their own index and budget: a notebook of 600 cards would otherwise push every
 * dictionary result out of a 300-entry cache, and the cards would ask Wikimedia again.
 */
const PREFIX = 'phevere.lookup.';

interface Pool {
  index: string;
  maxEntries: number;
  /** Characters, not bytes. WebView localStorage allows about 5 MB per origin; leave room for prefs. */
  maxChars: number;
}

const LOOKUPS: Pool = { index: 'phevere.lookup.index', maxEntries: 300, maxChars: 2_500_000 };
const PICTURES: Pool = { index: 'phevere.lookup.pictures', maxEntries: 2500, maxChars: 700_000 };

function poolOf(key: string): Pool {
  return key.startsWith('sense-images:') ? PICTURES : LOOKUPS;
}

type IndexRow = [key: string, savedAt: number, size: number];

function readIndex(pool: Pool): IndexRow[] {
  try {
    const raw = localStorage.getItem(pool.index);
    const rows = raw ? (JSON.parse(raw) as IndexRow[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeIndex(pool: Pool, rows: IndexRow[]): void {
  try {
    localStorage.setItem(pool.index, JSON.stringify(rows));
  } catch {
    /* quota: entries below are trimmed on the next write */
  }
}

function evict(pool: Pool, rows: IndexRow[], incoming: number): IndexRow[] {
  let total = rows.reduce((n, r) => n + r[2], 0) + incoming;
  const sorted = [...rows].sort((a, b) => a[1] - b[1]);
  while (sorted.length && (sorted.length >= pool.maxEntries || total > pool.maxChars)) {
    const [key, , size] = sorted.shift()!;
    total -= size;
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  }
  return sorted;
}

export const localLookupCache: LookupCacheStore = {
  get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw) as { value: unknown; savedAt: number };
    } catch {
      return null;
    }
  },
  set(key, value, savedAt) {
    let body: string;
    try {
      body = JSON.stringify({ value, savedAt });
    } catch {
      return;
    }
    const pool = poolOf(key);
    if (body.length > pool.maxChars / 20) return;
    const rows = evict(pool, readIndex(pool).filter((r) => r[0] !== key), body.length);
    try {
      localStorage.setItem(PREFIX + key, body);
    } catch {
      // Storage full (prefs and the notebook share it): shrink the cache to half its budget.
      const kept = evict(pool, rows, pool.maxChars / 2);
      writeIndex(pool, kept);
      try {
        localStorage.setItem(PREFIX + key, body);
      } catch {
        return;
      }
      writeIndex(pool, [...kept, [key, savedAt, body.length]]);
      return;
    }
    writeIndex(pool, [...rows, [key, savedAt, body.length]]);
  },
};
