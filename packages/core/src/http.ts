export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /**
   * Wait for one of the host's three request slots (net.ts); `later` waits behind the others.
   * Read by core's request layer and not passed on to the platform's client.
   */
  slot?: 'first' | 'later';
  /** `false`: never send a backup request for this one (net.ts). */
  hedge?: boolean;
}

export interface HttpTextResponse {
  ok: boolean;
  status: number;
  text: string;
}

export interface HttpBytesResponse {
  ok: boolean;
  status: number;
  bytes: Uint8Array;
  contentType: string;
}

export interface HttpClient {
  requestJson<T>(url: string, options?: HttpRequestInit): Promise<T>;
  requestText(url: string, options?: HttpRequestInit): Promise<HttpTextResponse>;
  requestBytes(url: string, options?: HttpRequestInit): Promise<HttpBytesResponse>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as unknown as {
    Buffer?: { from(b: Uint8Array): { toString(enc: string): string } };
    btoa?: (s: string) => string;
  };
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64');
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (!g.btoa) throw new Error('bytesToBase64: no Buffer or btoa');
  return g.btoa(binary);
}
