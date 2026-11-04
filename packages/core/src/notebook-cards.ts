/**
 * Cards view: every saved word is an index card on a table. The cards start in piles (one
 * pile per stretch of time the words were saved in). Opening a pile spreads its cards on the
 * table just below it while the other piles stay where they are; Scatter throws every pile
 * across the table at once. Spread cards can be dragged around freely, and Grid lines them up
 * A to Z. A card's picture turns it over, its back turns it back, and a card that shows its
 * meaning straightens up so its text reads and scrolls along the page.
 *
 * `cardsHtml` returns the markup; `attachCardTable` lays the cards out and runs the motion.
 * Every layout is computed here as an absolute `transform` per card, so a change of layout
 * is a FLIP without measuring the DOM: the card's old transform is the First, the computed
 * one the Last, and the Web Animations API plays the Invert. No animation library is used.
 */
import { vocabReadings, vocabSenses } from './vocab-view';
import { clean, dayStart, DAY, esc, revealBelow, scrollerOf, visibleBand, type NotebookAnalysis, type NotebookEntry } from './notebook-shared';

export type CardLayout = 'piles' | 'scatter' | 'grid';

export interface CardPile {
  key: string;
  label: string;
  /** Newest first: ids[0] is the top card. */
  ids: string[];
}

/** Cards drawn on top of each pile; the rest stay hidden until the pile is scattered. */
export const PILE_FACE_CARDS = 4;
const MAX_PILES = 6;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function savedAt(e: NotebookEntry): number {
  return Number(e.createdAt || e.updatedAt || 0);
}

/**
 * Piles by when the words were saved: this week, last week, then one pile per month, newest
 * first. Past six piles the oldest months fold into one "Earlier" pile.
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
    const t = savedAt(e);
    let key: string;
    let label: string;
    if (!t) {
      key = 'earlier';
      label = 'Earlier';
    } else if (t >= weekStart) {
      key = 'week';
      label = 'This week';
    } else if (t >= lastWeekStart) {
      key = 'last-week';
      label = 'Last week';
    } else {
      const d = new Date(t);
      key = `m-${d.getFullYear()}-${d.getMonth()}`;
      label = d.getFullYear() === nowYear ? MONTHS[d.getMonth()] : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    }
    let pile = piles.get(key);
    if (!pile) {
      pile = { key, label, ids: [] };
      piles.set(key, pile);
      order.push(key);
    }
    pile.ids.push(e.id);
  }
  // "Earlier" (no date) always goes last.
  const list = order.filter((k) => k !== 'earlier').map((k) => piles.get(k)!);
  if (piles.has('earlier')) list.push(piles.get('earlier')!);
  if (list.length <= MAX_PILES) return list;
  const kept = list.slice(0, MAX_PILES - 1);
  const rest: CardPile = { key: 'earlier', label: 'Earlier', ids: list.slice(MAX_PILES - 1).flatMap((p) => p.ids) };
  return [...kept, rest];
}

const LAYOUT_LABEL: Record<CardLayout, string> = { piles: 'Piles', scatter: 'Scatter', grid: 'Grid' };
const LAYOUT_ICON: Record<CardLayout, string> = {
  piles: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9.5h10v10H5zM8 6.5h10v10M11 3.5h10v10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  scatter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 6.8l6-1.6 1.6 6-6 1.6zM13.4 4.2l6.2.6-.6 6.2-6.2-.6zM8.6 14.6l6.1 1.3-1.3 6.1-6.1-1.3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};
const FLIP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M17.5 3v3.6h-3.6M6.5 21v-3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOOK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/**
 * On desktop and phone alike, the card's picture turns it over (as the turn button does) and its
 * text opens the lookup. On the back, a click anywhere turns it back, and the Look up button in
 * its corner opens the lookup. `opts` is kept for callers written before this was the default.
 */
