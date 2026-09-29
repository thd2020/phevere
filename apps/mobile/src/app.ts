import { scrollLexiconTo } from './lexicon-scroll';
import './platform/configure-core';
import {
  addVocab,
  dictionaryService,
  fillEmptyDefinitions,
  findByLemma,
  listEmptyDefinitions,
  listEmptyReadings,
  listVocab,
  removeVocab,
  saveLemma,
  stripGlossText,
  wikipediaService,
  type DictionaryResult,
  type VocabEntry,
  type WikipediaResult,
} from '@phevere/core';
import { extractLookupQuery, queryFromLocation, startIncomingText } from './incoming-text';
import { playRecorded, speakIpa, speakText } from './platform/audio';
import {
  applyInsets,
  hasNativeBridge,
  installNativeCallbacks,
  nativeCall,
} from './platform/native';
import { exportNotebook, importNotebookText } from './platform/notebook-io';
import {
  downloadCatalogPack,
  importUserFile,
  listCatalogStatus,
  markInstalledPacksOnCore,
  removePack,
  type CatalogStatus,
} from './platform/offline';
import { applyPrefsToCore, loadPrefs, savePrefs, type MobilePrefs } from './platform/prefs';
import {
  lookupBody,
  navHtml,
  notebookBody,
  scanHtml,
  appBarHtml,
  popupBarHtml,
  settingsBody,
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
let posJumpLock = false;
let posJumpTimer: number | null = null;
let wiki: WikipediaResult[] = [];
let wikiArticle: WikiArticle | null = null;
let wikiStack: WikiArticle[] = [];
let wikiFetch = 0;
let wikiLoading = false;
let wikiError = '';
let wikiListOnly = false;
let notebook: VocabEntry[] = [];
let notebookSort: 'recent' | 'az' = 'recent';
let notebookFilter = '';
let expandedVocab = new Set<string>();
let prefs: MobilePrefs = loadPrefs();
let packs: CatalogStatus[] = [];
let packMsg = '';
let toastMsg = '';
let toastTimer: number | null = null;
let capture: CaptureInfo = { platform: 'web', canDrawOverlays: false };
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

function toast(msg: string): void {
  toastMsg = msg;
  paint();
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMsg = '';
    paint();
  }, 2400);
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
  });
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
  const hit = lookupPaneHtml();
  if (tab === 'lookup' && scan) {
    paintScan(scan, hit);
    return;
  }
  const body =
    tab === 'notebook'
      ? notebookBody(notebook, notebookSort, notebookFilter, expandedVocab)
      : tab === 'settings'
        ? settingsBody(
            prefs,
            dictionaryService.getSourceStats().sources,
            packs,
            packMsg,
            capture,
            settingsSection,
            voice,
          )
        : hit;
  const lexiconFill = tab === 'lookup' && resultTab === 'lexicon' && !!result;
  root.innerHTML = `
    <div class="shell${tab === 'settings' ? ' shell-settings' : ''}${lexiconFill ? ' shell-lexicon' : ''}${resultTab === 'wikipedia' && wikiArticle ? ' shell-wiki' : ''}">
      ${stripMode ? popupBarHtml(canBack || wikiCanBack(), canFwd) : appBarHtml(tab, draft, canBack, canFwd)}
      <main class="page">${body}</main>
    </div>
    ${stripMode ? '' : navHtml(tab)}
    ${toastMsg ? `<div class="toast" role="status">${esc(toastMsg)}</div>` : ''}`;
  const q = document.getElementById('q') as HTMLInputElement | null;
  if (keepFocus && q) {
    q.focus();
    if (typeof caret === 'number') q.setSelectionRange(caret, caret);
  }
  const nbq = document.getElementById('nbq') as HTMLInputElement | null;
  if (keepNbq && nbq) {
    nbq.focus();
    if (typeof nbqCaret === 'number') nbq.setSelectionRange(nbqCaret, nbqCaret);
  }
  bindLexiconPane();
  bindWikiReader();
  bindMockBar();
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
    notebook = await listVocab(400);
  } catch (err) {
    status = err instanceof Error ? err.message : String(err);
  }
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
  lexiconWord = q;
  if (!fromHist) rememberLookup(q);
  paint();
  const enabled = dictionaryService.getEnabledSources();
  try {
    const next = await dictionaryService.lookup(q, prefs.targetLang, enabled, {
      translationProvider: prefs.translationProvider,
      sourceLanguage: prefs.sourceLang === 'auto' ? undefined : prefs.sourceLang,
      onUpdate: (partial) => {
        if (generation !== lookupGeneration) return;
        result = partial;
        looking = false;
        paint();
      },
    });
    if (generation !== lookupGeneration) return;
    result = next;
    const nextSaved = await findByLemma(saveLemma(next)).catch(() => null);
    if (generation !== lookupGeneration) return;
    saved = nextSaved;
    void loadWikiHits(next.word || q).then(() => {
      if (tab === 'lookup' && resultTab === 'wikipedia') {
        void maybeAutoOpenWiki().then(() => paint());
      }
    });
  } catch (err) {
    if (generation !== lookupGeneration) return;
    status = err instanceof Error ? err.message : String(err);
  } finally {
    if (generation === lookupGeneration) {
      looking = false;
      paint();
    }
  }
}

