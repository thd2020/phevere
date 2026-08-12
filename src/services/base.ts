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

/** Race a promise against a hard deadline; never leave IPC hanging forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new DictionaryError(`${label} timed out after ${ms}ms`, 'TIMEOUT', true)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Dictionary HTTP via Node's stack (node-fetch), not Electron `net.fetch`.
 * Electron's Chromium network has been hanging / aborting SSL here even when
 * the system browser is fine; node-fetch + explicit timeout is reliable.
 */
export abstract class BaseService {
  protected requestTimeoutMs = 4000;

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
