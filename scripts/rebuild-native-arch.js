#!/usr/bin/env node
/**
 * Compile the macOS Accessibility addon for a target arch (including
 * cross-compile on Intel → arm64). Windows UIA is unchanged.
 *
 * Usage: node scripts/rebuild-native-arch.js [--arch arm64]
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT, argvFlag } = require('./ocr-pack-layout');

const ADDON = path.join(ROOT, 'native-addon');

function fail(msg) {
  const text = `[rebuild-native] ${msg}`;
  if (require.main === module) {
    console.error(text);
    process.exit(1);
  }
  throw new Error(text);
}

function machOToken(arch) {
  return arch === 'arm64' ? 'arm64' : 'x86_64';
}

function assertAxArch(arch) {
  const binding = path.join(ADDON, 'build', 'Release', 'ax_selection_monitor.node');
  if (!fs.existsSync(binding)) fail(`Missing ${binding}`);
  const r = spawnSync('file', [binding], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const want = machOToken(arch);
  if (!out.includes(want)) fail(`AX addon is not ${want}: ${out}`);
  console.log('[rebuild-native]', out);
  return binding;
}

function rebuildDarwinAx(arch) {
  if (process.platform !== 'darwin') {
    console.log('[rebuild-native] skip (not darwin)');
    return;
  }
  if (!arch) fail('arch required');
  console.log(`[rebuild-native] node-gyp rebuild --arch ${arch}`);
  const r = spawnSync('npx', ['node-gyp', 'rebuild', '--arch', arch], {
    cwd: ADDON,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_arch: arch,
      npm_config_target_arch: arch,
    },
  });
  if (r.status !== 0) fail(`node-gyp rebuild --arch ${arch} failed`);
  assertAxArch(arch);
}

if (require.main === module) {
  rebuildDarwinAx(argvFlag('--arch') || process.arch);
}

module.exports = { rebuildDarwinAx, assertAxArch, machOToken };