async function saveCurrent(): Promise<void> {
  if (!result) return;
  const lemma = saveLemma(result);
  if (saved) {
    await removeVocab(saved.id);
    saved = null;
    toast('Removed from notebook');
  } else {
    saved = await addVocab({
      lemma,
      reading: formatReading(result),
      definition: stripGlossText(result.definitions[0]?.meaning || '') || undefined,
      partOfSpeech: result.definitions[0]?.partOfSpeech,
      sourceLang: result.detectedLanguage,
      targetLang: prefs.targetLang,
      sources: result.sources,
    });
    toast('Saved');
    postOsNotify('saved', 'Saved to notebook', lemma);
  }
  await refreshNotebook();
  paint();
}

function formatReading(r: DictionaryResult): string | undefined {
  const line = r.pronunciations?.map((p) => p.ipa).filter(Boolean).join(' ') || r.pronunciation;
  return line || undefined;
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
  view.querySelector<HTMLElement>('.scan-toast')!.innerHTML = toastMsg
    ? `<div class="toast" role="status">${esc(toastMsg)}</div>`
    : '';
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
    toast('Camera OCR runs in the Android / iOS app');
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
    const msg = err instanceof Error ? err.message : 'OCR failed';
    if (msg === 'Cancelled' || msg === 'No photo' || msg === 'No image') return;
    toast(msg);
  }
}

async function pickAndImportNotebook(): Promise<void> {
  try {
    let name = 'notebook.json';
    let text = '';
    if (hasNativeBridge()) {
      const res = await nativeCall<{ name?: string; text?: string }>('pickFile', { mime: 'text/*' });
      name = res.name || name;
      text = res.text || '';
    } else {
      text = await pickLocalFile();
      name = lastPickedName || name;
    }
    if (!text) return;
    const out = await importNotebookText(name, text);
    await refreshNotebook();
    toast(`Imported ${out.imported}, skipped ${out.skipped}`);
    paint();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Import failed');
  }
}

let lastPickedName = '';
function pickLocalFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.csv,.tei,.txt,.u8';
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
  if (item && !window.confirm(item.consent)) return;
  packMsg = 'Starting…';
  paint();
  try {
    const out = await downloadCatalogPack(id, (msg) => {
      packMsg = msg;
      paint();
    });
    packMsg = `Imported ${out.count} entries`;
    await refreshPacks();
  } catch (err) {
    packMsg = err instanceof Error ? err.message : String(err);
  }
  paint();
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
  const fold = (v: string) => v.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
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

