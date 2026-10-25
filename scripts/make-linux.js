/**
 * Linux packages: .deb, .rpm and AppImage for one arch (default: this machine's).
 * A cross-arch build (x64 on an arm64 box) cross-compiles the selection addon
 * through scripts/linux-cross-sysroot.js; everything else ships prebuilt.
 *
 * Usage: node scripts/make-linux.js [--arch x64|arm64]
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { argvFlag } = require('./ocr-pack-layout');

const root = path.join(__dirname, '..');

if (!process.env.ELECTRON_MIRROR) {
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
}

const arch = argvFlag('--arch') || process.arch;
process.env.PHEVERE_PACK_PLATFORM = 'linux';
process.env.PHEVERE_PACK_ARCH = arch;
console.log('[make-linux] arch=', arch);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, env: process.env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

// Package once, then one maker per pass: running deb, rpm and AppImage together
// compresses three copies of the app at once and can run a small box out of memory.
run('npx', ['electron-forge', 'package', '--platform=linux', `--arch=${arch}`]);
run(process.execPath, ['scripts/verify-ocr-pack.js', '--dir', `out/phevere-linux-${arch}`]);
for (const maker of ['deb', 'rpm', 'appimage']) {
  process.env.PHEVERE_LINUX_MAKER = maker;
  run('npx', ['electron-forge', 'make', '--skip-package', '--platform=linux', `--arch=${arch}`]);
}
delete process.env.PHEVERE_LINUX_MAKER;
