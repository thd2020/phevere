/**
 * Builds packages/core/src/sense-frequency-data.ts from Princeton WordNet 3.1.
 *
 * WordNet's index.sense carries, for every sense, the number of times it was
 * tagged in the SemCor semantic concordance (tag_cnt). That count is what
 * orders WordNet's own sense numbers. This script keeps, for every lemma with
 * at least one tagged sense, each sense's count plus a bag of gloss tokens
 * (gloss and examples, synset lemmas, hypernym lemmas) so the app can align
 * Free Dictionary and Wiktionary glosses to WordNet senses at lookup time.
 *
 * Run:
 *   node scripts/build-sense-frequency.js                 # downloads wn3.1.dict.tar.gz
 *   node scripts/build-sense-frequency.js --dict <dir>    # an unpacked WordNet 3.1 dict/ folder
 *
 * Licence of the data: WordNet 3.1 licence (Princeton University), which
 * permits use, copying and distribution with the copyright notice kept; the
 * notice is written into the generated file.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'packages', 'core', 'src', 'sense-frequency-data.ts');
const WORDNET_URL = 'https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz';
const maxTokensArg = process.argv.indexOf('--max-tokens');
/** Tokens kept per synset; the gloss comes first, so the cap trims hypernym words. */
const MAX_TOKENS = maxTokensArg >= 0 ? parseInt(process.argv[maxTokensArg + 1], 10) : 20;
const minTagsArg = process.argv.indexOf('--min-tags');
/** A lemma needs this many SemCor tags in total before its counts are trusted. */
const MIN_TAGS = minTagsArg >= 0 ? parseInt(process.argv[minTagsArg + 1], 10) : 3;

