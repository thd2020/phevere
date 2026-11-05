/**
 * Notebook views beyond the list, shared by the desktop window and the phone app:
 *
 * - Families: words grouped by a shared root, prefix, suffix, origin or Han character, and
 *   word trees where one saved word is built from another (nation, national, nationality).
 * - Map: the same relations drawn as a graph, words joined through the morphemes they share.
 * - Cards: a picture, the word split into its parts with their meanings, and the learner's
 *   own note as a mnemonic; the meaning sits on the back of the card.
 *
 * Review (the quiz, the daily plan and its charts) lives in `notebook-review.ts` and is shown in
 * the Learn tab (`learn-view.ts`), not in the Words switcher.
 *
 * Everything here returns HTML strings with `data-act` hooks, like `vocab-view.ts`; the two
 * DOM helpers at the end (map pan and zoom, card pictures) use only standard DOM calls.
 */
import { analyzeMorphemes, derivationStem, morphBreakdown, wordOrigin, type MorphEtymon } from './morphology';
import { cachedEtymon } from './notebook-etymology';
import { clean, type Family, type NotebookAnalysis, type NotebookEntry, type NotebookView, type TreeNode, type WordInfo } from './notebook-shared';

export * from './notebook-shared';
export * from './notebook-families';
export * from './notebook-map';
export * from './notebook-cards';
export * from './notebook-review';

const ICON = {
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  families: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v5M12 9H6v4M12 9h6v4M4 15h4v5H4zM16 15h4v5h-4zM10 2h4v4h-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.3 8.2l2.6 7.5M15.9 7.6l-2.7 8.1M8.5 6.8l7-.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 15l5-4 4 3 3-2 6 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="16" cy="9" r="1.5" fill="currentColor"/></svg>',
};

const VIEW_LABEL: Record<NotebookView, string> = {
  list: 'List',
  families: 'Families',
  map: 'Map',
  cards: 'Cards',
};

const VIEWS: NotebookView[] = ['list', 'families', 'map', 'cards'];

/**
 * The saved Words view. Review used to be one of them; a learner who left the notebook on Review
 * gets the list, and `learn` says to open the Learn tab instead.
 */
export function readNotebookView(stored: string | null | undefined): { view: NotebookView; learn: boolean } {
  if (stored === 'review') return { view: 'list', learn: true };
  return { view: VIEWS.includes(stored as NotebookView) ? (stored as NotebookView) : 'list', learn: false };
}

/* ------------------------------------------------------------------ analysis */

/**
 * Words, their morpheme families and word trees. `etymon` is the etymology cache Families fills
 * from Wiktionary; where it knows a word's origin, the morphemes are checked against it.
 */
