/**
 * Copy OCR sidecar zip next to the NSIS Setup.exe after make:win.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const zip = path.join(root, 'packaging', 'optional', 'Phevere-OCR-Models.zip');
const outRoots = [
  path.join(root, 'out', 'make', 'nsis', 'x64'),
  path.join(root, 'out', 'make', 'nsis'),
];

if (!fs.existsSync(zip)) {
  console.warn('No OCR sidecar zip — skip copy (run npm run prepare:installer)');
  process.exit(0);
}

let copied = 0;
for (const dir of outRoots) {
  if (!fs.existsSync(dir)) continue;
  const dest = path.join(dir, 'Phevere-OCR-Models.zip');
  fs.copyFileSync(zip, dest);
  console.log('Copied OCR sidecar →', dest);
  copied += 1;
}
if (!copied) {
  console.warn('NSIS output dir not found yet; zip remains at', zip);
}
