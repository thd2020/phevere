/**
 * Word book pieces of the Words tab, shared by the desktop window and the phone: the scope
 * switcher (My words, each subscribed book, All books, Add a word book), the header of a book
 * with its progress ring and counts, a book's word list in order, and the library ordered
 * as a learning path. HTML strings with `data-act` hooks, like the other notebook views.
 *
 * Hooks: wb-scope (data-scope), wb-library, wb-sub and wb-unsub (data-book), wb-goal (data-book,
 * data-goal), wb-save and wb-known (data-q, data-known), wb-more, wb-sort (data-sort: book,
 * recent or az), wb-expand (data-q) to open a row on its brief definition, and lookup (data-q).
 * The open list's chip in the switcher carries wb-menu (data-scope), which opens the list's
 * own menu (`bookMenuItems`): Export, Export for Anki and, for a book, Remove or Delete, as
 * Anki's deck menu and Quizlet's set menu hold them. The library's wb-import imports a file,
 * since an import adds a book.
 *
 * Sources (scope 'sources') lists My words grouped by the document or site they were saved
 * from. Its hooks: src-book (data-source) makes a word book from a source, src-add (data-source,
 * data-book) adds the source's newer words to that book. In a made book, a change on the title
 * input (name "book-title", data-book) renames it, the form with data-act-form="ub-add" (data-book,
 * input name "word") adds a word, ub-drop (data-book, data-q) removes one, and wb-unsub deletes
 * the book. The title input and the form carry no data-act, so typing in them is never a click.
 */
import { esc, type NotebookEntry } from './notebook-shared';
import {
  bookProgress,
  sourceGroups,
  wordbookMeta,
  wordStatus,
  WORDBOOKS,
  type BookProgress,
  type SourceGroup,
  type WordsContext,
  type WordsEntry,
  type WordsScope,
} from './wordbooks';
import { bookWordKey } from './wordbook-store';
import { compareAz, vocabReadings, vocabSenses } from './vocab-view';
import type { MenuItem } from './popover-menu';

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  heartOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  stack: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17zM5 17a2.5 2.5 0 0 1 2.5-2.5H17M9 8h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM4 12h16M12 4c2.2 2.3 3.2 5 3.2 8s-1 5.7-3.2 8c-2.2-2.3-3.2-5-3.2-8s1-5.7 3.2-8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  sources: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h6l2 2h8v11H4zM8 12h8M8 15.5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lookup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="19" cy="12" r="1.9" fill="currentColor"/></svg>',
};

const STATUS_LABEL = { new: 'New', learning: 'Learning', known: 'Known' } as const;
/** How a book's list is ordered: the book's own order, newest first as in My words, or alphabetical. */
export type BookSort = 'book' | 'recent' | 'az';
const SORT_LABEL: Record<BookSort, string> = { book: 'Book order', recent: 'Recent', az: 'A–Z' };
/** Senses an opened row shows. */
const BRIEF_SENSES = 3;
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
  // The open list's chip carries a button for its menu (Export, Remove), like a split button.
  const withMenu = (id: string, title: string, chip: string) =>
    !library && scope === id
      ? `<span class="wb-scope-wrap is-active">${chip}<button type="button" class="wb-scope__more" data-act="wb-menu" data-scope="${esc(id)}" data-title="${esc(title)}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(title)} menu" title="More">${ICON.more}</button></span>`
      : chip;
  const books = ctx.subs
    .map((s) => {
      const meta = wordbookMeta(s.bookId);
      if (!meta) return '';
      const p = bookProgress(s.bookId, ctx, now);
      const chip = btn(s.bookId, meta.short, progressRingSvg(p.known, p.learning, p.total, 18), `${meta.title}: ${fmt(p.known)} of ${fmt(p.total)} known`);
      return withMenu(s.bookId, meta.title, chip);
    })
    .join('');
  const count = ctx.mine.length ? `<b class="wb-scope__n">${fmt(ctx.mine.length)}</b>` : '';
  return `<div class="wb-switch" role="tablist" aria-label="Word lists">
    ${withMenu('mine', 'My words', btn('mine', 'My words', '').replace('</span></button>', `</span>${count}</button>`))}
    ${books}
    ${ctx.subs.length ? btn('all', 'All books', ICON.stack) : ''}
    ${scope === 'sources' || sourceGroups(ctx).length ? btn('sources', 'Sources', ICON.sources) : ''}
    <button type="button" class="wb-scope wb-scope--add${library ? ' is-active' : ''}" data-act="wb-library" aria-pressed="${library}">${ICON.plus}<span>Add a word book</span></button>
  </div>`;
}

