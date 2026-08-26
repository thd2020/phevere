#!/usr/bin/env node
/**
 * Compile the native selection addon for a target arch (macOS AX, including
 * Intel → arm64; Windows UIA, including x64 → arm64 when VS ARM64 tools exist).
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

function rebuildWinUia(arch) {
  if (process.platform !== 'win32') {
    console.log('[rebuild-native] skip (not win32)');
    return;
  }
  if (!arch) fail('arch required');
  if (arch === process.arch) {
    const binding = path.join(ADDON, 'build', 'Release', 'uiautomation_selection_monitor.node');
    if (fs.existsSync(binding)) {
      console.log(`[rebuild-native] UIA already built for ${arch}`);
      return binding;
    }
  }
  console.log(`[rebuild-native] node-gyp rebuild --arch ${arch}`);
  const r = spawnSync('npx', ['node-gyp', 'rebuild', '--arch', arch], {
    cwd: ADDON,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      npm_config_arch: arch,
      npm_config_target_arch: arch,
    },
  });
  if (r.status !== 0) fail(`node-gyp rebuild --arch ${arch} failed`);
  const binding = path.join(ADDON, 'build', 'Release', 'uiautomation_selection_monitor.node');
  if (!fs.existsSync(binding)) fail(`Missing ${binding}`);
  return binding;
}

if (require.main === module) {
  const arch = argvFlag('--arch') || process.arch;
  if (process.platform === 'darwin') rebuildDarwinAx(arch);
  else if (process.platform === 'win32') rebuildWinUia(arch);
  else fail(`no native rebuild for ${process.platform}`);
}

module.exports = { rebuildDarwinAx, rebuildWinUia, assertAxArch, machOToken };
