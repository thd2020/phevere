export {};

declare global {
  interface Window {
    electronAPI: {
      sendLookup: (word: string) => void;
      onLookupResult: (callback: (result: any) => void) => void;
      showPopup: (text: string) => void;
    };
  }
}
