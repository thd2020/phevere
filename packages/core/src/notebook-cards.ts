/**
 * Cards view: every word is an index card on a table. The cards start in piles (one pile per
 * stretch of time the words were saved in). Clicking a pile pours its cards out where it lies:
 * they spread into the pile's place and the places after it, and the piles that follow slide
 * out of their way. Clicking the pile's first card again, or its label, gathers them back, as
 * the card you opened in Apple Wallet puts the stack back. Expand all, in the table's corner, or
 * a double shake of the phone pours every pile out at once and gathers them again. A card's
 * picture turns it over, its back turns it back, and its text opens the lookup; on the first
 * card of a poured-out pile the text gathers the pile, and the Look up on its back opens the
 * lookup.
 *
 * `cardsHtml` returns the markup; `attachCardTable` lays the cards out and runs the motion.
 * Every place on the table is computed here as an absolute `transform`, so a change is a FLIP
 * without measuring the DOM: a card's old transform is the First, the computed one the Last,
 * and the Web Animations API plays the Invert with a spring. Only the cards near the screen
 * exist in the DOM, so a word book of thousands of words opens as fast as a list of ten.
 */
import { vocabReadings, vocabSenses } from './vocab-view';
import { clean, dayStart, DAY, esc, revealBelow, scrollerOf, visibleBand, type NotebookAnalysis, type NotebookEntry } from './notebook-shared';
import { onDoubleShake } from './shake';
import { vocabLookupLang } from './vocab-lang';
import { formatDate, t, tHtml } from './i18n/runtime';

/** Piles, or every pile poured out. */
export type CardLayout = 'piles' | 'grid';

/** A stored layout, including the Scatter layout of earlier versions, which became the grid. */
export function cardLayoutOf(v: unknown): CardLayout {
  return v === 'grid' || v === 'scatter' ? 'grid' : 'piles';
}

/**
 * Whether every pile is out, kept per list: 'mine' for My words, a book's id, 'all' for All
 * books. Under '*' is the one choice earlier versions kept for every list (Scatter among them),
 * which a list follows until it has a choice of its own.
 */
export type CardLayouts = Record<string, CardLayout>;

/** The saved layouts, from their stored JSON or from the single layout of earlier versions. */
export function readCardLayouts(stored: unknown): CardLayouts {
  if (stored == null || stored === '') return {};
  if (typeof stored === 'string' && stored.trim().startsWith('{')) {
    try {
      const raw = JSON.parse(stored) as Record<string, unknown>;
      const out: CardLayouts = {};
      for (const [k, v] of Object.entries(raw || {})) out[k] = cardLayoutOf(v);
      return out;
    } catch {
      return {};
    }
  }
  return { '*': cardLayoutOf(stored) };
}

/** The layout a list opens with. */
export function cardLayoutIn(layouts: CardLayouts, list: string): CardLayout {
  return layouts[list] ?? layouts['*'] ?? 'piles';
}

/** The layouts with one list's choice changed, to store as JSON. */
export function withCardLayout(layouts: CardLayouts, list: string, layout: CardLayout): CardLayouts {
  return { ...layouts, [list]: layout };
}

export interface CardPile {
  key: string;
  label: string;
  /** Newest first: ids[0] is the top card. */
  ids: string[];
}

/** Cards drawn on top of each pile; the rest are drawn when the pile is poured out. */
export const PILE_FACE_CARDS = 4;
const MAX_PILES = 6;

function savedAt(e: NotebookEntry): number {
  return Number(e.createdAt || e.updatedAt || 0);
}

/**
 * Piles by when the words were saved: this week, last week, then one pile per month, newest
 * first. Past six piles the oldest months fold into one "Earlier" pile. Words of a word book
 * that were never started have no date and go last, in the book's order, in a "New" pile.
 */
