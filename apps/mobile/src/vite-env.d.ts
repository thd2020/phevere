/// <reference types="vite/client" />

declare const __PHEVERE_DEV__: boolean;

declare module 'sql.js/dist/sql-wasm.wasm?url' {
  const url: string;
  export default url;
}

interface Window {
  PhevereBridge?: {
    call(method: string, id: string, params: string): void;
  };
  __pvResolve?: (id: string, payload: string) => void;
  __pvIncoming?: (text: string, origin: string) => void;
  __pvInsets?: { top: number; bottom: number; left: number; right: number };
}
