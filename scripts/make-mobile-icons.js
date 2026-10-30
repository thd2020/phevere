/**
 * Android and iOS app icons and splash images from packaging/icon.svg.
 *
 * - Android: legacy square and round launcher PNGs, the adaptive-icon foreground
 *   (glyph inside the 66 dp safe zone of a 108 dp canvas) and splash drawables.
 * - iOS: the 1024 px AppIcon (opaque, square; iOS applies its own mask) and the
 *   2732 px splash images.
 *
 * Usage: node scripts/make-mobile-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'packaging', 'icon.svg'), 'utf8');
const res = path.join(root, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res');
const ios = path.join(root, 'apps', 'mobile', 'ios', 'App', 'App', 'Assets.xcassets');

const PAPER = '#F2EFE9';
const defs = source.match(/<defs>[\s\S]*?<\/defs>/)[0];
const glyph = source.match(/<g id="pvGlyph"[\s\S]*?<\/g>/)[0];

/** The glyph alone, scaled about the tile centre, over an optional background. */
function glyphSvg(scale, background) {
  const bg = background === 'tile'
    ? '<rect width="1024" height="1024" fill="url(#pvTile)"/>'
    : background ? `<rect width="1024" height="1024" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${defs}${bg}
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${glyph}</g></svg>`;
}

async function png(svg, size, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(dest);
}

async function roundIcon(size, dest) {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
  const full = await sharp(Buffer.from(glyphSvg(0.86, 'tile'))).resize(size, size).png().toBuffer();
  await sharp(full).composite([{ input: mask, blend: 'dest-in' }]).png().toFile(dest);
}

async function splash(width, height, dest) {
  const mark = Math.round(Math.min(width, height) * 0.28);
  const art = await sharp(Buffer.from(source)).resize(mark, mark).png().toBuffer();
  await sharp({ create: { width, height, channels: 3, background: PAPER } })
    .composite([{ input: art, left: Math.round((width - mark) / 2), top: Math.round((height - mark) / 2) }])
    .png()
    .toFile(dest);
}

async function main() {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [name, k] of Object.entries(densities)) {
    const dir = path.join(res, `mipmap-${name}`);
    await png(source, Math.round(48 * k), path.join(dir, 'ic_launcher.png'));
    await roundIcon(Math.round(48 * k), path.join(dir, 'ic_launcher_round.png'));
    // 108 dp canvas; the launcher may crop to the inner 66 dp, so the glyph keeps to that.
    await png(glyphSvg(0.62), Math.round(108 * k), path.join(dir, 'ic_launcher_foreground.png'));
  }
  fs.writeFileSync(
    path.join(res, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${PAPER}</color>\n</resources>\n`,
  );

  for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const file = path.join(res, dir, 'splash.png');
    if (!fs.existsSync(file)) continue;
    const { width, height } = await sharp(file).metadata();
    await splash(width, height, file);
  }

  await sharp(Buffer.from(glyphSvg(1, 'tile'))).resize(1024, 1024).flatten({ background: PAPER }).removeAlpha().png()
    .toFile(path.join(ios, 'AppIcon.appiconset', 'AppIcon-512@2x.png'));
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await splash(2732, 2732, path.join(ios, 'Splash.imageset', name));
  }
  console.log('Wrote Android mipmaps, splash drawables, iOS AppIcon and splash images');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
