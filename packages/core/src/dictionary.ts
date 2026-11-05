export interface DictionaryResult {
  word: string;
  pronunciation?: string;
  pronunciations?: Pronunciation[];
  definitions: Definition[];
  translations: Translation[];
  examples: string[];
  synonyms?: string[];
  antonyms?: string[];
  etymology?: string;
  /** Structured ancestry parsed from Wiktionary etymology templates. */
  etymologyChain?: EtymologyLink[];
  /** Derivatives, related words, phrases and affixes: links, not extra senses. */
  wordFamily?: WordFamilyGroup[];
  /** Tenses, participles, plural, possessive, cases and degrees; "plural of mouse" for a form. */
  inflections?: WordInflections;
  language?: string;
  detectedLanguage?: string;
  sources: string[]; // Track which APIs were used
  metadata?: {
    isSentence?: boolean;
    sourceLanguage?: string;
    targetLanguage?: string;
    originalTargetLanguage?: string;
    etymologyUnavailable?: EtymologyUnavailable[];
    [key: string]: any;
  };
}

export interface EtymologyUnavailable {
  source: 'Etymonline';
  status: 'blocked' | 'unavailable';
  url: string;
  code: string;
}

type EtymonlineResult = { text?: string; unavailable?: EtymologyUnavailable };
type EtymologyResult = { text?: string; chain?: EtymologyLink[]; unavailable?: EtymologyUnavailable[] };

function etymonlineUnavailable(word: string, code: string): EtymonlineResult {
  return { unavailable: {
    source: 'Etymonline',
    status: code === 'HTTP_403' || code === 'HTTP_429' ? 'blocked' : 'unavailable',
    url: `https://www.etymonline.com/word/${encodeURIComponent(word)}`,
    code,
  } };
}

function etymologyErrorCode(error: unknown): string {
  if (error instanceof DictionaryError) return error.code;
  return /timeout|timed out|abort/i.test(error instanceof Error ? error.message : String(error)) ? 'TIMEOUT' : 'NETWORK_ERROR';
}

export interface Definition {
  partOfSpeech: string;
  meaning: string;
  synonyms?: string[];
  antonyms?: string[];
  examples?: string[];
  /** Primary display label; may list multiple cites joined with " · ". */
  source: string;
  /** All citing sources after intelligent merge. */
  sources?: string[];
  /** Lower = earlier in Free Dictionary / Wiktionary (common-reading order). */
  senseOrder?: number;
  /** SemCor tag count of the WordNet sense this sense aligns to (English only; see sense-frequency.ts). */
  frequency?: number;
  /** The looked-up form's own sense from a source that usually gives its lemma's (definition-merge.ts). */
  ownSense?: boolean;
}

import { BaseService, DictionaryError, withTimeout } from './base';
import { registerWiktionaryWikitextSource } from './sense-images';
import { checkApiKey, type ApiKeyCheck, type ApiProviderId } from './api-key-check';
import { detectLanguageLocal, englishCandidateWords, isAmbiguousHan, remoteFitsScript } from './lang-detect';
import { isCmuWord, warmCmuIpa } from './cmu-ipa';
import { fetchInflections, hasInflections, selectInflections, type WordInflections } from './inflections';
import { closestSpelling } from './vocab-lemma';
import { wrapConsole } from './log';
import { getHttp, getLookupCache, getLookupOffline, getSha256Hex, isCoreConfigured, type OfflineHit } from './runtime';
import { registerHeadwordResolver } from './vocab-store';
import { normalizeQuery, cacheKeyFor, trimEdges, sanitize, NormalizedQuery, foldLatinHeadword, foldLookupKey, exactQuery, exactLookupKey, hasEdgePunctuation } from './text-normalize';
import { isGrammaticalFormOfGloss, splitSurfaceAndLemma, sameLookupFold, stripGlossText } from './lookup-policy';
import { datamuseEntry, formLine, formOfGlossLemma, formOfLemmaFromGlosses, isCitationGloss, isOwnNounGloss, resolveFormOf } from './form-of';
import { buildEtymology, EtymologyLink } from './etymology';
import { lookupMorpheme, morphemeOffers, parseMorphemeQuery } from './morpheme';
import { groupYoudaoEtymologies, sameHeadword, serializeEtymologySources } from './etymology-sources';
import { mergeSimilarDefinitions, dedupeExamples, exampleKey, tidyExample, canonicalPos, sortDefinitionsByReadingOrder, stripCrossLemmaSenses, formOfSensesLast } from './definition-merge';
import { orderSensesByFrequency, warmSenseFrequency } from './sense-frequency';
import {
  Pronunciation,
  parseFreeDictionaryPhonetics,
  extractIpaFromWikitext,
  mergePronunciations,
  formatPronunciationLine,
  cleanIpa,
} from './pronunciation';
import { arpabetToIpa, cmuIpaFor } from './cmu-ipa';
import {
  buildWordFamily,
  mergeWordFamilyGroups,
  mergeWordFamilyGroupsFor,
  familyFromEtymologyChain,
  familyFromKaikki,
  fetchFamilyFrequencies,
  familyStem,
  rankFamilyByFrequency,
  type FamilyFrequencies,
  type WordFamilyGroup,
} from './word-family';
import {
  fetchJisho,
  fetchKaikki,
  fetchKaikkiPage,
  kaikkiDirectory,
  fetchOpenRussian,
  fetchWiktionaryEdition,
  editionServes,
  isNameOnlyGloss,
  kaikkiLanguage,
  KAIKKI_ALL_LANGUAGES,
  KAIKKI_FALLBACK_LANGUAGES,
  WIKTIONARY_EDITIONS,
  type SourceSenses,
  type WiktionaryEdition,
} from './multilingual-sources';

const console = wrapConsole('dictionary');
/** Hard ceiling so renderer IPC never waits forever (etymology / hung hosts). */
const LOOKUP_DEADLINE_MS = 12000;
const IPA_BUDGET_MS = 1500;
const OFFLINE_BUDGET_MS = 2000;
/** Coalesce window so a fast FreeDict hit rides with Webster instead of a second paint. */
const CORE_WAIT_WITH_LOCAL_MS = 450;
/** Longest wait for network defs when local packs missed. Normally the first primary hit ends it. */
const CORE_WAIT_WITHOUT_LOCAL_MS = 2500;
/** After Free Dictionary or Wiktionary returns senses, how long the others get to join the first paint. */
const FIRST_PAINT_GRACE_MS = 200;
/** Late pieces (translation, IPA, etymology) that land together go out as one update. */
const UPDATE_COALESCE_MS = 120;
/** A result missing a failed source is cached, but only this long, so the source gets another try. */
const PARTIAL_CACHE_TTL_MS = 10 * 60 * 1000;
/** Persistent entries are kept this long. */
const PERSISTED_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const PARTIAL_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;
/** Longest wait for the tagged page that says whether a word is a form of another. */
const FORM_CHECK_MS = 3500;
/** Longest a result that may be a form is held back while that page is on its way. */
const FORM_HOLD_MS = 1200;
/** Longest wait for whether Wiktionary has a page titled exactly as typed ("etc.", "C++"). */
const EXACT_TITLE_MS = 1500;
/**
 * Stored on every result saved since forms opened as their word (2026-11-04); a saved result
 * without it is looked up again once. A mark, not a date: partial results are saved with an
 * earlier time so they expire sooner.
 */
const FORM_RULES = 2;

