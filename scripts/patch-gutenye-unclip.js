/**
 * Gutenye hard-codes DB unclip_ratio = 1.5. PP-OCRv5 det boxes are tighter
 * than v4 at that value (PaddleOCR #16210), so rec crops clip letters. The
 * hover/ROI probe is the same for every pack — raise unclip in one place.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGET = 'const unclip_ratio = 2.2';
const FROM = 'const unclip_ratio = 1.5';

function patchFile(abs) {
  if (!fs.existsSync(abs)) return false;
  const src = fs.readFileSync(abs, 'utf8');
  if (src.includes(TARGET)) return true;
  if (!src.includes(FROM)) return false;
  fs.writeFileSync(abs, src.replace(FROM, TARGET));
  return true;
}

function patchGutenyeUnclip(root = ROOT) {
  const abs = path.join(root, 'node_modules', '@gutenye', 'ocr-common', 'build', 'backend', 'splitIntoLineImages.js');
  return patchFile(abs);
}

if (require.main === module) {
  if (!patchGutenyeUnclip()) {
    console.warn('[patch-gutenye-unclip] splitIntoLineImages.js missing or already patched');
  } else {
    console.log('[patch-gutenye-unclip] DB unclip_ratio → 2.2');
  }
}

module.exports = { patchGutenyeUnclip };
