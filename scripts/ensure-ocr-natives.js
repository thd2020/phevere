#!/usr/bin/env node
/**
 * Make sure the *target* OS/arch OCR stack is on disk before electron-packager
 * runs. End-user zips must not depend on Python or a local `npm install` layout.
 *
 * Usage: node scripts/ensure-ocr-natives.js [--platform darwin] [--arch x64]
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  ROOT,
  OCR_MODEL_FILES,
  targetPlatformArch,
  onnxBindingRel,
  sharpSpec,
} = require('./ocr-pack-layout');

function fail(msg) {
  const text = `[ensure-ocr-natives] ${msg}`;
  if (require.main === module) {
    console.error(text);
    process.exit(1);
  }
  throw new Error(text);
}

function modelsOk() {
  const dir = path.join(ROOT, 'resources', 'ocr-models');
  const missing = OCR_MODEL_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) fail(`Missing OCR models in resources/ocr-models: ${missing.join(', ')} (run node scripts/sync-ocr-models.js)`);
}

function onnxOk(platform, arch) {
  const rel = onnxBindingRel(platform, arch);
  const abs = path.join(ROOT, 'node_modules', rel);
  if (!fs.existsSync(abs)) {
    fail(
      `Missing ${rel}. onnxruntime-node 1.23.2 must ship this file (Intel Mac = darwin/x64). Reinstall that version; 1.24+ dropped darwin/x64.`
    );
  }
}

function npmInstall(pkgs, platform, arch, opts) {
  const args = ['install', '--no-save'];
  if (opts && opts.wasm) {
    // wasm32 is not win32/arm64; --os/--cpu would skip the tarball.
    args.push('--force');
  } else {
    args.push('--os', platform, '--cpu', arch);
    if (platform !== process.platform || arch !== process.arch) {
      args.push('--force');
    }
  }
  args.push(...pkgs);
  console.log('[ensure-ocr-natives] npm', args.join(' '));
  const r = spawnSync('npm', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) fail(`npm install failed for ${pkgs.join(' ')}`);
}

function sharpOk(platform, arch) {
  const spec = sharpSpec(platform, arch);
  if (!spec) {
    console.warn(`[ensure-ocr-natives] No sharp platform package mapped for ${platform}/${arch}`);
    return;
  }
  const dir = path.join(ROOT, 'node_modules', ...spec.pkg.split('/'));
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    const pkgs = [`${spec.pkg}@${spec.ver}`];
    if (spec.vips) pkgs.push(`${spec.vips}@${spec.vipsVer}`);
    npmInstall(pkgs, platform, arch, { wasm: Boolean(spec.wasm) });
  }
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    fail(`Still missing ${spec.pkg} after npm install (needed for packaged OCR on ${platform}/${arch})`);
  }
  if (spec.vips) {
    const vipsDir = path.join(ROOT, 'node_modules', ...spec.vips.split('/'));
    if (!fs.existsSync(path.join(vipsDir, 'package.json'))) {
      fail(`Missing ${spec.vips} (libvips for ${platform}/${arch})`);
    }
  }
}

function gutenyeOk() {
  const p = path.join(ROOT, 'node_modules', '@gutenye', 'ocr-node', 'build', 'index.js');
  if (!fs.existsSync(p)) fail('Missing @gutenye/ocr-node/build/index.js');
  const { patchGutenyeUnclip } = require('./patch-gutenye-unclip');
  patchGutenyeUnclip(ROOT);
}

function ensure(opts) {
  const platform = (opts && opts.platform) || targetPlatformArch().platform;
  const arch = (opts && opts.arch) || targetPlatformArch().arch;
  console.log(`[ensure-ocr-natives] target ${platform}/${arch}`);
  modelsOk();
  gutenyeOk();
  onnxOk(platform, arch);
  sharpOk(platform, arch);
  console.log('[ensure-ocr-natives] ok');
}

if (require.main === module) {
  ensure(targetPlatformArch());
}

module.exports = { ensure };
