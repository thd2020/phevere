/**
 * Every request core makes goes through `trackHttp` (runtime.ts wraps the platform's client with
 * it), so lookups and pictures cope with a slow or unsteady network the way mature clients do.
 * From China, Wiktionary, Wikipedia, Wikidata and Commons often take one to three seconds a
 * request, and now and then a request never answers.
 *
 * - Round-trip times are kept per host and smoothed as TCP keeps them (RFC 6298: SRTT and RTTVAR,
 *   RTO = SRTT + 4 RTTVAR, at least one second). A step whose budget was set for a normal network
 *   (how long a lookup waits for the page that says whether "etc." has its own title, say) asks
 *   `budgetMs` (or waits through `withBudget` in base.ts, which asks again when time is up), and
 *   the budget stretches to the host's RTO when the host is slower than that. A request's own
 *   timeout is likewise never shorter than twice the host's RTO. On a normal network the RTO stays
 *   under every budget, so nothing changes there.
 * - A GET that has not answered within its host's RTO gets one backup request, and the first
 *   answer wins: a hedged request, as in Dean and Barroso, "The Tail at Scale" (CACM, 2013). The
 *   backup goes out only for the slowest few per cent of requests, and it turns a request that
 *   hangs until its timeout into one that costs a round trip more than usual.
 * - Wikimedia asks API clients for at most three requests at a time to one host. A backup request
 *   waits for a free one of those three, and requests that ask for a slot (`slot`, the pictures'
 *   requests) queue for one, the `later` ones behind the rest. The lookup's own requests never
 *   wait for a slot, so the first definitions are as fast as before.
 *   https://www.mediawiki.org/wiki/API:Etiquette, https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
 */
import type { HttpClient, HttpRequestInit } from './http';

/** Wikimedia's polite limit: requests open at once to one host. */
export const MAX_PER_HOST = 3;
/** RFC 6298 (2.4): an RTO below one second is rounded up to it. */
const MIN_RTO_MS = 1000;
/** No budget or timeout is stretched past this. */
const MAX_RTO_MS = 15000;
/** Before a host has answered once, a backup request waits this long (RFC 2988's first RTO). */
const FIRST_HEDGE_MS = 3000;
/** What the platform clients use when a request names no timeout. */
const CLIENT_TIMEOUT_MS = 8000;

interface HostState {
  srtt: number;
  rttvar: number;
  samples: number;
  inFlight: number;
  first: Array<() => void>;
  later: Array<() => void>;
  /** Backup timers set before the host had answered once, set again by its first answer. */
  onFirstAnswer: Set<() => void>;
}

const hosts = new Map<string, HostState>();