export function analyzeNotebook(entries: NotebookEntry[], etymon: (lemma: string) => MorphEtymon | null = cachedEtymon): NotebookAnalysis {
  const words = new Map<string, WordInfo>();
  const byMorph = new Map<string, Family>();
  for (const entry of entries) {
    const lemma = clean(entry.lemma);
    if (!lemma) continue;
    const morphs = analyzeMorphemes(lemma, /^[a-z]/i.test(lemma) ? etymon(lemma) : null);
    words.set(entry.id, { entry, morphs, parts: morphBreakdown(lemma, morphs), origin: wordOrigin(morphs) });
    const seen = new Set<string>();
    for (const m of morphs) {
      const key = `${m.kind}:${m.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let fam = byMorph.get(key);
      if (!fam) {
        fam = { key, kind: m.kind, label: m.label, gloss: m.gloss, origin: m.origin, ids: [], ...(m.forms ? { forms: m.forms } : {}) };
        byMorph.set(key, fam);
      }
      fam.ids.push(entry.id);
    }
  }
  const families = [...byMorph.values()]
    .filter((f) => f.ids.length > 1)
    .sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));

  // Word trees: a saved word whose stem starts another saved word is its parent. Stems go in
  // a map, and each word tries the substrings that could be a parent's stem, so this stays
  // linear in the notebook size.
  const byStem = new Map<string, { id: string; len: number }>();
  const latin: Array<{ id: string; lower: string }> = [];
  for (const w of words.values()) {
    const lower = clean(w.entry.lemma).toLowerCase();
    if (!/^[a-z]+$/.test(lower)) continue;
    latin.push({ id: w.entry.id, lower });
    const stem = derivationStem(lower);
    if (stem.length < 4) continue;
    const prev = byStem.get(stem);
    if (!prev || lower.length < prev.len) byStem.set(stem, { id: w.entry.id, len: lower.length });
  }
  const parent = new Map<string, string>();
  for (const child of latin) {
    let best: { id: string; len: number } | null = null;
    // The stem must start the word, or follow a prefix of at most five letters.
    for (let at = 0; at <= 5; at++) {
      for (let end = child.lower.length - 1; end - at >= 4; end--) {
        if (best && end - at <= best.len) break;
        if (child.lower.length - (end - at) > 9) break;
        const hit = byStem.get(child.lower.slice(at, end));
        if (hit && hit.id !== child.id && hit.len < child.lower.length) {
          best = { id: hit.id, len: end - at };
          break;
        }
      }
    }
    if (best) parent.set(child.id, best.id);
  }
  const kids = new Map<string, string[]>();
  for (const [c, p] of parent) kids.set(p, [...(kids.get(p) || []), c]);
  const build = (id: string, depth = 0): TreeNode => ({
    id,
    children: depth > 6 ? [] : (kids.get(id) || []).map((c) => build(c, depth + 1)),
  });
  const trees = [...kids.keys()]
    .filter((id) => !parent.has(id))
    .map((id) => build(id))
    .sort((a, b) => treeSize(b) - treeSize(a));
  return { words, families, trees, parent };
}

function treeSize(n: TreeNode): number {
  return 1 + n.children.reduce((s, c) => s + treeSize(c), 0);
}

/* ------------------------------------------------------------- view switcher */

export function notebookViewSwitchHtml(view: NotebookView): string {
  const views = VIEWS;
  return `<div class="nbv-switch" role="tablist" aria-label="Notebook view">${views
    .map(
      (v) => `<button type="button" role="tab" class="nbv-switch__btn${v === view ? ' is-active' : ''}" data-act="nb-view" data-view="${v}" aria-selected="${v === view}" title="${VIEW_LABEL[v]}">${ICON[v]}<span>${VIEW_LABEL[v]}</span></button>`,
    )
    .join('')}</div>`;
}

/* --------------------------------------------------------------- DOM helpers */

type Img = { thumb: string; title: string; pageUrl: string; credit: string } | null;

/** How a card asks for its picture: word, language, saved sense, part of speech, and early news. */
export type WordImageFetcher = (
  lemma: string,
  lang?: string,
  gloss?: string,
  pos?: string,
  onPicture?: (img: Img) => void,
) => Promise<Img>;

/** Card pictures being chosen at once, across every list on the page. */
const CARD_SLOTS = 4;
let cardRunning = 0;
const cardQueue = new Set<any>();
const cardState = new WeakMap<any, { visible: boolean; near: boolean; fetch: WordImageFetcher }>();

/**
 * A card behind the top card of a closed pile cannot be seen, so it waits until its pile opens
 * or the table is scattered.
 */
function coveredCard(box: any): boolean {
  const card = box.closest?.('[data-pile][data-rank]');
  if (!card || card.getAttribute('data-rank') === '0') return false;
  const table = card.closest?.('[data-layout]');
  if (!table || table.getAttribute('data-layout') !== 'piles') return false;
  const key = card.getAttribute('data-pile') || '';
  const pile = table.querySelector?.(`.nbv-pile[data-pile="${String(key).replace(/"/g, '\\"')}"]`);
  return !(pile && pile.getAttribute('aria-expanded') === 'true');
}

function showPicture(box: any, img: Img): void {
  if (!img || !img.thumb) return;
  let el = box.querySelector('img');
  if (el && el.getAttribute('src') === img.thumb) return;
  if (!el) {
    el = box.ownerDocument.createElement('img');
    el.loading = 'lazy';
    el.decoding = 'async';
    el.alt = '';
    el.addEventListener('load', () => box.classList.add('has-img'));
    box.appendChild(el);
  }
  el.src = img.thumb;
  el.title = `${img.title} · ${img.credit}`;
  // The credit shows when the picture is tapped (phones have no hover).
  let credit = box.querySelector('.nbv-card__credit');
  if (!credit) {
    credit = box.ownerDocument.createElement('button');
    credit.type = 'button';
    credit.className = 'nbv-card__credit';
    credit.setAttribute('aria-label', 'Picture credit');
    credit.textContent = 'i';
    credit.addEventListener('click', (ev: any) => {
      ev.stopPropagation();
      ev.preventDefault();
      box.classList.toggle('show-credit');
    });
    box.appendChild(credit);
    const line = box.ownerDocument.createElement('span');
    line.className = 'nbv-card__credit-line';
    box.appendChild(line);
  }
  const line = box.querySelector('.nbv-card__credit-line');
  if (line) line.textContent = img.credit;
}

/** Starts the next cards: on screen first, then the ones about to scroll in. */
function pumpCards(): void {
  while (cardRunning < CARD_SLOTS && cardQueue.size) {
    const ready = Array.from(cardQueue).filter((b) => b.isConnected !== false && !coveredCard(b));
    const next = ready.find((b) => cardState.get(b)?.visible) || ready.find((b) => cardState.get(b)?.near);
    if (!next) return;
    cardQueue.delete(next);
    startCard(next);
  }
}

function startCard(box: any): void {
  const st = cardState.get(box);
  if (!st) return;
  box.setAttribute('data-img-done', '1');
  cardRunning += 1;
  const lemma = box.getAttribute('data-img-lemma') || '';
  const gloss = box.getAttribute('data-img-gloss') || undefined;
  const pos = box.getAttribute('data-img-pos') || undefined;
  void st
    .fetch(lemma, box.getAttribute('data-img-lang') || undefined, gloss, pos, (img) => showPicture(box, img))
    .then((img) => {
      if (!img || !img.thumb) {
        if (!box.querySelector('img')) box.classList.add('is-empty');
        return;
      }
      showPicture(box, img);
    })
    .catch(() => {
      if (!box.querySelector('img')) box.classList.add('is-empty');
    })
    .finally(() => {
      cardRunning -= 1;
      pumpCards();
    });
}

/**
 * Fill each `[data-img-lemma]` box with a picture: boxes on screen first, then those within
 * about a screen of it, four at a time. A box that scrolls away before its turn is dropped from
 * the queue (and asked for again when it returns), a card hidden in a closed pile waits, and a
 * picture shows as soon as the first source finds it. The word's saved sense and part of speech
 * go along, so the picture is checked against what the word means.
 */
export function fillWordImages(root: any, fetchImage: WordImageFetcher): void {
  // Boxes already waiting for a picture keep their place in the queue; the card table calls
  // this again each time it draws more cards.
  const boxes: any[] = Array.from(root?.querySelectorAll?.('[data-img-lemma]:not([data-img-done])') || []).filter((b) => !cardState.has(b));
  if (!boxes.length) return;
  for (const b of boxes) cardState.set(b, { visible: false, near: false, fetch: fetchImage });
  const IO = (globalThis as any).IntersectionObserver;
  if (!IO) {
    boxes.slice(0, 24).forEach((b) => {
      (cardState.get(b) as { near: boolean }).near = true;
      cardQueue.add(b);
    });
    pumpCards();
    return;
  }
  const track = (key: 'visible' | 'near') => (items: any[]) => {
    for (const it of items) {
      const st = cardState.get(it.target);
      if (!st || it.target.hasAttribute('data-img-done')) continue;
      st[key] = it.isIntersecting;
      if (st.visible || st.near) cardQueue.add(it.target);
      else cardQueue.delete(it.target);
    }
    pumpCards();
  };
  const seen = new IO(track('visible'), { rootMargin: '0px' });
  const near = new IO(track('near'), { rootMargin: '600px 0px' });
  for (const b of boxes) {
    seen.observe(b);
    near.observe(b);
  }
  // A pile opening or the table being scattered uncovers cards without moving them in or out of
  // view; look again when the table is clicked.
  if (root?.addEventListener && !pumpRoots.has(root)) {
    pumpRoots.add(root);
    root.addEventListener('click', () => setTimeout(pumpCards, 50));
  }
}

const pumpRoots = new WeakSet<object>();
