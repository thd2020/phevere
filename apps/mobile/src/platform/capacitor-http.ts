import { CapacitorHttp } from '@capacitor/core';
import {
  DictionaryError,
  type HttpClient,
  type HttpRequestInit,
  type HttpTextResponse,
  type HttpBytesResponse,
} from '@phevere/core';

const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Phevere/0.1';

function mergeHeaders(options?: HttpRequestInit): Record<string, string> {
  return {
    'User-Agent': DEFAULT_UA,
    ...(options?.headers || {}),
  };
}

function dataToBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') {
    const binary = atob(data);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array();
}

export function createCapacitorHttpClient(): HttpClient {
  return {
    async requestJson<T>(url: string, options?: HttpRequestInit): Promise<T> {
      const timeoutMs = options?.timeoutMs ?? 6000;
      try {
        const headers = mergeHeaders(options);
        if (options?.body && !headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        const response = await CapacitorHttp.request({
          url,
          method: (options?.method || 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
          headers,
          data: options?.body,
          readTimeout: timeoutMs,
          connectTimeout: timeoutMs,
          responseType: 'json',
        });
        if (response.status < 200 || response.status >= 300) {
          throw new DictionaryError(
            `HTTP ${response.status}`,
            `HTTP_${response.status}`,
            response.status === 429 || response.status >= 500,
          );
        }
        return response.data as T;
      } catch (error) {
        if (error instanceof DictionaryError) throw error;
        const msg = error instanceof Error ? error.message : 'Unknown error';
        throw new DictionaryError(`Request failed: ${msg}`, 'NETWORK_ERROR', true);
      }
    },

    async requestText(url: string, options?: HttpRequestInit): Promise<HttpTextResponse> {
      const timeoutMs = options?.timeoutMs ?? 6000;
      const response = await CapacitorHttp.request({
        url,
        method: (options?.method || 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        headers: mergeHeaders(options),
        data: options?.body,
        readTimeout: timeoutMs,
        connectTimeout: timeoutMs,
        responseType: 'text',
      });
      const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
      return { ok: response.status >= 200 && response.status < 300, status: response.status, text };
    },

    async requestBytes(url: string, options?: HttpRequestInit): Promise<HttpBytesResponse> {
      const timeoutMs = options?.timeoutMs ?? 8000;
      const response = await CapacitorHttp.request({
        url,
        method: (options?.method || 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        headers: mergeHeaders(options),
        data: options?.body,
        readTimeout: timeoutMs,
        connectTimeout: timeoutMs,
        responseType: 'arraybuffer',
      });
      const headers = (response.headers || {}) as Record<string, string>;
      const contentType = headers['Content-Type'] || headers['content-type'] || '';
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        bytes: dataToBytes(response.data),
        contentType,
      };
    },
  };
}
