/**
 * Measures how many words and senses get a picture from packages/core/src/sense-images.ts, and
 * how long the pictures take. Uses the network (Wikimedia), so it is not part of `npm test`.
 *
 * Run:
 *   node scripts/measure-sense-images.js --db <notebook.sqlite> [--limit 100] [--out result.json]
 *   node scripts/measure-sense-images.js --words words.txt [--mode cards|lookup|both] [--parallel 1] [--app] [--gap 2500] [--client node] [--trace]
 *   node scripts/measure-sense-images.js --relevance scripts/fixtures/sense-images-relevance.json --senses 60
 *   node scripts/measure-sense-images.js --words words.txt --mode lookup --replay <dir> [--offline] [--delay 1000-3000] [--hang 0.05]
 *
 * `--replay` saves every response in a folder and answers from it on later runs; `--delay` and
 * `--hang` put a slow network in front (scripts/latency-http.js), the same for every run.
 * `--db` reads the lemma, language and saved definition of every word in the `vocab` table; the
 * file is read into memory and never written. `--words` reads one word per line, optionally
 * followed by a tab and the language code. Two passes run for each word:
 *
 * - Cards: `fetchWordImage(lemma, { gloss })` with the first saved definition line, which is what
 *   a card in Words asks for.
 * - Lookup: `fetchSenseImages(lemma, senses)` with the senses Wiktionary's REST definition API
 *   gives (the lookup's main English source), the first 12 (`--senses` changes it), which is
 *   what the definition list asks for.
 *
 * Wiktionary senses are kept in `--cache` (default: the system temp folder) so a second run asks
 * only for pictures. Each pass loads the module fresh with an empty persistent store, so every
 * word starts cold, and the time until its pictures are chosen is measured. Then the same words
 * run again in a new module against the filled persistent store (a warm start after a restart).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const { withLatency, replayHttp } = require('./latency-http');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const dbPath = arg('db', '');
const wordsPath = arg('words', '');
const limit = Number(arg('limit', '0')) || 0;
const outPath = arg('out', '');
const cacheDir = arg('cache', path.join(os.tmpdir(), 'phevere-measure-sense-images'));
const parallel = Math.max(1, Number(arg('parallel', '3')) || 3);
const relevancePath = arg('relevance', '');
const mode = relevancePath ? 'lookup' : arg('mode', 'both');
const appMode = args.includes('--app');
const gapMs = Math.max(0, Number(arg('gap', '0')) || 0);
const maxSenses = Math.max(1, Number(arg('senses', '12')) || 12);
fs.mkdirSync(cacheDir, { recursive: true });

const UA = 'Phevere-measure/1 (https://github.com/thd2020/phevere)';
let requests = 0;
let failed = 0;
const hosts = {};

// Wikimedia allows 200 requests a minute to a named client; pace the whole run below that.
const PER_MINUTE = 180;
const stamps = [];
async function pace() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > 60000) stamps.shift();
    if (stamps.length < PER_MINUTE) {
      stamps.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, 60000 - (now - stamps[0]) + 5));
  }
}

/**
 * `--client` picks the HTTP client: `fetch` (Node's own, which drops an idle connection after
 * four seconds), `phone` (pooled for five minutes with HTTP/2, like the Android app's OkHttp),
 * `node` (node-fetch with keep-alive agents, the desktop app's client) or `node18` (node-fetch
 * opening a new connection for every request, as the desktop app did on Electron 28's Node 18
 * before its agents kept connections open).
 */
const clientName = arg('client', 'fetch');
const clientFetch = (() => {
  if (clientName === 'fetch') return fetch;
  // `phone`: like the Android app's OkHttp, idle connections stay pooled for five minutes and
  // HTTP/2 is used where offered. Node's own fetch drops an idle connection after four seconds.
  if (clientName === 'phone') {
    const undici = require('undici');
    const dispatcher = new undici.Agent({ keepAliveTimeout: 300000, keepAliveMaxTimeout: 300000, allowH2: true });
    return (url, init) => undici.fetch(url, { ...init, dispatcher });
  }
  const nodeFetch = require('node-fetch');
  const https = require('https');
  const agent = new https.Agent({ keepAlive: clientName === 'node' });
  return (url, init) => nodeFetch(url, { ...init, agent });
})();

