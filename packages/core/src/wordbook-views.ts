/**
 * Word book pieces of the Words tab, shared by the desktop window and the phone: the scope
 * switcher (My words, each subscribed book, All books, Add a word book), the header of a book
 * with its progress ring and daily goal, a book's word list in order, and the library ordered
 * as a learning path. HTML strings with `data-act` hooks, like the other notebook views.
 *
 * Hooks: wb-scope (data-scope), wb-library, wb-sub and wb-unsub (data-book), wb-goal (data-book,
 * data-goal), wb-save and wb-known (data-q, data-known), wb-more, and lookup (data-q).
 */
import { esc, type NotebookEntry } from './notebook-shared';
import { bookProgress, wordbookMeta, wordStatus, WORDBOOKS, type BookProgress, type WordsContext, type WordsEntry, type WordsScope } from './wordbooks';

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  heartOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  stack: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};

const STATUS_LABEL = { new: 'New', learning: 'Learning', known: 'Known' } as const;
const GOALS = [5, 10, 20, 40];
/** Rows a book list shows before "Show more". */
export const BOOK_LIST_PAGE = 200;

const fmt = (n: number) => n.toLocaleString('en-US');

/** Known as a full arc, learning as a lighter arc after it. */
export function progressRingSvg(known: number, learning: number, total: number, size = 36): string {
  const r = 15;
  const c = 2 * Math.PI * r;
  const k = total ? (known / total) * c : 0;
  const l = total ? (learning / total) * c : 0;
  const pct = total ? Math.round((known / total) * 100) : 0;
  return `<svg class="wb-ring" viewBox="0 0 36 36" width="${size}" height="${size}" role="img" aria-label="${fmt(known)} of ${fmt(total)} known">
    <circle class="wb-ring__track" cx="18" cy="18" r="${r}"/>
    ${l ? `<circle class="wb-ring__learning" cx="18" cy="18" r="${r}" stroke-dasharray="${(k + l).toFixed(2)} ${c.toFixed(2)}"/>` : ''}
    ${k ? `<circle class="wb-ring__known" cx="18" cy="18" r="${r}" stroke-dasharray="${k.toFixed(2)} ${c.toFixed(2)}"/>` : ''}
    ${size >= 48 ? `<text x="18" y="21.5">${pct}%</text>` : ''}
  </svg>`;
}

function barHtml(p: { known: number; learning: number; total: number }): string {
  const k = p.total ? (p.known / p.total) * 100 : 0;
  const l = p.total ? (p.learning / p.total) * 100 : 0;
  return `<span class="wb-bar" role="img" aria-label="${fmt(p.known)} of ${fmt(p.total)} known"><i class="wb-bar__known" style="width:${k.toFixed(2)}%"></i><i class="wb-bar__learning" style="width:${l.toFixed(2)}%"></i></span>`;
}

/* ----------------------------------------------------------------- switcher */

export function wordsScopeSwitchHtml(scope: WordsScope, ctx: WordsContext, library: boolean, now = Date.now()): string {
  const btn = (id: string, label: string, extra = '', title = label) =>
    `<button type="button" role="tab" class="wb-scope${!library && scope === id ? ' is-active' : ''}" data-act="wb-scope" data-scope="${esc(id)}" aria-selected="${!library && scope === id}" title="${esc(title)}">${extra}<span>${esc(label)}</span></button>`;
  const books = ctx.subs
    .map((s) => {
      const meta = wordbookMeta(s.bookId);
      if (!meta) return '';
      const p = bookProgress(s.bookId, ctx, now);
      return btn(s.bookId, meta.short, progressRingSvg(p.known, p.learning, p.total, 18), `${meta.title}: ${fmt(p.known)} of ${fmt(p.total)} known`);
    })
    .join('');
  const count = ctx.mine.length ? `<b class="wb-scope__n">${fmt(ctx.mine.length)}</b>` : '';
  return `<div class="wb-switch" role="tablist" aria-label="Word lists">
    ${btn('mine', 'My words', '').replace('</span></button>', `</span>${count}</button>`)}
    ${books}
    ${ctx.subs.length ? btn('all', 'All books', ICON.stack) : ''}
    <button type="button" class="wb-scope wb-scope--add${library ? ' is-active' : ''}" data-act="wb-library" aria-pressed="${library}">${ICON.plus}<span>Add a word book</span></button>
  </div>`;
}

