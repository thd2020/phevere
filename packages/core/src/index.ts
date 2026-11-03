export { DictionaryError, BaseService, withTimeout, withTimeoutFallback } from './base';
export type { CoreRequestInit } from './base';
export type { HttpClient, HttpRequestInit, HttpTextResponse, HttpBytesResponse } from './http';
export { bytesToBase64 } from './http';
export { configureCore, getHttp, getSha256Hex, getLookupOffline, getVocabDb, getNewId, getLookupCache, isCoreConfigured } from './runtime';
export type { CoreRuntime, LookupOffline, OfflineHit, VocabDb, Sha256Hex, LookupCacheStore } from './runtime';
export { wrapConsole } from './log';

export {
  DictionaryService,
  dictionaryService,
  type DictionaryResult,
  type EtymologyUnavailable,
  type Definition,
  type Translation,
  type DictionarySource,
  type TranslationProvider,
} from './dictionary';
export { WikipediaService, wikipediaService, type WikipediaResult, type WikipediaSearchResult } from './wikipedia';
export { fetchSenseImages, fetchWordImage, clearSenseImageCache, type SenseImage } from './sense-images';
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
export { inferVocabGlossLang, formatVocabLangPair } from './vocab-lang';
export {
  vocabReadings,
  vocabSenses,
  vocabDayGroup,
  vocabWhen,
  vocabEntryHtml,
  vocabListHtml,
  vocabEntryGroup,
  recentListHtml,
  type RecentLookup,
  type VocabViewEntry,
  type VocabListOptions,
} from './vocab-view';
export {
  analyzeNotebook,
  notebookViewSwitchHtml,
  readNotebookView,
  familyGroupings,
  familiesHtml,
  familiesTraceProgress,
  traceNotebookFamilies,
  layoutNotebookMap,
  mapHtml,
  cardsHtml,
  cardPiles,
  attachCardTable,
  reviewQueue,
  reviewHtml,
  fillWordImages,
  attachNotebookMap,
  disposeNotebookMaps,
  type NotebookView,
  type FamilyGrouping,
  type NotebookEntry,
  type NotebookAnalysis,
  type ReviewState,
  type CardLayout,
} from './notebook-views';
export { analyzeMorphemes, morphBreakdown, wordOrigin, type Morph, type MorphKind } from './morphology';
export { vocabPayloadFromResult } from './vocab-payload';

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
  abbreviatePos,
  exampleKey,
  dedupeExamples,
  mergeSimilarDefinitions,
  stripCrossLemmaSenses,
  sortDefinitionsByReadingOrder,
} from './definition-merge';

export {
  type SenseFrequencyData,
  orderSensesByFrequency,
  alignToWordNet,
  frequencyBand,
  primeSenseFrequency,
  warmSenseFrequency,
  senseFrequencyReady,
} from './sense-frequency';

export { buildEtymology, extractLanguageSection, scanTemplates, templateToLink, type EtymologyLink } from './etymology';
export {
  type Pronunciation,
  parseFreeDictionaryPhonetics,
  extractIpaFromWikitext,
  mergePronunciations,
  formatPronunciationLine,
  recordedPronunciationUrls,
  cleanIpa,
  derivationalStems,
  normalizePronunciationAudioUrl,
} from './pronunciation';
export {
  type IpaAccent,
  accentToBcp47,
  phonemeIpa,
  ipaToSapiPhones,
  ipaToApplePhonemes,
  ipaToEspeakPhonemes,
  ipaToKokoroPhonemes,
  buildSapiPhonemeSsml,
  buildIpaPhonemeSsml,
} from './ipa-phonemes';
export { splitSpeechText, type SpeechChunkOptions } from './speech-chunks';
export { buildWordFamily, mergeWordFamilyGroups, familyFromEtymologyChain, type WordFamilyGroup } from './word-family';
export {
  parseFreedictTei,
  parseFreedictTeiEntry,
  FreedictTeiStream,
  parseGcideCide,
  parseWordNetData,
  parseCedict,
  parseCedictLine,
  parseJmdictJson,
  parseJmdictLine,
  parseKengdicTsv,
  KengdicCollector,
  type ParsedOfflineEntry,
} from './offline-pack-parsers';
export {
  OFFLINE_CATALOG,
  catalogFor,
  getCatalogItem,
  groupCatalogByLanguage,
  wantsArchiveMember,
  type OfflineCatalogItem,
  type OfflinePackFormat,
  type OfflinePackArchive,
  type OfflinePlatform,
  type CatalogLanguageGroup,
} from './offline-catalog';
export { LANGUAGE_NAMES, languageName, looksJapaneseKanji } from './source-languages';
export { xzDecompress, isXz } from './xz-decode';
export { extractTar, type TarFile } from './tar-extract';
export { VOCAB_SCHEMA_SQL, VOCAB_ADDED_COLUMNS, vocabColumnMigrations } from './schema';
export {
  scheduleReview,
  previewReview,
  formatReviewGap,
  memoryFromSm2,
  DESIRED_RETENTION,
  type ReviewGrade,
  type ScheduleFields,
  type ScheduleUpdate,
} from './review-schedule';
export {
  startReview,
  ensureReviewQuestion,
  answerReview,
  overrideReview,
  advanceReview,
  isNewWord,
  memoryLevel,
  buildQuestion,
  type ReviewQuestion,
  type ReviewAnswer,
  type ReviewResult,
  type QuestionKind,
} from './review-quiz';
export { type ReviewRenderOptions } from './notebook-review';

