/**
 * Artwork for the one-page installer (packaging/installer.nsh): hero illustration and
 * the button bitmaps. Native Windows buttons cannot take a brand colour, so the big
 * buttons are pictures with a click handler, the way QQ-style installers do it.
 *
 * Palette is the app's: paper #F4F0EA, ink #1C1917, ember #9C3D00, teal #0F6E71.
 * Everything is drawn at 2× the size it shows at 100% scaling.
 */

const PAPER = '#F4F0EA';
const INK = '#1C1917';
const EMBER = '#9C3D00';
const TEAL = '#0F6E71';
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Segoe UI', Arial, sans-serif";

/** A paragraph with one word selected, and the pop-up card beside it (what the app does). */
function heroSvg(w, h) {
  const bar = (x, y, bw, color = '#DDD5CB') => `<rect x="${x}" y="${y}" width="${bw}" height="14" rx="7" fill="${color}"/>`;
  const lines = [
    [72, 118, 330], [72, 156, 300], [72, 194, 0], [72, 232, 318], [72, 270, 262], [72, 308, 296], [72, 346, 180],
  ];
  const paragraph = lines
    .map(([x, y, bw]) => (bw ? bar(x, y, bw) : ''))
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 994 448">
  <defs>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#1C1917" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="994" height="448" fill="${PAPER}"/>
  <!-- the page being read -->
  ${paragraph}
  <rect x="72" y="186" width="92" height="30" rx="6" fill="#DDD5CB"/>
  <rect x="172" y="184" width="164" height="34" rx="6" fill="#FFDBCC"/>
  <text x="182" y="209" font-family="${SERIF}" font-size="24" fill="${INK}">serendipity</text>
  <rect x="344" y="186" width="58" height="30" rx="6" fill="#DDD5CB"/>
  <path d="M336 176 v52 M330 176 h12 M330 228 h12" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <!-- the pop-up beside it -->
  <g filter="url(#sh)">
    <rect x="486" y="52" width="436" height="344" rx="26" fill="#FFFDF9"/>
  </g>
  <rect x="486" y="52" width="436" height="56" rx="26" fill="#E3DED8"/>
  <rect x="486" y="84" width="436" height="24" fill="#E3DED8"/>
  <rect x="510" y="68" width="46" height="40" rx="12" fill="#FFFDF9"/>
  <circle cx="533" cy="86" r="8" fill="none" stroke="${EMBER}" stroke-width="2.6"/>
  <circle cx="584" cy="80" r="7" fill="#85736C" opacity="0.6"/>
  <circle cx="618" cy="80" r="7" fill="#85736C" opacity="0.6"/>
  <circle cx="652" cy="80" r="7" fill="#85736C" opacity="0.6"/>
  <circle cx="860" cy="80" r="7" fill="#85736C" opacity="0.6"/>
  <circle cx="894" cy="80" r="7" fill="${TEAL}"/>
  <text x="522" y="170" font-family="${SERIF}" font-size="46" font-weight="700" fill="${INK}" letter-spacing="-1.5">serendipity</text>
  <rect x="522" y="192" width="226" height="40" rx="20" fill="#EEEAE4" stroke="#D7C3BB" stroke-width="2"/>
  <text x="540" y="219" font-family="${SERIF}" font-size="21" fill="${INK}">/ˌsɛɹənˈdɪpɪti/</text>
  <circle cx="726" cy="212" r="10" fill="none" stroke="${TEAL}" stroke-width="2.6"/>
  <text x="522" y="278" font-family="${SERIF}" font-size="24" font-style="italic" font-weight="700" fill="${EMBER}">noun</text>
  ${bar(522, 298, 360, '#D9D2C9')}
  ${bar(522, 326, 300, '#D9D2C9')}
  ${bar(522, 354, 210, '#D9D2C9')}
</svg>`;
}

/** Pill button with its label. `muted` is the disabled look (licence not accepted). */
function buttonSvg(w, h, label, muted = false) {
  const fill = muted ? '#D7C3BB' : EMBER;
  const text = muted ? '#F4F0EA' : '#FFF7F3';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${PAPER}"/>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${(h - 4) / 2}" fill="${fill}"/>
  <text x="${w / 2}" y="${h / 2 + h * 0.13}" text-anchor="middle" font-family="${SANS}" font-size="${Math.round(h * 0.36)}" font-weight="600" fill="${text}">${label}</text>
</svg>`;
}

module.exports = { heroSvg, buttonSvg, PAPER };
