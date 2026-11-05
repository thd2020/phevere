import { scrollLexiconTo } from './lexicon-scroll';
import './platform/configure-core';
import {
  addVocab,
  morphemeOf,
  dictionaryService,
  fetchSenseImages,
  prefetchSenseImages,
  hideSenseImage,
  unhideSenseImage,
  fillEmptyDefinitions,
  findByLemma,
  listEmptyDefinitions,
  listEmptyReadings,
  listVocab,
  removeVocab,
  saveLemma,
  vocabPayloadFromResult,
  examplesFromResult,
  attachLearnCharts,
  revealQuestion,
  reviewArmed,
  markKnownInReview,
  primeBookLevels,
  ROUND_WORDS,
  memoryLevel,
  wikipediaService,
  type Pronunciation,
  type DictionaryResult,
  type SenseImage,
  type VocabEntry,
  type WikipediaResult,
  type AccountState,
  accountButtonHtml,
  accountPanelHtml,
  plusNoticeHtml,
  HOLARKY_ACCOUNT,
  deleteEmailMatches,
  attachNotebookMap,
  attachFamilies,
  closeTreeInspector,
  traceNotebookFamilies,
  attachCardTable,
  disposeNotebookMaps,
  peekSuggestions,
  suggestWords,
  fetchWordImage,
  fillWordImages,
  startReview,
  answerReview,
  overrideReview,
  advanceReview,
  isNewWord,
  previewReview,
  formatReviewGap,
  reviewVocab,
  BOOK_LIST_PAGE,
  bookEntry,
  buildWordsContext,
  cacheBookWordMeaning,
  dropCurrentReview,
  isBookOnlyId,
  listBookProgress,
  listWordbookSubs,
  loadWordbook,
  reviewBookWord,
  reviewNeedsMeaning,
  saveBookWord,
  scopeEntries,
  setBookWordKnown,
  setWordbookGoal,
  startScopeReview,
  subscribeWordbook,
  unsubscribeWordbook,
  wordbookMeta,
  listUserBooks,
  createUserBook,
  renameUserBook,
  addUserBookWords,
  removeUserBookWord,
  deleteUserBook,
  isUserBookId,
  sourceGroups,
  sourceBookTitle,
  normalizeSourceContext,
  lookupTextMatches,
  type SourceContext,
  type UserBook,
  type BookWordProgress,
  type WordbookSub,
  type WordsContext,
  type WordsScope,
  type BookSort,
  type CardLayout,
  type FamilyGrouping,
  type MorphKind,
  type NotebookView,
  readNotebookView,
  reviewAnswerDetails,
  scopeBookFor,
  listAnswerHistory,
  type AnswerRecord,
  type LearnPage,
  type RecentLookup,
  type ReviewState,
  API_PROVIDERS,
  patchApiKeyCard,
  type ApiProviderId,
  parseGoal,
  findBookConflict,
  importBookPayload,
  type BookScope,
} from '@phevere/core';
import { extractLookupQuery, queryFromLocation, startIncomingText } from './incoming-text';
import { playRecorded, prefetchRecorded, recordedReady, speakIpa, speakText } from './platform/audio';
import {
  applyInsets,
  hasNativeBridge,
  installNativeCallbacks,
  nativeCall,
} from './platform/native';
import { bookPayloadFromPicked, exportBook, importNotebookText } from './platform/notebook-io';
import {
  downloadCatalogPack,
  importUserFile,
  listCatalogStatus,
  markInstalledPacksOnCore,
  packStorageBytes,
  removePack,
  type CatalogStatus,
} from './platform/offline';
import { applyPrefsToCore, loadPrefs, savePrefs, type MobilePrefs } from './platform/prefs';
import { startPhoneUpdates } from './platform/updates';
import { updateStatusText, type PhoneUpdateState, type PhoneUpdater } from './app-update';
import * as accountPlatform from './platform/account';
import {
  lookupBody,
  lexiconSenses,
  senseFigureHtml,
  etymologyEntryUrl,
  navHtml,
  notebookBody,
  learnBody,
  type LearnState,
  scanHtml,
  appBarHtml,
  popupBarHtml,
  settingsBody,
  emptyLibraryState,
  keyPresent,
  type CaptureInfo,
  type LangSide,
  type PickerId,
  type ResultTab,
  type ScanPage,
  type SettingsSection,
  type VoiceStatus,
  MOCK_BAR,
  type Tab,
  type WikiArticle,
  esc,
} from './views';

const root = document.getElementById('app')!;

let tab: Tab = 'lookup';
let settingsSection: SettingsSection = 'capture';
let query = '';
let draft = '';
let looking = false;
let lookupGeneration = 0;
let result: DictionaryResult | null = null;
let saved: VocabEntry | null = null;
let status = '';
let resultTab: ResultTab = 'lexicon';
let langMenu: PickerId | '' = '';
let voice: VoiceStatus | null = null;
let voiceTimer: number | null = null;
let lexiconPos = '';
let lexiconWord = '';
let etymologySource = '';
let posJumpLock = false;
let posJumpTimer: number | null = null;
let wiki: WikipediaResult[] = [];
let wikiArticle: WikiArticle | null = null;
let wikiStack: WikiArticle[] = [];
let wikiFetch = 0;
let wikiLoading = false;
let wikiError = '';
let wikiListOnly = false;
let lookupError = '';
let notebook: VocabEntry[] = [];
/** Pictures for the Lexicon's senses, keyed by the word and its sense list. */
let senseImages: { key: string; list: Array<SenseImage | null> } | null = null;

const NOTEBOOK_SORT_KEY = 'phevere.notebookSort';
const RECENT_KEY = 'phevere.recentLookups';
const RECENT_CAP = 30;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the setting lasts this session only */
  }
}

