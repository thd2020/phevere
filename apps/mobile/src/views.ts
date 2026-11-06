import { langBarHtml, langSheetHtml, type LangSide } from './picker';
import { buildOcrPage, rawFromLegacyWords, rawFromNativeLines, type LegacyScanWord, type NativeScanLine, type OcrPage } from '@phevere/core/ocr-layout';
import { ocrBarHtml } from '@phevere/core/ocr-view';
import {
  abbreviatePos,
  canonicalPos,
  picturableSense,
  formatVocabLangPair,
  saveLemma,
  stripGlossText,
  exampleKey as coreExampleKey,
  tidyExample,
  type Definition,
  type DictionaryResult,
  type Pronunciation,
  type SenseImage,
  type Translation,
  type VocabEntry,
  type WikipediaResult,
  vocabListHtml,
  addToBookButtonHtml,
  canAddToWordBook,
  vocabAzLetter,
  AZ_INDEX,
  compareAz,
  inflectionsHtml,
  formLineHtml,
  didYouMeanHtml,
  senseLabelLead,
  senseNotesHtml,
  posGrammarHtml,
  phrasesHtml,
  languageSwitchHtml,
  definitionSourcesHtml,
  wordFamilyHtml,
  linkHtml,
  linkText,
  wikiLinkLookup,
  pruneGlossLinks,
  morphemeSections,
  morphemeOfferHtml,
  morphemeOf,
  type OwnWords,
  analyzeNotebook,
  cardsHtml,
  familiesHtml,
  familiesTraceProgress,
  mapHtml,
  notebookViewSwitchHtml,
  recentListHtml,
  learnHtml,
  type LearnPage,
  type AnswerRecord,
  type CardLayouts,
  cardLayoutIn,
  type FamilyGrouping,
  type MorphKind,
  type NotebookView,
  type RecentLookup,
  type ReviewState,
  type ReviewRenderOptions,
  type VocabViewEntry,
  scopeEntries,
  wordbookHeaderHtml,
  wordbookLibraryHtml,
  wordbookListHtml,
  wordsScopeSwitchHtml,
  sourcesHtml,
  type WordsContext,
  type WordsScope,
  type BookSort,
  filterVocabByLang,
  languageName,
  vocabLangChipsHtml,
  vocabLanguages,
} from '@phevere/core';

export type Tab = 'lookup' | 'notebook' | 'learn' | 'settings';
export type ResultTab = 'lexicon' | 'translation' | 'wikipedia' | 'etymology';

