import {
  DictionaryError,
  type HttpClient,
  type HttpRequestInit,
  type HttpTextResponse,
  type HttpBytesResponse,
} from '@phevere/core';
import { hasNativeBridge, nativeCall } from './native';

const UA =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36 Phevere/1.5';

type NativeHttpOk = {
  status: number;
  text?: string;
  b64?: string;
  contentType?: string;
};

function mergeHeaders(options?: HttpRequestInit, native = false): Record<string, string> {
  const headers: Record<string, string> = {
    ...(native ? { 'User-Agent': UA } : {}),
    ...(options?.headers || {}),
  };
  if (!native) {
    delete headers['User-Agent'];
    delete headers['user-agent'];
  }
  return headers;
}

function rewriteDevUrl(url: string): string {
  try {
    if (typeof __PHEVERE_DEV__ === 'undefined' || !__PHEVERE_DEV__) return url;
    if (hasNativeBridge()) return url;
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'etymonline.com') return `/__pv/etymonline${u.pathname}${u.search}`;
    if (host === 'dict.youdao.com') {
      return u.protocol === 'http:'
        ? `/__pv/youdao-http${u.pathname}${u.search}`
        : `/__pv/youdao${u.pathname}${u.search}`;
    }
  } catch {
    /* keep */
  }
  return url;
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function nativeHttp(url: string, options: HttpRequestInit | undefined, as: 'text' | 'bytes'): Promise<NativeHttpOk> {
  return nativeCall<NativeHttpOk>(
    'http',
    {
      url,
      method: options?.method || 'GET',
      headers: mergeHeaders(options, true),
      body: options?.body || null,
      timeoutMs: options?.timeoutMs ?? (as === 'bytes' ? 60_000 : 8_000),
      responseType: as,
    },
    (options?.timeoutMs ?? 60_000) + 5_000,
  );
}

async function webFetch(url: string, options?: HttpRequestInit): Promise<Response> {
  const headers = mergeHeaders(options);
  if (options?.body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), options?.timeoutMs ?? 8000);
  try {
    return await fetch(url, {
      method: options?.method || 'GET',
      headers,
      body: options?.body,
      signal: ctrl.signal,
    });
  } finally {
    window.clearTimeout(t);
  }
}

export function createHttpClient(): HttpClient {
  return {
    async requestJson<T>(url: string, options?: HttpRequestInit): Promise<T> {
      const text = await this.requestText(url, options);
      if (!text.ok) {
        throw new DictionaryError(`HTTP ${text.status}`, `HTTP_${text.status}`, text.status === 429 || text.status >= 500);
      }
      try {
        return JSON.parse(text.text) as T;
      } catch {
        throw new DictionaryError('Invalid JSON', 'PARSE_ERROR', false);
      }
    },

    async requestText(url: string, options?: HttpRequestInit): Promise<HttpTextResponse> {
      try {
        if (hasNativeBridge()) {
          const res = await nativeHttp(url, options, 'text');
          return { ok: res.status >= 200 && res.status < 300, status: res.status, text: res.text || '' };
        }
        const response = await webFetch(rewriteDevUrl(url), options);
        return { ok: response.ok, status: response.status, text: await response.text() };
      } catch (error) {
        if (error instanceof DictionaryError) throw error;
        const msg = error instanceof Error ? error.message : 'Unknown error';
        throw new DictionaryError(`Request failed: ${msg}`, 'NETWORK_ERROR', true);
      }
    },

    async requestBytes(url: string, options?: HttpRequestInit): Promise<HttpBytesResponse> {
      if (hasNativeBridge()) {
        const res = await nativeHttp(url, options, 'bytes');
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          bytes: res.b64 ? b64ToBytes(res.b64) : new Uint8Array(),
          contentType: res.contentType || '',
        };
      }
      const response = await webFetch(rewriteDevUrl(url), options);
      const buf = await response.arrayBuffer();
      return {
        ok: response.ok,
        status: response.status,
        bytes: new Uint8Array(buf),
        contentType: response.headers.get('content-type') || '',
      };
    },
  };
}