/** Newest first. Lists saved before 2.4 hold bare words, which have no time. */
function loadRecent(): RecentLookup[] {
  try {
    const list = JSON.parse(readStore(RECENT_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .map((w: unknown) => (typeof w === 'string' ? { q: w, at: 0 } : { q: String((w as RecentLookup)?.q || ''), at: Number((w as RecentLookup)?.at) || 0 }))
      .filter((w) => w.q.trim())
      .slice(0, RECENT_CAP);
  } catch {
    return [];
  }
}

let notebookSort: 'recent' | 'az' = readStore(NOTEBOOK_SORT_KEY) === 'az' ? 'az' : 'recent';
let recentLookups: RecentLookup[] = loadRecent();

/** Newest first, one entry per word (case-folded), capped. */
function rememberRecent(q: string): void {
  const key = q.trim().toLowerCase();
  if (!key) return;
  recentLookups = [{ q: q.trim(), at: Date.now() }, ...recentLookups.filter((w) => w.q.trim().toLowerCase() !== key)].slice(0, RECENT_CAP);
  writeStore(RECENT_KEY, JSON.stringify(recentLookups));
}
let notebookFilter = '';
const NB_VIEW_KEY = 'phevere.notebookView';
const NB_GROUP_KEY = 'phevere.notebookGroup';
const NB_LANG_KEY = 'phevere.wordsLang';
const NB_MAP_KEY = 'phevere.notebookMapKinds';
const NB_GOAL_KEY = 'phevere.reviewGoal';
const NB_CARDS_KEY = 'phevere.notebookCardsLayout';
// Review moved from the Words switcher to the Learn tab; a saved Review view becomes the list.
const savedView = readNotebookView(readStore(NB_VIEW_KEY));
if (savedView.learn) writeStore(NB_VIEW_KEY, savedView.view);
const nbState = {
  view: savedView.view as NotebookView,
  group: (readStore(NB_GROUP_KEY) || 'root') as FamilyGrouping,
  mapKinds: (readStore(NB_MAP_KEY) || 'root,prefix,char').split(',').filter(Boolean) as MorphKind[],
  flipped: new Set<string>(),
  cardLayout: (readStore(NB_CARDS_KEY) || 'piles') as CardLayout,
  review: null as ReviewState | null,
  goal: Number(readStore(NB_GOAL_KEY)) || 10,
  lang: readStore(NB_LANG_KEY) || 'all',
};
/** Every word, for Review and the Words views; refreshNotebook keeps it equal to the list. */
let reviewPool: VocabEntry[] = [];
let grading = false;
/* Learn: Today or Progress, and the answer history Progress draws from (null until loaded). */
const LEARN_PAGE_KEY = 'phevere.learnPage';
let learnPage: LearnPage = readStore(LEARN_PAGE_KEY) === 'progress' ? 'progress' : 'today';
let answerHistory: AnswerRecord[] | null = null;

async function loadAnswerHistory(): Promise<void> {
  try {
    answerHistory = await listAnswerHistory();
  } catch {
    answerHistory = [];
  }
}

/* Word books: the list the Words tab shows (My words, a book or All books) and its data. */
const WORDS_SCOPE_KEY = 'phevere.wordsScope';
const BOOK_SORT_KEY = 'phevere.bookSort';
function readBookSort(v: string | null): BookSort {
  return v === 'recent' || v === 'az' ? v : 'book';
}
const wbMeaningInFlight = new Set<string>();
const wordsState = {
  scope: (readStore(WORDS_SCOPE_KEY) || 'mine') as WordsScope,
  library: false,
  ctx: null as WordsContext | null,
  limit: BOOK_LIST_PAGE,
  sort: readBookSort(readStore(BOOK_SORT_KEY)),
  /** Book words opened on their brief definition, by lowercase headword. */
  open: new Set<string>(),
  loading: wbMeaningInFlight,
};
let wbSubs: WordbookSub[] = [];
let wbUserBooks: UserBook[] = [];
let wbProgress = new Map<string, BookWordProgress>();
const wbBooks = new Map<string, string[]>();
/* Example sentences for the quiz's gap-fill questions, looked up ahead for words held for days. */
const reviewExamples = new Map<string, string[]>();
const examplesInFlight = new Set<string>();

async function prefetchExamples(wait = false): Promise<void> {
  const r = nbState.review;
  if (!r) return;
  const byId = new Map(scopePool().map((e) => [e.id, e]));
  const lemmas: string[] = [];
  for (let i = r.index + (wait ? 0 : 1); i < r.queue.length && lemmas.length < 3; i++) {
    const e = byId.get(r.queue[i]);
    const key = String(e?.lemma || '').toLowerCase();
    if (!e || !key || reviewExamples.has(key) || examplesInFlight.has(key) || memoryLevel(e) < 2) continue;
    lemmas.push(String(e.lemma));
  }
  const jobs = lemmas.map(async (lemma) => {
    const key = lemma.toLowerCase();
    examplesInFlight.add(key);
    try {
      const res = await dictionaryService.lookup(lemma, prefs.targetLang, dictionaryService.getEnabledSources(), { translationProvider: prefs.translationProvider });
      reviewExamples.set(key, examplesFromResult(res));
    } catch {
      /* offline: no gap-fill from examples */
    } finally {
      examplesInFlight.delete(key);
    }
  });
  if (wait) await Promise.all(jobs);
}

function rebuildWordsContext(): void {
  const mine = reviewPool.length >= notebook.length ? reviewPool : notebook;
  wordsState.ctx = buildWordsContext(mine, wbProgress, wbSubs, wbBooks, wbUserBooks);
  const known = ['mine', 'all', 'sources'];
  if (!known.includes(wordsState.scope) && !wbSubs.some((s) => s.bookId === wordsState.scope)) {
    setWordsScope('mine');
  }
  if (wordsState.scope === 'all' && !wbSubs.length) setWordsScope('mine');
}

function setWordsScope(scope: WordsScope): void {
  wordsState.scope = scope;
  wordsState.library = false;
  wordsState.limit = BOOK_LIST_PAGE;
  nbState.review = null;
  writeStore(WORDS_SCOPE_KEY, scope);
}

/** Subscriptions, progress and the words of each subscribed book. */
async function refreshWords(): Promise<void> {
  try {
    wbSubs = await listWordbookSubs();
    wbUserBooks = await listUserBooks();
    wbProgress = new Map((await listBookProgress()).map((p) => [p.lemma, p]));
    for (const s of wbSubs) if (!isUserBookId(s.bookId) && !wbBooks.has(s.bookId)) wbBooks.set(s.bookId, await loadWordbook(s.bookId));
    await primeBookLevels(wbSubs.map((s) => s.bookId));
    if (wordsState.scope !== 'mine' && !reviewPool.length) await loadReviewPool();
    rebuildWordsContext();
  } catch (err) {
    console.warn('[words] word books unavailable', err);
  }
}

/** The entries the current scope reviews: My words, or the scope's book words. */
function scopePool(): Array<VocabEntry | ReturnType<typeof bookEntry>> {
  if (wordsState.scope === 'mine' || !wordsState.ctx) return reviewPool;
  return scopeEntries(wordsState.scope, wordsState.ctx);
}

/** Looks up a book word's meaning and keeps it with the word's book progress. */
async function fetchBookMeaning(lemma: string): Promise<void> {
  const key = lemma.toLowerCase();
  if (wbMeaningInFlight.has(key)) return;
  wbMeaningInFlight.add(key);
  try {
    const res = await dictionaryService.lookup(lemma, prefs.targetLang, dictionaryService.getEnabledSources(), {
      translationProvider: prefs.translationProvider,
    });
    const payload = vocabPayloadFromResult(res, lemma);
    const meaning = { definition: payload.definition, reading: payload.reading, partOfSpeech: payload.partOfSpeech };
    await cacheBookWordMeaning(lemma, meaning);
    const prev = wbProgress.get(key);
    wbProgress.set(key, { ...(prev || { lemma: key, known: false, updatedAt: 0 }), ...meaning });
  } catch {
    /* offline: the word is asked as a flash card, and an opened row says it has no definition */
  } finally {
    wbMeaningInFlight.delete(key);
  }
}

/** Looks up the next queued book words that have no meaning yet, so their quiz can ask it. */
async function prefetchMeanings(wait = false): Promise<void> {
  const r = nbState.review;
  if (!r || wordsState.scope === 'mine') return;
  const lemmas = reviewNeedsMeaning(r, scopePool(), wait ? ROUND_WORDS : 4).filter((l) => !wbMeaningInFlight.has(l.toLowerCase()));
  if (!lemmas.length) return;
  const jobs = lemmas.map((lemma) => fetchBookMeaning(lemma));
  const done = Promise.all(jobs).then(() => {
    rebuildWordsContext();
    if (!wait && tab === 'learn' && !nbState.review?.answer) paint();
  });
  if (wait) await done;
}

function startedTodayKey(): string {
  const d = new Date();
  return `phevere.reviewStarted.${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function startedToday(): string[] {
  try {
    const list = JSON.parse(readStore(startedTodayKey()) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
let expandedVocab = new Set<string>();
let prefs: MobilePrefs = loadPrefs();
let packs: CatalogStatus[] = [];
let packMsg = '';
/** Sources, Offline and API keys state that outlives a repaint. */
const lib = emptyLibraryState();
let toastMsg = '';
let toastTimer: number | null = null;
/** What the toast's Undo button does, when it has one. */
let toastUndo: (() => void) | null = null;
let capture: CaptureInfo = { platform: 'web', canDrawOverlays: false };
/** The Android updater in the full app; null on iOS, in the pop-up and in the browser. */
let phoneUpdates: PhoneUpdater | null = null;
let accountState: AccountState | null = null;
/** The account sheet is open from the app bar. */
let accountOpen = false;
/** The next paint opens the sheet, so it slides in; later repaints keep it still. */
let accountSheetEntering = false;
/** Delete account is waiting for the server. */
let accountDeleteBusy = false;
/** The account sheet is asking for the email to confirm deletion. */
let accountDeleting = false;

/** Swaps only the app-bar button, so a background sync doesn't reset scroll positions. */
function refreshAccountButton(): void {
  if (stripMode) return;
  const html = accountButtonHtml(accountState, accountOpen);
  const btn = document.querySelector('.hx-account-btn');
  if (btn) {
    if (html) btn.outerHTML = html;
    else btn.remove();
  } else if (html) {
    document.querySelector('.brand-end')?.insertAdjacentHTML('beforeend', html);
  }
}

/** What the app-bar button shows; the bar repaints only when this changes. */
function accountBadgeKey(s: AccountState | null): string {
  if (!s?.configured) return '';
  return [s.user?.email || '', s.user?.name || '', s.syncing, !!s.lastError, s.signingIn].join('|');
}
let scan: ScanPage | null = null;
/** Bumped per picture, so a repaint keeps the rendered picture (and its selection) in place. */
let scanId = 0;
type SheetState = 'closed' | 'half' | 'full';
let scanSheet: SheetState = 'closed';

const stripMode = new URLSearchParams(window.location.search).get('mode') === 'strip';
let stripExpanding = false;
if (stripMode) document.documentElement.dataset.mode = 'strip';

const history: string[] = [];
const HISTORY_CAP = 40;
let histIndex = -1;
/** A lookup opened from Words or Learn: Back returns there once the trail is back at that word. */
let lookupFrom: { tab: Tab; at: number } | null = null;

function toast(msg: string, undo?: () => void): void {
  toastMsg = msg;
  toastUndo = undo || null;
  paint();
  if (toastTimer) window.clearTimeout(toastTimer);
  // A toast with an action stays long enough to reach it.
  toastTimer = window.setTimeout(() => {
    toastMsg = '';
    toastUndo = null;
    paint();
  }, undo ? 6000 : 2400);
}

function toastHtml(): string {
  if (!toastMsg) return '';
  const action = toastUndo ? '<button type="button" class="toast__action" data-act="toast-undo">Undo</button>' : '';
  return `<div class="toast" role="status"><span class="toast__msg">${esc(toastMsg)}</span>${action}</div>`;
}

function postOsNotify(kind: 'incoming' | 'saved' | 'ocr', title: string, body: string): void {
  if (!hasNativeBridge()) return;
  if (kind === 'incoming' && !prefs.notifyIncoming) return;
  if (kind === 'saved' && !prefs.notifySaved) return;
  if (kind === 'ocr' && !prefs.notifyOcr) return;
  if (kind === 'incoming' && !stripMode && document.visibilityState === 'visible') return;
  void nativeCall('notify', { title, body }).catch(() => undefined);
}

function lookupPaneHtml(): string {
  const langs = dictionaryService.getSupportedLanguages();
  return lookupBody({
    looking,
    status,
    result,
    saved,
    resultTab,
    langs,
    sourceLang: prefs.sourceLang,
    targetLang: prefs.targetLang,
    langMenu,
    recentLangs: prefs.recentLangs || [],
    wiki,
    wikiLang: wikiLanguage(),
    wikiArticle,
    wikiLoading,
    wikiError,
    lexiconPos,
    etymologySource,
    query,
    error: lookupError,
    recent: recentLookups,
    savedFor: (q) => notebook.find((e) => e.lemma.trim().toLowerCase() === q.trim().toLowerCase()),
    headTools: !stripMode,
    // An empty list (pictures off, or a word part) keeps no picture boxes; null means loading.
    senseImages: prefs.senseImages === false || (result && morphemeOf(result)) ? [] : currentSenseImages(),
    ownWords: morphemeOf(result) ? ownWords() : undefined,
  });
}

/**
 * Saved words and the words of followed books, for a word part's "my words". Built again only
 * when the notebook or the books change, so the part page's sections stay cached across paints.
 */
let ownWordsMemo: { sig: string; words: { mine: string[]; books: string[] } } | null = null;
function ownWords(): { mine: string[]; books: string[] } {
  const bookWords = wbSubs.map((s) => wbBooks.get(s.bookId)?.length || 0).join(',');
  const sig = `${notebook.length}|${notebook[0]?.lemma || ''}|${bookWords}|${wbUserBooks.map((b) => b.words?.length || 0).join(',')}`;
  if (ownWordsMemo?.sig === sig) return ownWordsMemo.words;
  const words = {
    mine: notebook.map((e) => e.lemma),
    books: [...wbSubs.flatMap((s) => wbBooks.get(s.bookId) || []), ...wbUserBooks.flatMap((b) => b.words || [])],
  };
  ownWordsMemo = { sig, words };
  return words;
}

function senseKey(r: DictionaryResult | null): string {
  if (!r) return '';
  return `${r.word || ''}\n${lexiconSenses(r).map((d) => `${d.partOfSpeech || ''}|${d.meaning || ''}`).join('\n')}`;
}

function currentSenseImages(): Array<SenseImage | null> | null {
  if (prefs.senseImages === false || !senseImages || !result) return null;
  return senseImages.key === senseKey(result) ? senseImages.list : null;
}

/**
 * Puts loaded pictures into the painted Lexicon without repainting it (scroll stays put): into
 * the box kept for them when there is one. When the search is over (`final`), boxes that got no
 * picture are removed.
 */
function placeSenseFigures(final = false): void {
  const list = currentSenseImages();
  if (!list) return;
  // Pictures arrive in steps, and a later step can move a picture to the sense it fits better, so
  // the figures follow the latest list. A placeholder waits until the last step.
  list.forEach((img, i) => {
    const body = root.querySelector(`.definition-item[data-sense="${i}"] .definition-sense-body`);
    if (!body) return;
    const present = body.querySelector('.sense-figure');
    const pending = !!present && present.classList.contains('is-pending');
    if (!img) {
      if (present && !pending) present.remove();
      return;
    }
    if (present && !pending && present.querySelector('[data-page]')?.getAttribute('data-page') === img.pageUrl) return;
    if (present) present.outerHTML = senseFigureHtml(img, i);
    else body.insertAdjacentHTML('afterbegin', senseFigureHtml(img, i));
  });
  if (final) root.querySelectorAll('.sense-figure.is-pending').forEach((el) => el.remove());
}

/**
 * Opens a connection to the host that serves the pictures when a word is submitted, so the first
 * thumbnail does not wait for a handshake. The hint goes in again for each lookup: the WebView
 * drops a preconnected socket that stays unused for about ten seconds.
 */
function warmPictureHost(): void {
  // Only a hint: a lookup goes on without it.
  try {
    document.getElementById('pictureHostHint')?.remove();
    const link = document.createElement('link');
    link.id = 'pictureHostHint';
    link.rel = 'preconnect';
    link.href = 'https://upload.wikimedia.org';
    document.head.appendChild(link);
  } catch {
    /* no document head */
  }
}

/** Fetches pictures after the text has painted; a stale lookup's pictures are dropped. */
let senseImagesPending = '';

async function loadSenseImages(generation: number): Promise<void> {
  // A prefix or a root has no picture: one found for "shine" would illustrate the word, not the part.
  if (prefs.senseImages === false || !result || morphemeOf(result)) return;
  const key = senseKey(result);
  if (senseImages?.key === key || senseImagesPending === key) return;
  const senses = lexiconSenses(result);
  if (!senses.length) return;
  senseImagesPending = key;
  try {
    const list = await fetchSenseImages(
      result.word || query,
      senses.map((d) => ({ meaning: d.meaning, partOfSpeech: d.partOfSpeech, frequency: d.frequency })),
      {
        lang: result.detectedLanguage || 'en',
        // The first pictures go in while the slower steps look for the rest.
        onUpdate: (partial) => {
          if (generation !== lookupGeneration) return;
          senseImages = { key, list: partial };
          placeSenseFigures();
        },
      },
    );
    if (generation !== lookupGeneration) return;
    senseImages = { key, list };
    placeSenseFigures(true);
  } finally {
    if (senseImagesPending === key) senseImagesPending = '';
  }
  // The result may have been replaced (a late source) while the pictures loaded.
  if (generation === lookupGeneration && result && senseKey(result) !== key) void loadSenseImages(generation);
}

function paint(): void {
  document.documentElement.dataset.popup = prefs.floatingStrip ? 'floating' : 'half';
  document.documentElement.dataset.notify = capture.platform === 'ios' ? 'ios' : 'android';
  document.documentElement.dataset.platform = capture.platform;
  if (settingsSection === 'notifications' && capture.platform === 'web') settingsSection = 'capture';
  const canBack = histIndex > 0;
  const canFwd = histIndex >= 0 && histIndex < history.length - 1;
  const live = document.getElementById('q') as HTMLInputElement | null;
  const keepFocus = !!(live && document.activeElement === live);
  const caret = keepFocus ? live!.selectionStart : null;
  if (keepFocus) draft = live!.value;
  const nbqLive = document.getElementById('nbq') as HTMLInputElement | null;
  const keepNbq = !!(nbqLive && document.activeElement === nbqLive);
  const nbqCaret = keepNbq ? nbqLive!.selectionStart : null;
  if (keepNbq) notebookFilter = nbqLive!.value;
  const deleteLive = document.getElementById('account-delete-email') as HTMLInputElement | null;
  const typedDelete = deleteLive?.value || '';
  const keepDelete = !!(deleteLive && document.activeElement === deleteLive);
  const deleteCaret = keepDelete ? deleteLive!.selectionStart : null;
  const entering = accountSheetEntering;
  accountSheetEntering = false;
  const hit = lookupPaneHtml();
  if (tab === 'lookup' && scan) {
    paintScan(scan, hit);
    return;
  }
  const body =
    tab === 'notebook'
      ? notebookBody(notebook, notebookSort, notebookFilter, expandedVocab, { ...nbState, pool: reviewPool }, wordsState)
      : tab === 'learn'
        ? learnBody(learnViewState(), wordsState)
        : tab === 'settings'
        ? settingsBody(
            prefs,
            dictionaryService.getSourceStats().sources,
            packs,
            packMsg,
            capture,
            settingsSection,
            voice,
            lib,
            phoneUpdates?.state() ?? null,
          )
        : hit;
  const lexiconFill = tab === 'lookup' && resultTab === 'lexicon' && !!result;
  root.innerHTML = `
    <div class="shell${tab === 'settings' ? ' shell-settings' : ''}${lexiconFill ? ' shell-lexicon' : ''}${resultTab === 'wikipedia' && wikiArticle ? ' shell-wiki' : ''}">
      ${stripMode ? popupBarHtml(canBack || wikiCanBack(), canFwd, !!query) : appBarHtml(tab, draft, canBack, canFwd, accountButtonHtml(accountState, accountOpen))}
      <main class="page">${body}</main>
    </div>
    ${stripMode ? '' : navHtml(tab)}
    ${!stripMode && accountOpen && accountState?.configured ? `<div class="sheet-scrim${entering ? ' is-entering' : ''}" data-act="account-close"></div>
    <section class="account-sheet${entering ? ' is-entering' : ''}" role="dialog" aria-modal="true" aria-label="Account">
      <span class="account-sheet__grip" aria-hidden="true"></span>
      ${accountPanelHtml(accountState, { deleting: accountDeleting, device: 'phone' })}
    </section>` : ''}
    ${toastHtml()}`;
  const q = document.getElementById('q') as HTMLInputElement | null;
  if (keepFocus && q) {
    q.focus();
    if (typeof caret === 'number') q.setSelectionRange(caret, caret);
    paintSuggest();
  }
  const nbq = document.getElementById('nbq') as HTMLInputElement | null;
  if (keepNbq && nbq) {
    nbq.focus();
    if (typeof nbqCaret === 'number') nbq.setSelectionRange(nbqCaret, nbqCaret);
  }
  const deleteInput = document.getElementById('account-delete-email') as HTMLInputElement | null;
  if (deleteInput && typedDelete) {
    deleteInput.value = typedDelete;
    const confirm = document.querySelector<HTMLButtonElement>('[data-act="account-delete-confirm"]');
    if (confirm) confirm.disabled = accountDeleteBusy || !deleteEmailMatches(accountState, typedDelete);
  }
  if (deleteInput && keepDelete) {
    deleteInput.focus();
    if (typeof deleteCaret === 'number') deleteInput.setSelectionRange(deleteCaret, deleteCaret);
  }
  bindLexiconPane();
  bindWikiReader();
  bindMockBar();
  bindAzRail();
  // A repaint replaces the map's element; release the old 3D renderer straight away.
  disposeNotebookMaps(true);
  if (tab === 'notebook' || tab === 'learn') revealWordsScope();
  if (tab === 'notebook') bindNotebookViews();
  if (tab === 'learn') bindLearn();
  lib.inspectorEntering = false;
  if (lib.highlightKey && tab === 'settings' && settingsSection === 'api') {
    const card = document.querySelector(`.sv-key[data-provider="${CSS.escape(lib.highlightKey)}"]`);
    card?.scrollIntoView({ block: 'center' });
    lib.highlightKey = '';
  }
}

/** The Learn tab's state, starting today's session for the chosen list when there is none. */
function learnViewState(): LearnState {
  if (!nbState.review && wordsState.ctx) {
    nbState.review = startScopeReview(wordsState.scope, wordsState.ctx, { mineGoal: nbState.goal, mineStartedToday: startedToday().length });
  }
  if (!nbState.review && reviewPool.length) nbState.review = startReview(reviewPool, nbState.goal, Date.now(), startedToday().length);
  return {
    review: nbState.review || startReview([], nbState.goal),
    goal: nbState.goal,
    pool: reviewPool,
    reviewOptions: { audio: prefs.audioEnabled !== false, preview: previewReview, formatGap: formatReviewGap, examples: (lemma) => reviewExamples.get(lemma.toLowerCase()) },
    page: learnPage,
    history: answerHistory,
    notice: plusNoticeHtml(accountState, HOLARKY_ACCOUNT.plusUrl, 'learn'),
  };
}

async function loadReviewPool(): Promise<void> {
  try {
    reviewPool = await listVocab(100_000);
  } catch {
    reviewPool = notebook;
  }
}

function bindNotebookViews(): void {
  const page = document.querySelector('.nbv-body');
  if (!page) return;
  attachNotebookMap(page);
  attachFamilies(page);
  if (nbState.view === 'families') {
    // Families groups the whole notebook (the review pool), not just the list's first page.
    const words = reviewPool.length > notebook.length ? reviewPool : notebook;
    traceNotebookFamilies(
      words.map((e) => String(e.lemma || '')),
      () => document.querySelector('.nbv-body'),
      () => {
        if (tab === 'notebook' && nbState.view === 'families' && !document.querySelector('.nbv-body details[open]')) paint();
      },
    );
  }
  attachCardTable(page, {
    onLayout: (layout) => {
      nbState.cardLayout = layout;
      writeStore(NB_CARDS_KEY, layout);
    },
  });
  if (prefs.senseImages !== false) {
    fillWordImages(page, (lemma, lang, gloss, pos, onPicture) => fetchWordImage(lemma, { lang, gloss, pos, onUpdate: onPicture }));
  }
}

function bindLearn(): void {
  const page = document.querySelector<HTMLElement>('.lrn-body');
  if (!page) return;
  attachLearnCharts(page);
  if (learnPage === 'progress') {
    if (!answerHistory) void loadAnswerHistory().then(() => tab === 'learn' && learnPage === 'progress' && paint());
    return;
  }
  if (prefs.senseImages !== false) {
    fillWordImages(page, (lemma, lang, gloss, pos, onPicture) => fetchWordImage(lemma, { lang, gloss, pos, onUpdate: onPicture }));
  }
  focusReview(page);
  void prefetchMeanings();
  void prefetchExamples();
}

/** Keeps the chosen list (or Add a word book) visible in the scrolling switcher. */
function revealWordsScope(): void {
  const chip = document.querySelector<HTMLElement>('.wb-scope.is-active');
  const bar = chip?.parentElement;
  if (!chip || !bar) return;
  const left = chip.offsetLeft - bar.offsetLeft;
  if (left < bar.scrollLeft || left + chip.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = left - 16;
}

/** After a Review paint: the answer box gets the cursor, a listening question plays once. */
let reviewAutoplayed = '';
function focusReview(page: HTMLElement): void {
  page.querySelector<HTMLInputElement>('#nbv-answer')?.focus();
  // A new question starts with its progress bar and instruction below the sticky app bar.
  revealQuestion(page, document.querySelector('.top'));
  // After an answer, bring Continue into view with the verdict and the word above it.
  page.querySelector<HTMLElement>('.nbv-quiz__grade')?.scrollIntoView({ block: 'nearest' });
  const listen = page.querySelector<HTMLElement>('[data-autoplay]');
  const key = listen && nbState.review ? `${nbState.review.index}:${listen.dataset.autoplay}` : '';
  if (!listen || key === reviewAutoplayed || !prefs.audioEnabled) return;
  reviewAutoplayed = key;
  const btn = listen.querySelector<HTMLElement>('[data-act="nb-play"]');
  if (btn) void pulseSpeak(btn, playLemma(listen.dataset.autoplay || ''));
}

function answerCurrentReview(input: { choice?: number; typed?: string; knew?: boolean }): void {
  if (!nbState.review || !answerReview(nbState.review, input)) return;
  paint();
}

/** Saves the answered question's grade and moves to the next one. */
async function commitReview(): Promise<void> {
  const r = nbState.review;
  const q = r?.question;
  const a = r?.answer;
  if (!r || !q || !a || grading) return;
  grading = true;
  const entry = reviewPool.find((e) => e.id === q.id);
  if (entry && isNewWord(entry)) {
    writeStore(startedTodayKey(), JSON.stringify([...new Set([...startedToday(), q.id])]));
  }
  let updated: VocabEntry | ReturnType<typeof bookEntry> | null = null;
  const details = reviewAnswerDetails(r, wordsState.scope, wordsState.ctx);
  try {
    if (isBookOnlyId(q.id)) {
      // A book word that is not in My words: progress goes to the book_words table.
      const p = await reviewBookWord(q.lemma, a.grade, Date.now(), details);
      wbProgress.set(p.lemma, p);
      rebuildWordsContext();
      updated = wordsState.ctx ? bookEntry(q.lemma, wordsState.ctx) : null;
    } else {
      const saved = await reviewVocab(q.id, a.grade, Date.now(), details);
      updated = saved;
      if (saved) {
        notebook = notebook.map((e) => (e.id === q.id ? saved : e));
        reviewPool = reviewPool.map((e) => (e.id === q.id ? saved : e));
        rebuildWordsContext();
      }
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
  advanceReview(r, updated);
  answerHistory = null;
  grading = false;
  paint();
}

function wikiLanguage(): string {
  const lang = result?.detectedLanguage || prefs.wikiLang || 'en';
  return lang === 'zh' || lang === 'ja' || lang === 'ko' ? lang : 'en';
}

async function loadWikiHits(term: string): Promise<void> {
  const generation = lookupGeneration;
  wikiLoading = true;
  wikiError = '';
  try {
    const hits = (await wikipediaService.searchHits(term, wikiLanguage(), 5)).results || [];
    if (generation !== lookupGeneration) return;
    wiki = hits;
  } catch (err) {
    if (generation !== lookupGeneration) return;
    wiki = [];
    wikiError = err instanceof Error ? err.message : String(err);
  } finally {
    if (generation === lookupGeneration) wikiLoading = false;
  }
}

function titleMatchesQuery(title: string): boolean {
  const a = title.replace(/_/g, ' ').trim().toLowerCase();
  const b = (result?.word || query).replace(/_/g, ' ').trim().toLowerCase();
  return !!a && a === b;
}

async function maybeAutoOpenWiki(): Promise<void> {
  if (wikiListOnly || wikiArticle || !wiki.length) return;
  const exact = wiki.find((w) => titleMatchesQuery(w.title));
  const item = wiki.length === 1 ? wiki[0] : exact;
  if (item) await openWikiArticle(item);
}

async function openWikiArticle(item: WikipediaResult, fromReader = false): Promise<void> {
  const lang = item.language || wikiLanguage();
  if (fromReader && wikiArticle?.html) wikiStack.push(wikiArticle);
  else if (!fromReader) wikiStack = [];
  const token = ++wikiFetch;
  wikiArticle = { title: item.title, url: item.url, html: '', lang };
  wikiLoading = true;
  wikiError = '';
  paint();
  try {
    const html = await wikipediaService.fetchArticleHtml(item.title, lang);
    if (token !== wikiFetch) return;
    wikiArticle = { title: item.title, url: item.url, html, lang };
  } catch (err) {
    if (token !== wikiFetch) return;
    wikiError = err instanceof Error ? err.message : String(err);
  } finally {
    if (token !== wikiFetch) return;
    wikiLoading = false;
    paint();
  }
}

const WIKI_RESERVED_NS = new Set([
  'file',
  'image',
  'special',
  'help',
  'wikipedia',
  'template',
  'category',
  'mediawiki',
  'portal',
  'draft',
  'module',
  'timedtext',
  'user',
  'talk',
  'wt',
  'media',
]);

function wikiLangFromHost(host: string): string | null {
  const m = host.match(/^([a-z0-9.-]+)\.wikipedia\.org$/i);
  if (!m) return null;
  const sub = m[1].toLowerCase();
  if (sub === 'www' || sub === 'm') return 'en';
  return sub.split('.')[0] || null;
}

function openExternal(url: string): void {
  if (hasNativeBridge()) void nativeCall('openUrl', { url });
  else window.open(url, '_blank');
}

function scrollWikiHash(doc: Document, hash: string): void {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  if (!id) return;
  const el = doc.getElementById(id) || doc.getElementsByName(id)[0];
  el?.scrollIntoView({ block: 'start' });
}

function bindWikiReader(): void {
  const frame = document.getElementById('wiki-frame') as HTMLIFrameElement | null;
  if (!frame || !wikiArticle?.html) return;
  const article = wikiArticle;
  const base = `https://${article.lang || wikiLanguage()}.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`;
  let bound = false;
  const onReady = (): void => {
    if (bound) return;
    const doc = frame.contentDocument;
    if (!doc) return;
    bound = true;
    doc.addEventListener('click', (ev) => {
      const a = (ev.target as HTMLElement | null)?.closest?.('a');
      if (!a) return;
      const raw = a.getAttribute('href') || '';
      if (!raw || raw.toLowerCase().startsWith('javascript:')) {
        ev.preventDefault();
        return;
      }
      if (raw.startsWith('#')) {
        ev.preventDefault();
        scrollWikiHash(doc, raw);
        return;
      }
      let abs: URL;
      try {
        abs = new URL(raw, base);
      } catch {
        ev.preventDefault();
        return;
      }
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') {
        ev.preventDefault();
        return;
      }
      try {
        const cur = new URL(article.url);
        if (abs.origin === cur.origin && abs.pathname === cur.pathname && abs.hash) {
          ev.preventDefault();
          scrollWikiHash(doc, abs.hash);
          return;
        }
      } catch {
        /* ignore */
      }
      const lang = wikiLangFromHost(abs.hostname);
      const pathMatch = abs.pathname.match(/^\/wiki\/([^/]+)$/);
      if (lang && pathMatch) {
        const title = decodeURIComponent(pathMatch[1].replace(/_/g, ' '));
        const ns = title.includes(':') ? title.split(':')[0] : '';
        if (ns && WIKI_RESERVED_NS.has(ns.toLowerCase())) {
          ev.preventDefault();
          openExternal(abs.toString());
          return;
        }
        ev.preventDefault();
        void openWikiArticle(
          { title, extract: '', url: abs.toString(), language: lang, pageId: 0 },
          true,
        );
        return;
      }
      ev.preventDefault();
      openExternal(abs.toString());
    });
  };
  frame.addEventListener('load', onReady, { once: true });
  frame.srcdoc = article.html;
  if (frame.contentDocument?.readyState === 'complete' && frame.contentDocument.body?.childNodes.length) {
    onReady();
  }
}

async function refreshNotebook(): Promise<void> {
  try {
    // Every word: the list, its search and count, and the saved marks in books all need them.
    notebook = await listVocab(100_000);
    reviewPool = notebook;
  } catch (err) {
    status = err instanceof Error ? err.message : String(err);
  }
  await refreshWords();
}

async function refreshPacks(): Promise<void> {
  try {
    packs = await listCatalogStatus();
    await markInstalledPacksOnCore();
  } catch {
    packs = [];
  }
}

async function lookup(raw: string, fromHist = false, keepTab?: ResultTab): Promise<void> {
  const q = extractLookupQuery(raw);
  if (!q) return;
  const generation = ++lookupGeneration;
  query = q;
  draft = q;
  tab = 'lookup';
  looking = true;
  status = '';
  lookupError = '';
  result = null;
  saved = null;
  wiki = [];
  wikiArticle = null;
  wikiStack = [];
  wikiFetch += 1;
  wikiError = '';
  wikiListOnly = false;
  wikiLoading = false;
  resultTab = keepTab || 'lexicon';
  lexiconPos = '';
  etymologySource = '';
  lexiconWord = q;
  if (!fromHist) {
    rememberLookup(q);
    rememberRecent(q);
  }
  paint();
  // The word's pictures are gathered while the dictionaries answer, apart from the senses.
  if (prefs.senseImages !== false) {
    prefetchSenseImages(q, { lang: prefs.sourceLang === 'auto' ? 'en' : prefs.sourceLang });
    warmPictureHost();
  }
  const enabled = dictionaryService.getEnabledSources();
  let settled = false;
  try {
    const next = await dictionaryService.lookup(q, prefs.targetLang, enabled, {
      translationProvider: prefs.translationProvider,
      sourceLanguage: prefs.sourceLang === 'auto' ? undefined : prefs.sourceLang,
      onUpdate: (partial) => {
        if (generation !== lookupGeneration) return;
        result = partial;
        looking = false;
        paint();
        // Pictures go in as soon as there are senses to match them to; a later source that
        // changes the sense list is matched again from the same pool, without new requests.
        void loadSenseImages(generation);
      },
    });
    if (generation !== lookupGeneration) return;
    result = next;
    settled = true;
    prefetchRecorded(next);
    const nextSaved = await findByLemma(saveLemma(next)).catch(() => null);
    if (generation !== lookupGeneration) return;
    saved = nextSaved;
    void loadSenseImages(generation);
    // A word part has no Wikipedia article ("*ten-" is not Ten (number)).
    if (morphemeOf(next)) {
      if (resultTab === 'translation' || resultTab === 'wikipedia') resultTab = 'lexicon';
      return;
    }
    void loadWikiHits(next.word || q).then(() => {
      if (tab === 'lookup' && resultTab === 'wikipedia') {
        void maybeAutoOpenWiki().then(() => paint());
      }
    });
  } catch (err) {
    if (generation !== lookupGeneration) return;
    lookupError = err instanceof Error ? err.message : String(err);
  } finally {
    if (generation === lookupGeneration) {
      looking = false;
      paint();
    }
  }
}

/**
 * Where the latest selection lookup came from, as the Android shell reported it: the launching
 * app's name, and a page title or URL when the LSPosed module read one. A save of that word keeps it.
 */
let incomingSource: { text: string; context: SourceContext; at: number } | null = null;
const INCOMING_SOURCE_MS = 30 * 60 * 1000;

async function takeIncomingSource(): Promise<void> {
  if (capture.platform !== 'android' || !hasNativeBridge()) return;
  try {
    const hint = await nativeCall<{ text?: string | null; source?: unknown }>('takeSourceHint', {}, 3000);
    const context = normalizeSourceContext(hint?.source);
    if (hint?.text && context) incomingSource = { text: hint.text, context, at: Date.now() };
  } catch {
    /* an older shell has no hint */
  }
}

function sourceForSave(lemma: string): SourceContext | undefined {
  const src = incomingSource;
  if (!src || Date.now() - src.at > INCOMING_SOURCE_MS || !lookupTextMatches(src.text, lemma)) return undefined;
  return src.context;
}

async function saveCurrent(): Promise<void> {
  if (!result) return;
  const lemma = saveLemma(result);
  try {
    if (saved) {
      await removeVocab(saved.id);
      saved = null;
      toast('Removed from My words');
    } else {
      // resolveForm: a tap before the page turns from "geese" to goose still saves goose.
      const payload = { ...vocabPayloadFromResult(result, lemma), context: sourceForSave(lemma), resolveForm: true };
      saved = await addVocab(payload);
      toast('Saved to My words');
      postOsNotify('saved', 'Saved to My words', lemma);
    }
  } catch (err) {
    toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
  }
  await refreshNotebook();
  paint();
}

/**
 * Scan repaints only the sheet: rebuilding the picture would drop the reader's selection,
 * zoom and pan every time a lookup updates.
 */
function paintScan(page: ScanPage, hit: string): void {
  let view = root.querySelector<HTMLElement>('.scan-view');
  if (!view || view.dataset.scanId !== String(scanId)) {
    root.innerHTML = scanHtml(page, scanId);
    view = root.querySelector<HTMLElement>('.scan-view')!;
    bindScanViewer(view);
  }
  const sheet = view.querySelector<HTMLElement>('.scan-sheet')!;
  sheet.dataset.state = scanSheet;
  view.dataset.sheet = scanSheet;
  const body = view.querySelector<HTMLElement>('.scan-sheet__body')!;
  body.innerHTML = scanSheet === 'closed' ? '' : hit;
  view.querySelector<HTMLElement>('.scan-toast')!.innerHTML = toastHtml();
  bindLexiconPane();
  bindWikiReader();
}

/** Keep the looked-up words highlighted after the system selection goes away. */
function markScanPick(): void {
  const sel = window.getSelection();
  const layer = root.querySelector('.scan-layer');
  if (!sel || !sel.rangeCount || !layer || !layer.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
  const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const Hl = (window as unknown as { Highlight?: new (r: Range) => unknown }).Highlight;
  if (reg && Hl) reg.set('scan-pick', new Hl(sel.getRangeAt(0).cloneRange()));
}

function clearScanPick(): void {
  (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete('scan-pick');
}

/** Look up where the text is: in the pop-up itself, or in the Scan sheet. */
function lookupInPlace(text: string): void {
  const q = extractLookupQuery(text);
  if (!q) return;
  if (scan) {
    markScanPick();
    if (scanSheet === 'closed') scanSheet = 'half';
  }
  void lookup(q);
}

/** Fit each invisible word over its box: font size from the box height, width by scaleX. */
function fitScanWords(frame: HTMLElement): void {
  const width = frame.clientWidth;
  frame.querySelectorAll<HTMLElement>('.scan-word').forEach((el) => {
    const h = el.offsetHeight;
    el.style.fontSize = `${Math.max(4, h * 0.82)}px`;
    el.style.lineHeight = `${h}px`;
    el.style.transform = '';
    const natural = el.offsetWidth;
    const target = Number(el.dataset.w || 0) * width;
    if (natural > 0 && target > 0) el.style.transform = `scaleX(${target / natural})`;
  });
}

/**
 * Picture viewer: fit to the screen, pinch to zoom (1-6x), drag to pan when zoomed, double-tap
 * to zoom in or out. A still long press is left to the browser, which selects text.
 * The bottom sheet's handle drags between closed, half and full.
 */
function bindScanViewer(view: HTMLElement): void {
  const stage = view.querySelector<HTMLElement>('.scan-stage')!;
  const canvas = view.querySelector<HTMLElement>('.scan-canvas')!;
  const frame = view.querySelector<HTMLElement>('.scan-frame')!;
  const ratio = Number(frame.dataset.ratio) || 0.75;
  let s = 1, x = 0, y = 0;
  const apply = () => { canvas.style.transform = `translate(${x}px, ${y}px) scale(${s})`; };
  const clamp = () => {
    const W = stage.clientWidth, H = stage.clientHeight;
    const fw = frame.offsetWidth * s, fh = frame.offsetHeight * s;
    const ox = frame.offsetLeft * s, oy = frame.offsetTop * s;
    x = fw <= W ? (W - fw) / 2 - ox : Math.min(-ox, Math.max(W - fw - ox, x));
    y = fh <= H ? (H - fh) / 2 - oy : Math.min(-oy, Math.max(H - fh - oy, y));
  };
  const layout = () => {
    const W = stage.clientWidth, H = stage.clientHeight;
    const fw = Math.min(W, H * ratio);
    frame.style.width = `${fw}px`;
    frame.style.height = `${fw / ratio}px`;
    fitScanWords(frame);
    clamp();
    apply();
  };
  const zoomAt = (px: number, py: number, next: number) => {
    const r = stage.getBoundingClientRect();
    const cx = px - r.left, cy = py - r.top;
    next = Math.max(1, Math.min(6, next));
    x = cx - ((cx - x) * next) / s;
    y = cy - ((cy - y) * next) / s;
    s = next;
    clamp();
    apply();
  };
  layout();
  new ResizeObserver(layout).observe(stage);

  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; s: number } | null = null;
  let pan: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  let tapTimer = 0;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  stage.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { pinch = { d: dist(), s }; pan = null; }
    else if (pts.size === 1) pan = { x: e.clientX, y: e.clientY, ox: x, oy: y, moved: false };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const m = mid();
      zoomAt(m.x, m.y, (pinch.s * dist()) / pinch.d);
    } else if (pan && s > 1) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) < 8) return;
      pan.moved = true;
      x = pan.ox + dx;
      y = pan.oy + dy;
      clamp();
      apply();
    }
  });
  const up = (e: PointerEvent) => {
    const wasPan = pan?.moved;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      if (!wasPan && e.type === 'pointerup') {
        const now = Date.now();
        if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
          window.clearTimeout(tapTimer);
          zoomAt(e.clientX, e.clientY, s > 1.2 ? 1 : 2.5);
          lastTap = { t: 0, x: 0, y: 0 };
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
          // A plain tap on the picture (not a double tap, not a selection) puts the panel away.
          window.clearTimeout(tapTimer);
          tapTimer = window.setTimeout(() => {
            if (scanSheet !== 'closed' && !(window.getSelection()?.toString() || '').trim()) setScanSheet('closed');
          }, 320);
        }
      }
      pan = null;
    }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  // The panel shares the screen with the picture: dragging its handle changes its height, the
  // picture's area shrinks or grows with it, and the picture re-fits (ResizeObserver above).
  const sheet = view.querySelector<HTMLElement>('.scan-sheet')!;
  const handle = view.querySelector<HTMLElement>('.scan-sheet__handle')!;
  let drag: { id: number; y: number; h: number; moved: boolean } | null = null;
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, y: e.clientY, h: sheet.offsetHeight, moved: false };
    view.classList.add('is-dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 6) drag.moved = true;
    const max = view.clientHeight - 96;
    sheet.style.height = `${Math.max(0, Math.min(max, drag.h - dy))}px`;
  });
  // Every way a drag can end (release, cancel, lost capture) settles on a state and clears the
  // inline height, so the panel can never be left half-drawn.
  const release = (e: PointerEvent) => {
    if (!drag) return;
    const moved = drag.moved;
    const h = sheet.offsetHeight;
    drag = null;
    view.classList.remove('is-dragging');
    sheet.style.height = '';
    if (e.type !== 'pointerup') { paint(); return; }
    const vh = view.clientHeight;
    const next: SheetState = !moved
      ? (scanSheet === 'full' ? 'half' : 'full')
      : h < vh * 0.22 ? 'closed' : h < vh * 0.66 ? 'half' : 'full';
    setScanSheet(next);
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
  handle.addEventListener('lostpointercapture', release);
}

