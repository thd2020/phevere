export { DictionaryError, BaseService, withTimeout, withTimeoutFallback } from './base';
export type { CoreRequestInit } from './base';
export type { HttpClient, HttpRequestInit, HttpTextResponse, HttpBytesResponse } from './http';
export { bytesToBase64 } from './http';
export { configureCore, getHttp, getSha256Hex, getLookupOffline, getVocabDb, getNewId, isCoreConfigured } from './runtime';
export type { CoreRuntime, LookupOffline, OfflineHit, VocabDb, Sha256Hex } from './runtime';
export { wrapConsole } from './log';

export {
  DictionaryService,
  dictionaryService,
  type DictionaryResult,
  type Definition,
  type Translation,
  type DictionarySource,
  type TranslationProvider,
} from './dictionary';
export { WikipediaService, wikipediaService, type WikipediaResult, type WikipediaSearchResult } from './wikipedia';
export {
  addVocab,
  fillEmptyDefinitions,
  listEmptyDefinitions,
  listEmptyReadings,
  getVocab,
  findByLemma,
  listVocab,
  removeVocab,
  updateVocabNote,
  reviewVocab,
  ensureVocabReady,
  type VocabEntry,
  type VocabAddInput,
} from './vocab-store';

export {
  type ContextOrigin,
  type ContextBounds,
  type ContextEvent,
  type SelectionEvent,
  type ContextHandler,
  selectionToContext,
  ContextCaptureHub,
  contextCaptureHub,
} from './context-capture';

export {
  type QueryKind,
  type NormalizedQuery,
  type LatinLemmaPos,
  foldLatinHeadword,
  sanitize,
  trimEdges,
  classify,
  buildCandidates,
  latinLemmasByPos,
  latinCitationPos,
  latinLemmaForms,
  normalizeQuery,
  isLookupWorthy,
  foldLookupKey,
  cacheKeyFor,
  isContentHeadword,
  lemmaFromFormOfHtml,
} from './text-normalize';

export {
  GRAMMATICAL_FORM_OF,
  GRAMMATICAL_FORM_OF_LINK,
  stripGlossText,
  isGrammaticalFormOfGloss,
  sameLookupFold,
  splitSurfaceAndLemma,
  saveLemma,
} from './lookup-policy';

export {
  type MergeableDefinition,
  normalizeMeaningForMerge,
  canonicalPos,
  exampleKey,
  dedupeExamples,
  mergeSimilarDefinitions,
  stripCrossLemmaSenses,
  sortDefinitionsByReadingOrder,
} from './definition-merge';

export { buildEtymology, extractLanguageSection, scanTemplates, templateToLink, type EtymologyLink } from './etymology';
export {
  type Pronunciation,
  parseFreeDictionaryPhonetics,
  extractIpaFromWikitext,
  mergePronunciations,
  formatPronunciationLine,
  cleanIpa,
  derivationalStems,
} from './pronunciation';
export { buildWordFamily, mergeWordFamilyGroups, familyFromEtymologyChain, type WordFamilyGroup } from './word-family';
export {
  parseFreedictTei,
  parseGcideCide,
  parseWordNetData,
  type ParsedOfflineEntry,
} from './offline-pack-parsers';
export { VOCAB_SCHEMA_SQL } from './schema';
