/**
 * Translating a scanned picture in place, as Google Lens, Google Translate's camera, Apple's Live
 * Text and Microsoft Translator do: each paragraph is translated as a whole, so sentences read
 * naturally, and the translation is reflowed inside the area the paragraph's lines covered,
 * shrunk until it fits rather than spilling over.
 *
 * Nothing here touches the DOM; ocr-view.ts paints the result and the hosts supply the engines.
 */

import {
  isCjkChar,
  lineText,
  pageHyphenated,
  paragraphText,
  quadThickness,
  type OcrEdits,
  type OcrLine,
  type OcrPage,
} from './ocr-layout';

/** The area a translation fills, in image pixels: top-left corner, size along and across the text, and turn. */
export interface OcrArea {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, clockwise from the x axis; 0 for vertical text. */
  angle: number;
}

/** What is translated and repainted as one piece: a paragraph as a rule (see translationGroups). */
export interface OcrUnit {
  /** Position in reading order. */
  index: number;
  lineIds: number[];
  text: string;
  /** What the paint covers: every line of the unit. */
  area: OcrArea;
  /** Where the translation is set: the area less any strip a neighbouring unit's area shares. */
  box: OcrArea;
  /** Written top to bottom (vertical CJK). */
  vertical: boolean;
  /** Font size and line pitch of the original, in image pixels. */
  size: number;
  pitch: number;
  /** Lines centred on a common axis rather than sharing a left edge. */
  align: 'start' | 'center';
  /**
   * For a one-line unit set across an unturned page: the free space beside it along the line,
   * before and after, up to the nearest text in its row or the page edge. A translation that
   * would otherwise shrink runs into it, as Google Lens lets a label's translation do.
   */
  room?: { before: number; after: number };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Font size of a line box of this thickness; the text layer uses the same share. */
export const FONT_SHARE = 0.74;

function lineArea(lines: OcrLine[], vertical: boolean): OcrArea {
  const pts = lines.flatMap((l) => l.quad);
  if (vertical) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, angle: 0 };
  }
  const a = median(lines.map((l) => l.angle));
  const ux = Math.cos(a), uy = Math.sin(a);
  // Coordinates along the text (u) and down it (v).
  const us = pts.map((p) => p[0] * ux + p[1] * uy);
  const vs = pts.map((p) => -p[0] * uy + p[1] * ux);
  const u0 = Math.min(...us), v0 = Math.min(...vs);
  return { x: u0 * ux - v0 * uy, y: u0 * uy + v0 * ux, w: Math.max(...us) - u0, h: Math.max(...vs) - v0, angle: a };
}

/** Whether a paragraph's lines are centred: their centres agree far better than their starts. */
function centred(lines: OcrLine[], area: OcrArea, vertical: boolean): boolean {
  if (lines.length < 2 || vertical) return false;
  const ux = Math.cos(area.angle), uy = Math.sin(area.angle);
  const span = lines.map((l) => {
    const us = l.quad.map((p) => p[0] * ux + p[1] * uy);
    return { start: Math.min(...us), end: Math.max(...us) };
  });
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const starts = spread(span.map((s) => s.start));
  const mids = spread(span.map((s) => (s.start + s.end) / 2));
  const size = median(lines.map((l) => quadThickness(l.quad)));
  return starts > size && mids < starts / 3;
}

