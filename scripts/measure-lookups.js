/**
 * Measures whole lookups (DictionaryService.lookup in packages/core/src/dictionary.ts) on a normal
 * and on a slow network: how soon the first definitions show, whether the entry that settles is
 * the same, and how many requests each host had open at once. Not part of `npm test`; the first
 * run uses the network to record every response, later runs replay them.
 *
 * Run:
 *   node scripts/measure-lookups.js --profile normal --out normal.json
 *   node scripts/measure-lookups.js --profile slow --compare normal.json
 *
 * Options:
 *   --wordbook cet6     a shipped word book in packages/core/wordbooks (default cet6)
 *   --sample 40         that many words, evenly spaced through the book
 *   --also "etc.,e.g."  extra words, comma separated
 *   --profile normal    normal: every request 150 to 400 ms; slow: 1 to 3 s and 5% hang;
 *                       live: the network as it is, no replay
 *   --delay 1000-3000 --hang 0.05   override the profile's delay range and share of hangs
 *   --replay <dir>      saved responses (default: phevere-measure-lookups in the temp folder);
 *                       a URL not saved yet is fetched and saved, unless --offline is given
 *   --core <dir>        another copy of packages/core/src, such as one from an earlier commit
 *   --parallel 6        words at a time; each runs in a fresh copy of the module (a cold start)
 *   --settle 5000       a lookup counts as settled after this long without an update
 *   --out <file>        write every word's result as JSON
 *   --compare <file>    an earlier --out: count words whose settled entry differs from it
 *   --trace             keep every request of every word in --out
 *
 * Delays and hangs come from scripts/latency-http.js and are the same for every run with the
 * same seed (--seed), so before and after meet the same network.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');
const { withLatency, replayHttp, liveHttp } = require('./latency-http');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const profile = arg('profile', 'normal');
const PROFILES = { normal: { delay: [150, 400], hang: 0 }, slow: { delay: [1000, 3000], hang: 0.05 }, live: { delay: [0, 0], hang: 0 } };
if (!PROFILES[profile]) throw new Error(`--profile is one of ${Object.keys(PROFILES).join(', ')}`);
const delayArg = arg('delay', '');
const delay = delayArg ? delayArg.split('-').map(Number) : PROFILES[profile].delay;
const hang = Number(arg('hang', String(PROFILES[profile].hang)));
const seed = arg('seed', 'phevere');
const replayDir = arg('replay', path.join(os.tmpdir(), 'phevere-measure-lookups'));
const offline = args.includes('--offline');
const coreDir = path.resolve(arg('core', path.join(root, 'packages', 'core', 'src')));
const parallel = Math.max(1, Number(arg('parallel', '6')) || 6);
const settleMs = Number(arg('settle', '5000')) || 5000;
const outPath = arg('out', '');
const comparePath = arg('compare', '');

function readWords() {
  const book = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'core', 'wordbooks', `${arg('wordbook', 'cet6')}.json`), 'utf8'));
  const n = Math.max(1, Number(arg('sample', '40')) || 40);
  const step = book.words.length / n;
  const words = Array.from({ length: Math.min(n, book.words.length) }, (_, i) => book.words[Math.floor(i * step)]);
  const also = arg('also', '').split(',').map((w) => w.trim()).filter(Boolean);
  return Array.from(new Set([...words, ...also]));
}

const compiled = esbuild.buildSync({
  entryPoints: [path.join(coreDir, 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
  nodePaths: [path.join(root, 'node_modules')],
  external: ['cmu-pronouncing-dictionary'],
}).outputFiles[0].text;
const script = new vm.Script(compiled);

/** A fresh copy of @phevere/core, as after an app start with an empty lookup cache. */
function freshCore() {
  const mod = { exports: {} };
  const ctx = vm.createContext({
    module: mod,
    exports: mod.exports,
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    require: (name) => (name === 'cmu-pronouncing-dictionary' ? { dictionary: {} } : require(name)),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    Date,
    Error,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    Intl,
  });
  script.runInContext(ctx);
  return mod.exports;
}

const strip = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function realDefinitions(r) {
  return ((r && r.definitions) || []).filter(
    (d) => d && d.source !== 'Fallback' && d.source !== 'Timeout' && strip(d.meaning) && d.meaning !== 'No definition available.' && !/lookup timed out/i.test(d.meaning),
  );
}

/** What the reader sees as the entry: the headword, what it was a form of, and its senses. */
function entryOf(r) {
  const m = (r && r.metadata) || {};
  return {
    word: (r && r.word) || '',
    formFrom: m.formFrom || '',
    correctedFrom: m.correctedFrom || '',
    senses: realDefinitions(r).map((d) => strip(d.meaning)).sort(),
    suggestions: m.suggestions || [],
  };
}

