import type { VocabDb } from '@phevere/core';
import { getLocalDb, getLocalDbInitError, queryAll, queryOne, runWrite } from '../services/local-db';

export const electronVocabDb: VocabDb = {
  ready: () => getLocalDb(),
  initError: () => getLocalDbInitError(),
  queryAll: (sql, params) => queryAll(sql, params),
  queryOne: (sql, params) => queryOne(sql, params),
  runWrite: (sql, params) => runWrite(sql, params || []),
};
