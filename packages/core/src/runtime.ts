import type { HttpClient } from './http';
import { trackHttp } from './net';

export interface OfflineHit {
  headword: string;
  language: string;
  pos?: string;
  definition: string;
  packId: string;
  packName?: string;
}

export type LookupOffline = (
  headword: string,
  language?: string,
  limit?: number,
  extraForms?: string[],
) => Promise<OfflineHit[]>;

export interface VocabDb {
  ready(): Promise<void>;
  initError(): string | null;
  queryAll(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | null>;
  runWrite(sql: string, params?: unknown[]): Promise<void>;
  /**
   * Picks up writes another page made to the same notebook file since this copy was read. The
   * phone keeps one copy per page (the app and its pop-up); a sync calls this first so it
   * sends every word, wherever it was saved.
   */
  refresh?(): Promise<void>;
}

export type Sha256Hex = (input: string) => Promise<string> | string;

/**
 * Optional persistent store for finished lookups, so a result survives a restart
 * (the phone kills its WebView often). Values are plain JSON; `savedAt` is epoch ms.
 */
export interface LookupCacheStore {
  get(key: string): Promise<{ value: unknown; savedAt: number } | null> | { value: unknown; savedAt: number } | null;
  set(key: string, value: unknown, savedAt: number): Promise<void> | void;
}

export interface CoreRuntime {
  http: HttpClient;
  sha256Hex: Sha256Hex;
  lookupOffline?: LookupOffline;
  vocabDb?: VocabDb;
  newId?: () => string;
  lookupCache?: LookupCacheStore;
  /** A short name for this device ("DESKTOP-4K2", "Android phone"), stored with each new save. */
  deviceName?: () => string;
}

let http: HttpClient | null = null;
let sha256Hex: Sha256Hex | null = null;
let lookupOffline: LookupOffline = async () => [];
let vocabDb: VocabDb | null = null;
let newId: () => string = () => `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let lookupCache: LookupCacheStore | null = null;
let deviceName: () => string = () => '';

export function configureCore(opts: CoreRuntime): void {
  // Round trips per host, adaptive timeouts, backup requests and Wikimedia's three slots (net.ts).
  http = trackHttp(opts.http);
  sha256Hex = opts.sha256Hex;
  if (opts.lookupOffline) lookupOffline = opts.lookupOffline;
  if (opts.vocabDb) vocabDb = opts.vocabDb;
  if (opts.newId) newId = opts.newId;
  if (opts.lookupCache) lookupCache = opts.lookupCache;
  if (opts.deviceName) deviceName = opts.deviceName;
}

export function getLookupCache(): LookupCacheStore | null {
  return lookupCache;
}

export function getHttp(): HttpClient {
  if (!http) throw new Error('@phevere/core: configureCore({ http }) was not called');
  return http;
}

export function getSha256Hex(): Sha256Hex {
  if (!sha256Hex) throw new Error('@phevere/core: configureCore({ sha256Hex }) was not called');
  return sha256Hex;
}

export function getLookupOffline(): LookupOffline {
  return lookupOffline;
}

export function getVocabDb(): VocabDb {
  if (!vocabDb) throw new Error('@phevere/core: configureCore({ vocabDb }) was not called');
  return vocabDb;
}

export function getNewId(): string {
  return newId();
}

export function isCoreConfigured(): boolean {
  return http != null && sha256Hex != null;
}

/** This device's name for new notebook saves, or '' when the shell gives none. */
export function getDeviceName(): string {
  try {
    return String(deviceName() || '').slice(0, 64);
  } catch {
    return '';
  }
}
