export interface DictionaryResult {
  word: string;
  pronunciation?: string;
  definitions: Definition[];
  translations: Translation[];
  examples: string[];
  synonyms?: string[];
  antonyms?: string[];
  etymology?: string;
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
  source: string;
}

import { BaseService, DictionaryError } from './base';
import * as crypto from 'crypto';

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
    { name: 'CC-CEDICT',           priority: 2, isAvailable: false, enabled: false }
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
      const { default: fetch } = await import('node-fetch');
      const res = await fetch(url);
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
      console.log(`[DEBUG] Calling unofficial translate for: "${text}"`, { to: targetLanguage, from: sourceLanguage });
      const normalized = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
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
      console.error('❌ CRITICAL: Unofficial Google Translate error:', error);
      return null;
    }
  }

  /**
   * Main lookup function - aggregates data from multiple sources with parallel processing
   */
  async lookup(text: string, targetLanguage: string = 'en', enabledSources?: string[]): Promise<DictionaryResult> {
    const startTime = Date.now();
    const normalized = (text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const cacheKey = `${normalized.toLowerCase()}_${targetLanguage}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log(`✅ Cache hit for "${text}" (${Date.now() - startTime}ms)`);
      return cached.result;
    }

    try {
      // Detect language first (but don't wait for it if it's slow)
      const detectedLanguage = await Promise.race([
        this.detectLanguage(text),
        new Promise<string>(resolve => setTimeout(() => resolve(this.simpleLanguageDetection(text)), 1000))
      ]);
      
      // Smart detection: sentence vs word
      const isSentence = this.isSentence(text);
      
      let result: DictionaryResult;
      
      console.log('[DBG] lookup input:', { text: normalized, targetLanguage, enabledSources });
      if (isSentence) {
        // For sentences, focus on translation with proper language handling
        result = await this.handleSentenceTranslationOptimized(normalized, targetLanguage, detectedLanguage);
      } else {
        // For words, use parallel dictionary lookup
        result = await this.aggregateDictionaryDataParallel(normalized, targetLanguage, detectedLanguage, enabledSources);
      }

      // Cache the result
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
      
      console.log(`[DBG] ✅ lookup completed in ${Date.now() - startTime}ms; sources=`, result.sources);
      return result;
    } catch (error) {
      console.error('❌ Dictionary lookup error:', error);
      this.handleError(error);
    }
  }

  /**
   * Determine if text is a sentence or phrase vs a single word.
   * IMPROVED: More aggressive detection for sentences.
   */
  private isSentence(text: string): boolean {
    // Normalize and coalesce multiple spaces; strip zero-width characters
    const cleanText = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

    // Any text with more than 3 words is a sentence.
    if (cleanText.split(/\s+/).length > 3) {
      return true;
    }
    
    // Check for sentence indicators
    const sentenceIndicators = [
      /[.!?。！？]/,  // Punctuation marks
      /\s+/,     // Any whitespace indicates multiple words
      /[，、；：]/,   // Chinese punctuation
    ];
    
    // If text contains any sentence indicators, it's likely a sentence
    for (const indicator of sentenceIndicators) {
      if (indicator.test(cleanText)) {
        return true;
      }
    }
    
    // Check length - longer text is more likely to be a sentence
    if (cleanText.length > 25) {
      return true;
    }
    
    return false;
  }

  /**
   * Handle sentence translation with intelligent language detection and multiple translations
   */
  private async handleSentenceTranslationOptimized(text: string, targetLanguage: string, sourceLanguage: string): Promise<DictionaryResult> {
    console.log('🔄 [DEBUG] handleSentenceTranslationOptimized called with:', {
      text: text.substring(0, 50),
      targetLanguage,
      sourceLanguage,
      apiKey: this.apiKey ? 'SET' : 'NOT_SET',
      deeplApiKey: this.deeplApiKey ? 'SET' : 'NOT_SET'
    });

    const sources: string[] = [];
    const translations: Translation[] = [];
    
    // Intelligent target language selection based on detected source
    let actualTargetLanguage = targetLanguage;
    if (sourceLanguage === 'en' && targetLanguage === 'en') {
      actualTargetLanguage = 'zh'; // Default to Chinese for English sentences
    } else if ((sourceLanguage === 'zh' || sourceLanguage === 'ja' || sourceLanguage === 'ko') && targetLanguage === 'en') {
      actualTargetLanguage = 'en'; // Default to English for CJK sentences
    }
    
    console.log('🔄 [DEBUG] Language mapping result:', {
      originalTarget: targetLanguage,
      actualTargetLanguage,
      sourceLanguage
    });
    
    // Get multiple translations in parallel for better accuracy
    const translationPromises: Array<Promise<Translation | null>> = [];
    
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
    // console.log('🔄 [DEBUG] Adding mock translation as fallback');
    // translationPromises.push(
    //   Promise.resolve(this.getMockTranslation(text, actualTargetLanguage, sourceLanguage))
    // );
    
    console.log('🔄 [DEBUG] Starting translation promises:', translationPromises.length);
    
    // Wait for all translations (with timeout)
    const translationResults = await Promise.allSettled(
      translationPromises.map((p: Promise<Translation | null>) => 
        Promise.race([p, new Promise<null>((resolve: (value: null) => void) => {
          setTimeout(() => resolve(null), 3000);
        })])
      )
    );
    
    console.log('🔄 [DEBUG] Translation results:', translationResults.map(r => ({
      status: r.status,
      hasValue: r.status === 'fulfilled' && !!r.value
    })));
    
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

    // For Chinese/Japanese/Korean or mixed CJK+ASCII, prioritize translation over dictionary lookup
    const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
    const isAsianLanguage = ['zh', 'ja', 'ko'].includes(sourceLanguage) || hasCJK;
    
    console.log('[DBG] aggregate parallel:', { text, targetLanguage, sourceLanguage, enabledSources });
    // Prepare all API calls to run in parallel
    const apiPromises: Promise<any>[] = [];
    
    // Always get translation first (parallel with others)
    apiPromises.push(
      this.getBestTranslation(text, targetLanguage, sourceLanguage)
        .then(translation => ({ type: 'translation', data: translation }))
        .catch(error => ({ type: 'translation', error }))
    );
    
    // Chinese-specific APIs
    const isChinese = sourceLanguage === 'zh' || hasCJK;
    if (isChinese && (!enabledSources || enabledSources.includes('Youdao API') || enabledSources.includes('CC-CEDICT'))) {
      const youdaoEnabled = !enabledSources || enabledSources.includes('Youdao API');
      if (youdaoEnabled && this.youdaoAppKey && this.youdaoAppSecret) {
        apiPromises.push(
          this.getYoudaoData(text, 'zh-CHS', 'en')
            .then(data => ({ type: 'youdao', data }))
            .catch(error => ({ type: 'youdao', error }))
        );
      }

      // Local CC-CEDICT lookup (synchronous)
      if (!enabledSources || enabledSources.includes('CC-CEDICT')) {
        const cedictDefs = this.getCcCedictData(text);
        if (cedictDefs.length > 0) {
          definitions.push(...cedictDefs);
          sources.push('CC-CEDICT');
        }
      }
    }

    // Only try dictionary APIs for languages they support (primarily English)
    if (!isAsianLanguage || sourceLanguage === 'en') {
      // Check if source is enabled
      const isSourceEnabled = (sourceName: string) => {
        if (enabledSources) return enabledSources.includes(sourceName);
        const s = this.sources.find(s => s.name === sourceName);
        return s ? s.enabled && s.isAvailable : false;
      };
      
      if (isSourceEnabled('Free Dictionary API')) {
        apiPromises.push(
          this.getFreeDictionaryData(text, 'en') // force English for Free Dictionary API for clarity
            .then(data => ({ type: 'freeDictionary', data }))
            .catch(error => ({ type: 'freeDictionary', error }))
        );
      }

      if (isSourceEnabled('Wiktionary')) {
        apiPromises.push(
          this.getWiktionaryData(text, sourceLanguage || 'en')
            .then(data => ({ type: 'wiktionary', data }))
            .catch(error => ({ type: 'wiktionary', error }))
        );
      }

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

    // Wait for all API calls with timeout
    const results = await Promise.allSettled(
      apiPromises.map((promise: Promise<any>) => 
        Promise.race([
          promise,
          new Promise((_: any, reject: (reason?: any) => void) => {
            setTimeout(() => reject(new Error('Timeout')), 5000);
          })
        ])
      )
    );

    // Process results
    for (const result of results) {
      // raw debug for each promise
      if (result.status === 'rejected') {
        console.warn('[DBG] api promise rejected:', result.reason);
      }
      if (result.status === 'fulfilled' && result.value && !result.value.error) {
        const { type, data } = result.value;
        console.log('[DBG] api fulfilled:', type, { hasData: !!data });
        
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
              pronunciation = data.pronunciation;
              sources.push('Free Dictionary API');
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
              sources.push('Wiktionary');
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
    // 1) Definitions: unique by meaning + partOfSpeech + source
    const defSeen = new Set<string>();
    const uniqueDefinitions: Definition[] = [];
    for (const d of definitions) {
      const key = `${(d.partOfSpeech || '').toLowerCase()}|${(d.meaning || '').trim().toLowerCase()}|${(d.source || '').toLowerCase()}`;
      if (!defSeen.has(key)) {
        defSeen.add(key);
        uniqueDefinitions.push(d);
      }
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

    // Create final result
    const result: DictionaryResult = {
      word: text,
      pronunciation,
      definitions: uniqueDefinitions.length > 0 ? uniqueDefinitions : [{
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
      sources: uniqueSources
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
    
    // Only try dictionary APIs for languages they support (primarily English)
    if (!isAsianLanguage || sourceLanguage === 'en') {
      // Try Free Dictionary API
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

      // Try Wiktionary API
      try {
        const wikiData = await this.getWiktionaryData(text, sourceLanguage);
        if (wikiData.definitions.length > 0) {
          // Merge definitions, avoiding duplicates
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
        console.log(`No results for "${text}" in ${apiLanguage}, trying English fallback`);
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

      // Get pronunciation
      const pronunciation = data.phonetic || 
        data.phonetics?.find((p: any) => p.text)?.text;

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
        antonyms: [...new Set(antonyms)]  // Remove duplicates
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
  }> {
    try {
      const term = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      const restUrl = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`;
      const response = await this.request<any>(restUrl).catch((): null => null);
      console.log('Wiktionary API response:', JSON.stringify(response, null, 2));

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
              // Extract lemma candidate from definition HTML if it's a form-of entry
              const lower = (meaning || '').toLowerCase();
              if (/(plural|past|present|gerund|participle)\s+of/.test(lower)) {
                const m = meaning.match(/href=\"\/wiki\/([^\"#]+)(?:#English)?\"/);
                if (m && m[1]) {
                  const candidate = decodeURIComponent(m[1]);
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

        // If etymology is still not found, try parsing the wikitext
        if (!etymology) {
          etymology = await this.fetchEtymologyFromWikitext(term);
        }

        // Pivot to base lemma for richer content if current entry appears to be an inflected form
        if (lemmaCandidates.size > 0) {
          const base = Array.from(lemmaCandidates)[0];
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
            if (baseExamples.length > 0) {
              // Append to global examples array via aggregateDictionaryDataParallel caller
              // This is returned by caller via data.definitions[].examples, but we also want global
              // Therefore we will piggyback examples into the first definition of the merged ones
              if (definitions.length > 0) {
                const first = definitions[0] as any;
                first.examples = Array.isArray(first.examples) ? [...first.examples, ...baseExamples] : baseExamples;
              }
            }
          } catch (e) {
            console.warn('Lemma pivot failed for', base, e);
          }
        }

        return { definitions, pronunciation, etymology };
      } else {
        // If the primary lookup fails, go straight to the wikitext parsing for etymology.
        const etymology = await this.fetchEtymologyFromWikitext(term);
        return { definitions: [], etymology };
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

  /**
   * Fetches and parses raw Wiktionary wikitext to find the etymology section.
   * This is a reliable fallback for getting etymology data.
   */
  private async fetchEtymologyFromWikitext(text: string): Promise<string | undefined> {
    try {
      console.log('📖 [DEBUG] Fetching etymology from Wiktionary for:', text);
      const parseUrl = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(text)}&prop=wikitext&format=json&origin=*`;
      console.log('📖 [DEBUG] Etymology URL:', parseUrl);
      
      const response = await this.request<{ parse?: { wikitext?: { '*': string } } }>(parseUrl);
      console.log('📖 [DEBUG] Wiktionary response structure:', {
        hasParse: !!response?.parse,
        hasWikitext: !!response?.parse?.wikitext,
        wikitextLength: response?.parse?.wikitext?.['*']?.length || 0
      });

      const wikitext = response?.parse?.wikitext?.['*'];
      if (!wikitext) return undefined;

      // FIXED: Regex now correctly looks for a level 3 heading "Etymology"
      const etymologyRegex = /===\s*Etymology\s*===\s*\n(.+?)(?=\n===|$)/;
      const match = wikitext.match(etymologyRegex);

      if (match && match[1]) {
        // Clean up the wikitext to make it readable
        let etymologyText = match[1]
          .replace(/\{\{.+?\}\}/g, '') // Remove templates
          .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1') // Simplify wikilinks
          .replace(/'''|''/g, '') // Remove bold/italics
          .replace(/<ref[^>]*>.*?<\/ref>/g, '') // Remove references
          .trim();
        
        // Return the first line as a concise summary
        return etymologyText.split('\n')[0];
      }
    } catch (error) {
      console.warn(`Wiktionary wikitext parsing failed for "${text}":`, error);
    }
    return undefined;
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
    // Use the unofficial API as the primary method
    try {
      const unofficialTranslation = await this.getGoogleTranslateUnofficial(text, targetLanguage, sourceLanguage);
      if (unofficialTranslation) {
        return unofficialTranslation;
      }
    } catch (error) {
      console.warn('Unofficial Google translation failed:', error);
    }
    
    // Try DeepL first (if available)
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
    console.log('🔄 [DEBUG] getMockTranslation called:', { 
      text: text.substring(0, 30) + (text.length > 30 ? '...' : ''), 
      targetLanguage, 
      sourceLanguage 
    });
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
      console.log('🔄 [DEBUG] Found specific mock translation:', result);
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
      console.log('🔄 [DEBUG] Generated Chinese mock translation:', zhResult);
      return zhResult;
    } else if (targetLanguage === 'ja') {
      const jaResult = {
        language: targetLanguage,
        text: `[日本語翻訳] ${text}`,
        confidence: 0.1,
        source: 'Mock Translation'
      };
      console.log('🔄 [DEBUG] Generated Japanese mock translation:', jaResult);
      return jaResult;
    } else if (targetLanguage === 'ko') {
      const koResult = {
        language: targetLanguage,
        text: `[한국어 번역] ${text}`,
        confidence: 0.1,
        source: 'Mock Translation'
      };
      console.log('🔄 [DEBUG] Generated Korean mock translation:', koResult);
      return koResult;
    }

    const fallbackResult = {
      language: targetLanguage,
      text: `[${targetLanguage.toUpperCase()}] ${text}`,
      confidence: 0.1,
      source: 'Mock Translation'
    };
    
    console.log('🔄 [DEBUG] Generated fallback mock translation:', fallbackResult);
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