async function lookupOne(word) {
  const core = freshCore();
  const replay = replayHttp({ dir: replayDir, live: offline ? null : liveHttp({ errorClass: core.DictionaryError }), errorClass: core.DictionaryError });
  const base = profile === 'live' ? liveHttp({ errorClass: core.DictionaryError }) : replay.http;
  if (profile === 'live') {
    base.requestJson = async (url, options) => {
      const res = await base.requestText(url, options);
      if (!res.ok) throw new core.DictionaryError(`HTTP ${res.status}`, `HTTP_${res.status}`, res.status === 429 || res.status >= 500);
      return JSON.parse(res.text);
    };
    base.requestBytes = async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' });
  }
  const net = withLatency(base, { delay, hang, seed, errorClass: core.DictionaryError });
  core.configureCore({ sha256Hex: (t) => t, http: net.http, lookupCache: { get: () => null, set: () => {} } });
  const service = new core.DictionaryService();
  const t0 = Date.now();
  let state = null;
  let firstDefs = 0;
  let lastChange = Date.now();
  const see = (r) => {
    state = r;
    lastChange = Date.now();
    if (!firstDefs && realDefinitions(r).length) firstDefs = Date.now() - t0;
  };
  let returned = 0;
  let returnedSenses = 0;
  let error = '';
  try {
    const result = await service.lookup(word, 'auto', service.getEnabledSources(), { onUpdate: see });
    returned = Date.now() - t0;
    returnedSenses = realDefinitions(result).length;
    see(result);
  } catch (e) {
    error = String((e && e.message) || e);
  }
  // Late pieces (other sources, the form check) keep arriving; the entry is what stays.
  while (Date.now() - lastChange < settleMs && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 250));
  return {
    word,
    firstDefsMs: firstDefs || null,
    returnedMs: returned,
    returnedSenses,
    settledMs: lastChange - t0,
    error,
    entry: entryOf(state),
    requests: net.stats.requests,
    hung: net.stats.hung,
    timedOut: net.stats.timedOut,
    notRecorded: replay.stats.missing,
    maxInFlight: net.maxInFlight,
    // --trace: every request with its start, duration and whether it hung.
    ...(args.includes('--trace') ? { log: net.log.map((r) => `${r.start}+${r.ms}${r.hung ? ' HUNG' : ''} #${r.attempt} ${r.url.slice(0, 150)}`) } : {}),
  };
}

function quantile(list, q) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
}

async function main() {
  const words = readWords();
  console.log(`${words.length} words, profile ${profile} (delay ${delay.join('-')} ms, hang ${hang}), core ${path.relative(root, coreDir) || coreDir}`);
  const rows = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(parallel, words.length) }, async () => {
      while (next < words.length) {
        const i = next;
        next += 1;
        rows[i] = await lookupOne(words[i]);
        if ((rows.filter(Boolean).length % 10) === 0) console.log(`  ${rows.filter(Boolean).length} done`);
      }
    }),
  );
  const withDefs = rows.filter((r) => r.entry.senses.length);
  const first = withDefs.map((r) => r.firstDefsMs).filter((x) => x != null);
  const maxHost = {};
  for (const r of rows) for (const [h, n] of Object.entries(r.maxInFlight)) maxHost[h] = Math.max(maxHost[h] || 0, n);
  const report = [
    `definitions: ${withDefs.length}/${rows.length} words settle with definitions; no definitions: ${rows.filter((r) => !r.entry.senses.length).map((r) => r.word).join(', ') || 'none'}`,
    `returned without definitions (the page says "No definitions found" until a later update): ${rows.filter((r) => !r.returnedSenses).map((r) => r.word).join(', ') || 'none'}`,
    `first definitions: median ${quantile(first, 0.5)} ms, p90 ${quantile(first, 0.9)} ms, max ${Math.max(0, ...first)} ms`,
    `lookup returned: median ${quantile(rows.map((r) => r.returnedMs), 0.5)} ms, p90 ${quantile(rows.map((r) => r.returnedMs), 0.9)} ms; settled: median ${quantile(rows.map((r) => r.settledMs), 0.5)} ms, p90 ${quantile(rows.map((r) => r.settledMs), 0.9)} ms`,
    `requests: ${rows.reduce((n, r) => n + r.requests, 0)} (${(rows.reduce((n, r) => n + r.requests, 0) / rows.length).toFixed(1)} a word), ${rows.reduce((n, r) => n + r.hung, 0)} hung, ${rows.reduce((n, r) => n + r.timedOut, 0)} timed out${offline ? `, ${rows.reduce((n, r) => n + r.notRecorded, 0)} not recorded (answered 404)` : ''}`,
    `most in flight at once per host: ${Object.entries(maxHost).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(', ')}`,
  ];
  const headwords = rows.filter((r) => r.entry.word !== r.word).map((r) => `${r.word} -> ${r.entry.word}`);
  if (headwords.length) report.push(`opened as another headword: ${headwords.join(', ')}`);
  if (comparePath) {
    const ref = JSON.parse(fs.readFileSync(comparePath, 'utf8')).rows;
    const differ = [];
    let same = 0;
    for (const r of rows) {
      const o = ref.find((x) => x.word === r.word);
      if (!o) continue;
      const a = JSON.stringify([o.entry.word, o.entry.formFrom, o.entry.senses]);
      const b = JSON.stringify([r.entry.word, r.entry.formFrom, r.entry.senses]);
      if (a === b) same += 1;
      else {
        const missing = o.entry.senses.filter((s) => !r.entry.senses.includes(s)).length;
        const extra = r.entry.senses.filter((s) => !o.entry.senses.includes(s)).length;
        differ.push(`${r.word} (${o.entry.word} ${o.entry.senses.length} senses -> ${r.entry.word} ${r.entry.senses.length}; ${missing} missing, ${extra} new)`);
      }
    }
    report.push(`same entry as ${path.basename(comparePath)}: ${same}/${rows.length}${differ.length ? `; differ: ${differ.join('; ')}` : ''}`);
  }
  console.log(report.join('\n'));
  if (outPath) fs.writeFileSync(outPath, JSON.stringify({ profile, delay, hang, report, rows }, null, 1));
  // The service keeps safety-net timers for lookups; they would hold the process open.
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
