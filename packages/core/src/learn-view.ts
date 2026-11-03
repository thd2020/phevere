/**
 * The Learn tab, shared by the desktop window and the phone: a switcher over the lists the learner
 * studies (My words, each subscribed word book, All books) and the Today page with the review quiz
 * and the daily plan (`notebook-review.ts`).
 *
 * The list in Learn is the same scope the Words tab shows, so choosing a book in either tab
 * chooses it in both. The Progress page (`learn-progress.ts`) sits beside Today. Hooks: wb-scope
 * (data-scope), learn-page (data-page) and the review hooks of `notebook-review.ts`.
 */
import { esc, type NotebookEntry } from './notebook-shared';
import { reviewHtml, type ReviewRenderOptions } from './notebook-review';
import type { ReviewState } from './review-quiz';
import type { AnswerDetails, AnswerRecord } from './answer-history';
import { progressHtml } from './learn-progress';
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
  /** Today (the quiz) or Progress. */
  page?: LearnPage;
  /** The answer history, for Progress; null while it loads. */
  history?: AnswerRecord[] | null;
  /** A line shown above the page (the Plus state of progress sync). */
  notice?: string;
}

export type LearnPage = 'today' | 'progress';

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

/** The book a scope studies a word from: the scope's own book, or in All books the first book that lists it. */
export function scopeBookFor(scope: WordsScope, ctx: WordsContext | null, lemma: string): string | null {
  if (scope === 'mine' || !ctx) return null;
  if (scope !== 'all') return scope;
  return ctx.index.get(String(lemma || '').trim().toLowerCase())?.[0] ?? null;
}

/** What the answer history records about the question just answered, beyond its grade. */
export function reviewAnswerDetails(state: ReviewState, scope: WordsScope, ctx: WordsContext | null): AnswerDetails {
  const q = state.question;
  const a = state.answer;
  if (!q || !a) return {};
  return { kind: q.kind, correct: a.grade > 1, ms: a.ms, bookId: scopeBookFor(scope, ctx, q.lemma) };
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

const PAGE_ICON: Record<LearnPage, string> = {
  today:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 10h16M9 3v4M15 3v4M9 15l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  progress:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M7 16v-4M12 16V7M17 16v-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
};

export function learnPageSwitchHtml(page: LearnPage): string {
  const btn = (p: LearnPage, label: string) =>
    `<button type="button" role="tab" class="nbv-switch__btn${p === page ? ' is-active' : ''}" data-act="learn-page" data-page="${p}" aria-selected="${p === page}">${PAGE_ICON[p]}<span>${label}</span></button>`;
  return `<div class="nbv-switch lrn-pages" role="tablist" aria-label="Learn">${btn('today', 'Today')}${btn('progress', 'Progress')}</div>`;
}

export function learnHtml(input: LearnViewInput): string {
  const page = input.page || 'today';
  const body =
    page === 'progress'
      ? input.history
        ? progressHtml({ history: input.history, scope: input.scope, ctx: input.ctx, mine: input.mine, goal: input.goal, now: input.now })
        : '<p class="nbv-empty">Loading…</p>'
      : learnTodayHtml(input);
  return `<div class="lrn-bar">${learnScopeSwitchHtml(input.scope, input.ctx, input.now)}${learnPageSwitchHtml(page)}</div>${input.notice || ''}<div class="nbv-body lrn-body">${body}</div>`;
}
