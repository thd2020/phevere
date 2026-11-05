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
export {
  fetchSenseImages,
  fetchWordImage,
  prefetchSenseImages,
  hideSenseImage,
  unhideSenseImage,
  picturableSense,
  predictPictureSenses,
  registerWiktionaryWikitextSource,
  clearSenseImageCache,
  type SenseImage,
} from './sense-images';
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
  setVocabContextIfEmpty,
  type VocabEntry,
  type VocabAddInput,
} from './vocab-store';
export { inferVocabGlossLang, formatVocabLangPair, vocabHeadwordLang, vocabLanguages, filterVocabByLang, vocabLangChipsHtml, type VocabLanguages } from './vocab-lang';
export {
  normalizeSourceContext,
  sourceContextFromJson,
  sourceContextToJson,
  cleanSourceUrl,
  extractSentence,
  findWordInSentence,
  sourceGroupOf,
  sourceBookTitle,
  siteOf,
  lookupTextMatches,
  type SourceContext,
  type SourceGroupKey,
} from './source-context';
export {
  parseWindowTitle,
  isPrivateWindow,
  sourceFromWindow,
  docFromUrl,
  type ParsedWindow,
  type WindowKind,
  type WindowReading,
} from './window-title';
export {
  vocabReadings,
  vocabSenses,
  vocabDayGroup,
  vocabWhen,
  vocabEntryHtml,
  vocabListHtml,
  vocabEntryGroup,
  recentListHtml,
  vocabAzLetter,
  AZ_INDEX,
  compareAz,
  addToBookButtonHtml,
  type RecentLookup,
  type VocabViewEntry,
  type VocabListOptions,
} from './vocab-view';
export { wireIndexRail, type IndexRailOptions } from './index-rail';
export {
  analyzeNotebook,
  notebookViewSwitchHtml,
  readNotebookView,
  familyGroupings,
  familiesHtml,
  parseGoal,
  familiesTraceProgress,
  traceNotebookFamilies,
  layoutNotebookMap,
  mapHtml,
  cardsHtml,
  cardPiles,
  attachCardTable,
  cardLayoutOf,
  readCardLayouts,
  cardLayoutIn,
  withCardLayout,
  type CardLayouts,
  planTable,
  reviewQueue,
  reviewHtml,
  fillWordImages,
  type WordImageFetcher,
  attachNotebookMap,
  attachFamilies,
  closeTreeInspector,
  disposeNotebookMaps,
  type NotebookView,
  type FamilyGrouping,
  type NotebookEntry,
  type NotebookAnalysis,
  type ReviewState,
  type CardLayout,
} from './notebook-views';
export { analyzeMorphemes, morphBreakdown, morphEntry, morphForms, wordOrigin, type Morph, type MorphEntry, type MorphEtymon, type MorphKind } from './morphology';
export { vocabPayloadFromResult, examplesFromResult } from './vocab-payload';

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
  tidyExample,
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
  sameLemma,
  reviewArmed,
  ROUND_WORDS,
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
  rebuildWordSchedule,
  cacheBookWordMeaning,
  saveBookWord,
  bookWordKey,
  DEFAULT_DAILY_NEW,
  USER_BOOK_PREFIX,
  listUserBooks,
  createUserBook,
  renameUserBook,
  addUserBookWords,
  removeUserBookWord,
  deleteUserBook,
  type UserBook,
  type WordbookSub,
  type BookWordProgress,
  type BookWordMeaning,
} from './wordbook-store';
export { syncWordbooks, WORDBOOK_SYNC_NAMESPACE, type WordbookSyncResult } from './wordbook-sync';
export { syncProgress, answerToEvent, eventToAnswer, PROGRESS_SYNC_NAMESPACE, type ProgressSyncResult, type ProgressSyncAccount } from './progress-sync';
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
  markKnownInReview,
  primeBookLevels,
  registerUserBooks,
  sourceGroups,
  isUserBookId,
  type BookMeta,
  type SourceGroup,
  type WordbookMeta,
  type WordsScope,
  type WordStatus,
  type WordsContext,
  type WordsEntry,
  type BookProgress,
} from './wordbooks';
export {
  wordsScopeSwitchHtml,
  sourcesHtml,
  wordbookHeaderHtml,
  wordbookListHtml,
  sortBookEntries,
  type BookSort,
  wordbookLibraryHtml,
  wordBookBadgesHtml,
  progressRingSvg,
  reviewBookRows,
  BOOK_LIST_PAGE,
  bookMenuItems,
  bookRemovalPrompt,
  bookSorts,
  bookPickItems,
} from './wordbook-views';
export { openMenu, closeMenu, menuOpen, type MenuItem, type MenuOptions } from './popover-menu';
export {
  learnHtml,
  learnTodayHtml,
  learnScopeSwitchHtml,
  learnPageSwitchHtml,
  learnEntries,
  scopeBookFor,
  reviewAnswerDetails,
  type LearnViewInput,
  type LearnPage,
} from './learn-view';
export { progressHtml, progressSummary, type ProgressInput, type ProgressSummary } from './learn-progress';
export { attachLearnCharts, retentionAt, revealQuestion } from './learn-charts';
export {
  SKILLS,
  MASTERY_THRESHOLD,
  skillFor,
  listAnswerHistory,
  replaySchedule,
  historyByWord,
  skillMastery,
  insertAnswer,
  answerKey,
  localLemma,
  recordLemmaAliases,
  type Skill,
  type AnswerKind,
  type AnswerRecord,
  type AnswerDetails,
  type ReplayResult,
  type SkillScore,
} from './answer-history';
export {
  HolarkyAccount,
  HolarkyAccountError,
  isPlusRequired,
  PROGRESS_NAMESPACE,
  type HolarkyEntitlements,
  type ProgressEvent,
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
  progressSyncOff,
  syncProgressForAccount,
  type AccountState,
} from './account';
export {
  holarkyMarkSvg,
  accountStatusText,
  accountButtonHtml,
  accountPanelHtml,
  deleteEmailMatches,
  plusNoticeHtml,
  type AccountPanelOptions,
} from './account-view';
export {
  inflectionsFromKaikki,
  selectInflections,
  weighForms,
  type WordInflections,
  type InflectionTable,
  type InflectionGrid,
  type InflectionRow,
} from './inflections';
export { inflectionsHtml, wordFamilyHtml, formLineHtml, didYouMeanHtml, senseLabelLead, definitionSourcesHtml, type LexiconLinks } from './lexicon-parts';
export { linkHtml, linkText, wordLinkHtml, wikiLinkLookup } from './text-links';
export {
  parseMorphemeQuery,
  morphemeLookupQuery,
  morphemeOffers,
  morphemeOf,
  lookupMorpheme,
  tableMorph,
  type MorphemeEntry,
  type MorphemeQuery,
  type MorphemeKind,
} from './morpheme';
export { morphemeSections, morphemeOfferHtml, containsMorpheme, type MorphemeSection, type OwnWords } from './morpheme-view';
export { suggestWords, peekSuggestions, warmSuggestions } from './word-suggest';
export { normalizeVocabLemma, closestSpelling, typoDistance } from './vocab-lemma';
export { normalizeStoredLemmas } from './vocab-sync';
export { checkApiKey, type ApiProviderId, type ApiCredentials, type ApiKeyCheck } from './api-key-check';
export {
  SVG as SETTINGS_ICONS,
  choiceRowHtml,
  keycapsHtml,
  navRowHtml,
  rangeRowHtml,
  switchRowHtml,
  type ChoiceRowInput,
  type NavRowInput,
  type RangeRowInput,
  type SwitchRowInput,
} from './settings-kit';
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
export { GOAL_PRESETS, learnSettingsHtml, type LearnSettingsInput } from './settings-learn';
export {
  COUNTDOWN_CHOICES,
  DEFAULT_LEARN_PREFS,
  microphoneAvailable,
  readLearnPrefs,
  watchMicrophone,
  writeLearnPrefs,
  type LearnPrefs,
} from './learn-prefs';
export {
  BOOK_FILE_EXTENSION,
  BookLockedError,
  bookFileName,
  decodeBookFile,
  encodeBookFile,
  isBookFile,
  type BookPayload,
  type BookWord,
} from './book-file';
export { exportBookFile, findBookConflict, importBookPayload, type BookConflict, type BookImportResult, type BookScope } from './book-transfer';
export { ankiFieldText, ankiTextFromBook, isZip, parseAnkiPackage, parseAnkiText, type OpenSqlite, type SqliteReader } from './anki-import';