export { onVocabChanged } from './vocab-store';
export { syncVocab, mergeDuplicateLemmas, VOCAB_SYNC_NAMESPACE, type VocabSyncAccount, type VocabSyncResult } from './vocab-sync';
export {
  listWordbookSubs,
  subscribeWordbook,
  unsubscribeWordbook,
  setWordbookGoal,
  listBookProgress,
  reviewBookWord,
  setBookWordKnown,
  cacheBookWordMeaning,
  saveBookWord,
  bookWordKey,
  DEFAULT_DAILY_NEW,
  type WordbookSub,
  type BookWordProgress,
  type BookWordMeaning,
} from './wordbook-store';
export { syncWordbooks, WORDBOOK_SYNC_NAMESPACE, type WordbookSyncResult } from './wordbook-sync';
export {
  WORDBOOKS,
  wordbookMeta,
  loadWordbook,
  registerWordbookWords,
  buildWordsContext,
  bookEntry,
  isBookOnlyId,
  wordStatus,
  scopeEntries,
  bookProgress,
  scopeReviewQueue,
  startScopeReview,
  reviewNeedsMeaning,
  dropCurrentReview,
  type WordbookMeta,
  type WordsScope,
  type WordStatus,
  type WordsContext,
  type WordsEntry,
  type BookProgress,
} from './wordbooks';
export {
  wordsScopeSwitchHtml,
  wordbookHeaderHtml,
  wordbookListHtml,
  wordbookLibraryHtml,
  wordBookBadgesHtml,
  progressRingSvg,
  scopeStudySet,
  reviewBookRows,
  BOOK_LIST_PAGE,
} from './wordbook-views';
export { learnHtml, learnTodayHtml, learnScopeSwitchHtml, learnEntries, type LearnViewInput } from './learn-view';
export {
  HolarkyAccount,
  HolarkyAccountError,
  browserStorage,
  type HolarkyUser,
  type HolarkySession,
  type KeyValueStorage,
} from './holarky-account';
export {
  HOLARKY_ACCOUNT,
  resolveAccountApi,
  httpClientFetch,
  AccountController,
  type AccountState,
} from './account';
export {
  holarkyMarkSvg,
  accountStatusText,
  accountButtonHtml,
  accountPanelHtml,
  deleteEmailMatches,
  type AccountPanelOptions,
} from './account-view';
export {
  inflectionsFromKaikki,
  selectInflections,
  englishPossessive,
  type WordInflections,
  type InflectionTable,
  type InflectionGrid,
  type InflectionRow,
} from './inflections';
export { inflectionsHtml, wordFamilyHtml, type LexiconLinks } from './lexicon-parts';
export { normalizeVocabLemma, closestSpelling, typoDistance } from './vocab-lemma';
export { normalizeStoredLemmas } from './vocab-sync';
export { checkApiKey, type ApiProviderId, type ApiCredentials, type ApiKeyCheck } from './api-key-check';
export {
  SOURCE_INFO,
  TRANSLATION_ENGINES,
  sourceRowHtml,
  sourcesPanelHtml,
  type SourceInfo,
  type SourceRowInput,
} from './settings-sources';
export {
  LANGUAGE_TRAITS,
  formatBytes,
  languageTraits,
  offlineShelvesHtml,
  packCardHtml,
  packInspectorHtml,
  type PackDetails,
  type PackProgress,
  type PackView,
} from './settings-offline';
export {
  API_PROVIDERS,
  apiKeyCardHtml,
  apiKeysPanelHtml,
  patchApiKeyCard,
  type ApiProviderInfo,
  type KeyCardState,
  type KeyStatus,
} from './settings-keys';
