import fetch, { RequestInit, Response } from 'node-fetch';

export class DictionaryError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = 'DictionaryError';
  }
}

/**
 * Deadline wrapper that NEVER leaves the input promise's rejection unhandled.
 * Plain `Promise.race([p, timeout])` is unsafe: when the timeout wins, a later
 * rejection of `p` becomes an unhandledRejection and Electron can exit — which
 * looked like a frozen popup (Forge then relaunches).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DictionaryError(`${label} timed out after ${ms}ms`, 'TIMEOUT', true));
    }, ms);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return; // timeout already won — rejection is still handled here
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Like withTimeout but resolves `fallback` instead of rejecting. */
export function withTimeoutFallback<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return withTimeout(promise, ms, 'op').catch(() => fallback);
}

/**
 * Dictionary HTTP via Node's stack (node-fetch), not Electron `net.fetch`.
 */
export abstract class BaseService {
  protected requestTimeoutMs = 6000;

  protected async request<T>(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const { timeoutMs: _omit, ...fetchOptions } = (options || {}) as RequestInit & { timeoutMs?: number };

    try {
      const response: Response = await fetch(url, {
        ...fetchOptions,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...((fetchOptions?.headers as Record<string, string>) || {}),
        },
      });

      if (!response.ok) {
        throw new DictionaryError(
          `HTTP ${response.status}: ${response.statusText}`,
          `HTTP_${response.status}`,
          response.status >= 500,
        );
      }

      return (await withTimeout(response.json() as Promise<T>, timeoutMs, 'response.json')) as T;
    } catch (error) {
      if (error instanceof DictionaryError) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const aborted = /abort|timed out|timeout|network timeout/i.test(msg);
      throw new DictionaryError(`Request failed: ${msg}`, aborted ? 'TIMEOUT' : 'NETWORK_ERROR', true);
    }
  }

  protected handleError(error: any): never {
    console.error('Service error:', error);
    throw error;
  }
}
