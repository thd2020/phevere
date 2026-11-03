/**
 * Pieces every notebook view shares: the entry and analysis types, HTML escaping and the
 * date helpers. Each view lives in its own module (`notebook-families.ts`, `notebook-map.ts`,
 * `notebook-cards.ts`, and the Learn tab's `notebook-review.ts`); `notebook-views.ts` holds the analysis and
 * re-exports them all.
 */
import type { Morph, MorphKind } from './morphology';
import type { VocabViewEntry } from './vocab-view';

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

export function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
