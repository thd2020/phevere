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

// packaging/icon.svg is the one source for the app, tray and installer icons.
const ICON_SVG = fs.readFileSync(path.join(packaging, 'icon.svg'), 'utf8');
/** The mark without its XML wrapper, for embedding inside larger artwork. */
const ICON_INNER = ICON_SVG.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    const required = [
      path.join(outDir, 'icon.ico'),
      path.join(outDir, 'installerSidebar.bmp'),
      path.join(outDir, 'installerHeader.bmp'),
      path.join(outDir, 'installerHero.bmp'),
      path.join(outDir, 'installerButton.bmp'),
      path.join(outDir, 'installerButtonOff.bmp'),
      path.join(outDir, 'installerOpen.bmp'),
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
    '#F4F0EA',
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

  // One-page installer (installer.nsh): hero illustration and big buttons, 2× size.
  const { heroSvg, buttonSvg, PAPER: ART_PAPER } = require('./installer-art');
  const art = [
    ['installerHero.bmp', heroSvg(994, 448), 994, 448],
    ['installerButton.bmp', buttonSvg(320, 88, 'Install'), 320, 88],
    ['installerButtonOff.bmp', buttonSvg(320, 88, 'Install', true), 320, 88],
    ['installerOpen.bmp', buttonSvg(320, 88, 'Open Phevere'), 320, 88],
  ];
  for (const [name, svg, w, h] of art) {
    await writeTrueBmp(sharp, Buffer.from(svg), path.join(outDir, name), w, h, 'fill', ART_PAPER);
  }
  console.log('Wrote installerHero.bmp and installer button bitmaps');

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
  return `<g transform="translate(${x} ${y}) scale(${s})">${ICON_INNER}</g>`;
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
      <stop offset="0%" stop-color="#FBF8F3"/><stop offset="100%" stop-color="#F1EBE3"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  ${markGroup((w - mark) / 2, Math.round(h * 0.22), mark)}
  <text x="${w / 2}" y="${textY}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${font}" font-weight="600" fill="#1C1917">Phevere</text>
</svg>`;
}

/** Inner MUI header (right) — white paper so Win11 pages are not XP grey. */
function wizardHeaderSvg(w, h, paper) {
  const mark = Math.round(h * 0.56);
  const font = Math.round(h * 0.28);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
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
/**
 * macOS icon. The art sits on Apple's 824 px grid inside the 1024 px canvas, as
 * other Mac app icons do, so the full-bleed tile is shrunk with a margin.
 * Written directly as an ICNS container of PNGs, so it builds on any OS.
 */
async function writeMacIcns(sharp, png1024, destIcns) {
  const art = await sharp(png1024).resize(824, 824).png().toBuffer();
  const canvas = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: 100, top: 100 }])
    .png()
    .toBuffer();
  // OSType → pixel size of the PNG stored under it.
  const types = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const chunks = [];
  for (const [type, px] of types) {
    const png = await sharp(canvas).resize(px, px).png().toBuffer();
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(destIcns, Buffer.concat([header, body]));
  console.log('Wrote', destIcns);
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
