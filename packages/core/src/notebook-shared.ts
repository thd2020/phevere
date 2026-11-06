/**
 * Pieces every notebook view shares: the entry and analysis types, HTML escaping and the
 * date helpers. Each view lives in its own module (`notebook-families.ts`, `notebook-map.ts`,
 * `notebook-cards.ts`, and the Learn tab's `notebook-review.ts`); `notebook-views.ts` holds the analysis and
 * re-exports them all.
 */
import type { Morph, MorphKind } from './morphology';
import type { VocabViewEntry } from './vocab-view';
import { escapeHtml, formatNumber } from './i18n/runtime';

export type NotebookView = 'list' | 'families' | 'map' | 'cards';
export type FamilyGrouping = 'root' | 'deep' | 'prefix' | 'suffix' | 'origin' | 'tree' | 'char';

export interface NotebookEntry extends VocabViewEntry {
  reviewDue?: number | null;
  reviewInterval?: number | null;
  reps?: number | null;
  stability?: number | null;
  difficulty?: number | null;
  state?: number | null;
  lapses?: number | null;
  lastReview?: number | null;
}

export interface WordInfo {
  entry: NotebookEntry;
  morphs: Morph[];
  parts: string[];
  origin: string;
}

export interface Family {
  key: string;
  kind: MorphKind;
  label: string;
  gloss: string;
  origin: string;
  ids: string[];
  /** The spellings a root or prefix takes: "fac · fic · fec · fect". */
  forms?: string;
}

export interface TreeNode {
  id: string;
  children: TreeNode[];
}

export interface NotebookAnalysis {
  words: Map<string, WordInfo>;
  families: Family[];
  trees: TreeNode[];
  /** child id → parent id for words built from another saved word. */
  parent: Map<string, string>;
}

export const DAY = 86_400_000;

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function clean(s: unknown): string {
  const t = String(s ?? '').trim();
  return t === 'null' || t === 'None' || t === 'undefined' ? '' : t;
}

/**
 * A count message as HTML with its number set in bold: `html` is tHtml() of a plural message and
 * `count` its number, which appears in the text as the interface language formats it.
 */
export function boldCount(html: string, count: number): string {
  const n = escapeHtml(formatNumber(count));
  const at = html.indexOf(n);
  return at < 0 ? html : `${html.slice(0, at)}<b>${n}</b>${html.slice(at + n.length)}`;
}

export function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ------------------------------------------------------------ scrolling */

/** The element that scrolls a view: its nearest scrolling ancestor, or the page. */
export function scrollerOf(el: any): any {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = win.getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return doc.scrollingElement || doc.documentElement;
}

/**
 * The part of the screen a view can be seen in, between the bars fixed over it: the phone's
 * bottom navigation and a sticky header. Found by looking at what sits on the screen's top and
 * bottom edges, so neither shell has to say.
 */
export function visibleBand(el: any): { top: number; bottom: number } {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const scroller = scrollerOf(el);
  const page = scroller === doc.scrollingElement || scroller === doc.documentElement;
  const box = page ? { top: 0, bottom: win.innerHeight } : scroller.getBoundingClientRect();
  let top = box.top;
  let bottom = box.bottom;
  const x = win.innerWidth / 2;
  const fixedAt = (y: number): any[] =>
    (doc.elementsFromPoint?.(x, y) || []).filter((n: any) => {
      if (el.contains(n) || n.contains(el)) return false;
      const pos = win.getComputedStyle(n).position;
      return pos === 'fixed' || pos === 'sticky';
    });
  for (const n of fixedAt(bottom - 2)) bottom = Math.min(bottom, n.getBoundingClientRect().top);
  for (const n of fixedAt(top + 2)) top = Math.max(top, n.getBoundingClientRect().bottom);
  return { top, bottom };
}

/**
 * Scroll just enough that `want` px from `y` (a screen y) are on screen, without pushing `keep`
 * (another screen y, the thing the reader clicked) above the visible top. Smooth unless reduced.
 */
export function revealBelow(el: any, y: number, want: number, keep: number): void {
  const win = el.ownerDocument.defaultView;
  const { top, bottom } = visibleBand(el);
  const need = y + want - (bottom - 12);
  const room = keep - (top + 12);
  const by = Math.min(need, room);
  if (by <= 1) return;
  const reduced = !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  scrollerOf(el).scrollBy({ top: by, behavior: reduced ? 'auto' : 'smooth' });
}