function loadGlossTokens() {
  const src = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'src', 'sense-gloss-tokens.ts'), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports.glossTokens;
}

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(download(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Minimal ustar reader: returns { name: Buffer } for the files we need. */
function untar(buf, wanted) {
  const files = {};
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(header.toString('utf8', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
    const base = name.split('/').pop();
    if (wanted.has(base)) files[base] = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const NEEDED = ['index.sense', 'data.noun', 'data.verb', 'data.adj', 'data.adv'];

async function readDict(argv) {
  const at = argv.indexOf('--dict');
  if (at >= 0 && argv[at + 1]) {
    const dir = argv[at + 1];
    return Object.fromEntries(NEEDED.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  }
  console.log(`Downloading ${WORDNET_URL}`);
  const gz = await download(WORDNET_URL);
  const files = untar(zlib.gunzipSync(gz), new Set(NEEDED));
  for (const f of NEEDED) if (!files[f]) throw new Error(`${f} missing from the WordNet archive`);
  return Object.fromEntries(NEEDED.map((f) => [f, files[f].toString('utf8')]));
}

const SS_TYPE_POS = { 1: 'n', 2: 'v', 3: 'a', 4: 'r', 5: 'a' };
const DATA_POS = { 'data.noun': 'n', 'data.verb': 'v', 'data.adj': 'a', 'data.adv': 'r' };
const PTR_POS = { n: 'n', v: 'v', a: 'a', s: 'a', r: 'r' };

function parseData(files) {
  const synsets = new Map();
  for (const [file, pos] of Object.entries(DATA_POS)) {
    for (const line of files[file].split('\n')) {
      if (!/^\d{8} /.test(line)) continue;
      const bar = line.indexOf(' | ');
      const meta = (bar >= 0 ? line.slice(0, bar) : line).trim().split(/\s+/);
      const gloss = bar >= 0 ? line.slice(bar + 3).trim() : '';
      const wCnt = parseInt(meta[3], 16);
      const words = [];
      let i = 4;
      for (let w = 0; w < wCnt; w++, i += 2) words.push(meta[i].replace(/\([^)]*\)$/, '').replace(/_/g, ' '));
      const pCnt = parseInt(meta[i], 10);
      i += 1;
      const hypernyms = [];
      for (let p = 0; p < pCnt; p++, i += 4) {
        const sym = meta[i];
        // Hypernyms, and for an adjective satellite its head ("similar to"). A head
        // adjective's own "similar to" list fans out to dozens of satellites, so skip it.
        const satelliteHead = sym === '&' && meta[2] === 's';
        if (sym === '@' || sym === '@i' || satelliteHead) hypernyms.push(`${PTR_POS[meta[i + 2]]}${meta[i + 1]}`);
      }
      synsets.set(`${pos}${meta[0]}`, { words, gloss, hypernyms });
    }
  }
  return synsets;
}

function parseIndexSense(text) {
  const lemmas = new Map();
  for (const line of text.split('\n')) {
    const parts = line.trim().split(' ');
    if (parts.length < 4) continue;
    const [key, offset, senseNo, tagCnt] = parts;
    const pct = key.indexOf('%');
    const lemma = key.slice(0, pct).replace(/_/g, ' ');
    const pos = SS_TYPE_POS[key[pct + 1]];
    if (!pos) continue;
    let entry = lemmas.get(lemma);
    if (!entry) lemmas.set(lemma, (entry = {}));
    (entry[pos] = entry[pos] || [])[parseInt(senseNo, 10) - 1] = {
      synset: `${pos}${offset}`,
      count: parseInt(tagCnt, 10) || 0,
    };
  }
  return lemmas;
}

async function main() {
  const glossTokens = loadGlossTokens();
  const files = await readDict(process.argv.slice(2));
  const synsets = parseData(files);
  const lemmas = parseIndexSense(files['index.sense']);

  const synsetIds = new Map();
  const synsetLines = [];
  const featuresFor = (key) => {
    if (synsetIds.has(key)) return synsetIds.get(key);
    const ss = synsets.get(key);
    const text = ss
      ? [ss.gloss, ss.words.join(' '), ...ss.hypernyms.map((h) => (synsets.get(h)?.words || []).join(' '))].join(' ; ')
      : '';
    const id = synsetLines.length;
    synsetLines.push(glossTokens(text).slice(0, MAX_TOKENS));
    synsetIds.set(key, id);
    return id;
  };
  /** Token ids in base 36, most frequent token first so common ids stay short. */
  const encodeSynsets = () => {
    const freq = new Map();
    for (const toks of synsetLines) for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
    const vocab = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((e) => e[0]);
    const ids = new Map(vocab.map((t, i) => [t, i.toString(36)]));
    return { vocab, lines: synsetLines.map((toks) => toks.map((t) => ids.get(t)).join(' ')) };
  };

  const wordLines = [];
  let kept = 0;
  let senses = 0;
  for (const lemma of [...lemmas.keys()].sort()) {
    const entry = lemmas.get(lemma);
    const posKeys = Object.keys(entry).filter((p) => entry[p].some(Boolean));
    const all = posKeys.flatMap((p) => entry[p].filter(Boolean));
    const total = all.reduce((n, s) => n + s.count, 0);
    // Too few tags to say anything, or a single sense: nothing to order.
    if (total < MIN_TAGS || all.length < 2) continue;
    kept += 1;
    senses += all.length;
    const fields = ['n', 'v', 'a', 'r']
      .filter((p) => entry[p])
      .map((p) => `${p}:${entry[p].filter(Boolean).map((s) => `${s.count}.${featuresFor(s.synset).toString(36)}`).join(',')}`);
    wordLines.push(`${lemma}\t${fields.join(';')}`);
  }

  const header = `/**
 * GENERATED by scripts/build-sense-frequency.js. Do not edit by hand.
 *
 * SemCor sense tag counts and gloss tokens from Princeton WordNet 3.1
 * (${kept} lemmas, ${senses} senses, ${synsetLines.length} synsets).
 *
 * WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.
 * Permission to use, copy, modify and distribute this software and database
 * and its documentation for any purpose and without fee or royalty is hereby
 * granted, provided that you agree to comply with the following copyright
 * notice and statements, including the disclaimer, and that the same appear
 * on ALL copies of the software, database and documentation, including
 * modifications that you make for internal use or for distribution.
 * THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY
 * MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. The name of
 * Princeton University or Princeton may not be used in advertising or
 * publicity pertaining to distribution of the software and/or database.
 *
 * words: one line per lemma, "lemma<TAB>pos:count.synset,count.synset;pos:...",
 *   senses in WordNet sense-number order, synset index in base 36.
 * vocab: space-separated gloss tokens (see sense-gloss-tokens.ts), most frequent first.
 * synsets: one line per synset, space-separated base-36 indexes into vocab.
 */
`;
  const encoded = encodeSynsets();
  const body =
    `${header}export const SENSE_FREQUENCY_WORDS = ${JSON.stringify(wordLines.join('\n'))};\n\n` +
    `export const SENSE_FREQUENCY_VOCAB = ${JSON.stringify(encoded.vocab.join(' '))};\n\n` +
    `export const SENSE_FREQUENCY_SYNSETS = ${JSON.stringify(encoded.lines.join('\n'))};\n`;
  fs.writeFileSync(OUT, body);
  const gz = zlib.gzipSync(body, { level: 9 }).length;
  console.log(
    `Wrote ${path.relative(ROOT, OUT)}: ${kept} lemmas, ${senses} senses, ${synsetLines.length} synsets, ` +
      `${(body.length / 1024).toFixed(0)} KB raw, ${(gz / 1024).toFixed(0)} KB gzipped`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