function pulseSpeak(el: HTMLElement, done: Promise<void>): Promise<void> {
  document.querySelectorAll('.is-speaking').forEach((n) => n.classList.remove('is-speaking'));
  el.classList.add('is-speaking');
  const clear = () => el.classList.remove('is-speaking');
  const timeout = window.setTimeout(clear, 8000);
  return done.catch((err) => {
    toast(err instanceof Error ? err.message : 'Could not play audio');
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
  const viewport = window.visualViewport?.height || window.innerHeight;
  const nav = document.querySelector('.nav');
  const bottom = layout.closest('.scan-sheet') ? viewport : nav ? nav.getBoundingClientRect().top : viewport;
  layout.style.height = `${Math.max(160, bottom - layout.getBoundingClientRect().top - 16)}px`;
}

function bindLexiconPane(): void {
  sizeLexiconPane();
  document.querySelector('.lexicon-pos-panel')?.addEventListener('scroll', onLexiconPosScroll, { passive: true });
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

async function handleAct(act: string, t: HTMLElement, e: Event): Promise<void> {
  switch (act) {
    case 'tab':
      tab = t.dataset.tab === 'notebook' ? 'notebook' : t.dataset.tab === 'settings' ? 'settings' : 'lookup';
      if (tab === 'notebook') await refreshNotebook();
      if (tab === 'settings') await refreshPacks();
      paint();
      return;
    case 'settings-section': {
      const next = t.dataset.section as SettingsSection | undefined;
      if (next === 'capture' || next === 'notifications' || next === 'sources' || next === 'offline' || next === 'api' || next === 'audio') {
        settingsSection = next;
        langMenu = '';
        if (next === 'offline') await refreshPacks();
        if (next === 'audio') await refreshVoice();
        paint();
      }
      return;
    }
    case 'ocr':
      await runOcr();
      return;
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
    case 'lookup':
      if (t.dataset.q) await lookup(t.dataset.q);
      return;
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
    case 'save':
      await saveCurrent();
      return;
    case 'speak':
      await pulseSpeak(t, playRecorded(result, prefs));
      return;
    case 'speak-ipa': {
      const i = Number(t.dataset.i);
      const p = result?.pronunciations?.[i];
      if (p) await pulseSpeak(t, speakIpa(p, prefs, result?.word));
      return;
    }
    case 'speak-text':
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
    case 'nb-play':
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
      await exportNotebook('json');
      toast('Exported');
      return;
    case 'nb-import':
      await pickAndImportNotebook();
      return;
    case 'src': {
      const name = t.dataset.name || '';
      const on = (t as HTMLInputElement).checked;
      prefs.sources[name] = on;
      persistPrefs();
      return;
    }
    case 'engine':
      prefs.translationProvider = (t as HTMLInputElement).value as MobilePrefs['translationProvider'];
      persistPrefs();
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
        const out = await importUserFile(name, text);
        packMsg = `Imported ${out.count}`;
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
  if (el.id === 'lang-q') {
    // Filter in place so the search box keeps focus while typing.
    const needle = (el as HTMLInputElement).value.trim().toLowerCase();
    document.querySelectorAll<HTMLElement>('.lang-sheet .lang-row').forEach((row) => {
      row.hidden = !!needle && !(row.dataset.search || '').includes(needle);
    });
    document.querySelectorAll<HTMLElement>('.lang-sheet__section').forEach((h) => { h.hidden = !!needle; });
    return;
  }
  if (el.id === 'q') {
    draft = (el as HTMLInputElement).value;
  } else if (el.id === 'nbq') {
    notebookFilter = (el as HTMLInputElement).value;
    paint();
  } else if (e.type === 'change' && el.dataset.pref && el instanceof HTMLInputElement) {
    // API keys save as you leave the field.
    (prefs as unknown as Record<string, unknown>)[el.dataset.pref] = el.value.trim();
    persistPrefs();
    toast('Saved');
  } else if (el.id === 'audio-volume') {
    prefs.audioVolume = (Number((el as HTMLInputElement).value) || 0) / 100;
    persistPrefs();
    const label = document.getElementById('volume-value');
    if (label) label.textContent = `${Math.round(prefs.audioVolume * 100)}%`;
  } else if (el.id === 'audio-speed' || el.dataset.act === 'audio-speed') {
    prefs.audioSpeed = Number((el as HTMLInputElement).value) || 1;
    persistPrefs();
    const label = document.getElementById('speed-value');
    if (label) label.textContent = `${prefs.audioSpeed}×`;
  }
}

function onSubmit(e: Event): void {
  const form = e.target as HTMLElement | null;
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('search')) return;
  e.preventDefault();
  const input = document.getElementById('q') as HTMLInputElement | null;
  if (input?.value) void lookup(input.value);
}

export async function startApp(): Promise<void> {
  installNativeCallbacks();
  // The floating pop-up's own selection bar sends its Phevere item here.
  // Android Back (button or gesture): the page steps back first; native leaves the app only
  // when this returns false.
  (window as unknown as { __pvBack?: () => boolean }).__pvBack = () => {
    if (langMenu) { langMenu = ''; paint(); return true; }
    if (scan) {
      if (scanSheet !== 'closed') setScanSheet('closed');
      else { scan = null; clearScanPick(); paint(); }
      return true;
    }
    if (wikiArticle && wikiCanBack()) { void handleAct('wiki-back', root, new Event('back')); return true; }
    if (tab !== 'lookup') { tab = 'lookup'; paint(); return true; }
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
    resetTrail();
    void lookup(text);
  });
  applyInsets();
  applyPrefsToCore(prefs);
  await refreshCapture();
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onChange);
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
      if (pending.text) void lookup(pending.text);
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshCapture().then(() => paint());
  });
  const q = queryFromLocation();
  if (q) await lookup(q);
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
      await fillEmptyDefinitions([row.lemma], {
        definition: stripGlossText(next.definitions[0]?.meaning || '') || undefined,
        reading: formatReading(next),
        partOfSpeech: next.definitions[0]?.partOfSpeech,
        sources: next.sources,
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