export function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain text of an HTML snippet (Wikipedia extracts), entities decoded. */
function htmlToText(s: string): string {
  const raw = String(s || '');
  if (!/[<&]/.test(raw)) return raw;
  try {
    return (new DOMParser().parseFromString(raw, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return stripGlossText(raw);
  }
}

const ICO = {
  scan: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 9.5h8M8 12.5h8M8 15.5h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  go: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  open: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  export: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M12 15V4M7 9l5-5 5 5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  import: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M12 4v11M7 10l5 5 5-5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  recent: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  az: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M3.5 17 7 7l3.5 10M4.8 13.5h4.4M14 7h6l-6 10h6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  web: '<svg viewBox="0 0 24 24" class="ico-line"><path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  back: '<svg viewBox="0 0 24 24"><path d="M15.5 19.5 8 12l7.5-7.5 1.5 1.5L11 12l6 6z"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M8.5 4.5 16 12l-7.5 7.5-1.5-1.5 6-6-6-6z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M12 17.5A3.5 3.5 0 1 0 8.5 14 3.5 3.5 0 0 0 12 17.5zM9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.7-4.3-9.3-8.1C.7 10.2 1.2 6.6 4 5.1 6.1 4 8.6 4.6 12 7.4 15.4 4.6 17.9 4 20 5.1c2.8 1.5 3.3 5.1 1.3 7.8C18.7 16.7 12 21 12 21z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M3 10v4h3l4 4V6L6 10zm13.5 2A4.5 4.5 0 0 0 14 8.1v7.8A4.5 4.5 0 0 0 16.5 12z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M6 4h11a3 3 0 0 1 3 3v13H8a2 2 0 0 0-2 2V4zm2 2v12h10V7a1 1 0 0 0-1-1H8z"/></svg>',
  learn: '<svg viewBox="0 0 24 24"><path d="M7 2h2v2h6V2h2v2h1.5A2.5 2.5 0 0 1 21 6.5v12a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-12A2.5 2.5 0 0 1 5.5 4H7zM5 9v9.5a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V9zm5.6 8.2-3.3-3.3 1.4-1.4 1.9 1.9 4.6-4.6 1.4 1.4z"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
  tabLexicon: '<svg viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round"><path d="M3.5 5.5c2.8-1.2 5.6-1.2 8.5.6 2.9-1.8 5.7-1.8 8.5-.6v13c-2.8-1.2-5.6-1.2-8.5.6-2.9-1.8-5.7-1.8-8.5-.6z"/><path d="M12 6.1v13"/></svg>',
  tabTranslation: '<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>',
  tabWikipedia: '<svg viewBox="0 0 24 24"><text x="12" y="17.5" text-anchor="middle" font-family="Georgia, serif" font-size="17" font-weight="700">W</text></svg>',
  tabEtymology: '<svg viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M12 21v-9M12 12 6.5 6.5M12 12l5.5-5.5M12 15.5l-3.5-3M6.5 6.5V3.5M17.5 6.5V3.5M4 21h16"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.7 7.7 0 0 0 .1-2l2-1.5-2-3.5-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3h-6l-.4 3a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.7 7.7 0 0 0 .1 2l-2 1.5 2 3.5 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 3h6l.4-3a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.5zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/></svg>',
};

export function navHtml(tab: Tab): string {
  const item = (id: Tab, label: string, svg: string) => `
    <button type="button" data-act="tab" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>
      <span class="ico">${svg}</span>${label}
    </button>`;
  return `<nav class="nav" aria-label="Primary">${item('lookup', 'Lookup', ICO.search)}${item('notebook', 'Words', ICO.book)}${item('learn', 'Learn', ICO.learn)}${item('settings', 'Settings', ICO.gear)}</nav>`;
}

/** One top bar for every tab: the same "Phevere" title and the account button; Lookup adds history and search. */
export function appBarHtml(tab: Tab, query: string, canBack: boolean, canFwd: boolean, accountBtn = ''): string {
  const lookup = tab === 'lookup';
  return `
    <div class="top">
      <div class="brand-row">
        <h1>Phevere</h1>
        <div class="brand-end">
        ${lookup ? `<div class="hist">
          <button type="button" class="icon-btn" data-act="back" ${canBack ? '' : 'disabled'} aria-label="Back">${ICO.back}</button>
          <button type="button" class="icon-btn" data-act="fwd" ${canFwd ? '' : 'disabled'} aria-label="Forward">${ICO.fwd}</button>
        </div>` : ''}
        ${accountBtn}
        </div>
      </div>
      ${lookup ? `<form class="search">
        <input id="q" type="search" enterkeyhint="search" placeholder="Look up a word or phrase" value="${esc(query)}" autocomplete="off" />
        <button type="button" class="icon-btn" data-act="ocr" aria-label="Scan text" title="Scan text">${ICO.scan}</button>
        <button type="submit" class="go" aria-label="Look up" title="Look up">${ICO.go}</button>
      </form>` : ''}
    </div>`;
}

/** Pop-up: one slim row — history on the left, open-in-app and close on the right. */
export function popupBarHtml(canBack: boolean, canFwd: boolean, hasWord = false): string {
  return `
    <div class="popup-bar">
      <button type="button" class="icon-btn" data-act="back" ${canBack ? '' : 'disabled'} aria-label="Back">${ICO.back}</button>
      <button type="button" class="icon-btn" data-act="fwd" ${canFwd ? '' : 'disabled'} aria-label="Forward">${ICO.fwd}</button>
      <span class="popup-bar__gap"></span>
      ${hasWord ? `<button type="button" class="icon-btn" data-act="copy" aria-label="Copy" title="Copy">${ICO.copy}</button>
      <button type="button" class="icon-btn" data-act="web-search" aria-label="Search the web" title="Search the web">${ICO.web}</button>` : ''}
      <button type="button" class="icon-btn" data-act="expand-strip" aria-label="Open in Phevere" title="Open in Phevere">${ICO.expand}</button>
      <button type="button" class="icon-btn" data-act="close-strip" aria-label="Close">${ICO.close}</button>
    </div>`;
}

/** Older cached results may still carry Wiktionary markup after the IPA. */
function displayIpa(raw: string): string {
  const s = String(raw || '')
    .replace(/<[\s\S]*$/, '')
    .replace(/\{\{[\s\S]*$/, '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .trim();
  return /[<>{}|=]/.test(s) ? '' : s;
}

function ipaChip(ipa: string, accent: string, shown: string): string {
  const tag = accent === 'us' ? 'US' : accent === 'uk' ? 'UK' : '';
  const label = tag ? `${tag} pronunciation` : 'pronunciation';
  return `<span class="ipa-chip">${tag ? `<b>${tag}</b>` : ''}${esc(shown)}<button type="button" data-act="speak-ipa" data-ipa="${esc(ipa)}" data-accent="${esc(accent)}" aria-label="Play ${label}" title="Play ${label}">${ICO.speaker}</button></span>`;
}

function ipaChips(list: Pronunciation[] | undefined, fallback: string): string {
  const used = new Set<string>();
  const chips: string[] = [];
  for (const p of list || []) {
    const clean = displayIpa(p?.ipa);
    if (!clean) continue;
    const accent = p.accent || 'other';
    const key = `${accent}:${clean}`;
    if (used.has(key)) continue;
    used.add(key);
    chips.push(ipaChip(clean, accent, `/${clean}/`));
  }
  if (chips.length) return `<div class="ipa-chips">${chips.join('')}</div>`;
  const line = String(fallback || '').replace(/<[\s\S]*$/, '').trim();
  if (!line) return '';
  const shown = line.includes('/') ? line : `/${line.replace(/^\/+|\/+$/g, '')}/`;
  const ipa = (shown.match(/\/([^/]+)\//) || [])[1] || line.replace(/^\/+|\/+$/g, '');
  return ipa
    ? `<div class="ipa-chips">${ipaChip(ipa, 'other', shown)}</div>`
    : `<p class="ipa-line">${esc(shown)}</p>`;
}

/** The core's comparison, so results saved before it changed also show a sentence once. */
function exampleKey(s: string): string {
  return coreExampleKey(stripGlossText(s));
}

function uniqueExamples(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ex of list || []) {
    const k = exampleKey(ex);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(ex);
  }
  return out;
}

function sourceName(src: string): string {
  const s = (src || '').trim();
  const key = s.toLowerCase();
  if (!s || key === 'freedictionaryapi' || key === 'free dictionary api') return 'Free Dictionary';
  if (key === 'wiktionary') return 'Wiktionary';
  if (key === 'datamuse') return 'Datamuse';
  if (key.includes('oxford')) return 'Oxford';
  if (key.includes('wordnet')) return 'WordNet';
  if (key.includes('webster') || key.includes('gcide')) return 'Webster 1913';
  if (key.includes('cedict')) return 'CC-CEDICT';
  if (key.includes('freedict')) return 'FreeDict';
  if (key.includes('wordsapi') || key === 'wordsapi') return 'WordsAPI';
  if (key.includes('collins')) return 'Collins';
  if (key.includes('youdao')) return 'Youdao';
  if (key.includes('tatoeba')) return 'Tatoeba';
  return s;
}

function usableDef(d: Definition): boolean {
  if (!d || d.source === 'Fallback' || d.source === 'Timeout') return false;
  const m = stripGlossText(d.meaning || '');
  if (!m || m === 'No definition available.') return false;
  if (/lookup timed out/i.test(m)) return false;
  return true;
}

function railTab(id: string, label: string, active: string): string {
  const on = id === active;
  return `<button type="button" class="lexicon-pos-tab${on ? ' is-active' : ''}" role="tab" data-act="lex-pos" data-pos="${esc(id)}" aria-selected="${on}">${esc(label)}</button>`;
}

function railBlock(sections: Array<{ id: string; label: string }>, active: string): string {
  if (!sections.length) return '';
  return `<div class="lexicon-rail-block">${sections.map((s) => railTab(s.id, s.label, active)).join('')}</div>`;
}

function wrapGroup(id: string, label: string, inner: string, extraHead = ''): string {
  const head = label ? `<div class="lexicon-pos-heading"><span>${esc(label)}</span>${extraHead}</div>` : '';
  return `<div class="lexicon-pos-group" data-pos="${esc(id)}">${head}${inner}</div>`;
}

function wrapPane(inner: string, extra = ''): string {
  return `<div class="card lexicon-pane${extra ? ` ${extra}` : ''}">${inner}</div>`;
}

/** Desktop behaviour: "plural of X", "past tense of X" … link X to a lookup in place. */
const FORM_OF = /\b((?:the\s+)?(?:plural|past(?:\s+tense)?|simple\s+past|present(?:\s+participle)?|gerund|(?:past|present)\s+participle|third-person\s+singular(?:\s+simple\s+present)?|alternative\s+(?:form|spelling)|(?:common\s+)?misspelling|obsolete\s+(?:form|spelling)|archaic\s+(?:form|spelling)|inflection|conjugated\s+form)\s+of)\s+([A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'-]*)/gi;

function linkLemmaRefs(escaped: string): string {
  return escaped.replace(
    FORM_OF,
    (_m, phrase: string, lemma: string) =>
      `${phrase} <button type="button" class="lemma-link" data-act="lookup" data-q="${lemma}">${lemma}</button>`,
  );
}

/**
 * Sense text for display. Wiktionary HTML keeps its /wiki/ links as in-place lookups (as on
 * desktop); plain text links "plural of X" and the like. Every other word links to its own
 * lookup and looks like text until tapped.
 */
function senseHtml(d: Definition, hide: string[] = []): string {
  return linkHtml(senseLabelLead(senseMarkup(d.meaning), d, hide), 'act');
}

function senseMarkup(raw: string): string {
  const plain = String(raw || '');
  if (!/<[a-z][\s\S]*>/i.test(plain)) return linkLemmaRefs(esc(stripGlossText(plain)));
  const meaning = pruneGlossLinks(plain);
  const links: Array<{ title: string; text: string }> = [];
  const marked = meaning.replace(/<a\s[^>]*?href=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi, (_full, _q, href: string, inner: string) => {
    const m = String(href).match(/\/wiki\/([^?#]+)/i);
    const text = stripGlossText(inner);
    if (!m || !text) return inner;
    let title = '';
    try {
      title = decodeURIComponent(m[1].replace(/_/g, ' '));
    } catch {
      title = m[1].replace(/_/g, ' ');
    }
    title = wikiLinkLookup(title);
    if (!title) return inner;
    links.push({ title, text });
    return `\u0001${links.length - 1}\u0002`;
  });
  return esc(stripGlossText(marked))
    .replace(/\u0001(\d+)\u0002/g, (_m, i: string) => {
      const l = links[Number(i)];
      return l ? `<button type="button" class="lemma-link" data-act="lookup" data-q="${esc(l.title)}">${esc(l.text)}</button>` : '';
    })
    .replace(/<\/button>\s+([,.;:!?)])/g, '</button>$1')
    // A button is an atomic box, so the comma after a link could start the next line.
    .replace(/(<button [^>]*>[^<]*<\/button>)([,.;:!?)]+)/g, '<span class="nobr">$1$2</span>');
}

/** The definitions the Lexicon shows, in the core's order. Sense pictures are indexed by it. */
export function lexiconSenses(result: DictionaryResult | null): Definition[] {
  return (result?.definitions || []).filter(usableDef);
}

/**
 * A sense picture: a fixed aspect box (from the thumbnail's size, clamped between 3:4 and
 * 16:10) so text never moves when the bytes arrive. Tapping it shows it larger, with its title
 * and a credit line whose link opens the file page on Wikimedia Commons.
 */
export function senseFigureHtml(img: SenseImage, index: number): string {
  const label = `${img.title} — ${img.credit}`;
  // Every figure has the same 4:3 box as the placeholder kept for it, so nothing moves when it
  // arrives; the picture is cropped to fill it, and opening it shows it whole.
  return `<figure class="sense-figure" data-sense-figure="${index}" style="--ar:${SENSE_FIGURE_RATIO}">
    <button type="button" class="sense-figure__frame" data-act="sense-figure" data-full="${esc(img.url || img.thumb)}" data-thumb="${esc(img.thumb)}" data-title="${esc(img.title)}" data-credit="${esc(img.credit)}" data-page="${esc(img.pageUrl)}" aria-label="${esc(label)}" title="${esc(label)}">
      <img src="${esc(img.thumb)}" alt="${esc(img.title)}" decoding="async" referrerpolicy="no-referrer" onload="this.parentNode.classList.add('is-loaded')" onerror="this.closest('figure').remove()" />
    </button>
    <figcaption class="sense-figure__credit"><button type="button" class="sense-figure__link" data-act="sense-credit" data-url="${esc(img.pageUrl)}">${esc(img.credit)}</button></figcaption>
  </figure>`;
}

const SENSE_FIGURE_RATIO = '1.333';

/** The box a sense's picture will take, kept while pictures load so the text does not move. */
export function senseFigurePlaceholder(index: number): string {
  return `<figure class="sense-figure is-pending" data-sense-figure="${index}" style="--ar:${SENSE_FIGURE_RATIO}" aria-hidden="true"><span class="sense-figure__frame"></span></figure>`;
}

/** The sources one sense was merged from. */
function citeOf(d: Definition | undefined): string[] {
  return Array.isArray(d?.sources) && d!.sources!.length
    ? d!.sources!
    : String(d?.source || '')
        .split(/\s*·\s*/)
        .filter(Boolean);
}

function renderSenses(
  senses: Definition[],
  shown: Set<string>,
  indexOf: Map<Definition, number>,
  images: Array<SenseImage | null> | null,
  reserve: Set<number> = new Set(),
  hide: string[] = [],
  headword = '',
): string {
  return senses
    .map((d, i) => {
      const at = indexOf.get(d) ?? -1;
      const img = images && at >= 0 ? images[at] : null;
      const examples = uniqueExamples(d.examples || []);
      examples.forEach((ex) => shown.add(exampleKey(ex)));
      const exHtml = examples.length
        ? `<div class="definition-examples">${examples
            .map((ex) => `<div class="definition-example">${linkText(tidyExample(stripGlossText(ex)), 'act')}</div>`)
            .join('')}</div>`
        : '';
      return `<div class="definition-item" data-sense="${at}">
        <div class="definition-sense-row">
          <div class="definition-sense-num">${i + 1}</div>
          <div class="definition-sense-body">
            ${img ? senseFigureHtml(img, at) : !images && reserve.has(at) ? senseFigurePlaceholder(at) : ''}
            <div class="definition-text">${senseHtml(d, hide)}</div>
            ${exHtml}
            ${senseNotesHtml(d, 'act', headword)}
          </div>
        </div>
      </div>`;
    })
    .join('');
}

function lexiconPane(
  result: DictionaryResult,
  activePos: string,
  images: Array<SenseImage | null> | null,
  own: OwnWords = { mine: [], books: [] },
): string {
  const defs = lexiconSenses(result);
  if (!defs.length) return `<div class="card empty">No definitions found.${didYouMeanHtml(result, 'act')}</div>`;
  const indexOf = new Map<Definition, number>(defs.map((d, i) => [d, i]));

  const groups = new Map<string, Definition[]>();
  const order: string[] = [];
  for (const d of defs) {
    const pos = canonicalPos(d.partOfSpeech);
    if (!groups.has(pos)) {
      groups.set(pos, []);
      order.push(pos);
    }
    groups.get(pos)!.push(d);
  }

  const shown = new Set<string>();
  // While pictures load, the first noun sense keeps its box when it names something you can see
  // (the sense most likely to get one); "patience" keeps none.
  const firstNoun = defs.findIndex((d) => canonicalPos(d.partOfSpeech) === 'noun');
  const seen = firstNoun >= 0 && picturableSense({ meaning: defs[firstNoun].meaning, partOfSpeech: 'noun' }, result.word || '');
  const reserve = new Set<number>(images === null && seen ? [firstNoun] : []);
  let posInner = '';
  // Senses with no part of speech are "other" beside real ones, and need no heading alone.
  const several = order.length > 1;
  const posSections = order.map((pos) => {
    const unknown = pos === 'unknown';
    // "noun [uncountable]": a code every sense shares goes on the heading instead.
    const code = posGrammarHtml(result.headGrammar?.[pos]);
    posInner += wrapGroup(
      pos,
      unknown ? (several ? 'other' : '') : pos,
      renderSenses(groups.get(pos) || [], shown, indexOf, images, reserve, code.hide, result.word || ''),
      code.html,
    );
    return { id: pos, label: unknown ? (several ? 'other' : 'senses') : abbreviatePos(pos) };
  });
  posInner += definitionSourcesHtml(defs.flatMap((d) => citeOf(d).map(sourceName)));
  let allInner = wrapPane(posInner, 'lexicon-pane--pos');

  const globalExamples = uniqueExamples(result.examples || [])
    .filter((ex) => !shown.has(exampleKey(ex)))
    .slice(0, 8);
  const syn = result.synonyms || [];
  const ant = result.antonyms || [];
  const formsHtml = inflectionsHtml(result.inflections, result.word || '', 'act');
  const formsSections: Array<{ id: string; label: string }> = [];
  if (formsHtml) {
    formsSections.push({ id: 'forms', label: 'forms' });
    allInner += wrapPane(wrapGroup('forms', 'forms', formsHtml));
  }

  const exampleSections: Array<{ id: string; label: string }> = [];
  if (globalExamples.length) {
    exampleSections.push({ id: 'examples', label: 'examples' });
    allInner += wrapPane(
      wrapGroup(
        'examples',
        'examples',
        globalExamples.map((ex) => `<div class="example-item">${linkText(tidyExample(stripGlossText(ex)), 'act')}</div>`).join(''),
      ),
    );
  }

  const relatedSections: Array<{ id: string; label: string }> = [];
  let relatedInner = '';
  if (syn.length) {
    relatedSections.push({ id: 'synonyms', label: 'synonyms' });
    relatedInner += wrapGroup('synonyms', 'synonyms', `<div class="example-item">${linkText(syn.join(', '), 'act')}</div>`);
  }
  if (ant.length) {
    relatedSections.push({ id: 'antonyms', label: 'antonyms' });
    relatedInner += wrapGroup('antonyms', 'antonyms', `<div class="example-item">${linkText(ant.join(', '), 'act')}</div>`);
  }
  if (relatedInner) allInner += wrapPane(relatedInner);

  // Phrasal verbs, idioms and set phrases get a section of their own, as in learner dictionaries.
  const phraseSections: Array<{ id: string; label: string }> = [];
  const phraseHtml = phrasesHtml(result.wordFamily, 'act', result.word || '', groups.has('verb'));
  if (phraseHtml) {
    phraseSections.push({ id: 'phrases', label: 'phrases' });
    allInner += wrapPane(wrapGroup('phrases', 'phrases', phraseHtml));
  }

  const familySections: Array<{ id: string; label: string }> = [];
  const familyHtml = wordFamilyHtml(result.wordFamily, 'act', { phrases: false });
  if (familyHtml) {
    familySections.push({ id: 'family', label: 'family' });
    allInner += wrapPane(wrapGroup('family', 'word family', familyHtml));
  }

  // A prefix, suffix or root: its spellings and origin, the learner's words and the words built on it.
  const morphSections = morphemeSections(result, own, 'act');
  for (const s of morphSections) allInner += wrapPane(wrapGroup(s.id, s.label, `<div class="lx-family">${s.html}</div>`));

  const tocIds = [
    ...posSections.map((s) => s.id),
    ...morphSections.map((s) => s.id),
    ...formsSections.map((s) => s.id),
    ...exampleSections.map((s) => s.id),
    ...relatedSections.map((s) => s.id),
    ...phraseSections.map((s) => s.id),
    ...familySections.map((s) => s.id),
  ];
  const active = activePos && tocIds.includes(activePos) ? activePos : tocIds[0] || '';
  const tabs = [
    railBlock(posSections, active),
    railBlock(morphSections, active),
    railBlock(formsSections, active),
    railBlock(exampleSections, active),
    railBlock(relatedSections, active),
    railBlock(phraseSections, active),
    railBlock(familySections, active),
  ].join('');

  return `<div class="lexicon-block--senses">
    <div class="lexicon-pos-layout">
      <nav class="lexicon-pos-tabs" role="tablist" aria-label="Lexicon sections">
        <div class="lexicon-rail-inner">${tabs}</div>
      </nav>
      <div class="lexicon-pos-panel">${allInner}</div>
    </div>
  </div>`;
}

export type { LangSide } from './picker';
export type PickerId = LangSide;

/** Skeleton card that stands where a tab's content will land. */
function tabPending(label: string): string {
  return `<div class="tab-pending" role="status" aria-label="${esc(label)}"><div class="skel-card" aria-hidden="true"><span class="skel skel-line w-label"></span><span class="skel skel-line w-90"></span><span class="skel skel-line w-75"></span><span class="skel skel-line w-55"></span></div></div>`;
}

/** Lookup in flight: the word in the headword face, shimmer where IPA, rail and senses land. */
export function lookupSkeleton(query: string): string {
  const word = query.length > 60 ? `${query.slice(0, 60)}…` : query;
  return `<div class="loading" role="status" aria-live="polite" aria-label="Looking up">
    <div class="skel-head">
      <div class="skel-word">${esc(word)}</div>
      <div class="skel-chips" aria-hidden="true"><span class="skel skel-pill"></span><span class="skel skel-pill"></span></div>
    </div>
    <div class="skel-body" aria-hidden="true">
      <div class="skel-rail"><span class="skel"></span><span class="skel"></span></div>
      <div class="skel-card">
        <span class="skel skel-line w-label"></span>
        <span class="skel skel-line w-90"></span>
        <span class="skel skel-line w-75"></span>
        <span class="skel skel-line w-90 w-gap"></span>
        <span class="skel skel-line w-55"></span>
      </div>
    </div>
  </div>`;
}

function languageLabel(code: string): string {
  const c = String(code || '').trim();
  if (!c) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(c) || c;
  } catch {
    return c;
  }
}

function friendlyTranslationSource(src?: string): string {
  const s = String(src || '').toLowerCase();
  if (s.includes('deepl')) return 'DeepL';
  if (s.includes('youdao')) return 'Youdao';
  if (s.includes('mymemory')) return 'MyMemory';
  if (s.includes('google') || s.includes('unofficial')) return 'Google';
  return '';
}

function translationCard(word: string, t: Translation, wordLang: string): string {
  const provider = friendlyTranslationSource(t.source);
  const tgt = t.language || 'en';
  return `<div class="translation-card">
    ${provider ? `<div class="translation-card__provider">via ${esc(provider)}</div>` : ''}
    <div class="translation-card__pair">
      <div class="translation-card__line">
        <div>
          <div class="translation-card__label">${esc(languageLabel(wordLang) || 'Source')}</div>
          <div class="translation-card__original">${esc(word)}</div>
        </div>
        <button type="button" class="icon-btn tx-speak" data-act="speak-text" data-text="${esc(word)}" data-lang="${esc(wordLang)}" aria-label="Play source" title="Play source">${ICO.speaker}</button>
      </div>
      <div class="translation-card__line">
        <div>
          <div class="translation-card__label">${esc(languageLabel(tgt))}</div>
          <div class="translation-card__text">${esc(t.text)}</div>
          ${t.pronunciation ? `<div class="translation-card__pron">${esc(t.pronunciation)}</div>` : ''}
        </div>
        <button type="button" class="icon-btn tx-speak" data-act="speak-text" data-text="${esc(t.text)}" data-lang="${esc(tgt)}" aria-label="Play translation" title="Play translation">${ICO.speaker}</button>
      </div>
    </div>
  </div>`;
}

function translationPane(
  result: DictionaryResult,
  langs: { code: string; name: string; nativeName: string }[],
  sourceLang: string,
  targetLang: string,
  langMenu: PickerId | '',
  recentLangs: string[],
): string {
  const list = result.translations || [];
  const pending = !!result.metadata?.pendingTranslation && !list.length;
  const wordLang = result.detectedLanguage || (sourceLang !== 'auto' ? sourceLang : '') || 'en';
  const body = list.length
    ? list.map((t) => translationCard(result.word, t, wordLang)).join('')
    : pending
      ? tabPending('Translating')
      : '<div class="error-message">No translation found.</div>';
  return `
    ${langBarHtml(langs, sourceLang, targetLang)}
    ${langMenu ? langSheetHtml(langMenu, langs, langMenu === 'from' ? sourceLang : targetLang, recentLangs) : ''}
    ${body}`;
}

export type WikiArticle = { title: string; url: string; html: string; lang: string };

function wikiPane(
  items: WikipediaResult[],
  wikiLang: string,
  article: WikiArticle | null,
  loading: boolean,
  error: string,
): string {
  if (article) {
    return `<section class="wikipedia-card wikipedia-reader">
      <div class="wikipedia-reader__bar">
        <button type="button" class="icon-btn" data-act="wiki-back" aria-label="Back">${ICO.back}</button>
        <div class="wikipedia-reader__title">${esc(article.title)}</div>
        <button type="button" class="icon-btn" data-act="wiki-ext" data-url="${esc(article.url)}" aria-label="Open in browser" title="Open in browser">${ICO.open}</button>
      </div>
      ${loading ? `<p class="status"><span class="md-spinner"></span> Loading article…</p>` : ''}
      ${error ? `<p class="status">${esc(error)}</p>` : ''}
      <iframe id="wiki-frame" class="wikipedia-reader__frame" title="${esc(article.title)}" referrerpolicy="no-referrer" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
    </section>`;
  }
  const list = items
    .map(
      (it, i) => `<button type="button" class="wikipedia-item" data-act="wiki-open" data-i="${i}">
        <div class="wikipedia-item__title">
          ${it.thumbnail ? `<img src="${esc(it.thumbnail)}" alt="" loading="lazy" />` : ''}
          <span class="wikipedia-item__name">${esc(it.title)}</span>
        </div>
        <div class="wikipedia-item__extract">${esc(htmlToText(it.extract || ''))}</div>
      </button>`,
    )
    .join('');
  const empty = error
    ? '<div class="error-message">Wikipedia lookup failed.</div>'
    : loading
      ? ''
      : '<div class="error-message">No Wikipedia articles found.</div>';
  return `<section class="wikipedia-card">
    <div class="wikipedia-card__header">
      <span>Wikipedia</span>
      <span class="wikipedia-card__lang">${esc(wikiLang)}</span>
    </div>
    <div class="wikipedia-card__body">
      ${loading && !list ? tabPending('Searching Wikipedia') : ''}
      ${list || empty}
    </div>
  </section>`;
}

function splitEtymologySources(etymologyText: string): Array<{ label: string; body: string }> {
  if (!etymologyText) return [];
  return etymologyText
    .split(/\n\n--- Alternative etymology ---\n\n/)
    .map((chunk, i) => {
      let body = chunk.trim();
      const labelMatch = body.match(/^\[([^\]]+)\]\s*\n([\s\S]*)$/);
      let label = i === 0 ? 'Primary' : `Alt ${i + 1}`;
      if (labelMatch) {
        label = labelMatch[1].trim() || label;
        body = labelMatch[2].trim();
      }
      // Older cached Wiktionary text opens with the reversed "English ← …" line the chain now shows.
      body = body.replace(/^English ← [^\n]*(\n\n|$)/, '').trim();
      return { label, body: stripGlossText(body) };
    })
    .filter((s) => {
      if (!s.body) return false;
      if (/go-to source|internet'?s go-to|quick and reliable accounts of the origin/i.test(s.body)) return false;
      return true;
    });
}

function formatEtymologyBody(body: string): string {
  const plain = stripGlossText(body || '');
  const sentences = plain.split(/(?<=[.!?。！？])\s+/).filter((s) => s.trim().length > 2);
  const paint = (sentence: string): string =>
    esc(sentence)
      .replace(
        /\b(Root|Origin|Etymology|Cognate with|Doublet of|来自|引申|词源)\b/gi,
        '<span class="etymology-keyword">$1</span>',
      )
      .replace(
        /\b(Proto-Indo-European|Proto-Germanic|Proto-Italic|Proto-Hellenic|Proto-Celtic|Ancient Greek|Late Latin|Medieval Latin|Old English|Middle English|Old French|Middle French|Anglo-Norman|Old Norse|Old High German|Middle Dutch|Old Occitan|Old Provençal|Anglo-Saxon|Latin|Greek|French|German|Italian|Spanish|Portuguese|Dutch|Arabic|Persian|Sanskrit|Gothic)\b/gi,
        '<span class="etymology-language">$1</span>',
      )
      .replace(/\*[\p{L}\p{M}\u02b0-\u02ff\u2080-\u2089-]+/gu, '<span class="etymology-reconstructed">$&</span>')
      .replace(/(\d+)(st|nd|rd|th)\s+century/gi, '<span class="etymology-century">$&</span>')
      .replace(/\b(BCE?|CE|AD|BC)\b/g, '<span class="etymology-era">$1</span>');
  const inner = (sentences.length ? sentences : [plain])
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<div class="etymology-sentence">${linkHtml(paint(s), 'act')}</div>`)
    .join('');
  return `<div class="etymology-text">${inner}</div>`;
}

/** How each older form reached the next, read left to right. */
const ETYMOLOGY_STEP: Record<string, string> = {
  inherited: 'inherited',
  borrowed: 'borrowed',
  'learned borrowing': 'learned borrowing',
  'semi-learned borrowing': 'borrowed',
  derived: 'derived',
  calque: 'calque',
  root: 'root',
};

/** The first sense of a gloss, so one long gloss does not stretch the line. */
function shortGloss(gloss?: string): string {
  const first = String(gloss || '').split(/[,;]/)[0].trim();
  return first.length > 28 ? '' : first;
}

/** Oldest ancestor first, ending at the headword, as on desktop. */
function formatEtymologyChain(result: DictionaryResult): string {
  const found = (result.etymologyChain || []).slice(0, 8).filter((l) => l && (l.term || l.language || l.languageCode));
  if (!found.length) return '';
  // A root names the oldest ancestor wherever Wiktionary placed its template.
  const links = [...found.filter((l) => l.relation !== 'root'), ...found.filter((l) => l.relation === 'root')];
  const node = (lang: string, term: string, gloss: string, isHead: boolean): string =>
    `<span class="etymology-chain__node${isHead ? ' is-head' : ''}"><span class="etymology-chain__lang">${esc(lang)}</span>${
      term
        ? isHead
          ? `<span class="etymology-chain__term">${esc(term)}</span>`
          : `<span class="etymology-chain__term lx-w" role="link" tabindex="0" data-act="lookup" data-q="${esc(term)}">${esc(term)}</span>`
        : ''}${
      gloss ? `<span class="etymology-chain__gloss">“${esc(gloss)}”</span>` : ''}</span>`;
  const step = (rel: string): string => {
    const label = ETYMOLOGY_STEP[rel] || '';
    return `<span class="etymology-chain__step" aria-hidden="true">${label ? `<span class="etymology-chain__rel">${esc(label)}</span>` : ''}<span class="etymology-chain__arrow">→</span></span>`;
  };
  const parts: string[] = [];
  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    parts.push(node(l.language || l.languageCode || '', l.term || '', shortGloss(l.gloss), false));
    parts.push(step(l.relation));
  }
  parts.push(node('English', result.word || '', '', true));
  return `<div class="etymology-chain" role="list" aria-label="Word history, oldest first">${parts.join('')}</div>`;
}

export function etymologyEntryUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'www.etymonline.com' &&
      !url.username && !url.password && !url.port && /^\/word\/[^/]+\/?$/.test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}

function etymPane(result: DictionaryResult, selectedSource = ''): string {
  const sources: Array<{ label: string; body: string; unavailable?: string; url?: string }> = splitEtymologySources(result.etymology || '');
  const unavailable = result.metadata?.etymologyUnavailable?.find((s) => s.source === 'Etymonline' && (s.status === 'blocked' || s.status === 'unavailable'));
  if (unavailable && !sources.some((s) => s.label.split(' · ')[0].toLowerCase() === 'etymonline')) {
    const url = etymologyEntryUrl(unavailable.url);
    if (url) sources.push({ label: 'Etymonline', body: '', unavailable: unavailable.status, url });
  }
  const pending = !!(result.metadata && result.metadata.pendingEtymology);
  if (pending && !sources.length) return tabPending('Loading etymology');
  if (!sources.length) return `<div class="etymology-no-data"><p><strong>No etymology found.</strong></p></div>`;
  const activeIndex = Math.max(0, sources.findIndex((s) => s.label === selectedSource));
  const tabs = sources
    .map(
      (s, i) =>
        `<button type="button" class="etymology-tab${i === activeIndex ? ' is-active' : ''}" data-act="ety-tab" data-i="${i}" data-source="${esc(s.label)}">${esc(s.label)}</button>`,
    )
    .join('');
  const panels = sources
    .map(
      (s, i) =>
        `<div class="etymology-panel-body" data-ety-panel="${i}" ${i === activeIndex ? '' : 'hidden'}>${s.unavailable
          ? `<div class="etymology-unavailable"><p>${s.unavailable === 'blocked' ? 'Etymonline blocked this request.' : 'Etymonline is unavailable.'}</p><button type="button" class="etymology-open-entry" data-act="ety-open" data-url="${esc(s.url || '')}">Open on Etymonline</button></div>`
          : formatEtymologyBody(s.body)}</div>`,
    )
    .join('');
  return `<section class="card etymology-card">
    ${formatEtymologyChain(result)}
    <div class="etymology-layout">
      <nav class="etymology-tabs" aria-label="Etymology sources">${tabs}</nav>
      <div class="etymology-panel">${panels}</div>
    </div>
  </section>`;
}

export function lookupBody(opts: {
  looking: boolean;
  status: string;
  result: DictionaryResult | null;
  saved: VocabEntry | null;
  resultTab: ResultTab;
  langs: { code: string; name: string; nativeName: string }[];
  sourceLang: string;
  targetLang: string;
  langMenu: PickerId | '';
  recentLangs: string[];
  wiki: WikipediaResult[];
  wikiLang: string;
  wikiArticle: WikiArticle | null;
  wikiLoading: boolean;
  wikiError: string;
  lexiconPos: string;
  etymologySource?: string;
  query?: string;
  error?: string;
  recent?: RecentLookup[];
  /** The notebook entry for a recent word, so its row can show the pronunciation. */
  savedFor?: (q: string) => VocabViewEntry | undefined;
  /** Copy and web search sit in the head; the pop-up carries them in its bar instead. */
  headTools?: boolean;
  /** Pictures for `lexiconSenses(result)`, index for index, once they have loaded. */
  senseImages?: Array<SenseImage | null> | null;
  /** Saved words and word-book words, for a morpheme page's "my words". */
  ownWords?: OwnWords;
  /** The learner has books of their own: the save control and recent rows offer "Add to word book". */
  bookPick?: boolean;
  /** The word the heart saves, which "Add to word book" adds too. */
  saveWord?: string;
}): string {
  if (opts.looking && !opts.result) return lookupSkeleton(opts.query || '');
  if (opts.error && !opts.result) {
    return `<div class="error-message">Could not look up "${esc(opts.query || '')}".<small>${esc(opts.error || 'Unknown error')}</small></div>`;
  }
  if (opts.status && !opts.result) return `<p class="status">${esc(opts.status)}</p>`;
  if (!opts.result) {
    const recent = (opts.recent || []).filter((r) => r && r.q);
    return `<div class="empty">
      <p>Type a word, or select text in another app.</p>
    </div>
    ${recent.length ? `<section class="recent-lookups" aria-label="Recent lookups">
      <h3 class="recent-lookups__title">Recent</h3>
      <div class="vocab-list">${recentListHtml(recent, opts.savedFor || (() => undefined), Date.now(), { bookPick: opts.bookPick })}</div>
    </section>` : ''}`;
  }
  const chips = ipaChips(opts.result.pronunciations, opts.result.pronunciation || '');
  const lemma = saveLemma(opts.result);
  // A word part ("ob-", "*bʰeh₂-") has no translation, article, recorded voice or notebook entry.
  const part = !!morphemeOf(opts.result);
  const tabs: ResultTab[] = part ? ['lexicon', 'etymology'] : ['lexicon', 'translation', 'wikipedia', 'etymology'];
  const icons: Record<ResultTab, string> = {
    lexicon: ICO.tabLexicon,
    translation: ICO.tabTranslation,
    wikipedia: ICO.tabWikipedia,
    etymology: ICO.tabEtymology,
  };
  const labels: Record<ResultTab, string> = {
    lexicon: 'Lexicon',
    translation: 'Translation',
    wikipedia: 'Wikipedia',
    etymology: 'Etymology',
  };
  const resultTab: ResultTab = part && !tabs.includes(opts.resultTab) ? 'lexicon' : opts.resultTab;
  const pane =
    resultTab === 'translation'
      ? translationPane(opts.result, opts.langs, opts.sourceLang, opts.targetLang, opts.langMenu, opts.recentLangs)
      : resultTab === 'wikipedia'
        ? wikiPane(opts.wiki, opts.wikiLang, opts.wikiArticle, opts.wikiLoading, opts.wikiError)
        : resultTab === 'etymology'
          ? etymPane(opts.result, opts.etymologySource)
          : lexiconPane(opts.result, opts.lexiconPos, opts.senseImages || null, opts.ownWords);
  return `
    <div class="lookup-flow">
    <header class="head">
      ${formLineHtml(opts.result)}
      <div class="word">
        <h2 class="lemma" style="--len:${[...String(opts.result.word || lemma)].length}">${esc(opts.result.word || lemma)}</h2>
        ${morphemeOfferHtml(opts.result, 'act')}
      </div>
      <div class="head-actions">
        ${opts.headTools ? `<button type="button" class="icon-btn" data-act="copy" aria-label="Copy" title="Copy">${ICO.copy}</button>
        <button type="button" class="icon-btn" data-act="web-search" aria-label="Search the web" title="Search the web">${ICO.web}</button>` : ''}
        ${part ? '' : `<button type="button" class="tonal" data-act="speak" aria-label="Play pronunciation">${ICO.speaker}</button>
        <button type="button" class="tonal ${opts.saved ? 'saved' : ''}" data-act="save" aria-label="${opts.saved ? 'Remove from My words' : 'Save to My words'}">${ICO.heart}</button>
        ${opts.bookPick && opts.saveWord && canAddToWordBook(opts.result) ? addToBookButtonHtml(opts.saveWord, 'tonal') : ''}`}
      </div>
      ${chips}
      ${languageSwitchHtml(opts.result, 'act', { fold: false })}
    </header>
    <div class="result-tabs" role="tablist">
      ${tabs.map((t) => `<button type="button" class="result-tab" role="tab" data-act="result-tab" data-tab="${t}" aria-selected="${resultTab === t}" aria-label="${labels[t]}" title="${labels[t]}">${icons[t]}</button>`).join('')}
    </div>
    ${pane}
    </div>`;
}

export interface NotebookViewState {
  view: NotebookView;
  group: FamilyGrouping;
  mapKinds: MorphKind[];
  flipped: Set<string>;
  /** Expanded or not, per list ('mine', a book's id, 'all'). */
  cardLayouts: CardLayouts;
  /** Every saved word; the list pages through the notebook, the other views need all of it. */
  pool: VocabEntry[];
  /** The language chip chosen above My words ('all' when none is). */
  lang: string;
}

/** The Learn tab: today's review session over the list the Words tab has chosen. */
export interface LearnState {
  review: ReviewState;
  goal: number;
  /** Every saved word. */
  pool: VocabEntry[];
  reviewOptions?: ReviewRenderOptions;
  page: LearnPage;
  /** The answer history for Progress; null until loaded. */
  history: AnswerRecord[] | null;
  notice?: string;
}

export function learnBody(learn: LearnState, words: WordsState): string {
  return `<div class="nbv lrn">${learnHtml({
    scope: words.scope,
    ctx: words.ctx,
    mine: learn.pool,
    review: learn.review,
    goal: learn.goal,
    options: learn.reviewOptions,
    page: learn.page,
    history: learn.history,
    notice: learn.notice,
  })}</div>`;
}

/** Word books on the Words tab: which list is showing, whether the library is open, and the data. */
export interface WordsState {
  scope: WordsScope;
  library: boolean;
  ctx: WordsContext | null;
  limit: number;
  sort: BookSort;
  open: Set<string>;
  loading: Set<string>;
  /** The learner has books of their own: rows offer "Add to word book". */
  bookPick?: boolean;
}

export function notebookBody(
  entries: VocabEntry[],
  sort: 'recent' | 'az',
  filter: string,
  expanded: Set<string>,
  nb: NotebookViewState,
  words?: WordsState,
): string {
  const q = filter.trim().toLowerCase();
  const ctx = words?.ctx || null;
  const switcher = ctx ? `<div class="nbv nb-books">${wordsScopeSwitchHtml(words!.scope, ctx, words!.library)}</div>` : '';
  if (ctx && words!.library) return `${switcher}<div class="nbv nbv-body">${wordbookLibraryHtml(ctx)}</div>`;
  if (ctx && words!.scope === 'sources') return `${switcher}<div class="nbv nbv-body">${sourcesHtml(ctx)}</div>`;
  if (ctx && words!.scope !== 'mine') return switcher + bookScopeBody(words!, ctx, filter, nb);
  // Words saved in several languages: a chip per language, counted over the whole notebook.
  const everything = nb.pool.length > entries.length ? nb.pool : entries;
  const langs = vocabLanguages(everything);
  const langChips = vocabLangChipsHtml(langs, nb.lang, everything.length, languageName);
  const langOn = !!langChips && nb.lang !== 'all';
  // A chosen language filters the whole notebook, not only the page the list has loaded.
  const source = langOn ? filterVocabByLang(everything, nb.lang, langs) : entries;
  let list = ctx ? source.map((e) => ({ ...e, books: ctx.index.get(e.lemma.trim().toLowerCase()) })) : [...source];
  if (sort === 'az') list.sort((a, b) => compareAz(a.lemma, b.lemma));
  // Saved order: reviews and sync bump updatedAt, which must not move words.
  else list.sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
  const matches = (e: VocabEntry) =>
    [e.lemma, e.reading, e.definition, e.partOfSpeech, e.note, ...(e.sources || []), e.context?.doc, e.context?.title, e.context?.sentence]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  let unfiltered = list;
  if (q) list = list.filter(matches);
  const head = `${switcher}
    <div class="nb-head">
      <input id="nbq" type="search" class="vocab-search" placeholder="Search words…" value="${esc(filter)}" autocomplete="off" aria-label="Search words" />
      ${nb.view === 'list' ? `<div class="vocab-sort" role="group" aria-label="Sort">
        <button type="button" class="vocab-sort-btn${sort === 'recent' ? ' is-active' : ''}" data-act="nb-sort" data-sort="recent" aria-pressed="${sort === 'recent'}" aria-label="Most recent first" title="Recent">${ICO.recent}</button>
        <button type="button" class="vocab-sort-btn${sort === 'az' ? ' is-active' : ''}" data-act="nb-sort" data-sort="az" aria-pressed="${sort === 'az'}" aria-label="Alphabetical" title="A–Z">${ICO.az}</button>
      </div>` : ''}
    </div>
    ${langChips ? `<div class="nbv nb-langs">${langChips}</div>` : ''}
    <div class="nbv nb-views">${notebookViewSwitchHtml(nb.view)}</div>`;
  if (nb.view !== 'list') {
    // The list pages through the notebook; the other views need all of it.
    if (!langOn && nb.pool.length > entries.length) {
      const all = [...nb.pool]
        .map((e) => (ctx ? { ...e, books: ctx.index.get(e.lemma.trim().toLowerCase()) } : e))
        .sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
      list = q ? all.filter(matches) : all;
      if (nb.view === 'map') unfiltered = all;
    }
    // The map always holds every word; the search flies to a word on it instead.
    const analysis = analyzeNotebook(nb.view === 'map' ? unfiltered : list);
    const body =
      nb.view === 'families'
        ? familiesHtml(analysis, nb.group, { tracing: familiesTraceProgress() })
        : nb.view === 'map'
          ? mapHtml(analysis, nb.mapKinds, { query: filter.trim() })
          : cardsHtml(list, analysis, nb.flipped, cardLayoutIn(nb.cardLayouts, 'mine'), undefined, { picFlips: true, list: 'mine' });
    return `${head}<div class="nbv nbv-body">${body}</div>`;
  }
  const rows = vocabListHtml(list, { sort, expanded, bookPick: !!words?.bookPick });
  return `${head}
    <div class="ptr" aria-hidden="true"><span class="md-spinner"></span></div>
    <div class="vocab-list">${rows || `<p class="empty">${q ? 'No matching words.' : 'No saved words.'}</p>`}</div>
    ${sort === 'az' && list.length ? vocabAzRail(new Set(list.map((e) => vocabAzLetter(e.lemma)))) : ''}`;
}

/** A word book or All books: the same views over the book's words, with the book's header. */
function bookScopeBody(words: WordsState, ctx: WordsContext, filter: string, nb: NotebookViewState): string {
  const q = filter.trim().toLowerCase();
  const all = scopeEntries(words.scope, ctx);
  const list = q ? all.filter((e) => e.lemma.toLowerCase().includes(q)) : all;
  const head = `${wordbookHeaderHtml(words.scope, ctx)}
    <div class="nb-head">
      <input id="nbq" type="search" class="vocab-search" placeholder="Search this book…" value="${esc(filter)}" autocomplete="off" aria-label="Search this book" />
    </div>
    <div class="nbv nb-views">${notebookViewSwitchHtml(nb.view)}</div>`;
  let body: string;
  if (nb.view === 'list') body = wordbookListHtml(list, { scope: words.scope, limit: words.limit, filtered: !!q, sort: words.sort, expanded: words.open, loading: words.loading, bookPick: words.bookPick });
  else {
    const study = nb.view === 'map' ? all : list;
    const analysis = analyzeNotebook(study);
    body =
      nb.view === 'families'
        ? familiesHtml(analysis, nb.group, { tracing: familiesTraceProgress() })
        : nb.view === 'map'
          ? mapHtml(analysis, nb.mapKinds, { query: filter.trim() })
          : cardsHtml(study, analysis, nb.flipped, cardLayoutIn(nb.cardLayouts, String(words.scope)), undefined, { picFlips: true, list: String(words.scope) });
  }
  return `<div class="nbv">${head}</div><div class="nbv nbv-body">${body}</div>`;
}

function vocabAzRail(present: Set<string>): string {
  return `<nav class="vocab-az" data-az-rail aria-label="Jump to letter">${AZ_INDEX
    .map((l) => `<button type="button" class="vocab-az__letter${present.has(l) ? '' : ' is-empty'}" data-letter="${l}">${l}</button>`)
    .join('')}</nav>
    <div class="vocab-az-hud" hidden aria-hidden="true"></div>`;
}

/** One OCR word from an older native build: its box as fractions of the picture; l is its line. */
export type ScanWord = LegacyScanWord;
/**
 * What the native scanner returns: the picture, and its text as lines with quads (fractions of
 * the picture), words and confidences; older builds send only `words`.
 */
export type ScanPage = { jpeg: string; width: number; height: number; words?: ScanWord[]; lines?: NativeScanLine[]; engine?: string };

/** The page model of a scan, laid out for reading (packages/core/src/ocr-layout.ts). */
export function scanOcrPage(scan: ScanPage): OcrPage {
  const w = Number(scan.width) || 1, h = Number(scan.height) || 1;
  const engine = scan.engine || 'phone';
  const raw = Array.isArray(scan.lines) && scan.lines.length
    ? rawFromNativeLines(scan.lines, w, h, engine)
    : rawFromLegacyWords(scan.words || [], w, h, engine);
  return buildOcrPage(raw);
}

/**
 * Scan: the picture fills the screen with its recognised text in place, real text over its own
 * pixels like Live Text, so a long press selects a word. Text shows the recognised text alone;
 * Edit changes it in place. The lookup opens in a bottom sheet over the picture.
 */
export function scanHtml(scan: ScanPage, page: OcrPage, id: number): string {
  const empty = !page.blocks.length;
  return `
    <div class="scan-view ocr-view" data-scan-id="${id}" data-mode="picture">
      <div class="scan-main">
        <div class="scan-stage">
          <div class="scan-canvas">
            <div class="scan-frame ocr-frame" data-ratio="${scan.width && scan.height ? scan.width / scan.height : 0.75}">
              <img src="data:image/jpeg;base64,${scan.jpeg}" alt="Scanned picture" draggable="false" />
              <div class="ocr-layer"></div>
            </div>
          </div>
        </div>
        <div class="ocr-text scan-text" hidden></div>
      </div>
      <button type="button" class="icon-btn scan-close" data-act="scan-close" aria-label="Back">${ICO.back}</button>
      <div class="scan-bar">${ocrBarHtml({ saveImage: true, empty })}</div>
      ${empty ? '' : '<p class="scan-hint">Select text</p>'}
      <section class="scan-sheet" data-state="closed" aria-label="Lookup">
        <div class="scan-sheet__handle" data-drag="scan-sheet" role="button" tabindex="0" aria-label="Resize lookup"><span></span></div>
        <div class="scan-sheet__body"></div>
      </section>
      <div class="scan-toast"></div>
    </div>`;
}

export type { CaptureInfo, SettingsSection, VoiceStatus } from './settings-panels';
export { MOCK_BAR } from './settings-panels';
export { SETTINGS_SECTIONS, emptyLibraryState, keyPresent, settingsBody } from './settings-panels';

