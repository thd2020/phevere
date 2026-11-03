/**
 * The Learn tab, shared by the desktop window and the phone: a switcher over the lists the learner
 * studies (My words, each subscribed word book, All books) and the Today page with the review quiz
 * and the daily plan (`notebook-review.ts`).
 *
 * The list in Learn is the same scope the Words tab shows, so choosing a book in either tab
 * chooses it in both. Hooks: wb-scope (data-scope) plus the review hooks of `notebook-review.ts`.
 */
import { esc, type NotebookEntry } from './notebook-shared';
import { reviewHtml, type ReviewRenderOptions } from './notebook-review';
import type { ReviewState } from './review-quiz';
import { bookProgress, scopeEntries, wordbookMeta, type WordsContext, type WordsScope } from './wordbooks';
import { progressRingSvg, reviewBookRows } from './wordbook-views';

export interface LearnViewInput {
  scope: WordsScope;
  ctx: WordsContext | null;
  /** Every saved word (My words). */
  mine: NotebookEntry[];
  review: ReviewState;
  /** My words' daily goal for new words. */
  goal: number;
  options?: ReviewRenderOptions;
  now?: number;
}

const STACK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

const fmt = (n: number) => n.toLocaleString('en-US');

/** My words, each subscribed book with its progress ring, and All books. Empty without books. */
export function learnScopeSwitchHtml(scope: WordsScope, ctx: WordsContext | null, now = Date.now()): string {
  if (!ctx || !ctx.subs.length) return '';
  const btn = (id: string, label: string, extra = '', title = label) =>
    `<button type="button" role="tab" class="wb-scope${scope === id ? ' is-active' : ''}" data-act="wb-scope" data-scope="${esc(id)}" aria-selected="${scope === id}" title="${esc(title)}">${extra}<span>${esc(label)}</span></button>`;
  const books = ctx.subs
    .map((s) => {
      const meta = wordbookMeta(s.bookId);
      if (!meta) return '';
      const p = bookProgress(s.bookId, ctx, now);
      return btn(s.bookId, meta.short, progressRingSvg(p.known, p.learning, p.total, 18), `${meta.title}: ${fmt(p.known)} of ${fmt(p.total)} known`);
    })
    .join('');
  return `<div class="wb-switch lrn-scopes" role="tablist" aria-label="Study list">${btn('mine', 'My words')}${books}${btn('all', 'All books', STACK)}</div>`;
}

/** The scope's entries for review: My words, or the book words of a book or of All books. */
export function learnEntries(scope: WordsScope, ctx: WordsContext | null, mine: NotebookEntry[]): NotebookEntry[] {
  if (scope === 'mine' || !ctx) return mine;
  return scopeEntries(scope, ctx);
}

/** The Today page: today's quiz beside the plan for the chosen list. */
export function learnTodayHtml(input: LearnViewInput): string {
  const { scope, ctx, review, goal } = input;
  const now = input.now ?? Date.now();
  const options = { ...input.options, now };
  if (scope === 'mine' || !ctx) return reviewHtml(input.mine, review, goal, options);
  const sub = ctx.subs.find((s) => s.bookId === scope);
  return reviewHtml(scopeEntries(scope, ctx), review, goal, {
    ...options,
    books: reviewBookRows(scope, ctx, now),
    goalBook: sub ? { id: sub.bookId, goal: sub.dailyNew } : undefined,
    started: true,
  });
}

export function learnHtml(input: LearnViewInput): string {
  return `${learnScopeSwitchHtml(input.scope, input.ctx, input.now)}<div class="nbv-body lrn-body">${learnTodayHtml(input)}</div>`;
}