export function hostOf(url: string): string {
  const m = String(url || '').match(/^[a-z]+:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function state(host: string): HostState {
  let s = hosts.get(host);
  if (!s) {
    s = { srtt: 0, rttvar: 0, samples: 0, inFlight: 0, first: [], later: [], onFirstAnswer: new Set() };
    hosts.set(host, s);
  }
  return s;
}

/** One answered request's round trip (RFC 6298, 2.2 and 2.3). */
export function noteRoundTrip(host: string, ms: number): void {
  if (!host || !(ms >= 0)) return;
  const s = state(host);
  if (!s.samples) {
    s.srtt = ms;
    s.rttvar = ms / 2;
  } else {
    s.rttvar = 0.75 * s.rttvar + 0.25 * Math.abs(s.srtt - ms);
    s.srtt = 0.875 * s.srtt + 0.125 * ms;
  }
  s.samples += 1;
  if (s.samples === 1) for (const f of Array.from(s.onFirstAnswer)) f();
}

/** The host's retransmission timeout, or 0 before it has answered once. */
export function rtoMs(host: string): number {
  const s = hosts.get(host);
  if (!s || !s.samples) return 0;
  return Math.round(Math.min(MAX_RTO_MS, Math.max(MIN_RTO_MS, s.srtt + 4 * s.rttvar)));
}

/** When each request still waiting for its answer went out. */
const waiting = new Set<{ since: number }>();

/**
 * The middle RTO of the hosts that have answered. A slow connection is usually slow to every
 * host, so a host not asked yet is expected to be like the others. Before any host has answered
 * (the first lookup after an app start), the oldest request still waiting is taken as a first
 * round trip, since the real one is at least that long, and turned into an RTO the way RFC 6298
 * turns a first sample into one (three times the sample). Nothing sent yet gives 0.
 *
 * That guess stops at FIRST_HEDGE_MS. A connection that is slow and one that answers nothing at
 * all (Wi-Fi without internet) look the same until the first answer, and an uncapped guess grows
 * with the wait itself: every budget asked again when it ran out was three times further away,
 * so on a dead connection no budget ever ran out before its requests did.
 */
export function typicalRtoMs(): number {
  const list = Array.from(hosts.keys()).map(rtoMs).filter(Boolean).sort((a, b) => a - b);
  if (list.length) return list[Math.floor((list.length - 1) / 2)];
  let oldest = 0;
  const now = Date.now();
  for (const w of waiting) oldest = Math.max(oldest, now - w.since);
  return oldest ? Math.round(Math.min(FIRST_HEDGE_MS, Math.max(MIN_RTO_MS, 3 * oldest))) : 0;
}

/**
 * A step's budget: `base` ms, or `trips` round trips to the slowest of `on` (hosts or URLs) when
 * that is longer. A host that has not answered yet counts as typical (`typicalRtoMs`), and so does
 * an empty `on`. A budget set for a normal network then still holds on a slow one.
 */
export function budgetMs(base: number, on: string | string[] = [], trips = 1): number {
  const list = (Array.isArray(on) ? on : [on]).map((h) => (/\//.test(h) ? hostOf(h) : h.toLowerCase()));
  const rto = Math.max(0, ...(list.length ? list : ['']).map((h) => (h && rtoMs(h)) || typicalRtoMs()));
  return Math.max(base, Math.round(trips * rto));
}

/** Requests open to `host` right now (for tests and measurements). */
export function inFlight(host: string): number {
  return hosts.get(host)?.inFlight || 0;
}

/** For tests: forget every host's round trips. Requests in flight keep their slots. */
export function resetNetStats(): void {
  for (const s of hosts.values()) {
    s.srtt = 0;
    s.rttvar = 0;
    s.samples = 0;
  }
}

/** Waits for one of the host's slots; `later` waits behind every other request. */
function takeSlot(s: HostState, later: boolean): Promise<void> {
  if (s.inFlight < MAX_PER_HOST && !s.first.length && (later ? !s.later.length : true)) {
    s.inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) =>
    (later ? s.later : s.first).push(() => {
      s.inFlight += 1;
      resolve();
    }),
  );
}

function releaseSlot(s: HostState): void {
  s.inFlight -= 1;
  while (s.inFlight < MAX_PER_HOST) {
    const next = s.first.shift() || s.later.shift();
    if (!next) break;
    next();
  }
}

/** Whether a failure was the server answering (404, 429, 503) rather than no answer at all. */
function answered(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e && typeof e.code === 'string' && /^HTTP_\d{3}$/.test(e.code)) return true;
  return /\bHTTP[ _]?\d{3}\b/.test(String((e && e.message) || err || ''));
}

type Kind = 'requestJson' | 'requestText' | 'requestBytes';

/** The platform's client with round-trip tracking, adaptive timeouts, hedging and slots. */
export function trackHttp(inner: HttpClient): HttpClient {
  if ((inner as { tracked?: boolean }).tracked) return inner;

  const send = <T>(kind: Kind, url: string, options?: HttpRequestInit): Promise<T> => {
    const host = hostOf(url);
    const s = state(host);
    const { slot, hedge, ...rest } = options || {};
    const rto = rtoMs(host);
    // Downloads (pictures, offline packs) keep the caller's timeout and are never hedged: they
    // are not small API answers, and a second copy would only compete for the same bandwidth.
    const api = kind !== 'requestBytes';
    const asked = rest.timeoutMs ?? CLIENT_TIMEOUT_MS;
    const timeoutMs = api && 2 * rto > asked ? Math.min(MAX_RTO_MS * 2, 2 * rto) : rest.timeoutMs;
    const init: HttpRequestInit = timeoutMs != null ? { ...rest, timeoutMs } : rest;
    // `decided`: the request's backup has already answered, so this answer is late. Its time is
    // left out of the round trips, as Karn's algorithm leaves out a retransmitted segment's: a
    // request that hung for six seconds would otherwise raise the host's RTO to six seconds, and
    // the next hung request would wait that long for its backup.
    const once = async (queued: boolean, took = false, onSend?: () => void, decided?: () => boolean): Promise<T> => {
      if (queued && !took) await takeSlot(s, slot === 'later');
      else if (!took) s.inFlight += 1;
      onSend?.();
      const started = Date.now();
      const mark = { since: started };
      if (api) waiting.add(mark);
      try {
        const value = await (inner[kind] as (u: string, o?: HttpRequestInit) => Promise<T>).call(inner, url, init);
        if (api && !decided?.()) noteRoundTrip(host, Date.now() - started);
        return value;
      } catch (err) {
        if (api && answered(err) && !decided?.()) noteRoundTrip(host, Date.now() - started);
        throw err;
      } finally {
        waiting.delete(mark);
        releaseSlot(s);
      }
    };
    const method = String(rest.method || 'GET').toUpperCase();
    const hedgeAfter = rto || FIRST_HEDGE_MS;
    if (!api || hedge === false || method !== 'GET' || rest.body != null || (timeoutMs ?? CLIENT_TIMEOUT_MS) <= hedgeAfter + 250) {
      return once(!!slot);
    }
    return new Promise<T>((resolve, reject) => {
      let done = false;
      let pending = 1;
      let firstError: unknown = null;
      const settle = (ok: boolean, v: unknown) => {
        if (done) return;
        if (ok || answered(v)) {
          done = true;
          clearTimeout(timer);
          unhook();
          if (ok) resolve(v as T);
          else reject(v);
          return;
        }
        if (firstError == null) firstError = v;
        pending -= 1;
        if (!pending && !backupWaiting) {
          done = true;
          clearTimeout(timer);
          unhook();
          reject(firstError);
        }
      };
      let backupWaiting = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // The backup is due a round trip after the first request went out, not after it queued.
      // Before the host has answered once that round trip is a guess (FIRST_HEDGE_MS). When the
      // host's first answer, to this request's neighbours, gives an RTO shorter than the guess, the
      // backup goes out then; a longer one leaves the guess, which RFC 6298 would back off from.
      let rearm: (() => void) | null = null;
      const unhook = () => {
        if (rearm) s.onFirstAnswer.delete(rearm);
        rearm = null;
      };
      const arm = () => {
        const sentAt = Date.now();
        // A request that queued for a slot may go out after the host's first answer.
        const known = rtoMs(host);
        timer = setTimeout(backup, known || hedgeAfter);
        if (known) return;
        rearm = () => {
          unhook();
          const due = rtoMs(host);
          if (done || !due || due >= hedgeAfter) return;
          clearTimeout(timer);
          timer = setTimeout(backup, Math.max(0, sentAt + due - Date.now()));
        };
        s.onFirstAnswer.add(rearm);
      };
      const backup = () => {
        unhook();
        if (done) return;
        // The backup takes one of the host's three slots, waiting for one if all are open.
        backupWaiting = true;
        void takeSlot(s, false).then(() => {
          backupWaiting = false;
          if (done) {
            releaseSlot(s);
            return;
          }
          pending += 1;
          once(false, true, undefined, () => done).then(
            (v) => settle(true, v),
            (e) => settle(false, e),
          );
        });
      };
      once(!!slot, false, arm, () => done).then(
        (v) => settle(true, v),
        (e) => {
          // A first request that failed outright before its backup was due is not hedged.
          if (!backupWaiting && pending === 1) clearTimeout(timer);
          settle(false, e);
        },
      );
    });
  };

  const tracked: HttpClient & { tracked: boolean } = {
    tracked: true,
    requestJson: <T>(url: string, options?: HttpRequestInit) => send<T>('requestJson', url, options),
    requestText: (url, options) => send('requestText', url, options),
    requestBytes: (url, options) => send('requestBytes', url, options),
  };
  return tracked;
}
