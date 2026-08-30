import { configureCore } from '@phevere/core';
import { createCapacitorHttpClient } from './capacitor-http';
import { webSha256Hex } from './web-sha256';
import { sqlJsVocabDb } from './sqljs-vocab-db';

configureCore({
  http: createCapacitorHttpClient(),
  sha256Hex: webSha256Hex,
  vocabDb: sqlJsVocabDb,
  newId: () => {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  },
});
