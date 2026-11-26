import * as http from 'http';
import * as https from 'https';
import fetch, { RequestInit } from 'node-fetch';
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

/**
 * Connections are kept open between requests. Electron 28 runs Node 18, whose default agent
 * closes every connection after one response, so each request paid a new TCP and TLS handshake
 * (several hundred milliseconds to Wikimedia's edge from Asia). Browsers and Node 19 and later
 * keep connections alive by default.
 */
const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 15_000 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 15_000 });

type NetFetch = (input: string, init?: Record<string, unknown>) => Promise<HttpResponseLike>;
interface HttpResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function electronFetch(): NetFetch | null {
  try {
    // Use Chromium's network stack once Electron is ready (HTTP/2, TLS 1.3 session cache, OS proxy).
    const electron = require('electron') as { app?: { isReady?: () => boolean }; net?: { fetch?: NetFetch } };
    if (electron?.app?.isReady?.() && typeof electron.net?.fetch === 'function') {
      return electron.net.fetch.bind(electron.net);
    }
  } catch {
    /* outside Electron */
  }
  return null;
}

function agentFor(parsed: URL): http.Agent {
  return parsed.protocol === 'http:' ? httpAgent : httpsAgent;
}

async function rawFetch(url: string, options?: HttpRequestInit): Promise<HttpResponseLike> {
  const timeoutMs = options?.timeoutMs ?? 9000;
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    ...(options?.headers || {}),
  };
  const netFetch = electronFetch();
  if (netFetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await withTimeout(
        netFetch(url, {
          method: options?.method || 'GET',
          body: options?.body,
          headers,
          signal: controller.signal,
        }),
        timeoutMs + 500,
        `fetch ${url.slice(0, 64)}`,
      );
    } catch (error) {
      if (error instanceof DictionaryError) throw error;
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const aborted = controller.signal.aborted || /abort|timed out|timeout|network timeout/i.test(msg);
      throw new DictionaryError(`Request failed: ${msg}`, aborted ? 'TIMEOUT' : 'NETWORK_ERROR', true);
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    return await withTimeout(
      fetch(url, {
        method: options?.method || 'GET',
        body: options?.body,
        timeout: timeoutMs,
        headers,
        agent: agentFor,
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
      const timeoutMs = options?.timeoutMs ?? 9000;
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
      const timeoutMs = options?.timeoutMs ?? 9000;
      const response = await rawFetch(url, { ...options, timeoutMs });
      const text = await withTimeout(response.text(), timeoutMs, 'response.text');
      return { ok: response.ok, status: response.status, text };
    },

    async requestBytes(url: string, options?: HttpRequestInit): Promise<HttpBytesResponse> {
      const timeoutMs = options?.timeoutMs ?? 9000;
      const response = await rawFetch(url, { ...options, timeoutMs });
      const buf = Buffer.from(await withTimeout(response.arrayBuffer(), timeoutMs, 'response.arrayBuffer'));
      return {
        ok: response.ok,
        status: response.status,
        bytes: buf,
        contentType: response.headers.get('content-type') || '',
      };
    },
  };
}