export function cardPiles(entries: NotebookEntry[], now = Date.now()): CardPile[] {
  const today = new Date(dayStart(now));
  const weekStart = today.getTime() - ((today.getDay() + 6) % 7) * DAY;
  const lastWeekStart = weekStart - 7 * DAY;
  const nowYear = today.getFullYear();
  const piles = new Map<string, CardPile>();
  const order: string[] = [];
  const sorted = [...entries].sort((a, b) => savedAt(b) - savedAt(a));
  for (const e of sorted) {
    const at = savedAt(e);
    let key: string;
    let label: string;
    if (!at) {
      const unsaved = (e as { saved?: boolean }).saved === false;
      key = unsaved ? 'new' : 'earlier';
      label = unsaved ? t('notebook.cards.pile.new') : t('notebook.cards.pile.earlier');
    } else if (at >= weekStart) {
      key = 'week';
      label = t('notebook.cards.pile.thisWeek');
    } else if (at >= lastWeekStart) {
      key = 'last-week';
      label = t('notebook.cards.pile.lastWeek');
    } else {
      const d = new Date(at);
      key = `m-${d.getFullYear()}-${d.getMonth()}`;
      label = formatDate(d, d.getFullYear() === nowYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
    }
    let pile = piles.get(key);
    if (!pile) {
      pile = { key, label, ids: [] };
      piles.set(key, pile);
      order.push(key);
    }
    pile.ids.push(e.id);
  }
  // "Earlier" (saved, no date) goes after the months, and a book's new words after that.
  let list = order.filter((k) => k !== 'earlier' && k !== 'new').map((k) => piles.get(k)!);
  if (piles.has('earlier')) list.push(piles.get('earlier')!);
  if (list.length > MAX_PILES) {
    const rest: CardPile = { key: 'earlier', label: t('notebook.cards.pile.earlier'), ids: list.slice(MAX_PILES - 1).flatMap((p) => p.ids) };
    list = [...list.slice(0, MAX_PILES - 1), rest];
  }
  if (piles.has('new')) list.push(piles.get('new')!);
  return list;
}

const SPREAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const STACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9.5h10v10H5zM8 6.5h10v10M11 3.5h10v10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const FLIP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M17.5 3v3.6h-3.6M6.5 21v-3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOOK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/** What the last `cardsHtml` drew, so `attachCardTable` can draw the rest of its cards later. */
interface Deck {
  scope: string;
  piles: CardPile[];
  byId: Map<string, NotebookEntry>;
  a: NotebookAnalysis;
  flipped: Set<string>;
}
let lastDeck: Deck | null = null;

/** Expand all is a toggle: its name stays, aria-pressed says whether every pile is out. */
function allButtonHtml(all: boolean): string {
  return `${all ? STACK_ICON : SPREAD_ICON}<span>${tHtml('notebook.cards.expandAll')}</span>`;
}

/**
 * The table with its piles and the top cards of each; `attachCardTable` draws the other cards
 * when they come near the screen. On desktop and phone alike, the card's picture turns it over
 * (as the turn button does) and its text opens the lookup. On the back, a click anywhere turns
 * it back, and the Look up button in its corner opens the lookup. Once a pile is poured out, the
 * text of its first card gathers it again (`attachCardTable`). `opts.list` names the list
 * the cards are from ('mine', a book's id, 'all'); `onLayout` hands it back with each change.
 * `opts.picFlips` is kept for callers written before turning by the picture was the default.
 */
export function cardsHtml(
  entries: NotebookEntry[],
  a: NotebookAnalysis,
  flipped: Set<string>,
  layout: CardLayout | string = 'piles',
  now = Date.now(),
  opts: { picFlips?: boolean; list?: string } = {},
): string {
  if (!entries.length) return `<p class="nbv-empty">${tHtml('notebook.cards.empty')}</p>`;
  const l = cardLayoutOf(layout);
  const piles = cardPiles(entries, now);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const scope = tableScope(entries);
  lastDeck = { scope, piles, byId, a, flipped };
  const body = piles
    .map(
      (p) => `<button type="button" class="nbv-pile${p.ids.length > PILE_FACE_CARDS ? ' has-depth' : ''}" data-pile="${esc(p.key)}" aria-expanded="false" aria-label="${tHtml('notebook.cards.pileAria', { pile: p.label, count: p.ids.length })}">
        <span class="nbv-pile__stack" aria-hidden="true"></span>
        <span class="nbv-pile__label">${esc(p.label)}<b>${p.ids.length}</b></span>
      </button>${p.ids
        .slice(0, PILE_FACE_CARDS)
        .map((id, rank) => cardHtml(byId.get(id)!, a, flipped.has(id), p.key, rank))
        .join('')}`,
    )
    .join('');
  // The table keeps the height it had last time, so a repaint (the phone repaints the whole page)
  // does not shrink the page for a moment and pull the scroll position back to the top.
  const kept = feltHeight.get(`${scope}|${l}`);
  const style = kept ? ` style="height:${Math.round(kept)}px"` : '';
  const corner = `<div class="nbv-table__corner"><button type="button" class="nbv-table__all" data-cards-all aria-pressed="${l === 'grid'}">${allButtonHtml(l === 'grid')}</button></div>`;
  const list = opts.list ? ` data-list="${esc(opts.list)}"` : '';
  return `<div class="nbv-table" data-layout="${l}" data-scope="${scope}"${list}><div class="nbv-table__felt"${style}>${corner}${body}</div></div>`;
}

/** Which list the table shows (My words, a book), so open piles and heights stay with their list. */
function tableScope(entries: NotebookEntry[]): string {
  let h = 2166136261;
  for (const e of entries) {
    const id = String(e.id);
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 44, 16777619);
  }
  return `${entries.length}-${(h >>> 0).toString(36)}`;
}

