/**
 * Wire @phevere/core to Node/Electron (HTTP, SHA-256, sql.js worker, offline packs).
 * Import this before any lookup/vocab call.
 */
import { randomUUID } from 'crypto';
import { configureCore } from '@phevere/core';
import { createNodeHttpClient } from './node-http';
import { nodeSha256Hex } from './node-sha256';
import { electronVocabDb } from './electron-vocab-db';
import { lookupOffline } from '../services/offline-dict-store';

configureCore({
  http: createNodeHttpClient(),
  sha256Hex: nodeSha256Hex,
  lookupOffline,
  vocabDb: electronVocabDb,
  newId: () => {
    try {
      return randomUUID();
    } catch {
      return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  },
});
