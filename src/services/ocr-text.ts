/**
 * Post-process PP-OCR lines. Packaged Gutenye/ONNX (and sliced crops) can emit
 * "c e n t r i f i c" — one glyph per token — while Python RapidOCR in `npm start`
 * returns a normal word.
 */

export type OcrTextLine = {
  text: string;
  bounds?: { x: number; y: number; width: number; height: number };
};

const LETTER_GLUE_CHAR =
  /[A-Za-z0-9\u00C0-\u024F\u3400-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/;

function isSingleGlyphToken(p: string): boolean {
  const chars = [...p];
  return chars.length === 1 && LETTER_GLUE_CHAR.test(chars[0]);
}

export function glueSpacedLetters(s: string): string {
  const trimmed = String(s || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(' ');
  if (parts.length < 3) return trimmed;
  const singles = parts.filter(isSingleGlyphToken).length;
  if (singles / parts.length < 0.7) return trimmed;
  let out = '';
  for (const p of parts) {
    if (isSingleGlyphToken(p)) {
      out += p;
    } else {
      if (out && !out.endsWith(' ')) out += ' ';
      out += `${p} `;
    }
  }
  return out.trim();
}

function unionBounds(
  a: NonNullable<OcrTextLine['bounds']>,
  b: NonNullable<OcrTextLine['bounds']>,
): NonNullable<OcrTextLine['bounds']> {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function sameOcrRow(a: OcrTextLine, b: OcrTextLine): boolean {
  const ab = a.bounds;
  const bb = b.bounds;
  if (!ab || !bb) return false;
  const ay = ab.y + ab.height / 2;
  const by = bb.y + bb.height / 2;
  return Math.abs(ay - by) < Math.max(ab.height, bb.height) * 0.55;
}

/** Merge adjacent single-glyph boxes on one baseline (letter-level DB boxes). */
export function mergeGlyphBoxes(lines: OcrTextLine[]): OcrTextLine[] {
  const withB = lines.filter((l) => l.bounds && l.bounds.width > 0);
  const without = lines.filter((l) => !l.bounds || l.bounds.width <= 0);
  withB.sort((a, b) => {
    const ay = a.bounds!.y + a.bounds!.height / 2;
    const by = b.bounds!.y + b.bounds!.height / 2;
    if (Math.abs(ay - by) > 4) return ay - by;
    return a.bounds!.x - b.bounds!.x;
  });
  const groups: OcrTextLine[][] = [];
  for (const line of withB) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (prev && prev.bounds && line.bounds && sameOcrRow(prev, line)) {
      const gap = line.bounds.x - (prev.bounds.x + prev.bounds.width);
      const cw = Math.max(3, Math.min(prev.bounds.width, line.bounds.width) || 8);
      const bothShort = [...prev.text.trim()].length <= 2 && [...line.text.trim()].length <= 2;
      if (gap < cw * (bothShort ? 2.2 : 0.9)) {
        g.push(line);
        continue;
      }
    }
    groups.push([line]);
  }
  const merged = groups.map((g) => {
    if (g.length === 1) return { ...g[0], text: glueSpacedLetters(g[0].text) };
    let text = glueSpacedLetters(g[0].text);
    let bounds = g[0].bounds!;
    for (let i = 1; i < g.length; i++) {
      const prev = g[i - 1];
      const cur = g[i];
      const gap = cur.bounds!.x - (prev.bounds!.x + prev.bounds!.width);
      const cw = Math.max(4, (prev.bounds!.width + cur.bounds!.width) / 2 || 8);
      const glue = [...prev.text.trim()].length <= 2 && [...cur.text.trim()].length <= 2;
      if (!glue && gap > cw * 0.85 && text && cur.text.trim()) text += ' ';
      text += glueSpacedLetters(cur.text);
      bounds = unionBounds(bounds, cur.bounds!);
    }
    return { text: glueSpacedLetters(text), bounds };
  });
  return merged.concat(without.map((l) => ({ ...l, text: glueSpacedLetters(l.text) })));
}

export function finalizeOcrLines(lines: OcrTextLine[]): { lines: OcrTextLine[]; text: string } {
  const merged = mergeGlyphBoxes(lines.map((l) => ({ ...l, text: glueSpacedLetters(l.text) })));
  const glyphHeavy =
    merged.length >= 3 &&
    merged.filter((l) => [...(l.text || '').trim()].length <= 1).length / merged.length >= 0.7;
  const joined = merged
    .map((l) => l.text)
    .filter(Boolean)
    .join(glyphHeavy ? '' : '\n')
    .trim();
  const text = glyphHeavy ? glueSpacedLetters(joined) : joined;
  return { lines: merged, text };
}
