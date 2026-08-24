#!/usr/bin/env node
/**
 * Assert a packaged app dir (Phevere.app / win unpacked) contains OCR models
 * and the native ONNX/sharp/gutenye files for its platform/arch.
 *
 * Usage:
 *   node scripts/verify-ocr-pack.js
 *   node scripts/verify-ocr-pack.js --dir out/phevere-darwin-x64
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, OCR_MODEL_FILES, argvFlag, onnxBindingRel } = require('./ocr-pack-layout');

function fail(msg) {
  const text = `[verify-ocr-pack] ${msg}`;
  if (require.main === module) {
    console.error(text);
    process.exit(1);
  }
  throw new Error(text);
}

function exists(p) {
  return Boolean(p && fs.existsSync(p));
}

function findAppBundle(dir) {
  if (exists(path.join(dir, 'Contents', 'Resources'))) return dir;
  const names = exists(dir) ? fs.readdirSync(dir) : [];
  const app = names.find((n) => n.endsWith('.app'));
  if (app) return path.join(dir, app);
  return dir;
}

function resourcesDir(appRoot, platform) {
  if (platform === 'darwin') {
    const bundle = findAppBundle(appRoot);
    return path.join(bundle, 'Contents', 'Resources');
  }
  return path.join(appRoot, 'resources');
}

function inferPlatformArch(appRoot) {
  const base = path.basename(appRoot).toLowerCase();
  let platform = process.platform;
  let arch = process.arch;
  if (/darwin/.test(base) || exists(path.join(findAppBundle(appRoot), 'Contents'))) platform = 'darwin';
  else if (/win32/.test(base) || exists(path.join(appRoot, 'Phevere.exe'))) platform = 'win32';
  else if (/linux/.test(base)) platform = 'linux';
  if (/-arm64/.test(base)) arch = 'arm64';
  else if (/-x64/.test(base)) arch = 'x64';
  return { platform, arch };
}

function defaultOutDirs() {
  const out = path.join(ROOT, 'out');
  if (!exists(out)) return [];
  return fs
    .readdirSync(out)
    .map((n) => path.join(out, n))
    .filter((p) => fs.statSync(p).isDirectory() && /phevere-/i.test(path.basename(p)));
}

function verifyDir(appRoot, platform, arch) {
  const res = resourcesDir(appRoot, platform);
  if (!exists(res)) fail(`No Resources dir under ${appRoot} (looked at ${res})`);

  const models = path.join(res, 'ocr-models');
  const missingModels = OCR_MODEL_FILES.filter((f) => !exists(path.join(models, f)));
  if (missingModels.length) {
    fail(`Packaged OCR models missing (${models}): ${missingModels.join(', ')}`);
  }

  const unpacked = path.join(res, 'app.asar.unpacked', 'node_modules');
  const binding = path.join(unpacked, onnxBindingRel(platform, arch));
  if (!exists(binding)) {
    fail(
      `Packaged onnxruntime binding missing for ${platform}/${arch}:\n  ${binding}\n` +
        'Forge webpack ignore must keep onnxruntime-node (see scripts/packager-ignore.js).'
    );
  }

  const gutenye = path.join(unpacked, '@gutenye', 'ocr-node', 'build', 'index.js');
  if (!exists(gutenye)) fail(`Packaged @gutenye/ocr-node missing: ${gutenye}`);

  const sharpPkg = path.join(unpacked, '@img', `sharp-${platform}-${arch}`, 'package.json');
  if (!exists(sharpPkg)) {
    fail(`Packaged sharp native missing: ${sharpPkg}`);
  }

  console.log(`[verify-ocr-pack] ok ${platform}/${arch}  ${appRoot}`);
}

function main() {
  const dirArg = argvFlag('--dir');
  const dirs = dirArg ? [path.resolve(dirArg)] : defaultOutDirs();
  if (dirs.length === 0) fail('No packaged app dir. Pass --dir or run electron-forge package first.');
  for (const dir of dirs) {
    const { platform, arch } = inferPlatformArch(dir);
    verifyDir(dir, platform, arch);
  }
}

if (require.main === module) main();

module.exports = { verifyDir };
