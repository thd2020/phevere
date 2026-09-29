import type { LookupCacheStore } from '@phevere/core';

/**
 * Finished lookups kept in localStorage, so they survive Android killing the WebView and
 * are shared by the app and the floating pop-up (same origin, separate JS contexts).
 * Oldest entries go first once either limit is reached.
 */
const PREFIX = 'phevere.lookup.';
const INDEX = 'phevere.lookup.index';
const MAX_ENTRIES = 300;
/** Characters, not bytes. WebView localStorage allows about 5 MB per origin; leave room for prefs. */
const MAX_CHARS = 2_500_000;

type IndexRow = [key: string, savedAt: number, size: number];

function readIndex(): IndexRow[] {
  try {
    const raw = localStorage.getItem(INDEX);
    const rows = raw ? (JSON.parse(raw) as IndexRow[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeIndex(rows: IndexRow[]): void {
  try {
    localStorage.setItem(INDEX, JSON.stringify(rows));
  } catch {
    /* quota: entries below are trimmed on the next write */
  }
}

function evict(rows: IndexRow[], incoming: number): IndexRow[] {
  let total = rows.reduce((n, r) => n + r[2], 0) + incoming;
  const sorted = [...rows].sort((a, b) => a[1] - b[1]);
  while (sorted.length && (sorted.length >= MAX_ENTRIES || total > MAX_CHARS)) {
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
    if (body.length > MAX_CHARS / 20) return;
    const rows = evict(readIndex().filter((r) => r[0] !== key), body.length);
    try {
      localStorage.setItem(PREFIX + key, body);
    } catch {
      // Storage full (prefs and the notebook share it): shrink the cache to half its budget.
      const kept = evict(rows, MAX_CHARS / 2);
      writeIndex(kept);
      try {
        localStorage.setItem(PREFIX + key, body);
      } catch {
        return;
      }
      writeIndex([...kept, [key, savedAt, body.length]]);
      return;
    }
    writeIndex([...rows, [key, savedAt, body.length]]);
  },
};