function setScanSheet(next: SheetState): void {
  if (next === 'closed') clearScanPick();
  scanSheet = next;
  paint();
}

async function runOcr(): Promise<void> {
  if (!hasNativeBridge()) {
    toast('Scanning requires the Android or iOS app.');
    return;
  }
  try {
    const res = await nativeCall<ScanPage>('scanOcr', {});
    if (!res?.jpeg) {
      toast('No picture');
      return;
    }
    scanId += 1;
    scanSheet = 'closed';
    clearScanPick();
    scan = {
      jpeg: res.jpeg,
      width: Number(res.width) || 0,
      height: Number(res.height) || 0,
      words: Array.isArray(res.words) ? res.words : [],
    };
    tab = 'lookup';
    postOsNotify('ocr', 'Scan finished', scan.words.length ? `${scan.words.length} words` : 'No text');
    paint();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not scan';
    if (msg === 'Cancelled' || msg === 'No photo' || msg === 'No image') return;
    toast(msg);
  }
}

/**
 * Hides a picture the reader marked as wrong: it never shows again on this sense, and the senses
 * are matched again (another fitting picture may take its place, or none). The toast's Undo
 * brings it back.
 */
async function hideSensePicture(frame: HTMLElement): Promise<void> {
  if (!result) return;
  const figure = frame.closest<HTMLElement>('.sense-figure');
  const index = Number(figure?.dataset.senseFigure ?? -1);
  const sense = lexiconSenses(result)[index];
  const word = result.word || query;
  const picture = { pageUrl: frame.dataset.page || '' };
  const opts = { lang: result.detectedLanguage || 'en', sense: sense?.meaning };
  const generation = lookupGeneration;
  await hideSenseImage(word, picture, opts);
  figure?.remove();
  senseImages = null;
  void loadSenseImages(generation);
  toast('Picture hidden', () => {
    void unhideSenseImage(word, picture, opts).then(() => {
      if (generation !== lookupGeneration) return;
      senseImages = null;
      void loadSenseImages(generation);
    });
  });
}

