import { configureCore, type LookupOffline } from '@phevere/core';
import { createHttpClient } from './http';
import { webSha256Hex } from './web-sha256';
import { sqlJsVocabDb } from './sqljs-vocab-db';
import { lookupOfflineHits } from './offline';
import { localLookupCache } from './lookup-cache';

const lookupOffline: LookupOffline = (headword, language, limit, extraForms) =>
  lookupOfflineHits(headword, language, limit, extraForms);

configureCore({
  http: createHttpClient(),
  sha256Hex: webSha256Hex,
  vocabDb: sqlJsVocabDb,
  lookupOffline,
  lookupCache: localLookupCache,
  newId: () => {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  },
});
