/**
 * Copy PP-OCR ONNX assets from @gutenye/ocr-models into resources/ocr-models.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', '@gutenye', 'ocr-models', 'assets');
const dest = path.join(root, 'resources', 'ocr-models');

if (!fs.existsSync(src)) {
  console.error('Missing @gutenye/ocr-models — run npm install first');
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
  console.log('synced', name);
}
console.log('OK →', dest);