/**
 * What a request asks for, for `--trace`: the host and the API module ("wikidata sparql
 * lexemes", "en.wikipedia.org prop=pageimages|pageprops", "www.wikidata.org wbgetentities").
 */
function requestKind(url) {
  const u = new URL(url);
  const host = u.host.replace(/^query\.wikidata\.org$/, 'wdqs');
  if (host === 'wdqs') return `wdqs ${/ontolex/.test(u.searchParams.get('query') || '') ? 'lexemes' : 'items'}`;
  const p = u.searchParams;
  const what = p.get('action') === 'query' ? p.get('generator') ? `generator=${p.get('generator')}` : `prop=${p.get('prop') || p.get('list')}` : p.get('action') || u.pathname;
  return `${host} ${what}`;
}

/** Durations of every request by kind, and each word's requests in order, when `--trace` is on. */
const trace = args.includes('--trace');
const byKind = {};
let traceLog = null;

async function get(url, headers, timeoutMs = 8000) {
  const host = new URL(url).host;
  if (/wikimedia|wikipedia|wiktionary|wikidata/.test(host)) await pace();
  requests += 1;
  hosts[host] = (hosts[host] || 0) + 1;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  const note = () => {
    if (!trace) return;
    const kind = requestKind(url);
    (byKind[kind] = byKind[kind] || []).push(Date.now() - t0);
    if (traceLog) traceLog.push({ kind, start: t0 - traceLog.t0, ms: Date.now() - t0 });
  };
  try {
    const res = await clientFetch(url, { headers: { 'User-Agent': UA, ...(headers || {}) }, signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) failed += 1;
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    failed += 1;
    throw e;
  } finally {
    note();
    clearTimeout(timer);
  }
}

const liveClient = {
  async requestJson(url, options) {
    const res = await get(url, options && options.headers, options && options.timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(res.text);
  },
  requestText: (url, options) => get(url, options && options.headers, options && options.timeoutMs),
  async requestBytes() {
    throw new Error('not used');
  },
};

/**
 * `--replay <dir>` answers from responses saved there and fetches (and saves) the rest, so runs
 * before and after a change see the same answers; `--offline` answers a URL not saved with 404.
 * `--delay 1000-3000` adds that much to every request and `--hang 0.05` lets that share of
 * requests hang until their timeout (scripts/latency-http.js), as on a slow connection.
 */
const replayDir = arg('replay', '');
const delayArg = arg('delay', '');
const hangShare = Number(arg('hang', '0')) || 0;
const replayed = replayDir
  ? replayHttp({ dir: replayDir, live: args.includes('--offline') ? null : { requestText: (url, o) => get(url, o && o.headers, 20000) } })
  : null;
const slowNet =
  delayArg || hangShare
    ? withLatency(replayed ? replayed.http : liveClient, { delay: delayArg ? delayArg.split('-').map(Number) : [0, 0], hang: hangShare, seed: arg('seed', 'phevere') })
    : null;
const http = slowNet ? slowNet.http : replayed ? replayed.http : liveClient;

// `--module` measures another copy of the module, such as the one from an earlier commit.
const modulePath = arg('module', path.join(root, 'packages', 'core', 'src', 'sense-images.ts'));
const src = fs.readFileSync(modulePath, 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

/** net.ts next to the measured module (a module from before it existed does not ask for it). */
function loadNet() {
  const file = path.join(path.dirname(modulePath), 'net.ts');
  if (!fs.existsSync(file)) return {};
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(out, { module: mod, exports: mod.exports, require, setTimeout, clearTimeout });
  return mod.exports;
}

function load(store) {
  const mod = { exports: {} };
  const runtime = { isCoreConfigured: () => true, getHttp: () => http, getLookupCache: () => store };
  const net = loadNet();
  const req = (name) => {
    if (name === './runtime') return runtime;
    if (name === './http') return {};
    if (name === './net') return net;
    return require(name);
  };
  vm.runInNewContext(js, {
    module: mod,
    exports: mod.exports,
    require: req,
    Intl,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    URLSearchParams,
    console,
    fetch,
  });
  return mod.exports;
}

function memoryStore() {
  const m = new Map();
  return {
    get: (k) => m.get(k) || null,
    set: (k, value, savedAt) => void m.set(k, JSON.parse(JSON.stringify({ value, savedAt }))),
  };
}

async function readWords() {
  if (relevancePath) {
    const fx = JSON.parse(fs.readFileSync(relevancePath, 'utf8'));
    return Array.from(new Set(fx.pairs.map((p) => p.word))).map((lemma) => ({ lemma, lang: 'en', gloss: '', pos: '' }));
  }
  if (dbPath) {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const res = db.exec('SELECT lemma, source_lang, definition, part_of_speech FROM vocab ORDER BY lemma COLLATE NOCASE');
    db.close();
    return (res[0] ? res[0].values : []).map(([lemma, lang, def, pos]) => ({
      lemma: String(lemma || '').trim(),
      lang: String(lang || 'en'),
      gloss: String(def || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '',
      pos: String(pos || ''),
    }));
  }
  if (wordsPath) {
    return fs
      .readFileSync(wordsPath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [lemma, lang] = l.split('\t');
        return { lemma, lang: lang || 'en', gloss: '', pos: '' };
      });
  }
  throw new Error('pass --db <sqlite> or --words <file>');
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Wiktionary REST senses, the way the lookup reads them; cached on disk. */
async function wiktionarySenses(word) {
  const file = path.join(cacheDir, `senses-${encodeURIComponent(word.lemma).replace(/%/g, '_')}-${word.lang}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let senses = [];
  try {
    const res = await get(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word.lemma)}`);
    if (res.ok) {
      const data = JSON.parse(res.text);
      const list = data[word.lang] || data.en || [];
      for (const entry of list) {
        for (const d of entry.definitions || []) {
          if (stripHtml(d.definition)) senses.push({ meaning: d.definition, partOfSpeech: String(entry.partOfSpeech || '').toLowerCase() });
        }
      }
    }
  } catch {
    senses = null;
  }
  if (senses === null) return [];
  // The lookup also merges other sources; when Wiktionary has nothing, the saved definition stands in.
  if (!senses.length && word.gloss) senses = [{ meaning: word.gloss, partOfSpeech: word.pos || 'noun' }];
  fs.writeFileSync(file, JSON.stringify(senses));
  return senses;
}

/**
 * Major senses: the module's own choice (`majorSenseIndexes`), or for a module without it, the
 * first sense of each part of speech plus any later sense that shares no content word with an
 * earlier one of the same part of speech among the first six.
 */
function majorSenses(senses, si, lemma) {
  if (si && si.majorSenseIndexes) return Array.from(si.majorSenseIndexes(senses, lemma, 4));
  const out = [];
  const seenPos = new Map();
  const tokens = (s) => new Set((stripHtml(s).toLowerCase().match(/[a-z]{4,}/g) || []));
  senses.slice(0, maxSenses).forEach((s, i) => {
    const pos = s.partOfSpeech || '';
    const t = tokens(s.meaning);
    const prev = seenPos.get(pos);
    if (!prev) {
      seenPos.set(pos, [t]);
      out.push(i);
      return;
    }
    if (prev.length >= 3) return;
    const shares = prev.some((p) => [...t].some((w) => p.has(w)));
    if (!shares) out.push(i);
    prev.push(t);
  });
  return out;
}

/** The Commons file name of a chosen picture. */
function fileOf(img) {
  try {
    return decodeURIComponent(String(img.pageUrl || '').split('/File:')[1] || '').replace(/_/g, ' ');
  } catch {
    return '';
  }
}

/**
 * Precision and coverage on the hand-labelled pairs: a picture on a pair's sense is right when
 * the pair lists its file as right, wrong when it lists it as wrong or marks the sense as having
 * no fitting picture (`none`), and unlabelled otherwise (label it and add it to the fixture).
 * Coverage counts pairs with a known right picture that got one.
 */
function relevanceReport(rows, fx) {
  let right = 0;
  let wrong = 0;
  let empty = 0;
  let coverable = 0;
  const missing = [];
  const unlabelled = [];
  const wrongs = [];
  const mustFail = [];
  let must = 0;
  for (const pair of fx.pairs) {
    if (pair.must) must += 1;
    const row = rows.find((r) => r.lemma === pair.word);
    const sense = row && (row.senses || []).find((s) => s.meaning.startsWith(pair.sense));
    if (pair.right.length) coverable += 1;
    if (!sense) {
      missing.push(`${pair.word} "${pair.sense}"`);
      if (pair.must) mustFail.push(`${pair.word} "${pair.sense}" (sense missing)`);
      continue;
    }
    if (pair.mustNone) must += 1;
    if (!sense.image) {
      empty += 1;
      if (pair.must) mustFail.push(`${pair.word} "${pair.sense}" (none)`);
      continue;
    }
    if (pair.mustNone && !pair.right.includes(sense.image.file)) mustFail.push(`${pair.word} "${pair.sense}" should show none -> ${sense.image.file}`);
    const file = sense.image.file;
    if (pair.must && !pair.right.includes(file)) mustFail.push(`${pair.word} "${pair.sense}" -> ${file}`);
    if (pair.right.includes(file)) right += 1;
    else if (pair.wrong.includes(file) || pair.none) {
      wrong += 1;
      wrongs.push(`${pair.word} "${pair.sense}" -> ${file}`);
    } else unlabelled.push(`${pair.word} "${pair.sense}" -> ${file}`);
  }
  // Pictures on senses of fixture words that no pair labels count against precision too.
  const offFixture = [];
  for (const word of new Set(fx.pairs.map((p) => p.word))) {
    const row = rows.find((r) => r.lemma === word);
    for (const s of (row && row.senses) || []) {
      if (!s.image || fx.pairs.some((p) => p.word === word && s.meaning.startsWith(p.sense))) continue;
      offFixture.push(`${word} "${s.meaning.slice(0, 50)}" -> ${s.image.file}`);
    }
  }
  const shown = right + wrong + unlabelled.length + offFixture.length;
  const lines = [
    `relevance: ${fx.pairs.length} labelled pairs; ${shown} pictures shown on fixture words: right ${right}, wrong ${wrong}, unlabelled ${unlabelled.length}, on senses no pair covers ${offFixture.length}; precision ${pct(right, shown)} (anything not labelled right counts as wrong); coverage ${right}/${coverable} pairs with a known right picture (${pct(right, coverable)}); ${empty} pairs without a picture`,
  ];
  lines.push(`must-pass: ${must - mustFail.length}/${must}${mustFail.length ? `; failing: ${mustFail.join('; ')}` : ''}`);
  if (wrongs.length) lines.push(`wrong: ${wrongs.join('; ')}`);
  if (unlabelled.length) lines.push(`unlabelled: ${unlabelled.join('; ')}`);
  if (offFixture.length) lines.push(`on senses no pair covers: ${offFixture.join('; ')}`);
  if (missing.length) lines.push(`senses not in the lookup: ${missing.join('; ')}`);
  return lines;
}

function pct(n, d) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : '-';
}

function quantile(list, q) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        await fn(items[i], i);
      }
    }),
  );
}

