/**
 * One page model for every OCR engine, and the layout analysis that turns an engine's text
 * lines into reading order: words into lines, lines into paragraphs and blocks, blocks into
 * columns.
 *
 * Every engine maps its output to `OcrRawPage` (boxes in image pixels, as four corners in the
 * text's own reading direction), and `buildOcrPage` does the rest the same way on every
 * platform. The shape follows hOCR and ALTO: page, block (hOCR ocr_carea, ALTO TextBlock),
 * paragraph (ocr_par), line (ocr_line, TextLine) and word (ocrx_word, String) with a confidence
 * (x_wconf, WC).
 *
 * Layout steps:
 * 1. Deskew: the dominant reading direction of the lines defines a page frame, so a photo of a
 *    page taken at an angle groups the same way as a flat scan. A page of vertical lines
 *    (CJK written top to bottom) uses a frame turned a quarter, where its columns read right
 *    to left.
 * 2. Rows: fragments of one visual line (engines split a line at wide gaps) are joined unless
 *    the gap between them is a column gutter, a white channel that the lines above and below
 *    do not cross either.
 * 3. Blocks: lines stacked under each other with ordinary line spacing, overlapping
 *    horizontally and of similar height, form a block. A block splits into paragraphs at extra
 *    spacing, a first-line indent, a list marker, or a short line that ends a sentence.
 * 4. Reading order of blocks: Breuel's rule from OCRopus (2003). A comes before B when they
 *    overlap horizontally and A is above, or when A is left of B and no other block lies
 *    between them vertically while spanning both. A topological sort gives the order, which
 *    reads a column to its end before the next column and puts a full-width title first.
 */

export type OcrPoint = [number, number];
/** Corners in the text's reading direction: start-top, end-top, end-bottom, start-bottom. */
export type OcrQuad = [OcrPoint, OcrPoint, OcrPoint, OcrPoint];

export interface OcrRawWord {
  text: string;
  quad: OcrQuad;
  /** 0..1; omitted or 0 when the engine gives none. */
  confidence?: number;
}

export interface OcrRawLine {
  text: string;
  quad: OcrQuad;
  confidence?: number;
  /** The engine's own word boxes, when it gives them (ML Kit, Vision, PP-OCR CTC columns). */
  words?: OcrRawWord[];
  /** The engine's block, when it groups lines (ML Kit). Lines of different blocks never join into one line. */
  block?: number;
}

export interface OcrRawPage {
  width: number;
  height: number;
  engine: string;
  lines: OcrRawLine[];
}

export interface OcrWord {
  text: string;
  quad: OcrQuad;
  confidence?: number;
  /** The box was estimated from the line, not given by the engine. */
  estimated: boolean;
}

export interface OcrLine {
  id: number;
  text: string;
  quad: OcrQuad;
  /** Reading direction in radians, clockwise from the x axis (image y points down). */
  angle: number;
  /** Text height in image pixels (the box's thickness across the reading direction). */
  size: number;
  confidence?: number;
  words: OcrWord[];
  /** CJK written top to bottom: render upright glyphs in a vertical line. */
  vertical: boolean;
  /** True when every word box came from the line estimate. */
  /** What follows each word but the last: a space or nothing. */
  joins: string[];
  estimated: boolean;
}

export interface OcrParagraph {
  lines: OcrLine[];
}

export interface OcrBlock {
  paragraphs: OcrParagraph[];
}

export interface OcrPage {
  width: number;
  height: number;
  engine: string;
  /** Dominant reading direction (radians). */
  angle: number;
  blocks: OcrBlock[];
}

/** Below this the view marks a word as unsure. Engines that give no score are never marked. */
export const OCR_UNSURE = 0.6;

