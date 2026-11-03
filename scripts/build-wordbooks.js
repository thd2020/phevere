/**
 * Builds the word books in packages/core/wordbooks/ from their published sources.
 *
 * Each book becomes one JSON file holding its metadata and its headwords in order, and
 * catalog.json lists every book without the words, so the app can show the library without
 * loading them. docs/WORDBOOKS.md explains why these sources and not others.
 *
 * Sources (retrieved 2026-11-03):
 *   - NGSL 1.2, NAWL 1.2, TSL 1.2 and BSL 1.20 from newgeneralservicelist.com, CC BY-SA 4.0
 *     (Browne, Culligan and Phillips).
 *   - ECDICT by Linwei (skywind3000), MIT. Its `tag` column marks the words of the 中考, 高考,
 *     CET-4, CET-6 and 考研 syllabi; only the headwords and the tag are used.
 *
 * Run:
 *   node scripts/build-wordbooks.js                  # downloads into the OS temp folder
 *   node scripts/build-wordbooks.js --cache <dir>    # reuse or keep downloads in <dir>
 *
 * Raw downloads stay in the cache folder and never enter the repository (ecdict.csv is 66 MB).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'packages', 'core', 'wordbooks');
const cacheArg = process.argv.indexOf('--cache');
const CACHE = cacheArg >= 0 ? path.resolve(process.argv[cacheArg + 1]) : path.join(os.tmpdir(), 'phevere-wordbooks');
const RETRIEVED = '2026-11-03';

const NGSL_BASE = 'https://www.newgeneralservicelist.com/s/';
const ECDICT_URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv';
const CC = { licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
const MIT = { licence: 'MIT', licenceUrl: 'https://github.com/skywind3000/ECDICT/blob/master/LICENSE' };

/**
 * The books, in learning-path order. `level` is the rung on the path; `from` says how the words
 * are taken from the downloaded file.
 */
const BOOKS = [
  {
    id: 'starter',
    title: 'Starter 1000',
    short: 'Starter',
    level: 'Primary school',
    from: { file: 'NGSL_12_stats.csv', kind: 'ngsl', first: 1000 },
    source: 'New General Service List 1.2, ranks 1 to 1000 (Browne, Culligan and Phillips 2013)',
    sourceUrl: 'https://www.newgeneralservicelist.com/new-general-service-list',
    order: 'frequency',
    ...CC,
  },
  {
    id: 'zhongkao',
    title: 'Junior high 中考',
    short: '中考',
    level: 'Junior high school',
    from: { kind: 'ecdict', tag: 'zk' },
    source: 'ECDICT words tagged zk (中考 syllabus)',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    order: 'frequency',
    ...MIT,
  },
  {
    id: 'gaokao',
    title: 'Senior high 高考',
    short: '高考',
    level: 'Senior high school',
    from: { kind: 'ecdict', tag: 'gk' },
    source: 'ECDICT words tagged gk (高考 syllabus)',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    order: 'frequency',
    ...MIT,
  },
  {
    id: 'cet4',
    title: 'CET-4 四级',
    short: 'CET-4',
    level: 'University',
    from: { kind: 'ecdict', tag: 'cet4' },
    source: 'ECDICT words tagged cet4 (College English Test band 4 syllabus)',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    order: 'frequency',
    ...MIT,
  },
  {
    id: 'cet6',
    title: 'CET-6 六级',
    short: 'CET-6',
    level: 'University',
    from: { kind: 'ecdict', tag: 'cet6' },
    source: 'ECDICT words tagged cet6 (College English Test band 6 syllabus)',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    order: 'frequency',
    ...MIT,
  },
  {
    id: 'kaoyan',
    title: 'Postgraduate 考研',
    short: '考研',
    level: 'Postgraduate entrance',
    from: { kind: 'ecdict', tag: 'ky' },
    source: 'ECDICT words tagged ky (考研 English syllabus)',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    order: 'frequency',
    ...MIT,
  },
  {
    id: 'ngsl',
    title: 'General English 2800',
    short: 'NGSL',
    level: 'Study abroad',
    from: { file: 'NGSL_12_stats.csv', kind: 'ngsl' },
    source: 'New General Service List 1.2 (Browne, Culligan and Phillips 2013)',
    sourceUrl: 'https://www.newgeneralservicelist.com/new-general-service-list',
    order: 'frequency',
    ...CC,
  },
  {
    id: 'nawl',
    title: 'Academic English 960',
    short: 'NAWL',
    level: 'Study abroad',
    from: { file: 'NAWL_12_lemmatized_for_teaching.csv', kind: 'nawl' },
    source: 'New Academic Word List 1.2 (Browne, Culligan and Phillips 2013)',
    sourceUrl: 'https://www.newgeneralservicelist.com/new-academic-word-list',
    order: 'alphabetical',
    ...CC,
  },
  {
    id: 'tsl',
    title: 'TOEIC 1250',
    short: 'TOEIC',
    level: 'Work',
    from: { file: 'TSL_12_stats.csv', kind: 'ngsl' },
    source: 'TOEIC Service List 1.2 (Browne and Culligan 2016)',
    sourceUrl: 'https://www.newgeneralservicelist.com/toeic-service-list',
    order: 'frequency',
    ...CC,
  },
  {
    id: 'bsl',
    title: 'Business English 1700',
    short: 'Business',
    level: 'Work',
    from: { file: 'BSL_120_stats.csv', kind: 'ngsl' },
    source: 'Business Service List 1.20 (Browne and Culligan 2016)',
    sourceUrl: 'https://www.newgeneralservicelist.com/business-service-list',
    order: 'frequency',
    ...CC,
  },
];

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'phevere-build-wordbooks' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`${url}: HTTP ${res.statusCode}`));
          return;
        }
        const tmp = `${dest}.part`;
        const out = fs.createWriteStream(tmp);
        res.pipe(out);
        out.on('finish', () => out.close(() => (fs.renameSync(tmp, dest), resolve(dest))));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