/** Ends a sentence, a heading's colon, or a quotation. */
const SENTENCE_END = /[.!?:;…。！？：；」』”"')）]\s*$/u;
/**
 * Punctuation, which prose has and a list of names does not (engines misread some marks as
 * symbols, so those count too, but not currency signs: a menu's prices are not punctuation).
 */
const PROSE_MARK = /[\p{P}\p{Sm}\p{Sk}\p{So}]/u;

/**
 * The lines translated together, in reading order. Normally one paragraph each, with two
 * corrections so that a unit is a sentence or more and never two unrelated items:
 * - A paragraph that stops mid-sentence (no closing punctuation) is joined with the next
 *   paragraph of its block when that one starts in lower case: a centred slide or a short
 *   line can make the layout cut a sentence in two.
 * - A paragraph of several lines is a list, and each line its own unit, when it is CJK with no
 *   punctuation at all (a menu, a sign board), when one of its lines has no words (a column
 *   of a table, or prices: sent whole, the numbers would be reflowed off their rows and could
 *   come back changed), or when two of its lines read the same (a column of repeated cells).
 * - A group whose area would cover another group's text is split into its lines.
 */
export function translationGroups(page: OcrPage, edits?: OcrEdits): OcrLine[][] {
  const out: OcrLine[][] = [];
  const text = (lines: OcrLine[]) => lines.map((l) => lineText(l, edits)).join(' ');
  const list = (lines: OcrLine[], t: string) => {
    if (lines.length < 2) return false;
    const cjk = [...t].filter(isCjkChar).length > t.replace(/\s/g, '').length / 2;
    if (cjk && !PROSE_MARK.test(t)) return true;
    const each = lines.map((l) => lineText(l, edits).trim());
    return each.some((s) => !hasWords(s)) || new Set(each).size < each.length;
  };
  for (const b of page.blocks) {
    let prev: OcrLine[] | null = null;
    for (const p of b.paragraphs) {
      if (!p.lines.length) continue;
      const t = text(p.lines);
      if (list(p.lines, t)) {
        for (const l of p.lines) out.push([l]);
        prev = null;
        continue;
      }
      const horizontal = !p.lines.some((l) => l.vertical);
      if (prev && horizontal && !prev.some((l) => l.vertical) && !SENTENCE_END.test(text(prev)) && /^\p{Ll}/u.test(t)) {
        prev.push(...p.lines);
        continue;
      }
      prev = [...p.lines];
      out.push(prev);
    }
  }
  // A group whose area would cover another group's text (lines of a photographed board that
  // the layout joined across a neighbour) is painted line by line instead.
  // Measured in the group's own frame, so a page photographed at an angle is judged as if flat.
  const covered = (g: OcrLine[]) => {
    if (g.length < 2) return false;
    const vertical = g.every((l) => l.vertical);
    const a = lineArea(g, vertical);
    const ux = Math.cos(a.angle), uy = Math.sin(a.angle);
    return out.some(
      (o) =>
        o !== g &&
        o.some((l) => {
          const us = l.quad.map((p) => (p[0] - a.x) * ux + (p[1] - a.y) * uy);
          const vs = l.quad.map((p) => -(p[0] - a.x) * uy + (p[1] - a.y) * ux);
          const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
          const ox = Math.min(a.w, u1) - Math.max(0, u0), oy = Math.min(a.h, v1) - Math.max(0, v0);
          return ox > 0 && oy > 0 && ox * oy > 0.3 * (u1 - u0) * (v1 - v0);
        }),
    );
  };
  return out.flatMap((g) => (covered(g) ? g.map((l) => [l]) : [g]));
}

/** The page's units in reading order, each with the text to translate and the area it may fill. */
export function translationUnits(page: OcrPage, edits?: OcrEdits): OcrUnit[] {
  const hy = pageHyphenated(page, edits);
  const out: OcrUnit[] = [];
  for (const lines of translationGroups(page, edits)) {
    const vertical = lines.every((l) => l.vertical);
    const area = lineArea(lines, vertical);
    // The lower median: an engine pads some boxes (a line with inline code, a lone short line), never shrinks them.
    const ths = lines.map((l) => quadThickness(l.quad)).sort((a, b) => a - b);
    const th = ths[(ths.length - 1) >> 1];
    const size = th * FONT_SHARE;
    // Line pitch: distance between consecutive lines' centres across the text.
    const centres = lines.map((l) => {
      const cx = l.quad.reduce((s, q) => s + q[0], 0) / 4, cy = l.quad.reduce((s, q) => s + q[1], 0) / 4;
      return vertical ? -cx : -cx * Math.sin(area.angle) + cy * Math.cos(area.angle);
    });
    const gaps = centres.slice(1).map((c, i) => Math.abs(c - centres[i])).filter((g) => g > th * 0.5);
    const pitch = Math.min(size * 1.8, Math.max(size * 1.15, gaps.length ? median(gaps) : th * 1.1));
    out.push({
      index: out.length,
      lineIds: lines.map((l) => l.id),
      text: paragraphText({ lines }, edits, hy),
      area,
      box: { ...area },
      vertical,
      size,
      pitch,
      align: centred(lines, area, vertical) ? 'center' : 'start',
    });
  }
  // A single line is centred when it sits on the page's middle (a slide title) or on the axis
  // of a centred unit next to it; otherwise a shorter translation keeps the original's start.
  const mid = (u: OcrUnit) => u.area.x + (u.area.w / 2) * Math.cos(u.area.angle);
  out.forEach((u, i) => {
    if (u.lineIds.length !== 1 || u.vertical || Math.abs(u.area.angle) > 0.05) return;
    const onPage = Math.abs(mid(u) - page.width / 2) < page.width * 0.015 && u.area.w < page.width * 0.85;
    const onAxis = [out[i - 1], out[i + 1]].some((n) => n && n.align === 'center' && Math.abs(mid(n) - mid(u)) < u.size * 0.5);
    if (onPage || onAxis) u.align = 'center';
  });
  trimBoxes(out);
  roomBeside(out, page.width);
  return out;
}

/** The free space along the line on either side of each one-line unit (see OcrUnit.room). */
function roomBeside(units: OcrUnit[], pageWidth: number): void {
  const bounds = units.map((o) => {
    const { x, y, w, h, angle } = o.area;
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const xs = [x, x + w * ux, x - h * uy, x + w * ux - h * uy];
    const ys = [y, y + w * uy, y + h * ux, y + w * uy + h * ux];
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  units.forEach((u, i) => {
    if (u.lineIds.length !== 1 || u.vertical || Math.abs(u.area.angle) > 0.05) return;
    const a = u.area;
    let lo = 0, hi = pageWidth;
    units.forEach((o, j) => {
      const b = bounds[j];
      if (j === i || Math.min(a.y + a.h, b.y1) - Math.max(a.y, b.y0) <= 0) return;
      if (b.x1 <= a.x + 0.5) lo = Math.max(lo, b.x1);
      else if (b.x0 >= a.x + a.w - 0.5) hi = Math.min(hi, b.x0);
      else if (b.x0 + b.x1 < 2 * a.x + a.w) lo = Math.max(lo, a.x);
      else hi = Math.min(hi, a.x + a.w);
    });
    // Half a letter's height of space is kept from the neighbour.
    const gap = u.size * 0.5;
    u.room = { before: Math.max(0, a.x - lo - gap), after: Math.max(0, hi - a.x - a.w - gap) };
  });
}

/**
 * Engines pad their boxes, so the areas of tightly set lines or columns overlap a little. Each
 * unit's text box gives up half of any strip it shares with a neighbour beside it across the
 * text, so a translation wrapped onto a second line or column stays off its neighbour.
 */
function trimBoxes(units: OcrUnit[]): void {
  const flat = units.filter((u) => Math.abs(u.area.angle) < 0.05);
  for (const u of flat) {
    // Along the text and across it, as [start, end].
    const span = (o: OcrUnit) =>
      u.vertical
        ? { along: [o.area.y, o.area.y + o.area.h], across: [o.area.x, o.area.x + o.area.w] }
        : { along: [o.area.x, o.area.x + o.area.w], across: [o.area.y, o.area.y + o.area.h] };
    const me = span(u);
    let lo = me.across[0], hi = me.across[1];
    for (const o of flat) {
      if (o === u || o.vertical !== u.vertical) continue;
      const it = span(o);
      const along = Math.min(me.along[1], it.along[1]) - Math.max(me.along[0], it.along[0]);
      if (along <= 0.3 * Math.min(me.along[1] - me.along[0], it.along[1] - it.along[0])) continue;
      const shared = Math.min(me.across[1], it.across[1]) - Math.max(me.across[0], it.across[0]);
      if (shared <= 0 || shared > 0.5 * Math.min(me.across[1] - me.across[0], it.across[1] - it.across[0])) continue;
      const before = it.across[0] + it.across[1] < me.across[0] + me.across[1];
      if (before) lo = Math.max(lo, me.across[0] + shared / 2);
      else hi = Math.min(hi, me.across[1] - shared / 2);
    }
    if (hi - lo < 1) continue;
    u.box = u.vertical ? { ...u.area, x: lo, w: hi - lo } : { ...u.area, y: lo, h: hi - lo };
  }
}

// ---------------------------------------------------------------------------------------------
// Reflow

/** Punctuation that may not start a line (it stays with the character before it). */
const NO_START = /^[\s,.;:!?)\]}%'"’”、。，．！？；：）」』》〉】〕〗〙〛ー々〻ゝゞヽヾぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ…‥·・]/u;
/** Punctuation that may not end a line (it moves to the next one). */
const NO_END = /[(\[{'"‘“（「『《〈【〔〖〘〚]$/u;

/**
 * Break opportunities: a CJK character on its own, any other run up to the next space with the
 * space kept on it. Closing punctuation stays on the token before it and opening punctuation on
 * the one after, the basic kinsoku rule every CJK line breaker follows.
 */
export function breakTokens(text: string): string[] {
  const raw = text.match(/\s+|[^\s]/gu) || [];
  const toks: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur) toks.push(cur);
    cur = '';
  };
  for (const ch of raw) {
    if (/^\s+$/.test(ch)) {
      cur += ' ';
      flush();
    } else if (isCjkChar(ch)) {
      if (cur && !/\s$/.test(cur) && !NO_END.test(cur) && !NO_START.test(ch)) flush();
      cur += ch;
    } else {
      // A Latin letter after a CJK character starts a new token.
      if (cur && isCjkChar([...cur].pop() || '') && !NO_END.test(cur) && !NO_START.test(ch)) flush();
      cur += ch;
    }
  }
  flush();
  // Closing punctuation that ended up first in a token joins the token before it.
  const out: string[] = [];
  for (const t of toks) {
    if (out.length && NO_START.test(t) && !/^\s/.test(t)) out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
}

/** Width of `text` at `size` pixels. */
export type Measure = (text: string, size: number) => number;

/**
 * Greedy line filling at one size. A token longer than a line is cut between characters, or,
 * with `breakWords` off, left whole on its own line (wider than the width).
 */
export function wrapText(text: string, width: number, size: number, measure: Measure, breakWords = true): string[] {
  const lines: string[] = [];
  let line = '';
  const fits = (s: string) => measure(s.replace(/\s+$/, ''), size) <= width + 0.01;
  for (const tok of breakTokens(text)) {
    if (fits(line + tok)) {
      line += tok;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    if (fits(tok) || !breakWords) {
      line = tok;
      continue;
    }
    for (const ch of tok) {
      if (line && !fits(line + ch)) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => l.replace(/\s+$/, '')).filter((l, i, all) => l || all.length === 1);
}

export interface OcrFlow {
  /** Font size and line pitch in image pixels. */
  size: number;
  pitch: number;
  /** Lines (columns when vertical), first to last. */
  lines: string[];
  /** Set top to bottom, columns right to left. */
  vertical: boolean;
  /**
   * Along the lines, from the box's start: where the text begins and how long it may run. The
   * box itself unless a one-line translation needed the room beside it (start may be negative).
   */
  start: number;
  span: number;
}

const CJK_LANG = /^(zh|ja|ko)\b/i;

/** Whether a translation of this unit is set vertically: vertical CJK into CJK, or a column too tall for lines across. */
export function flowsVertically(unit: Pick<OcrUnit, 'vertical' | 'area'>, target: string): boolean {
  if (!unit.vertical) return false;
  return CJK_LANG.test(target) || unit.area.h > unit.area.w * 2;
}

/**
 * Fit a translation into a unit's area: the original's size and pitch when it fits, otherwise
 * the largest smaller size at which every line fits across and all lines fit down. Never larger
 * than the original. A one-line unit whose translation would shrink below WIDEN_BELOW of the
 * original runs into the free space beside it instead (a Chinese label of two characters has
 * no room for "Distribution" at a readable size).
 */
export function reflow(
  text: string,
  unit: Pick<OcrUnit, 'area' | 'size' | 'pitch' | 'vertical'> & Partial<Pick<OcrUnit, 'box' | 'room' | 'align'>>,
  target: string,
  measure: Measure,
): OcrFlow {
  const vertical = flowsVertically(unit, target);
  const box = unit.box || unit.area;
  // Along a line and across the lines.
  const along = vertical ? box.h : box.w;
  const across = vertical ? box.w : box.h;
  const ratio = unit.pitch / Math.max(0.01, unit.size);
  const floor = Math.min(unit.size, 4);
  const fit = (width: number) => {
    // Words stay whole; only at the smallest size may a word be cut between its letters.
    const wrap = (s: number) => wrapText(text, width, s, measure, s <= floor);
    let size = unit.size;
    let lines = wrap(size);
    for (let i = 0; i < 80 && size > floor; i++) {
      // The last line needs only the font's height, not a full pitch.
      const tall = (lines.length - 1) * size * ratio + size;
      const wide = Math.max(0, ...lines.map((l) => measure(l, size)));
      if (tall <= across + 0.5 && wide <= width + 0.5) break;
      size = Math.max(floor, size * 0.94);
      lines = wrap(size);
    }
    return { size, lines };
  };
  let { size, lines } = fit(along);
  let start = 0, span = along;
  // Text that shares a start with the lines around it (a list, a column of cells) keeps that
  // start and runs on past its end only; centred text spreads both ways.
  const centred = unit.align === 'center';
  const room = !vertical && unit.room ? { before: centred ? unit.room.before : 0, after: unit.room.after } : null;
  if (room && size < unit.size * WIDEN_BELOW && room.before + room.after > 0.5) {
    const wide = fit(along + room.before + room.after);
    if (wide.size > size) {
      ({ size, lines } = wide);
      // Only as far as the lines need: centred on the original's axis, or from its start.
      span = Math.max(0, ...lines.map((l) => measure(l, size)));
      const from = centred ? (along - span) / 2 : 0;
      start = Math.max(-room.before, Math.min(from, along + room.after - span));
    }
  }
  return { size, pitch: size * ratio, lines, vertical, start, span };
}

/** A translation fitted at less than this share of the original's size may run into the room beside it. */
const WIDEN_BELOW = 0.9;

/** A measure without a font engine: CJK a full em, other characters about half. Tests and fallbacks use it. */
export const roughMeasure: Measure = (text, size) => [...text].reduce((w, c) => w + (isCjkChar(c) ? size : c === ' ' ? size * 0.28 : size * 0.52), 0);

// ---------------------------------------------------------------------------------------------
// Languages

/** Same language for translation purposes: the base code, so zh-CN and zh-TW both count as zh. */
export function sameLanguage(a: string, b: string): boolean {
  const base = (s: string) => String(s || '').toLowerCase().split(/[-_]/)[0];
  return !!base(a) && base(a) === base(b);
}

/** Whether a passage has anything to translate (letters, not just numbers, prices or symbols). */
export function hasWords(text: string): boolean {
  return /\p{L}{2,}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(text);
}

/** Marks of program code that prose does not use, each a different kind. */
const CODE_SIGNS = [
  /[A-Za-z_]\w*\(/, // a call: name(
  /->|=>|==|!=|:=|&&|\|\||::|\+=|-=/, // operators
  /\s=\s/, // assignment
  /[{}]/, // braces
  /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/, // snake_case
  /\w\.\w+\(/, // a method call: obj.name(
  /;\s*$/, // a statement's end
];

/**
 * Whether a passage is program code, which an engine would translate into nonsense ("print"
 * into 打印, a function's name into a word). Two different kinds of code marks, or one with
 * brackets and operators making up a sixth or more of the characters. Prose with a "(s)" or a
 * semicolon has one kind at most.
 */
export function looksLikeCode(text: string): boolean {
  const t = String(text || '');
  const kinds = CODE_SIGNS.filter((re) => re.test(t)).length;
  if (kinds >= 2) return true;
  const chars = t.replace(/\s/g, '');
  const marks = (chars.match(/[(){}[\]<>=;_]/g) || []).length;
  return kinds === 1 && chars.length > 0 && marks / chars.length >= 1 / 6;
}

/** What the engines need from the dictionary service. */
export interface TranslateService {
  detectLanguage(text: string): Promise<string>;
  translateText(text: string, to: string, from: string, provider?: any): Promise<{ text: string } | null>;
  resolveTargetLanguage(source: string, requested?: string): string;
}

export type UnitResult = { text: string; from: string } | { same: true; from: string } | null;

/**
 * Translate one paragraph into `to`. Text already in `to`, with no words in it, or program
 * code, is left alone; `null` means no engine answered.
 */
export async function translateUnit(svc: TranslateService, text: string, to: string, provider?: string): Promise<UnitResult> {
  if (!hasWords(text) || looksLikeCode(text)) return { same: true, from: '' };
  const from = await svc.detectLanguage(text).catch(() => '');
  if (from && sameLanguage(from, to)) return { same: true, from };
  const hit = await svc.translateText(text, to, from || 'auto', provider || 'auto');
  const out = (hit?.text || '').replace(/\s+/g, ' ').trim();
  if (!out) return null;
  if (out === text.trim()) return { same: true, from };
  return { text: out, from };
}

/**
 * The language a page is translated into: the setting when it names one, otherwise the usual
 * pairing for the page's main language (English to Chinese, other languages to English).
 */
export async function pageTarget(svc: TranslateService, sample: string, setting: string): Promise<string> {
  if (setting && setting !== 'auto') return setting;
  const from = await svc.detectLanguage(sample.slice(0, 600)).catch(() => 'en');
  return svc.resolveTargetLanguage(from || 'en', 'auto');
}

// ---------------------------------------------------------------------------------------------
// Running a page

export type UnitState =
  | { status: 'pending' }
  | { status: 'done'; text: string; from: string }
  | { status: 'same'; from: string }
  | { status: 'failed' };

/** How the host translates one passage; the run never calls an engine itself. */
export type TranslateFn = (text: string, to: string) => Promise<UnitResult>;

const cache = new Map<string, Promise<UnitResult>>();
const CACHE_MAX = 600;

function cached(fn: TranslateFn, text: string, to: string): Promise<UnitResult> {
  const key = `${to}\u0001${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = fn(text, to).catch((): UnitResult => null);
  cache.set(key, p);
  // A failure is not remembered, so Retry asks again.
  void p.then((r) => {
    if (!r) cache.delete(key);
  });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return p;
}

/** Engines answer a few requests at once; more only queue behind rate limits. */
export const PARALLEL = 4;

/**
 * Translates every unit of a page, `PARALLEL` at a time in reading order, and reports each
 * result as it arrives. Identical paragraphs (a menu's repeated headings) are asked once.
 */
export class PageTranslation {
  readonly states: UnitState[];
  private stopped = false;

  constructor(
    readonly units: OcrUnit[],
    readonly target: string,
    private readonly fn: TranslateFn,
    private readonly onChange: (index: number) => void,
    private readonly parallel = PARALLEL,
  ) {
    this.states = units.map((u) => (hasWords(u.text) && !looksLikeCode(u.text) ? { status: 'pending' } : { status: 'same', from: '' }));
  }

  get pending(): number {
    return this.states.filter((s) => s.status === 'pending').length;
  }

  get failed(): number {
    return this.states.filter((s) => s.status === 'failed').length;
  }

  get done(): number {
    return this.states.filter((s) => s.status === 'done').length;
  }

  stop(): void {
    this.stopped = true;
  }

  /** Translate every pending unit. */
  run(): Promise<void> {
    const queue = this.states.map((s, i) => (s.status === 'pending' ? i : -1)).filter((i) => i >= 0);
    const worker = async (): Promise<void> => {
      while (queue.length && !this.stopped) {
        const i = queue.shift()!;
        const r = await cached(this.fn, this.units[i].text, this.target);
        if (this.stopped) return;
        this.states[i] = !r ? { status: 'failed' } : 'same' in r ? { status: 'same', from: r.from } : { status: 'done', text: r.text, from: r.from };
        this.onChange(i);
      }
    };
    const workers: Promise<void>[] = [];
    for (let k = 0; k < Math.min(this.parallel, queue.length); k++) workers.push(worker());
    return Promise.all(workers).then((): void => undefined);
  }

  /** Ask again for the units no engine answered. */
  retry(): Promise<void> {
    this.states.forEach((s, i) => {
      if (s.status === 'failed') {
        this.states[i] = { status: 'pending' };
        this.onChange(i);
      }
    });
    return this.run();
  }
}

/** The page's text with each translated paragraph in place of its original, joined like Copy all. */
export function translatedPageText(units: OcrUnit[], states: UnitState[]): string {
  return units
    .map((u, i) => {
      const s = states[i];
      return s && s.status === 'done' ? s.text : u.text;
    })
    .filter(Boolean)
    .join('\n');
}
