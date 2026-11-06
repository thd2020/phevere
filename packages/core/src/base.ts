import { getHttp } from './runtime';
import type { HttpRequestInit } from './http';
import { budgetMs, onNetChange } from './net';

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

/**
 * withTimeout for a step that waits on the network, with a budget that follows it: `base` ms on a
 * normal connection, longer when the hosts in `on` (none: any host) are slower (budgetMs, net.ts).
 * The step's `trips` round trips get one more, for the backup request a hung request is sent a
 * round trip after it (net.ts); on a normal network that is still shorter than `base`.
 * When the budget runs out it is worked out again from the round trips seen meanwhile, so the
 * first lookup after an app start, which starts before any host has answered, gets the longer
 * budget too once the first answers show the connection is slow. It is also worked out again
 * when the connection is found silent (net.ts): a budget stretched for a slow connection that has
 * since died then ends at its normal-network length instead of the slow one's.
 *
 * `measured`: stretch only for round trips actually measured (typicalRtoMs in net.ts), for a step
 * that holds back something already there to show.
 */
export function withBudget<T>(
  promise: Promise<T>,
  base: number,
  on: string | string[] = [],
  trips = 1,
  label = 'operation',
  measured = false,
): Promise<T> {
  const started = Date.now();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      if (settled) return;
      clearTimeout(timer);
      const budget = budgetMs(base, on, trips + 1, measured);
      const left = budget - (Date.now() - started);
      if (left > 0) {
        timer = setTimeout(check, left);
        return;
      }
      settled = true;
      off();
      reject(new DictionaryError(`${label} timed out after ${budget}ms`, 'TIMEOUT', true));
    };
    timer = setTimeout(check, budgetMs(base, on, trips + 1, measured));
    const off = onNetChange(check);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
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
 * Dictionary HTTP via an injected HttpClient (Node fetch, Electron net, or native mobile HTTP).
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
