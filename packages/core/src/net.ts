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
 *   requests) queue for one, the `later` ones behind the rest. The lookup's own requests go out
 *   at once while fewer than three are open and otherwise wait first in line, ahead of backups
 *   and pictures, so the first definitions are as fast as before.
 *   https://www.mediawiki.org/wiki/API:Etiquette, https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
 * - A slow connection and a dead one look the same until something answers, so the connection
 *   is also watched as a whole, as Chrome's network quality estimator and Firestore's online
 *   state do. When requests to two or more hosts, all sent after the last answer from anywhere,
 *   have each waited past their round trip with nothing answering, or have failed without an
 *   answer (a refused connection, a name that does not resolve), the connection counts as silent:
 *   every round trip measured before it is stale, budgets and timeouts go back to those of a
 *   normal network, and the waits already running are told (`onNetChange`). The platform's own
 *   word counts too: an `offline` event makes the connection silent at once, and an `online`
 *   event is a network change, after which every host is measured afresh (Chrome clears its
 *   estimates on a connection change the same way). The first answer after a silence tells the
 *   waits again, so callers that stopped asking a failing host (dictionary.ts) try it again.
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
/**
 * No stretched budget is longer than this. A budget of several round trips (the lookup's deadline
 * is seven) to a host whose RTO grew on a slow connection would otherwise reach a minute or more,
 * and a host that stops answering then gives no new round trips to bring it down again.
 */
const MAX_BUDGET_MS = 30000;
/** What the platform clients use when a request names no timeout. */
const CLIENT_TIMEOUT_MS = 8000;

interface HostState {
  srtt: number;
  rttvar: number;
  samples: number;
  inFlight: number;
  /** A lookup's own requests waiting for a slot on a Wikimedia host (wikimediaHost); they go first. */
  now: Array<() => void>;
  first: Array<() => void>;
  later: Array<() => void>;
  /** Backup timers set before the host had answered once, set again by its first answer. */
  onFirstAnswer: Set<() => void>;
  /** When it last answered (Date.now()). */
  answeredAt: number;
  /** Its requests sent since its last answer that waited past their round trip or failed without one. */
  overdue: Set<Mark>;
  /** Not answering while other hosts do (hostSilent). */
  silent: boolean;
  /** Its last request got no answer at all (forgetHost); cleared by its next answer. */
  forgotten: boolean;
}

const hosts = new Map<string, HostState>();

/** When any host last answered, with any status (Date.now()). */
let lastAnswerAt = 0;
/** Set while the connection as a whole is silent (see the top of this file); cleared by any answer. */
let silent = false;
/** When the connection was last found silent. Round trips measured before it are stale. */
let silentAt = 0;
/** Requests sent after the last answer that have waited past their round trip or failed without an answer. */
const unanswered = new Set<Mark>();
const listeners = new Set<() => void>();
/** Goes up each time the connection answers again after a silence or the platform reports a network change. */
let epoch = 0;

/**
 * A count that goes up each time the connection answers again after a silence, or the platform
 * reports a network change. A skip that began before it (dictionary.ts) says nothing about the
 * sources now. One host falling silent while others answer (hostSilent) does not move it.
 */
export function networkEpoch(): number {
  return epoch;
}

/**
 * Calls `f` whenever the connection is found silent, answers again after a silence, or the
 * platform reports a network change. Returns a function that stops the calls.
 */
