export interface DictionaryResult {
  word: string;
  pronunciation?: string;
  definitions: Definition[];
  translations: Translation[];
  examples: string[];
  synonyms?: string[];
  antonyms?: string[];
  etymology?: string;
  /** Structured ancestry parsed from Wiktionary etymology templates. */
  etymologyChain?: EtymologyLink[];
  language?: string;
  detectedLanguage?: string;
  sources: string[]; // Track which APIs were used
  metadata?: {
    isSentence?: boolean;
    sourceLanguage?: string;
    targetLanguage?: string;
    originalTargetLanguage?: string;
    [key: string]: any;
  };
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
}

import { BaseService, DictionaryError, withTimeout } from './base';
import * as crypto from 'crypto';
import { wrapConsole } from '../logger';
import { net } from 'electron';
import { normalizeQuery, cacheKeyFor, trimEdges, sanitize, NormalizedQuery, latinLemmaForms } from './text-normalize';
import { buildEtymology, EtymologyLink } from './etymology';
import { mergeSimilarDefinitions, dedupeExamples } from './definition-merge';
import { lookupOffline } from './offline-dict-store';

const console = wrapConsole('dictionary');
/** Hard ceiling so renderer IPC never waits forever (etymology / hung hosts). */
const LOOKUP_DEADLINE_MS = 12000;
const ETYMOLOGY_BUDGET_MS = 6000;
const OFFLINE_BUDGET_MS = 2000;

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

  private cache = new Map<string, { result: DictionaryResult; timestamp: number }>();
  private cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
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
    { name: 'Tatoeba',             priority: 7, isAvailable: true,  enabled: true }
  ];

  constructor(apiKey?: string, deeplApiKey?: string) {
    super();
    this.apiKey = apiKey || null;
    this.deeplApiKey = deeplApiKey || null;
    this.updateSourceAvailability();
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
      const res = await net.fetch(url);
      if (!res.ok) return false;
      const text = await res.text();
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
   * Get translation from the public Google Translate endpoint without an API key.
   * IMPROVED: Added robust error handling and defensive checks.
   */
  private async getGoogleTranslateUnofficial(text: string, targetLanguage: string, sourceLanguage: string): Promise<Translation | null> {
    // Use the public "gtx" endpoint to avoid fragile client libraries that regex-parse HTML
    try {
      let normalized = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

      // Check text length limits (Google Translate has ~5000 char limit)
      const MAX_TRANSLATE_LENGTH = 4500; // Leave some buffer
      if (normalized.length > MAX_TRANSLATE_LENGTH) {
        console.warn(`[DEBUG] Text too long for translation (${normalized.length} chars), truncating to ${MAX_TRANSLATE_LENGTH}`);
        normalized = normalized.substring(0, MAX_TRANSLATE_LENGTH);
      }

      console.log(`Unofficial translate`, { to: targetLanguage, from: sourceLanguage, chars: normalized.length });
      const sl = sourceLanguage && sourceLanguage !== 'auto' ? sourceLanguage : 'auto';
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(targetLanguage)}&dt=t&q=${encodeURIComponent(normalized)}`;
      const response = await this.request<any>(url);

      // Expected response structure: [[ [ translatedText, originalText, null, null, ... ], ... ], null, detectedLang, ...]
      if (Array.isArray(response) && Array.isArray(response[0])) {
        let translated = '';
        try {
          translated = response[0].map((seg: any) => (Array.isArray(seg) ? seg[0] : '')).join('');
        } catch (_e) {
          translated = '';
        }

        const detected = typeof response[2] === 'string' ? response[2] : (response[8] && response[8][0] && response[8][0][0]) || undefined;

        if (translated) {
          // Normalize quote characters that often come HTML-encoded or as smart quotes
          const cleaned = (translated || '')
            .replace(/&quot;/g, '"')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .trim();
          return {
            language: targetLanguage,
            text: cleaned,
            confidence: 0.85,
            source: 'Google Translate (Unofficial)',
            detectedSourceLanguage: detected,
          };
        }
      }

      console.warn('Unofficial Google Translate returned unexpected response shape');
      return null;
    } catch (error) {
      console.error('Unofficial Google Translate error:', error);
      return null;
    }
  }

  /**
   * Main lookup function - aggregates data from multiple sources with parallel processing
   */
  async lookup(text: string, targetLanguage: string = 'auto', enabledSources?: string[]): Promise<DictionaryResult> {
    const startTime = Date.now();

    const query = normalizeQuery(text);

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

    try {
      const detectedLanguage = await Promise.race([
        this.detectLanguage(query.trimmed),
        new Promise<string>(resolve => setTimeout(() => resolve(this.simpleLanguageDetection(query.trimmed)), 1000))
      ]);

      // zh → en and en → zh by default; honour an explicit cross-language target.
      const resolvedTarget = this.resolveTargetLanguage(detectedLanguage, targetLanguage);
      const cacheKey = cacheKeyFor(query, `${detectedLanguage}->${resolvedTarget}`);

      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log(`Cache hit (${Date.now() - startTime}ms)`);
        return cached.result;
      }

      let result: DictionaryResult;

      const coreLookup =
        query.kind === 'sentence'
          ? this.handleSentenceTranslationOptimized(query.trimmed, resolvedTarget, detectedLanguage)
          : this.lookupWithCandidates(query, resolvedTarget, detectedLanguage, enabledSources);

      try {
        result = await withTimeout(coreLookup, LOOKUP_DEADLINE_MS, 'dictionary.lookup');
      } catch (deadlineErr) {
        console.warn('Lookup hit deadline; returning best-effort fallback', deadlineErr);
        result = {
          word: query.trimmed,
          definitions: [
            {
              partOfSpeech: 'unknown',
              meaning: 'Lookup timed out. Check your network or try again.',
              source: 'Timeout',
            },
          ],
          translations: [],
          examples: [],
          sources: ['Timeout'],
          metadata: { timedOut: true, isSentence: query.kind === 'sentence' },
        };
      }

      result.detectedLanguage = detectedLanguage;
      result.metadata = {
        ...(result.metadata || {}),
        sourceLanguage: detectedLanguage,
        targetLanguage: resolvedTarget,
        originalTargetLanguage: targetLanguage,
        autoPaired: !targetLanguage || targetLanguage === 'auto' || targetLanguage === detectedLanguage,
      };

      this.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.error('❌ Dictionary lookup error:', error);
      this.handleError(error);
    }
  }

  /**
   * Default pairing: Chinese (and other CJK) → English; English → Chinese.
   * Pass an explicit different target to override.
   */
  resolveTargetLanguage(sourceLanguage: string, requestedTarget: string = 'auto'): string {
    const source = (sourceLanguage || 'en').toLowerCase().split('-')[0];
    const requested = (requestedTarget || 'auto').toLowerCase().split('-')[0];

    if (!requested || requested === 'auto') {
      return this.defaultTargetForSource(source);
    }

    // Same-language request on the primary pair → flip (popup often defaults both to zh or en).
    if (source === requested && (source === 'zh' || source === 'en' || source === 'ja' || source === 'ko')) {
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
   * Walks the candidate ladder and returns the first form that actually
   * resolves, so "word." falls back to "word" and "running" to "run" without
   * the user having to reselect. The form that matched is reported in
   * `metadata.matchedQuery` so the UI can say what it looked up.
   */
  private async lookupWithCandidates(
    query: NormalizedQuery,
    targetLanguage: string,
    detectedLanguage: string,
    enabledSources?: string[]
  ): Promise<DictionaryResult> {
    const candidates = query.candidates.length > 0 ? query.candidates : [query.trimmed];
    let firstResult: DictionaryResult | null = null;

    for (const candidate of candidates) {
      const result = await this.aggregateDictionaryDataParallel(
        candidate,
        targetLanguage,
        detectedLanguage,
        enabledSources
      );

      if (!firstResult) firstResult = result;

      if (this.hasRealDefinitions(result)) {
        const lemma =
          (result.metadata && typeof result.metadata.lemma === 'string' && result.metadata.lemma.trim()) ||
          result.word ||
          candidate;
        result.word = lemma;
        result.metadata = {
          ...(result.metadata || {}),
          isSentence: false,
          queryKind: query.kind,
          originalSelection: query.raw,
          matchedQuery: candidate,
          queriedAs: candidate,
          lemma: lemma !== candidate ? lemma : result.metadata?.lemma,
          normalizedFrom: candidate === query.sanitized ? undefined : query.sanitized
        };
        return result;
      }
    }

    // Nothing resolved. Keep the translation we already have and attach
    // spelling suggestions so the popup can offer a way forward.
    const fallback = firstResult ?? {
      word: query.trimmed,
      definitions: [],
      translations: [],
      examples: [],
      sources: []
    };

    const suggestions = await this.fetchSpellingSuggestions(query.trimmed).catch(() => [] as string[]);
    fallback.metadata = {
      ...(fallback.metadata || {}),
      isSentence: false,
      queryKind: query.kind,
      originalSelection: query.raw,
      matchedQuery: null,
      suggestions: suggestions.length > 0 ? suggestions : undefined
    };

    return fallback;
  }

  private hasRealDefinitions(result: DictionaryResult): boolean {
    return (result.definitions || []).some(
      (d) => d && d.source !== 'Fallback' && !!d.meaning && d.meaning !== 'No definition available.'
    );
  }

  /**
   * Handle sentence translation with intelligent language detection and multiple translations
   */
  private async handleSentenceTranslationOptimized(text: string, targetLanguage: string, sourceLanguage: string): Promise<DictionaryResult> {
    const sources: string[] = [];
    const translations: Translation[] = [];
    
    // Intelligent target language selection based on detected source
    // Target is already resolved by lookup(); keep a safety net for direct callers.
    let actualTargetLanguage = this.resolveTargetLanguage(sourceLanguage, targetLanguage);
    
    // Get multiple translations in parallel for better accuracy
    const translationPromises: Array<Promise<Translation | null>> = [];
    const hasCjkScript = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
    const preferCjkTx = ['zh', 'ja', 'ko'].includes(sourceLanguage) || hasCjkScript;

    if (preferCjkTx && this.youdaoAppKey && this.youdaoAppSecret) {
      const from = sourceLanguage === 'ja' ? 'ja' : sourceLanguage === 'ko' ? 'ko' : 'zh-CHS';
      const to = actualTargetLanguage === 'zh' || actualTargetLanguage.startsWith('zh') ? 'zh-CHS' : (actualTargetLanguage || 'en');
      translationPromises.push(
        this.getYoudaoData(text, from, to === 'en' ? 'en' : to)
          .then((d) => d?.translations?.[0] ? { ...d.translations[0], source: 'Youdao API' } : null)
          .catch((): null => null)
      );
    }

    // Prioritize unofficial translation
    translationPromises.push(
      this.getGoogleTranslateUnofficial(text, actualTargetLanguage, sourceLanguage)
        .then((t: any) => t ? {...t, source: 'Google Translate (Unofficial)'} : null)
        .catch((): null => null)
    );

    if (this.deeplApiKey) {
      translationPromises.push(
        this.getDeepLTranslation(text, actualTargetLanguage, sourceLanguage)
          .then((t: any) => t ? {...t, source: 'DeepL API'} : null)
          .catch((): null => null)
      );
    }
    
    if (this.apiKey) {
      translationPromises.push(
        this.getGoogleTranslation(text, actualTargetLanguage, sourceLanguage)
          .then((t: any) => t ? {...t, source: 'Google Translate API'} : null)
          .catch((): null => null)
      );
    }
    
    // Always include mock translation as fallback
    // translationPromises.push(
    //   Promise.resolve(this.getMockTranslation(text, actualTargetLanguage, sourceLanguage))
    // );
    
    const translationResults = await Promise.allSettled(
      translationPromises.map(
        (p: Promise<Translation | null>): Promise<Translation | null> =>
          withTimeout(p, 3000, 'translation').catch((): null => null),
      ),
    );

    // Process results
    for (const result of translationResults) {
      if (result.status === 'fulfilled' && result.value) {
        translations.push(result.value);
        sources.push(result.value.source || 'Translation API');
      }
    }
    
    // Create result for sentences
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
      // Add metadata for UI
      metadata: {
        isSentence: true,
        sourceLanguage,
        targetLanguage: actualTargetLanguage,
        originalTargetLanguage: targetLanguage
      }
    };

    return result;
  }

  /**
   * Aggregate data from multiple dictionary sources with parallel processing
   */
  private async aggregateDictionaryDataParallel(text: string, targetLanguage: string, sourceLanguage: string, enabledSources?: string[]): Promise<DictionaryResult> {
    const sources: string[] = [];
    const definitions: Definition[] = [];
    let translations: Translation[] = [];
    let examples: string[] = [];
    let synonyms: string[] = [];
    let antonyms: string[] = [];
    let pronunciation: string | undefined;
    let etymology: string | undefined;
    let etymologyChain: EtymologyLink[] | undefined;

    // For Chinese/Japanese/Korean or mixed CJK+ASCII, prioritize translation over dictionary lookup
    const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
    const isAsianLanguage = ['zh', 'ja', 'ko'].includes(sourceLanguage) || hasCJK;
    // Prepare all API calls to run in parallel
    const apiPromises: Promise<any>[] = [];
    
    // Always get translation first (parallel with others)
    apiPromises.push(
      this.getBestTranslation(text, targetLanguage, sourceLanguage)
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

    // Offline packs (CC-CEDICT in SQLite) — always probe for CJK, independent of source toggles.
    // Memory Map path below still respects the CC-CEDICT toggle.
    if (preferCjkSources) {
      try {
        const offlineHits = await withTimeout(
          lookupOffline(text, undefined, 12),
          OFFLINE_BUDGET_MS,
          'offline.lookup',
        );
        for (const hit of offlineHits) {
          const label =
            hit.packId === 'cc-cedict' || /cedict/i.test(hit.packName || '')
              ? 'CC-CEDICT'
              : hit.packName || 'Offline';
          definitions.push({
            partOfSpeech: hit.pos || 'definition',
            meaning: hit.definition,
            source: label,
            sources: [label],
          });
        }
        if (offlineHits.length) {
          if (offlineHits.some((h) => h.packId === 'cc-cedict' || /cedict/i.test(h.packName || ''))) {
            sources.push('CC-CEDICT');
          } else {
            sources.push('Offline');
          }
        }
      } catch {
        /* offline optional */
      }
    }

    if (preferCjkSources && (!enabledSources || enabledSources.includes('Youdao API') || enabledSources.includes('CC-CEDICT'))) {
      // Auto-use Youdao when credentials exist — don't require the toggle for CJK queries.
      const youdaoToggleOk = !enabledSources || enabledSources.includes('Youdao API');
      const youdaoSource = this.sources.find((s) => s.name === 'Youdao API');
      const youdaoAuto = !!(this.youdaoAppKey && this.youdaoAppSecret);
      if (youdaoToggleOk && youdaoAuto && (youdaoSource?.enabled !== false || !enabledSources)) {
        apiPromises.push(
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

    // Latin path: also probe offline EN packs (budgeted — sql.js is sync on main)
    if (preferLatinSources) {
      try {
        const offlineHits = await withTimeout(
          lookupOffline(text, 'en', 12),
          OFFLINE_BUDGET_MS,
          'offline.lookup.en',
        );
        for (const hit of offlineHits) {
          definitions.push({
            partOfSpeech: hit.pos || 'definition',
            meaning: hit.definition,
            source: hit.packName || 'Offline',
            sources: [hit.packName || 'Offline'],
          });
        }
        if (offlineHits.length) sources.push('Offline');
      } catch {
        /* optional */
      }
    }
    const langForDict = sourceLanguage || 'en';
    const isSourceEnabled = (sourceName: string) => {
      if (enabledSources) return enabledSources.includes(sourceName);
      const s = this.sources.find(s => s.name === sourceName);
      return s ? s.enabled && s.isAvailable : false;
    };

    // Free Dictionary + Datamuse: Latin/English path (CJK lemmas rarely have useful entries)
    if (preferLatinSources && isSourceEnabled('Free Dictionary API')) {
      apiPromises.push(
        this.getFreeDictionaryData(text, langForDict)
          .then(data => ({ type: 'freeDictionary', data }))
          .catch(error => ({ type: 'freeDictionary', error }))
      );
    }

    // Wiktionary: always useful (defs + etymology). For CJK, still query when enabled.
    if (isSourceEnabled('Wiktionary')) {
      apiPromises.push(
        this.getWiktionaryData(text, preferCjkSources && langForDict === 'zh' ? 'zh' : langForDict === 'ja' ? 'ja' : langForDict === 'ko' ? 'ko' : 'en')
          .then(data => ({ type: 'wiktionary', data }))
          .catch(error => ({ type: 'wiktionary', error }))
      );
    }

    if (preferLatinSources && !hasCJK && isSourceEnabled('Datamuse')) {
      apiPromises.push(
        this.getDatamuseData(text)
          .then(data => ({ type: 'datamuse', data }))
          .catch(error => ({ type: 'datamuse', error }))
      );
    }

    if (isSourceEnabled('Tatoeba')) {
      apiPromises.push(
        this.getTatoebaExamples(text, sourceLanguage, targetLanguage)
          .then(data => ({ type: 'tatoeba', data }))
          .catch(error => ({ type: 'tatoeba', error }))
      );
    }

    // English-centric premium APIs
    const allowEnglishPremium = preferLatinSources || sourceLanguage === 'en';
    if (allowEnglishPremium) {
      if (isSourceEnabled('Oxford Dictionary API') && this.oxfordAppId && this.oxfordAppKey) {
        apiPromises.push(
          this.getOxfordData(text)
            .then(data => ({ type: 'oxford', data }))
            .catch(error => ({ type: 'oxford', error }))
        );
      }

      if (isSourceEnabled('WordsAPI') && this.wordsApiKey) {
        apiPromises.push(
          this.getWordsApiData(text)
            .then(data => ({ type: 'wordsApi', data }))
            .catch(error => ({ type: 'wordsApi', error }))
        );
      }

      if (isSourceEnabled('Collins Dictionary API') && this.collinsApiKey && this.collinsApiHost) {
        apiPromises.push(
          this.getCollinsData(text)
            .then(data => ({ type: 'collins', data }))
            .catch(error => ({ type: 'collins', error }))
        );
      }
    }

    // Wait for all API calls with timeout (safe — late rejections are handled)
    const results = await Promise.allSettled(
      apiPromises.map((promise: Promise<any>) =>
        withTimeout(promise, 5000, 'dictionary.source').catch((error) => ({
          type: 'timeout',
          error,
        })),
      ),
    );

    // Process results
    let canonicalLemma: string | undefined;
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value && !result.value.error) {
        const { type, data } = result.value;
        switch (type) {
          case 'translation':
            if (data) {
              translations.push(data);
              sources.push(data.source || 'Translation API');
            }
            break;
            
          case 'freeDictionary':
            if (data.definitions.length > 0) {
              definitions.push(...data.definitions);
              examples.push(...data.examples);
              synonyms.push(...data.synonyms);
              antonyms.push(...data.antonyms);
              if (!pronunciation && data.pronunciation) pronunciation = data.pronunciation;
              sources.push('Free Dictionary API');
              if (data.word && typeof data.word === 'string') {
                const apiWord = data.word.trim();
                if (apiWord && apiWord.toLowerCase() !== text.toLowerCase()) {
                  canonicalLemma = canonicalLemma || apiWord;
                }
              }
            }
            break;
            
          case 'wiktionary':
            if (data && data.definitions && data.definitions.length > 0) {
              const existingMeanings = new Set(definitions.map((d: any) => d.meaning));
              // Prefer non-identical definitions and keep a Wiktionary tag
              const newDefinitions = data.definitions
                .filter((d: any) => !existingMeanings.has(d.meaning))
                .map((d: any) => ({ ...d, source: 'Wiktionary' }));
              definitions.push(...newDefinitions);
              // Aggregate example sentences globally for UI examples pane
              try {
                const exampleSnippets: string[] = [];
                for (const def of data.definitions) {
                  if (Array.isArray(def.examples)) exampleSnippets.push(...def.examples);
                }
                if (exampleSnippets.length > 0) examples.push(...exampleSnippets);
              } catch {}
              
              if (data.etymology) etymology = data.etymology;
              if (!pronunciation && data.pronunciation) pronunciation = data.pronunciation;
              if (data.lemma && typeof data.lemma === 'string') {
                canonicalLemma = data.lemma.trim() || canonicalLemma;
              }
              sources.push('Wiktionary');
            }
            break;

          case 'datamuse':
            if (data && (data.definitions.length > 0 || data.synonyms.length > 0)) {
              const existing = new Set(definitions.map((d: any) => (d.meaning || '').toLowerCase()));
              const fresh = data.definitions.filter((d: Definition) => !existing.has(d.meaning.toLowerCase()));
              if (fresh.length > 0) definitions.push(...fresh);
              if (data.synonyms.length > 0) synonyms.push(...data.synonyms);
              if (fresh.length > 0 || data.synonyms.length > 0) sources.push('Datamuse');
            }
            break;

          case 'tatoeba':
            if (data && data.length > 0) {
              examples.push(...data);
              sources.push('Tatoeba');
            }
            break;

          case 'oxford':
            if (data) {
              if (data.definitions?.length) {
                definitions.unshift(...data.definitions);
              }
              if (!pronunciation && data.pronunciation) pronunciation = data.pronunciation;
              if (!etymology && data.etymology) etymology = data.etymology;
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
        }
      }
    }

    // Deduplicate collected data
    // 1) Exact pass (pos|meaning|source), then fuzzy cross-source merge
    const defSeen = new Set<string>();
    const uniqueDefinitions: Definition[] = [];
    for (const d of definitions) {
      const key = `${(d.partOfSpeech || '').toLowerCase()}|${(d.meaning || '').trim().toLowerCase()}|${(d.source || '').toLowerCase()}`;
      if (!defSeen.has(key)) {
        defSeen.add(key);
        uniqueDefinitions.push(d);
      }
    }
    const mergedDefinitions = mergeSimilarDefinitions(uniqueDefinitions) as Definition[];
    for (const d of mergedDefinitions) {
      if (d.examples?.length) d.examples = dedupeExamples(d.examples) || [];
    }

    // 2) Translations: unique by source label + translated text
    const transMap = new Map<string, Translation>();
    for (const t of translations) {
      if (!t) continue;
      const src = (t.source || 'translation api').trim().toLowerCase();
      const key = `${src}|${(t.text || '').trim()}`;
      if (!transMap.has(key)) transMap.set(key, t);
    }
    translations = Array.from(transMap.values());

    // 3) Examples: normalize quotes and trim duplicates
    const normalizeExample = (s: string) => (s || '')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/^"|"$/g, '')
      .trim();
    const exSet = new Set<string>();
    const uniqueExamples: string[] = [];
    for (const ex of examples) {
      const n = normalizeExample(ex);
      if (n && !exSet.has(n)) { exSet.add(n); uniqueExamples.push(n); }
    }
    examples = uniqueExamples;

    // 4) Synonyms/Antonyms: unique
    synonyms = Array.from(new Set(synonyms.map(s => (s || '').trim()).filter(Boolean)));
    antonyms = Array.from(new Set(antonyms.map(s => (s || '').trim()).filter(Boolean)));

    // 5) Sources: unique and trimmed
    const uniqueSources = Array.from(new Set(sources.map(s => (s || '').trim())));

    // Always collect etymology from free sources (Wiktionary, Etymonline, Youdao/童理民)
    // and merge with any etymology already returned by REST / paid APIs.
    const etyQuery = (canonicalLemma && canonicalLemma.trim()) || text;
    try {
      const fetched = await withTimeout(
        this.fetchEtymologyFromMultipleSources(etyQuery),
        ETYMOLOGY_BUDGET_MS,
        'etymology.multi',
      );
      if (fetched?.text) {
        etymology = fetched.text;
        if (fetched.chain) etymologyChain = fetched.chain;
      }
    } catch (error) {
      console.warn('[ETY] multi-source etymology skipped', error);
    }

    const headword = (canonicalLemma && canonicalLemma.trim()) || text;

    // Inflected forms (vicissitudes) often have no IPA on the surface form.
    if (!pronunciation && preferLatinSources) {
      const ipaForms = [
        headword,
        ...latinLemmaForms(text),
        ...latinLemmaForms(headword),
      ].filter((f, i, arr) => f && f.toLowerCase() !== text.toLowerCase() && arr.indexOf(f) === i);
      for (const form of ipaForms) {
        try {
          const lemmaPhon = await withTimeout(
            this.getFreeDictionaryData(form, langForDict),
            3000,
            'lemma.ipa',
          );
          if (lemmaPhon.pronunciation) {
            pronunciation = lemmaPhon.pronunciation;
            break;
          }
        } catch {
          /* optional */
        }
      }
    }

    const result: DictionaryResult = {
      word: headword,
      pronunciation,
      definitions: mergedDefinitions.length > 0 ? mergedDefinitions : [{
        partOfSpeech: 'unknown',
        meaning: 'No definition available.',
        source: 'Fallback'
      }],
      translations,
      examples,
      synonyms: synonyms.length > 0 ? synonyms : undefined,
      antonyms: antonyms.length > 0 ? antonyms : undefined,
      etymology,
      etymologyChain,
      language: targetLanguage,
      detectedLanguage: sourceLanguage,
      sources: uniqueSources,
      metadata: {
        queriedAs: text,
        lemma: headword !== text ? headword : undefined,
      },
    };

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
      const translation = await this.getBestTranslation(text, targetLanguage, sourceLanguage);
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
    examples: string[];
    synonyms: string[];
    antonyms: string[];
    word?: string;
  }> {
    try {
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
      let url = `https://api.dictionaryapi.dev/api/v2/entries/${apiLanguage}/${encodeURIComponent(text)}`;
      let response = await this.request<any[]>(url);
      
      // If no results and language is not English, try English as fallback
      if ((!response || response.length === 0) && apiLanguage !== 'en') {
        console.log(`No results for text of length ${text.length} in ${apiLanguage}, trying English fallback`);
        url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`;
        response = await this.request<any[]>(url);
      }

      if (!response || response.length === 0) {
        return { definitions: [], examples: [], synonyms: [], antonyms: [] };
      }

      const data = response[0];
      const definitions: Definition[] = [];
      const examples: string[] = [];
      const synonyms: string[] = [];
      const antonyms: string[] = [];

      // Get pronunciation — prefer first phonetics[].text with content
      let pronunciation =
        (typeof data.phonetic === 'string' && data.phonetic.trim()) ||
        (Array.isArray(data.phonetics)
          ? data.phonetics.map((p: any) => (p && p.text ? String(p.text).trim() : '')).find(Boolean)
          : '') ||
        undefined;

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
        examples,
        synonyms: [...new Set(synonyms)], // Remove duplicates
        antonyms: [...new Set(antonyms)],  // Remove duplicates
        word: typeof data.word === 'string' ? data.word.trim() : undefined,
      };

    } catch (error) {
      console.warn(`Free Dictionary API failed for "${text}":`, error);
      return { definitions: [], examples: [], synonyms: [], antonyms: [] };
    }
  }

  /**
   * Get data from Wiktionary API with a focus on definitions and etymology.
   */
  private async getWiktionaryData(text: string, language: string): Promise<{
    definitions: Definition[];
    pronunciation?: string;
    etymology?: string;
    lemma?: string;
  }> {
    try {
      const term = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      const restUrl = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`;
      const response = await this.request<any>(restUrl, {
        headers: { 'User-Agent': DictionaryService.WIKIMEDIA_USER_AGENT }
      }).catch((): null => null);
      // Removed verbose API response logging to prevent HTML floods

      // Prioritize the language detected or specified
      const langData = response ? response[language] || response['en'] : null;

      if (langData && Array.isArray(langData) && langData.length > 0) {
        const definitions: Definition[] = [];
        let pronunciation: string | undefined;
        let etymology: string | undefined;
        const lemmaCandidates = new Set<string>();

        for (const entry of langData) {
          if (entry.definitions && Array.isArray(entry.definitions)) {
            entry.definitions.forEach((def: any) => {
              const meaning: string = def.definition;
              // Extract lemma candidate from definition HTML if it's a form-of / spelling variant
              const lower = (meaning || '').toLowerCase();
              if (
                /(plural|past|present|gerund|participle|alternative spelling|misspelling|common misspelling|obsolete spelling|archaic spelling|form)\s+of/.test(
                  lower,
                )
              ) {
                const m = meaning.match(/href=\"\/wiki\/([^\"#]+)(?:#[^\"]*)?\"/);
                if (m && m[1]) {
                  const candidate = decodeURIComponent(m[1].replace(/_/g, ' '));
                  if (candidate && candidate.toLowerCase() !== term.toLowerCase()) {
                    lemmaCandidates.add(candidate);
                  }
                }
              }
              definitions.push({
                partOfSpeech: this.normalizePartOfSpeech(entry.partOfSpeech),
                meaning,
                examples: def.examples || [],
                source: 'Wiktionary'
              });
            });
          }
          if (!pronunciation && entry.pronunciations?.text) {
            pronunciation = entry.pronunciations.text;
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

        // Pivot to base lemma for richer content if current entry appears to be an inflected form
        let lemma: string | undefined;
        if (lemmaCandidates.size > 0) {
          const base = Array.from(lemmaCandidates)[0];
          lemma = base;
          try {
            const baseData = await this.getWiktionaryData(base, language);
            // Prefer base lemma definitions/etymology if available
            if (baseData.definitions && baseData.definitions.length > 0) {
              const existingSet = new Set(definitions.map(d => d.meaning));
              const merged = baseData.definitions.filter(d => !existingSet.has(d.meaning));
              definitions.push(...merged);
            }
            if (!etymology && baseData.etymology) etymology = baseData.etymology;
            if (!pronunciation && baseData.pronunciation) pronunciation = baseData.pronunciation;
            // Pull example sentences from wikitext for the base lemma as well
            const baseExamples = await this.fetchExamplesFromWikitext(base);
            if (baseExamples.length > 0 && definitions.length > 0) {
              const first = definitions[0] as Definition;
              first.examples = dedupeExamples([...(first.examples || []), ...baseExamples]) || [];
            }
          } catch (e) {
            console.warn('Lemma pivot failed for', base, e);
          }
        }

        return { definitions, pronunciation, etymology, lemma };
      } else {
        // Primary Wiktionary REST miss — do not block on multi-source etymology.
        return { definitions: [] };
      }

    } catch (error) {
      console.warn(`Wiktionary API failed for "${text}":`, error);
      return { definitions: [] };
    }
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
    const sign = crypto.createHash('sha256').update(str1).digest('hex');

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
   * synonyms. Free for non-commercial use; an API key becomes mandatory in 2027.
   * https://www.datamuse.com/api/
   */
  private async getDatamuseData(text: string): Promise<{ definitions: Definition[]; synonyms: string[] }> {
    const empty = { definitions: [] as Definition[], synonyms: [] as string[] };
    const word = text.toLocaleLowerCase();
    if (!/^[\p{L}][\p{L}'\- ]{0,40}$/u.test(word)) return empty;

    const encoded = encodeURIComponent(word);
    const [entries, related] = await Promise.all([
      this.withTimeout(
        this.request<any[]>(`https://api.datamuse.com/words?sp=${encoded}&md=d&max=1`).catch((): any[] => []),
        2500,
        [] as any[]
      ),
      this.withTimeout(
        this.request<any[]>(`https://api.datamuse.com/words?rel_syn=${encoded}&max=8`).catch((): any[] => []),
        2500,
        [] as any[]
      )
    ]);

    const definitions: Definition[] = [];
    const top = Array.isArray(entries) ? entries[0] : null;
    // `sp=` is a wildcard match, so confirm we got the word we asked for.
    if (top && typeof top.word === 'string' && top.word.toLocaleLowerCase() === word && Array.isArray(top.defs)) {
      for (const raw of top.defs.slice(0, 12)) {
        const [pos, ...rest] = String(raw).split('\t');
        const meaning = rest.join('\t').trim();
        if (!meaning) continue;
        definitions.push({
          partOfSpeech: DictionaryService.DATAMUSE_POS[pos] || pos || 'unknown',
          meaning,
          source: 'Datamuse'
        });
      }
    }

    const synonyms = Array.isArray(related)
      ? related.map((r: any) => r?.word).filter((w: any): w is string => typeof w === 'string' && w.length > 0)
      : [];

    return { definitions, synonyms };
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

    const url = `https://tatoeba.org/en/api_v0/search?from=${from}&to=${to}&query=${encodeURIComponent(term)}&sort=relevance`;
    const response = await this.withTimeout<any>(
      this.request<any>(url).catch((): any => null),
      2500,
      null
    );

    const results = response?.results;
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
  ): Promise<{ text: string; chain?: EtymologyLink[] } | undefined> {
    const labeled: string[] = [];
    let chain: EtymologyLink[] | undefined;

    const [wiktionaryEtymology, etymonlineEtymology, youdaoEtymology, oxfordEtymology] = await Promise.all([
      this.fetchEtymologyFromWikitext(text).catch((error: unknown): undefined => {
        console.warn(`Wiktionary etymology fetch failed:`, error);
        return undefined;
      }),
      this.fetchEtymologyFromEtymonline(text).catch((error: unknown): undefined => {
        console.warn(`Etymonline etymology fetch failed:`, error);
        return undefined;
      }),
      this.fetchEtymologyFromYoudao(text).catch((error: unknown): undefined => {
        console.warn(`Youdao etymology fetch failed:`, error);
        return undefined;
      }),
      this.oxfordAppId && this.oxfordAppKey
        ? this.fetchEtymologyFromOxford(text).catch((error: unknown): undefined => {
            console.warn(`Oxford etymology fetch failed:`, error);
            return undefined;
          })
        : Promise.resolve(undefined),
    ]);

    if (wiktionaryEtymology?.text) {
      labeled.push(`[Wiktionary]\n${wiktionaryEtymology.text}`);
      chain = wiktionaryEtymology.chain;
    }
    if (etymonlineEtymology) {
      labeled.push(`[Etymonline]\n${etymonlineEtymology}`);
    }
    if (youdaoEtymology) {
      labeled.push(youdaoEtymology);
    }
    if (oxfordEtymology) {
      labeled.push(`[Oxford]\n${oxfordEtymology}`);
    }

    if (labeled.length === 0) return undefined;

    return {
      text: labeled.join('\n\n--- Alternative etymology ---\n\n'),
      chain,
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
  private async fetchEtymologyFromEtymonline(text: string): Promise<string | undefined> {
    const cleanWord = this.cleanWordForEtymology(text);
    if (!cleanWord) return undefined;

    try {
      const url = `https://www.etymonline.com/word/${encodeURIComponent(cleanWord)}`;
      // Use BaseService/node-fetch path via request() isn't HTML — raw fetch with timeout:
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(url, {
        timeout: 2500,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        console.warn(`Etymonline returned HTTP status ${response.status} for ${cleanWord}`);
        return undefined;
      }

      const html = await withTimeout(response.text(), 2000, 'etymonline.body');
      let raw = '';

      // Modern Etymonline: OpenGraph / meta description (legacy <dd> markup is gone).
      const og =
        html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
        html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i) ||
        html.match(/name=["']description["']\s+content=["']([^"']+)["']/i);
      if (og?.[1]) raw = og[1];

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

      const etymology = raw
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*See origin and meaning of .+$/i, '')
        .trim();

      // Site-wide marketing / miss-page meta — not a word etymology.
      if (
        /go-to source|internet'?s go-to|the online etymology dictionary\s*\(/i.test(etymology) ||
        /quick and reliable accounts of the origin/i.test(etymology)
      ) {
        return undefined;
      }

      if (etymology.length > 20) {
        return etymology;
      }
    } catch (error) {
      console.warn(`Etymonline fetch failed for "${cleanWord}":`, error);
    }

    return undefined;
  }

  /**
   * Youdao mobile jsonapi — includes Chinese etymology snippets (童理民 and others).
   * No API key required for this public endpoint.
   */
  private async fetchEtymologyFromYoudao(text: string): Promise<string | undefined> {
    const cleanWord = this.cleanWordForEtymology(text);
    if (!cleanWord || cleanWord.length > 48) return undefined;

    try {
      const url =
        `http://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&q=${encodeURIComponent(cleanWord)}`;
      const response = await this.withTimeout(
        this.request<any>(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          },
        }).catch((): null => null),
        3500,
        null,
      );

      const etyms = response?.etym?.etyms;
      if (!etyms || typeof etyms !== 'object') return undefined;

      const chunks: string[] = [];
      // Prefer Chinese narrative etymology (童理民), then English.
      const order = ['zh', 'en', ...Object.keys(etyms).filter((k) => k !== 'zh' && k !== 'en')];
      const seen = new Set<string>();
      for (const lang of order) {
        const arr = etyms[lang];
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          const value = typeof item?.value === 'string' ? item.value.trim() : '';
          if (!value || value.length < 8) continue;
          const tip = value.slice(0, 48);
          if (seen.has(tip)) continue;
          seen.add(tip);
          let source = typeof item?.source === 'string' ? item.source.trim() : '';
          // Normalize known author attribution
          if (/童理/.test(source) || source.includes('\u7ae5\u7406\u6c11')) {
            source = '童理民';
          }
          if (!source) source = lang === 'zh' ? '有道词源' : 'Youdao';
          const desc = typeof item?.desc === 'string' && item.desc.trim() ? `（${item.desc.trim()}）` : '';
          chunks.push(`[${source}${desc}]\n${value}`);
        }
      }

      if (chunks.length === 0) return undefined;
      return chunks.join('\n\n--- Alternative etymology ---\n\n');
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

      const parseUrl = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(cleanWord)}&prop=wikitext&format=json&origin=*`;

      const response = await this.request<{ parse?: { wikitext?: { '*': string } } }>(parseUrl, {
        headers: { 'User-Agent': DictionaryService.WIKIMEDIA_USER_AGENT }
      }).catch((): null => null);

      const wikitext = response?.parse?.wikitext?.['*'];
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
      if (parsed && parsed.text.length >= 10) {
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
  private async getBestTranslation(text: string, targetLanguage: string, sourceLanguage: string): Promise<Translation | null> {
    const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
    const preferCjk = ['zh', 'ja', 'ko'].includes(sourceLanguage) || hasCJK;

    // CJK → Youdao when credentials exist (no toggle thrash)
    if (preferCjk && this.youdaoAppKey && this.youdaoAppSecret) {
      try {
        const from = sourceLanguage === 'ja' ? 'ja' : sourceLanguage === 'ko' ? 'ko' : 'zh-CHS';
        const to = targetLanguage === 'zh' || targetLanguage.startsWith('zh') ? 'zh-CHS' : (targetLanguage || 'en');
        const youdao = await this.getYoudaoData(text, from, to === 'en' ? 'en' : to);
        const t = youdao?.translations?.[0];
        if (t?.text) return { ...t, source: 'Youdao API' };
      } catch (error) {
        console.warn('Youdao translation failed:', error);
      }
    }

    // Latin / general → DeepL when keyed
    if (!preferCjk && this.deeplApiKey) {
      try {
        const deeplTranslation = await this.getDeepLTranslation(text, targetLanguage, sourceLanguage);
        if (deeplTranslation) {
          return { ...deeplTranslation, source: 'DeepL API' };
        }
      } catch (error) {
        console.warn('DeepL translation failed:', error);
      }
    }

    // Use the unofficial API as a broad fallback
    try {
      const unofficialTranslation = await this.getGoogleTranslateUnofficial(text, targetLanguage, sourceLanguage);
      if (unofficialTranslation) {
        return unofficialTranslation;
      }
    } catch (error) {
      console.warn('Unofficial Google translation failed:', error);
    }
    
    // Try DeepL for CJK if Youdao missed (or no Youdao key)
    if (this.deeplApiKey) {
      try {
        const deeplTranslation = await this.getDeepLTranslation(text, targetLanguage, sourceLanguage);
        if (deeplTranslation) {
          return { ...deeplTranslation, source: 'DeepL API' };
        }
      } catch (error) {
        console.warn('DeepL translation failed:', error);
      }
    }

    // Fallback to Google Translate
    if (this.apiKey) {
      try {
        const googleTranslation = await this.getGoogleTranslation(text, targetLanguage, sourceLanguage);
        if (googleTranslation) {
          return { ...googleTranslation, source: 'Google Translate API' };
        }
      } catch (error) {
        console.warn('Google Translate failed:', error);
      }
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
      if (error.response) {
        console.error('DeepL response:', error.response.data);
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
      if (error.response) {
        console.error('Google Translate response:', error.response.data);
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
   * Detect the language of the input text
   */
  async detectLanguage(text: string): Promise<string> {
    if (this.apiKey) {
      try {
        const url = `https://translation.googleapis.com/language/translate/v2/detect?key=${this.apiKey}`;
        const response = await this.request<{ data: { detections: Array<Array<Array<{ language: string; confidence: number }>>> } }>(url, {
          method: 'POST',
          body: JSON.stringify({
            q: text
          })
        });

        return response.data.detections[0][0][0].language;
      } catch (error) {
        console.warn('Language detection failed, using fallback:', error);
      }
    }

    return this.simpleLanguageDetection(text);
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
   * Simple language detection for fallback
   */
  private simpleLanguageDetection(text: string): string {
    // Simple heuristic-based language detection
    const cleanText = text.replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase().trim();
    
    // Chinese/Japanese/Korean detection
    const cjkRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
    if (cjkRegex.test(text)) {
      // Distinguish between Chinese, Japanese, Korean
      if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // Japanese hiragana/katakana
      if (/[\uac00-\ud7af]/.test(text)) return 'ko'; // Korean hangul
      return 'zh'; // Default to Chinese for CJK characters
    }
    
    // Cyrillic (Russian)
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';
    
    // Arabic
    if (/[\u0600-\u06ff]/.test(text)) return 'ar';
    
    // Thai
    if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
    
    // Common European language patterns
    const commonWords = {
      'es': ['el', 'la', 'de', 'que', 'y', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su', 'por', 'son', 'con', 'para', 'una', 'las', 'los', 'del', 'está', 'como', 'pero', 'sus', 'ese', 'ser', 'tiene', 'hace', 'dice'],
      'fr': ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son', 'une', 'sur', 'avec', 'ne', 'se', 'pas', 'tout', 'plus', 'par', 'grand', 'celui', 'me', 'même', 'y', 'sans', 'peut', 'sous'],
      'de': ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'im', 'dem', 'nicht', 'ein', 'eine', 'als', 'auch', 'es', 'an', 'werden', 'aus', 'er', 'hat', 'dass', 'sie', 'nach', 'wird', 'bei'],
      'it': ['il', 'di', 'che', 'e', 'la', 'per', 'un', 'in', 'con', 'del', 'da', 'è', 'le', 'dei', 'a', 'si', 'lo', 'alla', 'nel', 'gli', 'una', 'come', 'delle', 'più', 'anche', 'ma', 'tutto', 'della', 'questa', 'quello', 'essere', 'fare'],
      'pt': ['o', 'de', 'a', 'e', 'que', 'do', 'da', 'em', 'um', 'para', 'é', 'com', 'não', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'à', 'seu', 'sua']
    };
    
    const words = cleanText.split(/\s+/).slice(0, 10); // Check first 10 words
    let maxMatches = 0;
    let detectedLang = 'en';
    
    for (const [lang, wordList] of Object.entries(commonWords)) {
      const matches = words.filter(word => wordList.includes(word)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        detectedLang = lang;
      }
    }
    
    // If we found matches and it's significant, return the detected language
    if (maxMatches >= 2 || maxMatches / words.length > 0.3) {
      return detectedLang;
    }
    
    // Default to English
    return 'en';
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
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
      { code: 'auto', name: 'Auto-detect', nativeName: 'Auto-detect' }
    ];
  }

  /**
   * Normalize part of speech strings
   */
  private normalizePartOfSpeech(pos: string): string {
    if (!pos) return 'unknown';
    const lowerPos = pos.toLowerCase();
    if (lowerPos.includes('noun')) return 'noun';
    if (lowerPos.includes('verb')) return 'verb';
    if (lowerPos.includes('adjective')) return 'adjective';
    if (lowerPos.includes('adverb')) return 'adverb';
    if (lowerPos.includes('pronoun')) return 'pronoun';
    if (lowerPos.includes('preposition')) return 'preposition';
    if (lowerPos.includes('conjunction')) return 'conjunction';
    if (lowerPos.includes('interjection')) return 'interjection';
    return lowerPos;
  }
}

// Export singleton instance
export const dictionaryService = new DictionaryService(); 