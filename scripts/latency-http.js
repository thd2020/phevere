/**
 * HTTP clients for measuring and testing @phevere/core on a slow network. Used by
 * scripts/measure-lookups.js, scripts/measure-sense-images.js and scripts/test-slow-network.js.
 *
 * - `withLatency(inner, opts)` adds a delay to every request (a range such as 1000 to 3000 ms) and
 *   lets a share of requests hang. A hung request answers nothing and fails when the caller's
 *   `timeoutMs` runs out, as the desktop and phone clients do; a delay longer than `timeoutMs`
 *   fails the same way. Delays and hangs are drawn from a hash of the URL and of how many times
 *   that URL was asked for, so two versions of the code meet the same network: the first request
 *   for a URL that hangs hangs in both, and asking again is a fresh draw. It also counts the
 *   requests in flight to each host, so a run can report the most it had open at once.
 * - `replayHttp({ dir, live })` answers from responses saved in `dir` (one JSON file per URL) and
 *   asks `live` for anything not saved yet, saving its answer. Without `live` a missing URL is a 404.
 * - `liveHttp({ errorClass })` is Node's fetch with a timeout, failing like the phone's client.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** A number in [0, 1) from a string, the same on every run. */
function unit(text) {
  return crypto.createHash('sha1').update(text).digest().readUInt32BE(0) / 2 ** 32;
}

function makeError(errorClass, message, code, retryable) {
  if (errorClass) return new errorClass(message, code, retryable);
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * opts.delay: [min, max] in ms (default none); opts.hang: share of requests that hang (0 to 1);
 * opts.seed: changes the draws; opts.only: (url) => whether this request gets the delay at all;
 * opts.hangOnly: (url, attempt) => whether this request may hang; opts.defaultTimeoutMs: when the
 * caller gives none; opts.errorClass: DictionaryError, so failures look like the app's.
 */
function withLatency(inner, opts = {}) {
  const [min, max] = opts.delay || [0, 0];
  const hang = Number(opts.hang || 0);
  const seed = String(opts.seed || 'phevere');
  const asked = new Map();
  const inFlight = {};
  const maxInFlight = {};
  const stats = { requests: 0, hung: 0, timedOut: 0 };
  const log = [];
  const t0 = Date.now();

  const run = async (kind, url, options) => {
    const n = (asked.get(url) || 0) + 1;
    asked.set(url, n);
    const host = hostOf(url);
    const timeoutMs = options && options.timeoutMs != null ? options.timeoutMs : opts.defaultTimeoutMs || 8000;
    const slow = !opts.only || opts.only(url);
    const hangs = slow && hang > 0 && (!opts.hangOnly || opts.hangOnly(url, n)) && unit(`${seed}|hang|${url}|${n}`) < hang;
    const delay = slow ? min + unit(`${seed}|delay|${url}|${n}`) * (max - min) : 0;
    stats.requests += 1;
    inFlight[host] = (inFlight[host] || 0) + 1;
    maxInFlight[host] = Math.max(maxInFlight[host] || 0, inFlight[host]);
    const started = Date.now();
    const entry = { host, url, start: started - t0, attempt: n, hung: hangs };
    log.push(entry);
    try {
      if (hangs || delay >= timeoutMs) {
        if (hangs) stats.hung += 1;
        await new Promise((r) => setTimeout(r, timeoutMs));
        stats.timedOut += 1;
        throw makeError(opts.errorClass, `Request failed: timed out after ${timeoutMs}ms`, 'NETWORK_ERROR', true);
      }
      await new Promise((r) => setTimeout(r, delay));
      return await inner[kind](url, options);
    } finally {
      entry.ms = Date.now() - started;
      inFlight[host] -= 1;
    }
  };

  return {
    http: {
      requestJson: (url, options) => run('requestJson', url, options),
      requestText: (url, options) => run('requestText', url, options),
      requestBytes: (url, options) => run('requestBytes', url, options),
    },
    stats,
    maxInFlight,
    log,
  };
}

function cacheFile(dir, url, options) {
  const key = `${(options && options.method) || 'GET'} ${url} ${(options && options.body) || ''}`;
  return path.join(dir, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);
}

/** Responses saved in `dir`; `live` answers (and is saved) when a URL is not there yet. */
function replayHttp({ dir, live, errorClass }) {
  fs.mkdirSync(dir, { recursive: true });
  const stats = { replayed: 0, fetched: 0, missing: 0 };
  const text = async (url, options) => {
    const file = cacheFile(dir, url, options);
    if (fs.existsSync(file)) {
      stats.replayed += 1;
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.error) throw makeError(errorClass, saved.error, saved.code || 'NETWORK_ERROR', true);
      return { ok: saved.status >= 200 && saved.status < 300, status: saved.status, text: saved.text };
    }
    if (!live) {
      stats.missing += 1;
      return { ok: false, status: 404, text: '' };
    }
    stats.fetched += 1;
    try {
      const res = await live.requestText(url, options);
      fs.writeFileSync(file, JSON.stringify({ url, status: res.status, text: res.text }));
      return res;
    } catch (e) {
      // A request that failed is saved as failed, so the replay meets the same failure.
      fs.writeFileSync(file, JSON.stringify({ url, error: String((e && e.message) || e), code: (e && e.code) || 'NETWORK_ERROR' }));
      throw e;
    }
  };
  return {
    http: {
      requestText: text,
      async requestJson(url, options) {
        const res = await text(url, options);
        if (!res.ok) throw makeError(errorClass, `HTTP ${res.status}`, `HTTP_${res.status}`, res.status === 429 || res.status >= 500);
        try {
          return JSON.parse(res.text);
        } catch {
          throw makeError(errorClass, 'Invalid JSON', 'PARSE_ERROR', false);
        }
      },
      async requestBytes() {
        return { ok: false, status: 404, bytes: new Uint8Array(), contentType: '' };
      },
    },
    stats,
  };
}

const UA = 'Phevere-measure/1 (https://github.com/thd2020/phevere)';

/**
 * Node's fetch; failures are NETWORK_ERROR, as on the phone. `timeoutMs` (default 20 s) replaces
 * the caller's, so a recording keeps the answer even when the code would have given up sooner.
 */
function liveHttp({ errorClass, timeoutMs = 20000 } = {}) {
  return {
    async requestText(url, options) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: (options && options.method) || 'GET',
          headers: { 'User-Agent': UA, ...((options && options.headers) || {}) },
          body: options && options.body,
          signal: ctl.signal,
        });
        return { ok: res.ok, status: res.status, text: await res.text() };
      } catch (e) {
        throw makeError(errorClass, `Request failed: ${(e && e.message) || e}`, 'NETWORK_ERROR', true);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { withLatency, replayHttp, liveHttp, hostOf };
