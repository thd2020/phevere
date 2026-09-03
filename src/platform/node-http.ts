import fetch, { RequestInit, Response } from 'node-fetch';
import {
  DictionaryError,
  withTimeout,
  type HttpClient,
  type HttpRequestInit,
  type HttpTextResponse,
  type HttpBytesResponse,
} from '@phevere/core';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function rawFetch(url: string, options?: HttpRequestInit): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? 6000;
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    ...(options?.headers || {}),
  };
  try {
    return await withTimeout(
      fetch(url, {
        method: options?.method || 'GET',
        body: options?.body,
        timeout: timeoutMs,
        headers,
      } as RequestInit),
      timeoutMs + 500,
      `fetch ${url.slice(0, 64)}`,
    );
  } catch (error) {
    if (error instanceof DictionaryError) throw error;
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const aborted = /abort|timed out|timeout|network timeout/i.test(msg);
    throw new DictionaryError(`Request failed: ${msg}`, aborted ? 'TIMEOUT' : 'NETWORK_ERROR', true);
  }
}

export function createNodeHttpClient(): HttpClient {
  return {
    async requestJson<T>(url: string, options?: HttpRequestInit): Promise<T> {
      const timeoutMs = options?.timeoutMs ?? 6000;
      const method = (options?.method || 'GET').toUpperCase();
      const headers: Record<string, string> = { ...(options?.headers || {}) };
      if (options?.body && !headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      const response = await rawFetch(url, { ...options, method, headers, timeoutMs });
      if (!response.ok) {
        throw new DictionaryError(
          `HTTP ${response.status}: ${response.statusText}`,
          `HTTP_${response.status}`,
          response.status === 429 || response.status >= 500,
        );
      }
      return (await withTimeout(response.json() as Promise<T>, timeoutMs, 'response.json')) as T;
    },

    async requestText(url: string, options?: HttpRequestInit): Promise<HttpTextResponse> {
      const response = await rawFetch(url, options);
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    },

    async requestBytes(url: string, options?: HttpRequestInit): Promise<HttpBytesResponse> {
      const response = await rawFetch(url, options);
      const buf = Buffer.from(await response.arrayBuffer());
      return {
        ok: response.ok,
        status: response.status,
        bytes: buf,
        contentType: response.headers.get('content-type') || '',
      };
    },
  };
}
