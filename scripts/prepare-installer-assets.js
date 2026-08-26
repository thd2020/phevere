/**
 * Prepare packaging assets for NSIS:
 * - Multi-size icon.ico + PNG from SVG mark
 * - installerSidebar.bmp / installerHeader.bmp (2× MUI size so Win11 DPI stretch stays sharp)
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
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    const required = [
      path.join(outDir, 'icon.ico'),
      path.join(outDir, 'installerSidebar.bmp'),
      path.join(outDir, 'installerHeader.bmp'),
    ];
    const missing = required.filter((p) => !fs.existsSync(p));
    if (missing.length) {
      console.error(
        '[prepare-installer] sharp unavailable and assets missing:\n  ' + missing.join('\n  '),
      );
      process.exit(1);
    }
    const why = String((e && e.message) || e).split('\n')[0];
    console.warn(`[prepare-installer] ${why}; using committed packaging/ assets (no native sharp on this arch)`);
    return;
  }
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
  await writeMacIcns(sharp, png1024, path.join(outDir, 'icon.icns'));

  // MUI welcome pane is 164×314 / header 150×57 *dialog units*. Per-Monitor v2
  // enlarges those controls; stretching a 1× BMP looks pixelated on Win11 125–200%.
  // Rasterize the P-mark SVG at 2× (fill, not cover of the old splash PNG).
  const SIDEBAR_W = 164 * 2;
  const SIDEBAR_H = 314 * 2;
  const HEADER_W = 150 * 2;
  const HEADER_H = 57 * 2;
  const PAPER = '#FFFFFF';
  await writeTrueBmp(
    sharp,
    Buffer.from(wizardSidebarSvg(SIDEBAR_W, SIDEBAR_H)),
    path.join(outDir, 'installerSidebar.bmp'),
    SIDEBAR_W,
    SIDEBAR_H,
    'fill',
    '#0B1220',
  );
  await writeTrueBmp(
    sharp,
    Buffer.from(wizardHeaderSvg(HEADER_W, HEADER_H, PAPER)),
    path.join(outDir, 'installerHeader.bmp'),
    HEADER_W,
    HEADER_H,
    'fill',
    PAPER,
  );
  console.log(
    `Wrote installerSidebar.bmp ${SIDEBAR_W}×${SIDEBAR_H} + installerHeader.bmp ${HEADER_W}×${HEADER_H} (24-bpp, 2× MUI)`,
  );

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

/** Welcome / finish left pane — 2× MUI 164×314, stylized P (not the old magnifier splash). */
function wizardSidebarSvg(w, h) {
  const mark = Math.round(h * 0.32);
  const textY = Math.round(h * 0.73);
  const font = Math.round(h * 0.064);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B1220"/><stop offset="100%" stop-color="#1A2744"/>
    </linearGradient>
    ${pGradDef()}
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  ${markGroup((w - mark) / 2, Math.round(h * 0.22), mark)}
  <text x="${w / 2}" y="${textY}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${font}" font-weight="600" fill="#FFFFFF">Phevere</text>
</svg>`;
}

/** Inner MUI header (right) — white paper so Win11 pages are not XP grey. */
function wizardHeaderSvg(w, h, paper) {
  const mark = Math.round(h * 0.56);
  const font = Math.round(h * 0.28);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${pGradDef()}</defs>
  <rect width="${w}" height="${h}" fill="${paper}"/>
  ${markGroup(Math.round(w * 0.067), (h - mark) / 2, mark)}
  <text x="${Math.round(w * 0.33)}" y="${Math.round(h * 0.62)}" font-family="Segoe UI, sans-serif" font-size="${font}" font-weight="600" fill="#1A1A1A">Phevere</text>
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

/** Dock / .app icon. `iconutil` is darwin-only; Windows `prepare:installer` leaves the committed icns. */
async function writeMacIcns(sharp, png1024, destIcns) {
  if (process.platform !== 'darwin') {
    console.log('Skip icon.icns (not darwin; using committed packaging/icon.icns)');
    return;
  }
  const setDir = path.join(path.dirname(destIcns), 'icon.iconset');
  fs.rmSync(setDir, { recursive: true, force: true });
  fs.mkdirSync(setDir, { recursive: true });
  const files = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [px, name] of files) {
    await sharp(png1024).resize(px, px).png().toFile(path.join(setDir, name));
  }
  try {
    execFileSync('iconutil', ['-c', 'icns', setDir], { stdio: 'inherit' });
    console.log('Wrote', destIcns);
  } catch (e) {
    console.warn('iconutil failed; keeping existing icon.icns if present', e.message);
  } finally {
    fs.rmSync(setDir, { recursive: true, force: true });
  }
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