async function main() {
  let words = (await readWords()).filter((w) => w.lemma);
  if (limit) words = words.slice(0, limit);
  console.log(`${words.length} words`);

  const sensesOf = new Map();
  if (mode !== 'cards') {
    await pool(words, 4, async (w) => sensesOf.set(w, await wiktionarySenses(w)));
  }
  const startRequests = requests;
  const startFailed = failed;
  const store = memoryStore();
  const rows = [];

  const run = async (warm, which) => {
    // One module for each pass, as in the app; each word is still cold in it the first time.
    const si = load(store);
    const times = { cards: [], cardFirst: [], lookup: [], lookupAll: [], pictured: [], picturedAll: [], defs: [], afterDefs: [] };
    await pool(words, parallel, async (w, i) => {
      const row = rows[i] || (rows[i] = { lemma: w.lemma, lang: w.lang });
      if (which === 'cards') {
        const t0 = Date.now();
        // A card shows its picture as soon as the first source finds it (`onUpdate`).
        let first = 0;
        const onUpdate = (pic) => {
          if (pic && !first) first = Date.now() - t0;
        };
        const img = await si.fetchWordImage(w.lemma, { lang: w.lang, gloss: w.gloss || undefined, onUpdate });
        times.cards.push(Date.now() - t0);
        if (img) times.cardFirst.push(first || Date.now() - t0);
        if (!warm) row.card = img ? { title: img.title, thumb: img.thumb, credit: img.credit } : null;
      }
      if (which === 'lookup') {
        const senses = sensesOf.get(w) || [];
        const list = senses.slice(0, maxSenses);
        if (!list.length) {
          if (!warm) row.senses = [];
          return;
        }
        const t0 = Date.now();
        // With one word at a time the requests in the log are this word's own.
        if (trace && parallel === 1 && !warm) {
          traceLog = [];
          traceLog.t0 = t0;
        }
        let first = 0;
        // A module with progressive results reports its first pictures early (`onUpdate`).
        const onUpdate = () => {
          if (!first) first = Date.now() - t0;
        };
        // `--app` times a lookup as the app runs it: pictures start when the word is submitted,
        // the definitions are fetched meanwhile, and the senses are handed over when they arrive.
        let defs = 0;
        if (appMode && si.prefetchSenseImages) {
          si.prefetchSenseImages(w.lemma, { lang: w.lang });
          await http.requestText(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w.lemma)}`, { timeoutMs: 8000 }).catch(() => null);
          defs = Date.now() - t0;
        }
        const images = await si.fetchSenseImages(w.lemma, list, { lang: w.lang, onUpdate });
        const all = Date.now() - t0;
        if (!first) first = all;
        times.lookup.push(first);
        times.lookupAll.push(all);
        if (images.some(Boolean)) {
          times.pictured.push(first);
          times.picturedAll.push(all);
          if (appMode) times.afterDefs.push(Math.max(0, first - defs));
        }
        if (appMode) times.defs.push(defs);
        // The first dozen words, and any word whose pictures took four seconds or more.
        if (traceLog && (i < 12 || all >= 4000)) {
          console.log(`  ${w.lemma}: first ${first} ms, all ${all} ms; ${traceLog.map((r) => `${r.kind} @${r.start}+${r.ms}`).join(', ')}`);
        }
        traceLog = null;
        if (!warm) Object.assign(row, { firstMs: first, allMs: all, defsMs: defs });
        if (!warm) {
          const major = majorSenses(list, si, w.lemma);
          row.senses = list.map((s, k) => ({
            pos: s.partOfSpeech,
            meaning: stripHtml(s.meaning).slice(0, 120),
            major: major.includes(k),
            image: images[k] ? { title: images[k].title, thumb: images[k].thumb, credit: images[k].credit, pageUrl: images[k].pageUrl, file: fileOf(images[k]) } : null,
          }));
        }
      }
      if (!warm && (i + 1) % 50 === 0) console.log(`  ${i + 1} words, ${requests - startRequests} requests`);
      // `--gap` waits between words, so the run stays under the request rate without the pacing
      // above holding up a word that is being timed.
      if (gapMs && !warm) await new Promise((r) => setTimeout(r, gapMs));
    });
    return times;
  };

  // Cards and lookup each get their own cold module, so one does not warm the other.
  const passes = mode === 'both' ? ['cards', 'lookup'] : [mode];
  const cold = { cards: [], cardFirst: [], lookup: [], lookupAll: [], pictured: [], picturedAll: [], defs: [], afterDefs: [] };
  const warm = { cards: [], lookup: [], lookupAll: [] };
  const t0 = Date.now();
  for (const p of passes) {
    const t = await run(false, p);
    cold[p] = t[p];
    if (p === 'cards') cold.cardFirst = t.cardFirst;
    if (p === 'lookup') Object.assign(cold, { lookupAll: t.lookupAll, pictured: t.pictured, picturedAll: t.picturedAll, defs: t.defs, afterDefs: t.afterDefs });
  }
  const coldWall = Date.now() - t0;
  const coldRequests = requests - startRequests;
  const coldFailed = failed - startFailed;
  const r1 = requests;
  for (const p of passes) warm[p] = (await run(true, p))[p];

  const report = [];
  report.push(`words: ${words.length}; cold pass ${Math.round(coldWall / 1000)} s wall, ${coldRequests} requests (${(coldRequests / words.length).toFixed(1)} a word), ${coldFailed} failed; hosts ${JSON.stringify(hosts)}`);
  if (mode !== 'lookup') {
    const withCard = rows.filter((r) => r.card).length;
    report.push(`cards: ${withCard}/${words.length} words have a picture (${pct(withCard, words.length)})`);
    report.push(`cards time, cold: median ${quantile(cold.cards, 0.5)} ms, p90 ${quantile(cold.cards, 0.9)} ms; warm (persistent store): median ${quantile(warm.cards, 0.5)} ms, p90 ${quantile(warm.cards, 0.9)} ms`);
    report.push(`cards with a picture (${cold.cardFirst.length}), cold, until the picture is chosen: median ${quantile(cold.cardFirst, 0.5)} ms, p90 ${quantile(cold.cardFirst, 0.9)} ms`);
  }
  if (mode !== 'cards') {
    const looked = rows.filter((r) => r.senses && r.senses.length);
    const anyPic = looked.filter((r) => r.senses.some((s) => s.image)).length;
    const senses = looked.reduce((n, r) => n + r.senses.length, 0);
    const pics = looked.reduce((n, r) => n + r.senses.filter((s) => s.image).length, 0);
    const major = looked.reduce((n, r) => n + r.senses.filter((s) => s.major).length, 0);
    const majorPics = looked.reduce((n, r) => n + r.senses.filter((s) => s.major && s.image).length, 0);
    const multi = looked.filter((r) => r.senses.filter((s) => s.major).length > 1);
    const multiAll = multi.filter((r) => r.senses.filter((s) => s.major).every((s) => s.image)).length;
    report.push(`lookup: ${anyPic}/${looked.length} words with senses have a picture (${pct(anyPic, looked.length)}); ${words.length - looked.length} words had no Wiktionary senses`);
    report.push(`lookup senses: ${pics}/${senses} senses pictured (${pct(pics, senses)}); major senses ${majorPics}/${major} (${pct(majorPics, major)}); words with several major senses, all pictured: ${multiAll}/${multi.length}`);
    report.push(`lookup time to first picture, cold: median ${quantile(cold.lookup, 0.5)} ms, p90 ${quantile(cold.lookup, 0.9)} ms; all pictures: median ${quantile(cold.lookupAll, 0.5)} ms, p90 ${quantile(cold.lookupAll, 0.9)} ms; warm: median ${quantile(warm.lookup, 0.5)} ms, p90 ${quantile(warm.lookup, 0.9)} ms`);
    report.push(`words that show a picture (${cold.pictured.length}), cold, from ${appMode ? 'submitting the word' : 'asking with the senses'}: first picture median ${quantile(cold.pictured, 0.5)} ms, p90 ${quantile(cold.pictured, 0.9)} ms; every picture median ${quantile(cold.picturedAll, 0.5)} ms, p90 ${quantile(cold.picturedAll, 0.9)} ms`);
    if (appMode) report.push(`definitions arrived after median ${quantile(cold.defs, 0.5)} ms; first picture after the definitions: median ${quantile(cold.afterDefs, 0.5)} ms, p90 ${quantile(cold.afterDefs, 0.9)} ms`);
  }
  report.push(`warm pass made ${requests - r1} requests`);
  if (replayed) report.push(`replay: ${replayed.stats.replayed} answered from ${replayDir}, ${replayed.stats.fetched} fetched, ${replayed.stats.missing} not saved (404)`);
  if (slowNet) {
    report.push(`slow network: ${slowNet.stats.requests} requests, ${slowNet.stats.hung} hung, ${slowNet.stats.timedOut} timed out; most in flight at once per host: ${Object.entries(slowNet.maxInFlight).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(', ')}`);
  }
  if (trace) {
    for (const [kind, list] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
      report.push(`request ${kind}: ${list.length}, median ${quantile(list, 0.5)} ms, p90 ${quantile(list, 0.9)} ms, max ${Math.max(...list)} ms`);
    }
  }
  const missingCards = rows.filter((r) => mode !== 'lookup' && !r.card).map((r) => r.lemma);
  const missingLookup = rows.filter((r) => r.senses && r.senses.length && !r.senses.some((s) => s.image)).map((r) => r.lemma);
  if (missingCards.length) report.push(`no card picture (${missingCards.length}): ${missingCards.slice(0, 80).join(', ')}`);
  if (missingLookup.length) report.push(`no lookup picture (${missingLookup.length}): ${missingLookup.slice(0, 80).join(', ')}`);
  if (relevancePath) report.push(...relevanceReport(rows, JSON.parse(fs.readFileSync(relevancePath, 'utf8'))));
  console.log(report.join('\n'));
  if (outPath) fs.writeFileSync(outPath, JSON.stringify({ report, rows }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