const CJK = /[\u2E80-\u2FFF\u3005-\u3007\u3021-\u3029\u3040-\u30FF\u3100-\u312F\u3190-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF66-\uFF9F]/;
const CJK_PUNCT = /[\u3000-\u3004\u3008-\u3020\u30FB\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/;

export function isCjkChar(c: string): boolean {
  return CJK.test(c) || CJK_PUNCT.test(c);
}

export function isUnsure(confidence: number | undefined): boolean {
  return typeof confidence === 'number' && confidence > 0 && confidence < OCR_UNSURE;
}

// ---------------------------------------------------------------------------------------------
// Geometry

function dist(a: OcrPoint, b: OcrPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function quadAngle(q: OcrQuad): number {
  const dx = q[1][0] - q[0][0] + (q[2][0] - q[3][0]);
  const dy = q[1][1] - q[0][1] + (q[2][1] - q[3][1]);
  return Math.atan2(dy, dx);
}

export function quadLength(q: OcrQuad): number {
  return (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
}

export function quadThickness(q: OcrQuad): number {
  return (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
}

export function quadBounds(q: OcrQuad): { x: number; y: number; width: number; height: number } {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Axis-aligned box as a quad (left to right). */
export function rectQuad(x: number, y: number, width: number, height: number): OcrQuad {
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
}

/** Point at fraction t along the line and s across it (0 top, 1 bottom). */
function lerpQuad(q: OcrQuad, t: number, s: number): OcrPoint {
  const top: OcrPoint = [q[0][0] + (q[1][0] - q[0][0]) * t, q[0][1] + (q[1][1] - q[0][1]) * t];
  const bot: OcrPoint = [q[3][0] + (q[2][0] - q[3][0]) * t, q[3][1] + (q[2][1] - q[3][1]) * t];
  return [top[0] + (bot[0] - top[0]) * s, top[1] + (bot[1] - top[1]) * s];
}

/** Part of a line box between fractions t0 and t1 of its length. */
export function subQuad(q: OcrQuad, t0: number, t1: number): OcrQuad {
  return [lerpQuad(q, t0, 0), lerpQuad(q, t1, 0), lerpQuad(q, t1, 1), lerpQuad(q, t0, 1)];
}

function normAngle(a: number): number {
  let r = a;
  while (r <= -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

function validQuad(q: unknown): q is OcrQuad {
  return (
    Array.isArray(q) &&
    q.length === 4 &&
    q.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
  );
}

function cleanQuad(q: OcrQuad): OcrQuad {
  return q.map((p) => [Number(p[0]), Number(p[1])]) as OcrQuad;
}

/** Rect of a quad in the page frame (rotated by -angle). */
type FRect = { l: number; r: number; t: number; b: number; cy: number; h: number };

function frameRect(q: OcrQuad, cos: number, sin: number, size: number): FRect {
  // Horizontal extent from the corners; vertical position from the centre and the text height,
  // so a line that is slightly tilted against the page (a photo in perspective) does not grow taller.
  let l = Infinity, r = -Infinity, cy = 0;
  for (const [x, y] of q) {
    const fx = x * cos + y * sin;
    l = Math.min(l, fx);
    r = Math.max(r, fx);
    cy += (-x * sin + y * cos) / 4;
  }
  const h = Math.max(1, size);
  return { l, r, t: cy - h / 2, b: cy + h / 2, cy, h };
}

function unionRect(a: FRect, b: FRect): FRect {
  const t = Math.min(a.t, b.t);
  const bb = Math.max(a.b, b.b);
  return { l: Math.min(a.l, b.l), r: Math.max(a.r, b.r), t, b: bb, cy: (t + bb) / 2, h: Math.max(a.h, b.h) };
}

/** A row fragment joined to another keeps the centre and height of the pair, not their union. */
function rowRect(a: FRect, b: FRect): FRect {
  const cy = (a.cy + b.cy) / 2;
  const h = Math.max(a.h, b.h);
  return { l: Math.min(a.l, b.l), r: Math.max(a.r, b.r), t: cy - h / 2, b: cy + h / 2, cy, h };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------------------------------------
// Words

/** Rough advance width in em for a proportional sans, to place words when the engine gives only a line box. */
function advanceEm(c: string): number {
  if (isCjkChar(c)) return 1;
  if (/\s/.test(c)) return 0.3;
  if (/[ijl.,:;'’!|]/.test(c)) return 0.28;
  if (/[frtI()[\]\-"]/.test(c)) return 0.38;
  if (/[mw]/.test(c)) return 0.85;
  if (/[MW@%]/.test(c)) return 0.92;
  if (/[0-9]/.test(c)) return 0.56;
  if (/[a-z]/.test(c)) return 0.54;
  if (/[A-Z]/.test(c)) return 0.66;
  return 0.58;
}

/** Words of a line, split at spaces; CJK runs split per character, as readers and dictionaries treat them. */
export function splitWords(text: string): { text: string; start: number; end: number }[] {
  const chars = [...text];
  const out: { text: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) {
      i++;
      continue;
    }
    if (isCjkChar(chars[i])) {
      out.push({ text: chars[i], start: i, end: i + 1 });
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && !/\s/.test(chars[j]) && !isCjkChar(chars[j])) j++;
    out.push({ text: chars.slice(i, j).join(''), start: i, end: j });
    i = j;
  }
  return out;
}

function estimateWords(text: string, quad: OcrQuad, confidence: number | undefined): OcrWord[] {
  const chars = [...text];
  const widths = chars.map(advanceEm);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const pos: number[] = [0];
  for (const w of widths) pos.push(pos[pos.length - 1] + w / total);
  return splitWords(text).map((w) => ({
    text: w.text,
    quad: subQuad(quad, pos[w.start], pos[w.end]),
    confidence,
    estimated: true,
  }));
}

/** Gap from the end of word a to the start of word b along the reading direction, in text heights. */
function wordGap(a: OcrWord, b: OcrWord, angle: number, size: number): number {
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const aEnd = Math.max(a.quad[1][0] * ux + a.quad[1][1] * uy, a.quad[2][0] * ux + a.quad[2][1] * uy);
  const bStart = Math.min(b.quad[0][0] * ux + b.quad[0][1] * uy, b.quad[3][0] * ux + b.quad[3][1] * uy);
  return (bStart - aEnd) / Math.max(1, size);
}

/**
 * What goes between two words of one line. Engines separate words at spaces, so two
 * non-CJK words always get one; two CJK characters never do; where CJK meets other script
 * the gap decides, because Chinese and Japanese text may or may not space Latin words.
 */
export function wordJoiner(prev: string, next: string, gapInHeights: number): string {
  const a = [...prev].pop() || '';
  const b = [...next][0] || '';
  const ca = isCjkChar(a), cb = isCjkChar(b);
  if (ca && cb) return '';
  if (ca || cb) return gapInHeights >= 0.15 ? ' ' : '';
  return ' ';
}


// ---------------------------------------------------------------------------------------------
// Page

type Work = {
  line: OcrLine;
  rect: FRect;
  block?: number;
  /** Font size estimate: the line's length over its characters' typical advance. */
  em: number;
};

function emOf(line: OcrLine): number {
  const adv = [...line.text].reduce((s, c) => s + advanceEm(c), 0);
  const len = quadLength(line.quad);
  // Short labels say little about pitch.
  if ([...line.text.replace(/\s/g, '')].length < 4 || adv <= 0) return NaN;
  return len / adv;
}

/** Same type size and style, judged by both height and character pitch. */
function similarSize(a: Work, b: Work): boolean {
  const h = Math.max(a.rect.h, b.rect.h) / Math.max(1, Math.min(a.rect.h, b.rect.h));
  const pitched = Number.isFinite(a.em) && Number.isFinite(b.em);
  const em = pitched ? Math.max(a.em, b.em) / Math.max(0.1, Math.min(a.em, b.em)) : NaN;
  // A footnote mark or an accent makes one line's box taller; the character pitch still matches.
  if (pitched && em <= 1.15 && h <= 1.6) return true;
  if (h > 1.3) return false;
  return !pitched || em <= 1.25;
}

function centre(q: OcrQuad): OcrPoint {
  return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
}

/**
 * Put a line box's corners in reading order. Some engines give every box upright (top-left
 * first) even for a column of vertical text; the words' order, or for a box without words a
 * shape at least 1.5 times taller than wide (PaddleOCR's own rule), shows the text runs down.
 */
function orientQuad(q: OcrQuad, words: OcrRawWord[] | undefined, text: string): OcrQuad {
  const len = quadLength(q), thick = quadThickness(q);
  let down = false;
  const ws = (words || []).filter((w) => validQuad(w.quad));
  if (ws.length >= 2) {
    const a = centre(cleanQuad(ws[0].quad)), b = centre(cleanQuad(ws[ws.length - 1].quad));
    const run = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const along = quadAngle(q);
    down = Math.abs(normAngle(run - along - Math.PI / 2)) < Math.PI / 4;
  } else {
    down = thick >= 1.5 * len && [...text.replace(/\s/g, '')].length >= 2;
  }
  return down ? [q[1], q[2], q[3], q[0]] : q;
}

/**
 * What separates each pair of the engine's words, read from the engine's own line text where
 * the words can be found in it; else judged from the gap.
 */
function wordJoins(words: OcrWord[], text: string, angle: number, size: number): string[] {
  const joins: string[] = [];
  let at = 0;
  let found = !!text;
  const ends: number[] = [];
  const starts: number[] = [];
  for (const w of words) {
    if (!found) break;
    const i = text.indexOf(w.text, at);
    if (i < 0) found = false;
    else {
      starts.push(i);
      ends.push(i + w.text.length);
      at = i + w.text.length;
    }
  }
  for (let k = 1; k < words.length; k++) {
    const a = words[k - 1].text, b = words[k].text;
    let j: string;
    if (found) j = /\s/.test(text.slice(ends[k - 1], starts[k])) ? ' ' : '';
    else j = wordJoiner(a, b, wordGap(words[k - 1], words[k], angle, size));
    const ca = isCjkChar([...a].pop() || ''), cb = isCjkChar([...b][0] || '');
    if (ca && cb) j = '';
    // Engines run CJK into Latin or digits across a wide gap (a date set apart from a title).
    else if (!j && ca !== cb && wordGap(words[k - 1], words[k], angle, size) >= 0.5) j = ' ';
    joins.push(j);
  }
  return joins;
}

function makeLine(raw: OcrRawLine, id: number): OcrLine | null {
  if (!validQuad(raw.quad)) return null;
  const text = String(raw.text || '').replace(/\s+/g, ' ').trim();
  const quad = orientQuad(cleanQuad(raw.quad), raw.words, text);
  const angle = quadAngle(quad);
  const size = Math.max(1, quadThickness(quad));
  const conf = Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : undefined;
  let words: OcrWord[] = [];
  let estimated = false;
  if (Array.isArray(raw.words) && raw.words.length) {
    const ux = Math.cos(angle), uy = Math.sin(angle);
    words = raw.words
      .filter((w) => w && String(w.text || '').trim() && validQuad(w.quad))
      .map((w) => {
        const wq = cleanQuad(w.quad);
        return {
          text: String(w.text).trim(),
          // A word box given upright on a vertical line turns with its line.
          quad: Math.abs(normAngle(quadAngle(wq) - angle)) > Math.PI / 4 ? ([wq[1], wq[2], wq[3], wq[0]] as OcrQuad) : wq,
          confidence: Number.isFinite(Number(w.confidence)) ? Number(w.confidence) : conf,
          estimated: false,
        };
      })
      .sort((a, b) => {
        const ca = centre(a.quad), cb = centre(b.quad);
        return ca[0] * ux + ca[1] * uy - (cb[0] * ux + cb[1] * uy);
      });
  }
  if (!words.length) {
    if (!text) return null;
    words = estimateWords(text, quad, conf);
    estimated = true;
  }
  if (!words.length) return null;
  const joins = wordJoins(words, text, angle, size);
  const joined = words.map((w, i) => (i ? joins[i - 1] : '') + w.text).join('');
  const cjk = [...joined].filter(isCjkChar).length;
  const vertical = Math.abs(normAngle(angle) - Math.PI / 2) < 0.35 && cjk >= [...joined.replace(/\s/g, '')].length * 0.5;
  return { id, text: joined, quad, angle, size, confidence: conf, words, joins, vertical, estimated };
}

/** Dominant reading direction: the length-weighted circular median of line angles, snapped to the nearest quarter for vertical pages. */
function dominantAngle(lines: OcrLine[]): number {
  if (!lines.length) return 0;
  // Weighted vote in 2-degree bins over the full circle; reading directions differ by sign.
  const bins = new Map<number, number>();
  for (const l of lines) {
    const deg = Math.round((normAngle(l.angle) * 180) / Math.PI / 2) * 2;
    const w = quadLength(l.quad) * Math.max(1, [...l.text].length) ** 0.5;
    for (const d of [-2, 0, 2]) bins.set(deg + d, (bins.get(deg + d) || 0) + (d === 0 ? w : w / 2));
  }
  let best = 0, bestW = -1;
  for (const [deg, w] of bins) if (w > bestW) { best = deg; bestW = w; }
  // Refine with the mean of the lines near the winning bin.
  const near = lines.filter((l) => Math.abs(normAngle(l.angle - (best * Math.PI) / 180)) < (6 * Math.PI) / 180);
  if (!near.length) return (best * Math.PI) / 180;
  let sx = 0, sy = 0;
  for (const l of near) {
    const w = quadLength(l.quad);
    sx += Math.cos(l.angle) * w;
    sy += Math.sin(l.angle) * w;
  }
  return Math.atan2(sy, sx);
}

/** Join fragments of one visual line unless the gap between them is a column gutter. */
function joinRows(items: Work[], cos: number, sin: number): Work[] {
  const sorted = [...items].sort((a, b) => a.rect.cy - b.rect.cy);
  const rows: Work[][] = [];
  for (const it of sorted) {
    const row = rows.find((r) =>
      r.some((o) => {
        const h = Math.min(o.rect.h, it.rect.h);
        return (
          Math.abs(o.rect.cy - it.rect.cy) < 0.5 * h &&
          Math.max(o.rect.h, it.rect.h) / h < 1.6 &&
          Math.abs(normAngle(o.line.angle - it.line.angle)) < 0.18
        );
      }),
    );
    if (row) row.push(it);
    else rows.push([it]);
  }

  const crosses = (c: Work, g0: number, g1: number) => c.rect.l <= g0 + 1 && c.rect.r >= g1 - 1;
  const out: Work[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.rect.l - b.rect.l);
    let cur = row[0];
    for (let i = 1; i < row.length; i++) {
      const next = row[i];
      const h = Math.max(cur.rect.h, next.rect.h);
      const g0 = cur.rect.r, g1 = next.rect.l;
      const gap = g1 - g0;
      let join = gap > -0.5 * h && (cur.block === undefined || next.block === undefined || cur.block === next.block);
      if (join) {
        const span = { l: cur.rect.l, r: next.rect.r };
        const cy = (cur.rect.cy + next.rect.cy) / 2;
        let above: Work | null = null, below: Work | null = null;
        for (const c of items) {
          if (c === cur || c === next || row.includes(c)) continue;
          if (c.rect.r < span.l || c.rect.l > span.r) continue;
          if (Math.abs(c.rect.cy - cy) > 3 * h) continue;
          if (c.rect.cy < cy - 0.5 * h && (!above || c.rect.cy > above.rect.cy)) above = c;
          if (c.rect.cy > cy + 0.5 * h && (!below || c.rect.cy < below.rect.cy)) below = c;
        }
        const neighbours = [above, below].filter(Boolean) as Work[];
        const limit = neighbours.length ? 3 * h : 1.5 * h;
        join = gap < limit && neighbours.every((c) => crosses(c, g0, g1));
      }
      if (join) cur = mergeWork(cur, next, cos, sin);
      else {
        out.push(cur);
        cur = next;
      }
    }
    out.push(cur);
  }
  return out;
}

function mergeWork(a: Work, b: Work, cos: number, sin: number): Work {
  const la = a.line, lb = b.line;
  const words = [...la.words, ...lb.words];
  const quad: OcrQuad = [la.quad[0], lb.quad[1], lb.quad[2], la.quad[3]];
  const angle = quadAngle(quad);
  const size = (la.size * quadLength(la.quad) + lb.size * quadLength(lb.quad)) / Math.max(1, quadLength(la.quad) + quadLength(lb.quad));
  const gap = wordGap(la.words[la.words.length - 1], lb.words[0], angle, size);
  const sep = wordJoiner(la.text, lb.text, gap);
  const text = la.text + sep + lb.text;
  const confs = [la.confidence, lb.confidence].filter((c): c is number => typeof c === 'number');
  const line: OcrLine = {
    id: la.id,
    text,
    quad,
    angle,
    size,
    confidence: confs.length ? Math.min(...confs) : undefined,
    words,
    joins: [...la.joins, sep, ...lb.joins],
    vertical: la.vertical && lb.vertical,
    estimated: la.estimated && lb.estimated,
  };
  return { line, rect: rowRect(a.rect, b.rect), block: a.block ?? b.block, em: emOf(line) };
}

type BlockWork = { lines: Work[]; rect: FRect };

/** Stack lines into blocks: below each other, ordinary spacing, overlapping, similar height. */
function stackBlocks(items: Work[]): BlockWork[] {
  const sorted = [...items].sort((a, b) => a.rect.t - b.rect.t || a.rect.l - b.rect.l);
  const blocks: BlockWork[] = [];
  const done: Work[] = [];
  for (const it of sorted) {
    let best: BlockWork | null = null;
    let bestScore = Infinity;
    for (const b of blocks) {
      const p = b.lines[b.lines.length - 1];
      const h = Math.min(p.rect.h, it.rect.h);
      if (!similarSize(p, it)) continue;
      if (it.rect.cy < p.rect.cy + 0.6 * h) continue;
      const gap = it.rect.t - p.rect.b;
      if (gap < -0.45 * h || gap > 1.1 * h) continue;
      const ov = Math.min(p.rect.r, it.rect.r) - Math.max(p.rect.l, it.rect.l);
      const minW = Math.min(p.rect.r - p.rect.l, it.rect.r - it.rect.l);
      if (ov <= 0 || ov < 0.35 * minW) continue;
      if (Math.abs(normAngle(p.line.angle - it.line.angle)) > 0.2) continue;
      // Nothing already placed may sit between the block's last line and this one.
      const between = done.some(
        (o) =>
          o !== p &&
          !b.lines.includes(o) &&
          o.rect.cy > p.rect.cy + 0.3 * h &&
          o.rect.cy < it.rect.cy - 0.3 * h &&
          Math.min(o.rect.r, it.rect.r) - Math.max(o.rect.l, it.rect.l) > 0,
      );
      if (between) continue;
      const score = gap - ov / Math.max(1, minW);
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) {
      best.lines.push(it);
      best.rect = unionRect(best.rect, it.rect);
    } else {
      blocks.push({ lines: [it], rect: { ...it.rect } });
    }
    done.push(it);
  }
  return blocks;
}

const LIST_MARK = /^(?:[•●○◦▪■□‣∙·・]\s?|[\-–—*]\s|\(?\d{1,3}[.)、](?!\d)\s?|\(?[a-zA-Z][.)]\s|[①-⑳]|[一二三四五六七八九十]+、)/;
const SENTENCE_END = /[.!?。！？:：…"”’)）」』]$/;

const OPENERS = /^[(\[{“‘"'（《〈「『【〔｛]+$/;

/** Length of the line's first word: engine words joined without a space form one word, except CJK, which breaks anywhere. */
function firstWordLength(w: Work): number {
  const { words, joins, angle } = w.line;
  if (!words.length) return w.line.size;
  let k = 0;
  // An opening bracket or quote never ends a line, so it wraps with the word after it.
  if (k + 1 < words.length && OPENERS.test(words[0].text)) k++;
  while (
    k + 1 < words.length &&
    joins[k] === '' &&
    !isCjkChar([...words[k].text].pop() || '') &&
    !isCjkChar([...words[k + 1].text][0] || '')
  ) k++;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const proj = (p: OcrPoint) => p[0] * ux + p[1] * uy;
  const a = Math.min(proj(words[0].quad[0]), proj(words[0].quad[3]));
  const b = Math.max(proj(words[k].quad[1]), proj(words[k].quad[2]));
  return Math.max(0, b - a);
}

/** Split a block into paragraphs at extra spacing, a first-line indent, a list marker, or a short line that ends a sentence. */
function splitParagraphs(block: BlockWork): Work[][] {
  const lines = block.lines;
  if (lines.length < 2) return [lines];
  // Line pitch (centre to centre) is steadier than edge gaps, whose boxes vary with ascenders.
  const pitches: number[] = [];
  for (let i = 1; i < lines.length; i++) pitches.push(lines[i].rect.cy - lines[i - 1].rect.cy);
  const g = median(pitches);
  const lefts = lines.map((l) => l.rect.l);
  const left = median(lefts);
  const h = median(lines.map((l) => l.rect.h));
  // The right margin each line wrapped at. Text that flows beside a picture and then below it
  // wraps at two widths in one block; measured against the block's widest line, every line beside
  // the picture would look short. So the block is cut into runs where the margin moves for good,
  // and each line is measured against the widest line of its own run. The margin moves out when
  // two of three lines end at it (the third may be a paragraph's short last line) and the next
  // two both end well past it; it moves in when three long lines end together well short of it.
  // A wrapped line ends within about one word of its margin: a few letters for Latin text, one
  // character for CJK, which wraps anywhere.
  const em0 = median(lines.map((l) => (Number.isFinite(l.em) ? l.em : l.rect.h)));
  const tol = 2 * Math.max(em0, median(lines.map(firstWordLength)));
  const rs = (ws: Work[]) => ws.map((w) => w.rect.r);
  const steady = (ws: Work[]) => ws.length === 3 && Math.max(...rs(ws)) - Math.min(...rs(ws)) <= tol;
  const runOf: number[] = lines.map(() => 0);
  let run = 0, runStart = 0;
  for (let i = 1; i < lines.length; i++) {
    const before = lines.slice(Math.max(runStart, i - 3), i);
    const after = lines.slice(i, i + 3);
    const margin = Math.max(...rs(before));
    const atMargin = before.filter((w) => w.rect.r >= margin - tol).length;
    const outward = before.length === 3 && atMargin >= 2 && after.length >= 2 && rs(after.slice(0, 2)).every((r) => r > margin + tol);
    const inward = steady(after) && after.every((w) => w.rect.r - w.rect.l >= 18 * em0 && w.rect.r < margin - tol);
    if (outward || inward) {
      run++;
      runStart = i;
    }
    runOf[i] = run;
  }
  const runEdge = new Map<number, { right: number; width: number }>();
  for (let k = 0; k <= run; k++) {
    const ws = lines.filter((_, i) => runOf[i] === k);
    const r = Math.max(...ws.map((w) => w.rect.r));
    runEdge.set(k, { right: r, width: r - Math.min(...ws.map((w) => w.rect.l)) });
  }
  const indented = (w: Work) => w.rect.l - left > 0.9 * h;
  const indentCount = lines.filter(indented).length;
  // Every line opens with a capital, a digit or a list mark and none runs on with a comma or a
  // hyphen: a list or a stack of headings, one item per line.
  if (
    lines.length >= 3 &&
    lines.every((l) => /^[\p{Lu}\p{N}]/u.test(l.line.text) || LIST_MARK.test(l.line.text)) &&
    lines.every((l) => !/[,;\-]$/.test(l.line.text))
  ) {
    return lines.map((l) => [l]);
  }
  const paras: Work[][] = [[lines[0]]];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i - 1], l = lines[i];
    const { right, width } = runEdge.get(runOf[i - 1])!;
    // Character pitch of the next line; a short label has none, so its text height stands in.
    const em = Number.isFinite(l.em) ? l.em : l.rect.h;
    let brk = false;
    if (pitches[i - 1] - g > 0.4 * h) brk = true;
    else if (LIST_MARK.test(l.line.text)) brk = true;
    else if (lines.length >= 3 && indented(l) && !indented(p) && indentCount < lines.length / 2) brk = true;
    else if (right - p.rect.r > Math.max(2.5 * h, 0.18 * width) && SENTENCE_END.test(p.line.text)) brk = true;
    // The next line's first word would have fitted at the end of this one: the writer broke the line on purpose.
    else if (right - p.rect.r > firstWordLength(l) + 0.8 * em && !HYPHEN_END.test(p.line.text)) brk = true;
    // A short line with no closing punctuation followed by a capital: a list or a heading, not wrapped prose.
    else if (
      p.rect.r - p.rect.l < 0.85 * width &&
      /^\p{Lu}/u.test(l.line.text) &&
      !/[,;\-]$/.test(p.line.text)
    ) brk = true;
    if (brk) paras.push([l]);
    else paras[paras.length - 1].push(l);
  }
  return paras;
}

/**
 * Reading order: first cut the page across its full width wherever a wide band of white runs
 * from edge to edge (a slide's footer, a page's header), as an XY-cut does, then order the
 * blocks of each band with Breuel's rule.
 */
function readingOrder(blocks: BlockWork[]): BlockWork[] {
  if (blocks.length < 2) return blocks;
  const lineH = median(blocks.flatMap((b) => b.lines.map((l) => l.rect.h)));
  const sorted = [...blocks].sort((a, b) => a.rect.t - b.rect.t);
  const bands: BlockWork[][] = [];
  let bottom = -Infinity;
  for (const b of sorted) {
    if (!bands.length || b.rect.t - bottom > 1.5 * lineH) bands.push([b]);
    else bands[bands.length - 1].push(b);
    bottom = Math.max(bottom, b.rect.b);
  }
  return bands.flatMap(breuelOrder);
}

/** Breuel's reading order (OCRopus): topological sort of "comes before" between blocks. */
function breuelOrder(blocks: BlockWork[]): BlockWork[] {
  const n = blocks.length;
  if (n < 2) return blocks;
  const initial = blocks
    .map((b, i) => ({ b, i }))
    .sort((a, c) => a.b.rect.t - c.b.rect.t || a.b.rect.l - c.b.rect.l)
    .map((x) => x.i);
  const R = blocks.map((b) => b.rect);
  const xOverlap = (u: FRect, v: FRect) => Math.min(u.r, v.r) - Math.max(u.l, v.l) > 0.1 * Math.min(u.r - u.l, v.r - v.l, u.h, v.h);
  const separates = (w: FRect, u: FRect, v: FRect) => {
    if (w.b < Math.min(u.t, v.t)) return false;
    if (w.t > Math.max(u.b, v.b)) return false;
    return w.l < u.r && w.r > v.l;
  };
  const before: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const u = R[i], v = R[j];
      if (xOverlap(u, v)) {
        if (u.cy < v.cy) before[i][j] = true;
      } else if (u.r <= v.l + 0.1 * Math.min(u.h, v.h)) {
        let sep = false;
        for (let k = 0; k < n && !sep; k++) if (k !== i && k !== j && separates(R[k], u, v)) sep = true;
        if (!sep) before[i][j] = true;
      }
    }
  }
  const visited = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const visit = (k: number) => {
    if (visited[k]) return;
    visited[k] = true;
    for (const l of initial) if (before[l][k]) visit(l);
    order.push(k);
  };
  for (const k of initial) visit(k);
  return order.map((k) => blocks[k]);
}

/**
 * Build the page model from any engine's lines: deskew, join row fragments, stack blocks,
 * split paragraphs, and order blocks for reading. Text the engine was unsure about is kept.
 */
export function buildOcrPage(raw: OcrRawPage): OcrPage {
  const width = Math.max(1, Number(raw?.width) || 1);
  const height = Math.max(1, Number(raw?.height) || 1);
  const engine = String(raw?.engine || 'unknown');
  const made: { line: OcrLine; block?: number }[] = [];
  (Array.isArray(raw?.lines) ? raw.lines : []).forEach((r, i) => {
    const line = makeLine(r, i);
    if (line) made.push({ line, block: typeof r.block === 'number' ? r.block : undefined });
  });
  if (!made.length) return { width, height, engine, angle: 0, blocks: [] };

  const angle = dominantAngle(made.map((m) => m.line));
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let items: Work[] = made.map((m) => ({ line: m.line, rect: frameRect(m.line.quad, cos, sin, m.line.size), block: m.block, em: emOf(m.line) }));
  items = joinRows(items, cos, sin);
  const blocks = readingOrder(stackBlocks(items));
  let id = 0;
  return {
    width,
    height,
    engine,
    angle,
    blocks: blocks.map((b) => ({
      paragraphs: splitParagraphs(b).map((p) => ({
        lines: p.map((w) => ({ ...w.line, id: id++ })),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Text

export function pageLines(page: OcrPage): OcrLine[] {
  return page.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
}

export type OcrEdits = ReadonlyMap<number, string>;

export function lineText(line: OcrLine, edits?: OcrEdits): string {
  const e = edits?.get(line.id);
  return (e === undefined ? line.text : e).replace(/\s+/g, ' ').trim();
}

const HYPHEN_END = /\p{L}[-\u2010\u00AD]$/u;

/**
 * How two lines of a paragraph join: a word broken with a hyphen at the line end rejoins
 * (unless the page spells it with the hyphen elsewhere, as for "well-known"), CJK lines join
 * without a space, anything else with one space.
 */
export function lineJoin(prev: string, next: string, hyphenated?: ReadonlySet<string>): { cut: number; sep: string } {
  if (!prev || !next) return { cut: 0, sep: prev && next ? ' ' : '' };
  const a = [...prev].pop() || '';
  const b = [...next][0] || '';
  if (HYPHEN_END.test(prev) && /^\p{Ll}/u.test(next)) {
    const head = (prev.match(/(\p{L}+)[-\u2010\u00AD]$/u) || [])[1] || '';
    const tail = (next.match(/^\p{L}+/u) || [])[0] || '';
    if (hyphenated && head && tail && hyphenated.has(`${head}-${tail}`.toLowerCase())) return { cut: 0, sep: '' };
    return { cut: 1, sep: '' };
  }
  if (isCjkChar(a) && isCjkChar(b)) return { cut: 0, sep: '' };
  return { cut: 0, sep: ' ' };
}

/** Hyphenated compounds written inside a line on this page ("well-known"), lower-cased. */
export function pageHyphenated(page: OcrPage, edits?: OcrEdits): Set<string> {
  const out = new Set<string>();
  for (const l of pageLines(page)) {
    for (const m of lineText(l, edits).matchAll(/(\p{L}+)-(\p{L}+)/gu)) out.add(`${m[1]}-${m[2]}`.toLowerCase());
  }
  return out;
}

export function paragraphText(p: OcrParagraph, edits?: OcrEdits, hyphenated?: ReadonlySet<string>): string {
  let out = '';
  for (const l of p.lines) {
    const t = lineText(l, edits);
    if (!t) continue;
    if (!out) {
      out = t;
      continue;
    }
    const j = lineJoin(out, t, hyphenated);
    out = (j.cut ? [...out].slice(0, -j.cut).join('') : out) + j.sep + t;
  }
  return out;
}

/** The whole page in reading order: one paragraph per line of text. */
export function ocrPageText(page: OcrPage, edits?: OcrEdits): string {
  const hy = pageHyphenated(page, edits);
  return page.blocks
    .flatMap((b) => b.paragraphs.map((p) => paragraphText(p, edits, hy)))
    .filter(Boolean)
    .join('\n');
}

/**
 * Text of a selection that covers words of the page, given as the first and last selected
 * (line id, word index, character offsets). Joins exactly like `ocrPageText`, so a selected
 * paragraph copies as its sentence.
 */
export function ocrRangeText(
  page: OcrPage,
  from: { line: number; word: number; offset: number },
  to: { line: number; word: number; offset: number },
  edits?: OcrEdits,
): string {
  const hy = pageHyphenated(page, edits);
  const order = pageLines(page).map((l) => l.id);
  const fi = order.indexOf(from.line), ti = order.indexOf(to.line);
  if (fi < 0 || ti < 0) return '';
  const [a, b] = fi < ti || (fi === ti && from.word <= to.word) ? [from, to] : [to, from];
  const parts: string[] = [];
  for (const block of page.blocks) {
    for (const par of block.paragraphs) {
      let out = '';
      for (const line of par.lines) {
        const idx = order.indexOf(line.id);
        if (idx < order.indexOf(a.line) || idx > order.indexOf(b.line)) continue;
        let t: string;
        if (edits?.has(line.id)) {
          t = lineText(line, edits);
        } else {
          const ws = line.words.map((w) => w.text);
          const w0 = line.id === a.line ? a.word : 0;
          const w1 = line.id === b.line ? b.word : ws.length - 1;
          const pieces: string[] = [];
          for (let k = w0; k <= w1 && k < ws.length; k++) {
            let w = ws[k];
            if (line.id === b.line && k === w1) w = [...w].slice(0, b.offset).join('');
            if (line.id === a.line && k === w0) w = [...w].slice(a.offset).join('');
            if (k > w0) {
              pieces.push(line.joins[k - 1] ?? ' ');
            }
            pieces.push(w);
          }
          t = pieces.join('').trim();
        }
        if (!t) continue;
        if (!out) out = t;
        else {
          const j = lineJoin(out, t, hy);
          out = (j.cut ? [...out].slice(0, -j.cut).join('') : out) + j.sep + t;
        }
      }
      if (out) parts.push(out);
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Engine adapters shared by several platforms

/** Phone engines before this model: words as fractions of the picture with a line number. */
export type LegacyScanWord = { t: string; x: number; y: number; w: number; h: number; l?: number };

export function rawFromLegacyWords(words: LegacyScanWord[], width: number, height: number, engine: string): OcrRawPage {
  const byLine = new Map<number, LegacyScanWord[]>();
  (words || []).forEach((w, i) => {
    if (!w || !w.t || !(w.w > 0) || !(w.h > 0)) return;
    const k = typeof w.l === 'number' ? w.l : -1 - i;
    const arr = byLine.get(k) || [];
    arr.push(w);
    byLine.set(k, arr);
  });
  const lines: OcrRawLine[] = [];
  for (const ws of byLine.values()) {
    const rw: OcrRawWord[] = ws.map((w) => ({ text: w.t, quad: rectQuad(w.x * width, w.y * height, w.w * width, w.h * height) }));
    const xs = rw.flatMap((w) => w.quad.map((p) => p[0]));
    const ys = rw.flatMap((w) => w.quad.map((p) => p[1]));
    const x = Math.min(...xs), y = Math.min(...ys);
    lines.push({ text: ws.map((w) => w.t).join(' '), quad: rectQuad(x, y, Math.max(...xs) - x, Math.max(...ys) - y), words: rw });
  }
  return { width, height, engine, lines };
}

/** Phone engines: lines with normalised quads (q: 8 numbers, x0 y0 … x3 y3 as fractions), words likewise. */
export type NativeScanLine = { t: string; q: number[]; c?: number; b?: number; w?: { t: string; q: number[]; c?: number }[] };

function nativeQuad(q: number[] | undefined, width: number, height: number): OcrQuad | null {
  if (!Array.isArray(q) || q.length < 8 || q.some((n) => !Number.isFinite(Number(n)))) return null;
  return [
    [q[0] * width, q[1] * height],
    [q[2] * width, q[3] * height],
    [q[4] * width, q[5] * height],
    [q[6] * width, q[7] * height],
  ];
}

export function rawFromNativeLines(lines: NativeScanLine[], width: number, height: number, engine: string): OcrRawPage {
  const out: OcrRawLine[] = [];
  for (const l of lines || []) {
    const quad = nativeQuad(l?.q, width, height);
    if (!quad || !String(l.t || '').trim()) continue;
    const words: OcrRawWord[] = [];
    for (const w of l.w || []) {
      const wq = nativeQuad(w?.q, width, height);
      if (wq && String(w.t || '').trim()) words.push({ text: String(w.t), quad: wq, confidence: w.c });
    }
    out.push({ text: String(l.t), quad, confidence: l.c, block: l.b, words: words.length ? words : undefined });
  }
  return { width, height, engine, lines: out };
}