/** A sense picture at its larger size over the page; a tap outside the credit, or Back, closes it. */
function openSensePicture(frame: HTMLElement): void {
  const d = frame.dataset;
  const dlg = document.createElement('dialog');
  dlg.className = 'pic-view';
  dlg.innerHTML = `<img class="pic-view__img" src="${esc(d.thumb || '')}" alt="${esc(d.title || '')}" referrerpolicy="no-referrer" tabindex="-1" autofocus />
    <p class="pic-view__cap"><span>${esc(d.title || '')}</span>${d.page ? `<button type="button" class="pic-view__credit" data-pic-credit="${esc(d.page)}">${esc(d.credit || 'Wikimedia Commons')}</button>` : ''}</p>
    ${d.page ? '<button type="button" class="pic-view__hide" data-pic-hide>Hide picture</button>' : ''}`;
  // The thumbnail shows at once; the larger rendering replaces it when it has arrived.
  const img = dlg.querySelector('img') as HTMLImageElement;
  const full = new Image();
  full.referrerPolicy = 'no-referrer';
  full.onload = () => (img.src = full.src);
  full.src = d.full || '';
  dlg.addEventListener('click', (e) => {
    e.stopPropagation();
    const link = (e.target as HTMLElement).closest<HTMLElement>('[data-pic-credit]');
    if (link) openExternal(link.dataset.picCredit || '');
    else if ((e.target as HTMLElement).closest('[data-pic-hide]')) {
      dlg.close();
      void hideSensePicture(frame);
    } else dlg.close();
  });
  dlg.addEventListener('cancel', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
}

/**
 * A small choice sheet over the app: a message, a line of detail and one button per answer.
 * Resolves with the chosen button's index, or -1 when dismissed.
 */
function askChoice(message: string, detail: string, buttons: string[]): Promise<number> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'pv-choice nbv';
    dlg.innerHTML = `<p class="pv-choice__msg">${esc(message)}</p>${detail ? `<p class="pv-choice__detail">${esc(detail)}</p>` : ''}<div class="pv-choice__btns">${buttons
      .map((b, i) => `<button type="button" class="${i === 0 ? 'nbv-primary' : 'nbv-secondary'}" data-i="${i}">${esc(b)}</button>`)
      .join('')}</div>`;
    const done = (i: number) => {
      dlg.close();
      dlg.remove();
      resolve(i);
    };
    dlg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (b) done(Number(b.dataset.i));
      else if (e.target === dlg) done(-1);
    });
    dlg.addEventListener('cancel', () => done(-1));
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** The book Words is showing, as an export scope. */
function exportScope(): BookScope {
  const s = wordsState.scope;
  if (s === 'mine' || s === 'all' || s === 'sources' || wordsState.library) return { kind: 'mine' };
  return isUserBookId(s) ? { kind: 'user', id: s } : { kind: 'catalog', id: s };
}

async function exportWords(): Promise<void> {
  const pick = await askChoice('Export this book', '', ['Phevere book', 'For Anki', 'Cancel']);
  if (pick !== 0 && pick !== 1) return;
  try {
    const name = await exportBook(exportScope(), pick === 1);
    toast(`Saved ${name}`);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not export');
  }
}

async function pickAndImportNotebook(): Promise<void> {
  try {
    let name = 'notebook.json';
    let text = '';
    let b64 = '';
    if (hasNativeBridge()) {
      const res = await nativeCall<{ name?: string; text?: string; b64?: string }>('pickFile', { mime: '*/*' });
      name = res.name || name;
      text = res.text || '';
      b64 = res.b64 || '';
    } else {
      text = await pickLocalFile();
      name = lastPickedName || name;
    }
    if (!text && !b64) return;
    const payload = await bookPayloadFromPicked(name, b64, text);
    if (!payload) {
      // An export from before word book files: rows of My words.
      const out = await importNotebookText(name, text);
      await refreshNotebook();
      toast(`Imported ${out.imported}. Skipped ${out.skipped}.`);
      paint();
      return;
    }
    let mode: 'replace' | 'keep-both' = 'keep-both';
    const conflict = await findBookConflict(payload);
    if (conflict && payload.book.kind === 'user') {
      const pick = await askChoice(
        `You already have a book named “${conflict.title}”.`,
        `Replace overwrites its word list with this file's. Keep both adds this one as “${conflict.title} (2)”. Progress is merged either way.`,
        ['Keep both', 'Replace', 'Cancel'],
      );
      if (pick !== 0 && pick !== 1) return;
      mode = pick === 1 ? 'replace' : 'keep-both';
    } else if (conflict) {
      const pick = await askChoice(`You already added “${conflict.title}”.`, "This file's progress is merged into it.", ['Merge progress', 'Cancel']);
      if (pick !== 0) return;
    }
    const result = await importBookPayload(payload, mode);
    await refreshNotebook();
    await refreshWords();
    wordsState.scope = result.kind === 'mine' ? 'mine' : result.bookId;
    wordsState.library = false;
    toast(result.kind === 'mine' ? `${result.added} new in My words` : `Imported ${result.title}: ${result.words} words`);
    paint();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not import');
  }
}

let lastPickedName = '';
function pickLocalFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pvbook,.apkg,.json,.csv,.tei,.txt,.u8';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve('');
        return;
      }
      lastPickedName = file.name;
      file.text().then(resolve, reject);
    };
    input.click();
  });
}

