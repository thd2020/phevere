import { contextBridge, ipcRenderer } from 'electron';

// Do NOT require('../native-addon') here. Webpack dlopen's the UIA .node into
// every BrowserWindow preload (popup, history lookup, settings). A second
// UIAutomation COM instance in a renderer deadlocks while main already owns
// the hook — the window stays infinitely loading and never binds clicks.
// Selection monitoring belongs only in the main process (native-selection.ts).

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
  origin?: 'selection' | 'hover' | 'ocr' | 'media' | 'clipboard' | 'manual';
  source?: 'native' | 'manual';
  confidence?: number;
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
  wordFamily?: Array<{ relation: string; items?: Array<{ word: string; label?: string }>; words?: string[] }>;
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
const noopListener: SelectionListener = {
  start: () => true,
  stop: () => true,
  getSelection: () => null,
};

contextBridge.exposeInMainWorld('nativeAPI', {
  createListener: () => noopListener,
  start: () => true,
  stop: () => true,
} as NativeAPI);

// Expose IPC methods for communication with main process
contextBridge.exposeInMainWorld('electronAPI', {
  onSelectionChange: (callback: (text: string) => void) => {
    ipcRenderer.removeAllListeners('selection-changed');
    ipcRenderer.on('selection-changed', (_event: any, text: string) => callback(text));
  },
  onPopupText: (callback: (text: string, timestamp?: number) => void) => {
    ipcRenderer.on('popup-text', (_event: any, text: string, timestamp?: number) => callback(text, timestamp));
  },
  onPopupAppCommand: (callback: (cmd: string) => void) => {
    ipcRenderer.removeAllListeners('popup-app-command');
    ipcRenderer.on('popup-app-command', (_event: any, cmd: string) => callback(cmd));
  },
  onPopupProgress: (callback: (payload: {
    title?: string;
    subtitle?: string;
    percent?: number;
    stages?: string[];
    activeStage?: number;
  }) => void) => {
    ipcRenderer.removeAllListeners('popup-progress');
    ipcRenderer.on('popup-progress', (_event: any, payload: any) => callback(payload));
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
  showPopup: (x: number, y: number, text: string) => {
    ipcRenderer.send('show-popup', { x, y, text });
  },
  rememberSelection: (x: number, y: number, text: string) => {
    ipcRenderer.send('remember-selection', { x, y, text });
  },
  hidePopup: () => {
    ipcRenderer.send('hide-popup');
  },
  onShowClipboardHistory: (callback: () => void) => {
    ipcRenderer.on('show-clipboard-history', () => callback());
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
  getMonitorState: (): Promise<{
    mode: string;
    cycleShortcut: string;
    triggerShortcut: string;
    hoverEnabled?: boolean;
    ocrShortcut?: string;
    hoverShortcut?: string;
  }> => {
    return ipcRenderer.invoke('monitor-get-state');
  },
  setMonitorMode: (mode: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('monitor-set-mode', mode);
  },
  cycleMonitorMode: (): Promise<{ success: boolean; mode?: string }> => {
    return ipcRenderer.invoke('monitor-cycle-mode');
  },
  setMonitorShortcuts: (
    payload: {
      cycleShortcut: string;
      triggerShortcut: string;
      ocrShortcut?: string;
      hoverShortcut?: string;
      hoverEnabled?: boolean;
    },
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('monitor-set-shortcuts', payload);
  },
  setHoverEnabled: (enabled: boolean): Promise<{ success: boolean; hoverEnabled?: boolean }> => {
    return ipcRenderer.invoke('monitor-set-hover', enabled);
  },
  toggleHoverEnabled: (): Promise<{ success: boolean; hoverEnabled?: boolean }> => {
    return ipcRenderer.invoke('monitor-toggle-hover');
  },
  startOcrRegion: (): Promise<{ success: boolean; open?: boolean }> => {
    return ipcRenderer.invoke('start-ocr-region');
  },
  onMonitorHoverChanged: (callback: (payload: { hoverEnabled: boolean }) => void) => {
    ipcRenderer.removeAllListeners('monitor-hover-changed');
    ipcRenderer.on('monitor-hover-changed', (_event: any, payload: { hoverEnabled: boolean }) =>
      callback(payload),
    );
  },
  ocrImageFile: (filePath: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('ocr-image-file', filePath);
  },
  ocrImageData: (dataUrl: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('ocr-image-data', dataUrl);
  },
  onMonitorModeChanged: (callback: (payload: { mode: string }) => void) => {
    ipcRenderer.removeAllListeners('monitor-mode-changed');
    ipcRenderer.on('monitor-mode-changed', (_event: any, payload: { mode: string }) => callback(payload));
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
    return ipcRenderer.invoke('window-hide-to-tray');
  },
  resizeWindow: (width: number, height: number, x?: number, y?: number) => {
    ipcRenderer.send('window-resize', { width, height, x, y });
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
    return ipcRenderer.invoke('dictionary-lookup', text, targetLanguage, enabledSources);
  },
  onLookupUpdate: (callback: (result: DictionaryResult) => void) => {
    ipcRenderer.removeAllListeners('dictionary-lookup-update');
    ipcRenderer.on('dictionary-lookup-update', (_event, result: DictionaryResult) => callback(result));
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

contextBridge.exposeInMainWorld('vocabAPI', {
  list: (limit?: number) => ipcRenderer.invoke('vocab-list', limit),
  exportNotebook: (format?: 'json' | 'csv') => ipcRenderer.invoke('vocab-export', format),
  importNotebook: () => ipcRenderer.invoke('vocab-import'),
  find: (lemma: string) => ipcRenderer.invoke('vocab-find', lemma),
  add: async (payload: Record<string, unknown>) => {
    try {
      return await ipcRenderer.invoke('vocab-add', payload);
    } catch (error: any) {
      const msg = error?.message || String(error);
      throw new Error(msg);
    }
  },
  remove: (id: string) => ipcRenderer.invoke('vocab-remove', id),
  updateNote: (id: string, note: string) => ipcRenderer.invoke('vocab-update-note', id, note),
  review: (id: string, grade: 1 | 2 | 3 | 4) => ipcRenderer.invoke('vocab-review', id, grade),
  onUpdated: (callback: (payload: { id: string; lemma: string }) => void) => {
    ipcRenderer.on('vocab-updated', (_event, payload) => callback(payload));
  },
});

contextBridge.exposeInMainWorld('offlineDictAPI', {
  listPacks: () => ipcRenderer.invoke('offline-list-packs'),
  listCatalog: () => ipcRenderer.invoke('offline-list-catalog'),
  removePack: (packId: string) => ipcRenderer.invoke('offline-remove-pack', packId),
  lookup: (headword: string, language?: string) => ipcRenderer.invoke('offline-lookup', headword, language),
  importJson: () => ipcRenderer.invoke('offline-import-json'),
  importCedictFile: () => ipcRenderer.invoke('offline-import-cedict-file'),
  downloadPack: (packId: string) => ipcRenderer.invoke('offline-download-pack', packId),
  downloadCedict: () => ipcRenderer.invoke('offline-download-cedict'),
});

contextBridge.exposeInMainWorld('ocrAPI', {
  getStatus: () => ipcRenderer.invoke('ocr-get-status'),
  ensureDeps: () => ipcRenderer.invoke('ocr-ensure-deps'),
  setProfile: (profileId: string, customPath?: string | null) =>
    ipcRenderer.invoke('ocr-set-profile', profileId, customPath),
  pickCustomFolder: () => ipcRenderer.invoke('ocr-pick-custom-folder'),
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
      onPopupText: (callback: (text: string, timestamp?: number) => void) => void;
      onPopupAppCommand?: (callback: (cmd: string) => void) => void;
      onPopupProgress?: (callback: (payload: {
        title?: string;
        subtitle?: string;
        percent?: number;
        stages?: string[];
        activeStage?: number;
      }) => void) => void;
      removeAllListeners: (channel: string) => void;
      showPopup: (x: number, y: number, text: string) => void;
      rememberSelection?: (x: number, y: number, text: string) => void;
      hidePopup: () => void;
      onShowClipboardHistory: (callback: () => void) => void;
      testTextSelection: () => Promise<{ success: boolean; text: string }>;
      showSettingsWindow: () => Promise<void>;
      getLastSelection: () => Promise<SelectionEvent>;
      resetSelectionState: () => Promise<{ success: boolean }>;
      openExternal: (url: string) => void;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => Promise<{ ok: boolean }>;
      resizeWindow: (width: number, height: number, x?: number, y?: number) => void;
      send: (channel: string, ...args: any[]) => void;
      startMonitoring?: () => Promise<{ success: boolean }>;
      stopMonitoring?: () => Promise<{ success: boolean }>;
      getMonitorState: () => Promise<{
        mode: string;
        cycleShortcut: string;
        triggerShortcut: string;
        hoverEnabled?: boolean;
        ocrShortcut?: string;
        hoverShortcut?: string;
      }>;
      setMonitorMode: (mode: string) => Promise<{ success: boolean; error?: string }>;
      cycleMonitorMode: () => Promise<{ success: boolean; mode?: string }>;
      setMonitorShortcuts: (payload: {
        cycleShortcut: string;
        triggerShortcut: string;
        ocrShortcut?: string;
        hoverShortcut?: string;
        hoverEnabled?: boolean;
      }) => Promise<{ success: boolean; error?: string }>;
      setHoverEnabled?: (enabled: boolean) => Promise<{ success: boolean; hoverEnabled?: boolean }>;
      toggleHoverEnabled?: () => Promise<{ success: boolean; hoverEnabled?: boolean }>;
      startOcrRegion?: () => Promise<{ success: boolean; open?: boolean }>;
      onMonitorHoverChanged?: (callback: (payload: { hoverEnabled: boolean }) => void) => void;
      ocrImageFile?: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      ocrImageData?: (dataUrl: string) => Promise<{ success: boolean; error?: string }>;
      onMonitorModeChanged: (callback: (payload: { mode: string }) => void) => void;
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
      onLookupUpdate?: (callback: (result: DictionaryResult) => void) => void;
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
    vocabAPI: {
      list: (limit?: number) => Promise<any[]>;
      exportNotebook: (format?: 'json' | 'csv') => Promise<{ cancelled?: boolean; path?: string; count?: number }>;
      importNotebook: () => Promise<{ cancelled?: boolean; imported?: number; skipped?: number; path?: string }>;
      find: (lemma: string) => Promise<any | null>;
      add: (payload: Record<string, unknown>) => Promise<any>;
      remove: (id: string) => Promise<boolean>;
      updateNote: (id: string, note: string) => Promise<any>;
      review: (id: string, grade: 1 | 2 | 3 | 4) => Promise<any>;
      onUpdated: (callback: (payload: { id: string; lemma: string }) => void) => void;
    };
    offlineDictAPI: {
      listPacks: () => Promise<any[]>;
      listCatalog: () => Promise<any[]>;
      removePack: (packId: string) => Promise<{ success: boolean }>;
      lookup: (headword: string, language?: string) => Promise<any[]>;
      importJson: () => Promise<any>;
      importCedictFile: () => Promise<any>;
      downloadPack: (packId: string) => Promise<any>;
      downloadCedict: () => Promise<any>;
    };
    ocrAPI: {
      getStatus: () => Promise<{
        engine?: string;
        modelsPath?: string;
        available: boolean | null;
        lastError: string | null;
        activeProfileId?: string;
        profiles?: { id: string; label: string; kind: string; installed: boolean }[];
        python?: string;
        script?: string;
        modelRoot?: string;
      }>;
      ensureDeps: () => Promise<{ ok: boolean; detail: string }>;
      setProfile: (profileId: string, customPath?: string | null) => Promise<{ ok: boolean; detail: string }>;
      pickCustomFolder: () => Promise<{ cancelled: boolean; path?: string }>;
    };
  }
}
