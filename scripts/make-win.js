/**
 * Windows NSIS make with mirrors that avoid github.com timeouts
 * (common on some CN networks — github.com often resolves to slow/blocked edges).
 *
 * Usage: node scripts/make-win.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

// Prefer npmmirror when GitHub is unreachable; override with env if already set.
if (!process.env.ELECTRON_MIRROR) {
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
}
if (!process.env.ELECTRON_CUSTOM_DIR) {
  // Keep default cache layout under Electron's cache
}
if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
    'https://npmmirror.com/mirrors/electron-builder-binaries/';
}

console.log('[make-win] ELECTRON_MIRROR=', process.env.ELECTRON_MIRROR);
console.log(
  '[make-win] ELECTRON_BUILDER_BINARIES_MIRROR=',
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR,
);

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }
}

run('npm', ['run', 'prepare:installer']);
run('npx', ['electron-forge', 'make', '--platform=win32']);
