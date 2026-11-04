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
import { clean, dayStart, DAY, esc, type NotebookAnalysis, type NotebookEntry } from './notebook-shared';

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
  return `<div class="nbv-table" data-layout="${layout}">${bar}<div class="nbv-table__felt">${pileHtml}${cards}</div></div>`;
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

/** Top-left corner of the unscaled card, rotation, and scale (scattered cards are smaller). */
type Pos = { x: number; y: number; rot: number; s?: number };
type Stored = { fx: number; fy: number; rot: number };

/** Scattered positions outlive a re-render (the phone repaints the whole page). */
const scattered = new Map<string, Stored>();
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
};
const FALLBACK_EASE = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
const GLIDE_EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';

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
  const win: any = table.ownerDocument.defaultView || globalThis;
  const cards = Array.from(felt.querySelectorAll('.nbv-card')) as HTMLElement[];
  const pileEls = Array.from(felt.querySelectorAll('.nbv-pile')) as HTMLElement[];
  if (!cards.length) return;
  const pileKeys = pileEls.map((p) => p.dataset.pile || '');
  const pileSize = new Map<string, number>();
  for (const c of cards) pileSize.set(c.dataset.pile || '', (pileSize.get(c.dataset.pile || '') || 0) + 1);
  const alpha = [...cards].sort((x, y) => (x.dataset.q || '').localeCompare(y.dataset.q || '', undefined, { sensitivity: 'base', numeric: true }));
  const cur = new Map<HTMLElement, Pos>();
  const ac = new AbortController();
  const on = (el: any, type: string, fn: (e: any) => void, capture = false) => el.addEventListener(type, fn, { signal: ac.signal, capture });
  const reduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const canSpring = !!win.CSS?.supports?.('transition-timing-function', 'linear(0, 1)');
  let layout = (table.dataset.layout as CardLayout) || 'piles';
  let cw = 0;
  let ch = 0;
  let W = 0;
  let H = 0;
  let moveTimer = 0;
  // Scattered cards shrink a little so more of the pile fits on one screen of table.
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
  };

  /** Where every card and pile label goes in `l`; also sets the felt height H. */
  const compute = (l: CardLayout, fresh = false) => {
    const pos = new Map<HTMLElement, Pos>();
    const labels = new Map<string, { x: number; y: number }>();
    const gap = W < 560 ? 10 : 16;
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
      pileKeys.forEach((k, i) => labels.set(k, { x: ox + (i % cols) * slotW, y: 28 + Math.floor(i / cols) * slotH }));
      for (const c of cards) {
        const at = labels.get(c.dataset.pile || '')!;
        const rank = Number(c.dataset.rank) || 0;
        const r = Math.min(rank, PILE_FACE_CARDS - 1);
        const id = c.dataset.id || '';
        pos.set(c, {
          x: at.x + (seeded(id, 1) - 0.5) * 2 * r * 3,
          y: at.y + (seeded(id, 2) - 0.5) * 2 * r * 2,
          rot: rank === 0 ? (seeded(id, 3) - 0.5) * 3 : (seeded(id, 3) - 0.5) * 14,
        });
      }
      H = 40 + Math.ceil(pileKeys.length / cols) * slotH;
      return { pos, labels };
    }
    // Scatter: each pile bursts into its own band of the table, sized so the cards cover the
    // band about one and a half times over, with some table still showing between them.
    const usable = Math.max(1, W - ew);
    const bands: Array<{ key: string; top: number; h: number }> = [];
    let y = 0;
    for (const k of pileKeys) {
      const n = pileSize.get(k) || 0;
      const h = Math.max(eh + 64, (n * ew * eh) / (W * 1.5));
      bands.push({ key: k, top: y, h });
      y += h;
    }
    H = Math.max(y + 16, eh + 80);
    const band = new Map(bands.map((b) => [b.key, b]));
    for (const b of bands) labels.set(b.key, { x: 6, y: b.top + 8 });
    for (const c of cards) {
      const id = c.dataset.id || '';
      let s = fresh ? undefined : scattered.get(id);
      if (!s) {
        const b = band.get(c.dataset.pile || '')!;
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
      for (const c of cards) c.style.zIndex = String(10 + PILE_FACE_CARDS * 4 - (Number(c.dataset.rank) || 0));
    } else {
      for (const c of cards) c.style.zIndex = '1';
    }
  };

  const syncBar = () => {
    table.dataset.layout = layout;
    table.querySelectorAll('[data-cards-layout]').forEach((b: any) => {
      const onIt = b.dataset.cardsLayout === layout;
      b.classList.toggle('is-active', onIt);
      b.setAttribute('aria-pressed', String(onIt));
    });
  };

  const apply = (l: CardLayout, animate: boolean, fresh = false) => {
    const before = H;
    const { pos, labels } = compute(l, fresh);
    const motion = animate && !reduced();
    const prev = layout;
    layout = l;
    syncBar();
    setZ(l);
    felt.style.height = `${Math.round(Math.max(H, motion ? Math.min(before, H + 400) : H))}px`;
    pileEls.forEach((p) => {
      const at = labels.get(p.dataset.pile || '');
      if (at) p.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
    });
    // Only cards that start or end on screen fly; the rest jump, so 600 cards cost what 60 do.
    const rect = felt.getBoundingClientRect();
    const vh = win.innerHeight || 800;
    const seen = (p: Pos | undefined) => !!p && rect.top + p.y < vh + 40 && rect.top + p.y + ch > -40;
    const sp = l === 'scatter' ? SPRINGS.burst : l === 'grid' ? SPRINGS.grid : SPRINGS.gather;
    let flying = 0;
    let longest = 0;
    cards.forEach((c) => {
      const to = pos.get(c)!;
      const from = cur.get(c);
      c.getAnimations?.().forEach((an: any) => an.cancel());
      c.style.transform = tf(to);
      cur.set(c, to);
      if (!motion || !from || flying > 140 || (!seen(from) && !seen(to))) return;
      // Cards deep in a pile end up hidden under it, so only the first few fly home.
      if (l === 'piles' && (Number(c.dataset.rank) || 0) >= PILE_FACE_CARDS * 2) return;
      if (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5 && Math.abs(from.rot - to.rot) < 0.2 && from.s === to.s) return;
      const delay = Math.min(flying * (l === 'scatter' ? 7 : 4), 260) + (l === 'scatter' ? (Number(c.dataset.rank) || 0) % 3 * 12 : 0);
      flying += 1;
      longest = Math.max(longest, delay + sp.duration);
      c.animate([{ transform: tf(from) }, { transform: tf(to) }], {
        duration: canSpring ? sp.duration : 520,
        delay,
        easing: canSpring ? sp.easing : FALLBACK_EASE,
        fill: 'backwards',
      });
    });
    // Hidden pile cards stay visible until they have landed back in the pile.
    win.clearTimeout(moveTimer);
    if (motion && (prev !== l || flying)) {
      table.classList.add('is-moving');
      moveTimer = win.setTimeout(() => {
        table.classList.remove('is-moving');
        felt.style.height = `${Math.round(H)}px`;
      }, longest + 40);
    } else {
      table.classList.remove('is-moving');
    }
  };

  const choose = (l: CardLayout, fresh = false) => {
    if (l === 'scatter' && (layout === 'piles' || layout === 'scatter')) fresh = true;
    if (fresh) zOrder.clear();
    apply(l, true, fresh);
    opts.onLayout?.(l);
  };

  measure();
  apply(layout, false);
  table.classList.add('is-ready');

  /* Controls: the layout buttons, and a tap on a pile or a piled card scatters. */
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
    const pile = t.closest?.('.nbv-pile');
    const card = t.closest?.('.nbv-card');
    if (layout === 'piles' && (pile || (card && !keyOpen))) {
      ev.stopPropagation();
      ev.preventDefault();
      choose('scatter');
    }
    keyOpen = false;
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

  /* Dragging, on the scattered table only. */
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
  const clampPos = (p: Pos): Pos => ({
    x: Math.min(Math.max(p.x, -offX - ew * 0.25), W - ew * 0.75 - offX),
    y: Math.min(Math.max(p.y, -offY - eh * 0.15), H - eh * 0.6 - offY),
    rot: p.rot,
    s: p.s,
  });
  const paintDrag = () => {
    if (!drag) return;
    drag.raf = 0;
    const p = clampPos({ ...drag.base, x: drag.base.x + drag.px - drag.sx, y: drag.base.y + drag.py - drag.sy });
    // Lean into the motion a little, like a card pushed by one finger.
    const s = drag.samples;
    const vx = s.length > 1 ? (s[s.length - 1].x - s[0].x) / Math.max(16, s[s.length - 1].t - s[0].t) : 0;
    p.rot = drag.base.rot + Math.max(-9, Math.min(9, vx * 6));
    drag.el.style.transform = tf(p, 1.05);
    cur.set(drag.el, p);
  };
  on(felt, 'pointerdown', (ev: any) => {
    if (layout !== 'scatter' || drag || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const el = (ev.target as HTMLElement).closest?.('.nbv-card') as HTMLElement | null;
    if (!el) return;
    // A finger on a meaning list that scrolls scrolls it instead of picking the card up.
    const list = (ev.target as HTMLElement).closest?.('.nbv-card__back ol') as HTMLElement | null;
    if (list && ev.pointerType !== 'mouse' && list.scrollHeight > list.clientHeight + 1) return;
    drag = { el, id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, base: cur.get(el)!, live: false, samples: [], raf: 0, px: ev.clientX, py: ev.clientY };
  });
  on(felt, 'pointermove', (ev: any) => {
    if (!drag || ev.pointerId !== drag.id) return;
    drag.px = ev.clientX;
    drag.py = ev.clientY;
    if (!drag.live) {
      const slop = ev.pointerType === 'mouse' ? 4 : 8;
      if (Math.hypot(drag.px - drag.sx, drag.py - drag.sy) < slop) return;
      drag.live = true;
      drag.el.getAnimations?.().forEach((an: any) => an.cancel());
      drag.el.setPointerCapture?.(ev.pointerId);
      drag.el.classList.add('is-lifted');
      zTop += 1;
      zOrder.set(drag.el.dataset.id || '', zTop);
      drag.el.style.zIndex = String(zTop);
      drag.sx = drag.px;
      drag.sy = drag.py;
    }
    const t = ev.timeStamp || win.performance.now();
    drag.samples.push({ x: drag.px, y: drag.py, t });
    while (drag.samples.length > 2 && t - drag.samples[0].t > 90) drag.samples.shift();
    if (!drag.raf) drag.raf = win.requestAnimationFrame(paintDrag);
  });
  const endDrag = (ev: any, cancelled: boolean) => {
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
    const glide = reduced() ? 0 : 260; // px of travel per px/ms of release speed
    const raw = { ...d.base, x: at.x + vx * glide, y: at.y + vy * glide, rot: Math.max(-28, Math.min(28, d.base.rot + Math.max(-12, Math.min(12, vx * 8)))) };
    const end = clampPos(raw);
    const hitEdge = end.x !== raw.x || end.y !== raw.y;
    const from = cur.get(d.el) || at;
    d.el.style.transform = tf(end);
    cur.set(d.el, end);
    scattered.set(d.el.dataset.id || '', { fx: (end.x + offX) / Math.max(1, W - ew), fy: (end.y + offY) / Math.max(1, H - eh), rot: end.rot });
    if (reduced()) return;
    const sp = SPRINGS.burst;
    d.el.animate([{ transform: tf(from, 1.05) }, { transform: tf(end) }], {
      duration: hitEdge && canSpring ? sp.duration : Math.round(320 + Math.min(500, speed * 260)),
      easing: hitEdge && canSpring ? sp.easing : GLIDE_EASE,
    });
  };
  on(felt, 'pointerup', (ev: any) => endDrag(ev, false));
  on(felt, 'pointercancel', (ev: any) => endDrag(ev, true));
  // Touch: once a card is lifted the page must not scroll under the finger.
  on(felt, 'touchmove', (ev: any) => {
    if (drag?.live) ev.preventDefault();
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
    win.clearTimeout(moveTimer);
  };
}
