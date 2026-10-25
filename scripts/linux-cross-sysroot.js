#!/usr/bin/env node
/**
 * Minimal Ubuntu sysroot for cross-compiling the Linux selection addon
 * (e.g. an arm64 box building the x64 package). Headers and .so links only:
 * X11, XFixes, AT-SPI2, GLib/GIO, D-Bus, Wayland client. No apt changes —
 * the .debs come straight from the Ubuntu pool and are unpacked with dpkg-deb.
 *
 * Usage: node scripts/linux-cross-sysroot.js --arch x64
 * Prints the sysroot path. Needs dpkg-deb, curl, and a cross g++
 * (x86_64-linux-gnu-g++ / aarch64-linux-gnu-g++).
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const RELEASE = process.env.PHEVERE_SYSROOT_RELEASE || 'noble';
const PACKAGES = [
  'libx11-dev',
  'libx11-6',
  'x11proto-dev',
  'libxfixes-dev',
  'libxfixes3',
  'libatspi2.0-dev',
  'libatspi2.0-0t64',
  'libglib2.0-dev',
  'libglib2.0-0t64',
  'libdbus-1-dev',
  'libdbus-1-3',
  'libwayland-dev',
  'libwayland-client0',
  // Only so pkg-config can resolve Requires.private; never linked.
  'libpcre2-dev',
  'libffi-dev',
  'libxcb1-dev',
  'libxau-dev',
  'libxdmcp-dev',
  'libmount-dev',
  'libblkid-dev',
  'libselinux1-dev',
  'libsepol-dev',
  'zlib1g-dev',
  'libbsd-dev',
  'libmd-dev',
  'libxtst-dev',
  'libxi-dev',
  'libxext-dev',
  'libsystemd-dev',
  'libcap-dev',
  'libgcrypt20-dev',
  'libgpg-error-dev',
  'liblz4-dev',
  'liblzma-dev',
  'libzstd-dev',
];

const ARCH = {
  x64: { deb: 'amd64', triple: 'x86_64-linux-gnu', mirror: 'http://archive.ubuntu.com/ubuntu' },
  arm64: { deb: 'arm64', triple: 'aarch64-linux-gnu', mirror: 'http://ports.ubuntu.com/ubuntu-ports' },
};

function fail(msg) {
  const text = `[linux-sysroot] ${msg}`;
  if (require.main === module) {
    console.error(text);
    process.exit(1);
  }
  throw new Error(text);
}

function fetch(url, dest) {
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', dest, url], { stdio: 'inherit' });
}

function packageIndex(spec, cacheDir) {
  const index = new Map();
  for (const suite of [RELEASE, `${RELEASE}-updates`]) {
    for (const component of ['main', 'universe']) {
      const gz = path.join(cacheDir, `Packages-${suite}-${component}-${spec.deb}.gz`);
      if (!fs.existsSync(gz)) {
        fetch(`${spec.mirror}/dists/${suite}/${component}/binary-${spec.deb}/Packages.gz`, gz);
      }
      const text = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
      for (const stanza of text.split('\n\n')) {
        const name = /^Package: (.+)$/m.exec(stanza);
        const file = /^Filename: (.+)$/m.exec(stanza);
        if (name && file) index.set(name[1], file[1]); // -updates overrides the release
      }
    }
  }
  return index;
}

function ensureSysroot(arch) {
  const spec = ARCH[arch];
  if (!spec) fail(`unsupported arch ${arch}`);
  const cacheDir = path.join(os.homedir(), '.cache', 'phevere', `sysroot-${RELEASE}-${spec.deb}`);
  const root = path.join(cacheDir, 'root');
  const stamp = path.join(root, '.phevere-sysroot');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === PACKAGES.join('\n')) return { root, spec };

  fs.mkdirSync(root, { recursive: true });
  const index = packageIndex(spec, cacheDir);
  for (const pkg of PACKAGES) {
    const rel = index.get(pkg);
    if (!rel) fail(`${pkg} not in ${RELEASE}/${spec.deb}`);
    const deb = path.join(cacheDir, path.basename(rel));
    if (!fs.existsSync(deb)) {
      console.error(`[linux-sysroot] ${pkg}`);
      fetch(`${spec.mirror}/${rel}`, deb);
    }
    execFileSync('dpkg-deb', ['-x', deb, root]);
  }
  fs.writeFileSync(stamp, PACKAGES.join('\n'));
  return { root, spec };
}

/** Env for node-gyp: cross compiler + pkg-config pointed at the sysroot. */
function crossEnv(arch) {
  const { root, spec } = ensureSysroot(arch);
  const libdir = path.join(root, 'usr', 'lib', spec.triple);
  return {
    CC: `${spec.triple}-gcc`,
    CXX: `${spec.triple}-g++`,
    LINK: `${spec.triple}-g++`,
    AR: `${spec.triple}-ar`,
    PKG_CONFIG_SYSROOT_DIR: root,
    // Keep <root>/usr/include: it is not the cross compiler's own /usr/include.
    PKG_CONFIG_ALLOW_SYSTEM_CFLAGS: '1',
    PKG_CONFIG_ALLOW_SYSTEM_LIBS: '1',
    PKG_CONFIG_LIBDIR: [path.join(libdir, 'pkgconfig'), path.join(root, 'usr', 'share', 'pkgconfig')].join(':'),
    LDFLAGS: `-L${libdir} -Wl,-rpath-link,${libdir}`,
  };
}

module.exports = { ensureSysroot, crossEnv };

if (require.main === module) {
  const i = process.argv.indexOf('--arch');
  const arch = i >= 0 ? process.argv[i + 1] : 'x64';
  console.log(ensureSysroot(arch).root);
}