async function downloadPack(id: string): Promise<void> {
  const item = packs.find((p) => p.id === id);
  if (!item || lib.packProgress) return;
  if (!window.confirm(item.consent)) return;
  packMsg = '';
  lib.packProgress = { id, fraction: null, label: 'Downloading…' };
  paint();
  let lastPaint = 0;
  try {
    const out = await downloadCatalogPack(id, (msg) => {
      // "Importing 1200 of 23000…" carries a fraction; the other steps have no size.
      const m = msg.match(/^Importing (\d+) of (\d+)/);
      const now = Date.now();
      if (m && now - lastPaint < 120) return;
      lastPaint = now;
      lib.packProgress = {
        id,
        fraction: m ? Number(m[1]) / Math.max(1, Number(m[2])) : null,
        label: m ? `Importing ${Number(m[1]).toLocaleString('en-US')} of ${Number(m[2]).toLocaleString('en-US')}` : msg,
      };
      paint();
    });
    packMsg = `Installed ${item.name}, ${out.count.toLocaleString('en-US')} entries`;
    await refreshPacks();
    if (lib.inspecting === id) await loadPackDetails(id);
  } catch (err) {
    packMsg = err instanceof Error ? err.message : String(err);
  }
  lib.packProgress = null;
  paint();
}

async function loadPackDetails(id: string): Promise<void> {
  const p = packs.find((x) => x.id === id);
  if (!p?.installed) return;
  try {
    lib.packDetails.set(id, { installedBytes: await packStorageBytes(id) });
  } catch {
    /* the sheet shows what the catalog knows */
  }
}

/** Store one key field and hand it to the dictionary service, so clearing a field takes effect too. */
function saveKeyField(pref: string, value: string, provider: string): void {
  (prefs as unknown as Record<string, unknown>)[pref] = value.trim();
  savePrefs(prefs);
  dictionaryService.setApiCredential(pref, value.trim());
  lib.keyResults.delete(provider);
}

function patchKeyCard(provider: string): void {
  const card = document.querySelector(`.sv-key[data-provider="${CSS.escape(provider)}"]`);
  const info = API_PROVIDERS.find((p) => p.id === provider);
  if (!card || !info) return;
  const result = lib.keyResults.get(provider);
  patchApiKeyCard(card, info, {
    status: result?.status || (keyPresent(prefs, info.id) ? 'saved' : 'unset'),
    message: result?.message,
  });
}

function persistPrefs(): void {
  savePrefs(prefs);
  applyPrefsToCore(prefs);
}

async function refreshVoice(): Promise<void> {
  if (!hasNativeBridge() || capture.platform === 'web') return;
  voice = await nativeCall<VoiceStatus>('speechVoices', {}).catch(() => null);
  watchVoice();
}

/** Poll download progress while Audio settings is open. */
function watchVoice(): void {
  if (voiceTimer || !voice?.downloading) return;
  voiceTimer = window.setInterval(async () => {
    if (tab !== 'settings' || settingsSection !== 'audio') {
      window.clearInterval(voiceTimer!);
      voiceTimer = null;
      return;
    }
    voice = await nativeCall<VoiceStatus>('speechVoices', {}).catch(() => voice);
    if (!voice?.downloading) {
      window.clearInterval(voiceTimer!);
      voiceTimer = null;
    }
    paint();
  }, 1000);
}

/** Desktop lookup trail: same word replaces the current entry; capped at 40. */
function rememberLookup(q: string): void {
  // "ob-" and "ob" are two pages: the marks of a word part stay in the key.
  const fold = (v: string) => {
    const t = v.trim();
    const lead = /^[*-]/.test(t) ? t[0] : '';
    const trail = t.length > 1 && t.endsWith('-') ? '-' : '';
    return lead + t.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase() + trail;
  };
  if (histIndex >= 0 && fold(history[histIndex] || '') === fold(q)) {
    history[histIndex] = q;
    return;
  }
  history.splice(histIndex + 1);
  history.push(q);
  if (history.length > HISTORY_CAP) history.shift();
  histIndex = history.length - 1;
}

/** A new selection from outside starts a fresh trail, as in the desktop pop-up. */
function resetTrail(): void {
  history.length = 0;
  histIndex = -1;
}

function wikiCanBack(): boolean {
  return resultTab === 'wikipedia' && !!wikiArticle;
}

/** History steps keep the open tab, except Wikipedia, which returns to Lexicon. */
function trailTab(): ResultTab {
  return resultTab === 'wikipedia' ? 'lexicon' : resultTab;
}

async function setBarSlot(slot: number): Promise<void> {
  capture.barSlot = slot;
  if (hasNativeBridge()) await nativeCall('setBarSlot', { slot }).catch(() => undefined);
  paint();
}

/**
 * Notebook: pull down from the top of the list to reload it (no Refresh button). Listens on
 * document so it stays apart from the pop-up's swipe-up gesture on root.
 */
function bindPullToRefresh(): void {
  const ARM = 56;
  let startY: number | null = null;
  let pulled = 0;
  const indicator = () => document.querySelector<HTMLElement>('.ptr');
  document.addEventListener('touchstart', (e) => {
    startY = tab === 'notebook' && window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    pulled = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    const el = indicator();
    if (startY === null || !el) return;
    pulled = Math.min(72, Math.max(0, (e.touches[0].clientY - startY) * 0.5));
    el.style.height = `${pulled}px`;
    el.classList.toggle('is-armed', pulled >= ARM);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    const el = indicator();
    if (startY === null || !el) return;
    startY = null;
    if (pulled < ARM) {
      el.style.height = '0';
      return;
    }
    el.classList.add('is-loading');
    el.style.height = '48px';
    void refreshNotebook().then(() => paint());
  }, { passive: true });
}

/**
 * Drag the Phevere chip freely along the mock selection bar, like a reorderable list: the chip
 * follows the finger, the chips it passes slide aside, and the drop position becomes its slot.
 * The DOM is not reordered mid-drag, which would drop the pointer capture after one step.
 */
function bindMockBar(): void {
  const bar = document.querySelector<HTMLElement>('[data-mock-bar]');
  const chip = bar?.querySelector<HTMLElement>('[data-drag="bar-slot"]');
  if (!bar || !chip) return;
  let drag: {
    x: number; left: number; width: number; from: number; to: number; step: number;
    min: number; max: number; others: HTMLElement[]; centres: number[];
  } | null = null;
  const finish = (commit: boolean) => {
    if (!drag) return;
    const { from, to, others } = drag;
    drag = null;
    chip.classList.remove('is-dragging');
    chip.style.transform = '';
    others.forEach((n) => { n.style.transform = ''; });
    if (commit && to !== from) void setBarSlot(to);
  };
  chip.addEventListener('pointerdown', (e) => {
    const all = [...bar.querySelectorAll<HTMLElement>('.mock-bar__item')];
    const others = all.filter((n) => n !== chip);
    const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
    const from = all.indexOf(chip);
    const box = chip.getBoundingClientRect();
    drag = {
      x: e.clientX,
      left: box.left,
      width: box.width,
      from,
      to: from,
      step: box.width + gap,
      // The chip may travel from the first chip's left edge to the last chip's right edge.
      min: Math.min(box.left, ...others.map((n) => n.getBoundingClientRect().left)),
      max: Math.max(box.right, ...others.map((n) => n.getBoundingClientRect().right)),
      others,
      centres: others.map((n) => { const r = n.getBoundingClientRect(); return r.left + r.width / 2; }),
    };
    chip.setPointerCapture(e.pointerId);
    chip.classList.add('is-dragging');
  });
  chip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const d = drag;
    const dx = Math.max(d.min - d.left, Math.min(d.max - d.width - d.left, e.clientX - d.x));
    chip.style.transform = `translateX(${dx}px) scale(1.08)`;
    // The finger, not the chip's centre, picks the slot, so a narrow end chip can be passed.
    d.to = d.centres.filter((c) => c < e.clientX).length;
    d.others.forEach((n, i) => {
      // Chips between the old and new slot slide one chip-width toward the gap.
      const shift = i >= d.from && i < d.to ? -d.step : i < d.from && i >= d.to ? d.step : 0;
      n.style.transform = shift ? `translateX(${shift}px)` : '';
    });
  });
  chip.addEventListener('pointerup', () => finish(true));
  chip.addEventListener('pointercancel', () => finish(false));
}

let selectionTimer: number | null = null;

/**
 * Selecting text inside Phevere behaves like other apps: with "Pop up on selection" on, the
 * pop-up opens beside the selection (Android and iOS). Inside the pop-up, on a scan, and in the
 * browser preview it looks up in place.
 */
function onSelectionSettled(): void {
  // Switch off (default): the system selection bar and its Phevere item handle it —
  // in the app, the half-screen sheet and the floating pop-up alike.
  if (!capture.autoPopup) return;
  const sel = window.getSelection();
  const raw = (sel?.toString() || '').trim();
  if (!raw || raw.length > 200) return;
  const anchor = sel?.anchorNode;
  const el = anchor && (anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement);
  if (el?.closest('input, textarea, [contenteditable="true"]')) return;
  const q = extractLookupQuery(raw);
  if (!q || q === query) return;
  if (scan) {
    lookupInPlace(raw);
    return;
  }
  if (!stripMode && hasNativeBridge() && capture.platform !== 'web') {
    // Open the pop-up next to the selected words (CSS px; native converts to screen px).
    const box = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const rect = box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null;
    void nativeCall('openPopup', { text: q, rect }).catch(() => lookup(q));
    return;
  }
  void lookup(q);
}

/** Notebook ▶ plays the same recorded human clip as the lookup headword button. */
async function playLemma(lemma: string): Promise<void> {
  if (!lemma) return;
  if (result && result.word.toLowerCase() === lemma.toLowerCase()) {
    await playRecorded(result, prefs);
    return;
  }
  // Lookups are cached in core; a word saved earlier usually resolves without network.
  const found = await dictionaryService
    .lookup(lemma, prefs.targetLang, dictionaryService.getEnabledSources(), { skipEtymology: true })
    .catch(() => null);
  await playRecorded(found ?? { word: lemma } as DictionaryResult, prefs);
}

/** A speaker tapped with Pronunciation switched off says why nothing plays. */
function soundOff(): boolean {
  if (prefs.audioEnabled) return false;
  toast('Pronunciation is off');
  return true;
}

async function copyText(text: string): Promise<void> {
  const value = text.trim();
  if (!value) return;
  try {
    if (hasNativeBridge()) await nativeCall('copy', { text: value });
    else await navigator.clipboard.writeText(value).catch(() => {
      if (!legacyCopy(value)) throw new Error('copy');
    });
    toast('Copied');
  } catch {
    toast('Could not copy');
  }
}

/** Browser preview without clipboard permission: copy through a hidden text area. */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;opacity:0;left:-9999px';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/**
 * Notebook A–Z rail (sort A–Z): tap or drag along the letters to jump; a large letter
 * shows in the middle of the screen while the finger is down, as on desktop.
 */
function bindAzRail(): void {
  const nav = document.querySelector<HTMLElement>('[data-az-rail]');
  const hud = document.querySelector<HTMLElement>('.vocab-az-hud');
  if (!nav || !hud) return;
  const letters = [...nav.querySelectorAll<HTMLElement>('.vocab-az__letter')];
  const letterAt = (y: number): string | null => {
    const r = nav.getBoundingClientRect();
    const i = Math.max(0, Math.min(letters.length - 1, Math.floor(((y - r.top) / Math.max(r.height, 1)) * letters.length)));
    return letters[i]?.dataset.letter || null;
  };
  let current = '';
  const jump = (letter: string | null) => {
    if (!letter) return;
    hud.textContent = letter;
    hud.hidden = false;
    if (letter === current) return;
    current = letter;
    const target =
      document.querySelector<HTMLElement>(`.vocab-list [data-az="${letter}"]`) ||
      (letter === '#' ? document.querySelector<HTMLElement>('.vocab-list .vocab-item') : null);
    target?.scrollIntoView({ block: 'start' });
  };
  let scrubbing = false;
  nav.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    current = '';
    try {
      nav.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    jump((e.target as HTMLElement).closest<HTMLElement>('.vocab-az__letter')?.dataset.letter || letterAt(e.clientY));
    e.preventDefault();
  });
  nav.addEventListener('pointermove', (e) => {
    if (scrubbing) jump(letterAt(e.clientY));
  });
  const end = () => {
    scrubbing = false;
    hud.hidden = true;
  };
  nav.addEventListener('pointerup', end);
  nav.addEventListener('pointercancel', end);
  nav.addEventListener('lostpointercapture', end);
  // Keyboard and screen readers: a click on a letter jumps without the HUD.
  nav.addEventListener('click', (e) => {
    const letter = (e.target as HTMLElement).closest<HTMLElement>('.vocab-az__letter')?.dataset.letter;
    if (letter && !scrubbing) {
      current = '';
      jump(letter);
      hud.hidden = true;
    }
  });
}

function pulseSpeak(el: HTMLElement, done: Promise<void>): Promise<void> {
  document.querySelectorAll('.is-speaking').forEach((n) => n.classList.remove('is-speaking'));
  el.classList.add('is-speaking');
  const clear = () => el.classList.remove('is-speaking');
  const timeout = window.setTimeout(clear, 8000);
  return done.catch((err) => {
    toast(err instanceof Error ? err.message : 'Could not play pronunciation');
  }).finally(() => {
    window.clearTimeout(timeout);
    clear();
  });
}

