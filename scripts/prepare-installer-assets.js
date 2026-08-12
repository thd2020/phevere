/**
 * Prepare packaging assets for NSIS:
 * - Multi-size icon.ico + PNG from SVG mark
 * - installerSidebar.bmp (164×314) + installerHeader.bmp (150×57)
 * - Optional OCR zip (sidecar) for selective install without bloating Setup.exe
 *
 * Usage: node scripts/prepare-installer-assets.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const packaging = path.join(root, 'packaging');
const assetsDir = path.join(root, '.cursor-assets-cache'); // unused; sources below
const outDir = packaging;

const ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B1220"/>
      <stop offset="100%" stop-color="#152238"/>
    </linearGradient>
    <linearGradient id="p" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3DDBC9"/>
      <stop offset="100%" stop-color="#1FA896"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="220" ry="220" fill="url(#bg)"/>
  <!-- stylized P -->
  <path fill="url(#p)" d="M300 220h280c140 0 250 90 250 230s-110 230-250 230H420v204c0 28-22 50-50 50h-20c-28 0-50-22-50-50V270c0-28 22-50 50-50zm120 140v200h150c70 0 120-45 120-100s-50-100-120-100H420z"/>
  <circle cx="690" cy="340" r="42" fill="#E86A4A"/>
</svg>`;

async function main() {
  const sharp = require('sharp');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'optional'), { recursive: true });

  const svgBuf = Buffer.from(ICON_SVG);

  // Master PNG
  const png1024 = await sharp(svgBuf).resize(1024, 1024).png().toBuffer();
  await sharp(png1024).resize(512, 512).png().toFile(path.join(outDir, 'icon.png'));
  await sharp(png1024).resize(256, 256).png().toFile(path.join(root, 'resources', 'tray-icon.png'));

  // ICO: pack multiple PNG sizes (sharp can write ico on recent builds; fallback via png-to-ico if needed)
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    pngs.push(await sharp(png1024).resize(s, s).png().toBuffer());
  }

  let icoWritten = false;
  try {
    // to-ico / png-to-ico may not be installed — try dynamic require
    let pngToIco;
    try {
      pngToIco = require('png-to-ico');
    } catch {
      try {
        pngToIco = require('to-ico');
      } catch {
        pngToIco = null;
      }
    }
    if (pngToIco) {
      const ico = await pngToIco(pngs);
      fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
      icoWritten = true;
    }
  } catch (e) {
    console.warn('png-to-ico failed', e.message);
  }

  if (!icoWritten) {
    // Minimal ICO writer (PNG-compressed images, Vista+)
    const ico = buildPngIco(pngs, sizes);
    fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
    icoWritten = true;
  }
  console.log('Wrote packaging/icon.ico + icon.png + resources/tray-icon.png');

  // Sidebar 164×314 BMP from generated art if present, else procedural
  const sidebarSrcCandidates = [
    path.join(process.env.USERPROFILE || '', '.cursor', 'projects', 'c-Users-8114-projects-phevere', 'assets', 'installer-sidebar.png'),
    path.join(root, 'assets', 'installer-sidebar.png'),
  ];
  let sidebarSrc = sidebarSrcCandidates.find((p) => fs.existsSync(p));
  if (sidebarSrc) {
    await sharp(sidebarSrc)
      .resize(164, 314, { fit: 'cover' })
      .removeAlpha()
      .toFile(path.join(outDir, 'installerSidebar.bmp'));
  } else {
    await writeGradientBmp(sharp, path.join(outDir, 'installerSidebar.bmp'), 164, 314);
  }

  const headerSrcCandidates = [
    path.join(process.env.USERPROFILE || '', '.cursor', 'projects', 'c-Users-8114-projects-phevere', 'assets', 'installer-header.png'),
    path.join(root, 'assets', 'installer-header.png'),
  ];
  let headerSrc = headerSrcCandidates.find((p) => fs.existsSync(p));
  if (headerSrc) {
    await sharp(headerSrc)
      .resize(150, 57, { fit: 'cover' })
      .removeAlpha()
      .toFile(path.join(outDir, 'installerHeader.bmp'));
  } else {
    await writeGradientBmp(sharp, path.join(outDir, 'installerHeader.bmp'), 150, 57);
  }
  console.log('Wrote installerSidebar.bmp + installerHeader.bmp');

  // Optional: also emit sidecar zip for advanced redistribution (not required — models are in Setup).
  const ocrSrc = path.join(root, 'resources', 'ocr-models');
  const ocrZip = path.join(outDir, 'optional', 'Phevere-OCR-Models.zip');
  if (process.env.PHEVERE_BUILD_OCR_SIDECAR === '1' && fs.existsSync(path.join(ocrSrc, 'ch_PP-OCRv4_det_infer.onnx'))) {
    zipDirectory(ocrSrc, ocrZip, 'ocr-models');
    console.log('Wrote', ocrZip);
  } else {
    console.log('OCR models ship inside Setup.exe (extraResources); sidecar zip skipped');
  }
}

async function writeGradientBmp(sharp, dest, w, h) {
  // Solid ink + teal stripe via SVG
  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B1220"/><stop offset="100%" stop-color="#1A2744"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect y="${Math.floor(h * 0.72)}" width="100%" height="${Math.ceil(h * 0.28)}" fill="#1FA896" opacity="0.35"/>
  </svg>`;
  await sharp(Buffer.from(svg)).removeAlpha().toFile(dest);
}

/** Build a multi-image ICO containing PNG payloads (supported by Windows Vista+). */
function buildPngIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const s = sizes[i];
    const buf = pngBuffers[i];
    entries.push({ s, buf, offset });
    offset += buf.length;
  }
  const out = Buffer.alloc(offset);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(count, 4);
  for (let i = 0; i < count; i++) {
    const e = entries[i];
    const o = 6 + i * 16;
    out.writeUInt8(e.s >= 256 ? 0 : e.s, o);
    out.writeUInt8(e.s >= 256 ? 0 : e.s, o + 1);
    out.writeUInt8(0, o + 2);
    out.writeUInt8(0, o + 3);
    out.writeUInt16LE(1, o + 4);
    out.writeUInt16LE(32, o + 6);
    out.writeUInt32LE(e.buf.length, o + 8);
    out.writeUInt32LE(e.offset, o + 12);
    e.buf.copy(out, e.offset);
  }
  return out;
}

function zipDirectory(srcDir, destZip, rootFolderName) {
  fs.mkdirSync(path.dirname(destZip), { recursive: true });
  if (fs.existsSync(destZip)) fs.unlinkSync(destZip);
  const staging = path.join(path.dirname(destZip), '_ocr_stage');
  try {
    fs.rmSync(staging, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const nested = path.join(staging, rootFolderName);
  fs.mkdirSync(nested, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const from = path.join(srcDir, name);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(nested, name));
  }

  // Prefer Windows tar (bsdtar) — creates zip with -a; avoids fragile powershell PATH in sandboxes.
  try {
    execFileSync('tar', ['-a', '-c', '-f', destZip, '-C', staging, rootFolderName], {
      stdio: 'inherit',
      windowsHide: true,
    });
  } catch (e1) {
    const ps =
      process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
    const cmd = `Compress-Archive -Path '${staging.replace(/'/g, "''")}\\*' -DestinationPath '${destZip.replace(/'/g, "''")}' -Force`;
    execFileSync(ps, ['-NoProfile', '-Command', cmd], { stdio: 'inherit', windowsHide: true });
  }
  fs.rmSync(staging, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
