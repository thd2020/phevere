import { getHttp } from './runtime';
import type { HttpRequestInit } from './http';

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

export type CoreRequestInit = HttpRequestInit;

/**
 * Dictionary HTTP via an injected HttpClient (Node fetch, Electron net, or CapacitorHttp).
 */
export abstract class BaseService {
  protected requestTimeoutMs = 6000;

  protected async request<T>(url: string, options?: CoreRequestInit & { timeoutMs?: number }): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const { timeoutMs: _omit, ...rest } = (options || {}) as CoreRequestInit & { timeoutMs?: number };
    return getHttp().requestJson<T>(url, { ...rest, timeoutMs });
  }

  protected handleError(error: unknown): never {
    console.error('Service error:', error);
    throw error;
  }
}