async function cached(name, url) {
  fs.mkdirSync(CACHE, { recursive: true });
  const dest = path.join(CACHE, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  console.log(`downloading ${url}`);
  return download(url, dest);
}

/** RFC 4180 rows; quoted fields may hold commas, quotes and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A headword a learner would type: letters, with inner hyphens, apostrophes or spaces. */
const HEADWORD = /^[A-Za-z][A-Za-z' -]*[A-Za-z]$|^[A-Za-z]$/;

function uniqueWords(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const w = String(raw || '').trim();
    const key = w.toLowerCase();
    if (!w || !HEADWORD.test(w) || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** NGSL-family stats files: a header row, then the word and its rank in the first two columns. */
function ngslWords(file, first) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8')).slice(1);
  const ranked = rows
    .filter((r) => r[0] && Number(r[1]) > 0)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((r) => r[0]);
  const words = uniqueWords(ranked);
  return first ? words.slice(0, first) : words;
}

/** NAWL for teaching: one family per row, headword first, alphabetical as published. */
function nawlWords(file) {
  return uniqueWords(parseCsv(fs.readFileSync(file, 'utf8')).map((r) => r[0]));
}

/**
 * ECDICT rows carrying a tag, ordered by the corpus frequency rank ECDICT records (COCA `frq`,
 * then BNC `bnc`); words with neither come last, alphabetically. The official lists are
 * alphabetical, which is a poor order to learn in.
 */
function ecdictBooks(file, tags) {
  console.log('reading ecdict.csv');
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const head = rows[0];
  const col = (name) => head.indexOf(name);
  const W = col('word');
  const TAG = col('tag');
  const FRQ = col('frq');
  const BNC = col('bnc');
  const byTag = Object.fromEntries(tags.map((t) => [t, []]));
  for (const r of rows.slice(1)) {
    const tagList = String(r[TAG] || '').split(/\s+/);
    for (const t of tags) if (tagList.includes(t)) byTag[t].push({ w: r[W], frq: Number(r[FRQ]) || 0, bnc: Number(r[BNC]) || 0 });
  }
  const rank = (x) => x.frq || x.bnc || Infinity;
  const out = {};
  for (const t of tags) {
    // A lowercase entry wins over a capitalised duplicate (may / May).
    const list = byTag[t].sort((a, b) => rank(a) - rank(b) || (a.w.toLowerCase() < b.w.toLowerCase() ? -1 : 1) || (a.w < b.w ? 1 : -1));
    out[t] = uniqueWords(list.map((x) => x.w));
  }
  return out;
}

async function main() {
  const ngslFiles = [...new Set(BOOKS.filter((b) => b.from.file).map((b) => b.from.file))];
  const files = {};
  for (const name of ngslFiles) files[name] = await cached(name, NGSL_BASE + name);
  const ecdictTags = BOOKS.filter((b) => b.from.kind === 'ecdict').map((b) => b.from.tag);
  const ecdict = ecdictTags.length ? ecdictBooks(await cached('ecdict.csv', ECDICT_URL), ecdictTags) : {};

  fs.mkdirSync(OUT, { recursive: true });
  const catalog = [];
  for (const [rank, book] of BOOKS.entries()) {
    const { from, ...meta } = book;
    const words =
      from.kind === 'ecdict' ? ecdict[from.tag] : from.kind === 'nawl' ? nawlWords(files[from.file]) : ngslWords(files[from.file], from.first);
    if (!words || words.length < 100) throw new Error(`${book.id}: only ${words ? words.length : 0} words`);
    const entry = { ...meta, rank: rank + 1, count: words.length, retrieved: RETRIEVED };
    catalog.push(entry);
    fs.writeFileSync(path.join(OUT, `${book.id}.json`), `${JSON.stringify({ ...entry, words })}\n`);
    console.log(`${book.id.padEnd(9)} ${String(words.length).padStart(5)} words`);
  }
  fs.writeFileSync(path.join(OUT, 'catalog.json'), `${JSON.stringify(catalog, null, 1)}\n`);
  console.log(`wrote ${catalog.length} books to ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