/* ------------------------------------------------------------------- header */

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
  if (scope === 'sources') return '';
  const meta = wordbookMeta(scope);
  if (!meta) return '';
  const p = bookProgress(scope, ctx, now);
  if (meta.user) return madeBookHeaderHtml(scope, meta.title, meta.sourceKey, p);
  return `<section class="wb-head">
    ${progressRingSvg(p.known, p.learning, p.total, 64)}
    <div class="wb-head__text">
      <p class="wb-level">${esc(meta.level)}</p>
      <h2 class="wb-title">${esc(meta.title)}</h2>
      <p class="wb-counts"><span><b>${fmt(p.known)}</b> known</span><span><b>${fmt(p.learning)}</b> learning</span><span><b>${fmt(p.total - p.known - p.learning)}</b> new</span></p>
    </div>
  </section>`;
}

/** A made book: its title can be edited in place and words added by name. */
function madeBookHeaderHtml(bookId: string, title: string, sourceKey: string | undefined, p: BookProgress): string {
  const from = sourceKey ? sourceKey.replace(/^(doc|site):/, '') : '';
  const id = esc(bookId);
  return `<section class="wb-head wb-head--made">
    ${progressRingSvg(p.known, p.learning, p.total, 64)}
    <div class="wb-head__text">
      <p class="wb-level">${from ? `From ${esc(from)}` : 'My word book'}</p>
      <input class="wb-title wb-title-input" name="book-title" data-book="${id}" value="${esc(title)}" maxlength="80" aria-label="Book name" spellcheck="false" />
      <p class="wb-counts"><span><b>${fmt(p.known)}</b> known</span><span><b>${fmt(p.learning)}</b> learning</span><span><b>${fmt(p.total - p.known - p.learning)}</b> new</span></p>
    </div>
    <div class="wb-head__side">
      <form class="wb-add" data-act-form="ub-add" data-book="${id}">
        <input name="word" type="text" placeholder="Add a word" aria-label="Add a word" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <button type="submit" class="nbv-secondary">Add</button>
      </form>
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

/** An opened row: pronunciation, part of speech and the first senses, as My words shows them. */
function briefHtml(e: WordsEntry, loading: boolean): string {
  const senses = vocabSenses(e.definition).slice(0, BRIEF_SENSES);
  const ipa = vocabReadings(e.reading)[0]?.ipa || '';
  const pos = String(e.partOfSpeech || '').trim();
  const body = senses.length
    ? `<ol class="wb-brief__senses">${senses.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
    : loading
      ? '<span class="wb-brief__wait" aria-label="Loading"><i></i><i></i></span>'
      : '<p class="wb-brief__none">No definition found.</p>';
  return `<div class="wb-brief">${ipa || pos ? `<p class="wb-brief__head">${ipa ? `<span class="wb-brief__ipa">${esc(ipa)}</span>` : ''}${pos ? `<span class="wb-brief__pos">${esc(pos)}</span>` : ''}</p>` : ''}${body}</div>`;
}

/**
 * When a word came into your words: saved to My words, or for a book word not saved, started
 * in Learn. 0 when neither. A review does not move it, as in My words' Recent order.
 */
function addedAt(e: WordsEntry): number {
  const at = typeof e.createdAt === 'string' ? Date.parse(e.createdAt) : Number(e.createdAt || 0);
  return at || 0;
}

/**
 * The entries in the chosen order, each with its place in the book. Recent puts the words you
 * saved or started, newest first, before the ones you have not, which keep the book's order.
 */
export function sortBookEntries(entries: WordsEntry[], sort: BookSort): Array<{ e: WordsEntry; n: number }> {
  const rows = entries.map((e, i) => ({ e, n: i + 1 }));
  if (sort === 'az') rows.sort((a, b) => compareAz(a.e.lemma, b.e.lemma) || a.n - b.n);
  else if (sort === 'recent') rows.sort((a, b) => addedAt(b.e) - addedAt(a.e) || a.n - b.n);
  return rows;
}

/**
 * The sorts a list offers. A book Phevere ships has its own order and no words you put there,
 * so it has no Recent; a book you made or imported, and All books, keep it.
 */
export function bookSorts(scope: WordsScope): BookSort[] {
  const meta = wordbookMeta(String(scope));
  return meta && !meta.user ? ['book', 'az'] : ['book', 'recent', 'az'];
}

function sortBarHtml(sort: BookSort, sorts: BookSort[]): string {
  return `<div class="wb-sort" role="group" aria-label="Sort">${sorts
    .map((k) => `<button type="button" class="nbv-chip${k === sort ? ' is-active' : ''}" data-act="wb-sort" data-sort="${k}" aria-pressed="${k === sort}">${SORT_LABEL[k]}</button>`)
    .join('')}</div>`;
}

/** A book's words in order, or All books' words, each with its state and actions. */
export function wordbookListHtml(
  entries: WordsEntry[],
  opts: {
    scope: WordsScope;
    limit: number;
    filtered?: boolean;
    sort?: BookSort;
    /** Lowercase headwords whose row is open on its brief definition. */
    expanded?: Set<string>;
    /** Lowercase headwords whose meaning is being looked up. */
    loading?: Set<string>;
  },
): string {
  if (!entries.length) return `<p class="nbv-empty">${opts.filtered ? 'No matching words.' : 'No words.'}</p>`;
  const sorts = bookSorts(opts.scope);
  const sort = opts.sort && sorts.includes(opts.sort) ? opts.sort : 'book';
  const shown = sortBookEntries(entries, sort).slice(0, opts.limit);
  const except = opts.scope === 'all' ? '' : String(opts.scope);
  const made = !!wordbookMeta(String(opts.scope))?.user;
  const rows = shown
    .map(({ e, n }) => {
      const st = wordStatus(e);
      const q = esc(e.lemma);
      const save = e.saved
        ? `<span class="wb-act is-on" title="In My words" aria-label="In My words">${ICON.heartOn}</span>`
        : `<button type="button" class="wb-act" data-act="wb-save" data-q="${q}" title="Add to My words" aria-label="Add ${q} to My words">${ICON.heart}</button>`;
      const known = e.saved
        ? '<span class="wb-act" aria-hidden="true"></span>'
        : `<button type="button" class="wb-act${e.known ? ' is-on' : ''}" data-act="wb-known" data-q="${q}" data-known="${e.known ? '0' : '1'}" aria-pressed="${!!e.known}" title="${e.known ? 'Marked known' : 'Mark known'}" aria-label="${e.known ? 'Unmark' : 'Mark'} ${q} known">${ICON.check}</button>`;
      const key = bookWordKey(e.lemma);
      const open = !!opts.expanded?.has(key);
      return `<li class="wb-row is-${st}${open ? ' is-open' : ''}">
        <span class="wb-row__n">${n}</span>
        <button type="button" class="wb-row__word" data-act="wb-expand" data-q="${q}" aria-expanded="${open}">${q}</button>
        ${badgesHtml(e.books, except)}
        <span class="wb-state wb-state--${st}">${STATUS_LABEL[st]}</span>
        <span class="wb-row__acts"><button type="button" class="wb-act" data-act="lookup" data-q="${q}" title="Look up" aria-label="Look up ${q}">${ICON.lookup}</button>${known}${save}${
          made
            ? `<button type="button" class="wb-act wb-act--drop" data-act="ub-drop" data-book="${esc(String(opts.scope))}" data-q="${q}" title="Remove from this book" aria-label="Remove ${q} from this book">${ICON.close}</button>`
            : ''
        }</span>
        ${open ? briefHtml(e, !!opts.loading?.has(key)) : ''}
      </li>`;
    })
    .join('');
  const more = entries.length > shown.length ? `<button type="button" class="nbv-secondary wb-more" data-act="wb-more">Show ${fmt(Math.min(BOOK_LIST_PAGE, entries.length - shown.length))} more</button>` : '';
  return `${sortBarHtml(sort, sorts)}<ol class="wb-list">${rows}</ol>${more}`;
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

/* ------------------------------------------------------------------ sources */

/** Words a source row shows before "and N more". */
const SOURCE_WORDS_SHOWN = 14;

function sourceRowHtml(g: SourceGroup, ctx: WordsContext, now: number): string {
  const words = g.entries.map((e) => e.lemma);
  const shown = words.slice(-SOURCE_WORDS_SHOWN).reverse();
  const chips = shown.map((w) => `<button type="button" class="wb-src__word" data-act="lookup" data-q="${esc(w)}">${esc(w)}</button>`).join('');
  const more = words.length > shown.length ? `<span class="wb-src__more">and ${fmt(words.length - shown.length)} more</span>` : '';
  const key = esc(g.key);
  let action: string;
  if (g.bookId) {
    const inBook = new Set((ctx.books.get(g.bookId) || []).map(bookWordKey));
    const fresh = words.filter((w) => !inBook.has(bookWordKey(w))).length;
    const p = bookProgress(g.bookId, ctx, now);
    action = `<span class="wb-src__book">${progressRingSvg(p.known, p.learning, p.total, 18)}<button type="button" class="nbv-secondary" data-act="wb-scope" data-scope="${esc(g.bookId)}">Open word book</button></span>${
      fresh ? `<button type="button" class="nbv-link" data-act="src-add" data-source="${key}" data-book="${esc(g.bookId)}">Add ${fmt(fresh)} new</button>` : ''
    }`;
  } else action = `<button type="button" class="nbv-primary" data-act="src-book" data-source="${key}">Make a word book</button>`;
  const last = g.latest ? new Date(g.latest).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  return `<li class="wb-src">
    <span class="wb-src__icon" aria-hidden="true">${g.kind === 'doc' ? ICON.book : ICON.globe}</span>
    <div class="wb-src__main">
      <h3 class="wb-src__name" title="${esc(g.label)}">${esc(g.label)}</h3>
      <p class="wb-src__meta"><span>${fmt(words.length)} ${words.length === 1 ? 'word' : 'words'}</span>${last ? `<span>${esc(last)}</span>` : ''}</p>
      <div class="wb-src__words">${chips}${more}</div>
    </div>
    <div class="wb-src__acts">${action}</div>
  </li>`;
}

/** My words grouped by the document or site they were saved from. */
export function sourcesHtml(ctx: WordsContext, now = Date.now()): string {
  const groups = sourceGroups(ctx);
  if (!groups.length) return '<p class="nbv-empty">Words saved from a PDF or a web page are grouped here.</p>';
  return `<section class="wb-sources"><ol class="wb-src-list">${groups.map((g) => sourceRowHtml(g, ctx, now)).join('')}</ol></section>`;
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
  return `<section class="wb-library"><div class="wb-library__bar"><button type="button" class="nbv-secondary" data-act="wb-import">Import…</button></div><ol class="wb-path">${items}</ol></section>`;
}

/**
 * A list's own menu, opened from its chip: My words exports; a book also has Remove (a book
 * Phevere ships) or Delete (one you made or imported).
 */
export function bookMenuItems(scope: WordsScope): MenuItem[] {
  if (scope === 'all' || scope === 'sources') return [];
  const meta = scope === 'mine' ? null : wordbookMeta(String(scope));
  if (scope !== 'mine' && !meta) return [];
  const id = String(scope);
  const items: MenuItem[] = [
    { label: 'Export…', act: 'wb-export', data: { scope: id, fmt: 'book' } },
    { label: 'Export for Anki…', act: 'wb-export', data: { scope: id, fmt: 'anki' } },
  ];
  if (meta) items.push({ label: meta.user ? 'Delete book' : 'Remove', act: 'wb-unsub', data: { book: id }, danger: true });
  return items;
}

/**
 * The confirmation before a book leaves your lists. Progress belongs to the word, so it stays
 * either way and comes back if the book is added again.
 */
export function bookRemovalPrompt(bookId: string): { title: string; detail: string; confirm: string } {
  const meta = wordbookMeta(bookId);
  const name = meta?.title || bookId;
  return meta?.user
    ? { title: `Delete “${name}”?`, detail: 'Your progress on its words is kept.', confirm: 'Delete' }
    : { title: `Remove “${name}”?`, detail: 'Your progress on its words is kept.', confirm: 'Remove' };
}

/** Book rows for the Review plan panel: today's new and due words and progress per book. */
export function reviewBookRows(scope: WordsScope, ctx: WordsContext, now = Date.now()): BookProgress[] {
  if (scope === 'mine') return [];
  const ids = scope === 'all' ? ctx.subs.map((s) => s.bookId) : [scope];
  return ids.filter((id) => ctx.books.has(id)).map((id) => bookProgress(id, ctx, now));
}

export type { NotebookEntry };