function highlightLexiconPosTab(pos: string): void {
  const rootEl = document.querySelector('.lexicon-block--senses');
  if (!rootEl) return;
  rootEl.querySelectorAll('.lexicon-pos-tab').forEach((tab) => {
    const on = (tab as HTMLElement).dataset.pos === pos;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function lexiconJumpNode(rootEl: Element, pos: string): HTMLElement | null {
  let target: HTMLElement | null = null;
  rootEl.querySelectorAll('.lexicon-pos-panel [data-pos]').forEach((n) => {
    if ((n as HTMLElement).getAttribute('data-pos') === pos) target = n as HTMLElement;
  });
  return target;
}

function jumpToLexiconPos(pos: string, instant: boolean): void {
  const rootEl = document.querySelector('.lexicon-block--senses');
  if (!rootEl) return;
  const target =
    (pos ? lexiconJumpNode(rootEl, pos) : null) ||
    (rootEl.querySelector('.lexicon-pos-panel [data-pos]') as HTMLElement | null);
  if (!target) return;
  posJumpLock = true;
  const panel = rootEl.querySelector('.lexicon-pos-panel') as HTMLElement | null;
  if (panel) scrollLexiconTo(panel, target, instant);
  if (posJumpTimer) window.clearTimeout(posJumpTimer);
  posJumpTimer = window.setTimeout(() => {
    posJumpLock = false;
  }, instant ? 80 : 480);
}

let lexiconPosFrame = 0;
function scheduleLexiconPosScroll(): void {
  if (lexiconPosFrame) return;
  lexiconPosFrame = requestAnimationFrame(() => {
    lexiconPosFrame = 0;
    onLexiconPosScroll();
  });
}

function onLexiconPosScroll(): void {
  if (posJumpLock) return;
  const rootEl = document.querySelector('.lexicon-block--senses');
  if (!rootEl) return;
  const panel = rootEl.querySelector('.lexicon-pos-panel');
  const marker = (panel?.getBoundingClientRect().top || 0) + 20;
  const nodes = rootEl.querySelectorAll('.lexicon-pos-panel [data-pos]');
  let pos = nodes.length ? (nodes[0] as HTMLElement).getAttribute('data-pos') || '' : '';
  nodes.forEach((g) => {
    if ((g as HTMLElement).getBoundingClientRect().top <= marker + 36) {
      pos = (g as HTMLElement).getAttribute('data-pos') || pos;
    }
  });
  if (pos === lexiconPos) return;
  lexiconPos = pos;
  highlightLexiconPosTab(pos);
}

function sizeLexiconPane(): void {
  const layout = document.querySelector('.lexicon-pos-layout') as HTMLElement | null;
  if (!layout) return;
  // In the app's own lookup the frame is laid out by CSS (styles.css, .shell-lexicon).
  if (!stripMode && !layout.closest('.scan-sheet') && layout.closest('.shell-lexicon')) {
    layout.style.height = '';
    return;
  }
  const viewport = window.visualViewport?.height || window.innerHeight;
  const nav = document.querySelector('.nav');
  const bottom = layout.closest('.scan-sheet') ? viewport : nav ? nav.getBoundingClientRect().top : viewport;
  layout.style.height = `${Math.max(160, bottom - layout.getBoundingClientRect().top - 16)}px`;
}

function bindLexiconPane(): void {
  sizeLexiconPane();
  document.querySelector('.lexicon-pos-panel')?.addEventListener('scroll', scheduleLexiconPosScroll, { passive: true });
  if (lexiconPos) {
    highlightLexiconPosTab(lexiconPos);
    jumpToLexiconPos(lexiconPos, true);
  }
}

function onClick(e: Event): void {
  const t = (e.target as HTMLElement | null)?.closest?.('[data-act]') as HTMLElement | null;
  const act = t?.dataset.act;
  // Any tap outside the open language list closes it.
  // The language sheet is modal: taps inside it (search box, list) keep it open.
  if (langMenu && !(e.target as HTMLElement | null)?.closest?.('.lang-sheet') && act !== 'pick-open') {
    langMenu = '';
    if (!t) paint();
  }
  if (!t) return;
  void handleAct(act || '', t, e);
}

let suggestSeq = 0;
/** After a lookup is submitted, the list stays shut until the next keystroke. */
let suggestHeld = false;

/** Common words that begin with what is typed, listed under the lookup field. */
function paintSuggest(): void {
  const input = document.getElementById('q') as HTMLInputElement | null;
  const form = input?.closest('form.search');
  if (!input || !form) return;
  let list = form.querySelector<HTMLElement>('.suggest');
  const typed = input.value.trim();
  const words = document.activeElement === input && !suggestHeld ? peekSuggestions(typed, 6) : [];
  if (!words.length) {
    list?.remove();
    return;
  }
  if (!list) {
    list = document.createElement('div');
    list.className = 'suggest';
    list.setAttribute('role', 'listbox');
    // Keep the field focused while a row is pressed, so the tap lands.
    list.addEventListener('pointerdown', (ev) => ev.preventDefault());
    form.append(list);
  }
  list.innerHTML = words
    .map((w) => {
      const head = w.toLowerCase().startsWith(typed.toLowerCase()) ? typed.length : 0;
      return `<button type="button" class="suggest__row" role="option" data-act="suggest" data-word="${esc(w)}">${esc(w.slice(0, head))}<b>${esc(w.slice(head))}</b></button>`;
    })
    .join('');
}

function onQueryInput(): void {
  suggestHeld = false;
  paintSuggest();
  const input = document.getElementById('q') as HTMLInputElement | null;
  const asked = input?.value || '';
  const seq = ++suggestSeq;
  void suggestWords(asked).then(() => {
    if (seq === suggestSeq) paintSuggest();
  });
}

async function handleAct(act: string, t: HTMLElement, e: Event): Promise<void> {
  switch (act) {
    case 'toast-undo': {
      const undo = toastUndo;
      toastUndo = null;
      toastMsg = '';
      if (toastTimer) window.clearTimeout(toastTimer);
      paint();
      undo?.();
      return;
    }
    case 'account-plus': {
      // Get Plus: the system browser, not the app's WebView.
      e.preventDefault();
      const url = (t as HTMLAnchorElement).href;
      if (url) openExternal(url);
      return;
    }
    case 'tab':
      lookupFrom = null;
      tab = (['notebook', 'learn', 'settings'] as const).find((id) => id === t.dataset.tab) || 'lookup';
      if (tab === 'notebook' || tab === 'learn') await refreshNotebook();
      // Learn and every Words view but the list work on the whole notebook, not the first page of it.
      if (tab === 'learn' || (tab === 'notebook' && (nbState.view !== 'list' || wordsState.scope !== 'mine'))) {
        await loadReviewPool();
        rebuildWordsContext();
      }
      if (tab === 'settings') await refreshPacks();
      paint();
      return;
    case 'settings-section': {
      const next = t.dataset.section as SettingsSection | undefined;
      if (next === 'capture' || next === 'notifications' || next === 'sources' || next === 'offline' || next === 'api' || next === 'audio' || (next === 'updates' && phoneUpdates)) {
        settingsSection = next;
        langMenu = '';
        if (next === 'offline') await refreshPacks();
        if (next === 'audio') await refreshVoice();
        paint();
      }
      return;
    }
    case 'account-open':
      accountOpen = !accountOpen;
      accountSheetEntering = accountOpen;
      accountDeleting = false;
      paint();
      return;
    case 'account-close':
      accountOpen = false;
      accountDeleting = false;
      paint();
      return;
    case 'account-sign-in':
      await accountPlatform.signIn();
      return;
    case 'account-cancel':
      accountPlatform.cancelSignIn();
      return;
    case 'account-sync':
      await accountPlatform.syncNow();
      return;
    case 'account-sign-out':
      accountOpen = false;
      await accountPlatform.signOut();
      paint();
      return;
    case 'account-delete-start':
      accountDeleting = true;
      paint();
      (document.getElementById('account-delete-email') as HTMLInputElement | null)?.focus();
      return;
    case 'account-delete-cancel':
      accountDeleting = false;
      paint();
      return;
    case 'account-delete-confirm': {
      if (accountDeleteBusy) return;
      accountDeleteBusy = true;
      (t as HTMLButtonElement).disabled = true;
      const typed = (document.getElementById('account-delete-email') as HTMLInputElement | null)?.value || '';
      try {
        if (await accountPlatform.deleteAccount(typed)) {
          accountDeleting = false;
          accountOpen = false;
          toast('Account deleted');
        }
      } finally {
        accountDeleteBusy = false;
      }
      paint();
      return;
    }
    case 'ocr':
      await runOcr();
      return;
    case 'suggest': {
      const word = t.dataset.word || '';
      if (!word) return;
      draft = word;
      suggestHeld = true;
      suggestSeq++;
      (document.activeElement as HTMLElement | null)?.blur?.();
      await lookup(word);
      return;
    }
    case 'scan-close':
      scan = null;
      scanSheet = 'closed';
      clearScanPick();
      paint();
      return;
    case 'back':
      // Desktop order: step back inside the Wikipedia reader first, then the lookup trail.
      if (wikiCanBack()) {
        await handleAct('wiki-back', t, e);
        return;
      }
      if (histIndex > 0) {
        histIndex -= 1;
        await lookup(history[histIndex], true, trailTab());
      }
      return;
    case 'fwd':
      if (histIndex < history.length - 1) {
        histIndex += 1;
        await lookup(history[histIndex], true, trailTab());
      }
      return;
    case 'lookup': {
      // A word in running text that was selected, not tapped, stays selected.
      if (t.classList.contains('lx-w') && String(window.getSelection?.() || '').trim()) return;
      const from = tab;
      if (t.dataset.q) await lookup(t.dataset.q);
      if (from !== 'lookup' && tab === 'lookup') lookupFrom = { tab: from, at: histIndex };
      return;
    }
    case 'lex-pos': {
      const pos = t.dataset.pos || '';
      if (!pos) return;
      lexiconPos = pos;
      highlightLexiconPosTab(pos);
      jumpToLexiconPos(pos, false);
      return;
    }
    case 'result-tab':
      resultTab = (t.dataset.tab as ResultTab) || 'lexicon';
      paint();
      if (resultTab === 'wikipedia' && result) {
        if (!wiki.length) {
          await loadWikiHits(result.word || query);
          paint();
        }
        await maybeAutoOpenWiki();
      }
      return;
    case 'ety-tab': {
      const idx = Number(t.dataset.i);
      etymologySource = t.dataset.source || '';
      const rootEty = t.closest('.etymology-card') || document;
      rootEty.querySelectorAll('.etymology-tab').forEach((btn) => {
        const on = Number((btn as HTMLElement).dataset.i) === idx;
        btn.classList.toggle('is-active', on);
      });
      rootEty.querySelectorAll('[data-ety-panel]').forEach((p) => {
        (p as HTMLElement).hidden = Number((p as HTMLElement).dataset.etyPanel) !== idx;
      });
      return;
    }
    case 'ety-open': {
      const url = etymologyEntryUrl(t.dataset.url || '');
      if (url) openExternal(url);
      return;
    }
    case 'save':
      await saveCurrent();
      return;
    case 'copy':
      await copyText(result?.word || query);
      return;
    case 'web-search': {
      const term = (result?.word || query).trim();
      if (term) openExternal(`https://www.google.com/search?q=${encodeURIComponent(term)}`);
      return;
    }
    case 'speak': {
      if (soundOff()) return;
      // A recording not kept on the phone yet comes over the network: say so only if it is slow.
      const hint = (await recordedReady(result)) ? 0 : window.setTimeout(() => toast('Loading pronunciation…'), 2500);
      const started = () => window.clearTimeout(hint);
      await pulseSpeak(t, playRecorded(result, prefs, started).finally(started));
      return;
    }
    case 'speak-ipa': {
      if (soundOff()) return;
      const ipa = t.dataset.ipa || '';
      if (!ipa) return;
      const accent = t.dataset.accent;
      const p: Pronunciation = { ipa, accent: accent === 'us' || accent === 'uk' ? accent : 'other' };
      await pulseSpeak(t, speakIpa(p, prefs, result?.word).catch(() => {
        throw new Error('Could not play this IPA');
      }));
      return;
    }
    case 'speak-text':
      if (soundOff()) return;
      await pulseSpeak(t, speakText(t.dataset.text || '', prefs, t.dataset.lang));
      return;
    case 'swap': {
      const from = prefs.sourceLang;
      const to = prefs.targetLang;
      if (to !== 'auto') prefs.sourceLang = to;
      if (from !== 'auto') prefs.targetLang = from;
      persistPrefs();
      if (query) await lookup(query, true, 'translation');
      else paint();
      return;
    }
    case 'pick-open': {
      const id = t.dataset.picker as PickerId;
      langMenu = langMenu === id ? '' : id;
      paint();
      document.querySelector('.lang-sheet .is-on')?.scrollIntoView({ block: 'center' });
      return;
    }
    case 'pick-close':
      langMenu = '';
      paint();
      return;
    case 'pick': {
      const code = t.dataset.value || '';
      const id = t.dataset.picker as PickerId;
      langMenu = '';
      if (code !== 'auto') prefs.recentLangs = [code, ...(prefs.recentLangs || []).filter((c) => c !== code)].slice(0, 4);
      if (id === 'to') prefs.targetLang = code;
      else prefs.sourceLang = code;
      persistPrefs();
      if (query) await lookup(query, true, 'translation');
      else paint();
      return;
    }
    case 'wiki-open': {
      const item = wiki[Number(t.dataset.i)];
      if (item) await openWikiArticle(item);
      return;
    }
    case 'wiki-back':
      if (wikiStack.length) {
        wikiFetch += 1;
        wikiArticle = wikiStack.pop() || null;
        wikiError = '';
        wikiLoading = false;
        paint();
        return;
      }
      wikiFetch += 1;
      wikiListOnly = true;
      wikiArticle = null;
      wikiError = '';
      paint();
      return;
    case 'wiki-ext': {
      const url = t.dataset.url || wikiArticle?.url;
      if (!url) return;
      if (hasNativeBridge()) await nativeCall('openUrl', { url });
      else window.open(url, '_blank');
      return;
    }
    case 'nb-sort':
      notebookSort = t.dataset.sort === 'az' ? 'az' : 'recent';
      writeStore(NOTEBOOK_SORT_KEY, notebookSort);
      paint();
      return;
    case 'nb-toggle': {
      const id = t.dataset.id;
      if (!id) return;
      if (expandedVocab.has(id)) expandedVocab.delete(id);
      else expandedVocab.add(id);
      paint();
      return;
    }
    case 'nb-view':
      nbState.view = (t.dataset.view as NotebookView) || 'list';
      writeStore(NB_VIEW_KEY, nbState.view);
      if (nbState.view !== 'list') {
        await loadReviewPool();
        rebuildWordsContext();
      }
      paint();
      window.scrollTo({ top: 0 });
      return;
    case 'wb-scope':
      setWordsScope((t.dataset.scope as WordsScope) || 'mine');
      notebookFilter = '';
      if (wordsState.scope !== 'mine' || nbState.view !== 'list') {
        await loadReviewPool();
        rebuildWordsContext();
      }
      paint();
      window.scrollTo({ top: 0 });
      return;
    case 'learn-page':
      learnPage = t.dataset.page === 'progress' ? 'progress' : 'today';
      writeStore(LEARN_PAGE_KEY, learnPage);
      if (learnPage === 'progress') await loadAnswerHistory();
      paint();
      window.scrollTo({ top: 0 });
      return;
    case 'wb-library':
      wordsState.library = !wordsState.library;
      paint();
      window.scrollTo({ top: 0 });
      return;
    case 'wb-sub': {
      const id = t.dataset.book || '';
      if (!wordbookMeta(id)) return;
      await subscribeWordbook(id);
      await refreshWords();
      setWordsScope(id);
      toast(`Added ${wordbookMeta(id)!.title}`);
      paint();
      window.scrollTo({ top: 0 });
      return;
    }
    case 'wb-unsub': {
      const id = t.dataset.book || '';
      const title = wordbookMeta(id)?.title || id;
      if (isUserBookId(id)) await deleteUserBook(id);
      else await unsubscribeWordbook(id);
      if (wordsState.scope === id) setWordsScope(isUserBookId(id) ? 'sources' : 'mine');
      await refreshWords();
      toast(isUserBookId(id) ? `Deleted ${title}` : `Removed ${title}`);
      paint();
      return;
    }
    case 'src-book': {
      // A source becomes a word book: its words in the order they were saved.
      const g = wordsState.ctx ? sourceGroups(wordsState.ctx).find((x) => x.key === t.dataset.source) : null;
      if (!g) return;
      const book = await createUserBook(sourceBookTitle(g.label), g.entries.map((e) => e.lemma), g.key);
      await refreshWords();
      setWordsScope(book.bookId);
      toast(`Made ${book.title}`);
      paint();
      window.scrollTo({ top: 0 });
      return;
    }
    case 'src-add': {
      const g = wordsState.ctx ? sourceGroups(wordsState.ctx).find((x) => x.key === t.dataset.source) : null;
      if (!g || !t.dataset.book) return;
      await addUserBookWords(t.dataset.book, g.entries.map((e) => e.lemma));
      await refreshWords();
      paint();
      return;
    }
    case 'ub-drop': {
      if (!t.dataset.book || !t.dataset.q) return;
      await removeUserBookWord(t.dataset.book, t.dataset.q);
      await refreshWords();
      paint();
      return;
    }
    case 'wb-goal':
      await setWordbookGoal(t.dataset.book || '', Number(t.dataset.goal) || 10);
      nbState.review = null;
      await refreshWords();
      paint();
      return;
    case 'wb-expand': {
      const word = t.dataset.q || '';
      const key = word.toLowerCase();
      if (!key) return;
      if (wordsState.open.has(key)) wordsState.open.delete(key);
      else wordsState.open.add(key);
      const e = wordsState.ctx ? bookEntry(word, wordsState.ctx) : null;
      if (wordsState.open.has(key) && e && !e.definition) {
        void fetchBookMeaning(word).then(() => {
          rebuildWordsContext();
          if (tab === 'notebook') paint();
        });
      }
      paint();
      return;
    }
    case 'wb-sort':
      wordsState.sort = readBookSort(t.dataset.sort || '');
      writeStore(BOOK_SORT_KEY, wordsState.sort);
      wordsState.limit = BOOK_LIST_PAGE;
      paint();
      return;
    case 'wb-more':
      wordsState.limit += BOOK_LIST_PAGE;
      paint();
      return;
    case 'wb-known': {
      const p = await setBookWordKnown(t.dataset.q || '', t.dataset.known === '1', Date.now(), scopeBookFor(wordsState.scope, wordsState.ctx, t.dataset.q || ''));
      answerHistory = null;
      wbProgress.set(p.lemma, p);
      rebuildWordsContext();
      paint();
      return;
    }
    case 'wb-known-review': {
      if (!reviewArmed(nbState.review)) return;
      const p = await setBookWordKnown(t.dataset.q || '', true, Date.now(), scopeBookFor(wordsState.scope, wordsState.ctx, t.dataset.q || ''));
      answerHistory = null;
      wbProgress.set(p.lemma, p);
      rebuildWordsContext();
      if (nbState.review) markKnownInReview(nbState.review, t.dataset.q || '');
      paint();
      return;
    }
    case 'wb-save': {
      const lemma = t.dataset.q || '';
      if (!lemma) return;
      try {
        const cached = wbProgress.get(lemma.toLowerCase());
        let payload = {};
        if (!cached?.definition) {
          const res = await dictionaryService.lookup(lemma, prefs.targetLang, dictionaryService.getEnabledSources(), {
            translationProvider: prefs.translationProvider,
          }).catch(() => null);
          if (res) payload = vocabPayloadFromResult(res, lemma);
        }
        await saveBookWord(lemma, payload);
        toast('Saved to My words');
      } catch (err) {
        toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
      }
      await refreshNotebook();
      await loadReviewPool();
      rebuildWordsContext();
      paint();
      return;
    }
    case 'vocab-lang':
      nbState.lang = t.dataset.lang || 'all';
      writeStore(NB_LANG_KEY, nbState.lang);
      paint();
      return;
    case 'nb-group':
      nbState.group = (t.dataset.group as FamilyGrouping) || 'root';
      writeStore(NB_GROUP_KEY, nbState.group);
      paint();
      return;
    case 'nb-map-kind': {
      const k = t.dataset.kind as MorphKind;
      nbState.mapKinds = nbState.mapKinds.includes(k) ? nbState.mapKinds.filter((x) => x !== k) : [...nbState.mapKinds, k];
      writeStore(NB_MAP_KEY, nbState.mapKinds.join(','));
      paint();
      return;
    }
    case 'nb-flip': {
      const id = t.dataset.id;
      if (!id) return;
      if (nbState.flipped.has(id)) nbState.flipped.delete(id);
      else nbState.flipped.add(id);
      // Turned in place: a repaint would rebuild the whole table under the reader.
      const open = nbState.flipped.has(id);
      const card = t.closest('.nbv-card');
      card?.classList.toggle('is-flipped', open);
      const btn = card?.querySelector<HTMLElement>('.nbv-card__flip');
      if (btn) {
        btn.setAttribute('aria-pressed', String(open));
        btn.setAttribute('aria-label', open ? 'Show word' : 'Show meaning');
        btn.title = open ? 'Show word' : 'Show meaning';
      }
      return;
    }
    case 'nb-goal':
      nbState.goal = Number(t.dataset.goal) || 10;
      writeStore(NB_GOAL_KEY, String(nbState.goal));
      nbState.review = null;
      await loadReviewPool();
      paint();
      return;
    case 'nb-review-exit':
      // Back to the Learn page. An answer on screen is saved first, as Continue would.
      if (nbState.review?.answer) await commitReview();
      nbState.review = null;
      paint();
      return;
    case 'nb-start':
    case 'nb-round':
      // A new round plans again from what is due now.
      if (t.dataset.act === 'nb-round') {
        nbState.review = null;
        learnViewState();
      }
      // Book words get their meaning looked up before the first question is built.
      await Promise.all([prefetchMeanings(true), prefetchExamples(true)]);
      if (nbState.review) nbState.review.started = true;
      paint();
      return;
    case 'nb-reveal':
      if (nbState.review) nbState.review.revealed = true;
      paint();
      return;
    case 'nb-choose':
      if (reviewArmed(nbState.review)) answerCurrentReview({ choice: Number(t.dataset.choice) });
      return;
    case 'nb-knew':
      if (reviewArmed(nbState.review)) answerCurrentReview({ knew: t.dataset.knew === '1' });
      return;
    case 'nb-skip':
      if (reviewArmed(nbState.review)) answerCurrentReview({});
      return;
    case 'nb-override':
      if (nbState.review) overrideReview(nbState.review, t.dataset.mode === 'easy' ? 'easy' : 'flip');
      paint();
      return;
    case 'nb-next':
      await commitReview();
      return;
    case 'nb-play':
      if (soundOff()) return;
      await pulseSpeak(t, playLemma(t.dataset.lemma || ''));
      return;
    case 'nb-more': {
      const def = t.previousElementSibling as HTMLElement | null;
      if (!def) return;
      def.classList.toggle('is-clamped');
      t.textContent = def.classList.contains('is-clamped') ? 'Show more' : 'Show less';
      return;
    }
    case 'nb-del':
      if (t.dataset.id) {
        await removeVocab(t.dataset.id);
        expandedVocab.delete(t.dataset.id);
        await refreshNotebook();
        paint();
      }
      return;
    case 'nb-export':
      await exportWords();
      return;
    case 'nb-import':
      await pickAndImportNotebook();
      return;
    case 'src': {
      const name = t.dataset.name || '';
      const on = (t as HTMLInputElement).checked;
      prefs.sources[name] = on;
      persistPrefs();
      // In place: a repaint would close open disclosures and lose the scroll position.
      t.closest('.sv-src')?.classList.toggle('is-on', on);
      const ledger = t.closest('.sv-ledger');
      const count = document.querySelector('.sv-sources .sv-head__count');
      if (ledger && count) {
        const all = ledger.querySelectorAll('input[data-act="src"]').length;
        const onCount = ledger.querySelectorAll('input[data-act="src"]:checked').length;
        count.textContent = `${onCount} of ${all} on`;
      }
      return;
    }
    case 'engine':
      prefs.translationProvider = (t as HTMLInputElement).value as MobilePrefs['translationProvider'];
      persistPrefs();
      document.querySelectorAll<HTMLInputElement>('input[data-act="engine"]').forEach((r) => {
        r.closest('.sv-src')?.classList.toggle('is-on', r.checked);
      });
      return;
    case 'goto-section': {
      const next = t.dataset.section;
      if (next === 'api' || next === 'offline') {
        settingsSection = next;
        lib.highlightKey = next === 'api' ? t.dataset.provider || '' : '';
        if (next === 'offline') await refreshPacks();
        paint();
      }
      return;
    }
    case 'key-reveal': {
      const pref = t.dataset.pref || '';
      if (lib.revealedKeys.has(pref)) lib.revealedKeys.delete(pref);
      else lib.revealedKeys.add(pref);
      paint();
      return;
    }
    case 'key-clear': {
      saveKeyField(t.dataset.pref || '', '', t.dataset.provider || '');
      paint();
      return;
    }
    case 'key-test': {
      const provider = (t.dataset.provider || '') as ApiProviderId;
      const card = t.closest('.sv-key');
      card?.querySelectorAll<HTMLInputElement>('input[data-pref]').forEach((input) => {
        const pref = input.dataset.pref || '';
        if (input.value.trim() !== ((prefs as unknown as Record<string, string>)[pref] || '')) saveKeyField(pref, input.value, provider);
      });
      if (!keyPresent(prefs, provider)) {
        (card?.querySelector('input[data-pref]') as HTMLInputElement | null)?.focus();
        return;
      }
      lib.keyResults.set(provider, { status: 'testing' });
      paint();
      try {
        const r = await dictionaryService.verifyApiKey(provider);
        lib.keyResults.set(provider, { status: r.ok ? 'verified' : 'failed', message: r.message });
      } catch (err) {
        lib.keyResults.set(provider, { status: 'failed', message: err instanceof Error ? err.message : String(err) });
      }
      paint();
      return;
    }
    case 'pack-open': {
      const id = t.dataset.id || '';
      lib.inspecting = id;
      lib.inspectorEntering = true;
      paint();
      await loadPackDetails(id);
      if (lib.inspecting === id) paint();
      return;
    }
    case 'pack-close':
      lib.inspecting = null;
      paint();
      return;
    case 'update-check':
      await phoneUpdates?.check();
      return;
    case 'update-install':
      await phoneUpdates?.install();
      return;
    case 'notify-allow':
      if (hasNativeBridge()) {
        await nativeCall('requestNotifications', {});
        await refreshCapture();
        paint();
      }
      return;
    case 'notify-settings':
      if (hasNativeBridge()) void nativeCall('openNotificationSettings', {});
      return;
    case 'notify': {
      const on = (t as HTMLInputElement).checked;
      if (t.dataset.key === 'incoming') prefs.notifyIncoming = on;
      else if (t.dataset.key === 'saved') prefs.notifySaved = on;
      else if (t.dataset.key === 'ocr') prefs.notifyOcr = on;
      else if (t.dataset.key === 'updates') prefs.notifyUpdates = on;
      persistPrefs();
      if (on && hasNativeBridge() && capture.notificationsGranted === false) {
        await nativeCall('requestNotifications', {});
        await refreshCapture();
        paint();
      }
      return;
    }
    case 'voice':
      voice = await nativeCall<VoiceStatus>('setSpeechVoice', { id: t.dataset.value || '' });
      watchVoice();
      paint();
      return;
    case 'voice-cancel':
      voice = await nativeCall<VoiceStatus>('cancelSpeechDownload', {});
      paint();
      return;
    case 'audio-on':
      prefs.audioEnabled = (t as HTMLInputElement).checked;
      persistPrefs();
      return;
    case 'sense-images':
      prefs.senseImages = (t as HTMLInputElement).checked;
      persistPrefs();
      if (prefs.senseImages && result) void loadSenseImages(lookupGeneration);
      return;
    case 'sense-figure':
      openSensePicture(t);
      return;
    case 'sense-credit':
      if (t.dataset.url) openExternal(t.dataset.url);
      return;
    case 'audio-speed':
    case 'audio-volume':
      return;
    case 'strip-on':
      prefs.floatingStrip = (t as HTMLInputElement).checked;
      persistPrefs();
      if (hasNativeBridge()) {
        void nativeCall('setFloatingStrip', { enabled: prefs.floatingStrip }).then(async () => {
          await refreshCapture();
          paint();
        });
      }
      return;
    case 'auto-popup': {
      const on = (t as HTMLInputElement).checked;
      if (hasNativeBridge()) {
        await nativeCall('setAutoPopup', { enabled: on });
        await refreshCapture();
        paint();
      }
      return;
    }
    case 'bar-place':
      await setBarSlot((t as HTMLInputElement).value === 'custom' ? Math.max(0, capture.barSlot ?? 0) : -1);
      return;
    case 'bar-slot-step':
      await setBarSlot(Math.max(0, Math.min(MOCK_BAR.length, (capture.barSlot ?? 0) + Number(t.dataset.step || 0))));
      return;
    case 'a11y-settings':
      if (hasNativeBridge()) void nativeCall('openAccessibilitySettings', {});
      return;
    case 'selection-setup':
      if (hasNativeBridge()) void nativeCall('selectionSetup', {});
      return;
    case 'overlay-perm':
      if (hasNativeBridge()) void nativeCall('requestOverlayPermission', {});
      return;
    case 'close-strip':
      if (hasNativeBridge()) void nativeCall('closeStrip', {});
      return;
    case 'expand-strip':
      if (hasNativeBridge()) void nativeCall('expandStrip', { q: query });
      else window.location.href = `${window.location.pathname}${query ? `?q=${encodeURIComponent(query)}` : ''}`;
      return;
    case 'pack-dl':
      if (t.dataset.id) await downloadPack(t.dataset.id);
      return;
    case 'pack-rm':
      if (t.dataset.id && window.confirm('Remove this pack?')) {
        await removePack(t.dataset.id);
        await refreshPacks();
        paint();
      }
      return;
    case 'pack-file': {
      let name = lastPickedName || 'pack.txt';
      let text = '';
      if (hasNativeBridge()) {
        const res = await nativeCall<{ text?: string; name?: string }>('pickFile', {});
        text = res.text || '';
        name = res.name || name;
      } else {
        text = await pickLocalFile();
        name = lastPickedName || name;
      }
      if (!text) return;
      packMsg = 'Importing…';
      paint();
      try {
        const out = await importUserFile(name, text, t.dataset.kind === 'cedict' ? 'cedict' : undefined);
        packMsg = `Imported ${out.count} entries`;
        await refreshPacks();
      } catch (err) {
        packMsg = err instanceof Error ? err.message : String(err);
      }
      paint();
      return;
    }
    default:
      return;
  }
}

function onChange(e: Event): void {
  const el = e.target as HTMLElement | null;
  if (!el) return;
  // The goal field: a typed number goes through the same action as the preset chips.
  if (el instanceof HTMLInputElement && el.hasAttribute('data-goal-input')) {
    const goal = parseGoal(el.value);
    if (goal != null && el.dataset.goalAct) {
      el.dataset.goal = String(goal);
      void handleAct(el.dataset.goalAct, el, e);
    }
    return;
  }
  if (el.id === 'account-delete-email') {
    const confirm = document.querySelector<HTMLButtonElement>('[data-act="account-delete-confirm"]');
    if (confirm) confirm.disabled = accountDeleteBusy || !deleteEmailMatches(accountState, (el as HTMLInputElement).value);
    return;
  }
  if (el.id === 'lang-q') {
    // Filter in place so the search box keeps focus while typing.
    const needle = (el as HTMLInputElement).value.trim().toLowerCase();
    document.querySelectorAll<HTMLElement>('.lang-sheet .lang-row').forEach((row) => {
      row.hidden = !!needle && !(row.dataset.search || '').includes(needle);
    });
    document.querySelectorAll<HTMLElement>('.lang-sheet__section').forEach((h) => { h.hidden = !!needle; });
    return;
  }
  if (e.type === 'change' && el instanceof HTMLInputElement && el.name === 'book-title' && el.dataset.book) {
    void renameUserBook(el.dataset.book || '', el.value).then(async () => {
      await refreshWords();
      paint();
    });
    return;
  }
  if (e.type === 'change' && el.id === 'update-mode') {
    const mode = (el as HTMLSelectElement).value;
    if (mode === 'auto' || mode === 'ask' || mode === 'off') phoneUpdates?.setMode(mode);
    return;
  }
  if (el.id === 'q') {
    draft = (el as HTMLInputElement).value;
    if (e.type === 'input') onQueryInput();
  } else if (el.id === 'nbq') {
    notebookFilter = (el as HTMLInputElement).value;
    paint();
  } else if (e.type === 'change' && el.dataset.pref && el instanceof HTMLInputElement) {
    // API keys save as you leave the field. Only the card's status changes here: a
    // repaint would swallow the tap on Test or Show that caused the field to blur.
    saveKeyField(el.dataset.pref, el.value, el.dataset.provider || '');
    if (el.dataset.provider) patchKeyCard(el.dataset.provider);
  } else if (el.id === 'audio-volume') {
    prefs.audioVolume = (Number((el as HTMLInputElement).value) || 0) / 100;
    persistPrefs();
    const label = document.getElementById('volume-value');
    if (label) label.textContent = `${Math.round(prefs.audioVolume * 100)}%`;
  } else if (el.id === 'audio-speed' || el.dataset.act === 'audio-speed') {
    prefs.audioSpeed = Number((el as HTMLInputElement).value) || 1;
    persistPrefs();
    const label = document.getElementById('speed-value');
    if (label) label.textContent = `${prefs.audioSpeed.toFixed(1)}×`;
  }
}

function onSubmit(e: Event): void {
  const form = e.target as HTMLElement | null;
  if (form instanceof HTMLFormElement && form.dataset.actForm === 'nb-submit') {
    e.preventDefault();
    answerCurrentReview({ typed: (form.querySelector('#nbv-answer') as HTMLInputElement | null)?.value || '' });
    return;
  }
  if (form instanceof HTMLFormElement && form.dataset.actForm === 'ub-add') {
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>('input[name="word"]');
    const word = (input?.value || '').trim();
    if (!word) return;
    void addUserBookWords(form.dataset.book || '', [word]).then(async () => {
      await refreshWords();
      paint();
      document.querySelector<HTMLInputElement>('form[data-act-form="ub-add"] input')?.focus();
    });
    return;
  }
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('search')) return;
  e.preventDefault();
  const input = document.getElementById('q') as HTMLInputElement | null;
  suggestHeld = true;
  suggestSeq++;
  paintSuggest();
  if (input?.value) void lookup(input.value);
}

export async function startApp(): Promise<void> {
  installNativeCallbacks();
  // The floating pop-up's own selection bar sends its Phevere item here.
  // Android Back (button or gesture): the page steps back first; native leaves the app only
  // when this returns false.
  // It does what the page's own back or close control would, innermost first.
  (window as unknown as { __pvBack?: () => boolean }).__pvBack = () => {
    if (closeTreeInspector()) return true;
    const sheet = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (sheet) {
      sheet.dispatchEvent(new Event('cancel'));
      if (sheet.open) sheet.close();
      return true;
    }
    if (accountOpen) { accountOpen = false; accountDeleting = false; paint(); return true; }
    if (langMenu) { langMenu = ''; paint(); return true; }
    if (lib.inspecting) { lib.inspecting = null; paint(); return true; }
    if (scan) {
      if (scanSheet !== 'closed') setScanSheet('closed');
      else { scan = null; clearScanPick(); paint(); }
      return true;
    }
    if (tab === 'learn' && nbState.review) {
      const r = nbState.review;
      void (r.answer ? commitReview() : Promise.resolve()).then(() => {
        nbState.review = null;
        paint();
      });
      return true;
    }
    if (tab === 'notebook' && wordsState.library) { wordsState.library = false; paint(); return true; }
    if (tab !== 'lookup') { tab = 'lookup'; paint(); return true; }
    // Lookup: the same as its back arrow, the Wikipedia reader first, then the word before.
    if (wikiArticle && wikiCanBack()) { void handleAct('back', root, new Event('back')); return true; }
    if (lookupFrom && histIndex <= lookupFrom.at) {
      tab = lookupFrom.tab;
      lookupFrom = null;
      paint();
      return true;
    }
    if (histIndex > 0) { void handleAct('back', root, new Event('back')); return true; }
    return false;
  };
  const hooks = window as unknown as {
    __pvLookupText?: (text: string) => void;
    __pvSelectionAction?: () => { text: string; inPlace: boolean; rect: Record<string, number> | null } | null;
  };
  hooks.__pvLookupText = (text) => lookupInPlace(text);
  // Phevere on the selection bar (Android) or edit menu (iOS): the pop-up and Scan look up in
  // place; elsewhere native opens the pop-up beside the selection.
  hooks.__pvSelectionAction = () => {
    const sel = window.getSelection();
    const text = (sel?.toString() || '').trim();
    if (!text) return null;
    if (stripMode || scan) {
      lookupInPlace(text);
      return { text, inPlace: true, rect: null };
    }
    const box = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    return { text, inPlace: false, rect: box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null };
  };
  startIncomingText((text, origin) => {
    stripExpanding = false;
    if (origin === 'process-text' || origin === 'share') postOsNotify('incoming', 'Incoming lookup', text);
    if (origin === 'process-text') void takeIncomingSource();
    resetTrail();
    void lookup(text);
  });
  applyInsets();
  applyPrefsToCore(prefs);
  await refreshCapture();
  root.addEventListener('click', onClick);
  // Enter or Space on a focused word link opens it, as a tap does.
  root.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement | null;
    if ((e.key !== 'Enter' && e.key !== ' ') || !el?.matches?.('[role="link"][data-act]')) return;
    e.preventDefault();
    el.click();
  });
  root.addEventListener('submit', onSubmit);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onChange);
  root.addEventListener('focusin', (e) => {
    if ((e.target as HTMLElement).id === 'q' && (e.target as HTMLInputElement).value.trim() && !suggestHeld) onQueryInput();
  });
  root.addEventListener('focusout', (e) => {
    if ((e.target as HTMLElement).id === 'q') setTimeout(paintSuggest, 0);
  });
  document.addEventListener('keydown', (ev) => {
    if (tab !== 'learn' || !nbState.review || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const page = document.querySelector<HTMLElement>('.lrn-body');
    const target = ev.target as HTMLElement | null;
    if (!page || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (ev.key === 'Enter') {
      const next = page.querySelector<HTMLElement>('[data-act="nb-next"], [data-act="nb-start"], [data-act="nb-reveal"], [data-act="nb-round"]');
      if (!next) return;
      ev.preventDefault();
      next.click();
      return;
    }
    if (/^[1-4]$/.test(ev.key)) {
      const n = Number(ev.key);
      const hit =
        page.querySelector<HTMLElement>(`[data-act="nb-choose"][data-choice="${n - 1}"]:not([disabled])`) ||
        (n <= 2 ? page.querySelector<HTMLElement>(`[data-act="nb-knew"][data-knew="${n === 2 ? 1 : 0}"]`) : null);
      if (!hit) return;
      ev.preventDefault();
      hit.click();
    }
  });
  root.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).id !== 'q' || (e as KeyboardEvent).key !== 'Escape') return;
    suggestHeld = true;
    suggestSeq++;
    paintSuggest();
  });
  // Settings disclosures stay open across repaints.
  root.addEventListener('toggle', (e) => {
    const d = e.target as HTMLDetailsElement | null;
    const key = d?.dataset?.key;
    if (!key) return;
    if (d!.open) lib.openDetails.add(key);
    else lib.openDetails.delete(key);
  }, true);
  // A Wikipedia thumbnail that fails to load is dropped rather than shown broken.
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.closest('.wikipedia-item')) img.remove();
  }, true);
  paint();
  window.addEventListener('resize', sizeLexiconPane, { passive: true });
  document.addEventListener('selectionchange', () => {
    if (selectionTimer) window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(onSelectionSettled, 650);
  });
  window.visualViewport?.addEventListener('resize', sizeLexiconPane, { passive: true });
  if (hasNativeBridge()) {
    try {
      const pending = await nativeCall<{ text?: string; origin?: string }>('getPendingText', {});
      if (pending.text) {
        void takeIncomingSource();
        void lookup(pending.text);
      }
    } catch {
      /* none */
    }
  }
  let touchStart: { x: number; y: number } | null = null;
  // Bottom-sheet pop-up: a swipe up from its header opens the full app. Swipes on the content
  // scroll the definitions; they must not throw the reader into the app.
  root.addEventListener('touchstart', (event) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    const onHeader = !!(event.target as Element | null)?.closest?.('.popup-bar');
    touchStart = touch && onHeader ? { x: touch.clientX, y: touch.clientY } : null;
  }, { passive: true });
  root.addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    if (stripMode && capture.platform === 'android' && !prefs.floatingStrip && !stripExpanding && touchStart && touch
        && touchStart.y - touch.clientY > 60 && Math.abs(touch.clientX - touchStart.x) < 80) {
      stripExpanding = true;
      void nativeCall('expandStrip', { q: query }).catch(() => { stripExpanding = false; });
    }
    touchStart = null;
  }, { passive: true });
  root.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
  bindPullToRefresh();
  await sqlWarm();
  await refreshNotebook();
  void fillEmptyCards();
  await refreshPacks();
  if (!stripMode) {
    accountPlatform.initAccount({
      onState: (next) => {
        const before = accountBadgeKey(accountState);
        const plusBefore = plusNoticeHtml(accountState, HOLARKY_ACCOUNT.plusUrl, 'learn');
        accountState = next;
        if (accountOpen || (tab === 'learn' && plusBefore !== plusNoticeHtml(next, HOLARKY_ACCOUNT.plusUrl, 'learn'))) paint();
        else if (before !== accountBadgeKey(next)) refreshAccountButton();
      },
      onNotebookChanged: () => {
        void refreshNotebook().then(async () => {
          if (tab === 'learn') {
            await loadReviewPool();
            rebuildWordsContext();
          }
          if (tab === 'notebook' || tab === 'learn') paint();
        });
      },
    });
  }
  if (!stripMode && capture.platform === 'android') {
    void startPhoneUpdates({
      changed: showUpdateState,
      busy: () => looking || !!scan || document.visibilityState !== 'visible',
      notify: (text) => {
        if (prefs.notifyUpdates !== false) void nativeCall('notify', { title: 'Phevere', body: text }).catch(() => undefined);
      },
      openPage: openExternal,
    }).then((updater) => {
      phoneUpdates = updater;
      if (tab === 'settings') paint();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void refreshCapture().then(() => paint());
    if (!stripMode) accountPlatform.syncSoon();
    void phoneUpdates?.resume();
  });
  const q = queryFromLocation();
  if (q) await lookup(q);
  paint();
}