/* ------------------------------------------------------------------- header */

function goalChips(bookId: string, goal: number): string {
  return `<div class="wb-goal" role="group" aria-label="New words a day"><span>New a day</span>${GOALS.map(
    (g) => `<button type="button" class="nbv-chip${g === goal ? ' is-active' : ''}" data-act="wb-goal" data-book="${esc(bookId)}" data-goal="${g}" aria-pressed="${g === goal}">${g}</button>`,
  ).join('')}</div>`;
}

/** Above the views when the scope is a book or All books. */
export function wordbookHeaderHtml(scope: WordsScope, ctx: WordsContext, now = Date.now()): string {
  if (scope === 'mine') return '';
  if (scope === 'all') {
    const rows = ctx.subs.map((s) => bookProgress(s.bookId, ctx, now));
    return `<section class="wb-head wb-head--all">${rows
      .map((p) => {
        const meta = wordbookMeta(p.bookId)!;
        return `<button type="button" class="wb-mini" data-act="wb-scope" data-scope="${esc(p.bookId)}"><span class="wb-mini__name">${esc(meta.short)}</span>${barHtml(p)}<span class="wb-mini__n">${fmt(p.known)} / ${fmt(p.total)}</span></button>`;
      })
      .join('')}</section>`;
  }
  const meta = wordbookMeta(scope);
  if (!meta) return '';
  const p = bookProgress(scope, ctx, now);
  return `<section class="wb-head">
    ${progressRingSvg(p.known, p.learning, p.total, 64)}
    <div class="wb-head__text">
      <p class="wb-level">${esc(meta.level)}</p>
      <h2 class="wb-title">${esc(meta.title)}</h2>
      <p class="wb-counts"><span><b>${fmt(p.known)}</b> known</span><span><b>${fmt(p.learning)}</b> learning</span><span><b>${fmt(p.total - p.known - p.learning)}</b> new</span></p>
    </div>
    <div class="wb-head__side">
      ${goalChips(scope, p.dailyNew)}
      <button type="button" class="nbv-link wb-unsub" data-act="wb-unsub" data-book="${esc(scope)}">Remove book</button>
    </div>
  </section>`;
}

/* --------------------------------------------------------------- word lists */

function badgesHtml(books: string[] | null | undefined, except = ''): string {
  const list = (books || []).filter((b) => b !== except);
  if (!list.length) return '';
  return `<span class="wb-badges">${list.map((b) => `<span class="wb-badge" title="${esc(wordbookMeta(b)?.title || b)}">${esc(wordbookMeta(b)?.short || b)}</span>`).join('')}</span>`;
}

/** Small book badges for any row (My words list, cards). */
export function wordBookBadgesHtml(e: { books?: string[] | null }, except = ''): string {
  return badgesHtml(e.books || undefined, except);
}

/** A book's words in order, or All books' words, each with its state and actions. */
export function wordbookListHtml(entries: WordsEntry[], opts: { scope: WordsScope; limit: number; filtered?: boolean }): string {
  if (!entries.length) return `<p class="nbv-empty">${opts.filtered ? 'No matching words.' : 'No words.'}</p>`;
  const shown = entries.slice(0, opts.limit);
  const except = opts.scope === 'all' ? '' : String(opts.scope);
  const rows = shown
    .map((e, i) => {
      const st = wordStatus(e);
      const q = esc(e.lemma);
      const save = e.saved
        ? `<span class="wb-act is-on" title="In My words" aria-label="In My words">${ICON.heartOn}</span>`
        : `<button type="button" class="wb-act" data-act="wb-save" data-q="${q}" title="Add to My words" aria-label="Add ${q} to My words">${ICON.heart}</button>`;
      const known = e.saved
        ? '<span class="wb-act" aria-hidden="true"></span>'
        : `<button type="button" class="wb-act${e.known ? ' is-on' : ''}" data-act="wb-known" data-q="${q}" data-known="${e.known ? '0' : '1'}" aria-pressed="${!!e.known}" title="${e.known ? 'Marked known' : 'Mark known'}" aria-label="${e.known ? 'Unmark' : 'Mark'} ${q} known">${ICON.check}</button>`;
      return `<li class="wb-row is-${st}">
        <span class="wb-row__n">${i + 1}</span>
        <button type="button" class="wb-row__word" data-act="lookup" data-q="${q}">${q}</button>
        ${badgesHtml(e.books, except)}
        <span class="wb-state wb-state--${st}">${STATUS_LABEL[st]}</span>
        <span class="wb-row__acts">${known}${save}</span>
      </li>`;
    })
    .join('');
  const more = entries.length > shown.length ? `<button type="button" class="nbv-secondary wb-more" data-act="wb-more">Show ${fmt(Math.min(BOOK_LIST_PAGE, entries.length - shown.length))} more</button>` : '';
  return `<ol class="wb-list">${rows}</ol>${more}`;
}