export function onNetChange(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

function changed(): void {
  for (const f of Array.from(listeners)) {
    try {
      f();
    } catch {
      /* a listener's failure is its own */
    }
  }
}

/** Whether the connection as a whole is silent right now. */
export function connectionSilent(): boolean {
  return silent;
}

/**
 * Whether `host` (or a URL's host) has stopped answering while the connection works: two of its
 * requests, sent since its last answer, waited past their round trip or failed without an answer
 * (a hung request and its backup count as two), and other hosts answered meanwhile. A wait for
 * that host's answer before showing anything (dictionary.ts) need not go on: its answer, if it
 * comes, still arrives as an update.
 */
export function hostSilent(host: string): boolean {
  const h = /\//.test(host) ? hostOf(host) : host.toLowerCase();
  return !!hosts.get(h)?.silent;
}

/** Some host answered (a response of any status), so the connection works. */
function heard(host: string): void {
  lastAnswerAt = Date.now();
  unanswered.clear();
  const s = hosts.get(host);
  if (s) {
    s.overdue.clear();
    s.silent = false;
  }
  if (silent) {
    silent = false;
    epoch += 1;
    changed();
  }
}

/** A request's place in the watch for a silent connection (noAnswer). */
interface Mark {
  since: number;
  host: string;
  /** A round trip was measured when it went out, so being past it says something. */
  expected: boolean;
}

/**
 * Before any round trip has been measured, a request counts towards the whole connection's
 * silence only after this long with no answer from anywhere, or when it fails before its own
 * timeout (a refused connection, a name that does not resolve). Twice the first RTO of RFC 6298:
 * a satellite link or a VPN setting up its first connections can take five seconds to give its
 * first answers, and a guess of one round trip would take it for a dead one.
 */
const COLD_SILENCE_MS = 2 * FIRST_HEDGE_MS;

/**
 * A request sent after the last answer has gone without one: `overdue` when it has waited past
 * its round trip, `long` when it has waited COLD_SILENCE_MS, `refused` when it failed before its
 * timeout and `timedOut` when its timeout ran out.
 *
 * Before any round trip has been measured (an app start, or after a silence or a network change)
 * the round trip it waited past is only a guess. A connection whose first answers take longer
 * than that would be taken for a dead one: its budgets would drop to a normal network's, and the
 * exact-title check and the first paint would give up just before the answers came. So until
 * something answers, only a refusal or a wait of COLD_SILENCE_MS counts towards the whole
 * connection's silence, as a browser goes offline on a failed connection and not on a slow one.
 * One host lagging behind the others (hostSilent) still counts from the guess: the others
 * answering show that the connection works.
 */
function noAnswer(mark: Mark, how: 'overdue' | 'long' | 'refused' | 'timedOut'): void {
  const s = state(mark.host);
  if (!s.silent && mark.since >= s.answeredAt) {
    // The two earliest are enough to decide, and a dead connection does not pile them up.
    if (s.overdue.size < 2) s.overdue.add(mark);
    let first = Infinity;
    for (const m of s.overdue) first = Math.min(first, m.since);
    if (s.overdue.size >= 2 && lastAnswerAt > first) {
      s.silent = true;
      changed();
    }
  }
  if (silent || mark.since < lastAnswerAt) return;
  const counts = mark.expected ? how !== 'long' : how === 'long' || how === 'refused' || (how === 'timedOut' && Date.now() - mark.since >= COLD_SILENCE_MS);
  if (!counts) return;
  unanswered.add(mark);
  if (unanswered.size < 2 || new Set(Array.from(unanswered, (m) => m.host)).size < 2) return;
  markSilent();
}

function markSilent(): void {
  silent = true;
  silentAt = Date.now();
  unanswered.clear();
  changed();
}

/**
 * The platform says the network changed (it came back, or moved from Wi-Fi to mobile data):
 * every host is measured afresh and the connection is no longer taken as silent.
 */
export function noteNetworkChange(): void {
  for (const s of hosts.values()) {
    s.srtt = 0;
    s.rttvar = 0;
    s.samples = 0;
    s.overdue.clear();
    s.silent = false;
  }
  silent = false;
  unanswered.clear();
  epoch += 1;
  changed();
}

/** The platform says it is offline: the connection is silent until something answers. */
export function noteOffline(): void {
  if (!silent) markSilent();
}

// A WebView (the phone app) or a browser reports going offline and coming back, and whether it
// is offline when the app starts.
{
  const g = globalThis as { addEventListener?: (type: string, f: () => void) => void; navigator?: { onLine?: boolean } };
  if (typeof g.addEventListener === 'function') {
    try {
      g.addEventListener('offline', noteOffline);
      g.addEventListener('online', noteNetworkChange);
      if (g.navigator?.onLine === false) noteOffline();
    } catch {
      /* no events here */
    }
  }
}

export function hostOf(url: string): string {
  const m = String(url || '').match(/^[a-z]+:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function state(host: string): HostState {
  let s = hosts.get(host);
  if (!s) {
    s = { srtt: 0, rttvar: 0, samples: 0, inFlight: 0, now: [], first: [], later: [], onFirstAnswer: new Set(), answeredAt: 0, overdue: new Set(), silent: false, forgotten: false };
    hosts.set(host, s);
  }
  return s;
}

/** One answered request's round trip (RFC 6298, 2.2 and 2.3). */
export function noteRoundTrip(host: string, ms: number): void {
  if (!host || !(ms >= 0)) return;
  const s = state(host);
  // Round trips from before the connection went silent are not blended into new ones.
  if (silentAt && s.answeredAt <= silentAt) s.samples = 0;
  if (!s.samples) {
    s.srtt = ms;
    s.rttvar = ms / 2;
  } else {
    s.rttvar = 0.75 * s.rttvar + 0.25 * Math.abs(s.srtt - ms);
    s.srtt = 0.875 * s.srtt + 0.125 * ms;
  }
  s.samples += 1;
  s.answeredAt = Date.now();
  s.forgotten = false;
  if (s.samples === 1) for (const f of Array.from(s.onFirstAnswer)) f();
}

/**
 * The host's retransmission timeout, or 0 before it has answered once, and 0 when its last answer
 * came before the connection was last found silent: those round trips belong to a connection that
 * may be gone (a VPN that dropped), and a silent connection says nothing about the next one.
 */
export function rtoMs(host: string): number {
  const s = hosts.get(host);
  if (!s || !s.samples || (silentAt && s.answeredAt <= silentAt)) return 0;
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
 *
 * `measured`: only round trips that were measured count, not the guess from waiting. A step that
 * holds back something it could already show (senses from an offline pack) asks for this, so a
 * connection that has not answered yet, slow or dead, does not keep them back. Once the
 * connection is found silent the guess is dropped as well: nothing it would wait for is coming.
 */
export function typicalRtoMs(measured = false): number {
  // Round trips measured before the connection was last found silent do not count (rtoMs): when
  // the connection dies, hosts not asked since still hold the round trips of the slow connection.
  // One host that stops answering while others answer (Wiktionary blocked) says nothing about
  // the others, so their round trips still count.
  const list = Array.from(hosts.keys())
    .map((h) => rtoMs(h))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (list.length) return list[Math.floor((list.length - 1) / 2)];
  if (measured || silent) return 0;
  let oldest = 0;
  const now = Date.now();
  for (const w of waiting) oldest = Math.max(oldest, now - w.since);
  return oldest ? Math.round(Math.min(FIRST_HEDGE_MS, Math.max(MIN_RTO_MS, 3 * oldest))) : 0;
}

/**
 * A step's budget: `base` ms, or `trips` round trips to the slowest of `on` (hosts or URLs) when
 * that is longer. A host that has not answered yet counts as typical (`typicalRtoMs`), and so does
 * an empty `on`. A budget set for a normal network then still holds on a slow one. `measured`:
 * see typicalRtoMs.
 */
export function budgetMs(base: number, on: string | string[] = [], trips = 1, measured = false): number {
  const list = (Array.isArray(on) ? on : [on]).map((h) => (/\//.test(h) ? hostOf(h) : h.toLowerCase()));
  // A host whose last request got no answer at all is not stretched for: nothing says that
  // waiting longer for it helps. A host not asked yet counts as typical.
  const rto = Math.max(0, ...(list.length ? list : ['']).map((h) => (h && hosts.get(h)?.forgotten ? 0 : (h && rtoMs(h)) || typicalRtoMs(measured))));
  return Math.max(base, Math.min(MAX_BUDGET_MS, Math.round(trips * rto)));
}

/** Requests open to `host` right now (for tests and measurements). */
export function inFlight(host: string): number {
  return hosts.get(host)?.inFlight || 0;
}

/** The host's round trips are forgotten; it counts as not yet answered. */
function forgetHost(host: string): void {
  const s = hosts.get(host);
  if (!s) return;
  s.forgotten = true;
  s.srtt = 0;
  s.rttvar = 0;
  s.samples = 0;
}

/** For tests: forget every host's round trips. Requests in flight keep their slots. */
export function resetNetStats(): void {
  for (const s of hosts.values()) {
    s.srtt = 0;
    s.rttvar = 0;
    s.samples = 0;
    s.overdue.clear();
    s.silent = false;
    s.forgotten = false;
  }
  silent = false;
  silentAt = 0;
  lastAnswerAt = 0;
  unanswered.clear();
}

/**
 * Waits for one of the host's slots. `now` (a lookup's own request to a Wikimedia host that has
 * three open) goes ahead of every other waiting request, and `later` waits behind all of them.
 */
function takeSlot(s: HostState, queue: 'now' | 'first' | 'later'): Promise<void> {
  const ahead = s.now.length + (queue === 'now' ? 0 : s.first.length) + (queue === 'later' ? s.later.length : 0);
  if (s.inFlight < MAX_PER_HOST && !ahead) {
    s.inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) =>
    s[queue].push(() => {
      s.inFlight += 1;
      resolve();
    }),
  );
}

/**
 * Wikimedia's projects, which ask API clients for at most MAX_PER_HOST requests at a time. A
 * lookup's own API requests to them go out at once while fewer are open and wait first in line
 * otherwise; downloads keep their own pace. A word with a mark at its edge ("U.S.", "C++") looked
 * up beside its exact-title check on a slow cold start would otherwise have five or six open to
 * Wiktionary, and a dead connection's hung requests and their backups as many.
 */
function wikimediaHost(host: string): boolean {
  return /(^|\.)(wikipedia|wiktionary|wikidata|wikimedia|wikibooks|wikiquote|wikisource|wikiversity|wikivoyage|wikinews|mediawiki)\.org$/.test(host);
}

function releaseSlot(s: HostState): void {
  s.inFlight -= 1;
  while (s.inFlight < MAX_PER_HOST) {
    const next = s.now.shift() || s.first.shift() || s.later.shift();
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
      if (queued && !took) await takeSlot(s, slot === 'later' ? 'later' : 'first');
      else if (!took && api && wikimediaHost(host)) await takeSlot(s, 'now');
      else if (!took) s.inFlight += 1;
      onSend?.();
      const started = Date.now();
      // Past its round trip with no answer: one more sign that the whole connection may be silent.
      // A host not measured yet is given the connection's measured round trip when there is one.
      const expectedRto = rtoMs(host) || typicalRtoMs(true);
      const mark: Mark = { since: started, host, expected: expectedRto > 0 };
      const overdue = api ? setTimeout(() => noAnswer(mark, 'overdue'), Math.max(expectedRto, rtoMs(host) ? 0 : FIRST_HEDGE_MS)) : undefined;
      const long = api && !mark.expected ? setTimeout(() => noAnswer(mark, 'long'), COLD_SILENCE_MS) : undefined;
      if (api) waiting.add(mark);
      try {
        const value = await (inner[kind] as (u: string, o?: HttpRequestInit) => Promise<T>).call(inner, url, init);
        if (api) heard(host);
        if (api && !decided?.()) noteRoundTrip(host, Date.now() - started);
        return value;
      } catch (err) {
        if (api) {
          if (answered(err)) heard(host);
          else noAnswer(mark, Date.now() - started >= (init.timeoutMs ?? CLIENT_TIMEOUT_MS) - 100 ? 'timedOut' : 'refused');
        }
        if (api && !decided?.()) {
          if (answered(err)) noteRoundTrip(host, Date.now() - started);
          // No answer at all (a timeout, a refused or reset connection): the host's round trips
          // say nothing about it any more. Kept, an RTO that grew on a slow connection would go on
          // stretching every timeout and budget for that host to half a minute after the
          // connection died (a VPN dropping), since a silent host gives no new round trips. It
          // counts as not yet answered until it answers again. A request with a backup (decided is
          // set) is not over yet when one of its two fails; settle below forgets the host once
          // both have failed without an answer.
          else if (!decided) forgetHost(host);
        }
        throw err;
      } finally {
        clearTimeout(overdue);
        clearTimeout(long);
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
          if (api) forgetHost(host);
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
        void takeSlot(s, 'first').then(() => {
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
