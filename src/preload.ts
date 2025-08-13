import { contextBridge, ipcRenderer } from 'electron';

// Import the UIAutomation native addon (optional - not needed for renderer)
let native: any = null;
try {
  // @ts-ignore
  native = require('../native-addon');
} catch (error) {
  native = null;
}

// Type definitions for better TypeScript support
interface SelectionListener {
  start(): boolean;
  stop(): boolean;
  getSelection(): string | null;
}

interface SelectionEvent {
  text: string;
  x: number;
  y: number;
  timestamp: number;
  source: 'native' | 'manual';
}

interface NativeAPI {
  createListener(): SelectionListener;
  start(listener: SelectionListener): boolean;
  stop(listener: SelectionListener): boolean;
}

interface ClipboardEntry {
  id: string;
  text: string;
  timestamp: Date;
  type: 'text' | 'image' | 'file';
}

interface ClipboardStats {
  totalEntries: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

// Dictionary service interfaces
interface DictionaryResult {
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
  sources: string[];
  metadata?: {
    isSentence?: boolean;
    sourceLanguage?: string;
    targetLanguage?: string;
    originalTargetLanguage?: string;
    [key: string]: any;
  };
}

interface Definition {
  partOfSpeech: string;
  meaning: string;
  synonyms?: string[];
}

interface Translation {
  language: string;
  text: string;
  pronunciation?: string;
}

interface DictionarySource {
  name: string;
  priority: number;
  isAvailable: boolean;
}

// Wikipedia service interfaces
interface WikipediaResult {
  title: string;
  extract: string;
  url: string;
  language: string;
  pageId: number;
  thumbnail?: string;
}

interface WikipediaSearchResult {
  query: string;
  results: WikipediaResult[];
  totalResults: number;
}

// Search service interfaces
interface SearchSuggestion {
  text: string;
  type: 'suggestion' | 'related' | 'autocomplete';
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface SearchResponse {
  query: string;
  suggestions: SearchSuggestion[];
  results: SearchResult[];
  totalResults: number;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('nativeAPI', {
  createListener: () => {
    if (!native) {
      return {
        start: () => true,
        stop: () => true,
        getSelection: () => null,
      };
    }
    try {
      return native.createListener();
    } catch (error) {
      console.error('Failed to create listener:', error);
      throw error;
    }
  },
  start: (listener: SelectionListener) => {
    if (!native) {
      return true;
    }
    try {
      return native.start(listener);
    } catch (error) {
      console.error('Failed to start listener:', error);
      throw error;
    }
  },
  stop: (listener: SelectionListener) => {
    if (!native) {
      return true;
    }
    try {
      return native.stop(listener);
    } catch (error) {
      console.error('Failed to stop listener:', error);
      throw error;
    }
  },
} as NativeAPI);

// Expose IPC methods for communication with main process
contextBridge.exposeInMainWorld('electronAPI', {
  __debugInfo: () => ({
    locationHref: typeof window !== 'undefined' ? window.location?.href : 'n/a',
    hash: typeof window !== 'undefined' ? window.location?.hash : 'n/a'
  }),
  onSelectionChange: (callback: (text: string) => void) => {
    ipcRenderer.on('selection-changed', (_event: any, text: string) => callback(text));
  },
  onPopupText: (callback: (text: string) => void) => {
    ipcRenderer.on('popup-text', (_event: any, text: string) => callback(text));
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
  showPopup: (x: number, y: number, text: string) => {
    ipcRenderer.send('show-popup', { x, y, text });
  },
  hidePopup: () => {
    ipcRenderer.send('hide-popup');
  },
  onShowClipboardHistory: (callback: () => void) => {
    ipcRenderer.on('show-clipboard-history', () => callback());
  },
  testPopup: () => {
    return ipcRenderer.invoke('test-popup');
  },
  testTextSelection: () => {
    return ipcRenderer.invoke('test-text-selection');
  },
  showSettingsWindow: () => {
    return ipcRenderer.invoke('show-settings-window');
  },
  getLastSelection: (): Promise<SelectionEvent> => {
    return ipcRenderer.invoke('get-last-selection');
  },
  resetSelectionState: () => {
    return ipcRenderer.invoke('reset-selection-state');
  },
  startMonitoring: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('start-monitoring');
  },
  stopMonitoring: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('stop-monitoring');
  },
  openExternal: (url: string) => {
    ipcRenderer.send('open-external', url);
  },
  openInApp: (url: string) => {
    ipcRenderer.send('open-in-app', url);
  },
  minimizeWindow: () => {
    ipcRenderer.send('window-minimize');
  },
  maximizeWindow: () => {
    ipcRenderer.send('window-maximize');
  },
  closeWindow: () => {
    ipcRenderer.send('window-close');
  },
  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send('window-resize', { width, height });
  },
  send: (channel: string, ...args: any[]) => {
    ipcRenderer.send(channel, ...args);
  },
});

// Expose clipboard API
contextBridge.exposeInMainWorld('clipboardAPI', {
  startMonitoring: () => ipcRenderer.invoke('clipboard-start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('clipboard-stop-monitoring'),
  getHistory: (): Promise<ClipboardEntry[]> => ipcRenderer.invoke('clipboard-get-history'),
  getRecent: (count?: number): Promise<ClipboardEntry[]> => ipcRenderer.invoke('clipboard-get-recent', count),
  search: (query: string): Promise<ClipboardEntry[]> => ipcRenderer.invoke('clipboard-search', query),
  copy: (text: string): Promise<{ success: boolean }> => ipcRenderer.invoke('clipboard-copy', text),
  clear: (): Promise<{ success: boolean }> => ipcRenderer.invoke('clipboard-clear'),
  removeEntry: (id: string): Promise<boolean> => ipcRenderer.invoke('clipboard-remove-entry', id),
  getStats: (): Promise<ClipboardStats> => ipcRenderer.invoke('clipboard-get-stats'),
  export: (): Promise<string> => ipcRenderer.invoke('clipboard-export'),
  import: (jsonData: string): Promise<boolean> => ipcRenderer.invoke('clipboard-import', jsonData),
});

// Expose dictionary API
contextBridge.exposeInMainWorld('dictionaryAPI', {
  lookup: (text: string, targetLanguage?: string, enabledSources?: string[]): Promise<DictionaryResult> => {
    console.log('🔍 Preload: dictionaryAPI.lookup called with:', { text, targetLanguage, enabledSources });
    return ipcRenderer.invoke('dictionary-lookup', text, targetLanguage, enabledSources);
  },
  setApiKey: (apiKey: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dictionary-set-api-key', apiKey);
  },
  setDeepLApiKey: (deeplApiKey: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dictionary-set-deepl-api-key', deeplApiKey);
  },
  setOxfordCredentials: (appId: string, appKey: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dictionary-set-oxford-credentials', appId, appKey);
  },
  setYoudaoCredentials: (appKey: string, appSecret: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dictionary-set-youdao-credentials', appKey, appSecret);
  },
  setWordsApiCredentials: (rapidApiKey: string, rapidApiHost?: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dictionary-set-wordsapi-credentials', rapidApiKey, rapidApiHost);
  },
  setCollinsCredentials: (rapidApiKey: string, rapidApiHost: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dictionary-set-collins-credentials', rapidApiKey, rapidApiHost);
  },
  loadCcCedict: (url: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dictionary-load-cc-cedict', url);
  },
  getSources: (): Promise<DictionarySource[]> => {
    return ipcRenderer.invoke('dictionary-get-sources');
  },
  getSourceStats: (): Promise<{ total: number; available: number; sources: DictionarySource[] }> => {
    return ipcRenderer.invoke('dictionary-get-source-stats');
  },
  clearCache: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dictionary-clear-cache');
  },
  getCacheStats: (): Promise<{ size: number; entries: string[] }> => {
    return ipcRenderer.invoke('dictionary-get-cache-stats');
  },
  recall: (text: string, targetLanguage?: string): Promise<DictionaryResult> => {
    return ipcRenderer.invoke('dictionary-recall', text, targetLanguage);
  },
  getEnabledSources: (): Promise<string[]> => {
    return ipcRenderer.invoke('dictionary-get-enabled-sources');
  },
  setSourceEnabled: (sourceName: string, enabled: boolean): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dictionary-set-source-enabled', sourceName, enabled);
  },
  getSupportedLanguages: (): Promise<{ code: string; name: string; nativeName: string }[]> => {
    return ipcRenderer.invoke('dictionary-get-supported-languages');
  },
});

