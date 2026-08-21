/**
 * Fetch the Electron runtime zip with curl (progress + resume) and extract it.
 * Electron's own postinstall uses `got`, which can sit on a spinner for tens of
 * minutes against github.com, or hang with no cache file on some mirrors.
 *
 * First-time `npm install`: `.npmrc` `electron_mirror` steers Electron's
 * `got` postinstall at npmmirror. If that still hangs, set
 * ELECTRON_SKIP_BINARY_DOWNLOAD=1 and this script curls the zip.
 * `npm start` prestart also runs here so a Ctrl+C'd install self-heals.
 *
 * No-op when node_modules/electron/dist already matches package.json version.
 */
'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const pkgPath = path.join(electronDir, 'package.json');

if (!fs.existsSync(pkgPath)) {
  console.log('[ensure-electron] node_modules/electron missing; run npm install first.');
  process.exit(0);
}

const { version } = require(pkgPath);
const platform = process.env.npm_config_platform || process.platform;
const arch = process.env.npm_config_arch || process.arch;
const distDir = path.join(electronDir, 'dist');
const versionFile = path.join(distDir, 'version');
const platformPath =
  platform === 'darwin' || platform === 'mas'
    ? 'Electron.app/Contents/MacOS/Electron'
    : platform === 'win32'
      ? 'electron.exe'
      : 'electron';

function alreadyInstalled() {
  try {
    const got = fs.readFileSync(versionFile, 'utf8').trim().replace(/^v/, '');
    if (got !== version) return false;
    return fs.existsSync(path.join(distDir, platformPath));
  } catch {
    return false;
  }
}

if (alreadyInstalled()) {
  console.log('[ensure-electron] Electron', version, 'already in dist/');
  process.exit(0);
}

const asset = `electron-v${version}-${platform}-${arch}.zip`;
const checksums = require(path.join(electronDir, 'checksums.json'));
const expected = checksums[asset];
if (!expected) {
  console.error('[ensure-electron] no checksum for', asset);
  process.exit(1);
}

const cacheDir = path.join(os.homedir(), '.cache', 'phevere');
fs.mkdirSync(cacheDir, { recursive: true });
const zipPath = path.join(cacheDir, asset);

function sha256file(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function zipReady() {
  try {
    return fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0 && sha256file(zipPath) === expected;
  } catch {
    return false;
  }
}

function mirrorUrls() {
  const raw = (process.env.ELECTRON_MIRROR || process.env.npm_config_electron_mirror || '').trim();
  const urls = [];
  // Empty env must not become "/" — String#replace(/\/?$/, '/') matches ''.
  if (/^https?:\/\//i.test(raw)) {
    urls.push(`${raw.replace(/\/?$/, '/')}v${version}/${asset}`);
  }
  urls.push(`https://cdn.npmmirror.com/binaries/electron/v${version}/${asset}`);
  urls.push(`https://github.com/electron/electron/releases/download/v${version}/${asset}`);
  return [...new Set(urls)];
}

const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';

function curlDownload(url) {
  console.log('[ensure-electron] downloading', url);
  execFileSync(
    curlBin,
    [
      '-fL',
      '-C',
      '-',
      '--retry',
      '8',
      '--retry-all-errors',
      '--retry-delay',
      '3',
      '--connect-timeout',
      '20',
      '--progress-bar',
      '-o',
      zipPath,
      url,
    ],
    { stdio: 'inherit' },
  );
}

if (!zipReady()) {
  let lastErr = null;
  for (const url of mirrorUrls()) {
    try {
      curlDownload(url);
      if (zipReady()) break;
      console.warn('[ensure-electron] checksum mismatch after', url, '— trying next mirror');
      try {
        fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
    } catch (err) {
      lastErr = err;
      console.warn('[ensure-electron] curl failed for', url, '(status', err.status || '?', ')');
    }
  }
  if (!zipReady()) {
    console.error('[ensure-electron] could not fetch a matching zip. Set ELECTRON_MIRROR or retry.');
    process.exit(lastErr && lastErr.status ? lastErr.status : 1);
  }
}

console.log('[ensure-electron] checksum ok, extracting…');
fs.mkdirSync(distDir, { recursive: true });
const extract = require(path.join(root, 'node_modules', 'extract-zip'));
extract(zipPath, { dir: distDir })
  .then(() => {
    const srcTypes = path.join(distDir, 'electron.d.ts');
    if (fs.existsSync(srcTypes)) {
      fs.renameSync(srcTypes, path.join(electronDir, 'electron.d.ts'));
    }
    fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath);
    console.log('[ensure-electron] installed', fs.readFileSync(versionFile, 'utf8').trim());
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
