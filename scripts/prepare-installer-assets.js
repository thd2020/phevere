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

  // NSIS MUI wants uncompressed 24-bpp BMP at the *control* size (164×314 wizard,
  // 150×57 inner header). Cover-scaling the old phone-splash PNG warped the sidebar;
  // a navy 150×57 header looked black on MUI_BGCOLOR F3F3F3 inner pages.
  // Always rasterize the stylized-P mark at exact pixels (fit: fill, no cover crop).
  await writeTrueBmp(
    sharp,
    Buffer.from(wizardSidebarSvg()),
    path.join(outDir, 'installerSidebar.bmp'),
    164,
    314,
    'fill',
    '#0B1220',
  );
  await writeTrueBmp(
    sharp,
    Buffer.from(wizardHeaderSvg()),
    path.join(outDir, 'installerHeader.bmp'),
    150,
    57,
    'fill',
    '#F3F3F3',
  );
  console.log('Wrote installerSidebar.bmp + installerHeader.bmp (true 24-bpp BMP, exact size)');

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

function markGroup(x, y, sizePx) {
  const s = sizePx / 1024;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect width="1024" height="1024" rx="220" ry="220" fill="#0B1220"/>
    <path fill="url(#pvP)" d="M300 220h280c140 0 250 90 250 230s-110 230-250 230H420v204c0 28-22 50-50 50h-20c-28 0-50-22-50-50V270c0-28 22-50 50-50zm120 140v200h150c70 0 120-45 120-100s-50-100-120-100H420z"/>
    <circle cx="690" cy="340" r="42" fill="#E86A4A"/>
  </g>`;
}

function pGradDef() {
  return `<linearGradient id="pvP" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3DDBC9"/><stop offset="100%" stop-color="#1FA896"/>
  </linearGradient>`;
}

/** Welcome / finish left pane — exact 164×314, stylized P (not the old magnifier splash). */
function wizardSidebarSvg() {
  const mark = 100;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B1220"/><stop offset="100%" stop-color="#1A2744"/>
    </linearGradient>
    ${pGradDef()}
  </defs>
  <rect width="164" height="314" fill="url(#g)"/>
  ${markGroup((164 - mark) / 2, 78, mark)}
  <text x="82" y="228" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" font-weight="600" fill="#F3F3F3">Phevere</text>
</svg>`;
}

/** Inner MUI header (right) — light paper so it is not a black slab on F3F3F3 pages. */
function wizardHeaderSvg() {
  const mark = 32;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <defs>${pGradDef()}</defs>
  <rect width="150" height="57" fill="#F3F3F3"/>
  ${markGroup(10, (57 - mark) / 2, mark)}
  <text x="50" y="35" font-family="Segoe UI, sans-serif" font-size="16" font-weight="600" fill="#1A1A1A">Phevere</text>
</svg>`;
}

/** Uncompressed Windows BMP (BITMAPINFOHEADER, 24-bpp BGR, bottom-up). NSIS cannot paint PNG-in-.bmp. */
async function writeTrueBmp(sharp, input, dest, w, h, fit = 'cover', flattenBg = '#0B1220') {
  const { data } = await sharp(input)
    .resize(w, h, { fit, position: 'centre' })
    .flatten({ background: flattenBg })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rowStride = Math.ceil((w * 3) / 4) * 4;
  const pixelSize = rowStride * h;
  const buf = Buffer.alloc(54 + pixelSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + pixelSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y;
    const destRow = 54 + y * rowStride;
    for (let x = 0; x < w; x++) {
      const si = (srcY * w + x) * 3;
      const di = destRow + x * 3;
      buf[di] = data[si + 2];
      buf[di + 1] = data[si + 1];
      buf[di + 2] = data[si];
    }
  }
  fs.writeFileSync(dest, buf);
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