export function cardsHtml(
  entries: NotebookEntry[],
  a: NotebookAnalysis,
  flipped: Set<string>,
  layout: CardLayout = 'piles',
  now = Date.now(),
  _opts: { picFlips?: boolean } = {},
): string {
  if (!entries.length) return `<p class="nbv-empty">No saved words.</p>`;
  const piles = cardPiles(entries, now);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const bar = `<div class="nbv-table__bar" role="toolbar" aria-label="Arrange cards">${(['piles', 'scatter', 'grid'] as CardLayout[])
    .map((l) => `<button type="button" class="nbv-table__btn${l === layout ? ' is-active' : ''}" data-cards-layout="${l}" aria-pressed="${l === layout}">${LAYOUT_ICON[l]}<span>${LAYOUT_LABEL[l]}</span></button>`)
    .join('')}</div>`;
  const pileHtml = piles
    .map(
      (p) => `<button type="button" class="nbv-pile${p.ids.length > PILE_FACE_CARDS ? ' has-depth' : ''}" data-pile="${esc(p.key)}" aria-expanded="false" aria-label="${esc(p.label)}, ${p.ids.length} ${p.ids.length === 1 ? 'card' : 'cards'}">
        <span class="nbv-pile__stack" aria-hidden="true"></span>
        <span class="nbv-pile__label">${esc(p.label)}<b>${p.ids.length}</b></span>
      </button>`,
    )
    .join('');
  const cards = piles
    .flatMap((p) => p.ids.map((id, rank) => cardHtml(byId.get(id)!, a, flipped.has(id), p.key, rank)))
    .join('');
  // The table keeps the height it had last time, so a repaint (the phone repaints the whole page)
  // does not shrink the page for a moment and pull the scroll position back to the top.
  const scope = tableScope(entries);
  const kept = feltHeight.get(`${scope}|${layout}`);
  const style = kept ? ` style="height:${Math.round(kept)}px"` : '';
  return `<div class="nbv-table" data-layout="${layout}" data-scope="${scope}">${bar}<div class="nbv-table__felt"${style}>${pileHtml}${cards}</div></div>`;
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
  return `<article class="nbv-card${open ? ' is-flipped' : ''}" data-act="lookup" data-q="${esc(lemma)}" data-id="${esc(e.id)}" data-pile="${esc(pile)}" data-rank="${rank}"${rank >= PILE_FACE_CARDS ? ' data-deep' : ''} tabindex="0" aria-label="${esc(lemma)}: open lookup">
    <div class="nbv-card__inner">
      <div class="nbv-card__face nbv-card__front">
        <div class="nbv-card__pic"${flip} data-img-lemma="${esc(lemma)}" data-img-lang="${esc(clean(e.sourceLang))}" data-img-gloss="${esc(senses[0] || '')}" aria-hidden="true"><span>${esc(lemma.charAt(0))}</span></div>
        <div class="nbv-card__body">
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
        ${senses.length ? `<ol>${senses.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p>No definition saved.</p>'}
        <button type="button" class="nbv-card__look" data-act="lookup" data-q="${esc(lemma)}" tabindex="${open ? 0 : -1}">${LOOK_ICON}<span>Look up</span></button>
      </div>
    </div>
    <button type="button" class="nbv-card__flip" data-act="nb-flip" data-id="${esc(e.id)}" aria-pressed="${open}" aria-label="${open ? 'Show word' : 'Show meaning'}" title="${open ? 'Show word' : 'Show meaning'}">${FLIP_ICON}</button>
  </article>`;
}

/* --------------------------------------------------------------- the table */

/** Top-left corner of the unscaled card, rotation, and scale (spread cards are smaller). */
type Pos = { x: number; y: number; rot: number; s?: number };
/** A spread card's place, as fractions of the scattered table or of its pile's band. */
type Stored = { fx: number; fy: number; rot: number };
/** The strip of table under a row of piles where an opened pile's cards land. */
type Band = { key: string; top: number; h: number; notch: number };

/** Scattered positions outlive a re-render (the phone repaints the whole page). */
const scattered = new Map<string, Stored>();
/**
 * The open pile of each list (see 	ableScope), and where the reader dragged its cards: x as a
 * fraction of the table's width, y in px below the band's top. These outlive a re-render too.
 */
const openByScope = new Map<string, Set<string>>();
const bandSpots = new Map<string, Stored>();
/** The felt's last height per list and layout, written into the next render's markup. */
const feltHeight = new Map<string, number>();
/** How many cards of each open pile are dealt so far, per list and pile. */
const dealtCount = new Map<string, number>();
const zOrder = new Map<string, number>();
let zTop = 0;
let detachTable: (() => void) | null = null;

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

const SPRINGS = {
  burst: spring(0.62, 13),
  grid: spring(0.86, 15),
  gather: spring(0.78, 14),
  tilt: spring(0.7, 17),
};
const FALLBACK_EASE = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
const GLIDE_EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
/** Reduced motion keeps every move, short and without overshoot. */
const QUICK_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const QUICK_MS = 160;
/** Room at the top of a band for its Gather button, and the band's side margin. */
const BAND_HEAD = 44;
const BAND_PAD = 10;
/** Room under the dealt rows for the More button. */
const MORE_ROOM = 56;

/** Stable per-card jitter: the same card leans the same way in its pile every time. */
function seeded(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function tf(p: Pos, lift = 1): string {
  return `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) rotate(${p.rot.toFixed(2)}deg)${(p.s ?? 1) * lift !== 1 ? ` scale(${((p.s ?? 1) * lift).toFixed(3)})` : ''}`;
}

export interface CardTableOptions {
  /** Called when the reader picks another layout, so the shell can remember it. */
  onLayout?: (layout: CardLayout) => void;
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
  const doc = table.ownerDocument;
  const win: any = doc.defaultView || globalThis;
  const cards = Array.from(felt.querySelectorAll('.nbv-card')) as HTMLElement[];
  const pileEls = Array.from(felt.querySelectorAll('.nbv-pile')) as HTMLElement[];
  if (!cards.length) return;
  const pileKeys = pileEls.map((p) => p.dataset.pile || '');
  const pileSize = new Map<string, number>();
  for (const c of cards) pileSize.set(c.dataset.pile || '', (pileSize.get(c.dataset.pile || '') || 0) + 1);
  const alpha = [...cards].sort((x, y) => (x.dataset.q || '').localeCompare(y.dataset.q || '', undefined, { sensitivity: 'base', numeric: true }));
  /** Where each card belongs (its tilt as thrown) and where it is drawn (straight while read). */
  const cur = new Map<HTMLElement, Pos>();
  const shownAt = new Map<HTMLElement, Pos>();
  const bandEls = new Map<string, HTMLElement>();
  let bands: Band[] = [];
  const ac = new AbortController();
  const on = (el: any, type: string, fn: (e: any) => void, capture = false) => el.addEventListener(type, fn, { signal: ac.signal, capture });
  const reduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const canSpring = !!win.CSS?.supports?.('transition-timing-function', 'linear(0, 1)');
  let layout = (table.dataset.layout as CardLayout) || 'piles';
  const scope = table.dataset.scope || '';
  const openPiles = openByScope.get(scope) || new Set<string>();
  openByScope.set(scope, openPiles);
  /** Clicks on cards wait until a pile has finished opening or closing. */
  let busyUntil = 0;
  let cw = 0;
  let ch = 0;
  let W = 0;
  let H = 0;
  let moveTimer = 0;
  // Spread cards shrink a little so more of the pile fits on one screen of table.
  let sc = 1;
  let ew = 0;
  let eh = 0;
  let offX = 0;
  let offY = 0;

  const measure = () => {
    const first = cards[0];
    cw = first.offsetWidth || 180;
    ch = first.offsetHeight || 250;
    W = felt.clientWidth || 360;
    sc = W < 560 ? 0.74 : 0.86;
    ew = cw * sc;
    eh = ch * sc;
    offX = (cw - ew) / 2;
    offY = (ch - eh) / 2;
    const v = visibleBand(table);
    visH = Math.max(320, v.bottom - v.top);
  };
  let visH = 600;

  const isOut = (c: HTMLElement) => {
    const k = c.dataset.pile || '';
    return layout === 'piles' && openPiles.has(k) && (Number(c.dataset.rank) || 0) <= dealing(k).dealt;
  };
  /**
   * A card turned to its meaning straightens up while it is read: tilted text is hard to read,
   * and a tilted list would scroll along the page while its lines run along the card.
   */
  const view = (c: HTMLElement, p: Pos): Pos =>
    p.rot !== 0 && c.classList.contains('is-flipped') && (layout === 'scatter' || c.classList.contains('is-out')) ? { ...p, rot: 0 } : p;
  const bandFor = (c: HTMLElement) => bands.find((b) => b.key === c.dataset.pile);
  /**
   * An open pile is dealt in rows right under it, newest first. Each row overlaps the lower part
   * of the row before, which still shows its picture and word. One screenful is dealt at a time;
   * More at the bottom of the band deals the next, so a pile of 140 does not run on for pages.
   */
  const dealing = (k: string) => {
    const n = Math.max(0, (pileSize.get(k) || 1) - 1);
    const gap = W < 560 ? 8 : 12;
    const cols = Math.max(2, Math.floor((W - 2 * BAND_PAD + gap) / (ew + gap)));
    const step = Math.round(eh * 0.6);
    const batch = cols * Math.max(2, Math.floor((visH * 0.8 - BAND_HEAD - eh) / step) + 1);
    const dealt = Math.min(n, dealtCount.get(`${scope}|${k}`) ?? batch);
    const rows = Math.max(1, Math.ceil(dealt / cols));
    const more = n - dealt;
    return { n, gap, cols, rows, step, batch, dealt, more, h: BAND_HEAD + eh + (rows - 1) * step + 16 + (more > 0 ? MORE_ROOM : 0) };
  };
  const dealtPos = (b: Band, c: HTMLElement, rank: number): Pos => {
    const id = c.dataset.id || '';
    const s = bandSpots.get(id);
    if (s) return { x: s.fx * W - offX, y: b.top + s.fy - offY, rot: s.rot, s: sc };
    const d = dealing(b.key);
    const i = rank - 1;
    const inRow = Math.min(d.cols, d.dealt - Math.floor(i / d.cols) * d.cols);
    const ox = (W - (inRow * ew + (inRow - 1) * d.gap)) / 2;
    return {
      x: ox + (i % d.cols) * (ew + d.gap) + (seeded(id, 5) - 0.5) * 8 - offX,
      y: b.top + BAND_HEAD + Math.floor(i / d.cols) * d.step + (seeded(id, 6) - 0.5) * 6 - offY,
      rot: (seeded(id, 7) - 0.5) * 7,
      s: sc,
    };
  };

  /** Where every card and pile label goes in `l`; also sets the felt height H and the bands. */
  const compute = (l: CardLayout, fresh = false) => {
    const pos = new Map<HTMLElement, Pos>();
    const labels = new Map<string, { x: number; y: number }>();
    const gap = W < 560 ? 10 : 16;
    bands = [];
    if (l === 'grid') {
      const cols = Math.max(1, Math.floor((W + gap) / (cw + gap)));
      const ox = Math.max(0, (W - (cols * cw + (cols - 1) * gap)) / 2);
      alpha.forEach((c, i) => pos.set(c, { x: ox + (i % cols) * (cw + gap), y: 12 + Math.floor(i / cols) * (ch + gap), rot: 0 }));
      H = 24 + Math.ceil(alpha.length / cols) * (ch + gap);
      return { pos, labels };
    }
    if (l === 'piles') {
      const slotW = cw + (W < 560 ? 14 : 44);
      const slotH = ch + 70;
      // Even rows: six piles on a four-wide table go three and three, not four and two.
      const maxCols = Math.max(1, Math.min(pileKeys.length, Math.floor(W / slotW)));
      const cols = Math.ceil(pileKeys.length / Math.ceil(pileKeys.length / maxCols));
      const ox = (W - cols * slotW) / 2 + (slotW - cw) / 2;
      // An open pile's cards land in a band right under its row; rows above it never move,
      // so the page does not scroll and the pile's top card stays where it was.
      let y = 28;
      for (let r = 0; r * cols < pileKeys.length; r++) {
        const row = pileKeys.slice(r * cols, (r + 1) * cols);
        row.forEach((k, i) => labels.set(k, { x: ox + i * slotW, y }));
        y += slotH;
        for (const k of row) {
          if (!openPiles.has(k)) continue;
          const h = dealing(k).h;
          bands.push({ key: k, top: y - 14, h, notch: labels.get(k)!.x + cw / 2 });
          y += h + 14;
        }
      }
      const band = new Map(bands.map((b) => [b.key, b]));
      for (const c of cards) {
        const k = c.dataset.pile || '';
        const at = labels.get(k)!;
        const rank = Number(c.dataset.rank) || 0;
        const id = c.dataset.id || '';
        const b = band.get(k);
        if (b && rank > 0) {
          pos.set(c, dealtPos(b, c, rank));
          continue;
        }
        const r = Math.min(rank, PILE_FACE_CARDS - 1);
        pos.set(c, {
          x: at.x + (seeded(id, 1) - 0.5) * 2 * r * 3,
          y: at.y + (seeded(id, 2) - 0.5) * 2 * r * 2,
          rot: rank === 0 ? (seeded(id, 3) - 0.5) * 3 : (seeded(id, 3) - 0.5) * 14,
        });
      }
      H = y + 12;
      return { pos, labels };
    }
    // Scatter: each pile bursts into its own band of the table, sized so the cards cover the
    // band about one and a half times over, with some table still showing between them.
    const usable = Math.max(1, W - ew);
    const strips: Array<{ key: string; top: number; h: number }> = [];
    let y = 0;
    for (const k of pileKeys) {
      const n = pileSize.get(k) || 0;
      const h = Math.max(eh + 64, (n * ew * eh) / (W * 1.5));
      strips.push({ key: k, top: y, h });
      y += h;
    }
    H = Math.max(y + 16, eh + 80);
    const strip = new Map(strips.map((b) => [b.key, b]));
    for (const b of strips) labels.set(b.key, { x: 6, y: b.top + 8 });
    for (const c of cards) {
      const id = c.dataset.id || '';
      let s = fresh ? undefined : scattered.get(id);
      if (!s) {
        const b = strip.get(c.dataset.pile || '')!;
        const top = b.top + 30;
        const span = Math.max(0, b.h - eh - 34);
        s = { fx: Math.random(), fy: (top + Math.random() * span) / Math.max(1, H - eh), rot: (Math.random() - 0.5) * 26 };
        scattered.set(id, s);
      }
      pos.set(c, { x: s.fx * usable - offX, y: s.fy * Math.max(1, H - eh) - offY, rot: s.rot, s: sc });
    }
    return { pos, labels };
  };

  const setZ = (l: CardLayout) => {
    if (l === 'scatter') {
      // Stacking survives between scatters; new cards slot in by pile order and rank.
      cards.forEach((c, i) => {
        const id = c.dataset.id || '';
        if (!zOrder.has(id)) zOrder.set(id, cards.length - i);
        c.style.zIndex = String(zOrder.get(id));
        zTop = Math.max(zTop, zOrder.get(id)!);
      });
    } else if (l === 'piles') {
      for (const c of cards) {
        const rank = Number(c.dataset.rank) || 0;
        const id = c.dataset.id || '';
        // Spread cards sit above every pile, each row over the one before; a card picked up or read goes on top.
        c.style.zIndex = String(c.classList.contains('is-out') && rank > 0 ? zOrder.get(id) ?? 40 + rank : 10 + PILE_FACE_CARDS * 4 - rank);
      }
    } else {
      for (const c of cards) c.style.zIndex = '1';
    }
  };
  const raise = (c: HTMLElement) => {
    zTop = Math.max(zTop, 200) + 1;
    zOrder.set(c.dataset.id || '', zTop);
    c.style.zIndex = String(zTop);
  };

  const syncBar = () => {
    table.dataset.layout = layout;
    table.querySelectorAll('[data-cards-layout]').forEach((b: any) => {
      const onIt = b.dataset.cardsLayout === layout;
      b.classList.toggle('is-active', onIt);
      b.setAttribute('aria-pressed', String(onIt));
    });
  };

  /** The tinted strip under an open pile, with its Gather button; built and dropped here. */
  const syncBands = (motion: boolean, quick: boolean) => {
    const want = new Set(bands.map((b) => b.key));
    for (const [k, el] of bandEls) {
      if (want.has(k)) continue;
      bandEls.delete(k);
      if (!motion) {
        el.remove();
        continue;
      }
      const ms = quick ? QUICK_MS : 220;
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: QUICK_EASE, fill: 'forwards' });
      // A timer rather than onfinish: a hidden page holds animations, and the band must still go.
      win.setTimeout(() => el.remove(), ms + 20);
    }
    for (const b of bands) {
      let el = bandEls.get(b.key);
      const fresh = !el;
      if (!el) {
        el = doc.createElement('div');
        el.className = 'nbv-band';
        el.dataset.pile = b.key;
        const label = pileEls.find((p) => p.dataset.pile === b.key)?.querySelector('.nbv-pile__label')?.firstChild?.textContent || '';
        el.innerHTML = `<button type="button" class="nbv-band__gather" data-band-gather="${esc(b.key)}" aria-label="Gather ${esc(label)}">${LAYOUT_ICON.piles}<span>Gather</span></button>`;
        // Right after its pile, so Tab goes from the pile to Gather, then on to the cards.
        const pileEl = pileEls.find((p) => p.dataset.pile === b.key);
        if (pileEl) pileEl.after(el);
        else felt.prepend(el);
        bandEls.set(b.key, el);
      }
      el.style.transform = `translate3d(0, ${b.top.toFixed(1)}px, 0)`;
      el.style.height = `${Math.round(b.h)}px`;
      el.style.setProperty('--notch', `${b.notch.toFixed(1)}px`);
      const left = dealing(b.key).more;
      let more = el.querySelector('.nbv-band__more') as HTMLElement | null;
      if (left > 0 && !more) {
        el.insertAdjacentHTML('beforeend', `<button type="button" class="nbv-band__more" data-band-more="${esc(b.key)}">More<b></b></button>`);
        more = el.querySelector('.nbv-band__more') as HTMLElement;
      }
      if (more && left > 0) (more.querySelector('b') as HTMLElement).textContent = String(left);
      else more?.remove();
      if (fresh && motion) {
        el.animate([{ opacity: 0, transform: `translate3d(0, ${(b.top - 18).toFixed(1)}px, 0)` }, { opacity: 1, transform: el.style.transform }], {
          duration: quick ? QUICK_MS : 420,
          easing: GLIDE_EASE,
        });
      }
    }
  };

  /** Lay the table out as `l`; returns how long the cards take to land, in ms. */
  const apply = (l: CardLayout, animate: boolean, fresh = false): number => {
    const before = H;
    const wasOut = new Set(cards.filter((c) => c.classList.contains('is-out')));
    layout = l;
    for (const c of cards) c.classList.toggle('is-out', isOut(c));
    const { pos, labels } = compute(l, fresh);
    const motion = animate;
    const quick = reduced();
    syncBar();
    setZ(l);
    syncBands(motion, quick);
    felt.style.height = `${Math.round(Math.max(H, motion ? Math.min(before, H + 400) : H))}px`;
    pileEls.forEach((p) => {
      const k = p.dataset.pile || '';
      const at = labels.get(k);
      if (at) p.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
      const open = l === 'piles' && openPiles.has(k);
      p.classList.toggle('is-open', open);
      p.setAttribute('aria-expanded', String(open));
    });
    // Only cards that start or end on screen fly; the rest jump, so 600 cards cost what 60 do.
    const rect = felt.getBoundingClientRect();
    const vh = win.innerHeight || 800;
    const seen = (p: Pos | undefined) => !!p && rect.top + p.y < vh + 40 && rect.top + p.y + ch > -40;
    const sp = l === 'scatter' || l === 'piles' && openPiles.size ? SPRINGS.burst : l === 'grid' ? SPRINGS.grid : SPRINGS.gather;
    let flying = 0;
    let longest = 0;
    cards.forEach((c) => {
      const logical = pos.get(c)!;
      const to = view(c, logical);
      const from = shownAt.get(c);
      c.getAnimations?.().forEach((an: any) => an.cancel());
      c.style.transform = tf(to);
      cur.set(c, logical);
      shownAt.set(c, to);
      if (!motion || !from || flying > 140 || (!seen(from) && !seen(to))) return;
      // Cards deep in a closed pile end up hidden under it, so only the first few fly home.
      const rank = Number(c.dataset.rank) || 0;
      if (l === 'piles' && rank >= PILE_FACE_CARDS * 2 && !wasOut.has(c) && !c.classList.contains('is-out')) return;
      if (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5 && Math.abs(from.rot - to.rot) < 0.2 && from.s === to.s) return;
      const delay = quick ? 0 : Math.min(flying * (sp === SPRINGS.burst ? 7 : 4), 260) + (sp === SPRINGS.burst ? (rank % 3) * 12 : 0);
      const duration = quick ? QUICK_MS : canSpring ? sp.duration : 520;
      flying += 1;
      longest = Math.max(longest, delay + duration);
      c.animate([{ transform: tf(from) }, { transform: tf(to) }], {
        duration,
        delay,
        easing: quick ? QUICK_EASE : canSpring ? sp.easing : FALLBACK_EASE,
        fill: 'backwards',
      });
    });
    // Hidden pile cards stay visible until they have landed back in the pile.
    win.clearTimeout(moveTimer);
    if (motion && flying) {
      table.classList.add('is-moving');
      moveTimer = win.setTimeout(() => {
        table.classList.remove('is-moving');
        felt.style.height = `${Math.round(H)}px`;
      }, longest + 40);
    } else {
      table.classList.remove('is-moving');
      felt.style.height = `${Math.round(H)}px`;
    }
    feltHeight.set(`${scope}|${l}`, H);
    return flying ? longest : 0;
  };

  const choose = (l: CardLayout, fresh = false) => {
    if (l === 'piles' && layout === 'piles') {
      // Piles while some are open gathers them all.
      if (!openPiles.size) return;
      openPiles.clear();
      apply('piles', true);
      return;
    }
    openPiles.clear();
    if (l === 'scatter' && (layout === 'piles' || layout === 'scatter')) fresh = true;
    if (fresh) zOrder.clear();
    apply(l, true, fresh);
    opts.onLayout?.(l);
  };

  const coverOf = (key: string) => cards.find((c) => c.dataset.pile === key && c.dataset.rank === '0');
  /**
   * Open one pile where it lies, or gather it back. One pile is open at a time; whatever closes
   * above it, the pile's top card stays where the reader clicked it, and the page then scrolls
   * just enough to show the first rows of the cards dealt under it.
   */
  const setPile = (key: string, open: boolean) => {
    if (open === openPiles.has(key)) return;
    const cover = coverOf(key);
    const scroller = scrollerOf(table);
    const before = cover?.getBoundingClientRect().top ?? 0;
    if (open) {
      openPiles.clear();
      openPiles.add(key);
      dealtCount.delete(`${scope}|${key}`);
      // Dealt fresh each time the pile is opened.
      for (const c of cards) {
        if (c.dataset.pile !== key) continue;
        bandSpots.delete(c.dataset.id || '');
        zOrder.delete(c.dataset.id || '');
      }
    } else {
      openPiles.delete(key);
    }
    const ms = apply('piles', true);
    busyUntil = win.performance.now() + Math.min(ms, 900);
    const shift = (cover?.getBoundingClientRect().top ?? before) - before;
    if (Math.abs(shift) > 0.5) scroller.scrollTop += shift;
    const b = bands.find((x) => x.key === key);
    if (open && b && cover) {
      const feltTop = felt.getBoundingClientRect().top;
      const { top, bottom } = visibleBand(table);
      revealBelow(table, feltTop + b.top, Math.min(b.h, (bottom - top) * 0.6), cover.getBoundingClientRect().top);
    }
    if (!open) cover?.focus({ preventScroll: true });
  };

  /** Deal the next screenful of an open pile and bring its first new row into view. */
  const dealMore = (key: string) => {
    const d = dealing(key);
    if (d.more <= 0) return;
    dealtCount.set(`${scope}|${key}`, d.dealt + d.batch);
    const ms = apply('piles', true);
    busyUntil = win.performance.now() + Math.min(ms, 900);
    const b = bands.find((x) => x.key === key);
    if (!b) return;
    const y = felt.getBoundingClientRect().top + b.top + BAND_HEAD + d.rows * d.step;
    revealBelow(table, y, Math.min(eh + 2 * d.step, visH * 0.6), y);
    const next = cards.find((c) => c.dataset.pile === key && Number(c.dataset.rank) === d.dealt + 1);
    next?.focus({ preventScroll: true });
  };

  measure();
  apply(layout, false);
  table.classList.add('is-ready');

  /* Controls: the layout buttons, a pile or its top card opens the pile, Gather closes it. */
  let keyOpen = false;
  let suppressClick = false;
  on(table, 'click', (ev: any) => {
    const t = ev.target as HTMLElement;
    const btn = t.closest?.('[data-cards-layout]') as HTMLElement | null;
    if (btn) {
      choose(btn.dataset.cardsLayout as CardLayout);
      return;
    }
    if (suppressClick) {
      suppressClick = false;
      ev.stopPropagation();
      ev.preventDefault();
      return;
    }
    const gather = t.closest?.('[data-band-gather]') as HTMLElement | null;
    if (gather) {
      ev.stopPropagation();
      ev.preventDefault();
      setPile(gather.dataset.bandGather || '', false);
      return;
    }
    const more = t.closest?.('[data-band-more]') as HTMLElement | null;
    if (more) {
      ev.stopPropagation();
      ev.preventDefault();
      dealMore(more.dataset.bandMore || '');
      return;
    }
    if (layout !== 'piles') return;
    const pile = t.closest?.('.nbv-pile') as HTMLElement | null;
    const card = t.closest?.('.nbv-card') as HTMLElement | null;
    // While a pile opens or closes, a second click on its flying cards does nothing.
    if ((pile || card) && win.performance.now() < busyUntil) {
      ev.stopPropagation();
      ev.preventDefault();
      return;
    }
    const k = (pile || card)?.dataset.pile || '';
    if (pile) {
      ev.stopPropagation();
      ev.preventDefault();
      setPile(k, !openPiles.has(k));
    } else if (card && !card.classList.contains('is-out') && !keyOpen) {
      ev.stopPropagation();
      ev.preventDefault();
      setPile(k, true);
    } else if (card && card.dataset.rank === '0' && openPiles.has(k) && !keyOpen && !t.closest?.('.nbv-card__flip, .nbv-card__look')) {
      // The top card of an open pile stays on the pile, and gathers it like the pile does.
      ev.stopPropagation();
      ev.preventDefault();
      setPile(k, false);
    }
  }, true);
  on(table, 'keydown', (ev: any) => {
    if (ev.key !== 'Enter') return;
    const t = ev.target as HTMLElement;
    if (!t.classList?.contains('nbv-card')) return;
    ev.preventDefault();
    ev.stopPropagation();
    keyOpen = true;
    t.click();
    keyOpen = false;
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
          const look = c.querySelector('.nbv-card__look') as HTMLElement | null;
          if (look) look.tabIndex = flipped ? 0 : -1;
          const p = cur.get(c);
          if (!p || drag?.el === c) continue;
          if (flipped && (layout === 'scatter' || c.classList.contains('is-out'))) raise(c);
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

  /* Dragging, on the scattered table and in an open pile's band. */
  let drag: null | {
    el: HTMLElement;
    id: number;
    sx: number;
    sy: number;
    base: Pos;
    live: boolean;
    samples: Array<{ x: number; y: number; t: number }>;
    raf: number;
    px: number;
    py: number;
  } = null;
  const draggable = (el: HTMLElement) => layout === 'scatter' || (el.classList.contains('is-out') && el.dataset.rank !== '0');
  const clampPos = (p: Pos, el: HTMLElement): Pos => {
    const b = layout === 'piles' ? bandFor(el) : undefined;
    const top = b ? b.top + 4 : -eh * 0.15;
    const bottom = b ? b.top + b.h - eh * 0.6 : H - eh * 0.6;
    return {
      x: Math.min(Math.max(p.x, -offX - ew * 0.25), W - ew * 0.75 - offX),
      y: Math.min(Math.max(p.y, top - offY), bottom - offY),
      rot: p.rot,
      s: p.s,
    };
  };
  const store = (el: HTMLElement, p: Pos) => {
    const id = el.dataset.id || '';
    const b = layout === 'piles' ? bandFor(el) : undefined;
    if (b) {
      bandSpots.set(id, { fx: (p.x + offX) / Math.max(1, W), fy: p.y + offY - b.top, rot: p.rot });
    } else {
      scattered.set(id, { fx: (p.x + offX) / Math.max(1, W - ew), fy: (p.y + offY) / Math.max(1, H - eh), rot: p.rot });
    }
  };
  const paintDrag = () => {
    if (!drag) return;
    drag.raf = 0;
    const p = clampPos({ ...drag.base, x: drag.base.x + drag.px - drag.sx, y: drag.base.y + drag.py - drag.sy }, drag.el);
    // Lean into the motion a little, like a card pushed by one finger.
    const s = drag.samples;
    const vx = s.length > 1 ? (s[s.length - 1].x - s[0].x) / Math.max(16, s[s.length - 1].t - s[0].t) : 0;
    const shown = { ...p, rot: view(drag.el, drag.base).rot + Math.max(-9, Math.min(9, vx * 6)) };
    drag.el.style.transform = tf(shown, 1.05);
    shownAt.set(drag.el, shown);
  };
  /** Pick the card up: from here on it follows the pointer and the page does not scroll. */
  const lift = (pointerId: number) => {
    if (!drag || drag.live) return;
    win.clearTimeout(holdTimer);
    drag.live = true;
    drag.el.getAnimations?.().forEach((an: any) => an.cancel());
    try {
      drag.el.setPointerCapture?.(pointerId);
    } catch {
      /* the pointer already went away */
    }
    drag.el.classList.add('is-lifted');
    raise(drag.el);
    drag.sx = drag.px;
    drag.sy = drag.py;
  };
  // A finger swiping up or down scrolls the page; a card is picked up by a long press or by a
  // move that is mostly sideways. The mouse picks it up as soon as it moves.
  const HOLD_MS = 320;
  let holdTimer = 0;
  on(felt, 'pointerdown', (ev: any) => {
    if (drag || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const el = (ev.target as HTMLElement).closest?.('.nbv-card') as HTMLElement | null;
    if (!el || !draggable(el)) return;
    // A finger on a meaning list that scrolls scrolls it instead of picking the card up.
    const list = (ev.target as HTMLElement).closest?.('.nbv-card__back ol') as HTMLElement | null;
    if (list && ev.pointerType !== 'mouse' && list.scrollHeight > list.clientHeight + 1) return;
    drag = { el, id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, base: cur.get(el)!, live: false, samples: [], raf: 0, px: ev.clientX, py: ev.clientY };
    win.clearTimeout(holdTimer);
    if (ev.pointerType !== 'mouse') {
      const id = ev.pointerId;
      holdTimer = win.setTimeout(() => {
        if (drag && drag.id === id && Math.hypot(drag.px - drag.sx, drag.py - drag.sy) < 8) lift(id);
      }, HOLD_MS);
    }
  });
  on(felt, 'pointermove', (ev: any) => {
    if (!drag || ev.pointerId !== drag.id) return;
    drag.px = ev.clientX;
    drag.py = ev.clientY;
    if (!drag.live) {
      const dx = Math.abs(drag.px - drag.sx);
      const dy = Math.abs(drag.py - drag.sy);
      if (ev.pointerType === 'mouse') {
        if (Math.hypot(dx, dy) < 4) return;
      } else {
        if (Math.hypot(dx, dy) < 10) return;
        if (dx < dy * 1.5) {
          // An up or down swipe: the browser scrolls the page, and the card stays put.
          win.clearTimeout(holdTimer);
          drag = null;
          return;
        }
      }
      lift(ev.pointerId);
    }
    const t = ev.timeStamp || win.performance.now();
    drag.samples.push({ x: drag.px, y: drag.py, t });
    while (drag.samples.length > 2 && t - drag.samples[0].t > 90) drag.samples.shift();
    if (!drag.raf) drag.raf = win.requestAnimationFrame(paintDrag);
  });
  const endDrag = (ev: any, cancelled: boolean) => {
    win.clearTimeout(holdTimer);
    if (!drag || ev.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.raf) win.cancelAnimationFrame(d.raf);
    if (!d.live) return;
    suppressClick = !cancelled;
    win.setTimeout(() => (suppressClick = false), 400);
    d.el.classList.remove('is-lifted');
    const at = { ...d.base, x: d.base.x + d.px - d.sx, y: d.base.y + d.py - d.sy };
    // Release velocity from the last 90 ms of movement; a pause before letting go means none.
    const s = d.samples;
    const t = ev.timeStamp || win.performance.now();
    let vx = 0;
    let vy = 0;
    if (!cancelled && s.length > 1 && t - s[s.length - 1].t < 60) {
      const dt = Math.max(16, s[s.length - 1].t - s[0].t);
      vx = (s[s.length - 1].x - s[0].x) / dt;
      vy = (s[s.length - 1].y - s[0].y) / dt;
    }
    const speed = Math.hypot(vx, vy);
    const quick = reduced();
    const glide = quick ? 0 : 260; // px of travel per px/ms of release speed
    const raw = { ...d.base, x: at.x + vx * glide, y: at.y + vy * glide, rot: Math.max(-28, Math.min(28, d.base.rot + Math.max(-12, Math.min(12, vx * 8)))) };
    const end = clampPos(raw, d.el);
    const hitEdge = end.x !== raw.x || end.y !== raw.y;
    const from = shownAt.get(d.el) || view(d.el, at);
    const shown = view(d.el, end);
    d.el.style.transform = tf(shown);
    cur.set(d.el, end);
    shownAt.set(d.el, shown);
    store(d.el, end);
    const sp = SPRINGS.burst;
    d.el.animate([{ transform: tf(from, 1.05) }, { transform: tf(shown) }], {
      duration: quick ? QUICK_MS : hitEdge && canSpring ? sp.duration : Math.round(320 + Math.min(500, speed * 260)),
      easing: quick ? QUICK_EASE : hitEdge && canSpring ? sp.easing : GLIDE_EASE,
    });
  };
  on(felt, 'pointerup', (ev: any) => endDrag(ev, false));
  on(felt, 'pointercancel', (ev: any) => endDrag(ev, true));
  // Touch: once a card is lifted the page must not scroll under the finger.
  on(felt, 'touchmove', (ev: any) => {
    if (drag?.live) ev.preventDefault();
  });
  // The long press that picks a card up must not open the phone's context menu.
  on(felt, 'contextmenu', (ev: any) => {
    if (drag && (ev.target as HTMLElement).closest?.('.nbv-card')) ev.preventDefault();
  });

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
      apply(layout, false);
    });
    ro.observe(felt);
  }

  detachTable = () => {
    ac.abort();
    ro?.disconnect();
    mo?.disconnect();
    win.clearTimeout(moveTimer);
    win.clearTimeout(holdTimer);
  };
}