/**
 * Cards and Map on a book of thousands would draw thousands of cards; they show the words
 * already started or saved plus the next new ones in book order.
 */
export function scopeStudySet(entries: WordsEntry[], nextNew = 40): WordsEntry[] {
  let fresh = 0;
  return entries.filter((e) => {
    if (e.saved || wordStatus(e) !== 'new') return true;
    if (e.known) return false;
    fresh += 1;
    return fresh <= nextNew;
  });
}

/* ------------------------------------------------------------------ library */

export function wordbookLibraryHtml(ctx: WordsContext, now = Date.now()): string {
  const subscribed = new Set(ctx.subs.map((s) => s.bookId));
  let level = '';
  const items = WORDBOOKS.map((meta) => {
    const on = subscribed.has(meta.id);
    const p: BookProgress | null = on && ctx.books.has(meta.id) ? bookProgress(meta.id, ctx, now) : null;
    const levelHead = meta.level !== level ? `<p class="wb-path__level">${esc((level = meta.level))}</p>` : '';
    return `${levelHead}<li class="wb-path__item${on ? ' is-on' : ''}">
      <span class="wb-path__dot" aria-hidden="true">${p ? progressRingSvg(p.known, p.learning, p.total, 28) : ''}</span>
      <div class="wb-path__card">
        <div class="wb-path__main">
          <h3>${esc(meta.title)}</h3>
          <div class="wb-path__meta"><span>${fmt(meta.count)} words</span><details class="wb-path__src">
            <summary>Source</summary>
            <p><a href="${esc(meta.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(meta.source)}</a><a href="${esc(meta.licenceUrl)}" target="_blank" rel="noopener noreferrer">${esc(meta.licence)}</a></p>
          </details></div>
          ${p ? `<div class="wb-path__progress">${barHtml(p)}<span>${fmt(p.known)} / ${fmt(p.total)}</span></div>` : ''}
        </div>
        <div class="wb-path__acts">${
          on
            ? `<button type="button" class="nbv-secondary" data-act="wb-scope" data-scope="${esc(meta.id)}" aria-label="Open ${esc(meta.title)}">Open</button><button type="button" class="nbv-link" data-act="wb-unsub" data-book="${esc(meta.id)}" aria-label="Remove ${esc(meta.title)}">Remove</button>`
            : `<button type="button" class="nbv-primary" data-act="wb-sub" data-book="${esc(meta.id)}" aria-label="Add ${esc(meta.title)}">Add</button>`
        }</div>
      </div>
    </li>`;
  }).join('');
  return `<section class="wb-library"><ol class="wb-path">${items}</ol></section>`;
}

/** Book rows for the Review plan panel: today's new and due words and progress per book. */
export function reviewBookRows(scope: WordsScope, ctx: WordsContext, now = Date.now()): BookProgress[] {
  if (scope === 'mine') return [];
  const ids = scope === 'all' ? ctx.subs.map((s) => s.bookId) : [scope];
  return ids.filter((id) => ctx.books.has(id)).map((id) => bookProgress(id, ctx, now));
}

export type { NotebookEntry };
