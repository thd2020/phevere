#!/usr/bin/env node
/**
 * Wrap a packaged Phevere.app in a UDZO .dmg (macOS hdiutil). No new npm deps.
 *
 * Usage: node scripts/make-mac-dmg.js --dir out/phevere-darwin-arm64
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT, argvFlag } = require('./ocr-pack-layout');

function fail(msg) {
  console.error('[make-mac-dmg]', msg);
  process.exit(1);
}

function findApp(dir) {
  if (fs.existsSync(path.join(dir, 'Contents', 'MacOS'))) return dir;
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const app = names.find((n) => n.endsWith('.app'));
  if (app) return path.join(dir, app);
  fail(`No .app in ${dir}`);
}

function inferArch(dir) {
  const base = path.basename(dir).toLowerCase();
  if (base.includes('arm64')) return 'arm64';
  if (base.includes('x64')) return 'x64';
  return process.arch;
}

function main() {
  if (process.platform !== 'darwin') fail('hdiutil is macOS-only');
  const dir = path.resolve(argvFlag('--dir') || '');
  if (!dir || !fs.existsSync(dir)) fail('Pass --dir out/phevere-darwin-<arch>');
  const app = findApp(dir);
  const arch = argvFlag('--arch') || inferArch(dir);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const outDir = path.join(ROOT, 'out', 'make', 'dmg');
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `Phevere-${version}-darwin-${arch}.dmg`);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);

  const staging = path.join(outDir, `.stage-${arch}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const stagedApp = path.join(staging, path.basename(app));
  spawnSync('cp', ['-R', app, stagedApp], { stdio: 'inherit' });
  spawnSync('ln', ['-s', '/Applications', path.join(staging, 'Applications')], { stdio: 'inherit' });

  console.log('[make-mac-dmg] hdiutil', dest);
  const r = spawnSync(
    'hdiutil',
    [
      'create',
      '-volname',
      'Phevere',
      '-srcfolder',
      staging,
      '-ov',
      '-format',
      'UDZO',
      dest,
    ],
    { stdio: 'inherit' }
  );
  fs.rmSync(staging, { recursive: true, force: true });
  if (r.status !== 0) fail('hdiutil create failed');
  console.log('[make-mac-dmg] ok', dest);
}

main();
