import type { HttpClient } from './http';

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
}

export type Sha256Hex = (input: string) => Promise<string> | string;

export interface CoreRuntime {
  http: HttpClient;
  sha256Hex: Sha256Hex;
  lookupOffline?: LookupOffline;
  vocabDb?: VocabDb;
  newId?: () => string;
}

let http: HttpClient | null = null;
let sha256Hex: Sha256Hex | null = null;
let lookupOffline: LookupOffline = async () => [];
let vocabDb: VocabDb | null = null;
let newId: () => string = () => `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function configureCore(opts: CoreRuntime): void {
  http = opts.http;
  sha256Hex = opts.sha256Hex;
  if (opts.lookupOffline) lookupOffline = opts.lookupOffline;
  if (opts.vocabDb) vocabDb = opts.vocabDb;
  if (opts.newId) newId = opts.newId;
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
