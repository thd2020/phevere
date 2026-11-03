#!/usr/bin/env node
/**
 * Build the OCR pack release asset (Phevere-OCR-PP-OCRv4.tar.gz).
 *
 * Desktop packages ship without OCR models; the app downloads this file from the
 * GitHub release and checks each model against src/services/ocr-pack-manifest.json.
 * The bytes come from the @gutenye/ocr-models npm package, so the npm tarball the
 * app falls back to holds identical files.
 *
 * Usage: node scripts/make-ocr-pack.js [--out out/make]
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const tar = require('tar-stream');
const { ROOT, argvFlag } = require('./ocr-pack-layout');
const manifest = require('../src/services/ocr-pack-manifest.json');

const source = path.join(ROOT, 'node_modules', '@gutenye', 'ocr-models', 'assets');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function makeOcrPack(outDir = path.join(ROOT, 'out', 'make')) {
  for (const f of manifest.files) {
    const file = path.join(source, f.name);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}; run npm ci first.`);
    const digest = sha256(file);
    if (digest !== f.sha256) throw new Error(`${f.name} is ${digest}; the manifest expects ${f.sha256}.`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const output = path.join(outDir, manifest.asset);
  const pack = tar.pack();
  const done = new Promise((resolve, reject) => {
    const out = fs.createWriteStream(output);
    out.on('finish', resolve);
    out.on('error', reject);
    pack.pipe(zlib.createGzip({ level: 9 })).pipe(out);
  });
  // Fixed mtime keeps the archive identical between builds of the same models.
  const mtime = new Date('2024-01-01T00:00:00Z');
  for (const f of manifest.files) {
    const body = fs.readFileSync(path.join(source, f.name));
    await new Promise((resolve, reject) =>
      pack.entry({ name: `ocr-models/${f.name}`, size: body.length, mode: 0o644, mtime }, body, (err) => (err ? reject(err) : resolve())),
    );
  }
  pack.finalize();
  await done;
  console.log(`[make-ocr-pack] ${output} (${(fs.statSync(output).size / 1048576).toFixed(1)} MB)`);
  return output;
}

if (require.main === module) {
  const out = argvFlag('--out');
  makeOcrPack(out ? path.resolve(out) : undefined).catch((err) => {
    console.error(`[make-ocr-pack] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { makeOcrPack };