/** A sense of any source that points at another headword: "plural of paparazzo", "A paparazzo." */
function pointsElsewhere(result: DictionaryResult | null | undefined): boolean {
  const word = foldLookupKey(String(result?.word || ''));
  return (result?.definitions || []).some((d) => {
    const text = stripGlossText(String(d?.meaning || ''));
    const target = formOfGlossLemma(text) || /^(?:an?|the)\s+([\p{L}'’-]+)\.?$/iu.exec(text)?.[1] || '';
    return !!target && foldLookupKey(target) !== word;
  });
}
/** A source whose host keeps failing is skipped for this long, doubling per further failure. */
const SOURCE_DOWN_BASE_MS = 3 * 60 * 1000;
const SOURCE_DOWN_MAX_MS = 30 * 60 * 1000;

type LookupHolder = { current?: DictionaryResult };
export type TranslationProvider = 'auto' | 'youdao' | 'deepl' | 'google' | 'mymemory';

type LookupOpts = {
  skipEtymology?: boolean;
  onUpdate?: (result: DictionaryResult) => void;
  originalSelection?: string;
  /** Translation tab: try this engine first (`auto` = Google then MyMemory, then keyed APIs). */
  translationProvider?: TranslationProvider;
  /** When set (and not `auto`), skip detection and translate from this language. */
  sourceLanguage?: string;
  /** Set on the second lookup after a spelling correction, so it cannot correct again. */
  noCorrection?: boolean;
  /** Set on the lookup of the word a form stands for, so it cannot redirect again. */
  noFormRedirect?: boolean;
};

/** "plural of saving", "past tense of go": a sense that only points at another word. */
function isFormOfSense(meaning: string): boolean {
  const text = stripGlossText(String(meaning || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  return !!formOfGlossLemma(text) || isGrammaticalFormOfGloss(text);
}

/** The characters trimming took off the edges of `sanitized` to leave `trimmed` ("etc." gives "."). */
function edgeMarks(sanitized: string, trimmed: string): string[] {
  const at = trimmed ? sanitized.indexOf(trimmed) : -1;
  if (at < 0) return Array.from(sanitized);
  return Array.from(sanitized.slice(0, at) + sanitized.slice(at + trimmed.length));
}

/** The definitions of one language section of a Wiktionary REST definition page. */
function sectionSenses(page: any, lang: string): Array<{ definition?: string }> {
  const section = page && typeof page === 'object' ? page[lang] : null;
  if (!Array.isArray(section)) return [];
  return section.flatMap((e: any) => (Array.isArray(e?.definitions) ? e.definitions : [])).filter((d: any) => d && d.definition);
}

/** Whether a REST definition links to the page `title` ("Alternative form of etc." links to etc.). */
function linksToTitle(def: { definition?: string }, title: string): boolean {
  for (const m of String(def?.definition || '').matchAll(/href="\/wiki\/([^"#?]+)/g)) {
    let target = m[1];
    try {
      target = decodeURIComponent(target);
    } catch {
      /* keep the raw path */
    }
    if (target.replace(/_/g, ' ') === title) return true;
  }
  return false;
}

/** Wiktionary's senses of the looked-up word; other sources answer a form with the base word's senses. */
function wiktionarySenses(result: DictionaryResult | null | undefined): string[] {
  return (result?.definitions || [])
    .filter((d) => {
      if (!d || !/wiktionary/i.test(String(d.source || ''))) return false;
      const m = (d.meaning || '').trim();
      return !!m && m !== 'No definition available.' && !isTimeoutMeaning(m) && !isCitationGloss(m);
    })
    .map((d) => d.meaning);
}

/**
 * Whether the result may be a form of another word: one of Wiktionary's senses reads "plural of",
 * "simple past of", "alternative spelling of" and so on. Only then is the word's page read.
 */
export function mayBeFormOf(result: DictionaryResult | null | undefined): boolean {
  return wiktionarySenses(result).some((m) => !!formOfGlossLemma(m) || isGrammaticalFormOfGloss(m));
}

/**
 * The word to show and save instead, judged from Wiktionary's senses as text: every sense is a
 * form of one word ("acronyms", "gleaned", "idiosyncracy"). Datamuse and the Free Dictionary do
 * not count. A form with senses of its own ("bacteria" is also a type or strain of bacterium,
 * "glasses" are spectacles) is a word in its own right and gets null.
 */
export function formOfTextTarget(result: DictionaryResult | null | undefined): string | null {
  return formOfLemmaFromGlosses(wiktionarySenses(result), String(result?.word || ''));
}

/**
 * "Misspelling of receive." as the first sense and at least half of all senses → "receive".
 * ("accomodate" also has a Scots sense, so "every sense" would miss it.)
 */
function misspellingTarget(result: DictionaryResult | null | undefined): string | null {
  const defs = (result?.definitions || []).filter((d) => d && d.source !== 'Fallback' && d.source !== 'Timeout');
  if (!defs.length) return null;
  const targets = defs.map((d) => {
    const text = String(d.meaning || '').replace(/<[^>]+>/g, '').trim();
    // Datamuse adds the target's own sense after it: "Misspelling of receive. [To be given…]".
    const m = /^(?:a\s+)?(?:common\s+|rare\s+|nonstandard\s+)?misspelling of\s+["“]?([\p{L}'’-]+(?: [\p{L}'’-]+){0,2})/iu.exec(text);
    return m ? m[1].trim() : null;
  });
  const hits = targets.filter(Boolean).length;
  return targets[0] && hits * 2 >= defs.length ? targets[0] : null;
}

function isTimeoutMeaning(meaning?: string): boolean {
  return /lookup timed out/i.test(meaning || '');
}

/** Result `type` of a language-specific source → its name in Sources and on senses. */
const LANGUAGE_SOURCE_LABELS: Record<string, string> = {
  jisho: 'Jisho',
  openRussian: 'OpenRussian',
  kaikki: 'Kaikki',
  'wikt-zh': WIKTIONARY_EDITIONS.zh.source,
  'wikt-ru': WIKTIONARY_EDITIONS.ru.source,
  'wikt-ja': WIKTIONARY_EDITIONS.ja.source,
};

const EDITIONS = Object.keys(WIKTIONARY_EDITIONS) as WiktionaryEdition[];

function isLocalPackSource(source?: string): boolean {
  const k = (source || '').toLowerCase();
  return /wordnet|webster|gcide|cedict|freedict|jmdict|kengdic|^offline$/.test(k);
}

export interface Translation {
  language: string;
  text: string;
  pronunciation?: string;
  confidence?: number;
  source?: string; // Track which API was used
  detectedSourceLanguage?: string; // Detected source language from translation API
}

export interface DictionarySource {
  name: string;
  priority: number;
  isAvailable: boolean; // Whether the source is technically available (keys, data loaded)
  enabled: boolean;     // User preference toggle
}

export class DictionaryService extends BaseService {
  // Wikimedia throttles unidentified clients to 10 req/min; a descriptive
  // User-Agent with contact info raises that to 200 req/min.
  // https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
  private static readonly WIKIMEDIA_USER_AGENT =
    'Phevere/1.0 (https://github.com/thd2020/phevere; desktop dictionary)';

  private cache = new Map<string, { result: DictionaryResult; timestamp: number; ttl?: number }>();
  private cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
  /**
   * Lookups still filling in (translation, etymology, IPA pending). A second request for
   * the same key gets the latest partial result and joins the remaining updates.
   */
  private inflight = new Map<string, { latest?: DictionaryResult; listeners: Set<(r: DictionaryResult) => void> }>();
  /** Consecutive network failures per source; a source that keeps failing is skipped for a while. */
  private sourceHealth = new Map<string, { fails: number; downUntil: number }>();
  /** Skip Google gtx while it is 429ing; MyMemory still runs. */
  private googleGtxCoolUntil = 0;
  private cmuWarm = setTimeout(() => warmCmuIpa(), 0);
  /** A failed remote detection pauses it, so a blocked host does not slow every lookup. */
  private remoteDetectCoolUntil = 0;
  private remoteDetectMemo = new Map<string, string>();
  /** Per-source layer: a Datamuse hit must not freeze a Free Dictionary timeout for 24h. */
  private sourceLayer = new Map<string, { status: 'ok' | 'empty' | 'fail'; data?: unknown; ts: number }>();
  private sourceEmptyTtlMs = 6 * 60 * 60 * 1000;
  private sourceFailBackoffMs = 8_000;
  private apiKey: string | null = null;
  private deeplApiKey: string | null = null;
  // Premium/aggregator/specialized credentials
  private oxfordAppId: string | null = null;
  private oxfordAppKey: string | null = null;
  private wordsApiKey: string | null = null;
  private wordsApiHost: string = 'wordsapiv1.p.rapidapi.com';
  private collinsApiKey: string | null = null;
  private collinsApiHost: string | null = null;
  private youdaoAppKey: string | null = null;
  private youdaoAppSecret: string | null = null;

  // CC-CEDICT optional in-memory index
  private ccCedictData = new Map<string, string>();
  private ccCedictLoaded = false;
  private sources: DictionarySource[] = [
    { name: 'Free Dictionary API', priority: 1, isAvailable: true,  enabled: true },
    { name: 'DeepL API',           priority: 2, isAvailable: false, enabled: false },
    { name: 'Google Translate API',priority: 3, isAvailable: false, enabled: false },
    { name: 'Wiktionary',          priority: 4, isAvailable: true,  enabled: true },
    { name: 'Oxford Dictionary API', priority: 0, isAvailable: false, enabled: false },
    { name: 'Collins Dictionary API', priority: 1, isAvailable: false, enabled: false },
    { name: 'WordsAPI',            priority: 5, isAvailable: false, enabled: false },
    { name: 'Youdao API',          priority: 0, isAvailable: false, enabled: false },
    { name: 'CC-CEDICT',           priority: 2, isAvailable: false, enabled: false },
    { name: 'Datamuse',            priority: 6, isAvailable: true,  enabled: true },
    { name: 'Tatoeba',             priority: 7, isAvailable: true,  enabled: true },
    // Non-English headwords with English glosses; each runs only for its language.
    { name: 'Jisho',               priority: 3, isAvailable: true,  enabled: true },
    { name: 'OpenRussian',         priority: 3, isAvailable: true,  enabled: true },
    { name: 'Kaikki',              priority: 5, isAvailable: true,  enabled: true },
    // Definitions written in Chinese, Russian or Japanese; off until switched on in Sources.
    { name: 'Chinese Wiktionary',  priority: 5, isAvailable: true,  enabled: false },
    { name: 'Russian Wiktionary',  priority: 5, isAvailable: true,  enabled: false },
    { name: 'Japanese Wiktionary', priority: 5, isAvailable: true,  enabled: false }
  ];

  constructor(apiKey?: string, deeplApiKey?: string) {
    super();
    this.apiKey = apiKey || null;
    this.deeplApiKey = deeplApiKey || null;
    this.updateSourceAvailability();
    // Sense pictures read the same Wiktionary page the lookup already fetched and cached.
    registerWiktionaryWikitextSource((word) => this.getWiktionaryWikitext(word));
  }

  /**
   * Set Google Translate API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.updateSourceAvailability();
  }

  /**
   * Set DeepL API key
   */
  setDeepLApiKey(deeplApiKey: string): void {
    this.deeplApiKey = deeplApiKey;
    this.updateSourceAvailability();
  }

  /** Set Oxford API credentials */
  setOxfordCredentials(appId: string, appKey: string): void {
    this.oxfordAppId = appId || null;
    this.oxfordAppKey = appKey || null;
    this.updateSourceAvailability();
  }

  /** Set Youdao API credentials */
  setYoudaoCredentials(appKey: string, appSecret: string): void {
    this.youdaoAppKey = appKey || null;
    this.youdaoAppSecret = appSecret || null;
    this.updateSourceAvailability();
  }

  /** Set WordsAPI (RapidAPI) credentials */
  setWordsApiCredentials(rapidApiKey: string, rapidApiHost?: string): void {
    this.wordsApiKey = rapidApiKey || null;
    if (rapidApiHost) this.wordsApiHost = rapidApiHost;
    this.updateSourceAvailability();
  }

  /** Set Collins Dictionary (RapidAPI) credentials */
  setCollinsApiCredentials(rapidApiKey: string, rapidApiHost: string): void {
    this.collinsApiKey = rapidApiKey || null;
    this.collinsApiHost = rapidApiHost || null;
    this.updateSourceAvailability();
  }

  /**
   * Set or clear one credential field by its Settings name (googleKey, youdaoSecret, …),
   * leaving the provider's other fields as they are.
   */
  setApiCredential(field: string, value: string): void {
    const v = String(value ?? '').trim() || null;
    switch (field) {
      case 'googleKey': this.apiKey = v; break;
      case 'deeplKey': this.deeplApiKey = v; break;
      case 'youdaoKey': this.youdaoAppKey = v; break;
      case 'youdaoSecret': this.youdaoAppSecret = v; break;
      case 'oxfordId': this.oxfordAppId = v; break;
      case 'oxfordKey': this.oxfordAppKey = v; break;
      case 'wordsKey': this.wordsApiKey = v; break;
      case 'collinsKey': this.collinsApiKey = v; break;
      case 'collinsHost': this.collinsApiHost = v; break;
      default: return;
    }
    this.updateSourceAvailability();
  }

  /** Which providers have credentials saved, without exposing them (Settings → API keys). */
  getApiKeyPresence(): Record<ApiProviderId, boolean> {
    return {
      google: !!this.apiKey,
      deepl: !!this.deeplApiKey,
      youdao: !!this.youdaoAppKey && !!this.youdaoAppSecret,
      oxford: !!this.oxfordAppId && !!this.oxfordAppKey,
      wordsapi: !!this.wordsApiKey,
      collins: !!this.collinsApiKey && !!this.collinsApiHost,
    };
  }

  /** Test the saved credentials for one provider with a minimal real request. */
  async verifyApiKey(provider: ApiProviderId): Promise<ApiKeyCheck> {
    let sha: ((s: string) => string | Promise<string>) | undefined;
    try {
      sha = getSha256Hex();
    } catch {
      sha = undefined;
    }
    return checkApiKey(
      getHttp(),
      provider,
      {
        googleKey: this.apiKey,
        deeplKey: this.deeplApiKey,
        youdaoKey: this.youdaoAppKey,
        youdaoSecret: this.youdaoAppSecret,
        oxfordId: this.oxfordAppId,
        oxfordKey: this.oxfordAppKey,
        wordsKey: this.wordsApiKey,
        wordsHost: this.wordsApiHost,
        collinsKey: this.collinsApiKey,
        collinsHost: this.collinsApiHost,
      },
      sha,
    );
  }

  /** Load CC-CEDICT data from URL (optional) */
  async loadCcCedictFromUrl(url: string): Promise<boolean> {
    try {
      return await this.loadCcCedictViaNodeFetch(url);
    } catch (_err) {
      return false;
    }
  }

  private async loadCcCedictViaNodeFetch(url: string): Promise<boolean> {
    try {
      const res = await getHttp().requestText(url);
      if (!res.ok) return false;
      const text = res.text;
      let count = 0;
      text.split('\n').forEach((line: string) => {
        if (line.startsWith('#')) return;
        const match = line.match(/^(\S+)\s(\S+)\s\[(.*?)\]\s\/(.*)\//);
        if (match) {
          const [, traditional, simplified, pinyin, definition] = match;
          const entry = `${pinyin} / ${definition}`;
          this.ccCedictData.set(simplified, entry);
          this.ccCedictData.set(traditional, entry);
          count++;
        }
      });
      this.ccCedictLoaded = count > 0;
      this.updateSourceAvailability();
      return this.ccCedictLoaded;
    } catch (e) {
      console.warn('Failed to load CC-CEDICT:', e);
      return false;
    }
  }

  /**
   * Update source availability based on API keys
   */
  private updateSourceAvailability(): void {
    this.sources = this.sources.map(source => {
      if (source.name === 'Google Translate API') {
        return { ...source, isAvailable: !!this.apiKey };
      }
      if (source.name === 'DeepL API') {
        return { ...source, isAvailable: !!this.deeplApiKey };
      }
      if (source.name === 'Oxford Dictionary API') {
        return { ...source, isAvailable: !!this.oxfordAppId && !!this.oxfordAppKey };
      }
      if (source.name === 'WordsAPI') {
        return { ...source, isAvailable: !!this.wordsApiKey };
      }
      if (source.name === 'Collins Dictionary API') {
        return { ...source, isAvailable: !!this.collinsApiKey && !!this.collinsApiHost };
      }
      if (source.name === 'Youdao API') {
        return { ...source, isAvailable: !!this.youdaoAppKey && !!this.youdaoAppSecret };
      }
      if (source.name === 'CC-CEDICT') {
        return { ...source, isAvailable: this.ccCedictLoaded };
      }
      return source;
    });
  }

  /**
   * Get translation from public Google Translate endpoints (no API key).
   * gtx is often 429 after a burst; dict-chrome-ex is a second free path.
   */
  private isoLang(code: string): string {
    const c = (code || 'en').toLowerCase().replace(/_/g, '-');
    if (c === 'zh' || c.startsWith('zh-')) return 'zh-CN';
    return c.split('-')[0] || 'en';
  }

  private parseGoogleTranslatePayload(response: any, targetLanguage: string): Translation | null {
    if (Array.isArray(response) && Array.isArray(response[0]) && Array.isArray(response[0][0])) {
      let translated = '';
      try {
        translated = response[0].map((seg: any) => (Array.isArray(seg) ? seg[0] : '')).join('');
      } catch {
        translated = '';
      }
      const detected =
        typeof response[2] === 'string' ? response[2] : (response[8] && response[8][0] && response[8][0][0]) || undefined;
      if (translated) {
        const cleaned = translated
          .replace(/&quot;/g, '"')
          .replace(/[“”]/g, '"')
          .replace(/[‘’]/g, "'")
          .trim();
        if (cleaned) {
          return {
            language: targetLanguage,
            text: cleaned,
            confidence: 0.85,
            source: 'Google Translate (Unofficial)',
            detectedSourceLanguage: detected,
          };
        }
      }
    }
    if (Array.isArray(response) && typeof response[0] === 'string' && response[0].trim()) {
      return {
        language: targetLanguage,
        text: response[0].trim(),
        confidence: 0.8,
        source: 'Google Translate (Unofficial)',
      };
    }
    if (
      Array.isArray(response) &&
      Array.isArray(response[0]) &&
      typeof response[0][0] === 'string' &&
      response[0][0].trim()
    ) {
      return {
        language: targetLanguage,
        text: response[0][0].trim(),
        confidence: 0.8,
        source: 'Google Translate (Unofficial)',
      };
    }
    return null;
  }

  private async getGoogleTranslateUnofficial(text: string, targetLanguage: string, sourceLanguage: string): Promise<Translation | null> {
    try {
      let normalized = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      const MAX_TRANSLATE_LENGTH = 4500;
      if (normalized.length > MAX_TRANSLATE_LENGTH) {
        normalized = normalized.substring(0, MAX_TRANSLATE_LENGTH);
      }

      const sl = sourceLanguage && sourceLanguage !== 'auto' ? this.isoLang(sourceLanguage) : 'auto';
      const tl = this.isoLang(targetLanguage);
      const q = encodeURIComponent(normalized);
      const urls: string[] = [];
      if (Date.now() >= this.googleGtxCoolUntil) {
        urls.push(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${q}`);
      }
      urls.push(`https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${q}`);

      console.log(`Unofficial translate`, { to: tl, from: sl, chars: normalized.length, paths: urls.length });

      for (const url of urls) {
        try {
          const response = await this.request<any>(url, { timeoutMs: 5000 });
          const hit = this.parseGoogleTranslatePayload(response, targetLanguage);
          if (hit) return hit;
        } catch (error) {
          const code = error instanceof DictionaryError ? error.code : '';
          if (code === 'HTTP_429') {
            this.googleGtxCoolUntil = Date.now() + 90_000;
            console.warn('Google Translate rate-limited; cooling down 90s');
            continue;
          }
          console.warn('Unofficial Google Translate path failed', { url: url.slice(0, 64), error });
        }
      }
      return null;
    } catch (error) {
      console.warn('Unofficial Google Translate error:', error);
      return null;
    }
  }

  private async getMyMemoryTranslation(text: string, targetLanguage: string, sourceLanguage: string): Promise<Translation | null> {
    try {
      let normalized = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      if (!normalized) return null;
      if (normalized.length > 450) normalized = normalized.slice(0, 450);
      const sl = sourceLanguage && sourceLanguage !== 'auto' ? this.isoLang(sourceLanguage) : 'en';
      const tl = this.isoLang(targetLanguage);
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(normalized)}&langpair=${encodeURIComponent(`${sl}|${tl}`)}`;
      const response = await this.request<{
        responseStatus?: number;
        responseData?: { translatedText?: string };
      }>(url, { timeoutMs: 8000 });
      const translated = (response?.responseData?.translatedText || '').trim();
      if (Number(response?.responseStatus) !== 200 || !translated) return null;
      if (/MYMEMORY WARNING/i.test(translated)) return null;
      if (translated.toLowerCase() === normalized.toLowerCase()) return null;
      return {
        language: targetLanguage,
        text: translated,
        confidence: 0.7,
        source: 'MyMemory',
      };
    } catch (error) {
      console.warn('MyMemory translation failed:', error);
      return null;
    }
  }

  /**
   * Main lookup. A word part ("ob-", "-ant", "-fac-", "*bʰeh₂-") opens its morpheme page; a
   * word or phrase goes through the sources (lookupWord).
   */
  async lookup(text: string, targetLanguage: string = 'auto', enabledSources?: string[], opts?: LookupOpts): Promise<DictionaryResult> {
    const part = parseMorphemeQuery(text);
    if (part) return lookupMorpheme(part);
    return this.lookupWordOrPart(text, targetLanguage, enabledSources, opts);
  }

  /**
   * A root of Phevere's tables that is no common English word ("fac", "spect") opens the root's
   * page; "con" or "form" open the word, whose page links to the part.
   */
  private async lookupWordOrPart(text: string, targetLanguage: string, enabledSources?: string[], opts?: LookupOpts): Promise<DictionaryResult> {
    const plain = String(text || '').trim().toLowerCase();
    const root = /^[a-z]{2,8}$/.test(plain) ? morphemeOffers(plain).find((o) => o.kind === 'root') : undefined;
    if (root && (await isCmuWord(plain).catch((): null => null)) === false) {
      const page = await lookupMorpheme(root);
      if (page.definitions.length) return page;
    }
    return this.lookupWord(text, targetLanguage, enabledSources, opts);
  }

  /**
   * Word lookup - aggregates data from multiple sources with parallel processing
   */
  private async lookupWord(text: string, targetLanguage: string = 'auto', enabledSources?: string[], opts?: LookupOpts): Promise<DictionaryResult> {
    const startTime = Date.now();

    let query = normalizeQuery(text);

    if (!query.trimmed) {
      return {
        word: (text || '').trim(),
        definitions: [],
        translations: [],
        examples: [],
        sources: [],
        metadata: { isSentence: false, empty: true }
      };
    }

    if (!isCoreConfigured()) {
      throw new Error('@phevere/core: configureCore() must run before dictionary lookup');
    }

    try {
      const hintedSource = (opts?.sourceLanguage || '').toLowerCase().split('-')[0];
      const detectedLanguage =
        hintedSource && hintedSource !== 'auto' ? hintedSource : await this.detectSourceLanguage(query.trimmed);
      query = await this.withExactTitle(query, detectedLanguage);

      // Auto pairing is zh↔en (and ja/ko→en). An explicit Translation-tab target is honoured.
      const resolvedTarget = this.resolveTargetLanguage(detectedLanguage, targetLanguage);
      const txProvider = opts?.translationProvider || 'auto';
      // Switching on a Wiktionary edition must not be hidden by a result cached before it.
      const editionsOn = EDITIONS.filter((ed) => this.isNamedSourceOn(WIKTIONARY_EDITIONS[ed].source, enabledSources)).join(',');
      const cacheKey = cacheKeyFor(query, `${detectedLanguage}->${resolvedTarget}|tx:${txProvider}|ety:attributed-v1:${opts?.skipEtymology ? 'skip' : 'full'}|fam:kaikki${editionsOn ? `|wikt:${editionsOn}` : ''}`);

      const remember = (r: DictionaryResult) => {
        if (this.isUncacheableResult(r) || this.isStillFilling(r)) return;
        // A failed or missing source is usually a flaky host. Keep the result, but
        // only briefly, so the next lookup after that tries the source again.
        const partial = this.isIncompleteSourceCache(r);
        const ttl = partial ? PARTIAL_CACHE_TTL_MS : this.cacheTimeout;
        const now = Date.now();
        r.metadata = { ...(r.metadata || {}), formRules: FORM_RULES };
        this.cache.set(cacheKey, { result: r, timestamp: now, ttl });
        try {
          // Failed etymology hosts get another chance after ten minutes, even
          // after a restart. Other partial results keep the existing disk TTL.
          const partialPersistTtl = r.metadata?.etymologyUnavailable?.length ? PARTIAL_CACHE_TTL_MS : PARTIAL_PERSIST_TTL_MS;
          const savedAt = partial ? now - (PERSISTED_CACHE_TTL_MS - partialPersistTtl) : now;
          void Promise.resolve(getLookupCache()?.set(cacheKey, r, savedAt)).catch((): undefined => undefined);
        } catch {
          /* persistence optional */
        }
      };

      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < (cached.ttl ?? this.cacheTimeout)) {
        console.log(`Cache hit (${Date.now() - startTime}ms)`);
        return cached.result;
      }
      if (cached) this.cache.delete(cacheKey);

      const store = getLookupCache();
      if (store) {
        try {
          const saved = await store.get(cacheKey);
          const value = saved?.value as DictionaryResult | undefined;
          // A result without IPA is saved to expire within a day (see remember). One that has
          // longer left was saved before that rule and is looked up again.
          const left = saved ? PERSISTED_CACHE_TTL_MS - (Date.now() - saved.savedAt) : 0;
          const staleNoIpa = this.lacksIpa(value) && left > PARTIAL_PERSIST_TTL_MS;
          // Saved before forms were shown as the word they are a form of, or never checked by the
          // tagged page: looked up again ("paparazzi" kept as "A paparazzo." from the Free Dictionary).
          const meta = value?.metadata || {};
          const stalePlural =
            (!!value && !meta.formChecked && !meta.formFrom && (mayBeFormOf(value) || pointsElsewhere(value) || meta.formRules !== FORM_RULES)) ||
            // A form opened as its lemma before forms said what they are ("ran · past tense of run").
            (!!meta.formFrom && !meta.formLineChecked);
          if (saved && value && left > 0 && !staleNoIpa && !stalePlural && !this.isUncacheableResult(value)) {
            const remaining = PERSISTED_CACHE_TTL_MS - (Date.now() - saved.savedAt);
            const ttl = this.isIncompleteSourceCache(value) ? Math.min(PARTIAL_CACHE_TTL_MS, remaining) : this.cacheTimeout;
            this.cache.set(cacheKey, { result: value, timestamp: Date.now(), ttl });
            console.log(`Persistent cache hit (${Date.now() - startTime}ms)`);
            return value;
          }
        } catch {
          /* persistence optional */
        }
      }

      // Same word already loading: hand back what it has and send this caller the rest.
      const running = this.inflight.get(cacheKey);
      if (running) {
        if (opts?.onUpdate) running.listeners.add(opts.onUpdate);
        if (running.latest && this.hasRealDefinitions(running.latest)) {
          console.log(`Joined in-flight lookup (${Date.now() - startTime}ms)`);
          return running.latest;
        }
      }
      const flight = running || { listeners: new Set<(r: DictionaryResult) => void>() };
      if (!running) {
        if (opts?.onUpdate) flight.listeners.add(opts.onUpdate);
        this.inflight.set(cacheKey, flight);
        // Safety net: a background step that never settles must not pin the entry.
        setTimeout(() => {
          if (this.inflight.get(cacheKey) === flight) this.inflight.delete(cacheKey);
        }, LOOKUP_DEADLINE_MS * 2);
      }
      const decorate = (r: DictionaryResult): DictionaryResult => {
        r.detectedLanguage = detectedLanguage;
        r.metadata = {
          ...(r.metadata || {}),
          sourceLanguage: detectedLanguage,
          targetLanguage: resolvedTarget,
          originalTargetLanguage: targetLanguage,
          autoPaired: !targetLanguage || targetLanguage === 'auto' || targetLanguage === detectedLanguage,
        };
        return r;
      };

      let result: DictionaryResult;
      const holder: LookupHolder = {};
      const mergedOpts: LookupOpts = {
        ...opts,
        originalSelection: query.raw,
        onUpdate: (r) => {
          decorate(r);
          remember(r);
          flight.latest = r;
          if (!this.isStillFilling(r) && this.inflight.get(cacheKey) === flight) this.inflight.delete(cacheKey);
          for (const listener of flight.listeners) {
            try {
              listener(r);
            } catch (e) {
              console.warn('lookup update listener failed', e);
            }
          }
        },
      };

      const coreLookup =
        query.kind === 'sentence'
          ? this.handleSentenceTranslationOptimized(
              query.trimmed,
              resolvedTarget,
              detectedLanguage,
              mergedOpts,
            )
          : this.lookupWithCandidates(query, resolvedTarget, detectedLanguage, enabledSources, holder, mergedOpts);

      try {
        result = await withTimeout(coreLookup, LOOKUP_DEADLINE_MS, 'dictionary.lookup');
      } catch (deadlineErr) {
        console.warn('Lookup hit deadline; returning best-effort fallback', deadlineErr);
        if (holder.current && this.hasRealDefinitions(holder.current)) {
          result = {
            ...holder.current,
            metadata: { ...(holder.current.metadata || {}), timedOut: true },
          };
        } else {
          result = {
            word: query.trimmed,
            definitions: [
              {
                partOfSpeech: 'unknown',
                meaning: 'Lookup timed out. Check your network or try again.',
                source: 'Timeout',
              },
            ],
            translations: holder.current?.translations || [],
            examples: [],
            sources: ['Timeout'],
            metadata: { timedOut: true, isSentence: query.kind === 'sentence' },
          };
        }
      }

      decorate(result);
      remember(result);
      if (this.hasRealDefinitions(result) && (!flight.latest || !this.hasRealDefinitions(flight.latest))) {
        flight.latest = result;
      }
      if (!this.isStillFilling(result) && this.inflight.get(cacheKey) === flight) this.inflight.delete(cacheKey);
      return result;
    } catch (error) {
      console.error('❌ Dictionary lookup error:', error);
      this.handleError(error);
    }
  }

  /**
   * Default pairing when the UI asks for `auto`: CJK → English; English → Chinese.
   * An explicit target (including same-language) is left as-is.
   */
  resolveTargetLanguage(sourceLanguage: string, requestedTarget: string = 'auto'): string {
    const source = (sourceLanguage || 'en').toLowerCase().split('-')[0];
    const requested = (requestedTarget || 'auto').toLowerCase().split('-')[0];

    if (!requested || requested === 'auto') {
      return this.defaultTargetForSource(source);
    }

    return requested;
  }

  defaultTargetForSource(sourceLanguage: string): string {
    const source = (sourceLanguage || 'en').toLowerCase().split('-')[0];
    if (source === 'zh' || source === 'ja' || source === 'ko') return 'en';
    if (source === 'en') return 'zh';
    return 'en';
  }

  /**
   * Exact form first (punctuation variants only). Inflected lemmas such as
   * tantalizing → tantalize are tried only when every source had zero senses
   * for that form — never mixed into a card that already has definitions.
   */
  private async lookupCandidateList(
    candidates: string[],
    query: NormalizedQuery,
    targetLanguage: string,
    detectedLanguage: string,
    enabledSources: string[] | undefined,
    holder: LookupHolder | undefined,
    opts: LookupOpts | undefined,
    lemmaFallback: boolean,
  ): Promise<DictionaryResult | null> {
    let acc: DictionaryResult | null = null;
    let matchedCandidate = '';

    for (const candidate of candidates) {
      if (acc && this.hasRealDefinitions(acc) && sameLookupFold(matchedCandidate || acc.word, candidate)) {
        continue;
      }

      const result = await this.aggregateDictionaryDataParallel(
        candidate,
        targetLanguage,
        detectedLanguage,
        enabledSources,
        holder,
        opts,
      );

      if (!this.hasRealDefinitions(result)) {
        acc = acc ? this.mergeLookupResults(acc, this.withoutFallbackDefinitions(result)) : result;
        if (holder) holder.current = acc;
        continue;
      }

      const merged = acc && !this.hasRealDefinitions(acc)
        ? this.mergeLookupResults(this.withoutFallbackDefinitions(acc), result)
        : result;
      if (holder) holder.current = merged;
      return this.decorateMatchedResult(merged, query, candidate, lemmaFallback);
    }

    if (acc && this.hasRealDefinitions(acc)) {
      return this.decorateMatchedResult(acc, query, matchedCandidate || query.trimmed, lemmaFallback);
    }
    return acc;
  }

  /**
   * A form of another word ("gleaned", "paparazzi", "idiosyncracy") and a word whose senses are
   * mostly "Misspelling of X" ("recieve", "definately") are shown and saved as that other word,
   * like a typo with no entry at all.
   */
  private async lookupWithCandidates(
    query: NormalizedQuery,
    targetLanguage: string,
    detectedLanguage: string,
    enabledSources?: string[],
    holder?: LookupHolder,
    opts?: LookupOpts,
  ): Promise<DictionaryResult> {
    // Once the lookup moves to another word, updates still coming for this one are dropped.
    let movedOn = false;
    /** The lookup of `word` instead, its updates labelled as `word` and marked by `mark`. */
    const instead = async (word: string, extra: LookupOpts, mark: Record<string, unknown>): Promise<DictionaryResult | null> => {
      movedOn = true;
      const label = (r: DictionaryResult) => {
        r.metadata = { ...(r.metadata || {}), ...mark, originalSelection: query.raw };
        return r;
      };
      // The word comes from the dictionary's own data, so its spelling is kept as it is ("etc.").
      const exact = normalizeQuery(word);
      if (hasEdgePunctuation(exact)) this.typedTitles.add(exact.sanitized);
      const next = await this.lookupWithCandidates(exactQuery(exact), targetLanguage, detectedLanguage, enabledSources, holder, {
        ...(opts || {}),
        ...extra,
        originalSelection: word,
        onUpdate: opts?.onUpdate ? (r) => opts.onUpdate!(label(r)) : undefined,
      }).catch((): null => null);
      if (next && this.hasRealDefinitions(next)) return label(next);
      movedOn = false;
      return null;
    };
    // A form ("gleaned", "paparazzi", "idiosyncracy") is shown and saved as the word it is a form
    // of; that word's Forms list it. The tagged page is asked for at once, beside the other
    // sources, so the answer is usually in before the first paint; a result that may be a form is
    // held back meanwhile (at most FORM_HOLD_MS), so the form does not flash before its lemma.
    const started = Date.now();
    const lang = (detectedLanguage || 'en').toLowerCase().split('-')[0];
    const headword = foldLatinHeadword(query.trimmed) || query.trimmed;
    const decisionKey = exactLookupKey(query.trimmed);
    const kaikkiOn =
      lang === 'en' && isCoreConfigured() && query.kind === 'word' && !/\s/.test(headword) && this.isNamedSourceOn('Kaikki', enabledSources);
    // "Paris" typed with its capital is the city, not the plural of pari.
    const formOrProper = (): Promise<string | null> =>
      Promise.all([resolveFormOf(getHttp(), headword, 'en'), this.isProperNoun(query.trimmed)]).then(([lemma, proper]) => (proper ? null : lemma));
    const early: Promise<string | null> | null =
      !opts?.noFormRedirect && kaikkiOn ? withTimeout(formOrProper(), FORM_CHECK_MS, 'form-of') : null;
    let earlyAnswer: { lemma: string | null } | undefined;
    if (early) {
      early.then((lemma) => (earlyAnswer = { lemma }), (): undefined => undefined);
      this.noteFormDecision(decisionKey, early);
    }
    let formCheck: Promise<DictionaryResult | null> | null = null;
    /** Set once the tagged page said the word is a word in its own right, so its cached result is not checked again. */
    let notAForm = false;
    let emitted = 0;
    /** `final`: the lookup's last result, which waits for the page's answer when one was asked for. */
    const checkForm = (r: DictionaryResult, final = false): Promise<DictionaryResult | null> | null => {
      if (formCheck || opts?.noFormRedirect) return formCheck;
      if (earlyAnswer && !earlyAnswer.lemma) {
        notAForm = true;
        return null;
      }
      // The last result waits for the page only when Wiktionary has not ruled the word out.
      const unruled = !wiktionarySenses(r).length;
      if (!mayBeFormOf(r) && !earlyAnswer?.lemma && !(final && early && unruled)) return null;
      const decision = this.decideForm(r, early);
      if (!early) this.noteFormDecision(decisionKey, decision.then((d) => d.lemma));
      formCheck = decision.then(({ lemma, sure }) => {
        if (lemma && exactLookupKey(lemma) !== exactLookupKey(query.trimmed)) {
          // An irregular form spelled unlike its lemma ("ran", "was", "mice") says what it is above
          // the entry, as learner dictionaries give it a short entry of its own.
          const line = formLine(headword, 'en');
          return instead(lemma, { noFormRedirect: true }, { formFrom: query.trimmed, formLineChecked: true, ...(line ? { formLine: line } : {}) });
        }
        if (sure) notAForm = true;
        return null;
      });
      return formCheck;
    };
    const stamp = (r: DictionaryResult): DictionaryResult => {
      if (notAForm) r.metadata = { ...(r.metadata || {}), formChecked: true };
      return r;
    };
    // Endings a form usually has; -er, -en and -a are left out, as most such words are lemmas (kitchen).
    const mayBeInflected = /(?:s|ed|ing|est|i|ae)$/i.test(headword);
    let held: DictionaryResult | null = null;
    let releasing = false;
    let waitingCheck = false;
    let checkDone = false;
    const handle = (r: DictionaryResult): void => {
      if (movedOn || !opts?.onUpdate) return;
      // Wiktionary calling the word a form keeps it back until the page answers; a word that may be
      // inflected, or a result Wiktionary has not reached yet, waits a shorter while.
      const formLike = mayBeFormOf(r);
      const limit = formLike ? FORM_CHECK_MS : FORM_HOLD_MS;
      const unsure = formLike || mayBeInflected || !wiktionarySenses(r).length;
      if (!formCheck && early && !earlyAnswer && Date.now() - started < limit && unsure) {
        held = r;
        if (!releasing) {
          releasing = true;
          const release = () => {
            const h = held;
            held = null;
            releasing = false;
            if (h && !movedOn) handle(h);
          };
          void Promise.race([early.catch((): null => null), new Promise((res) => setTimeout(res, Math.max(0, limit - (Date.now() - started))))]).then(release);
        }
        return;
      }
      const pending = formCheck || checkForm(r);
      if (pending && !checkDone) {
        // The decision is on its way: keep the newest result until it says this word stays.
        held = r;
        if (!waitingCheck) {
          waitingCheck = true;
          void pending.then((next) => {
            checkDone = true;
            const h = held;
            held = null;
            if (next) opts.onUpdate!(next);
            else if (h && !movedOn) {
              emitted += 1;
              opts.onUpdate!(stamp(h));
            }
          });
        }
        return;
      }
      emitted += 1;
      opts.onUpdate!(stamp(r));
    };
    const own = opts?.onUpdate ? { ...opts, onUpdate: handle } : opts;
    const result = await this.lookupWithCandidatesOnce(query, targetLanguage, detectedLanguage, enabledSources, holder, own);
    const formOf = await checkForm(result, true);
    if (formOf) return formOf;
    stamp(result);
    const target = opts?.noCorrection ? null : misspellingTarget(result);
    if (!target || exactLookupKey(target) === exactLookupKey(query.trimmed)) return result;
    const fixed = await instead(target, { noCorrection: true }, { correctedFrom: result.metadata?.correctedFrom || query.trimmed });
    if (!fixed || misspellingTarget(fixed)) return result;
    return fixed;
  }

  /**
   * The word a result is a form of, or null. `sure` is set only when the tagged page answered
   * (form-of.ts); the senses' text, used when the page cannot be had or the Kaikki source is off,
   * decides this lookup but is not remembered with the cached result.
   */
  private async decideForm(result: DictionaryResult, early: Promise<string | null> | null): Promise<{ lemma: string | null; sure: boolean }> {
    if (early) {
      try {
        return { lemma: await early, sure: true };
      } catch {
        /* fall back to the text of the senses */
      }
    }
    return { lemma: formOfTextTarget(result), sure: false };
  }

  /** Form decisions of recent lookups, by folded word, for a save that comes before the page turns. */
  private formDecisions = new Map<string, Promise<string | null>>();

  private noteFormDecision(key: string, decision: Promise<string | null>): void {
    if (!key) return;
    const safe = decision.catch((): null => null);
    this.formDecisions.set(key, safe);
    setTimeout(() => {
      if (this.formDecisions.get(key) === safe) this.formDecisions.delete(key);
    }, 5 * 60_000);
  }

  /**
   * The word a save of `word` should store: the lemma its lookup opens ("goose" for "geese"). It
   * waits for that lookup's pending decision, or asks the tagged page itself when there was none.
   */
  async settledHeadword(word: string, language = 'en'): Promise<string> {
    const w = String(word || '').trim();
    const pending = this.formDecisions.get(exactLookupKey(w));
    try {
      if (pending) return (await withTimeout(pending, FORM_CHECK_MS + 1000, 'form-of')) || w;
      const lang = (language || 'en').toLowerCase().split('-')[0];
      if (lang === 'en' && isCoreConfigured() && !/\s/.test(w) && this.isNamedSourceOn('Kaikki')) {
        if (await this.isProperNoun(w).catch(() => false)) return w;
        return (await withTimeout(resolveFormOf(getHttp(), foldLatinHeadword(w) || w, 'en'), FORM_CHECK_MS, 'form-of')) || w;
      }
    } catch {
      /* saved as it is; the fold after the save and the background check catch it later */
    }
    return w;
  }

  private async lookupWithCandidatesOnce(
    query: NormalizedQuery,
    targetLanguage: string,
    detectedLanguage: string,
    enabledSources?: string[],
    holder?: LookupHolder,
    opts?: LookupOpts,
  ): Promise<DictionaryResult> {
    const { surface, lemma } = splitSurfaceAndLemma(query);
    // Translation and IPA keep arriving after the lookup found no entry; each of those updates
    // carries the "Did you mean …" suggestions too, or the line would vanish with the next one.
    let noEntry: Record<string, unknown> | null = null;
    const own: LookupOpts | undefined = opts?.onUpdate
      ? {
          ...opts,
          onUpdate: (r) => {
            if (noEntry && !this.hasRealDefinitions(r)) r.metadata = { ...(r.metadata || {}), ...noEntry };
            opts.onUpdate!(r);
          },
        }
      : opts;

    const surfaceHit = await this.lookupCandidateList(
      surface,
      query,
      targetLanguage,
      detectedLanguage,
      enabledSources,
      holder,
      own,
      false,
    );
    if (surfaceHit && this.hasRealDefinitions(surfaceHit)) {
      return surfaceHit;
    }

    const lemmaHit = await this.lookupCandidateList(
      lemma,
      query,
      targetLanguage,
      detectedLanguage,
      enabledSources,
      holder,
      own,
      true,
    );
    if (lemmaHit && this.hasRealDefinitions(lemmaHit)) {
      return lemmaHit;
    }

    const firstResult = surfaceHit || lemmaHit;

    // Nothing resolved. Keep the translation we already have and attach
    // spelling suggestions so the popup can offer a way forward.
    const fallback = firstResult ?? {
      word: query.trimmed,
      definitions: [],
      translations: [],
      examples: [],
      sources: []
    };

    const found = await this.fetchSpellingSuggestions(query.trimmed).catch((): string[] => []);
    // A word with no entry is not swapped for a guess ("coverness" for governess): the page
    // says "Did you mean …?" with the closest spelling first, as Oxford and Merriam-Webster do.
    // Misspellings Wiktionary records ("idiosyncracy") still open their word (misspellingTarget).
    const closest = detectedLanguage === 'en' ? closestSpelling(query.trimmed, found) : null;
    const suggestions = closest ? [closest, ...found.filter((w) => w !== closest)] : found;
    noEntry = {
      isSentence: false,
      queryKind: query.kind,
      originalSelection: query.raw,
      matchedQuery: null,
      suggestions: suggestions.length > 0 ? suggestions : undefined
    };
    fallback.metadata = { ...(fallback.metadata || {}), ...noEntry };

    return fallback;
  }

  private hasRealDefinitions(result: DictionaryResult): boolean {
    return (result.definitions || []).some((d) => {
      if (!d || d.source === 'Fallback' || d.source === 'Timeout') return false;
      const m = (d.meaning || '').trim();
      if (!m || m === 'No definition available.' || isTimeoutMeaning(m)) return false;
      return true;
    });
  }

  private withoutFallbackDefinitions(result: DictionaryResult): DictionaryResult {
    const definitions = (result.definitions || []).filter((d) => {
      if (!d || d.source === 'Fallback' || d.source === 'Timeout') return false;
      const m = (d.meaning || '').trim();
      return !!(m && m !== 'No definition available.' && !isTimeoutMeaning(m));
    });
    return { ...result, definitions };
  }

  private isUncacheableResult(result?: DictionaryResult): boolean {
    if (!result) return true;
    if (!this.hasRealDefinitions(result)) return true;
    const defs = result.definitions || [];
    return defs.length > 0 && defs.every((d) => d.source === 'Timeout' || isTimeoutMeaning(d.meaning));
  }

  /**
   * Whole-result cache is only final when every *expected* source has a terminal
   * ok/empty status. A Datamuse hit must not freeze a missing Wiktionary layer.
   */
  /** Translation or etymology still on the way; the result will be updated. */
  private isStillFilling(result?: DictionaryResult): boolean {
    return !!(result?.metadata?.pendingEtymology || result?.metadata?.pendingTranslation);
  }

  /**
   * An English word with senses but no IPA: a source that transcribes it was down, or the
   * result predates the Datamuse pronunciation. Kept a day at most, so it gets its IPA later.
   */
  private lacksIpa(result?: DictionaryResult): boolean {
    if (!result || result.detectedLanguage !== 'en' || /\s/.test(String(result.word || '').trim())) return false;
    if (!(result.definitions || []).some((d) => d.source !== 'Fallback')) return false;
    return !(result.pronunciations || []).some((p) => p.ipa) && !String(result.pronunciation || '').trim();
  }

  private isIncompleteSourceCache(result?: DictionaryResult): boolean {
    if (result?.metadata?.pendingEtymology || result?.metadata?.pendingTranslation) return true;
    if (this.lacksIpa(result)) return true;
    if (result?.metadata?.etymologyUnavailable?.length) return true;
    if (!(result?.translations || []).some((t) => (t.text || '').trim())) return true;
    const st = result?.metadata?.sourceStatus;
    if (!st || typeof st !== 'object') return true;
    const values = st as Record<string, string>;
    if (Object.values(values).some((v) => v === 'fail')) return true;
    const expected = result?.metadata?.expectedSources;
    if (Array.isArray(expected) && expected.length) {
      return expected.some((k) => !values[k] || values[k] === 'fail');
    }
    return false;
  }

  private decorateMatchedResult(
    acc: DictionaryResult,
    query: NormalizedQuery,
    candidate: string,
    lemmaFallback = false,
  ): DictionaryResult {
    const surface = this.displayHeadword(query.trimmed);
    acc.word = surface;
    acc.metadata = {
      ...(acc.metadata || {}),
      isSentence: false,
      queryKind: query.kind,
      originalSelection: query.raw,
      matchedQuery: candidate,
      queriedAs: query.trimmed,
      lemma: lemmaFallback && !sameLookupFold(candidate, query.trimmed) ? candidate : undefined,
      lemmaFallback: lemmaFallback && !sameLookupFold(candidate, query.trimmed) ? true : undefined,
      normalizedFrom: candidate === query.sanitized ? undefined : query.sanitized,
    };
    return acc;
  }

  private mergeLookupResults(base: DictionaryResult, extra: DictionaryResult): DictionaryResult {
    const sorted = sortDefinitionsByReadingOrder(
      mergeSimilarDefinitions([...(base.definitions || []), ...(extra.definitions || [])]) as Definition[],
    ) as Definition[];
    const definitions = formOfSensesLast(
      (extra.detectedLanguage || base.detectedLanguage) === 'en' ? orderSensesByFrequency(extra.word || base.word, sorted) : sorted,
      isFormOfSense,
    );
    const pronunciations = mergePronunciations(base.pronunciations, extra.pronunciations);
    const sourceStatus: Record<string, string> = {};
    const rank = (s?: string) => (s === 'ok' ? 3 : s === 'empty' ? 2 : s === 'skip' ? 1 : 0);
    const bump = (st?: Record<string, string>) => {
      for (const [k, v] of Object.entries(st || {})) {
        if (rank(v) >= rank(sourceStatus[k])) sourceStatus[k] = v;
      }
    };
    bump(base.metadata?.sourceStatus as Record<string, string> | undefined);
    bump(extra.metadata?.sourceStatus as Record<string, string> | undefined);
    const expectedSources = Array.from(
      new Set([
        ...((base.metadata?.expectedSources as string[]) || []),
        ...((extra.metadata?.expectedSources as string[]) || []),
      ]),
    );
    const sources = Array.from(new Set([...(base.sources || []), ...(extra.sources || [])]));
    return {
      ...extra,
      word: extra.word || base.word,
      definitions,
      translations: extra.translations?.length ? extra.translations : base.translations,
      examples: Array.from(new Set([...(base.examples || []), ...(extra.examples || [])])),
      synonyms: Array.from(new Set([...(base.synonyms || []), ...(extra.synonyms || [])])),
      antonyms: Array.from(new Set([...(base.antonyms || []), ...(extra.antonyms || [])])),
      pronunciations,
      pronunciation: formatPronunciationLine(pronunciations) || extra.pronunciation || base.pronunciation,
      etymology: extra.etymology || base.etymology,
      etymologyChain: extra.etymologyChain || base.etymologyChain,
      wordFamily: mergeWordFamilyGroups(base.wordFamily, extra.wordFamily),
      inflections: extra.inflections || base.inflections,
      sources,
      metadata: { ...(base.metadata || {}), ...(extra.metadata || {}), sourceStatus, expectedSources },
    };
  }

  /**
   * First paint: as soon as Free Dictionary or Wiktionary brings senses, give the rest
   * FIRST_PAINT_GRACE_MS and go. If both come back empty or failed, go after the grace
   * as well. `capMs` bounds the whole wait; `minMs` keeps the local-pack coalesce window.
   */
  private waitForFirstPaint(
    all: Promise<any>[],
    primaries: Promise<any>[],
    minMs: number,
    capMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const started = Date.now();
      let done = false;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (done) return;
        done = true;
        if (graceTimer) clearTimeout(graceTimer);
        clearTimeout(capTimer);
        resolve();
      };
      const capTimer = setTimeout(finish, capMs);
      const graceThenFinish = () => {
        if (done || graceTimer) return;
        const wait = Math.max(FIRST_PAINT_GRACE_MS, minMs - (Date.now() - started));
        graceTimer = setTimeout(finish, wait);
      };
      void Promise.all(all).then(() => {
        const left = minMs - (Date.now() - started);
        if (left > 0) setTimeout(finish, left);
        else finish();
      });
      let settled = 0;
      for (const p of primaries) {
        void p.then((r: any) => {
          settled += 1;
          const senses = r?.status === 'ok' && (r?.data?.definitions?.length || 0) > 0;
          if (senses || settled === primaries.length) graceThenFinish();
        });
      }
    });
  }

  /** Cheap fingerprint so identical background updates are not re-sent. */
  private updateSignature(r: DictionaryResult): string {
    return [
      (r.definitions || []).length,
      (r.pronunciations || []).map((p) => `${p.accent}:${p.ipa}`).join(','),
      (r.translations || []).map((t) => t.text).join('|'),
      (r.examples || []).length,
      (r.etymology || '').length,
      JSON.stringify(r.metadata?.etymologyUnavailable || []),
      // A later family source or the frequencies can add words or reorder them in the same groups.
      (r.wordFamily || []).map((g) => `${g.relation}:${g.items.length}:${g.items.slice(0, 3).map((i) => i.word).join(',')}`).join('|'),
      hasInflections(r.inflections) ? (r.inflections!.tables.length + r.inflections!.formOf.length) : 0,
      r.metadata?.pendingTranslation ? 1 : 0,
      r.metadata?.pendingEtymology ? 1 : 0,
    ].join('#');
  }

  /** True while a source's host is being skipped after repeated network failures. */
  private isSourceDown(source: string): boolean {
    const h = this.sourceHealth.get(source);
    return !!h && h.downUntil > Date.now();
  }

  private noteSourceResult(source: string, error?: unknown): void {
    const networkFailure =
      !!error && (!(error instanceof DictionaryError) || error.retryable || /TIMEOUT|NETWORK/.test(error.code));
    if (!networkFailure) {
      this.sourceHealth.delete(source);
      return;
    }
    const h = this.sourceHealth.get(source) || { fails: 0, downUntil: 0 };
    // Requests already in flight when the skip began report late; they are the same outage.
    if (h.downUntil > Date.now()) return;
    h.fails += 1;
    if (h.fails >= 2) {
      const backoff = Math.min(SOURCE_DOWN_MAX_MS, SOURCE_DOWN_BASE_MS * 2 ** (h.fails - 2));
      h.downUntil = Date.now() + backoff;
      console.warn(`${source} keeps failing; skipping it for ${Math.round(backoff / 1000)}s`);
    }
    this.sourceHealth.set(source, h);
  }

  private async cachedSource<T>(
    source: string,
    word: string,
    fn: () => Promise<T>,
    useful: (data: T) => boolean,
  ): Promise<{ type: string; data?: T; error?: unknown; status: 'ok' | 'empty' | 'fail' | 'skip' }> {
    const key = `${source}:${isCapitalised(word) ? word.trim() : foldLatinHeadword(word)}`;
    const now = Date.now();
    const hit = this.sourceLayer.get(key);
    if (hit) {
      if (hit.status === 'ok' && now - hit.ts < this.cacheTimeout) {
        return { type: source, data: hit.data as T, status: 'ok' };
      }
      if (hit.status === 'empty' && now - hit.ts < this.sourceEmptyTtlMs) {
        return { type: source, data: hit.data as T, status: 'empty' };
      }
      if (hit.status === 'fail' && now - hit.ts < this.sourceFailBackoffMs) {
        return { type: source, error: 'cached-fail', status: 'fail' };
      }
    }
    if (this.isSourceDown(source)) {
      return { type: source, error: 'source-down', status: 'skip' };
    }
    try {
      const data = await fn();
      this.noteSourceResult(source);
      const status: 'ok' | 'empty' = useful(data) ? 'ok' : 'empty';
      this.sourceLayer.set(key, { status, data, ts: now });
      return { type: source, data, status };
    } catch (error) {
      this.noteSourceResult(source, error);
      this.sourceLayer.set(key, { status: 'fail', ts: now });
      return { type: source, error, status: 'fail' };
    }
  }

  /**
   * Dictionaries for one language with English glosses: Jisho (Japanese), OpenRussian
   * (Russian) and kaikki.org (any language it covers). Jisho and OpenRussian count as
   * primaries for the first paint; kaikki repeats Wiktionary and lands in a later update.
   *
   * An English lookup that English sources answer with nothing, or only with a surname
   * (Haus, Häuser), falls back to kaikki's all-language page and to the installed packs
   * of other languages once the English primaries have settled.
   */
  private queueLanguageSources(
    text: string,
    lang: string,
    ctx: {
      isSourceEnabled: (name: string) => boolean;
      primaryPromises: Promise<any>[];
      expectedSources: string[];
      pushCore: (p: Promise<any>) => Promise<any>;
      offlineReady: Promise<void>;
      hasLocalHits: () => boolean;
    },
  ): void {
    const word = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    if (!word || word.length > 48) return;
    const http = getHttp();
    const hasSenses = (d: SourceSenses) => d.definitions.length > 0;
    // The source cache folds case; kaikki pages do not (Haus and haus differ).
    const caseKey = word.replace(/\p{Lu}/gu, (c) => `^${c}`);
    const queue = (type: string, key: string, fn: () => Promise<SourceSenses>, primary: boolean) => {
      if (!this.isSourceDown(type)) ctx.expectedSources.push(type);
      const p = ctx.pushCore(this.cachedSource(type, key, fn, hasSenses).then((r) => ({ ...r, type })));
      if (primary) ctx.primaryPromises.push(p);
    };

    for (const ed of EDITIONS) {
      if (!editionServes(ed, lang) || !ctx.isSourceEnabled(WIKTIONARY_EDITIONS[ed].source)) continue;
      // An English lookup has its own dictionaries; the Chinese senses join without holding them up.
      queue(`wikt-${ed}`, `${caseKey}@${lang}`, () => fetchWiktionaryEdition(http, word, ed, lang), lang !== 'en');
    }
    if (lang === 'ja' && ctx.isSourceEnabled('Jisho')) {
      queue('jisho', word, () => fetchJisho(http, word), true);
    }
    if (lang === 'ru' && ctx.isSourceEnabled('OpenRussian')) {
      queue('openRussian', word, () => fetchOpenRussian(http, word), true);
    }
    const kaikkiDir = kaikkiLanguage(lang);
    if (kaikkiDir) {
      if (ctx.isSourceEnabled('Kaikki')) {
        queue('kaikki', `${caseKey}@${lang}`, () => fetchKaikki(http, word, kaikkiDir, { languages: new Set([lang]) }), false);
      }
      return;
    }
    if (lang !== 'en') return;

    const englishMiss = Promise.all([ctx.offlineReady, ...ctx.primaryPromises]).then(
      ([, ...results]) =>
        !ctx.hasLocalHits() &&
        !results.some(
          (r: any) =>
            r?.status === 'ok' &&
            (r.data?.definitions || []).some((d: Definition) => !isNameOnlyGloss(d.meaning)),
        ),
    );
    // The fallbacks join the primaries: when English sources come back empty they are the
    // answer, so the first paint waits for them (within the usual cap). Otherwise they
    // settle at once and change nothing.
    const fallbacks: Promise<any>[] = [
      ctx.pushCore(
        englishMiss.then(async (miss) => {
          if (!miss) return { type: 'offlineFallback', data: [] as OfflineHit[] };
          const hits = await withTimeout(getLookupOffline()(word, undefined, 16), OFFLINE_BUDGET_MS, 'offline.lookup.any').catch(
            (): OfflineHit[] => [],
          );
          return { type: 'offlineFallback', data: hits.filter((h) => h.language !== 'en') };
        }),
      ),
    ];
    if (ctx.isSourceEnabled('Kaikki')) {
      fallbacks.push(
        ctx.pushCore(
          englishMiss.then((miss) =>
            miss
              ? this.cachedSource(
                  'kaikki',
                  `${caseKey}@*`,
                  () => fetchKaikki(http, word, KAIKKI_ALL_LANGUAGES, { languages: KAIKKI_FALLBACK_LANGUAGES }),
                  hasSenses,
                ).then((r) => ({ ...r, type: 'kaikki' }))
              : { type: 'kaikki', status: 'skip' as const },
          ),
        ),
      );
    }
    ctx.primaryPromises.push(...fallbacks);
  }

  private absorbOfflineHits(
    definitions: Definition[],
    sources: string[],
    hits: OfflineHit[],
    cjk: boolean,
  ): void {
    for (const hit of hits) {
      const label =
        cjk && (hit.packId === 'cc-cedict' || /cedict/i.test(hit.packName || ''))
          ? 'CC-CEDICT'
          : hit.packName || 'Offline';
      definitions.push({
        partOfSpeech: canonicalPos(hit.pos || 'definition'),
        meaning: hit.definition,
        source: label,
        sources: [label],
      });
      if (!sources.includes(label)) sources.push(label);
    }
  }

  /**
   * Handle sentence translation with intelligent language detection and multiple translations
   */
  private async handleSentenceTranslationOptimized(
    text: string,
    targetLanguage: string,
    sourceLanguage: string,
    opts?: LookupOpts,
  ): Promise<DictionaryResult> {
    const sources: string[] = [];
    const translations: Translation[] = [];
    
    let actualTargetLanguage = this.resolveTargetLanguage(sourceLanguage, targetLanguage);
    const provider = opts?.translationProvider || 'auto';

    const translationPromises: Array<Promise<Translation | null>> = [];

    if (provider === 'auto') {
      translationPromises.push(this.translateWithProvider('google', text, actualTargetLanguage, sourceLanguage));
      translationPromises.push(this.translateWithProvider('mymemory', text, actualTargetLanguage, sourceLanguage));
      if (this.youdaoAppKey && this.youdaoAppSecret) {
        translationPromises.push(this.translateWithProvider('youdao', text, actualTargetLanguage, sourceLanguage));
      }
      if (this.deeplApiKey) {
        translationPromises.push(this.translateWithProvider('deepl', text, actualTargetLanguage, sourceLanguage));
      }
    } else {
      translationPromises.push(this.translateWithProvider(provider, text, actualTargetLanguage, sourceLanguage));
    }

    const translationResults = await Promise.allSettled(
      translationPromises.map(
        (p: Promise<Translation | null>): Promise<Translation | null> =>
          withTimeout(p, 5500, 'translation').catch((): null => null),
      ),
    );

    for (const result of translationResults) {
      if (result.status === 'fulfilled' && result.value) {
        translations.push(result.value);
        sources.push(result.value.source || 'Translation API');
      }
    }

    if (!translations.length && provider !== 'auto') {
      const fallback = await this.getBestTranslation(text, actualTargetLanguage, sourceLanguage, 'auto');
      if (fallback) {
        translations.push(fallback);
        sources.push(fallback.source || 'Translation API');
      }
    }

    const result: DictionaryResult = {
      word: text,
      definitions: [{
        partOfSpeech: 'sentence',
        meaning: `Translation from ${sourceLanguage.toUpperCase()} to ${actualTargetLanguage.toUpperCase()}`,
        source: 'Sentence'
      }],
      translations,
      examples: [],
      language: actualTargetLanguage,
      detectedLanguage: sourceLanguage,
      sources,
      metadata: {
        isSentence: true,
        sourceLanguage,
        targetLanguage: actualTargetLanguage,
        originalTargetLanguage: targetLanguage,
        translationProvider: provider,
      }
    };

    return result;
  }

  /**
   * Aggregate data from multiple dictionary sources with parallel processing
   */
  private async aggregateDictionaryDataParallel(
    text: string,
    targetLanguage: string,
    sourceLanguage: string,
    enabledSources?: string[],
    holder?: LookupHolder,
    opts?: LookupOpts,
  ): Promise<DictionaryResult> {
    const sources: string[] = [];
    const definitions: Definition[] = [];
    let translations: Translation[] = [];
    let examples: string[] = [];
    let synonyms: string[] = [];
    let antonyms: string[] = [];
    let pronunciation: string | undefined;
    let pronunciations: Pronunciation[] = [];
    const sourceStatus: Record<string, string> = {};
    const expectedSources: string[] = [];
    const skipEtymology = !!opts?.skipEtymology;
    let etymology: string | undefined;
    let etymologyChain: EtymologyLink[] | undefined;
    let etymologyUnavailableSources: EtymologyUnavailable[] | undefined;
    let wikiFamily: WordFamilyGroup[] | undefined;
    let pendingEtymology = !skipEtymology;
    let pendingTranslation = true;

    // For Chinese/Japanese/Korean or mixed CJK+ASCII, prioritize translation over dictionary lookup
    const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
    const isAsianLanguage = ['zh', 'ja', 'ko'].includes(sourceLanguage) || hasCJK;
    const corePromises: Promise<any>[] = [];
    const auxPromises: Promise<any>[] = [];
    const finished: any[] = [];
    const track = (p: Promise<any>) => {
      const wrapped = p.catch((error: unknown) => ({ type: 'timeout', error }));
      void wrapped.then((v) => {
        finished.push(v);
      });
      return wrapped;
    };
    const pushCore = (p: Promise<any>) => {
      const t = track(p);
      corePromises.push(t);
      return t;
    };
    const pushAux = (p: Promise<any>) => {
      const t = track(p);
      auxPromises.push(t);
      return t;
    };
    /** Free Dictionary and Wiktionary carry senses and IPA; the first paint waits for one of them. */
    const primaryPromises: Promise<any>[] = [];

    // Translation / Tatoeba must not hold the first paint (Google gtx often sits until timeout).
    const translationPromise = pushAux(
      this.getBestTranslation(text, targetLanguage, sourceLanguage, opts?.translationProvider || 'auto')
        .then(translation => ({ type: 'translation', data: translation }))
        .catch(error => ({ type: 'translation', error }))
    );
    
    // Smart routing by script / language (minimize user config thrash):
    // - CJK/Asian: prefer Youdao + CC-CEDICT (+ translation); skip EN-only FreeDict/Datamuse
    // - Latin/English: Free Dictionary + Wiktionary + Datamuse; skip Chinese-only sources
    // Wiktionary still runs for CJK when enabled (etymology / bilingual lemmas).
    const isChinese = sourceLanguage === 'zh' || hasCJK;
    const preferCjkSources = isAsianLanguage || isChinese;
    const preferLatinSources = !preferCjkSources;
    // Sense frequencies load in parallel with the network sources.
    const usageOrder = sourceLanguage === 'en';
    const frequencyReady = usageOrder ? warmSenseFrequency() : null;

    // Offline packs (SQLite) overlap network APIs — do not wait 2s before FreeDict/Wiktionary.
    // Packs for the word's language answer first. A CJK word no pack of its language
    // knows falls through to the other CJK packs (学生 in JMdict when CC-CEDICT lacks it).
    const offlineLang = preferCjkSources
      ? (['zh', 'ja', 'ko'].includes(sourceLanguage) ? sourceLanguage : 'zh')
      : sourceLanguage || 'en';
    const offlinePromise = (async () => {
      try {
        let offlineHits = await withTimeout(
          getLookupOffline()(text, offlineLang, 16),
          OFFLINE_BUDGET_MS,
          `offline.lookup.${offlineLang}`,
        );
        if (!offlineHits.length && preferCjkSources) {
          offlineHits = await withTimeout(getLookupOffline()(text, undefined, 16), OFFLINE_BUDGET_MS, 'offline.lookup');
        }
        this.absorbOfflineHits(definitions, sources, offlineHits, preferCjkSources);
      } catch {
        /* offline optional */
      }
    })();

    if (preferCjkSources && (!enabledSources || enabledSources.includes('Youdao API') || enabledSources.includes('CC-CEDICT'))) {
      // Auto-use Youdao when credentials exist — don't require the toggle for CJK queries.
      const youdaoToggleOk = !enabledSources || enabledSources.includes('Youdao API');
      const youdaoSource = this.sources.find((s) => s.name === 'Youdao API');
      const youdaoAuto = !!(this.youdaoAppKey && this.youdaoAppSecret);
      if (youdaoToggleOk && youdaoAuto && (youdaoSource?.enabled !== false || !enabledSources)) {
        pushCore(
          this.getYoudaoData(text, 'zh-CHS', 'en')
            .then(data => ({ type: 'youdao', data }))
            .catch(error => ({ type: 'youdao', error }))
        );
      }

      // Optional in-memory CEDICT Map (legacy path)
      if (!enabledSources || enabledSources.includes('CC-CEDICT')) {
        const cedictDefs = this.getCcCedictData(text);
        if (cedictDefs.length > 0) {
          definitions.push(...cedictDefs);
          if (!sources.includes('CC-CEDICT')) sources.push('CC-CEDICT');
        }
      }
    }

    const langForDict = sourceLanguage || 'en';
    const isSourceEnabled = (sourceName: string) => {
      if (enabledSources) return enabledSources.includes(sourceName);
      const s = this.sources.find(s => s.name === sourceName);
      return s ? s.enabled && s.isAvailable : false;
    };

    const lookupWord = preferLatinSources ? foldLatinHeadword(text) : text;

    // Local US IPA from CMUdict, used only when no online source has a transcription, and
    // Datamuse's pronunciation of a word CMUdict lacks, used only when CMUdict has nothing.
    let cmuIpa = '';
    let datamuseIpa = '';
    if (preferLatinSources && !hasCJK) {
      pushCore(cmuIpaFor(lookupWord).then((ipa) => ({ type: 'cmu', data: ipa })));
    }

    // Free Dictionary + Datamuse: Latin/English path (CJK lemmas rarely have useful entries)
    if (preferLatinSources && isSourceEnabled('Free Dictionary API')) {
      if (!this.isSourceDown('freeDictionary')) expectedSources.push('freeDictionary');
      primaryPromises.push(pushCore(
        this.cachedSource(
          'freeDictionary',
          lookupWord,
          () => this.getFreeDictionaryData(lookupWord, langForDict),
          (data) => (data.definitions?.length || 0) > 0 || !!(data.pronunciations && data.pronunciations.length) || !!data.pronunciation,
        ).then((r) => ({ ...r, type: 'freeDictionary' })),
      ));
    }

    // Wiktionary: always useful (defs + etymology). For CJK, still query when enabled.
    if (isSourceEnabled('Wiktionary')) {
      if (!this.isSourceDown('wiktionary')) expectedSources.push('wiktionary');
      // en.wiktionary keys its answer by language: собака lives under `ru`, not `en`.
      const wikiLang = langForDict === 'auto' ? 'en' : langForDict;
      // A capitalised word goes as typed, so Wiktionary can put "May" the month before "may".
      const wikiWord = wikiLang === 'en' && !isCapitalised(text) ? lookupWord : text;
      primaryPromises.push(pushCore(
        this.cachedSource(
          'wiktionary',
          wikiWord,
          () => this.getWiktionaryData(wikiWord, wikiLang),
          (data) =>
            (data.definitions?.length || 0) > 0
            || !!data.pronunciation
            || !!(data.pronunciations && data.pronunciations.length)
            || !!(data.wordFamily && data.wordFamily.length),
        ).then((r) => ({ ...r, type: 'wiktionary' })),
      ));
    }

    // kaikki.org paths are case-sensitive (Haus is German, haus is not): keep the
    // selection's spelling when this candidate is only its folded form.
    const selection = this.typedForm(opts?.originalSelection || '');
    const languageWord = selection && foldLookupKey(selection) === foldLookupKey(text) ? selection : text;
    this.queueLanguageSources(languageWord, langForDict, {
      isSourceEnabled,
      primaryPromises,
      expectedSources,
      pushCore,
      offlineReady: offlinePromise,
      hasLocalHits: () => definitions.some((d) => isLocalPackSource(d.source)),
    });

    // Grammatical forms arrive after the first paint; the page is shared with kaikki senses.
    let rawInflections: WordInflections | undefined;
    if (isSourceEnabled('Kaikki') && !/\s/.test(languageWord.trim())) {
      const formsKey = `${languageWord.replace(/\p{Lu}/gu, (c) => `^${c}`)}@${langForDict}`;
      auxPromises.push(
        this.cachedSource('inflections', formsKey, () => fetchInflections(getHttp(), languageWord, langForDict), (d) => !!d)
          .then((r) => {
            if (r.data) rawInflections = r.data as WordInflections;
          })
          .catch((): undefined => undefined),
      );
    }
    // Derived and related words from the same page, so the family does not hang on Wiktionary's
    // parse API answering within its budget ("redundancy" under redundant, "dichotomize").
    let kaikkiFamily: WordFamilyGroup[] | undefined;
    const kaikkiDir = kaikkiDirectory(langForDict);
    if (kaikkiDir && isSourceEnabled('Kaikki') && !/\s/.test(languageWord.trim())) {
      const familyKey = `${languageWord.replace(/\p{Lu}/gu, (c) => `^${c}`)}@${langForDict}`;
      auxPromises.push(
        this.cachedSource(
          'kaikkiFamily',
          familyKey,
          async () => familyFromKaikki(await fetchKaikkiPage(getHttp(), languageWord, kaikkiDir), languageWord, langForDict),
          (d) => Array.isArray(d) && d.length > 0,
        )
          .then((r) => {
            if (Array.isArray(r.data) && r.data.length) kaikkiFamily = r.data as WordFamilyGroup[];
          })
          .catch((): undefined => undefined),
      );
    }
    // How common each derived and related word is, so "redundancy" leads and "redundantant" waits
    // under All: one Datamuse query for every word containing the stem.
    let familyFrequencies: FamilyFrequencies | null = null;
    const stem = langForDict === 'en' && isSourceEnabled('Datamuse') ? familyStem(languageWord) : '';
    if (stem) {
      auxPromises.push(
        this.cachedSource('familyFrequency', stem, () => fetchFamilyFrequencies(getHttp(), languageWord), (d) => !!d)
          .then((r) => {
            if (r.data) familyFrequencies = r.data as FamilyFrequencies;
          })
          .catch((): undefined => undefined),
      );
    }

    if (preferLatinSources && !hasCJK && isSourceEnabled('Datamuse')) {
      if (!this.isSourceDown('datamuse')) expectedSources.push('datamuse');
      pushCore(
        this.cachedSource(
          'datamuse',
          lookupWord,
          () => this.getDatamuseData(lookupWord),
          (data) => (data.definitions?.length || 0) > 0 || (data.synonyms?.length || 0) > 0 || !!data.ipa,
        ).then((r) => ({ ...r, type: 'datamuse' })),
      );
    }

    if (isSourceEnabled('Tatoeba')) {
      // Examples pair with the reader's native side (en→zh), not the Translation tab's
      // "To" pick — otherwise a one-off Japanese translation leaks into every lexicon.
      pushAux(
        this.getTatoebaExamples(text, sourceLanguage, this.defaultTargetForSource(sourceLanguage))
          .then(data => ({ type: 'tatoeba', data }))
          .catch(error => ({ type: 'tatoeba', error }))
      );
    }

    // English-centric premium APIs
    const allowEnglishPremium = preferLatinSources || sourceLanguage === 'en';
    if (allowEnglishPremium) {
      if (isSourceEnabled('Oxford Dictionary API') && this.oxfordAppId && this.oxfordAppKey) {
        pushCore(
          this.getOxfordData(text)
            .then(data => ({ type: 'oxford', data }))
            .catch(error => ({ type: 'oxford', error }))
        );
      }

      if (isSourceEnabled('WordsAPI') && this.wordsApiKey) {
        pushCore(
          this.getWordsApiData(text)
            .then(data => ({ type: 'wordsApi', data }))
            .catch(error => ({ type: 'wordsApi', error }))
        );
      }

      if (isSourceEnabled('Collins Dictionary API') && this.collinsApiKey && this.collinsApiHost) {
        pushCore(
          this.getCollinsData(text)
            .then(data => ({ type: 'collins', data }))
            .catch(error => ({ type: 'collins', error }))
        );
      }
    }

    await offlinePromise;
    const hasLocal = definitions.some((d) => isLocalPackSource(d.source));
    const coreWait = hasLocal ? CORE_WAIT_WITH_LOCAL_MS : CORE_WAIT_WITHOUT_LOCAL_MS;
    if (corePromises.length) {
      await this.waitForFirstPaint(corePromises, primaryPromises, hasLocal ? coreWait : 0, coreWait);
    }
    if (frequencyReady) await withTimeout(frequencyReady, 250, 'sense-frequency').catch((): undefined => undefined);

    const absorbed = new Set<unknown>();

    const ingest = (item: any) => {
      if (!item) return;
      if (item.status) sourceStatus[item.type] = item.status;
      if (item.error && !item.data) return;
      const { type, data } = item;
      switch (type) {
        case 'translation':
          if (data) {
            translations.push(data);
            sources.push(data.source || 'Translation API');
          }
          break;
        case 'freeDictionary':
          if (data?.pronunciations?.length) {
            pronunciations = mergePronunciations(pronunciations, data.pronunciations);
          }
          if (data?.definitions?.length > 0) {
            definitions.push(
              ...data.definitions.map((d: Definition, i: number) => ({ ...d, senseOrder: i })),
            );
            examples.push(...(data.examples || []));
            synonyms.push(...(data.synonyms || []));
            antonyms.push(...(data.antonyms || []));
            sources.push('Free Dictionary API');
          }
          pronunciation = formatPronunciationLine(pronunciations) || pronunciation || data?.pronunciation;
          break;
        case 'wiktionary':
          if (data?.pronunciations?.length) {
            pronunciations = mergePronunciations(pronunciations, data.pronunciations);
          }
          if (data?.wordFamily?.length) {
            wikiFamily = mergeWordFamilyGroups(wikiFamily, data.wordFamily);
          }
          if (data && data.definitions && data.definitions.length > 0) {
            const existingMeanings = new Set(definitions.map((d: Definition) => d.meaning));
            const newDefinitions = data.definitions
              .filter((d: Definition) => !existingMeanings.has(d.meaning))
              .map((d: Definition, i: number) => ({ ...d, source: 'Wiktionary', senseOrder: 40 + i }));
            definitions.push(...newDefinitions);
            try {
              const exampleSnippets: string[] = [];
              for (const def of data.definitions) {
                if (Array.isArray(def.examples)) exampleSnippets.push(...def.examples);
              }
              if (exampleSnippets.length > 0) examples.push(...exampleSnippets);
            } catch { /* ignore */ }
            // Multi-source etymology (Wiktionary wikitext, Etymonline, Youdao)
            // replaces this. Keep the gloss snippet only when that pass is skipped.
            if (data.etymology && skipEtymology) etymology = data.etymology;
            sources.push('Wiktionary');
          }
          pronunciation = formatPronunciationLine(pronunciations) || pronunciation || data?.pronunciation;
          break;
        case 'datamuse':
          if (typeof data?.ipa === 'string') datamuseIpa = data.ipa;
          if (data && (data.definitions.length > 0 || data.synonyms.length > 0)) {
            const existing = new Set(definitions.map((d: Definition) => (d.meaning || '').toLowerCase()));
            const fresh = data.definitions.filter((d: Definition) => !existing.has(d.meaning.toLowerCase()));
            if (fresh.length > 0) definitions.push(...fresh);
            if (data.synonyms.length > 0) synonyms.push(...data.synonyms);
            if (fresh.length > 0 || data.synonyms.length > 0) sources.push('Datamuse');
          }
          break;
        case 'cmu':
          if (typeof data === 'string') cmuIpa = data;
          break;
        case 'jisho':
        case 'openRussian':
        case 'kaikki':
        case 'wikt-zh':
        case 'wikt-ru':
        case 'wikt-ja': {
          const senses = data as SourceSenses | undefined;
          if (senses?.pronunciations?.length) {
            pronunciations = mergePronunciations(pronunciations, senses.pronunciations);
          }
          if (senses?.definitions?.length) {
            definitions.push(...(senses.definitions as Definition[]));
            examples.push(...senses.examples);
            sources.push(LANGUAGE_SOURCE_LABELS[type]);
          }
          break;
        }
        case 'offlineFallback':
          if (Array.isArray(data) && data.length) this.absorbOfflineHits(definitions, sources, data, false);
          break;
        case 'tatoeba':
          if (data && data.length > 0) {
            examples.push(...data);
            sources.push('Tatoeba');
          }
          break;
        case 'oxford':
          if (data) {
            if (data.definitions?.length) definitions.unshift(...data.definitions);
            if (!pronunciation && data.pronunciation) pronunciation = data.pronunciation;
            if (!etymology && data.etymology && skipEtymology) etymology = data.etymology;
            sources.push('Oxford Dictionary API');
          }
          break;
        case 'youdao':
          if (data) {
            if (data.definitions?.length) definitions.push(...data.definitions);
            if (data.translations?.length) translations.push(...data.translations);
            if (!pronunciation && data.pronunciation) pronunciation = data.pronunciation;
            sources.push('Youdao API');
          }
          break;
        case 'wordsApi':
          if (data) {
            if (data.definitions?.length) definitions.push(...data.definitions);
            if (data.synonyms?.length) synonyms.push(...data.synonyms);
            if (data.antonyms?.length) antonyms.push(...data.antonyms);
            if (!pronunciation && data.pronunciation) pronunciation = data.pronunciation;
            sources.push('WordsAPI');
          }
          break;
        case 'collins':
          if (data) {
            if (data.definitions?.length) definitions.push(...data.definitions);
            if (data.examples?.length) examples.push(...data.examples);
            sources.push('Collins Dictionary API');
          }
          break;
        default:
          break;
      }
    };

    const drain = () => {
      for (const item of finished) {
        if (absorbed.has(item)) continue;
        absorbed.add(item);
        ingest(item);
      }
    };

    const buildResult = (): DictionaryResult => {
      const defSeen = new Set<string>();
      const uniqueDefinitions: Definition[] = [];
      for (const d of definitions) {
        // Wiktionary's group headings ("Meanings relating to a wind instrument."), which the Free
        // Dictionary API passes on as senses, are not senses.
        if (/^\s*meanings? relating to\b/i.test(String(d.meaning || '').replace(/<[^>]+>/g, ' '))) continue;
        const key = `${(d.partOfSpeech || '').toLowerCase()}|${(d.meaning || '').trim().toLowerCase()}|${(d.source || '').toLowerCase()}`;
        if (!defSeen.has(key)) {
          defSeen.add(key);
          uniqueDefinitions.push(d);
        }
      }
      const readingOrder = stripCrossLemmaSenses(
        text,
        sortDefinitionsByReadingOrder(
          mergeSimilarDefinitions(uniqueDefinitions) as Definition[],
        ) as Definition[],
        isFormOfSense,
      );
      const ordered = formOfSensesLast(usageOrder ? orderSensesByFrequency(text, readingOrder) : readingOrder, isFormOfSense);
      // An example sentence shows once, under the first sense that has it ("A burst pipe flooded
      // my bathroom." came with both the sense and its sub-sense).
      const shownExamples = new Set<string>();
      const mergedDefinitions = ordered.map((d) => {
        if (!d.examples?.length) return d;
        const examples = d.examples.filter((e) => {
          const k = exampleKey(e);
          if (!k || shownExamples.has(k)) return false;
          shownExamples.add(k);
          return true;
        });
        return examples.length === d.examples.length ? d : { ...d, examples };
      });
      for (const d of mergedDefinitions) {
        if (d.examples?.length) d.examples = dedupeExamples(d.examples) || [];
      }

      const transMap = new Map<string, Translation>();
      for (const t of translations) {
        if (!t) continue;
        const src = (t.source || 'translation api').trim().toLowerCase();
        const key = `${src}|${(t.text || '').trim()}`;
        if (!transMap.has(key)) transMap.set(key, t);
      }
      const uniqueTranslations = Array.from(transMap.values());

      const normalizeExample = (s: string) => (s || '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/^"|"$/g, '')
        .trim();
      const exSet = new Set<string>();
      const uniqueExamples: string[] = [];
      for (const ex of examples) {
        const n = tidyExample(normalizeExample(ex));
        const k = exampleKey(n);
        if (n && k && !exSet.has(k)) { exSet.add(k); uniqueExamples.push(n); }
      }

      const uniqueSynonyms = Array.from(new Set(synonyms.map((s) => (s || '').trim()).filter(Boolean)));
      const uniqueAntonyms = Array.from(new Set(antonyms.map((s) => (s || '').trim()).filter(Boolean)));
      const uniqueSources = Array.from(new Set(sources.map((s) => (s || '').trim())));
      const surfaceForm = this.displayHeadword(this.typedForm(opts?.originalSelection || text)) || text;
      const headword = surfaceForm;
      const fallbackIpa = pronunciations.some((p) => p.ipa)
        ? undefined
        : cmuIpa
          ? [{ ipa: cmuIpa, accent: 'us' as const, source: 'CMUdict' }]
          : datamuseIpa
            ? [{ ipa: datamuseIpa, accent: 'us' as const, source: 'Datamuse' }]
            : undefined;
      const ipaList = mergePronunciations(pronunciations, fallbackIpa);
      const ipaLine = formatPronunciationLine(ipaList) || pronunciation;
      const wordFamily = rankFamilyByFrequency(mergeWordFamilyGroupsFor(
        headword,
        wikiFamily,
        kaikkiFamily,
        familyFromEtymologyChain(etymologyChain, headword),
        buildWordFamily({
          surface: headword,
          language: sourceLanguage,
          definitions: mergedDefinitions,
        }),
      ), familyFrequencies);
      return {
        word: headword,
        pronunciation: ipaLine,
        pronunciations: ipaList.length ? ipaList : undefined,
        definitions: mergedDefinitions.length > 0 ? mergedDefinitions : [{
          partOfSpeech: 'unknown',
          meaning: 'No definition available.',
          source: 'Fallback',
        }],
        translations: uniqueTranslations,
        examples: uniqueExamples,
        synonyms: uniqueSynonyms.length > 0 ? uniqueSynonyms : undefined,
        antonyms: uniqueAntonyms.length > 0 ? uniqueAntonyms : undefined,
        etymology,
        etymologyChain,
        wordFamily: wordFamily.length ? wordFamily : undefined,
        inflections: selectInflections(
          rawInflections,
          mergedDefinitions.filter((d) => d.source !== 'Fallback').map((d) => canonicalPos(d.partOfSpeech)),
        ),
        language: targetLanguage,
        detectedLanguage: sourceLanguage,
        sources: uniqueSources,
        metadata: {
          queriedAs: opts?.originalSelection || text,
          originalSelection: opts?.originalSelection || text,
          sourceStatus: { ...sourceStatus },
          expectedSources: [...expectedSources],
          pendingEtymology,
          etymologyUnavailable: etymologyUnavailableSources,
          pendingTranslation,
          translationProvider: opts?.translationProvider || 'auto',
        },
      };
    };

    drain();
    const result = buildResult();
    if (holder) holder.current = result;

    // Everything that lands after the first paint goes out as it arrives, coalesced,
    // instead of waiting for the slowest piece (translation engines, etymology hosts).
    let lastSent = this.updateSignature(result);
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      drain();
      const next = buildResult();
      const sig = this.updateSignature(next);
      if (sig === lastSent) return;
      lastSent = sig;
      if (holder) holder.current = next;
      opts?.onUpdate?.(next);
    };
    const schedule = () => {
      if (!flushTimer) flushTimer = setTimeout(() => flush(), UPDATE_COALESCE_MS);
    };

    const coreDone = Promise.allSettled(corePromises).then(async () => {
      drain();
      if (!preferLatinSources) return;
      const ipaWord = foldLatinHeadword(text);
      const haveUsUk =
        pronunciations.some((p) => p.accent === 'us' && p.ipa) && pronunciations.some((p) => p.accent === 'uk' && p.ipa);
      if (!ipaWord || haveUsUk) return;
      // US/UK top-up for forms whose entry has no accent labels. It runs as soon as the
      // dictionaries are in, not after translation and etymology.
      const [lemmaPhon, wikiIpa] = await Promise.all([
        this.cachedSource('freeDictionary', ipaWord, () => this.getFreeDictionaryData(ipaWord, 'en'), () => true)
          .then((r) => (r.data || {}) as { pronunciations?: Pronunciation[]; pronunciation?: string }),
        withTimeout(this.getWiktionaryIpa(ipaWord), IPA_BUDGET_MS * 2, 'wiki.ipa').catch((): Pronunciation[] => []),
      ]);
      pronunciations = mergePronunciations(
        pronunciations,
        lemmaPhon.pronunciations,
        !lemmaPhon.pronunciations?.length && lemmaPhon.pronunciation && !/US\s|UK\s/.test(lemmaPhon.pronunciation)
          ? [{ ipa: lemmaPhon.pronunciation, accent: 'other', source: 'Free Dictionary API' }]
          : undefined,
        wikiIpa,
      );
    }).catch((): undefined => undefined);

    for (const p of corePromises) void p.then(schedule);
    void coreDone.then(schedule);
    const translationDone = translationPromise.then(() => {
      pendingTranslation = false;
      schedule();
    });
    for (const p of auxPromises) void p.then(schedule);
    const etymologyDone = (skipEtymology
      ? Promise.resolve(undefined)
      : this.fetchEtymologyFromMultipleSources(text).catch((error: unknown): undefined => {
          console.warn('[ETY] multi-source etymology skipped', error);
          return undefined;
        })
    ).then((fetched) => {
      pendingEtymology = false;
      etymologyUnavailableSources = fetched?.unavailable;
      if (fetched?.text) {
        etymology = fetched.text;
        if (fetched.chain) etymologyChain = fetched.chain;
      }
      schedule();
    });
    void Promise.allSettled([coreDone, translationDone, etymologyDone, ...auxPromises])
      .then(() => flush())
      .catch((err) => console.warn('Background lookup enrich failed', err));

    return result;
  }

  /**
   * Aggregate data from multiple dictionary sources (legacy method)
   */

  private async aggregateDictionaryData(text: string, targetLanguage: string, sourceLanguage: string): Promise<DictionaryResult> {
    const sources: string[] = [];
    const definitions: Definition[] = [];
    const translations: Translation[] = [];
    const examples: string[] = [];
    const synonyms: string[] = [];
    const antonyms: string[] = [];
    let pronunciation: string | undefined;
    let etymology: string | undefined;

    // For Chinese/Japanese/Korean text, prioritize translation over dictionary lookup
    const isAsianLanguage = ['zh', 'ja', 'ko'].includes(sourceLanguage);
    
    // Always get translation first
    try {
      const translation = await this.getBestTranslation(text, targetLanguage, sourceLanguage, 'auto');
      if (translation) {
        translations.push(translation);
        sources.push(translation.source || 'Translation API');
      }
    } catch (error) {
      console.warn('Translation failed:', error);
    }
    
    // Dictionary APIs for all languages (same as parallel path — do not skip CJK)
    try {
      const freeDictData = await this.getFreeDictionaryData(text, sourceLanguage);
      if (freeDictData.definitions.length > 0) {
        definitions.push(...freeDictData.definitions);
        examples.push(...freeDictData.examples);
        synonyms.push(...freeDictData.synonyms);
        antonyms.push(...freeDictData.antonyms);
        pronunciation = freeDictData.pronunciation;
        sources.push('Free Dictionary API');
      }
    } catch (error) {
      console.warn('Free Dictionary API failed:', error);
    }

    try {
      const wikiData = await this.getWiktionaryData(text, sourceLanguage);
      if (wikiData.definitions.length > 0) {
        const existingMeanings = new Set(definitions.map(d => d.meaning));
        const newDefinitions = wikiData.definitions.filter(d => !existingMeanings.has(d.meaning));
        definitions.push(...newDefinitions);

        if (wikiData.etymology) etymology = wikiData.etymology;
        if (!pronunciation && wikiData.pronunciation) pronunciation = wikiData.pronunciation;
        sources.push('Wiktionary');
      }
    } catch (error) {
      console.warn('Wiktionary API failed:', error);
    }

    // Create final result
    const result: DictionaryResult = {
      word: text,
      pronunciation,
      definitions: definitions.length > 0 ? definitions : [{
        partOfSpeech: 'unknown',
        meaning: 'No definition available.',
        source: 'Fallback'
      }],
      translations,
      examples,
      synonyms: synonyms.length > 0 ? synonyms : undefined,
      antonyms: antonyms.length > 0 ? antonyms : undefined,
      etymology,
      language: targetLanguage,
      detectedLanguage: sourceLanguage,
      sources
    };

    return result;
  }

  /**
   * Get data from Free Dictionary API
   */
  private async getFreeDictionaryData(text: string, language: string): Promise<{
    definitions: Definition[];
    pronunciation?: string;
    pronunciations?: Pronunciation[];
    examples: string[];
    synonyms: string[];
    antonyms: string[];
    word?: string;
  }> {
    const empty = { definitions: [] as Definition[], examples: [] as string[], synonyms: [] as string[], antonyms: [] as string[] };
    try {
      const query = /[A-Z]{2,}/.test(text) && text === text.toUpperCase() && text.length <= 6
        ? text
        : foldLatinHeadword(text);
      // Map language codes to Free Dictionary API supported languages
      const languageMap: Record<string, string> = {
        'zh': 'zh', // Chinese (if supported)
        'ja': 'ja', // Japanese (if supported)
        'ko': 'ko', // Korean (if supported)
        'es': 'es', // Spanish
        'fr': 'fr', // French
        'de': 'de', // German
        'it': 'it', // Italian
        'pt': 'pt', // Portuguese
        'ru': 'ru', // Russian
        'ar': 'ar', // Arabic
        'hi': 'hi', // Hindi
        'th': 'th', // Thai
        'en': 'en'  // English (default)
      };
      
      const apiLanguage = languageMap[language] || 'en';
      
      // Try the detected language first
      let url = `https://api.dictionaryapi.dev/api/v2/entries/${apiLanguage}/${encodeURIComponent(query)}`;
      let response = await this.request<any[]>(url);
      
      // If no results and language is not English, try English as fallback
      if ((!response || response.length === 0) && apiLanguage !== 'en') {
        console.log(`No results for text of length ${text.length} in ${apiLanguage}, trying English fallback`);
        url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`;
        response = await this.request<any[]>(url);
      }

      if (!response || response.length === 0) {
        return empty;
      }

      const data = response[0];
      const apiWord = typeof data.word === 'string' ? data.word.trim() : '';
      if (apiWord && foldLookupKey(apiWord) !== foldLookupKey(query)) {
        return empty;
      }
      const definitions: Definition[] = [];
      const examples: string[] = [];
      const synonyms: string[] = [];
      const antonyms: string[] = [];

      const pronunciations = parseFreeDictionaryPhonetics(data);
      const pronunciation = formatPronunciationLine(pronunciations) || pronunciations[0]?.ipa;

      // Process meanings
      if (data.meanings) {
        for (const meaning of data.meanings) {
          for (const def of meaning.definitions) {
            definitions.push({
              partOfSpeech: this.normalizePartOfSpeech(meaning.partOfSpeech),
              meaning: def.definition,
              synonyms: def.synonyms || [],
              antonyms: def.antonyms || [],
              examples: def.example ? [def.example] : [],
              source: 'Free Dictionary API'
            });

            // Collect examples
            if (def.example) {
              examples.push(def.example);
            }
          }

          // Collect synonyms and antonyms from meaning level
          if (meaning.synonyms) {
            synonyms.push(...meaning.synonyms);
          }
          if (meaning.antonyms) {
            antonyms.push(...meaning.antonyms);
          }
        }
      }

      return {
        definitions,
        pronunciation,
        pronunciations,
        examples,
        synonyms: [...new Set(synonyms)], // Remove duplicates
        antonyms: [...new Set(antonyms)],  // Remove duplicates
        word: typeof data.word === 'string' ? data.word.trim() : undefined,
      };

    } catch (error) {
      if (error instanceof DictionaryError && error.code === 'HTTP_404') {
        return empty;
      }
      console.warn(`Free Dictionary API failed for "${text}":`, error);
      throw error;
    }
  }

  private readonly wiktionaryPages = new Map<string, Promise<any | null>>();
  /** Capitalised words Wiktionary has as proper nouns this session; their headword keeps its capital. */
  private readonly properNouns = new Set<string>();

  /** Titles looked up as typed, punctuation and capitals included ("etc.", "U.S.", "C++"). */
  private readonly typedTitles = new Set<string>();

  /** The headword a result shows: "Paris" as typed when it is a proper noun, otherwise folded. */
  private displayHeadword(typed: string): string {
    const t = String(typed || '').trim();
    return this.properNouns.has(t) || this.typedTitles.has(t) ? t : foldLatinHeadword(t) || t;
  }

  /** A selection as the lookup took it: whole when it is a typed title ("etc."), else edge-trimmed. */
  private typedForm(selection: string): string {
    const t = sanitize(selection || '');
    return this.typedTitles.has(t) ? t : trimEdges(t);
  }

  /**
   * The query as typed when its edge punctuation may belong to the word and Wiktionary has a page
   * with that exact title in the query's language: "etc." and "C++" open as typed, while "hello,"
   * has no page and is looked up as "hello". The dictionary decides, not a list of abbreviations.
   *
   * A full stop, comma, quote or bracket may also just be the sentence around a word, so then the
   * bare word comes first: "no." and "in." are no and in at the end of a sentence, though
   * Wiktionary also has "no." (number) and "in." (inch). The typed title comes first only when
   * a third or more of the bare word's senses point to it ("etc" and "vs" are another form of
   * "etc." and "vs.", while two of the 24 senses of "no" point to "no.") or
   * when the same mark is also inside the word ("e.g.", "U.S.").
   */
  private async withExactTitle(query: NormalizedQuery, language: string): Promise<NormalizedQuery> {
    if (!hasEdgePunctuation(query) || !isCoreConfigured()) return query;
    if (this.typedTitles.has(query.sanitized)) return exactQuery(query);
    // Detection is unsure of short tokens ("e.g" comes back as Italian), so English counts too.
    const detected = (language || 'en').toLowerCase().split('-')[0] || 'en';
    const exact = query.sanitized;
    const dropped = Array.from(new Set(edgeMarks(exact, query.trimmed)));
    // An apostrophe is as often part of the word ("'em", "dogs'") as a quote, so it is left to
    // the dictionary like "+" in "C++".
    const sentenceMarks =
      dropped.length > 0 &&
      dropped.every((c) => c !== "'" && c !== '’' && /[\p{Terminal_Punctuation}\p{Quotation_Mark}\p{Ps}\p{Pe}\p{Pi}\p{Pf}]/u.test(c)) &&
      !dropped.some((c) => query.trimmed.includes(c));
    const fetchPage = (title: string) =>
      withTimeout(this.wiktionaryDefinitions(title), EXACT_TITLE_MS, 'exact-title').catch((): null => null);
    const [page, bare] = await Promise.all([fetchPage(exact), sentenceMarks ? fetchPage(query.trimmed) : Promise.resolve(null)]);
    const lang = [detected, 'en'].find((l) => sectionSenses(page, l).length);
    if (!lang) return query;
    if (sentenceMarks) {
      const own = sectionSenses(bare, lang);
      const pointing = own.filter((d) => linksToTitle(d, exact)).length;
      // No answer for the bare word (slow, or no page) leaves the usual order, which still tries
      // the typed title after the bare word: "do." must not open "ditto" because "do" was slow.
      if (!own.length || pointing * 3 < own.length) return query;
    }
    this.typedTitles.add(exact);
    if (this.typedTitles.size > 400) this.typedTitles.delete(this.typedTitles.values().next().value as string);
    return exactQuery(query);
  }

  /** Wiktionary's definitions page for an exact title ("Paris" and "paris" differ), or null. */
  private wiktionaryDefinitions(title: string): Promise<any | null> {
    let page = this.wiktionaryPages.get(title);
    if (!page) {
      page = this.request<any>(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(title)}`, {
        headers: { 'User-Agent': DictionaryService.WIKIMEDIA_USER_AGENT },
      }).catch((): null => null);
      this.wiktionaryPages.set(title, page);
      void page.then((r) => {
        if (!r) this.wiktionaryPages.delete(title);
      });
      if (this.wiktionaryPages.size > 120) this.wiktionaryPages.delete(this.wiktionaryPages.keys().next().value as string);
    }
    return page;
  }

  /** Whether `word`, typed with a capital, is a proper noun in its own right ("Paris", "May"). */
  private async isProperNoun(word: string): Promise<boolean> {
    if (!/^\p{Lu}/u.test(word) || word === foldLatinHeadword(word)) return false;
    const [own, lower] = await Promise.all([this.wiktionaryDefinitions(word), this.wiktionaryDefinitions(foldLatinHeadword(word))]);
    const proper = hasProperNoun(own) || capitalIsSpelling(own, lower);
    if (proper) this.properNouns.add(word);
    return proper;
  }

  /**
   * Get data from Wiktionary API with a focus on definitions and etymology.
   */
  private async getWiktionaryData(text: string, language: string): Promise<{
    definitions: Definition[];
    pronunciation?: string;
    pronunciations?: Pronunciation[];
    etymology?: string;
    wordFamily?: WordFamilyGroup[];
  }> {
    const term = language === 'en' ? foldLatinHeadword(text) : text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const wikiTextPromise = withTimeout(this.getWiktionaryWikitext(term), 2200, 'wiki.wikitext').catch((): string => '');
    const ipaPromise =
      language === 'en'
        ? wikiTextPromise.then((wt) => extractIpaFromWikitext(wt)).catch((): Pronunciation[] => [])
        : Promise.resolve([] as Pronunciation[]);
    try {
      // Lower case finds "marionette" for "Marionette". A capitalised word is also asked for as
      // typed, and its page comes first: "Paris" is the city before "paris", the plural of pari.
      // A page Wiktionary keeps only capitalised (the taxon "Whippomorpha", typed in lower case)
      // is asked for capitalised when the lower-case page does not exist.
      const typed = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      const capitalised = term.charAt(0).toLocaleUpperCase() + term.slice(1);
      let response: any = null;
      if (language === 'en' && typed !== term && /^\p{Lu}/u.test(typed)) {
        const [own, lower] = await Promise.all([this.wiktionaryDefinitions(typed), this.wiktionaryDefinitions(term)]);
        if (hasProperNoun(own)) {
          this.properNouns.add(typed);
          // The lower-case word's "plural of pari" says nothing about the city.
          response = mergeWiktionaryPages(own, withoutFormOf(lower));
        } else if (capitalIsSpelling(own, lower)) {
          // "Mr" is spelt with its capital; "mr" is only Marathi's language code and millirem.
          this.properNouns.add(typed);
          response = own;
        } else {
          // "Went" as a surname or a Yorkshire river comes after went, the past of go.
          response = mergeWiktionaryPages(lower, own);
        }
      } else {
        response = await this.wiktionaryDefinitions(term);
        if (!response && language === 'en' && capitalised !== term) response = await this.wiktionaryDefinitions(capitalised);
      }
      if (!response) throw new Error(`no Wiktionary page for ${term}`);
      // Removed verbose API response logging to prevent HTML floods

      // Prioritize the language detected or specified. A word English borrowed ("paparazzo",
      // detected as Italian) has senses there that only repeat the word as its English
      // translation; the English section is the one with meanings.
      const echoesWord = (list: any[]) =>
        Array.isArray(list) &&
        list.every((e) =>
          (e?.definitions || []).every((d: any) => foldLookupKey(stripGlossText(String(d?.definition || '')).replace(/\(.*\)/g, '')) === foldLookupKey(term)),
        );
      const own = response ? response[language] : null;
      const langData = response ? (own && !(language !== 'en' && response.en && echoesWord(own)) ? own : response['en']) : null;

      if (langData && Array.isArray(langData) && langData.length > 0) {
        const definitions: Definition[] = [];
        let pronunciation: string | undefined;
        let etymology: string | undefined;

        for (const entry of langData) {
          if (entry.definitions && Array.isArray(entry.definitions)) {
            const all: any[] = entry.definitions;
            all.forEach((def: any, i: number) => {
              // The page's References section comes back as more senses ("in Dictionary.com Unabridged").
              if (!def?.definition || isCitationGloss(def.definition)) return;
              let meaning = String(def.definition);
              let examples: string[] = def.examples || [];
              // A sense carries its sub-senses as a nested list ("A rigid tube … A water pipe."),
              // and the sub-senses follow as definitions of their own with their examples; keep
              // the sense's own text and examples only.
              const nested = /<(?:ol|ul)[\s>]/i.exec(meaning);
              if (nested) {
                meaning = meaning.slice(0, nested.index);
                const later = new Set(all.slice(i + 1).flatMap((d: any) => (d?.examples || []).map((e: string) => exampleKey(e))));
                examples = examples.filter((e) => !later.has(exampleKey(e)));
                // "Meanings relating to a wind instrument." heads a group; it is not a sense.
                if (/^\s*meanings? relating to\b/i.test(meaning.replace(/<[^>]+>/g, ' '))) return;
              }
              if (!meaning.replace(/<[^>]+>/g, '').trim()) return;
              definitions.push({
                partOfSpeech: this.normalizePartOfSpeech(entry.partOfSpeech),
                meaning,
                examples,
                source: 'Wiktionary'
              });
            });
          }
          if (!pronunciation && entry.pronunciations?.text) {
            const raw = Array.isArray(entry.pronunciations.text)
              ? entry.pronunciations.text.join(' ')
              : String(entry.pronunciations.text);
            const cleaned = cleanIpa(raw);
            if (cleaned) pronunciation = cleaned;
          }
          if (!etymology && entry.etymology) {
            etymology = entry.etymology;
          }
        }

        // If etymology is still not found, try a short-budget wikitext parse only
        // (do not call full multi-source fetch here — that hung the parallel race).
        if (!etymology) {
          try {
            const wikiOnly = await this.withTimeout(
              this.fetchEtymologyFromWikitext(term),
              1500,
              undefined as { text: string; chain?: EtymologyLink[] } | undefined,
            );
            if (wikiOnly?.text) etymology = wikiOnly.text;
          } catch {
            /* optional */
          }
        }

        const pronunciations = mergePronunciations(
          await ipaPromise,
          pronunciation && !/US\s|UK\s/.test(pronunciation)
            ? [{ ipa: pronunciation, accent: 'other', source: 'Wiktionary' }]
            : undefined,
        );
        const wikitext = await wikiTextPromise;
        const wordFamily = buildWordFamily({
          surface: term,
          wikitext,
          language,
          definitions,
        });
        return {
          definitions,
          pronunciation: formatPronunciationLine(pronunciations) || pronunciation,
          pronunciations,
          etymology,
          wordFamily: wordFamily.length ? wordFamily : undefined,
        };
      } else {
        const pronunciations = await ipaPromise;
        const wikitext = await wikiTextPromise;
        const wordFamily = buildWordFamily({ surface: term, wikitext, language, definitions: [] });
        return {
          definitions: [],
          pronunciations: pronunciations.length ? pronunciations : undefined,
          pronunciation: pronunciations.length ? formatPronunciationLine(pronunciations) : undefined,
          wordFamily: wordFamily.length ? wordFamily : undefined,
        };
      }

    } catch (error) {
      if (error instanceof DictionaryError && error.code === 'HTTP_404') {
        const pronunciations = await ipaPromise;
        const wikitext = await wikiTextPromise;
        const wordFamily = buildWordFamily({ surface: term, wikitext, language, definitions: [] });
        return {
          definitions: [],
          pronunciations: pronunciations.length ? pronunciations : undefined,
          pronunciation: pronunciations.length ? formatPronunciationLine(pronunciations) : undefined,
          wordFamily: wordFamily.length ? wordFamily : undefined,
        };
      }
      console.warn(`Wiktionary API failed for "${text}":`, error);
      throw error;
    }
  }

  /** Wiktionary pages being fetched, so the lookup, its IPA and its pictures share one request. */
  private wikitextInFlight = new Map<string, Promise<string>>();

  private getWiktionaryWikitext(word: string): Promise<string> {
    const head = foldLatinHeadword(word) || word.trim();
    if (!head) return Promise.resolve('');
    const pending = this.wikitextInFlight.get(head);
    if (pending) return pending;
    const p = this.fetchWiktionaryWikitext(head).finally(() => this.wikitextInFlight.delete(head));
    this.wikitextInFlight.set(head, p);
    return p;
  }

  private async fetchWiktionaryWikitext(head: string): Promise<string> {
    const wrapped = await this.cachedSource(
      'wiktionaryWikitext',
      head,
      async () => {
        const parseUrl = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(head)}&prop=wikitext&format=json&origin=*`;
        try {
          const response = await this.request<{
            parse?: { wikitext?: { '*': string } };
            error?: { code?: string };
          }>(parseUrl, {
            headers: { 'User-Agent': DictionaryService.WIKIMEDIA_USER_AGENT },
          });
          if (response?.error) return '';
          return response?.parse?.wikitext?.['*'] || '';
        } catch (error) {
          if (error instanceof DictionaryError && (error.code === 'HTTP_404' || error.code === 'HTTP_400')) {
            return '';
          }
          throw error;
        }
      },
      (data) => data.length > 0,
    );
    return wrapped.data || '';
  }

  private async fetchWiktionaryIpaPage(word: string): Promise<Pronunciation[]> {
    const wikitext = await this.getWiktionaryWikitext(word);
    return wikitext ? extractIpaFromWikitext(wikitext) : [];
  }

  private async getWiktionaryIpa(text: string): Promise<Pronunciation[]> {
    const head = foldLatinHeadword(text);
    if (!head) return [];
    return this.fetchWiktionaryIpaPage(head);
  }

  /**
   * Oxford Dictionary API
   */
  private async getOxfordData(text: string): Promise<{
    word: string;
    pronunciation?: string;
    definitions: Definition[];
    etymology?: string;
  } | null> {
    if (!this.oxfordAppId || !this.oxfordAppKey) return null;
    try {
      const url = `https://od-api.oxforddictionaries.com/api/v2/entries/en-gb/${encodeURIComponent(text.toLowerCase())}`;
      const response = await this.request<any>(url, {
        headers: {
          'app_id': this.oxfordAppId,
          'app_key': this.oxfordAppKey
        }
      });

      const results = response?.results || [];
      if (!Array.isArray(results) || results.length === 0) return null;

      const lexicalEntries = results[0]?.lexicalEntries || [];
      if (!Array.isArray(lexicalEntries) || lexicalEntries.length === 0) return null;
      const entry = lexicalEntries[0];
      const entries = entry?.entries || [];
      if (!Array.isArray(entries) || entries.length === 0) return null;
      const firstEntry = entries[0];

      const pronunciation = firstEntry?.pronunciations?.find((p: any) => p?.phoneticSpelling)?.phoneticSpelling;
      const senses = firstEntry?.senses || [];
      const definitions: Definition[] = [];
      for (const s of senses) {
        if (s?.definitions && s.definitions[0]) {
          definitions.push({
            partOfSpeech: this.normalizePartOfSpeech(entry?.lexicalCategory?.id || ''),
            meaning: s.definitions[0],
            examples: Array.isArray(s.examples) ? s.examples.map((ex: any) => ex?.text).filter(Boolean) : [],
            synonyms: Array.isArray(s.synonyms) ? s.synonyms.map((syn: any) => syn?.text).filter(Boolean) : [],
            antonyms: Array.isArray(s.antonyms) ? s.antonyms.map((ant: any) => ant?.text).filter(Boolean) : [],
            source: 'Oxford Dictionary API'
          });
        }
      }

      const etymology = Array.isArray(firstEntry?.etymologies) ? firstEntry.etymologies[0] : undefined;

      return {
        word: response?.word || text,
        pronunciation,
        definitions,
        etymology
      };
    } catch (error) {
      console.warn(`Oxford Dictionary API failed for "${text}":`, error);
      return null;
    }
  }

  /**
   * WordsAPI via RapidAPI
   */
  private async getWordsApiData(text: string): Promise<{
    word: string;
    pronunciation?: string;
    definitions: Definition[];
    synonyms?: string[];
    antonyms?: string[];
  } | null> {
    if (!this.wordsApiKey) return null;
    try {
      const url = `https://${this.wordsApiHost}/words/${encodeURIComponent(text.toLowerCase())}`;
      const response = await this.request<any>(url, {
        headers: {
          'X-RapidAPI-Key': this.wordsApiKey,
          'X-RapidAPI-Host': this.wordsApiHost
        }
      });

      const results = response?.results || [];
      const definitions: Definition[] = [];
      const synonyms: string[] = [];
      const antonyms: string[] = [];
      const pronunciation = (response?.pronunciation && (response.pronunciation.all || response.pronunciation)) || undefined;

      for (const r of results) {
        if (r?.definition) {
          definitions.push({
            partOfSpeech: this.normalizePartOfSpeech(r.partOfSpeech || ''),
            meaning: r.definition,
            examples: Array.isArray(r.examples) ? r.examples : [],
            synonyms: Array.isArray(r.synonyms) ? r.synonyms : [],
            antonyms: Array.isArray(r.antonyms) ? r.antonyms : [],
            source: 'WordsAPI'
          });
        }
        if (Array.isArray(r?.synonyms)) synonyms.push(...r.synonyms);
        if (Array.isArray(r?.antonyms)) antonyms.push(...r.antonyms);
      }

      return {
        word: response?.word || text,
        pronunciation,
        definitions,
        synonyms: [...new Set(synonyms)],
        antonyms: [...new Set(antonyms)]
      };
    } catch (error) {
      console.warn(`WordsAPI failed for "${text}":`, error);
      return null;
    }
  }

  /**
   * Collins Dictionary via RapidAPI (defensive parsing due to varied shapes)
   */
  private async getCollinsData(text: string): Promise<{
    word: string;
    definitions: Definition[];
    examples: string[];
  } | null> {
    if (!this.collinsApiKey || !this.collinsApiHost) return null;
    try {
      const url = `https://${this.collinsApiHost}/api/v1/dictionaries/english/entries/${encodeURIComponent(text.toLowerCase())}`;
      const response = await this.request<any>(url, {
        headers: {
          'X-RapidAPI-Key': this.collinsApiKey,
          'X-RapidAPI-Host': this.collinsApiHost
        }
      });

      const definitions: Definition[] = [];
      const examples: string[] = [];

      const entries = response?.entries || response || [];
      const arr = Array.isArray(entries) ? entries : [];
      for (const e of arr) {
        const senses = e?.senses || e?.sensesList || e?.entryContent || [];
        const senseArr = Array.isArray(senses) ? senses : [];
        for (const s of senseArr) {
          const def = s?.definition || s?.def || s?.sense || s?.text;
          if (typeof def === 'string' && def.trim()) {
            const exs = Array.isArray(s?.examples) ? s.examples.map((x: any) => (x?.text || x)).filter(Boolean) : [];
            definitions.push({
              partOfSpeech: this.normalizePartOfSpeech(s?.pos || s?.partOfSpeech || ''),
              meaning: def,
              examples: exs,
              source: 'Collins Dictionary API'
            });
            examples.push(...exs);
          }
        }
      }

      return { word: text, definitions, examples };
    } catch (error) {
      console.warn(`Collins API failed for "${text}":`, error);
      return null;
    }
  }

  /**
   * Youdao (Zh-EN) signed request
   */
  private async getYoudaoData(text: string, from: string, to: string): Promise<{
    word: string;
    pronunciation?: string;
    definitions: Definition[];
    translations: Translation[];
  } | null> {
    if (!this.youdaoAppKey || !this.youdaoAppSecret) return null;

    const salt = Date.now().toString();
    const curtime = Math.round(Date.now() / 1000).toString();
    const input = text.length > 20 ? `${text.substring(0, 10)}${text.length}${text.substring(text.length - 10)}` : text;
    const str1 = `${this.youdaoAppKey}${input}${salt}${curtime}${this.youdaoAppSecret}`;
    const sign = await Promise.resolve(getSha256Hex()(str1));

    const params = new URLSearchParams({
      q: text,
      from,
      to,
      appKey: this.youdaoAppKey,
      salt,
      sign,
      signType: 'v3',
      curtime,
    });

    try {
      const response = await this.request<any>('https://openapi.youdao.com/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response || response.errorCode !== '0') return null;

      const defs: Definition[] = [];
      if (response.basic && response.basic.explains) {
        for (const ex of response.basic.explains as string[]) {
          defs.push({ partOfSpeech: 'definition', meaning: ex, source: 'Youdao API' });
        }
      }

      if (Array.isArray(response.web)) {
        for (const w of response.web as Array<{ key: string; value: string[] }>) {
          if (w && w.key && Array.isArray(w.value)) {
            defs.push({ partOfSpeech: 'web-translation', meaning: `${w.key}: ${w.value.join(', ')}` , source: 'Youdao API' });
          }
        }
      }

      const translations: Translation[] = Array.isArray(response.translation)
        ? (response.translation as string[]).map((t: string) => ({ language: to, text: t, source: 'Youdao API' }))
        : [];

      return {
        word: text,
        pronunciation: response.basic?.phonetic,
        definitions: defs,
        translations
      };
    } catch (error) {
      console.warn(`Youdao API failed for "${text}":`, error);
      return null;
    }
  }

  /** CC-CEDICT lookup */
  private getCcCedictData(text: string): Definition[] {
    const entry = this.ccCedictData.get(text);
    if (!entry) return [];
    return [{ partOfSpeech: 'definition', meaning: entry, source: 'CC-CEDICT' }];
  }

  /** Caps a slow source so it cannot hold up the whole aggregation. */
  private withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return withTimeout(promise, ms, 'source').catch(() => fallback);
  }

  private static readonly DATAMUSE_POS: Record<string, string> = {
    n: 'noun',
    v: 'verb',
    adj: 'adjective',
    adv: 'adverb',
    u: 'unknown'
  };

  /**
   * Datamuse: keyless English lexical API. Supplies WordNet-derived glosses and
   * synonyms, and (`md=r`) an ARPAbet pronunciation for words CMUdict lacks, such as
   * "holon" and "operon", which becomes the US IPA when no other source transcribes the word.
   * Free for non-commercial use; an API key becomes mandatory in 2027.
   * https://www.datamuse.com/api/
   */
  private async getDatamuseData(text: string): Promise<{ definitions: Definition[]; synonyms: string[]; ipa?: string }> {
    const empty = { definitions: [] as Definition[], synonyms: [] as string[] };
    const word = text.toLocaleLowerCase();
    if (!/^[\p{L}][\p{L}'\- ]{0,40}$/u.test(word)) return empty;

    const encoded = encodeURIComponent(word);
    const [entries, related] = await Promise.all([
      // Shared with pluralHasOwnSense, which reads the same entry.
      withTimeout(
        datamuseEntry(getHttp(), word).then((hit): any[] => (hit ? [hit] : [])),
        2500,
        'datamuse.sp',
      ),
      withTimeout(
        this.request<any[]>(`https://api.datamuse.com/words?rel_syn=${encoded}&max=8`),
        2500,
        'datamuse.syn',
      ).catch((): any[] => []),
    ]);

    const definitions: Definition[] = [];
    const top = Array.isArray(entries) ? entries[0] : null;
    // `sp=` is a wildcard match, so confirm we got the word we asked for.
    const exact = !!top && typeof top.word === 'string' && top.word.toLocaleLowerCase() === word;
    // "pron:HH AA1 L AH0 N " (ARPAbet, as in CMUdict). One word only: a phrase's tag
    // runs its words together with no break.
    const pronTag = exact && !/\s/.test(word) && Array.isArray(top.tags)
      ? top.tags.find((t: unknown) => typeof t === 'string' && t.startsWith('pron:'))
      : undefined;
    const ipa = pronTag ? arpabetToIpa(String(pronTag).slice(5)) : '';
    if (exact && Array.isArray(top.defs)) {
      for (const raw of top.defs.slice(0, 12)) {
        const [pos, ...rest] = String(raw).split('\t');
        const meaning = rest.join('\t').trim();
        if (!meaning) continue;
        definitions.push({
          partOfSpeech: DictionaryService.DATAMUSE_POS[pos] || pos || 'unknown',
          meaning,
          source: 'Datamuse',
          // No defHeadword: WordNet defines this very form ("savings": a fund of money), as
          // pluralHasOwnSense judges it, rather than lending it its lemma's senses.
          ...(!top.defHeadword && isOwnNounGloss(String(raw)) ? { ownSense: true } : {}),
        });
      }
    }

    const synonyms = Array.isArray(related)
      ? related.map((r: any) => r?.word).filter((w: any): w is string => typeof w === 'string' && w.length > 0)
      : [];

    return { definitions, synonyms, ...(ipa ? { ipa } : {}) };
  }

  /**
   * Tatoeba: CC-BY corpus of human-written example sentences with translations.
   * Uses the public search endpoint; the bulk export is the offline alternative.
   */
  private async getTatoebaExamples(text: string, sourceLanguage: string, targetLanguage: string): Promise<string[]> {
    const term = text.trim();
    if (!term || term.length > 40) return [];

    const iso3: Record<string, string> = {
      en: 'eng', zh: 'cmn', ja: 'jpn', ko: 'kor', fr: 'fra',
      de: 'deu', es: 'spa', it: 'ita', ru: 'rus', pt: 'por'
    };
    const from = iso3[sourceLanguage] || 'eng';
    const to = iso3[targetLanguage] || 'cmn';
    if (from === to) return [];

    const search = (pair: string) => this.withTimeout<any>(
      this.request<any>(
        `https://tatoeba.org/en/api_v0/search?from=${from}${pair}&query=${encodeURIComponent(term)}&sort=relevance`
      ).catch((): any => null),
      2500,
      null
    );
    // `to=` keeps only sentences translated into that language; many words have none,
    // so fall back to untranslated source sentences rather than showing nothing.
    let results = (await search(`&to=${to}`))?.results;
    if (!Array.isArray(results) || results.length === 0) results = (await search(''))?.results;
    if (!Array.isArray(results)) return [];

    const examples: string[] = [];
    for (const item of results.slice(0, 4)) {
      const original = typeof item?.text === 'string' ? item.text.trim() : '';
      if (!original) continue;

      let rendered = original;
      const groups = Array.isArray(item?.translations) ? item.translations.flat() : [];
      const match = groups.find((t: any) => t && t.lang === to && typeof t.text === 'string');
      if (match) rendered = `${original} — ${match.text.trim()}`;

      examples.push(rendered);
    }

    return examples;
  }

  /**
   * Did-you-mean list for selections that resolved to nothing. Both endpoints
   * tolerate punctuation and typos, which makes them a good last resort.
   */
  private async fetchSpellingSuggestions(text: string): Promise<string[]> {
    const term = text.trim();
    if (!term || term.length > 40) return [];
    const encoded = encodeURIComponent(term);

    const [datamuse, wiktionary] = await Promise.all([
      this.withTimeout(
        this.request<any[]>(`https://api.datamuse.com/sug?s=${encoded}&max=6`).catch((): any[] => []),
        2000,
        [] as any[]
      ),
      this.withTimeout(
        this.request<any[]>(
          `https://en.wiktionary.org/w/api.php?action=opensearch&format=json&limit=6&search=${encoded}`,
          { headers: { 'User-Agent': DictionaryService.WIKIMEDIA_USER_AGENT } }
        ).catch((): any[] => []),
        2000,
        [] as any[]
      )
    ]);

    const out: string[] = [];
    const seen = new Set<string>([term.toLocaleLowerCase()]);

    const add = (word: unknown) => {
      if (typeof word !== 'string') return;
      const key = word.toLocaleLowerCase();
      if (!key || seen.has(key) || out.length >= 6) return;
      seen.add(key);
      out.push(word);
    };

    if (Array.isArray(datamuse)) datamuse.forEach((d: any) => add(d?.word));
    // opensearch returns [query, [titles], [descriptions], [urls]]
    if (Array.isArray(wiktionary) && Array.isArray(wiktionary[1])) wiktionary[1].forEach(add);

    return out;
  }

  /**
   * Fetches etymology from multiple sources for comprehensive coverage
   */
  private async fetchEtymologyFromMultipleSources(
    text: string
  ): Promise<EtymologyResult | undefined> {
    const labeled: string[] = [];
    let chain: EtymologyLink[] | undefined;

    const one = <T,>(p: Promise<T | undefined>, ms: number, label: string): Promise<T | undefined> =>
      withTimeout(p, ms, label).catch((error: unknown): undefined => {
        console.warn(`${label} failed`, error);
        return undefined;
      });

    // Per-source budgets: a 502 on Etymonline must not discard Wiktionary/Youdao.
    const [wiktionaryEtymology, etymonlineEtymology, youdaoEtymology, oxfordEtymology] = await Promise.all([
      one(this.fetchEtymologyFromWikitext(text), 4500, 'ety.wiktionary'),
      withTimeout(this.fetchEtymologyFromEtymonline(text), 10000, 'ety.etymonline')
        .catch((error: unknown) => etymonlineUnavailable(this.cleanWordForEtymology(text), etymologyErrorCode(error))),
      one(this.fetchEtymologyFromYoudao(text), 12000, 'ety.youdao'),
      this.oxfordAppId && this.oxfordAppKey
        ? one(this.fetchEtymologyFromOxford(text), 3500, 'ety.oxford')
        : Promise.resolve(undefined),
    ]);

    if (wiktionaryEtymology?.text) {
      labeled.push(`[Wiktionary]\n${wiktionaryEtymology.text}`);
      chain = wiktionaryEtymology.chain;
    }
    if (etymonlineEtymology?.text) {
      labeled.push(`[Etymonline]\n${etymonlineEtymology.text}`);
    }
    if (youdaoEtymology) {
      labeled.push(youdaoEtymology);
    }
    if (oxfordEtymology) {
      labeled.push(`[Oxford]\n${oxfordEtymology}`);
    }

    const unavailable = etymonlineEtymology?.unavailable ? [etymonlineEtymology.unavailable] : undefined;
    if (labeled.length === 0 && !unavailable?.length) return undefined;

    return {
      text: labeled.length ? labeled.join('\n\n--- Alternative etymology ---\n\n') : undefined,
      chain,
      unavailable,
    };
  }

  /**
     * Helper utility to extract clean word tokens for external web endpoints
     */
  private cleanWordForEtymology(text: string): string {
    if (!text) return '';
    // `\w` is ASCII-only in JavaScript, so the previous edge-strip destroyed
    // accented Latin ("café" -> "caf") and emptied every CJK query.
    return trimEdges(sanitize(text)).toLocaleLowerCase();
  }

  /**
   * Fetches etymology from Etymonline safely without crashing on HTML
   */
  private async fetchEtymologyFromEtymonline(text: string): Promise<EtymonlineResult | undefined> {
    const cleanWord = this.cleanWordForEtymology(text);
    if (!cleanWord) return undefined;

    // The site's own JSON endpoint answers without the Cloudflare page challenge
    // that guards /word/ pages, so it comes first and the HTML scrape is the fallback.
    try {
      const fromApi = await this.fetchEtymonlineApi(cleanWord);
      if (fromApi !== undefined) return fromApi.text ? fromApi : undefined;
    } catch (error) {
      console.warn(`Etymonline API failed for "${cleanWord}", trying the page:`, error);
    }

    try {
      const url = `https://www.etymonline.com/word/${encodeURIComponent(cleanWord)}`;
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.etymonline.com/',
      };
      let html = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await getHttp().requestText(url, { headers, timeoutMs: 8000 });
        if (response.ok) {
          html = response.text;
          break;
        }
        const retryable = [429, 502, 503, 504].includes(response.status);
        console.warn(`Etymonline returned HTTP ${response.status} for ${cleanWord}${retryable && attempt === 0 ? ', retrying' : ''}`);
        if (!retryable || attempt === 1) {
          return response.status === 404 ? undefined : etymonlineUnavailable(cleanWord, `HTTP_${response.status}`);
        }
        await new Promise((r) => setTimeout(r, 450));
      }
      if (!html) return undefined;
      // A page about another word (a redirect followed from "coverness" to "cover") is a miss.
      // Its canonical address names the word it is about.
      const pageWord =
        /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/word\/([^"'?#/]+)/i.exec(html)?.[1] ||
        /property=["']og:url["'][^>]+content=["'][^"']*\/word\/([^"'?#/]+)/i.exec(html)?.[1];
      if (pageWord && !sameHeadword(safeDecode(pageWord), cleanWord)) return undefined;
      let raw = '';

      const htmlToPlain = (s: string) =>
        s
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#x([0-9a-f]+);/gi, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)))
          .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(parseInt(n, 10)))
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/\s*See origin and meaning of .+$/i, '')
          .trim();

      // Full entry lives in prose-lg paragraphs. og:description is truncated with "…".
      const prose = html.match(/<section[^>]*class="[^"]*prose-lg[^"]*"[\s\S]{0,12000}?<\/section>/i);
      if (prose) {
        const paras = Array.from(prose[0].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
          .map((m) => htmlToPlain(m[1]))
          .filter((p) => p.length > 24 && !/go-to source|internet'?s go-to/i.test(p));
        if (paras.length) raw = paras.slice(0, 5).join('\n\n');
      }

      if (!raw) {
        const og =
          html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
          html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i) ||
          html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
        if (og?.[1]) raw = og[1];
      }

      if (!raw) {
        const jsonLd = html.match(
          /"@type"\s*:\s*"DefinedTerm"[\s\S]{0,400}?"description"\s*:\s*"((?:\\.|[^"\\])*)"/i,
        );
        if (jsonLd?.[1]) raw = jsonLd[1];
      }

      if (!raw) {
        const legacy =
          html.match(/<dd[^>]*>([\s\S]*?)<\/dd>/i) ||
          html.match(/<section[^>]*class="[^"]*word__defination[^"]*"[^>]*>([\s\S]*?)<\/section>/i);
        if (legacy?.[1]) raw = legacy[1];
      }

      if (!raw) return undefined;

      const etymology = htmlToPlain(raw).replace(/\u2026/g, '...');

      // Site-wide marketing / miss-page meta — not a word etymology.
      if (
        /go-to source|internet'?s go-to|the online etymology dictionary\s*\(/i.test(etymology) ||
        /quick and reliable accounts of the origin/i.test(etymology)
      ) {
        return undefined;
      }

      if (etymology.length > 20) {
        return { text: etymology };
      }
    } catch (error) {
      console.warn(`Etymonline fetch failed for "${cleanWord}":`, error);
      return etymonlineUnavailable(cleanWord, etymologyErrorCode(error));
    }

    return undefined;
  }

  /**
   * Etymonline's `/api/etymology?word=` JSON. Returns `{}` for a confirmed miss,
   * `undefined` when the response is not usable so the caller can try the page.
   */
  private async fetchEtymonlineApi(word: string, redirected = false): Promise<EtymonlineResult | undefined> {
    const response = await getHttp().requestText(
      `https://www.etymonline.com/api/etymology?word=${encodeURIComponent(word)}`,
      { headers: { Accept: 'application/json' }, timeoutMs: 8000 },
    );
    if (!response.ok) return undefined;
    let payload: {
      code?: number;
      data?: { items?: Array<{ replaced?: string; vocabularies?: Array<{ word?: string; property?: string; etymology_plain?: string }> }> };
    };
    try {
      payload = JSON.parse(response.text);
    } catch {
      return undefined;
    }
    // 10001 is the API's "Resource does not exist".
    if (payload.code === 10001) return {};
    if (payload.code !== 200 || !Array.isArray(payload.data?.items)) return undefined;

    const entries: string[] = [];
    let replaced: string | undefined;
    for (const item of payload.data.items) {
      if (typeof item.replaced === 'string' && item.replaced) replaced = item.replaced;
      for (const v of item.vocabularies || []) {
        const body = String(v.etymology_plain || '').replace(/\s+/g, ' ').trim();
        if (body.length < 12) continue;
        const head = [v.word, v.property].filter(Boolean).join(' ');
        entries.push(head ? `${head}: ${body}` : body);
        if (entries.length >= 4) break;
      }
    }
    if (entries.length) return { text: entries.join('\n\n') };
    // "café" comes back as { replaced: "cafe" } with no entries. Etymonline also "replaces" a word
    // it lacks with a different one ("coverness" with "cover"); that is a miss, not the word.
    if (replaced && !redirected && replaced !== word && sameHeadword(replaced, word)) return this.fetchEtymonlineApi(replaced, true);
    return {};
  }

  /**
   * Youdao mobile jsonapi — includes Chinese etymology snippets (童理民 and others).
   * No API key required for this public endpoint.
   */
  private async fetchEtymologyFromYoudao(text: string): Promise<string | undefined> {
    const cleanWord = this.cleanWordForEtymology(text);
    if (!cleanWord || cleanWord.length > 48) return undefined;

    try {
      const q = encodeURIComponent(cleanWord);
      const dicts = encodeURIComponent('{"count":1,"dicts":[["etym"]]}');
      const urls = [
        `https://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&le=en&q=${q}&dicts=${dicts}`,
        `https://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&le=en&q=${q}`,
        `http://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&le=en&q=${q}&dicts=${dicts}`,
      ];
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
      };
      let etyms: any;
      for (const url of urls) {
        const response = await getHttp()
          .requestText(url, { headers, timeoutMs: 5000 })
          .catch(() => ({ ok: false, status: 0, text: '' }));
        if (!response.ok || !response.text) continue;
        try {
          const data = JSON.parse(response.text) as { etym?: { etyms?: any; word?: string } };
          if (data?.etym?.etyms && typeof data.etym.etyms === 'object') {
            // The block names its word; a block about another word is not this word's history.
            const named = typeof data.etym.word === 'string' ? data.etym.word.trim() : '';
            if (named && !sameHeadword(named, cleanWord)) return undefined;
            etyms = data.etym.etyms;
            break;
          }
        } catch {
          /* next url */
        }
      }

      if (!etyms) return undefined;

      return serializeEtymologySources(groupYoudaoEtymologies(etyms, cleanWord));
    } catch (error) {
      console.warn(`Youdao etymology failed for "${cleanWord}":`, error);
      return undefined;
    }
  }

  /**
   * Fetches etymology from Oxford Dictionary API
   */
  private async fetchEtymologyFromOxford(text: string): Promise<string | undefined> {
    if (!this.oxfordAppId || !this.oxfordAppKey) return undefined;

    try {
      const url = `https://od-api.oxforddictionaries.com/api/v2/entries/en-gb/${encodeURIComponent(text.toLowerCase())}`;
      const response = await this.request<any>(url, {
        headers: {
          'app_id': this.oxfordAppId,
          'app_key': this.oxfordAppKey
        }
      });

      const results = response?.results || [];
      if (Array.isArray(results) && results.length > 0) {
        const lexicalEntries = results[0]?.lexicalEntries || [];
        if (Array.isArray(lexicalEntries) && lexicalEntries.length > 0) {
          const entries = lexicalEntries[0]?.entries || [];
          if (Array.isArray(entries) && entries.length > 0) {
            const etymology = entries[0]?.etymologies;
            if (Array.isArray(etymology) && etymology.length > 0) {
              return `From Oxford Dictionary: ${etymology[0]}`;
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Oxford etymology fetch failed:`, error);
    }

    return undefined;
  }

  /**
   * Fetches and parses raw Wiktionary wikitext for etymology
   */
  private async fetchEtymologyFromWikitext(
    text: string
  ): Promise<{ text: string; chain?: EtymologyLink[] } | undefined> {
    try {
      const cleanWord = this.cleanWordForEtymology(text);
      if (!cleanWord) return undefined;

      const wikitext = await this.getWiktionaryWikitext(cleanWord);
      if (!wikitext) {
        return undefined;
      }

      return this.parseEtymology(wikitext);

    } catch (error) {
      console.warn(`Wiktionary etymology fetch failed for "${text}":`, error);
    }
    return undefined;
  }

  private extractEtymologyFromWikitext(wikitext: string): string | undefined {
    return this.parseEtymology(wikitext)?.text;
  }

  /**
   * Template-aware parse first: it handles numbered Etymology sections and
   * renders {{inh}}/{{bor}}/{{der}}/{{root}} into an ancestry chain. Falls back
   * to the older regex scraper when the templates yield nothing.
   */
  private parseEtymology(wikitext: string): { text: string; chain?: EtymologyLink[] } | undefined {
    try {
      const parsed = buildEtymology(wikitext);
      if (parsed && (parsed.text.length >= 10 || parsed.chain.length > 0)) {
        return { text: parsed.text, chain: parsed.chain.length > 0 ? parsed.chain : undefined };
      }
    } catch (error) {
      console.warn('Structured etymology parse failed, falling back:', error);
    }

    const legacy = this.extractEtymologyFromWikitextLegacy(wikitext);
    return legacy ? { text: legacy } : undefined;
  }

  private extractEtymologyFromWikitextLegacy(wikitext: string): string | undefined {
    const englishSectionIndex = wikitext.indexOf('==English==');
    if (englishSectionIndex !== -1) {
      const englishContent = wikitext.substring(englishSectionIndex);
      const englishEtymologyMatch = englishContent.match(/===Etymology===([\s\S]*?)(?====|$)/);
      if (englishEtymologyMatch) {
        return this.processEtymologyText(englishEtymologyMatch[1]);
      }
    }

    const etymologyPatterns = [
      /===\s*Etymology\s*===\s*\n(.+?)(?=\n===|$)/,
      /==\s*Etymology\s*==\s*\n(.+?)(?=\n==|$)/,
      /=\s*Etymology\s*=\s*\n(.+?)(?=\n=|$)/,
      /Etymology\s*\n(.+?)(?=\n==|$)/,
      /Origin\s*\n(.+?)(?=\n==|$)/,
      /History\s*\n(.+?)(?=\n==|$)/,
      /Derivation\s*\n(.+?)(?=\n==|$)/,
      /===\s*Etymology\s*\d*\s*===\s*\n(.+?)(?=\n===|$)/,
      /==\s*Etymology\s*\d*\s*==\s*\n(.+?)(?=\n==|$)/,
    ];

    for (const pattern of etymologyPatterns) {
      const match = wikitext.match(pattern);
      if (match && match[1]) {
        return this.processEtymologyText(match[1]);
      }
    }

    const etymologyKeywords = ['etymology', 'origin', 'from', 'derived from', 'comes from', 'root'];
    const etymologyLines: string[] = [];
    for (const line of wikitext.split('\n')) {
      const lowerLine = line.toLowerCase();
      if (etymologyKeywords.some((keyword) => lowerLine.includes(keyword)) && !line.includes('==') && line.trim().length > 10) {
        etymologyLines.push(line);
      }
    }
    if (etymologyLines.length > 0) {
      return this.processEtymologyText(etymologyLines.slice(0, 3).join(' '));
    }
    return undefined;
  }

  /**
   * Process and clean etymology text with enhanced formatting
   */
  private processEtymologyText(etymologyText: string): string | undefined {
    if (!etymologyText || etymologyText.trim().length < 10) {
      return undefined;
    }

    // Enhanced cleanup of wikitext with better formatting
    let cleanedText = etymologyText
      // Handle multiple etymology entries (numbered sections)
      .replace(/===\s*Etymology\s+(\d+)\s*===\s*\n/g, '\n\n=== Etymology $1 ===\n')
      // Handle complex templates with multiple parameters
      .replace(/\{\{([^|]+)\|([^}]+)\}\}/g, (match, template, params) => {
        const paramList = params.split('|');
        const templateLower = template.toLowerCase();

        // Handle different template types intelligently
        if (templateLower === 'inh' || templateLower === 'inherited') {
          // {{inh|en|enm|primitif}} -> "Middle English primitif"
          if (paramList.length >= 3) {
            const targetLang = paramList[0];
            const sourceLang = paramList[1];
            const word = paramList[2];
            // Simplify language codes to readable names
            const langNames: Record<string, string> = {
              'en': 'English', 'enm': 'Middle English', 'fro': 'Old French',
              'la': 'Latin', 'grc': 'Ancient Greek', 'de': 'German',
              'fr': 'French', 'it': 'Italian', 'es': 'Spanish'
            };
            const readableSource = langNames[sourceLang] || sourceLang;
            return `${readableSource} ${word}`;
          }
        } else if (templateLower === 'der' || templateLower === 'derived') {
          // {{der|en|fro|primitif}} -> "Old French primitif"
          if (paramList.length >= 3) {
            const targetLang = paramList[0];
            const sourceLang = paramList[1];
            const word = paramList[2];
            const langNames: Record<string, string> = {
              'en': 'English', 'enm': 'Middle English', 'fro': 'Old French',
              'la': 'Latin', 'grc': 'Ancient Greek', 'de': 'German',
              'fr': 'French', 'it': 'Italian', 'es': 'Spanish'
            };
            const readableSource = langNames[sourceLang] || sourceLang;
            return `${readableSource} ${word}`;
          }
        } else if (templateLower === 'bor' || templateLower === 'borrowed') {
          // {{bor|en|fr|sibérien}} -> "borrowed from French sibérien"
          if (paramList.length >= 3) {
            const targetLang = paramList[0];
            const sourceLang = paramList[1];
            const word = paramList[2];
            const langNames: Record<string, string> = {
              'en': 'English', 'enm': 'Middle English', 'fro': 'Old French',
              'la': 'Latin', 'grc': 'Ancient Greek', 'de': 'German',
              'fr': 'French', 'it': 'Italian', 'es': 'Spanish'
            };
            const readableSource = langNames[sourceLang] || sourceLang;
            return `borrowed from ${readableSource} ${word}`;
          }
        } else if (templateLower === 'af' || templateLower === 'affix') {
          // {{af|en|base|-al}} -> "base + -al"
          if (paramList.length >= 3) {
            const lang = paramList[0];
            const root = paramList[1];
            const suffix = paramList[2];
            return `${root} + ${suffix}`;
          }
        } else if (templateLower === 'root') {
          // {{root|en|ine-pro|*gʷem-}} -> "from Proto-Indo-European *gʷem-"
          if (paramList.length >= 3) {
            const lang = paramList[0];
            const family = paramList[1];
            const rootWord = paramList[2];

            // Map common language families to readable names
            const familyNames: Record<string, string> = {
              'ine-pro': 'Proto-Indo-European',
              'gem-pro': 'Proto-Germanic',
              'itc-pro': 'Proto-Italic',
              'grk-pro': 'Proto-Hellenic',
              'cel-pro': 'Proto-Celtic',
              'enm': 'Middle English',
              'ang': 'Old English',
              'fro': 'Old French',
              'la': 'Latin',
              'grc': 'Ancient Greek',
              'sa': 'Sanskrit',
              'got': 'Gothic',
              'xno': 'Old Norse'
            };

            const readableFamily = familyNames[family] || family.replace('-', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
            return `from ${readableFamily} ${rootWord}`;
          }
        } else if (templateLower === 'm' || templateLower === 'mention') {
          // {{m|la|prīmits|t=first}} -> "Latin prīmits ("first")"
          if (paramList.length >= 2) {
            const lang = paramList[0];
            const word = paramList[1];
            let gloss = '';
            // Look for gloss parameter (t=...)
            for (const param of paramList.slice(2)) {
              if (param.startsWith('t=')) {
                gloss = param.substring(2);
                break;
              }
            }
            const langNames: Record<string, string> = {
              'en': 'English', 'enm': 'Middle English', 'fro': 'Old French',
              'la': 'Latin', 'grc': 'Ancient Greek', 'de': 'German',
              'fr': 'French', 'it': 'Italian', 'es': 'Spanish'
            };
            const readableLang = langNames[lang] || lang;
            return gloss ? `${readableLang} ${word} ("${gloss}")` : `${readableLang} ${word}`;
          }
        } else if (templateLower === 'doublet') {
          // {{doublet|en|primitivo}} -> "doublet of primitivo"
          if (paramList.length >= 2) {
            const lang = paramList[0];
            const doubletWord = paramList[1];
            return `doublet of ${doubletWord}`;
          }
        } else if (templateLower === 'cog' || templateLower === 'cognate') {
          // {{cog|fr|base}} -> "cognate with French base"
          if (paramList.length >= 2) {
            const lang = paramList[0];
            const cognateWord = paramList[1];
            const langNames: Record<string, string> = {
              'en': 'English', 'enm': 'Middle English', 'fro': 'Old French',
              'la': 'Latin', 'grc': 'Ancient Greek', 'de': 'German',
              'fr': 'French', 'it': 'Italian', 'es': 'Spanish'
            };
            const readableLang = langNames[lang] || lang;
            return `cognate with ${readableLang} ${cognateWord}`;
          }
        }

        // For other templates, try to extract the most meaningful content
        // Filter out parameters that look like language codes or metadata
        const meaningfulParams = paramList.filter((param: string) =>
          !param.match(/^(en|fr|de|la|grc|fro|enm|ang)$/) && // Not just language codes
          !param.startsWith('t=') && // Not gloss parameters
          param.length > 1 // Not single characters
        );

        return meaningfulParams.length > 0 ? meaningfulParams[meaningfulParams.length - 1] : '';
      })
      .replace(/\{\{[^}]*\}\}/g, '') // Remove any remaining unprocessed templates
      // Convert wikilinks to readable format
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<strong>$2</strong>') // [[target|display]] -> bold display
      .replace(/\[\[([^\]]+)\]\]/g, '<strong>$1</strong>') // [[word]] -> bold word
      // Preserve emphasis
      .replace(/'''([^']*)'''/g, '<strong>$1</strong>')
      .replace(/''([^']*)''/g, '<em>$1</em>')
      // Remove references and other markup
      .replace(/<ref[^>]*>.*?<\/ref>/g, '')
      .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
      // Clean up whitespace and formatting
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n') // Preserve paragraph breaks
      .trim();



    if (cleanedText.length < 10) {
      return undefined;
    }

    // For etymology, we want to preserve the full derivation chain
    // Only truncate if it's extremely long (>1000 chars)
    if (cleanedText.length > 1000) {
      // Try to find a good breaking point
      const truncatedAtSentence = cleanedText.substring(0, 800);
      const lastSentenceEnd = Math.max(
        truncatedAtSentence.lastIndexOf('.'),
        truncatedAtSentence.lastIndexOf(';'),
        truncatedAtSentence.lastIndexOf(',')
      );

      if (lastSentenceEnd > 600) {
        return cleanedText.substring(0, lastSentenceEnd + 1).trim() + '...';
      } else {
        return cleanedText.substring(0, 800).trim() + '...';
      }
    }

    // Clean up redundant "from" keywords that might appear from the original text structure
    let finalText = cleanedText
      // Fix duplicate "from" patterns: "from from" -> "from"
      .replace(/\bfrom\s+from\b/gi, 'from')
      // Clean up any awkward spacing
      .replace(/\s+/g, ' ')
      .trim();

    return finalText;
  }

  /**
   * Attempt to extract example sentences from Wiktionary wikitext for the term
   */
  private async fetchExamplesFromWikitext(text: string): Promise<string[]> {
    try {
      const parseUrl = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(text)}&prop=wikitext&format=json&origin=*`;
      const response = await this.request<{ parse?: { wikitext?: { '*': string } } }>(parseUrl);
      const wikitext = response?.parse?.wikitext?.['*'] || '';
      if (!wikitext) return [];
      // Grab lines starting with #* (citations/examples) within the English section
      const englishSectionMatch = wikitext.match(/==\s*English\s*==([\s\S]*?)(?=\n==|$)/);
      const english = englishSectionMatch ? englishSectionMatch[1] : wikitext;
      const lines = english.split('\n');
      const examples: string[] = [];
      for (const line of lines) {
        if (/^#\*/.test(line.trim())) {
          let cleaned = line.replace(/^#\*\s*/, '');
          cleaned = cleaned
            .replace(/\{\{[^}]+\}\}/g, '')
            .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
            .replace(/'''|''/g, '')
            .replace(/<ref[^>]*>.*?<\/ref>/g, '')
            .trim();
          if (cleaned) examples.push(cleaned);
          if (examples.length >= 5) break;
        }
      }
      return examples;
    } catch (_e) {
      return [];
    }
  }

  /**
   * Basic etymology pattern analysis (fallback only)
   */
  private getBasicEtymologyPattern(text: string): string | undefined {
    if (text.length <= 2) return undefined;

    // Very basic pattern analysis as a last resort
    if (text.endsWith('tion')) {
      return `Contains Latin suffix "-tion" (action or result). Etymology available through detailed lookup.`;
    }
    if (text.endsWith('ness')) {
      return `Contains Old English suffix "-ness" (state or condition). Etymology available through detailed lookup.`;
    }
    if (text.endsWith('ment')) {
      return `Contains Latin suffix "-ment" (means or result of action). Etymology available through detailed lookup.`;
    }
    if (text.startsWith('un')) {
      return `Contains prefix "un-" (not, reverse of). Etymology available through detailed lookup.`;
    }
    if (text.startsWith('re')) {
      return `Contains prefix "re-" (again, back). Etymology available through detailed lookup.`;
    }
    
    return undefined;
  }

  /**
   * Get best available translation
   */
  private async translateWithProvider(
    provider: Exclude<TranslationProvider, 'auto'>,
    text: string,
    targetLanguage: string,
    sourceLanguage: string,
  ): Promise<Translation | null> {
    if (provider === 'youdao') {
      if (!this.youdaoAppKey || !this.youdaoAppSecret) return null;
      try {
        const from = sourceLanguage === 'ja' ? 'ja' : sourceLanguage === 'ko' ? 'ko' : 'zh-CHS';
        const to =
          targetLanguage === 'zh' || targetLanguage.startsWith('zh')
            ? 'zh-CHS'
            : targetLanguage || 'en';
        const youdao = await this.getYoudaoData(text, from, to === 'en' ? 'en' : to);
        const t = youdao?.translations?.[0];
        if (t?.text) return { ...t, source: 'Youdao API' };
      } catch (error) {
        console.warn('Youdao translation failed:', error);
      }
      return null;
    }

    if (provider === 'deepl') {
      if (!this.deeplApiKey) return null;
      try {
        const deeplTranslation = await this.getDeepLTranslation(text, targetLanguage, sourceLanguage);
        if (deeplTranslation) return { ...deeplTranslation, source: 'DeepL API' };
      } catch (error) {
        console.warn('DeepL translation failed:', error);
      }
      return null;
    }

    if (provider === 'google') {
      try {
        const unofficial = await this.getGoogleTranslateUnofficial(text, targetLanguage, sourceLanguage);
        if (unofficial) return unofficial;
      } catch (error) {
        console.warn('Unofficial Google translation failed:', error);
      }
      if (this.apiKey) {
        try {
          const googleTranslation = await this.getGoogleTranslation(text, targetLanguage, sourceLanguage);
          if (googleTranslation) return { ...googleTranslation, source: 'Google Translate API' };
        } catch (error) {
          console.warn('Google Translate failed:', error);
        }
      }
      return null;
    }

    try {
      return await this.getMyMemoryTranslation(text, targetLanguage, sourceLanguage);
    } catch (error) {
      console.warn('MyMemory translation failed:', error);
      return null;
    }
  }

  /** Whether a source is on for this lookup: the lookup's own list when it passes one. */
  private isNamedSourceOn(name: string, enabledSources?: string[]): boolean {
    if (enabledSources) return enabledSources.includes(name);
    const src = this.sources.find((x) => x.name === name);
    return !!src && src.enabled && src.isAvailable;
  }

  /** Engines that can translate now: Google and MyMemory always, DeepL and Youdao with a key. */
  availableTranslationProviders(): Array<Exclude<TranslationProvider, 'auto'>> {
    const out: Array<Exclude<TranslationProvider, 'auto'>> = ['google', 'mymemory'];
    if (this.deeplApiKey) out.push('deepl');
    if (this.youdaoAppKey && this.youdaoAppSecret) out.push('youdao');
    return out;
  }

  /**
   * Translate a passage with one engine, or with the first that answers for `auto`. A source of
   * `auto` is detected first, and a target of `auto` follows the usual pairing (English to
   * Chinese, everything else to English). Quick translation calls this.
   */
  async translateText(
    text: string,
    targetLanguage = 'auto',
    sourceLanguage = 'auto',
    provider: TranslationProvider = 'auto',
  ): Promise<Translation | null> {
    const input = String(text || '').trim();
    if (!input) return null;
    const source = !sourceLanguage || sourceLanguage === 'auto' ? await this.detectSourceLanguage(input) : sourceLanguage;
    let target = this.resolveTargetLanguage(source, targetLanguage);
    // Text already in the target language goes the other way (Chinese with a Chinese target → English).
    if (target === source.toLowerCase().split('-')[0]) target = this.defaultTargetForSource(source);
    const hit =
      provider === 'auto'
        ? await this.getBestTranslation(input, target, source, 'auto')
        : await this.translateWithProvider(provider, input, target, source);
    return hit ? { ...hit, language: hit.language || target, detectedSourceLanguage: hit.detectedSourceLanguage || source } : null;
  }

  private async getBestTranslation(
    text: string,
    targetLanguage: string,
    sourceLanguage: string,
    preferred: TranslationProvider = 'auto',
  ): Promise<Translation | null> {
    const freeFirst: Array<Exclude<TranslationProvider, 'auto'>> = ['google', 'mymemory', 'youdao', 'deepl'];
    const order: Array<Exclude<TranslationProvider, 'auto'>> =
      preferred === 'youdao'
        ? ['youdao', 'google', 'mymemory', 'deepl']
        : preferred === 'deepl'
          ? ['deepl', 'google', 'mymemory', 'youdao']
          : preferred === 'mymemory'
            ? ['mymemory', 'google', 'youdao', 'deepl']
            : preferred === 'google'
              ? ['google', 'mymemory', 'youdao', 'deepl']
              : freeFirst;

    for (const p of order) {
      const hit = await this.translateWithProvider(p, text, targetLanguage, sourceLanguage);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Get translation from DeepL API
   */
  private async getDeepLTranslation(text: string, targetLanguage: string, sourceLanguage: string): Promise<Translation | null> {
    try {
      const url = 'https://api-free.deepl.com/v2/translate';
      const response = await this.request<{ translations: { text: string; detected_source_language: string }[] }>(url, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.deeplApiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `text=${encodeURIComponent(text)}&target_lang=${targetLanguage}&source_lang=${sourceLanguage}`
      });

      if (response.translations && response.translations.length > 0) {
        return {
          language: targetLanguage,
          text: response.translations[0].text,
          confidence: 0.95
        };
      }

      return null;
    } catch (error) {
      console.error('DeepL translation error:', error);
      const response = (error as { response?: { data?: unknown } }).response;
      if (response) {
        console.error('DeepL response:', response.data);
      }
      return null;
    }
  }

  /**
   * Get translation from Google Translate API
   */
  private async getGoogleTranslation(text: string, targetLanguage: string, sourceLanguage: string): Promise<Translation | null> {
    try {
      const url = `https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`;
      const response = await this.request<{ data: { translations: { translatedText: string; detectedSourceLanguage?: string }[] } }>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: text,
          target: targetLanguage,
          source: sourceLanguage === 'auto' ? undefined : sourceLanguage,
          format: 'text'
        })
      });

      if (response.data?.translations && response.data.translations.length > 0) {
        const translation = response.data.translations[0];
        return {
          language: targetLanguage,
          text: translation.translatedText,
          confidence: 0.9,
          detectedSourceLanguage: translation.detectedSourceLanguage
        };
      }

      return null;
    } catch (error) {
      console.error('Google Translate error:', error);
      const response = (error as { response?: { data?: unknown } }).response;
      if (response) {
        console.error('Google Translate response:', response.data);
      }
      return null;
    }
  }

  /**
   * Mock translation for development/testing
   */
  private getMockTranslation(text: string, targetLanguage: string, sourceLanguage: string): Translation | null {
    const mockTranslations: Record<string, Record<string, string>> = {
      'hello': {
        'zh': '你好',
        'es': 'hola',
        'fr': 'bonjour',
        'de': 'hallo',
        'ja': 'こんにちは',
        'ko': '안녕하세요',
        'ar': 'مرحبا',
        'ru': 'привет'
      },
      'world': {
        'zh': '世界',
        'es': 'mundo',
        'fr': 'monde',
        'de': 'welt',
        'ja': '世界',
        'ko': '세계',
        'ar': 'عالم',
        'ru': 'мир'
      },
      'goodbye': {
        'zh': '再见',
        'es': 'adiós',
        'fr': 'au revoir',
        'de': 'auf wiedersehen',
        'ja': 'さようなら',
        'ko': '안녕히 가세요',
        'ar': 'وداعا',
        'ru': 'до свидания'
      },
      'test': {
        'zh': '测试',
        'es': 'prueba',
        'fr': 'test',
        'de': 'test',
        'ja': 'テスト',
        'ko': '테스트',
        'ar': 'اختبار',
        'ru': 'тест'
      },
      'computer': {
        'zh': '计算机',
        'es': 'computadora',
        'fr': 'ordinateur',
        'de': 'computer',
        'ja': 'コンピューター',
        'ko': '컴퓨터',
        'ar': 'كمبيوتر',
        'ru': 'компьютер'
      }
    };

    // Handle Chinese input
    if (sourceLanguage === 'zh') {
      const chineseToEnglish: Record<string, string> = {
        '你好': 'hello',
        '世界': 'world',
        '再见': 'goodbye',
        '测试': 'test',
        '计算机': 'computer',
        '学习': 'study',
        '工作': 'work',
        '朋友': 'friend',
        '家庭': 'family',
        '时间': 'time'
      };
      
      if (chineseToEnglish[text]) {
        return {
          language: targetLanguage,
          text: chineseToEnglish[text],
          confidence: 0.8
        };
      }
    }

    // Handle numbers
    if (/^\d+$/.test(text)) {
      const numberTranslations: Record<string, string> = {
        '1': 'one',
        '2': 'two',
        '3': 'three',
        '4': 'four',
        '5': 'five',
        '10': 'ten',
        '100': 'hundred',
        '1000': 'thousand'
      };
      
      if (numberTranslations[text]) {
        return {
          language: targetLanguage,
          text: numberTranslations[text],
          confidence: 0.9
        };
      }
    }

    const lowerText = text.toLowerCase();
    if (mockTranslations[lowerText] && mockTranslations[lowerText][targetLanguage]) {
      const result = {
        language: targetLanguage,
        text: mockTranslations[lowerText][targetLanguage],
        confidence: 0.5,
        source: 'Mock Translation'
      };
      return result;
    }

    // For unknown words, provide a basic translation pattern
    if (targetLanguage === 'zh') {
      const zhResult = {
        language: targetLanguage,
        text: `[中文翻译] ${text}`,
        confidence: 0.1,
        source: 'Mock Translation'
      };
      return zhResult;
    } else if (targetLanguage === 'ja') {
      const jaResult = {
        language: targetLanguage,
        text: `[日本語翻訳] ${text}`,
        confidence: 0.1,
        source: 'Mock Translation'
      };
      return jaResult;
    } else if (targetLanguage === 'ko') {
      const koResult = {
        language: targetLanguage,
        text: `[한국어 번역] ${text}`,
        confidence: 0.1,
        source: 'Mock Translation'
      };
      return koResult;
    }

    const fallbackResult = {
      language: targetLanguage,
      text: `[${targetLanguage.toUpperCase()}] ${text}`,
      confidence: 0.1,
      source: 'Mock Translation'
    };
    return fallbackResult;
  }

  /**
   * Detect the language of the input text: the script and letters first, then a plain word
   * list for single ASCII words, then a remote detector for what is still ambiguous.
   */
  async detectLanguage(text: string): Promise<string> {
    return this.detectSourceLanguage(text);
  }

  private async detectSourceLanguage(text: string): Promise<string> {
    const local = detectLanguageLocal(text);
    // Han text with nothing telling stays Chinese: a remote guess on two characters is no
    // better, and waiting for it slowed every such lookup where Google is unreachable.
    if (isAmbiguousHan(text)) return local.lang;
    // Short Latin text whose words the English word list has is English, accents or not
    // ("café", "machine learning").
    const words = englishCandidateWords(text);
    if (words) {
      const known = await Promise.race([
        Promise.all(words.map((w) => isCmuWord(w))),
        new Promise<null>((r) => setTimeout(() => r(null), 600)),
      ]);
      if (known === null || known.some((k) => k === null)) return local.confident ? local.lang : 'en';
      if (known.every(Boolean)) return 'en';
    }
    if (local.confident) return local.lang;
    const remote = await Promise.race([
      this.remoteDetectLanguage(text),
      new Promise<string>((r) => setTimeout(() => r(''), 900)),
    ]);
    return remote && remoteFitsScript(text, remote) ? remote : local.lang;
  }

  private async remoteDetectLanguage(text: string): Promise<string> {
    const key = text.slice(0, 200);
    const memo = this.remoteDetectMemo.get(key);
    if (memo !== undefined) return memo;
    if (Date.now() < this.remoteDetectCoolUntil) return '';
    let lang = '';
    try {
      if (this.apiKey) {
        const url = `https://translation.googleapis.com/language/translate/v2/detect?key=${this.apiKey}`;
        const response = await this.request<{ data: { detections: Array<Array<{ language: string }>> } }>(url, {
          method: 'POST',
          body: JSON.stringify({ q: key }),
          timeoutMs: 1500,
        });
        lang = response.data.detections[0][0].language || '';
      } else {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(key)}`;
        const response = await this.request<any>(url, { timeoutMs: 1500 });
        lang = Array.isArray(response) && typeof response[2] === 'string' ? response[2] : '';
      }
    } catch {
      this.remoteDetectCoolUntil = Date.now() + 10 * 60_000;
      return '';
    }
    const norm = ({ iw: 'he', jw: 'jv', 'zh-cn': 'zh', 'zh-tw': 'zh' } as Record<string, string>)[lang.toLowerCase()] || lang.toLowerCase().split('-')[0];
    if (this.remoteDetectMemo.size > 500) this.remoteDetectMemo.clear();
    this.remoteDetectMemo.set(key, norm);
    return norm;
  }



  /**
   * Get available sources
   */
  getAvailableSources(): DictionarySource[] {
    return this.sources.filter(source => source.isAvailable);
  }

  /**
   * Get source statistics
   */
  getSourceStats(): { total: number; available: number; sources: DictionarySource[] } {
    return {
      total: this.sources.length,
      available: this.sources.filter(s => s.isAvailable).length,
      sources: this.sources
    };
  }


  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.sourceLayer.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }

  /**
   * Get enabled dictionary sources
   */
  getEnabledSources(): string[] {
    return this.sources.filter(s => s.enabled).map(s => s.name);
  }

  /**
   * Set dictionary source enabled/disabled state
   */
  setSourceEnabled(sourceName: string, enabled: boolean): void {
    this.sources = this.sources.map(source => {
      if (source.name === sourceName) {
        return { ...source, enabled };
      }
      return source;
    });
  }

  /** Mark SQLite CC-CEDICT (or any offline pack) as available in the Sources UI. */
  markOfflinePackAvailable(sourceName = 'CC-CEDICT', enabled = true): void {
    this.ccCedictLoaded = true;
    this.sources = this.sources.map((source) => {
      if (source.name === sourceName) {
        return { ...source, isAvailable: true, enabled };
      }
      return source;
    });
  }

  /**
   * Get all supported languages
   */
  getSupportedLanguages(): { code: string; name: string; nativeName: string }[] {
    return [
      { code: 'auto', name: 'Auto-detect', nativeName: 'Auto-detect' },
      { code: 'en', name: 'English', nativeName: 'English' },
      { code: 'zh', name: 'Chinese', nativeName: '中文' },
      { code: 'ja', name: 'Japanese', nativeName: '日本語' },
      { code: 'ko', name: 'Korean', nativeName: '한국어' },
      { code: 'es', name: 'Spanish', nativeName: 'Español' },
      { code: 'fr', name: 'French', nativeName: 'Français' },
      { code: 'de', name: 'German', nativeName: 'Deutsch' },
      { code: 'it', name: 'Italian', nativeName: 'Italiano' },
      { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
      { code: 'ru', name: 'Russian', nativeName: 'Русский' },
      { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
      { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
      { code: 'th', name: 'Thai', nativeName: 'ไทย' },
    ];
  }

  /**
   * Normalize part of speech strings
   */
  private normalizePartOfSpeech(pos: string): string {
    return canonicalPos(pos);
  }
}

// Export singleton instance
export const dictionaryService = new DictionaryService();

// A word saved from a lookup is saved as the word the lookup opens ("geese" as goose).
registerHeadwordResolver((word, lang) => dictionaryService.settledHeadword(word, lang)); 

/** Two Wiktionary definition pages as one, the first page's entries first in each language. */
function mergeWiktionaryPages(first: any, second: any): any {
  if (!first) return second || null;
  if (!second) return first;
  const out: Record<string, unknown[]> = {};
  for (const key of new Set([...Object.keys(first), ...Object.keys(second)])) {
    out[key] = [...(Array.isArray(first[key]) ? first[key] : []), ...(Array.isArray(second[key]) ? second[key] : [])];
  }
  return out;
}

/**
 * Whether a Wiktionary definitions page has a proper noun that stands for something in its own
 * right: the city of Paris, the month of May. One whose first sense is only a surname, a given
 * name or a minor place ("Children", "Went") does not count, so a capital at the start of a
 * sentence does not hide the word.
 */
function hasProperNoun(page: any): boolean {
  const minor = /^\s*(?:an?\s+)?(?:(?:english|habitational|occupational|common)\s+)?(?:surname|(?:male|female|unisex)\s+given\s+name|given\s+name|placename|place\s+name|number\s+of\s+places|river|village|hamlet|town|locale)\b/i;
  return Object.values(page || {}).some(
    (list) =>
      Array.isArray(list) &&
      list.some((e: any) => {
        if (!/proper noun/i.test(String(e?.partOfSpeech || ''))) return false;
        const first = (e?.definitions || [])
          .map((d: any) => String(d?.definition || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
          .find((t: string) => t);
        return !!first && !minor.test(first) && !/^the river\b/i.test(first);
      }),
  );
}

/**
 * Whether a capitalised word is spelt with its capital, as "Mr" and "Dr" are: its own page has
 * English senses that are not proper nouns, and the lower-case page has no English sense of its
 * own, only symbols (the language code "mr") and form-of senses ("Abbreviation of millirem").
 * "State" and "Will" at the start of a sentence fold, because "state" and "will" are words.
 */
function capitalIsSpelling(own: any, lower: any): boolean {
  const text = (d: any) => String(d?.definition || '').replace(/<[^>]+>/g, ' ').trim();
  const english = (page: any) => (Array.isArray(page?.en) ? page.en : []) as any[];
  const common = english(own).filter((e) => !/proper noun/i.test(String(e?.partOfSpeech || '')) && (e?.definitions || []).some((d: any) => text(d)));
  if (!common.length) return false;
  return english(lower).every(
    (e) =>
      /symbol/i.test(String(e?.partOfSpeech || '')) ||
      (e?.definitions || []).every((d: any) => !text(d) || /form-of-definition/.test(String(d?.definition || ''))),
  );
}

/** A Wiktionary definitions page without its "plural of …" and other form-of senses. */
function withoutFormOf(page: any): any {
  if (!page) return page;
  const out: Record<string, unknown[]> = {};
  for (const [lang, list] of Object.entries(page)) {
    if (!Array.isArray(list)) continue;
    out[lang] = list
      .map((e: any) => ({
        ...e,
        definitions: (e?.definitions || []).filter(
          (d: any) => !formOfGlossLemma(stripGlossText(String(d?.definition || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())),
        ),
      }))
      .filter((e: any) => e.definitions.length);
  }
  return out;
}

/** "Paris", "May": a word typed with a capital, not an acronym ("USA") or a word in capitals. */
function isCapitalised(word: string): boolean {
  const w = String(word || '').trim();
  return /^\p{Lu}\p{Ll}/u.test(w) && w !== w.toLocaleLowerCase();
}

/** A URL path segment as text; left as it is when it is not valid percent-encoding. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/\+/g, ' '));
  } catch {
    return segment;
  }
}
