/**
 * electron-builder NSIS sets `SetDetailsPrint none` during File extract, so the
 * InstFiles page is a mute progress bar. Flip it to `both` so the list shows
 * what is being copied (app, OCR models, natives).
 *
 * Called from prepare:installer. Idempotent.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function walkForInstallSection(dir, depth, out) {
  if (depth > 6 || !fs.existsSync(dir)) return;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.isFile() && name === 'installSection.nsh') {
      out.push(p);
      continue;
    }
    if (st.isDirectory() && /^(app-builder-lib|templates|nsis|include)$/.test(name)) {
      walkForInstallSection(p, depth + 1, out);
    }
  }
}

function patchFile(fp) {
  const orig = fs.readFileSync(fp, 'utf8');
  if (!orig.includes('SetDetailsPrint none')) {
    return orig.includes('SetDetailsPrint both');
  }
  const next = orig.replace(/SetDetailsPrint none/g, 'SetDetailsPrint both');
  if (next === orig) return false;
  fs.writeFileSync(fp, next, 'utf8');
  return true;
}

function main() {
  const hits = [];
  walkForInstallSection(path.join(root, 'node_modules', 'app-builder-lib'), 0, hits);
  walkForInstallSection(path.join(root, 'node_modules', 'electron-builder'), 0, hits);
  const unique = [...new Set(hits)];
  if (!unique.length) {
    console.warn('[patch-nsis-details-print] installSection.nsh not found — InstFiles list may stay hidden');
    return;
  }
  let patched = 0;
  for (const fp of unique) {
    if (patchFile(fp)) {
      patched += 1;
      console.log('[patch-nsis-details-print] SetDetailsPrint both →', path.relative(root, fp));
    }
  }
  if (!patched) {
    console.log('[patch-nsis-details-print] already using SetDetailsPrint both');
  }
}

main();
