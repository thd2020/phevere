/**
 * Writes the update metadata files that the in-app updater reads from a GitHub release,
 * in electron-builder's latest.yml format (version, files with url, sha512 and size, path,
 * sha512, releaseDate). electron-builder does not write them here because electron-builder.yml
 * has `publish: null` and Linux packages come from Forge, so release.yml runs this script on
 * the files it already published.
 *
 *   latest.yml              Windows Setup .exe for x64 and arm64 (electron-updater picks the
 *                           file whose name contains process.arch); written only with both
 *   latest-linux.yml        x64 AppImage, deb and rpm
 *   latest-linux-arm64.yml  arm64 AppImage, deb and rpm
 *   latest-android.yml      Android APK (read by the phone app, not electron-updater)
 *
 * sha512 is the base64 SHA-512 of the whole file, as electron-builder computes it.
 *
 * Usage: node scripts/update-metadata.js --version 4.1.0 --out <dir> <file> [<file> ...]
 * Files that do not carry the version in their name are ignored.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

async function sha512Base64(file) {
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}

async function fileEntry(file) {
  return { url: path.basename(file), sha512: await sha512Base64(file), size: fs.statSync(file).size };
}

/** Which metadata file a release asset belongs to, or null. */
function channelFor(name, version) {
  if (!name.includes(version)) return null;
  const lower = name.toLowerCase();
  if (/^phevere-setup-.*\.exe$/.test(lower)) return 'latest.yml';
  if (lower.endsWith('-android.apk')) return 'latest-android.yml';
  if (/\.(appimage|deb|rpm)$/.test(lower)) {
    const arm = /(arm64|aarch64)/.test(lower);
    const x64 = /(x64|x86_64|amd64)/.test(lower);
    if (arm === x64) return null;
    return arm ? 'latest-linux-arm64.yml' : 'latest-linux.yml';
  }
  return null;
}

/** The file electron-updater 4 and older read from `path`: x64 Setup, else the AppImage. */
function primaryFile(files) {
  const by = (re) => files.find((f) => re.test(f.url));
  return by(/-x64\.exe$/i) || by(/\.exe$/i) || by(/\.AppImage$/i) || files[0];
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** YAML text; every string is single-quoted so a base64 digest never needs escaping. */
function toYaml(version, files, releaseDate) {
  const order = (f) => (/\.exe$|\.AppImage$|\.apk$/i.test(f.url) ? 0 : /\.deb$/i.test(f.url) ? 1 : 2);
  const sorted = [...files].sort((a, b) => order(a) - order(b) || a.url.localeCompare(b.url));
  const main = primaryFile(sorted);
  const lines = [`version: ${quote(version)}`, 'files:'];
  for (const f of sorted) {
    lines.push(`  - url: ${quote(f.url)}`, `    sha512: ${quote(f.sha512)}`, `    size: ${f.size}`);
  }
  lines.push(`path: ${quote(main.url)}`, `sha512: ${quote(main.sha512)}`, `releaseDate: ${quote(releaseDate)}`, '');
  return lines.join('\n');
}

/**
 * Groups `files` by metadata file and writes each one into `outDir`.
 * Returns the written paths.
 */
async function writeUpdateMetadata({ version, files, outDir, releaseDate = new Date().toISOString() }) {
  const v = String(version).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+/.test(v)) throw new Error(`Not a version: ${version}`);
  const groups = new Map();
  for (const file of files) {
    const channel = channelFor(path.basename(file), v);
    if (!channel) continue;
    if (!groups.has(channel)) groups.set(channel, []);
    groups.get(channel).push(await fileEntry(file));
  }
  // electron-updater falls back to any .exe when none names its architecture, so a latest.yml
  // with only the x64 Setup would move ARM64 PCs onto the x64 build. Wait for both instead.
  const windows = groups.get('latest.yml');
  if (windows && !['x64', 'arm64'].every((arch) => windows.some((f) => f.url.endsWith(`-${arch}.exe`)))) {
    console.warn(`[update-metadata] latest.yml needs both the x64 and arm64 Setup; found ${windows.map((f) => f.url).join(', ')}`);
    groups.delete('latest.yml');
  }
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [channel, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const target = path.join(outDir, channel);
    fs.writeFileSync(target, toYaml(v, entries, releaseDate));
    written.push(target);
  }
  return written;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const [value] = args.splice(i, 2).slice(1);
    return value;
  };
  const version = take('--version');
  const outDir = take('--out') || '.';
  if (!version || !args.length) {
    console.error('Usage: node scripts/update-metadata.js --version <x.y.z> --out <dir> <file> [<file> ...]');
    process.exit(2);
  }
  writeUpdateMetadata({ version, files: args, outDir }).then(
    (written) => {
      if (!written.length) {
        console.error(`[update-metadata] No release files for ${version} among: ${args.map((f) => path.basename(f)).join(', ')}`);
        process.exit(1);
      }
      for (const file of written) console.log(`[update-metadata] ${file}`);
    },
    (error) => {
      console.error(`[update-metadata] ${error.message}`);
      process.exit(1);
    },
  );
}

module.exports = { channelFor, sha512Base64, toYaml, writeUpdateMetadata };