/**
 * Repaints Settings → Updates. A download only moves its bar and status line, so an open
 * Install updates list is not closed by every percent.
 */
function showUpdateState(s: PhoneUpdateState): void {
  if (tab !== 'settings' || settingsSection !== 'updates') return;
  const bar = document.querySelector<HTMLElement>('.settings-panel .sv-progress');
  if (s.status === 'downloading' && bar) {
    const pct = Math.round(s.progress * 100);
    bar.setAttribute('aria-valuenow', String(pct));
    const fill = bar.firstElementChild as HTMLElement | null;
    if (fill) fill.style.width = `${pct}%`;
    const line = document.querySelector<HTMLElement>('.settings-panel .sv-row__sub[role="status"]');
    if (line) line.textContent = updateStatusText(s);
    return;
  }
  paint();
}

async function refreshCapture(): Promise<void> {
  if (!hasNativeBridge()) return;
  try {
    const next = await nativeCall<{
      floatingStrip?: boolean;
      canDrawOverlays?: boolean;
      platform?: string;
      notificationsGranted?: boolean;
      autoPopup?: boolean;
      accessibilityOn?: boolean;
      moduleActive?: boolean;
      moduleFramework?: string;
      barSlot?: number;
    }>('getCapturePrefs', {});
    if (typeof next.floatingStrip === 'boolean') prefs.floatingStrip = next.floatingStrip;
    capture = {
      platform: next.platform === 'ios' ? 'ios' : 'android',
      canDrawOverlays: !!next.canDrawOverlays,
      notificationsGranted: !!next.notificationsGranted,
      autoPopup: !!next.autoPopup,
      accessibilityOn: !!next.accessibilityOn,
      moduleActive: !!next.moduleActive,
      moduleFramework: next.moduleFramework || '',
      barSlot: typeof next.barSlot === 'number' ? next.barSlot : -1,
    };
    savePrefs(prefs);
  } catch {
    capture = { platform: 'android', canDrawOverlays: false };
  }
}

async function fillEmptyCards(): Promise<void> {
  const rows = [...(await listEmptyDefinitions(40)), ...(await listEmptyReadings(40))];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.lemma.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const next = await dictionaryService.lookup(row.lemma, prefs.targetLang, undefined, {
        skipEtymology: true,
      });
      const payload = vocabPayloadFromResult(next, row.lemma);
      await fillEmptyDefinitions([row.lemma], {
        definition: payload.definition,
        reading: payload.reading,
        partOfSpeech: payload.partOfSpeech,
        sources: payload.sources,
      });
    } catch {
      /* skip this card */
    }
  }
  if (tab === 'notebook') {
    await refreshNotebook();
    paint();
  }
}

async function sqlWarm(): Promise<void> {
  try {
    await listVocab(1);
  } catch {
    /* first paint still works */
  }
}