// Expose popup control API
contextBridge.exposeInMainWorld('popupAPI', {
  notifyMouseEnter: () => {
    ipcRenderer.send('popup-mouse-enter');
  },
  notifyMouseLeave: () => {
    ipcRenderer.send('popup-mouse-leave');
  },
  notifyClicked: () => {
    ipcRenderer.send('popup-clicked');
  },
});

// Expose Wikipedia API
contextBridge.exposeInMainWorld('wikipediaAPI', {
  search: (term: string, language?: string, limit?: number): Promise<WikipediaSearchResult> => 
    ipcRenderer.invoke('wikipedia-search', term, language, limit),
  getRandom: (language?: string): Promise<WikipediaResult | null> => 
    ipcRenderer.invoke('wikipedia-get-random', language),
  getCategories: (pageId: number, language?: string): Promise<string[]> => 
    ipcRenderer.invoke('wikipedia-get-categories', pageId, language),
  getRelated: (pageId: number, language?: string, limit?: number): Promise<WikipediaResult[]> => 
    ipcRenderer.invoke('wikipedia-get-related', pageId, language, limit),
  clearCache: (): Promise<{ success: boolean }> => 
    ipcRenderer.invoke('wikipedia-clear-cache'),
  getCacheStats: (): Promise<{ size: number; entries: string[] }> => 
    ipcRenderer.invoke('wikipedia-get-cache-stats'),
});

