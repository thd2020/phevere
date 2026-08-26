/**
 * electron-packager ignore for Forge's webpack plugin.
 *
 * The plugin's default ignore keeps only `/.webpack`, which drops webpack
 * externals (onnxruntime-node, sharp, @gutenye, koffi, sql.js). OCR then
 * cannot start in a packaged Mac zip. Keep those production trees.
 *
 * Keep `/node_modules` itself — if the directory is ignored, packager never
 * visits children. Same for scoped roots (`/node_modules/@gutenye`): treating
 * `@gutenye` as a package name would drop every `@gutenye/*` tree.
 * Forge `packagerConfig.prune` is false so galactus does not drop nested
 * `@img` / optional natives.
 *
 * KEEP is computed on first ignore() call so `prePackage` can npm-install
 * the target-arch sharp binary first.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, OCR_SEED_PACKAGES, targetPlatformArch } = require('./ocr-pack-layout');

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function pkgDir(name) {
  return path.join(ROOT, 'node_modules', ...name.split('/'));
}

function addScopedPackages(keep, scope) {
  const dir = path.join(ROOT, 'node_modules', scope);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (fs.existsSync(path.join(dir, name, 'package.json'))) keep.add(`${scope}/${name}`);
  }
}

function collectKeepPackages() {
  const keep = new Set(OCR_SEED_PACKAGES);
  const queue = [...OCR_SEED_PACKAGES];
  while (queue.length) {
    const name = queue.pop();
    const dir = pkgDir(name);
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg) continue;
    keep.add(name);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
    for (const dep of Object.keys(deps)) {
      if (fs.existsSync(path.join(pkgDir(dep), 'package.json'))) queue.push(dep);
    }
  }
  // sharp's @img/* binaries are usually hoisted; seed walk misses them if
  // `sharp` itself is nested under @gutenye/ocr-node.
  addScopedPackages(keep, '@img');
  addScopedPackages(keep, '@gutenye');
  return keep;
}

let cachedKeep = null;
function getKeep() {
  if (!cachedKeep) cachedKeep = collectKeepPackages();
  return cachedKeep;
}

function posix(file) {
  return String(file || '').replace(/\\/g, '/');
}

function topPackage(normalized) {
  const m = normalized.match(/^\/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
  return m ? m[1] : null;
}

function isScopeOnly(pkg) {
  return Boolean(pkg && pkg.startsWith('@') && !pkg.includes('/'));
}

function keepHasScope(scope) {
  const prefix = `${scope}/`;
  for (const name of getKeep()) {
    if (name === scope || name.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * @param {string} file path relative to project root, leading slash
 * @returns {boolean} true = omit from the asar
 */
function packagerIgnore(file) {
  if (!file) return false;
  const normalized = posix(file);
  const { platform, arch } = targetPlatformArch();

  if (normalized === '/.webpack' || normalized.startsWith('/.webpack/')) return false;

  // Must keep the folder itself or packager never visits children (asar ends up
  // with an empty node_modules from webpack's afterCopy mkdir).
  if (normalized === '/node_modules' || normalized === '/node_modules/') return false;

  const pkg = topPackage(normalized);
  if (pkg) {
    if (isScopeOnly(pkg)) return !keepHasScope(pkg);
    if (!getKeep().has(pkg)) return true;

    const bin = normalized.match(
      /^\/node_modules\/onnxruntime-node\/bin\/napi-v6\/([^/]+)\/([^/]+)/
    );
    if (bin) {
      const [, plat, pkgArch] = bin;
      return plat !== platform || pkgArch !== arch;
    }

    const koffiPlat = normalized.match(/^\/node_modules\/koffi\/build\/koffi\/([^/]+)/);
    if (koffiPlat) {
      return koffiPlat[1] !== `${platform}_${arch}`;
    }

    if (pkg.startsWith('@img/')) {
      // sharp 0.33.5 has no win32-arm64 native; wasm32 is the OCR fallback.
      if (pkg === '@img/sharp-wasm32' && platform === 'win32' && arch === 'arm64') {
        return false;
      }
      const meta = readJson(path.join(pkgDir(pkg), 'package.json'));
      const os = meta && Array.isArray(meta.os) ? meta.os : null;
      const cpu = meta && Array.isArray(meta.cpu) ? meta.cpu : null;
      if (os && !os.includes(platform)) return true;
      if (cpu && !cpu.includes(arch)) return true;
    }

    return false;
  }

  return true;
}

module.exports = { packagerIgnore };