function cardHtml(e: NotebookEntry, a: NotebookAnalysis, open: boolean, pile: string, rank: number): string {
  const w = a.words.get(e.id);
  const lemma = clean(e.lemma);
  const reading = vocabReadings(e.reading)[0];
  const senses = vocabSenses(e.definition).slice(0, 8);
  const flip = ` data-act="nb-flip" data-id="${esc(e.id)}"`;
  const morphs = (w?.morphs || []).filter((m) => m.kind !== 'char' || m.gloss).slice(0, 3);
  const parts = w && w.parts.length > 1 ? w.parts : [];
  const note = clean(e.note);
  // The Danish "give" opens in Danish, not as the English word its letters suggest.
  const lang = vocabLookupLang({ lemma, sourceLang: clean(e.sourceLang) });
  const look = `data-act="lookup" data-q="${esc(lemma)}"${lang ? ` data-lang="${esc(lang)}"` : ''}`;
  const flipLabel = open ? tHtml('notebook.cards.showWord') : tHtml('notebook.cards.showMeaning');
  return `<article class="nbv-card${open ? ' is-flipped' : ''}" data-q="${esc(lemma)}" data-id="${esc(e.id)}" data-pile="${esc(pile)}" data-rank="${rank}"${rank >= PILE_FACE_CARDS ? ' data-deep' : ''} tabindex="0" aria-label="${tHtml('notebook.cards.openLookup', { word: lemma })}">
    <div class="nbv-card__inner">
      <div class="nbv-card__face nbv-card__front">
        <div class="nbv-card__pic"${flip} data-img-lemma="${esc(lemma)}" data-img-lang="${esc(clean(e.sourceLang))}" data-img-gloss="${esc(senses[0] || '')}" data-img-pos="${esc(clean(e.partOfSpeech || ''))}"><span aria-hidden="true">${esc(lemma.charAt(0))}</span></div>
        <div class="nbv-card__body" ${look}>
          <h3 class="nbv-card__word">${parts.length ? parts.map((p, i) => `<span>${esc(p)}</span>${i < parts.length - 1 ? '<i>·</i>' : ''}`).join('') : esc(lemma)}</h3>
          ${reading ? `<p class="nbv-card__ipa">${esc(reading.ipa)}</p>` : ''}
          ${morphs.length ? `<ul class="nbv-card__morphs">${morphs
            .map((m) => `<li><span class="nbv-morph nbv-morph--${m.kind}">${esc(m.label)}</span>${esc(m.gloss)}</li>`)
            .join('')}</ul>` : ''}
          ${note ? `<p class="nbv-card__note">${esc(note)}</p>` : ''}
        </div>
      </div>
      <div class="nbv-card__face nbv-card__back"${flip}>
        <h3 class="nbv-card__word">${esc(lemma)}</h3>
        ${senses.length ? `<ol>${senses.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : `<p>${tHtml('notebook.list.noDefinition')}</p>`}
        <button type="button" class="nbv-card__look" ${look} tabindex="${open ? 0 : -1}">${LOOK_ICON}<span>${tHtml('common.lookup')}</span></button>
      </div>
    </div>
    <button type="button" class="nbv-card__flip" data-act="nb-flip" data-id="${esc(e.id)}" aria-pressed="${open}" aria-label="${flipLabel}" title="${flipLabel}">${FLIP_ICON}</button>
  </article>`;
}

/* --------------------------------------------------------------- the layout */

/** Top-left corner of the card, and its rotation in degrees. */
export type CardPos = { x: number; y: number; rot: number };

export interface TableGeometry {
  /** Table width, card width and height, and the gap between cards, in px. */
  width: number;
  cardW: number;
  cardH: number;
  gap: number;
}

export interface TablePlan {
  /** Where each card lies, by id, for every card of every pile. */
  cards: Map<string, CardPos>;
  /** Where each pile's label sits: the pile's place, or the first card's place when poured out. */
  piles: Map<string, { x: number; y: number }>;
  height: number;
  cols: number;
}

/** Room above the first row for the Expand all button, and under a pile for its label. */
const TABLE_TOP = 58;
const LABEL_ROOM = 50;
const TABLE_FOOT = 20;

/** Stable per-card jitter: the same card leans the same way in its pile every time. */
function seeded(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/**
 * Lay the table out as one flow of places, row by row: a closed pile takes one place and an
 * open pile one place per card, starting where the pile lay. So opening a pile spreads it from
 * its own place and pushes only the piles after it along, and the rows before it never move.
 * A row with a label under it (a pile, or the first card of an open pile) is taller.
 */
export function planTable(piles: CardPile[], open: Set<string>, g: TableGeometry): TablePlan {
  const cols = Math.max(1, Math.floor((g.width + g.gap) / (g.cardW + g.gap)));
  const ox = Math.max(0, (g.width - (cols * g.cardW + (cols - 1) * g.gap)) / 2);
  type Slot = { pile: CardPile; rank: number };
  const slots: Slot[] = [];
  for (const p of piles) {
    if (open.has(p.key)) p.ids.forEach((_, rank) => slots.push({ pile: p, rank }));
    else slots.push({ pile: p, rank: -1 });
  }
  const cards = new Map<string, CardPos>();
  const at = new Map<string, { x: number; y: number }>();
  let y = TABLE_TOP;
  for (let r = 0; r * cols < slots.length; r++) {
    const row = slots.slice(r * cols, (r + 1) * cols);
    let labelled = false;
    row.forEach((s, i) => {
      const x = ox + i * (g.cardW + g.gap);
      if (s.rank <= 0) {
        labelled = true;
        at.set(s.pile.key, { x, y });
      }
      if (s.rank >= 0) {
        // A poured card lands a little off true, like a card dropped on a table.
        const id = s.pile.ids[s.rank];
        cards.set(id, { x: x + (seeded(id, 5) - 0.5) * 6, y: y + (seeded(id, 6) - 0.5) * 6, rot: (seeded(id, 7) - 0.5) * 2.4 });
        return;
      }
      s.pile.ids.forEach((id, rank) => {
        const k = Math.min(rank, PILE_FACE_CARDS - 1);
        cards.set(id, {
          x: x + (seeded(id, 1) - 0.5) * 2 * k * 3,
          y: y + (seeded(id, 2) - 0.5) * 2 * k * 2,
          rot: rank === 0 ? (seeded(id, 3) - 0.5) * 3 : (seeded(id, 3) - 0.5) * 14,
        });
      });
    });
    y += g.cardH + (labelled ? LABEL_ROOM : g.gap);
  }
  return { cards, piles: at, height: y + TABLE_FOOT, cols };
}

/* ------------------------------------------------------------------ motion */

/** A damped spring sampled into a CSS `linear()` easing, with the time it takes to settle. */
function spring(zeta: number, omega: number): { easing: string; duration: number } {
  const settle = Math.min(1.2, -Math.log(0.002) / (zeta * omega));
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const pts: string[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * settle;
    const x = i === N ? 1 : 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    pts.push(x.toFixed(4).replace(/\.?0+$/, '') || '0');
  }
  return { easing: `linear(${pts.join(', ')})`, duration: Math.round(settle * 1000) };
}

/**
 * Springs in Apple's terms of response and damping (omega = 2π / response): poured cards land
 * with a small settle, piles pushed aside slide without one, and gathered cards snap home.
 */
const SPRINGS = {
  pour: spring(0.74, (2 * Math.PI) / 0.5),
  shift: spring(0.9, (2 * Math.PI) / 0.45),
  gather: spring(0.86, (2 * Math.PI) / 0.4),
  tilt: spring(0.7, 17),
};
const FALLBACK_EASE = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
/** Reduced motion keeps every move, short and without overshoot. */
const QUICK_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const QUICK_MS = 160;
/** How long a card takes to turn over (.nbv-card__inner in notebook-cards.css). */
const TURN_MS = 550;
/** Poured cards leave the pile one after another, this far apart, up to POUR_SPAN in all. */
const POUR_STEP = 16;
const POUR_SPAN = 340;

function tf(p: CardPos): string {
  return `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) rotate(${p.rot.toFixed(2)}deg)`;
}

/** Open piles of each list, which outlive a re-render (the phone repaints the whole page). */
const openByScope = new Map<string, Set<string>>();
/** The felt's last height per list and layout, written into the next render's markup. */
const feltHeight = new Map<string, number>();
let detachTable: (() => void) | null = null;

export interface CardTableOptions {
  /**
   * Called when every pile of a list comes out or one goes back, with the list named by
   * `cardsHtml`'s `opts.list`, so the shell can remember it for that list.
   */
  onLayout?: (layout: CardLayout, list: string) => void;
  /** Called after more cards are drawn, so the shell can fill in their pictures. */
  onCards?: () => void;
}

/**
 * Lay out and animate the cards rendered by `cardsHtml` inside `root`. Safe to call after
 * every render: the previous table's listeners are dropped first.
 */
export function attachCardTable(root: any, opts: CardTableOptions = {}): void {
  detachTable?.();
  detachTable = null;
  const table: HTMLElement | null = root?.querySelector?.('.nbv-table') || null;
  if (!table) return;
  const felt = table.querySelector('.nbv-table__felt') as HTMLElement;
  const corner = table.querySelector('.nbv-table__corner') as HTMLElement | null;
  const allBtn = table.querySelector('[data-cards-all]') as HTMLElement | null;
  const doc = table.ownerDocument;
  const win: any = doc.defaultView || globalThis;
  const scope = table.dataset.scope || '';
  const els = new Map<string, HTMLElement>();
  for (const c of Array.from(felt.querySelectorAll('.nbv-card')) as HTMLElement[]) els.set(c.dataset.id || '', c);
  if (!els.size) return;
  const pileEls = new Map<string, HTMLElement>();
  for (const p of Array.from(felt.querySelectorAll('.nbv-pile')) as HTMLElement[]) pileEls.set(p.dataset.pile || '', p);
  // The deck the markup came from; a table drawn some other way has only the cards it shows.
  const deck = lastDeck && lastDeck.scope === scope ? lastDeck : null;
  const piles: CardPile[] = deck
    ? deck.piles
    : Array.from(pileEls.keys()).map((key) => ({
        key,
        label: '',
        ids: Array.from(els.values())
          .filter((c) => c.dataset.pile === key)
          .sort((x, y) => Number(x.dataset.rank) - Number(y.dataset.rank))
          .map((c) => c.dataset.id || ''),
      }));
  const pileKeys = piles.map((p) => p.key);
  const pileOf = new Map<string, { pile: string; rank: number }>();
  for (const p of piles) p.ids.forEach((id, rank) => pileOf.set(id, { pile: p.key, rank }));

  const ac = new AbortController();
  const on = (el: any, type: string, fn: (e: any) => void, o: { capture?: boolean; passive?: boolean } = {}) =>
    el.addEventListener(type, fn, { signal: ac.signal, ...o });
  const reduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const canSpring = !!win.CSS?.supports?.('transition-timing-function', 'linear(0, 1)');
  const openPiles = openByScope.get(scope) || new Set<string>();
  openByScope.set(scope, openPiles);
  let layout = cardLayoutOf(table.dataset.layout);
  if (layout === 'grid') pileKeys.forEach((k) => openPiles.add(k));
  else if (pileKeys.length && pileKeys.every((k) => openPiles.has(k))) openPiles.clear();
  for (const k of Array.from(openPiles)) if (!pileEls.has(k)) openPiles.delete(k);

  let plan: TablePlan = { cards: new Map(), piles: new Map(), height: 0, cols: 1 };
  /** What each drawn card shows: its place, straightened while its meaning is read. */
  const shownAt = new Map<HTMLElement, CardPos>();
  const pileShown = new Map<string, { x: number; y: number }>();
  let cw = 0;
  let ch = 0;
  let W = 0;
  let gap = 16;
  /** The part of the screen the table can be seen in, as px from the screen's top. */
  let band = { top: 0, bottom: 600 };
  let motionUntil = 0;
  let moveTimer = 0;
  /** Clicks on piles wait until a pile has finished opening or closing. */
  let busyUntil = 0;
  let zTop = 100;

  const measure = () => {
    const first = els.values().next().value as HTMLElement;
    cw = first.offsetWidth || 180;
    ch = first.offsetHeight || 250;
    W = felt.clientWidth || 360;
    gap = W < 560 ? 10 : 16;
    band = visibleBand(table);
    // The corner button stays below a bar fixed over the top of the page.
    const sc = scrollerOf(table);
    const page = sc === doc.scrollingElement || sc === doc.documentElement;
    if (corner) corner.style.top = `${Math.max(0, Math.round(band.top - (page ? 0 : sc.getBoundingClientRect().top)))}px`;
  };
  const isOpen = (k: string) => openPiles.has(k);
  const outOf = (c: HTMLElement) => isOpen(c.dataset.pile || '');
  /**
   * A card turned to its meaning straightens up while it is read: tilted text is hard to read,
   * and a tilted list would scroll along the page while its lines run along the card.
   */
  const view = (c: HTMLElement, p: CardPos): CardPos => (p.rot !== 0 && c.classList.contains('is-flipped') && outOf(c) ? { ...p, rot: 0 } : p);
  /** The part of the table on screen, in px from the felt's top. */
  const onScreen = () => {
    const top = felt.getBoundingClientRect().top;
    return { top: band.top - top, bottom: band.bottom - top };
  };
  const screenH = () => Math.max(320, band.bottom - band.top);
  /**
   * Which cards are drawn: the top cards of every closed pile, and the cards of open piles
   * within a screen of the part on screen. Cards further than three screens away are dropped.
   */
  const wanted = (id: string, near: { top: number; bottom: number }, keepFar: boolean) => {
    const o = pileOf.get(id);
    if (!o) return false;
    if (!isOpen(o.pile)) return o.rank < PILE_FACE_CARDS;
    const p = plan.cards.get(id);
    if (!p) return false;
    const m = screenH() * (keepFar ? 3 : 1);
    return p.y + ch > near.top - m && p.y < near.bottom + m;
  };

  const pileName = new Map<string, string>();
  for (const p of piles) pileName.set(p.key, p.label || (pileEls.get(p.key)?.getAttribute('aria-label') || '').split(',')[0]);
  /** The first card of a poured-out pile, which gathers the pile when its text is clicked. */
  const isHead = (c: HTMLElement) => outOf(c) && pileOf.get(c.dataset.id || '')?.rank === 0;
  /**
   * A card on a closed pile opens the pile, a poured-out card the lookup, and the first card of a
   * poured-out pile gathers it; its name says which.
   */
  const labelCard = (c: HTMLElement) => {
    const q = c.dataset.q || '';
    const pile = pileName.get(c.dataset.pile || '') || '';
    const name = isHead(c)
      ? t('notebook.cards.gatherPile', { word: q, pile })
      : outOf(c)
        ? t('notebook.cards.openLookup', { word: q })
        : t('notebook.cards.openPile', { word: q, pile });
    if (c.getAttribute('aria-label') !== name) c.setAttribute('aria-label', name);
  };

  const setZ = (c: HTMLElement) => {
    const o = pileOf.get(c.dataset.id || '');
    const rank = o?.rank ?? 0;
    // Poured cards sit above every pile they fly over; a card turned to its meaning goes on top.
    c.style.zIndex = String(outOf(c) ? (c.classList.contains('is-flipped') ? zTop : 40) : 10 + PILE_FACE_CARDS * 4 - Math.min(rank, PILE_FACE_CARDS * 4));
  };

  const make = (id: string, pile: string, rank: number): HTMLElement | null => {
    const e = deck?.byId.get(id);
    if (!e || !deck) return null;
    const tpl = doc.createElement('template');
    tpl.innerHTML = cardHtml(e, deck.a, deck.flipped.has(id), pile, rank);
    return tpl.content.firstElementChild as HTMLElement;
  };

  /**
   * Draw the cards that should be on the table and drop the ones far away. New cards start at
   * `from` (where the card was before a change) or, by default, where they lie now. Each card
   * goes right after its pile and the cards before it, so Tab runs through a pile in order.
   */
  const syncCards = (from?: Map<string, CardPos>): HTMLElement[] => {
    const near = onScreen();
    const made: HTMLElement[] = [];
    const active = doc.activeElement;
    const cull = win.performance.now() > motionUntil;
    for (const p of piles) {
      let prev: Element = pileEls.get(p.key) || felt.lastElementChild!;
      p.ids.forEach((id, rank) => {
        let el = els.get(id);
        if (el && cull && !wanted(id, near, true) && !el.contains(active)) {
          el.remove();
          els.delete(id);
          shownAt.delete(el);
          el = undefined;
        }
        if (!el && wanted(id, near, false)) {
          el = make(id, p.key, rank) || undefined;
          if (!el) return;
          prev.after(el);
          els.set(id, el);
          made.push(el);
          el.classList.toggle('is-out', isOpen(p.key));
          labelCard(el);
          const at = from?.get(id) || plan.cards.get(id)!;
          const shown = view(el, at);
          el.style.transform = tf(shown);
          shownAt.set(el, shown);
          setZ(el);
        }
        if (el) prev = el;
      });
    }
    return made;
  };

  const syncButton = () => {
    const all = layout === 'grid';
    table.dataset.layout = layout;
    if (!allBtn) return;
    allBtn.setAttribute('aria-pressed', String(all));
    if (allBtn.dataset.all !== String(all)) {
      allBtn.dataset.all = String(all);
      allBtn.innerHTML = allButtonHtml(all);
    }
  };

  /**
   * Lay the table out for the open piles and move everything to its new place. `opening` and
   * `closing` name the piles that just opened or closed: their cards pour out one after another
   * or gather back; everything else slides. Returns how long the cards take to land, in ms.
   */
  const apply = (animate: boolean, opening = new Set<string>(), closing = new Set<string>()): number => {
    const before = plan;
    const beforeH = before.height;
    plan = planTable(piles, openPiles, { width: W, cardW: cw, cardH: ch, gap });
    syncButton();
    const quick = reduced();
    for (const [, el] of els) {
      el.classList.toggle('is-out', outOf(el));
      labelCard(el);
    }
    // The table keeps its old height until the cards have landed, so the page does not jump.
    felt.style.height = `${Math.round(animate ? Math.max(plan.height, beforeH) : plan.height)}px`;
    // Cards that come out of an opening pile start on the pile.
    if (animate) motionUntil = win.performance.now() + 2000;
    syncCards(animate ? before.cards : undefined);
    const rect = felt.getBoundingClientRect();
    const seen = (p: CardPos | { x: number; y: number } | undefined) => !!p && rect.top + p.y < band.bottom + 60 && rect.top + p.y + ch > band.top - 60;
    let flying = 0;
    let longest = 0;
    const easeOf = (sp: { easing: string; duration: number }) => ({
      duration: quick ? QUICK_MS : canSpring ? sp.duration : 520,
      easing: quick ? QUICK_EASE : canSpring ? sp.easing : FALLBACK_EASE,
    });
    for (const [key, el] of pileEls) {
      const at = plan.piles.get(key);
      if (!at) continue;
      const old = pileShown.get(key);
      el.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
      pileShown.set(key, at);
      const open = isOpen(key);
      el.classList.toggle('is-open', open);
      el.setAttribute('aria-expanded', String(open));
      if (!animate || !old || (Math.abs(old.x - at.x) < 0.5 && Math.abs(old.y - at.y) < 0.5) || (!seen(old) && !seen(at))) continue;
      el.getAnimations?.().forEach((an: any) => an.cancel());
      const e = easeOf(SPRINGS.shift);
      el.animate([{ transform: `translate3d(${old.x.toFixed(1)}px, ${old.y.toFixed(1)}px, 0)` }, { transform: el.style.transform }], e);
      longest = Math.max(longest, e.duration);
    }
    for (const [id, el] of els) {
      const logical = plan.cards.get(id);
      if (!logical) continue;
      const to = view(el, logical);
      const from = shownAt.get(el);
      el.getAnimations?.().forEach((an: any) => an.cancel());
      el.style.transform = tf(to);
      shownAt.set(el, to);
      setZ(el);
      if (!animate || !from || flying > 160 || (!seen(from) && !seen(to))) continue;
      if (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5 && Math.abs(from.rot - to.rot) < 0.2) continue;
      const k = el.dataset.pile || '';
      const rank = pileOf.get(id)?.rank ?? 0;
      const pouring = opening.has(k);
      const gathering = closing.has(k);
      const e = easeOf(pouring ? SPRINGS.pour : gathering ? SPRINGS.gather : SPRINGS.shift);
      // Poured cards leave the pile from the top down, as books slide off a tipped pile.
      const delay = quick ? 0 : pouring ? Math.min(rank * POUR_STEP, POUR_SPAN) : gathering ? Math.min(flying * 6, 120) : 0;
      flying += 1;
      longest = Math.max(longest, delay + e.duration);
      el.animate([{ transform: tf(from) }, { transform: tf(to) }], { ...e, delay, fill: 'backwards' });
    }
    win.clearTimeout(moveTimer);
    const settle = () => {
      table.classList.remove('is-moving');
      felt.style.height = `${Math.round(plan.height)}px`;
      motionUntil = 0;
      const made = syncCards();
      if (made.length) opts.onCards?.();
    };
    if (animate && longest) {
      // Cards of a closed pile stay drawn until they have landed back on it.
      table.classList.add('is-moving');
      motionUntil = win.performance.now() + longest + 60;
      // A timer rather than onfinish: a hidden page holds animations, and the table must settle.
      moveTimer = win.setTimeout(settle, longest + 60);
    } else settle();
    feltHeight.set(`${scope}|${layout}`, plan.height);
    if (animate) opts.onCards?.();
    return longest;
  };

  /** Remember the layout when every pile is open (the grid) or not, and tell the shell. */
  const syncLayout = () => {
    const next: CardLayout = pileKeys.length && pileKeys.every(isOpen) ? 'grid' : 'piles';
    if (next === layout) return;
    layout = next;
    opts.onLayout?.(next, table.dataset.list || '');
  };

  /**
   * Open one pile where it lies, or gather it back. The pile's place never moves, since only
   * the places after it change; when it opens the page then scrolls just enough to show the
   * first rows poured out of it.
   */
  const setPile = (key: string, open: boolean) => {
    if (open === isOpen(key)) return;
    if (open) openPiles.add(key);
    else openPiles.delete(key);
    syncLayout();
    const ms = apply(true, open ? new Set([key]) : new Set(), open ? new Set() : new Set([key]));
    busyUntil = win.performance.now() + Math.min(ms, 700);
    const pileEl = pileEls.get(key);
    const at = plan.piles.get(key);
    if (open && at && pileEl) {
      const top = felt.getBoundingClientRect().top + at.y;
      revealBelow(table, top, Math.min(plan.height - at.y, screenH() * 0.7), top);
    }
    if (!open) pileEl?.focus({ preventScroll: true });
  };

  /** Expand all, pressed or not: pour every pile out at once, or gather them all. */
  const toggleAll = () => {
    const all = layout !== 'grid';
    const changed = new Set(pileKeys.filter((k) => isOpen(k) !== all));
    if (!changed.size) return;
    for (const k of changed) {
      if (all) openPiles.add(k);
      else openPiles.delete(k);
    }
    syncLayout();
    const near = onScreen();
    apply(true, all ? changed : new Set(), all ? new Set() : changed);
    // Gathered from far down the table: bring the piles back into view as the cards fly home.
    if (!all && near.top > 0) {
      const sc = scrollerOf(table);
      sc.scrollBy?.({ top: -near.top - 8, behavior: reduced() ? 'auto' : 'smooth' });
    }
  };

  measure();
  apply(false);
  table.classList.add('is-ready');

  /**
   * Clicks that turn a card rather than look it up. While a card turns it is edge-on for a
   * moment, and a click then lands on the card between its faces; right after a turn, a click
   * on the text is one more of a run of fast clicks. Both turn the card again, so fast clicks on
   * the picture only ever turn it.
   */
  const turnedAt = new WeakMap<HTMLElement, number>();
  const turnsCard = (card: HTMLElement, t: HTMLElement) => {
    if (t.closest?.('.nbv-card__flip, .nbv-card__look')) return false;
    if (!t.closest?.('.nbv-card__face')) return true;
    return !!t.closest?.('.nbv-card__body') && win.performance.now() - (turnedAt.get(card) ?? -Infinity) < TURN_MS;
  };

  /* Controls: Expand all, a pile or a card on it opens the pile, and the open pile's label or first card gathers it. */
  on(table, 'click', (ev: any) => {
    const t = ev.target as HTMLElement;
    const stop = () => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    if (t.closest?.('[data-cards-all]')) {
      stop();
      toggleAll();
      return;
    }
    const pile = t.closest?.('.nbv-pile') as HTMLElement | null;
    const card = t.closest?.('.nbv-card') as HTMLElement | null;
    if (card && outOf(card)) {
      if (turnsCard(card, t)) {
        stop();
        (card.querySelector('.nbv-card__flip') as HTMLElement | null)?.click();
        return;
      }
      // The first card's face, but for its picture (which turns it), gathers the pile again.
      if (!isHead(card) || card.classList.contains('is-flipped') || t.closest?.('.nbv-card__pic, .nbv-card__flip')) return;
      stop();
      if (win.performance.now() < busyUntil) return;
      setPile(card.dataset.pile || '', false);
      return;
    }
    if (!pile && !card) return;
    stop();
    // While a pile opens or closes, a second click on it does nothing.
    if (win.performance.now() < busyUntil) return;
    const k = (pile || card)?.dataset.pile || '';
    setPile(k, !isOpen(k));
  }, { capture: true });
  // A quick second click must not select the word under the pointer either.
  on(felt, 'dblclick', (ev: any) => {
    if ((ev.target as HTMLElement).closest?.('.nbv-card, .nbv-pile')) ev.preventDefault();
  });
  on(table, 'keydown', (ev: any) => {
    if (ev.key !== 'Enter') return;
    const t = ev.target as HTMLElement;
    if (!t.classList?.contains('nbv-card')) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Enter on a poured card does what its text does (the lookup, or on the first card, gather
    // the pile); on a pile's card it opens the pile.
    if (outOf(t)) (t.querySelector('.nbv-card__body') as HTMLElement | null)?.click();
    else t.click();
  });

  /* Turning a card over (done by the shell's nb-flip handler) straightens or re-tilts it. */
  const MO = win.MutationObserver;
  const mo = MO
    ? new MO((recs: any[]) => {
        for (const r of recs) {
          const c = r.target as HTMLElement;
          if (!c.classList?.contains('nbv-card')) continue;
          const flipped = c.classList.contains('is-flipped');
          if (flipped === String(r.oldValue || '').split(/\s+/).includes('is-flipped')) continue;
          turnedAt.set(c, win.performance.now());
          const look = c.querySelector('.nbv-card__look') as HTMLElement | null;
          if (look) look.tabIndex = flipped ? 0 : -1;
          const p = plan.cards.get(c.dataset.id || '');
          if (!p) continue;
          if (flipped) zTop += 1;
          setZ(c);
          const to = view(c, p);
          const from = shownAt.get(c) || to;
          shownAt.set(c, to);
          c.style.transform = tf(to);
          if (Math.abs(from.rot - to.rot) < 0.2) continue;
          c.getAnimations?.().forEach((an: any) => an.cancel());
          const quick = reduced();
          c.animate([{ transform: tf(from) }, { transform: tf(to) }], {
            duration: quick ? QUICK_MS : canSpring ? SPRINGS.tilt.duration : 420,
            easing: quick ? QUICK_EASE : canSpring ? SPRINGS.tilt.easing : FALLBACK_EASE,
          });
        }
      })
    : null;
  mo?.observe(felt, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

  /* Scrolling draws the cards coming near the screen. */
  let raf = 0;
  on(doc, 'scroll', () => {
    if (raf) return;
    raf = win.requestAnimationFrame(() => {
      raf = 0;
      const made = syncCards();
      if (made.length) opts.onCards?.();
    });
  }, { capture: true, passive: true });

  /* A double shake of the phone does what Expand all does. */
  onDoubleShake(win, ac.signal, () => {
    if (table.isConnected) toggleAll();
  }, table);

  /* Width changes re-flow the layout without motion. */
  const RO = win.ResizeObserver;
  let ro: any = null;
  if (RO) {
    let lastW = W;
    ro = new RO(() => {
      const w = felt.clientWidth;
      if (!w || Math.abs(w - lastW) < 1) return;
      lastW = w;
      measure();
      apply(false);
    });
    ro.observe(felt);
  }
  on(win, 'resize', () => {
    band = visibleBand(table);
  });

  detachTable = () => {
    ac.abort();
    ro?.disconnect();
    mo?.disconnect();
    win.clearTimeout(moveTimer);
    if (raf) win.cancelAnimationFrame(raf);
  };
}
