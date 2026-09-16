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
  searchHtml,
  settingsBody,
  type CaptureInfo,
  type ResultTab,
  type ScanPage,
  type SettingsSection,
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
let result: DictionaryResult | null = null;
let saved: VocabEntry | null = null;
let status = '';
let resultTab: ResultTab = 'lexicon';
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

const stripMode = new URLSearchParams(window.location.search).get('mode') === 'strip';
if (stripMode) document.documentElement.dataset.mode = 'strip';

const history: string[] = [];
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
  if (scan && !looking && !status && !result) {
    return `<p class="scan-hint">Select text on the picture</p>`;
  }
  return lookupBody({
    looking,
    status,
    result,
    saved,
    resultTab,
    langs,
    sourceLang: prefs.sourceLang,
    targetLang: prefs.targetLang,
    wiki,
    wikiLang: wikiLanguage(),
    wikiArticle,
    wikiLoading,
    wikiError,
    lexiconPos,
  });
}

function paint(): void {
  document.documentElement.dataset.notify = capture.platform === 'ios' ? 'ios' : 'android';
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
    root.innerHTML = `
      <div class="shell shell-scan">${scanHtml(scan)}<div class="scan-hit">${hit}</div></div>
      ${stripMode ? '' : navHtml(tab)}
      ${toastMsg ? `<div class="toast" role="status">${esc(toastMsg)}</div>` : ''}`;
    bindLexiconPane();
    bindWikiReader();
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
          )
        : hit;
  const lexiconFill = tab === 'lookup' && resultTab === 'lexicon' && !!result;
  root.innerHTML = `
    <div class="shell${tab === 'settings' ? ' shell-settings' : ''}${lexiconFill ? ' shell-lexicon' : ''}${resultTab === 'wikipedia' && wikiArticle ? ' shell-wiki' : ''}">
      ${tab === 'settings' ? '' : searchHtml(draft, canBack, canFwd, stripMode)}
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
}

function wikiLanguage(): string {
  const lang = result?.detectedLanguage || prefs.wikiLang || 'en';
  return lang === 'zh' || lang === 'ja' || lang === 'ko' ? lang : 'en';
}

async function loadWikiHits(term: string): Promise<void> {
  wikiLoading = true;
  wikiError = '';
  try {
    wiki = (await wikipediaService.searchHits(term, wikiLanguage(), 5)).results || [];
  } catch (err) {
    wiki = [];
    wikiError = err instanceof Error ? err.message : String(err);
  } finally {
    wikiLoading = false;
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

async function lookup(raw: string, fromHist = false): Promise<void> {
  const q = extractLookupQuery(raw);
  if (!q) return;
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
  resultTab = 'lexicon';
  lexiconPos = '';
  lexiconWord = q;
  if (!fromHist) {
    history.splice(histIndex + 1);
    history.push(q);
    histIndex = history.length - 1;
  }
  paint();
  const enabled = dictionaryService.getEnabledSources();
  try {
    const next = await dictionaryService.lookup(q, prefs.targetLang, enabled, {
      translationProvider: prefs.translationProvider,
      sourceLanguage: prefs.sourceLang === 'auto' ? undefined : prefs.sourceLang,
      onUpdate: (partial) => {
        result = partial;
        looking = false;
        paint();
      },
    });
    result = next;
    saved = await findByLemma(saveLemma(next)).catch(() => null);
    void loadWikiHits(next.word || q).then(() => {
      if (tab === 'lookup' && resultTab === 'wikipedia') {
        void maybeAutoOpenWiki().then(() => paint());
      }
    });
  } catch (err) {
    status = err instanceof Error ? err.message : String(err);
  } finally {
    looking = false;
    paint();
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

function pulseSpeak(el: HTMLElement, done: Promise<void>): Promise<void> {
  document.querySelectorAll('.is-speaking').forEach((n) => n.classList.remove('is-speaking'));
  el.classList.add('is-speaking');
  const clear = () => el.classList.remove('is-speaking');
  const timeout = window.setTimeout(clear, 8000);
  return done.finally(() => {
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
  const header = document.querySelector('.top') as HTMLElement | null;
  const offset = (header?.getBoundingClientRect().height || 0) + 8;
  if (stripMode) {
    const scroller = document.querySelector('.page') as HTMLElement | null;
    if (scroller) {
      const top = Math.max(
        0,
        target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 6,
      );
      if (instant) scroller.scrollTop = top;
      else {
        try {
          scroller.scrollTo({ top, behavior: 'smooth' });
        } catch {
          scroller.scrollTop = top;
        }
      }
    }
  } else {
    const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - offset);
    if (instant) window.scrollTo(0, top);
    else {
      try {
        window.scrollTo({ top, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, top);
      }
    }
  }
  if (posJumpTimer) window.clearTimeout(posJumpTimer);
  posJumpTimer = window.setTimeout(() => {
    posJumpLock = false;
  }, instant ? 80 : 480);
}

function onLexiconPosScroll(): void {
  if (posJumpLock) return;
  const rootEl = document.querySelector('.lexicon-block--senses');
  if (!rootEl) return;
  const header = document.querySelector('.top') as HTMLElement | null;
  const marker = (header?.getBoundingClientRect().bottom || 0) + 20;
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

function bindLexiconPane(): void {
  if (stripMode) {
    document.querySelector('.page')?.addEventListener('scroll', onLexiconPosScroll, { passive: true });
  }
  if (lexiconPos) {
    highlightLexiconPosTab(lexiconPos);
    jumpToLexiconPos(lexiconPos, true);
  }
}

function onClick(e: Event): void {
  const t = (e.target as HTMLElement | null)?.closest?.('[data-act]') as HTMLElement | null;
  if (!t) return;
  const act = t.dataset.act;
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
        if (next === 'offline') await refreshPacks();
        paint();
      }
      return;
    }
    case 'ocr':
      await runOcr();
      return;
    case 'scan-close':
      scan = null;
      paint();
      return;
    case 'scan-word': {
      const picked = (window.getSelection()?.toString() || '').trim() || t.dataset.q || '';
      if (!picked) return;
      await lookup(extractLookupQuery(picked));
      return;
    }
    case 'back':
      if (histIndex > 0) {
        histIndex -= 1;
        await lookup(history[histIndex], true);
      }
      return;
    case 'fwd':
      if (histIndex < history.length - 1) {
        histIndex += 1;
        await lookup(history[histIndex], true);
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
      if (query) await lookup(query);
      else paint();
      return;
    }
    case 'from':
    case 'to':
      return;
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
      await pulseSpeak(t, speakText(t.dataset.lemma || '', prefs));
      return;
    case 'nb-more': {
      const def = t.previousElementSibling as HTMLElement | null;
      if (!def) return;
      def.classList.toggle('is-clamped');
      t.textContent = def.classList.contains('is-clamped') ? 'Show more' : 'Show less';
      return;
    }
    case 'nb-refresh':
      await refreshNotebook();
      paint();
      return;
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
    case 'keys-save': {
      root.querySelectorAll<HTMLInputElement>('[data-pref]').forEach((el) => {
        const key = el.dataset.pref as keyof MobilePrefs;
        if (key) (prefs as unknown as Record<string, unknown>)[key] = el.value;
      });
      persistPrefs();
      toast('Keys saved on this device');
      return;
    }
    case 'key-save': {
      const key = t.dataset.pref as keyof MobilePrefs | undefined;
      if (!key) return;
      const input = root.querySelector<HTMLInputElement>(`[data-pref="${key}"]`);
      if (input) (prefs as unknown as Record<string, unknown>)[key] = input.value;
      persistPrefs();
      toast(key === 'googleKey' ? 'Google API key saved' : key === 'deeplKey' ? 'DeepL API key saved' : 'Key saved');
      return;
    }
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
    case 'audio-on':
      prefs.audioEnabled = (t as HTMLInputElement).checked;
      persistPrefs();
      return;
    case 'audio-speed':
      return;
    case 'strip-on':
      prefs.floatingStrip = (t as HTMLInputElement).checked;
      persistPrefs();
      if (hasNativeBridge()) {
        void nativeCall('setFloatingStrip', { enabled: prefs.floatingStrip }).then(async () => {
          if (prefs.floatingStrip && capture.platform === 'android') {
            await nativeCall('requestNotifications', {}).catch(() => undefined);
          }
          await refreshCapture();
          paint();
        });
      }
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
    case 'pack-refresh':
      packMsg = '';
      await refreshPacks();
      paint();
      return;
    default:
      return;
  }
}

function onChange(e: Event): void {
  const el = e.target as HTMLElement | null;
  if (!el) return;
  if (el.id === 'from') {
    prefs.sourceLang = (el as HTMLSelectElement).value;
    persistPrefs();
    if (query) void lookup(query);
  } else if (el.id === 'to') {
    prefs.targetLang = (el as HTMLSelectElement).value;
    persistPrefs();
    if (query) void lookup(query);
  } else if (el.id === 'q') {
    draft = (el as HTMLInputElement).value;
  } else if (el.id === 'nbq') {
    notebookFilter = (el as HTMLInputElement).value;
    paint();
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
  applyInsets();
  applyPrefsToCore(prefs);
  await refreshCapture();
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onChange);
  paint();
  window.addEventListener('scroll', onLexiconPosScroll, { passive: true });
  await sqlWarm();
  await refreshNotebook();
  void fillEmptyCards();
  await refreshPacks();
  startIncomingText((text, origin) => {
    if (origin === 'process-text' || origin === 'share') {
      postOsNotify('incoming', 'Incoming lookup', text);
    }
    void lookup(text);
  });
  if (hasNativeBridge()) {
    try {
      const pending = await nativeCall<{ text?: string; origin?: string }>('getPendingText', {});
      if (pending.text) await lookup(pending.text);
    } catch {
      /* none */
    }
  }
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
    }>('getCapturePrefs', {});
    if (typeof next.floatingStrip === 'boolean') prefs.floatingStrip = next.floatingStrip;
    capture = {
      platform: next.platform === 'ios' ? 'ios' : 'android',
      canDrawOverlays: !!next.canDrawOverlays,
      notificationsGranted: !!next.notificationsGranted,
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