// Expose search API
contextBridge.exposeInMainWorld('searchAPI', {
  getSuggestions: (query: string): Promise<SearchSuggestion[]> => 
    ipcRenderer.invoke('search-get-suggestions', query),
  search: (query: string, limit?: number): Promise<SearchResponse> => 
    ipcRenderer.invoke('search-query', query, limit),
  getRelated: (query: string): Promise<SearchSuggestion[]> => 
    ipcRenderer.invoke('search-get-related', query),
  getTrending: (): Promise<SearchSuggestion[]> => 
    ipcRenderer.invoke('search-get-trending'),
  getStats: (query: string): Promise<{ estimatedResults: number; searchTime: number; relatedQueries: string[] }> => 
    ipcRenderer.invoke('search-get-stats', query),
  clearCache: (): Promise<{ success: boolean }> => 
    ipcRenderer.invoke('search-clear-cache'),
  getCacheStats: (): Promise<{ size: number; entries: string[] }> => 
    ipcRenderer.invoke('search-get-cache-stats'),
});

// Type declarations for TypeScript
declare global {
  interface Window {
    nativeAPI: NativeAPI;
    electronAPI: {
      onSelectionChange: (callback: (text: string) => void) => void;
      onPopupText: (callback: (text: string) => void) => void;
      removeAllListeners: (channel: string) => void;
      showPopup: (x: number, y: number, text: string) => void;
      hidePopup: () => void;
      onShowClipboardHistory: (callback: () => void) => void;
      testPopup: () => Promise<{ success: boolean }>;
      testTextSelection: () => Promise<{ success: boolean; text: string }>;
      showSettingsWindow: () => Promise<void>;
      getLastSelection: () => Promise<SelectionEvent>;
      resetSelectionState: () => Promise<{ success: boolean }>;
      openExternal: (url: string) => void;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      resizeWindow: (width: number, height: number) => void;
      send: (channel: string, ...args: any[]) => void;
      startMonitoring?: () => Promise<{ success: boolean }>;
      stopMonitoring?: () => Promise<{ success: boolean }>;
    };
    clipboardAPI: {
      startMonitoring: () => Promise<{ success: boolean }>;
      stopMonitoring: () => Promise<{ success: boolean }>;
      getHistory: () => Promise<ClipboardEntry[]>;
      getRecent: (count?: number) => Promise<ClipboardEntry[]>;
      search: (query: string) => Promise<ClipboardEntry[]>;
      copy: (text: string) => Promise<{ success: boolean }>;
      clear: () => Promise<{ success: boolean }>;
      removeEntry: (id: string) => Promise<boolean>;
      getStats: () => Promise<ClipboardStats>;
      export: () => Promise<string>;
      import: (jsonData: string) => Promise<boolean>;
    };
    dictionaryAPI: {
      lookup: (text: string, targetLanguage?: string, enabledSources?: string[]) => Promise<DictionaryResult>;
      setApiKey: (apiKey: string) => Promise<{ success: boolean }>;
      setDeepLApiKey: (deeplApiKey: string) => Promise<{ success: boolean }>;
      getSources: () => Promise<DictionarySource[]>;
      getSourceStats: () => Promise<{ total: number; available: number; sources: DictionarySource[] }>;
      clearCache: () => Promise<{ success: boolean }>;
      getCacheStats: () => Promise<{ size: number; entries: string[] }>;
      getEnabledSources: () => Promise<string[]>;
      setSourceEnabled: (sourceName: string, enabled: boolean) => Promise<{ success: boolean }>;
      getSupportedLanguages: () => Promise<{ code: string; name: string; nativeName: string }[]>;
      setOxfordCredentials?: (appId: string, appKey: string) => Promise<{ success: boolean }>;
      setYoudaoCredentials?: (appKey: string, appSecret: string) => Promise<{ success: boolean }>;
      setWordsApiCredentials?: (rapidApiKey: string, rapidApiHost?: string) => Promise<{ success: boolean }>;
      setCollinsCredentials?: (rapidApiKey: string, rapidApiHost: string) => Promise<{ success: boolean }>;
      loadCcCedict?: (url: string) => Promise<{ success: boolean }>;
      recall?: (text: string, targetLanguage?: string) => Promise<DictionaryResult>;
    };
    wikipediaAPI: {
      search: (term: string, language?: string, limit?: number) => Promise<WikipediaSearchResult>;
      getRandom: (language?: string) => Promise<WikipediaResult | null>;
      getCategories: (pageId: number, language?: string) => Promise<string[]>;
      getRelated: (pageId: number, language?: string, limit?: number) => Promise<WikipediaResult[]>;
      clearCache: () => Promise<{ success: boolean }>;
      getCacheStats: () => Promise<{ size: number; entries: string[] }>;
    };
    searchAPI: {
      getSuggestions: (query: string) => Promise<SearchSuggestion[]>;
      search: (query: string, limit?: number) => Promise<SearchResponse>;
      getRelated: (query: string) => Promise<SearchSuggestion[]>;
      getTrending: () => Promise<SearchSuggestion[]>;
      getStats: (query: string) => Promise<{ estimatedResults: number; searchTime: number; relatedQueries: string[] }>;
      clearCache: () => Promise<{ success: boolean }>;
      getCacheStats: () => Promise<{ size: number; entries: string[] }>;
    };
    popupAPI: {
      notifyMouseEnter: () => void;
      notifyMouseLeave: () => void;
      notifyClicked: () => void;
    };
  }
}
