/**
 * Families view: words grouped by what they share.
 *
 * - Roots, Prefixes, Suffixes: classical word parts visible in the spelling (`morphology.ts`).
 * - Deep roots: the Proto-Indo-European root Wiktionary gives for the word, which joins words
 *   whose spelling no longer shows it ("transfer", "fertile", "bear").
 * - Origins: the language each word came from, as layered strata, split by the route it took.
 * - Word trees: saved words built from other saved words, drawn as small trees.
 *
 * A family is a folded card with its words stacked behind it; opening it deals them out. Every
 * grouping ends with the words it could not place, so the whole notebook is always reachable.
 */
import type { Morph, MorphKind } from './morphology';
import { cachedEtymon, cachedRootGloss, traceEtymons, traceRootGlosses, type WordEtymon } from './notebook-etymology';
import { clean, esc, revealBelow, scrollerOf, type Family, type FamilyGrouping, type NotebookAnalysis, type TreeNode, type WordInfo } from './notebook-shared';

const GROUP_LABEL: Record<FamilyGrouping, string> = {
  root: 'Roots',
  deep: 'Deep roots',
  prefix: 'Prefixes',
  suffix: 'Suffixes',
  origin: 'Origins',
  tree: 'Word trees',
  char: 'Characters',
};

const ORIGIN_ORDER = ['Latin', 'Greek', 'French', 'Old English', 'Old Norse'];

/** A letter or sign from each origin's own writing, used as the card's watermark. */
const ORIGIN_GLYPH: Record<string, string> = {
  Latin: 'Æ', Greek: 'Ω', French: 'Ç', 'Old English': 'Þ', 'Old Norse': 'ᚱ', Dutch: 'Ĳ', 'Low German': 'ß',
  German: 'ß', Italian: 'È', Spanish: 'Ñ', Portuguese: 'Ã', Arabic: 'ع', Hebrew: 'א', Persian: 'پ',
  Japanese: 'あ', Chinese: '字', Korean: '한', Russian: 'Ж', Hindi: 'अ', Sanskrit: 'अ', Turkish: 'Ş',
  Yiddish: 'ײ', Malay: 'M', Nahuatl: 'tl', 'Proto-Indo-European': '*',
};

const EXPAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export type EtymonLookup = (lemma: string) => WordEtymon | null;

export interface FamiliesOptions {
  etymon?: EtymonLookup;
  /** Shown while the shell is still tracing origins on Wiktionary. */
  tracing?: { done: number; total: number } | null;
}

function glyphFor(origin: string): string {
  return ORIGIN_GLYPH[origin] || origin.charAt(0) || '·';
}

/** Three cells, the filled one showing where the part sits in a word. */
function positionMark(kind: MorphKind | 'deep'): string {
  if (kind === 'char' || kind === 'deep') return '';
  const at = kind === 'prefix' ? 0 : kind === 'root' ? 1 : 2;
  const cells = [0, 1, 2]
    .map((i) => `<rect x="${i * 7}" y="0" width="6" height="10" rx="1.5" class="${i === at ? 'is-on' : ''}"/>`)
    .join('');
  return `<svg class="nbv-fam__pos" viewBox="0 0 20 10" aria-hidden="true">${cells}</svg>`;
}

/**
 * The spellings a family goes by (fac, fic, fec, fect), main one first. `Family.forms` comes from
 * the morphology analysis when it knows them; without it a family has its label alone.
 */
function formsOf(f: { label: string; forms?: unknown }): string[] {
  // The analysis gives "fac · fic · fec · fect"; a list is accepted too.
  const raw = typeof f.forms === 'string' ? f.forms.split(/\s*[·,]\s*/) : Array.isArray(f.forms) ? f.forms : [];
  const extra = raw.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim());
  return [f.label, ...extra.filter((x) => x !== f.label)];
}

function wordChip(info: WordInfo, highlight?: Morph, i = 0, forms: string[] = []): string {
  const lemma = clean(info.entry.lemma);
  let shown = esc(lemma);
  const mark = (start: number, end: number) => `${esc(lemma.slice(0, start))}<b>${esc(lemma.slice(start, end))}</b>${esc(lemma.slice(end))}`;
  if (highlight && highlight.kind !== 'char') {
    const m =
      info.morphs.find((x) => x.kind === highlight.kind && x.label === highlight.label) ||
      info.morphs.find((x) => x.kind === highlight.kind && forms.includes(x.label));
    if (m) shown = mark(m.start, m.end);
    else {
      // The word spells the part another way (infect for fac): mark the longest form it contains.
      const low = lemma.toLowerCase();
      const hit = [...forms].sort((x, y) => y.length - x.length).find((f) => f.length > 1 && low.includes(f.toLowerCase()));
      if (hit) {
        const at = low.indexOf(hit.toLowerCase());
        shown = mark(at, at + hit.length);
      }
    }
  } else if (highlight) {
    shown = [...lemma].map((ch) => (ch === highlight.label ? `<b>${esc(ch)}</b>` : esc(ch))).join('');
  }
  return `<button type="button" class="nbv-word" style="--i:${Math.min(i, 24)}" data-act="lookup" data-q="${esc(lemma)}">${shown}</button>`;
}

function byLemma(a: NotebookAnalysis, ids: string[]): WordInfo[] {
  return ids
    .map((id) => a.words.get(id))
    .filter((w): w is WordInfo => !!w)
    .sort((x, y) => clean(x.entry.lemma).localeCompare(clean(y.entry.lemma)));
}

interface CardSpec {
  kind: MorphKind | 'deep';
  label: string;
  gloss: string;
  origin: string;
  words: WordInfo[];
  highlight?: Morph;
  /** Every spelling of the part, main one first. */
  forms?: string[];
}

/** Tile size by family size: a family of two is a small tile, one of sixteen or more a wide one. */
function sizeOf(n: number): 's' | 'm' | 'l' | 'xl' {
  return n >= 16 ? 'xl' : n >= 8 ? 'l' : n >= 4 ? 'm' : 's';
}
const PEEK: Record<ReturnType<typeof sizeOf>, number> = { s: 2, m: 3, l: 5, xl: 7 };

function familyCard(c: CardSpec, i = 0): string {
  const n = c.words.length;
  const size = sizeOf(n);
  const shown = Math.min(PEEK[size], n);
  // Each word in the peek opens its lookup, as the chips in the open drawer do.
  const peek = c.words
    .slice(0, shown)
    .map((w) => {
      const lemma = esc(clean(w.entry.lemma));
      return `<button type="button" class="nbv-fam__peekw" data-act="lookup" data-q="${lemma}">${lemma}</button>`;
    })
    .join(', ');
  const glyph = c.kind === 'deep' ? '*' : c.origin ? glyphFor(c.origin) : '';
  const forms = c.forms?.length ? c.forms : [c.label];
  const others = forms.filter((f) => f !== c.label);
  return `<details class="nbv-fam nbv-fam--${c.kind} nbv-fam--${size}" style="--i:${Math.min(i, 30)}">
    <summary class="nbv-fam__head">
      ${glyph ? `<span class="nbv-fam__glyph" aria-hidden="true">${esc(glyph)}</span>` : ''}
      <span class="nbv-fam__title">
        ${positionMark(c.kind)}
        <span class="nbv-fam__label">${esc(c.label)}</span>
        ${others.length ? `<span class="nbv-fam__forms">${others.map((f) => `<span>${esc(f)}</span>`).join('')}</span>` : ''}
        ${c.gloss ? `<span class="nbv-fam__gloss">${esc(c.gloss)}</span>` : ''}
      </span>
      <span class="nbv-fam__meta">${c.origin ? `<span class="nbv-origin">${esc(c.origin)}</span>` : ''}<span class="nbv-fam__n">${n}</span></span>
      <span class="nbv-fam__peek">${peek}${n > shown ? ` <i>+${n - shown}</i>` : ''}</span>
    </summary>
    <div class="nbv-fam__words">${c.words.map((w, i) => wordChip(w, c.highlight, i, forms)).join('')}</div>
  </details>`;
}

function sortKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

/**
 * Families in A to Z order, one grid with no letter headings, each tile sized by how many
 * words it holds. Opening a tile shows its words in a drawer under its row (see
 * `attachFamilies`), so the tile itself never moves. Han characters have no alphabet and keep
 * their size order.
 */
function alphabetHtml(cards: CardSpec[], byLetter: boolean): string {
  const sorted = byLetter
    ? [...cards].sort((x, y) => sortKey(x.label).localeCompare(sortKey(y.label)) || x.label.localeCompare(y.label))
    : cards;
  const tiles = sorted.map((c, i) => familyCard(c, i)).join('');
  return `<div class="nbv-fams"><section class="nbv-letter"><div class="nbv-letter__tiles">${tiles}</div></section></div>`;
}

function unsortedHtml(a: NotebookAnalysis, placed: Set<string>, label: string): string {
  const rest = [...a.words.values()]
    .filter((w) => !placed.has(w.entry.id))
    .sort((x, y) => clean(x.entry.lemma).localeCompare(clean(y.entry.lemma)));
  if (!rest.length) return '';
  return `<details class="nbv-unsorted">
    <summary><span>${esc(label)}</span><span class="nbv-fam__n">${rest.length}</span></summary>
    <div class="nbv-fam__words">${rest.map((w, i) => wordChip(w, undefined, i)).join('')}</div>
  </details>`;
}

function coverageHtml(placed: number, total: number, tracing?: FamiliesOptions['tracing']): string {
  const pct = total ? placed / total : 0;
  const r = 15;
  const len = 2 * Math.PI * r;
  const trace =
    tracing && tracing.done < tracing.total
      ? `<span class="nbv-trace"><span style="width:${Math.round((tracing.done / Math.max(1, tracing.total)) * 100)}%"></span></span><span class="nbv-trace__n">Tracing origins ${tracing.done} of ${tracing.total}</span>`
      : '';
  return `<div class="nbv-coverage">
    <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="nbv-coverage__track"/><circle cx="18" cy="18" r="${r}" class="nbv-coverage__fill" stroke-dasharray="${(len * pct).toFixed(1)} ${len.toFixed(1)}"/></svg>
    <span><b>${placed}</b> of ${total} words grouped</span>${trace}
  </div>`;
}

/* ------------------------------------------------------------- deep roots */

export function deepRootFamilies(a: NotebookAnalysis, etymon: EtymonLookup = cachedEtymon): Family[] {
  const byRoot = new Map<string, Family>();
  for (const w of a.words.values()) {
    const e = etymon(clean(w.entry.lemma));
    for (const root of e?.roots || []) {
      let fam = byRoot.get(root);
      if (!fam) {
        fam = { key: `deep:${root}`, kind: 'root', label: root, gloss: '', origin: 'Proto-Indo-European', ids: [] };
        byRoot.set(root, fam);
      }
      if (!fam.ids.includes(w.entry.id)) fam.ids.push(w.entry.id);
    }
  }
  return [...byRoot.values()]
    .filter((f) => f.ids.length > 1)
    .sort((x, y) => y.ids.length - x.ids.length || x.label.localeCompare(y.label));
}

/* ---------------------------------------------------------------- origins */

interface OriginGroup {
  origin: string;
  routes: Map<string, WordInfo[]>;
  count: number;
}

export function originGroups(a: NotebookAnalysis, etymon: EtymonLookup = cachedEtymon): OriginGroup[] {
  const groups = new Map<string, OriginGroup>();
  for (const w of a.words.values()) {
    const e = etymon(clean(w.entry.lemma));
    const origin = e?.origin || w.origin;
    if (!origin) continue;
    const route = e?.origin && e.via.length ? `via ${e.via.join(', ')}` : '';
    let g = groups.get(origin);
    if (!g) {
      g = { origin, routes: new Map(), count: 0 };
      groups.set(origin, g);
    }
    g.routes.set(route, [...(g.routes.get(route) || []), w]);
    g.count += 1;
  }
  return [...groups.values()].sort((x, y) => {
    const ix = ORIGIN_ORDER.indexOf(x.origin);
    const iy = ORIGIN_ORDER.indexOf(y.origin);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || y.count - x.count;
  });
}

function originHtml(a: NotebookAnalysis, etymon: EtymonLookup): { html: string; placed: Set<string> } {
  const groups = originGroups(a, etymon);
  const placed = new Set<string>();
  if (!groups.length) return { html: '', placed };
  const total = groups.reduce((s, g) => s + g.count, 0);
  const bar = `<div class="nbv-origin-bar" role="img" aria-label="${esc(groups.map((g) => `${g.origin} ${g.count}`).join(', '))}">${groups
    .map((g, i) => `<span class="nbv-origin-bar__seg nbv-tone-${i % 6}" style="flex-grow:${g.count}" title="${esc(g.origin)} ${g.count}"></span>`)
    .join('')}</div>`;
  const strata = groups
    .map((g, i) => {
      const share = Math.round((g.count / total) * 100);
      const routes = [...g.routes.entries()].sort(([x], [y]) => (x ? 1 : 0) - (y ? 1 : 0) || x.localeCompare(y));
      const body = routes
        .map(([route, ws]) => {
          ws.forEach((w) => placed.add(w.entry.id));
          const sorted = ws.sort((x, y) => clean(x.entry.lemma).localeCompare(clean(y.entry.lemma)));
          return `<div class="nbv-route">${route ? `<p class="nbv-route__label">${esc(route)}</p>` : ''}<div class="nbv-fam__words">${sorted
            .map((w, j) => wordChip(w, w.morphs.find((m) => m.kind === 'root'), j))
            .join('')}</div></div>`;
        })
        .join('');
      return `<details class="nbv-stratum nbv-stratum--${i % 6}" style="--share:${Math.max(share, 2)}">
        <summary>
          <span class="nbv-stratum__glyph" aria-hidden="true">${esc(glyphFor(g.origin))}</span>
          <span class="nbv-stratum__name">${esc(g.origin)}</span>
          <span class="nbv-stratum__n"><b>${g.count}</b> ${share}%</span>
        </summary>
        <div class="nbv-stratum__body">${body}</div>
      </details>`;
    })
    .join('');
  return { html: `${bar}<div class="nbv-strata">${strata}</div>`, placed };
}

/* ------------------------------------------------------------ word trees */

const LEVEL = 58;
const GROUND = 34;
const TRUNK = 26;

interface Placed {
  id: string;
  label: string;
  x: number;
  depth: number;
  children: Placed[];
}

function placeTree(node: TreeNode, a: NotebookAnalysis, depth: number, cursor: { x: number }): Placed | null {
  const w = a.words.get(node.id);
  if (!w) return null;
  const label = clean(w.entry.lemma);
  const children = node.children.map((c) => placeTree(c, a, depth + 1, cursor)).filter((c): c is Placed => !!c);
  let x: number;
  if (children.length) x = (children[0].x + children[children.length - 1].x) / 2;
  else {
    const width = Math.max(64, label.length * 7.6 + 18);
    x = cursor.x + width / 2;
    cursor.x += width;
  }
  return { id: node.id, label, x, depth, children };
}

function depthOf(p: Placed): number {
  return p.children.reduce((d, c) => Math.max(d, depthOf(c)), p.depth);
}

/** A tree drawn upward: the base word on the trunk, each derived word on a branch with leaves. */
export function treeSvg(node: TreeNode, a: NotebookAnalysis): string {
  const cursor = { x: 12 };
  const root = placeTree(node, a, 0, cursor);
  if (!root) return '';
  const width = Math.max(cursor.x + 12, 150);
  const levels = depthOf(root);
  const height = GROUND + TRUNK + levels * LEVEL + 30;
  const y = (d: number) => height - GROUND - TRUNK - d * LEVEL;
  const stroke = [6.5, 4.2, 2.8, 2, 1.6];
  let branches = '';
  let crowns = '';
  let leaves = '';
  let labels = '';
  let order = 0;
  const walk = (p: Placed) => {
    for (const c of p.children) {
      const px = p.x;
      const py = y(p.depth);
      const cx = c.x;
      const cy = y(c.depth);
      const d = `M${px.toFixed(1)} ${py} C${px.toFixed(1)} ${(py - LEVEL * 0.55).toFixed(1)} ${cx.toFixed(1)} ${(cy + LEVEL * 0.5).toFixed(1)} ${cx.toFixed(1)} ${cy}`;
      branches += `<path class="nbv-branch" d="${d}" pathLength="1" style="--d:${c.depth};stroke-width:${stroke[Math.min(c.depth, 4)]}"/>`;
      const k = order++;
      // A soft crown behind each tip, so even a one-branch tree reads as a tree.
      crowns += `<circle class="nbv-crown" style="--d:${c.depth}" cx="${(cx + (k % 2 ? -5 : 5)).toFixed(1)}" cy="${cy - 4}" r="${c.children.length ? 15 : 21}"/>`;
      leaves += `<g class="nbv-leaf" style="--d:${c.depth}" transform="translate(${cx.toFixed(1)} ${cy})"><ellipse rx="7" ry="3.6" transform="rotate(${k % 2 ? -32 : 32}) translate(${k % 2 ? -7 : 7} 0)"/><circle r="3.2"/></g>`;
      labels += `<g class="nbv-tree__word" data-act="lookup" data-q="${esc(c.label)}" style="--d:${c.depth}" transform="translate(${cx.toFixed(1)} ${cy - 12})"><text text-anchor="middle">${esc(c.label)}</text></g>`;
      walk(c);
    }
  };
  walk(root);
  const baseY = height - GROUND;
  const trunk = `<path class="nbv-trunk" d="M${(root.x - 7).toFixed(1)} ${baseY} C${(root.x - 4).toFixed(1)} ${baseY - TRUNK * 0.6} ${(root.x - 3).toFixed(1)} ${y(0) + 6} ${root.x.toFixed(1)} ${y(0)} C${(root.x + 3).toFixed(1)} ${y(0) + 6} ${(root.x + 4).toFixed(1)} ${baseY - TRUNK * 0.6} ${(root.x + 7).toFixed(1)} ${baseY} Z"/>`;
  const ground = `<ellipse class="nbv-ground" cx="${root.x.toFixed(1)}" cy="${baseY + 1}" rx="${Math.min(width / 2 - 6, 70)}" ry="5"/>`;
  const plate = `<g class="nbv-tree__word nbv-tree__base" data-act="lookup" data-q="${esc(root.label)}" transform="translate(${root.x.toFixed(1)} ${baseY + 22})"><text text-anchor="middle">${esc(root.label)}</text></g>`;
  return `<svg class="nbv-tree-svg" viewBox="0 0 ${width.toFixed(0)} ${height}" width="${width.toFixed(0)}" height="${height}" role="img" aria-label="${esc(root.label)} and the words built from it">${ground}${crowns}${trunk}${branches}${leaves}${labels}${plate}</svg>`;
}

function leafCount(n: TreeNode): number {
  return n.children.length ? n.children.reduce((s, c) => s + leafCount(c), 0) : 1;
}

function collectIds(n: TreeNode, out: Set<string>): void {
  out.add(n.id);
  n.children.forEach((c) => collectIds(c, out));
}

/* ---------------------------------------------------------------- the view */

/** The groupings worth offering for this notebook, in display order. */
export function familyGroupings(a: NotebookAnalysis, etymon: EtymonLookup = cachedEtymon): FamilyGrouping[] {
  const has = (k: MorphKind) => a.families.some((f) => f.kind === k);
  const out: FamilyGrouping[] = [];
  if (has('root')) out.push('root');
  if (deepRootFamilies(a, etymon).length) out.push('deep');
  if (has('prefix')) out.push('prefix');
  if (has('suffix')) out.push('suffix');
  if ([...a.words.values()].some((w) => w.origin || etymon(clean(w.entry.lemma))?.origin)) out.push('origin');
  if (a.trees.length) out.push('tree');
  if (has('char')) out.push('char');
  return out;
}

export function familiesHtml(a: NotebookAnalysis, grouping: FamilyGrouping, opts: FamiliesOptions = {}): string {
  const etymon = opts.etymon || cachedEtymon;
  const options = familyGroupings(a, etymon);
  if (!options.length) {
    return `<p class="nbv-empty">No shared roots, affixes or characters yet.</p>`;
  }
  const g = options.includes(grouping) ? grouping : options[0];
  const chips = `<div class="nbv-chips" role="tablist" aria-label="Group by">${options
    .map((o) => `<button type="button" role="tab" class="nbv-chip${o === g ? ' is-active' : ''}" data-act="nb-group" data-group="${o}" aria-selected="${o === g}">${GROUP_LABEL[o]}</button>`)
    .join('')}</div>`;
  const placed = new Set<string>();
  let body = '';
  let rest = 'Not in a family yet';
  if (g === 'tree') {
    body = `<div class="nbv-forest">${a.trees
      .map((t) => {
        collectIds(t, placed);
        const wide = leafCount(t) >= 4 ? ' is-wide' : '';
        const base = clean(a.words.get(t.id)?.entry.lemma);
        return `<figure class="nbv-grove${wide}">${treeSvg(t, a)}<button type="button" class="nbv-grove__open" data-tree-open aria-label="Open the ${esc(base)} tree" title="Open">${EXPAND_ICON}</button></figure>`;
      })
      .join('')}</div>`;
    rest = 'Not part of a tree';
  } else if (g === 'origin') {
    const o = originHtml(a, etymon);
    body = o.html;
    o.placed.forEach((id) => placed.add(id));
    rest = 'Origin not known yet';
  } else {
    const fams = g === 'deep' ? deepRootFamilies(a, etymon) : a.families.filter((f) => f.kind === g);
    const specs = fams.map((f): CardSpec => {
      f.ids.forEach((id) => placed.add(id));
      return {
        kind: g === 'deep' ? 'deep' : f.kind,
        label: f.label,
        gloss: g === 'deep' ? cachedRootGloss(f.label) : f.gloss,
        origin: g === 'deep' ? '' : f.origin,
        words: byLemma(a, f.ids),
        highlight: g === 'deep' ? undefined : ({ kind: f.kind, label: f.label } as Morph),
        forms: g === 'deep' ? undefined : formsOf(f as Family & { forms?: unknown }),
      };
    });
    body = alphabetHtml(specs, g !== 'char');
  }
  return chips + coverageHtml(placed.size, a.words.size, opts.tracing) + body + unsortedHtml(a, placed, rest);
}

/* -------------------------------------------------------------- tracing */

/** Move the "Tracing origins" bar in place, so open cards stay open while results arrive. */
function showTrace(root: any, p: { done: number; total: number }): void {
  const host = root?.querySelector?.('.nbv-coverage');
  if (!host) return;
  let bar = host.querySelector('.nbv-trace span');
  let label = host.querySelector('.nbv-trace__n');
  if (!bar || !label) {
    host.insertAdjacentHTML('beforeend', '<span class="nbv-trace"><span></span></span><span class="nbv-trace__n"></span>');
    bar = host.querySelector('.nbv-trace span');
    label = host.querySelector('.nbv-trace__n');
  }
  bar.style.width = `${Math.round((p.done / Math.max(1, p.total)) * 100)}%`;
  label.textContent = `Tracing origins ${p.done} of ${p.total}`;
}

let tracing: { done: number; total: number } | null = null;
let inFlight = false;
/** A run that brought nothing back (offline or throttled) is not retried before this time. */
let quietUntil = 0;
const QUIET_MS = 120_000;

/** Progress of the trace in flight, for `familiesHtml`'s `tracing` option. */
export function familiesTraceProgress(): { done: number; total: number } | null {
  return tracing;
}

/**
 * Trace origins and deep roots for the notebook's words, updating the progress bar inside
 * `getRoot()` as it goes and calling `onDone` once if new results came in. Both shells call
 * this whenever the Families view is shown; words already traced cost nothing.
 *
 * `onDone` repaints the view, which calls this again, so it must only fire when a request
 * brought something new. Otherwise the repaint and the trace call each other forever without
 * yielding, and the window freezes.
 */
export function traceNotebookFamilies(lemmas: string[], getRoot: () => any, onDone: () => void): void {
  if (inFlight || Date.now() < quietUntil) return;
  inFlight = true;
  let found = 0;
  void traceEtymons(lemmas, (p) => {
    tracing = p;
    showTrace(getRoot(), p);
  })
    .then(async (n) => {
      found += n;
      const roots = new Set<string>();
      for (const l of lemmas) cachedEtymon(l)?.roots.forEach((r) => roots.add(r));
      found += await traceRootGlosses([...roots]);
    })
    .catch((): void => undefined)
    .finally(() => {
      inFlight = false;
      const wasTracing = !!tracing;
      tracing = null;
      if (!found && wasTracing) quietUntil = Date.now() + QUIET_MS;
      if (found || wasTracing) onDone();
    });
}

/* ------------------------------------------------------------ interaction */

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const SHEET_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const ZOOM_ICON = {
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  in: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

let detachFamilies: (() => void) | null = null;
let closeInspector: (() => void) | null = null;
/** The open inspector's tree, and how to point it at the same tree after a repaint. */
let inspectorWord = '';
let rebindInspector: ((grove: HTMLElement) => void) | null = null;
/** The open family (grouping and label), reopened when a repaint brings the same tile back. */
let openFamilyKey = '';

/** Close the word-tree inspector if it is open; true when it was. The phone's Back uses this. */
export function closeTreeInspector(): boolean {
  if (!closeInspector) return false;
  closeInspector();
  return true;
}

/** True while a word tree is open large; the shells hold back their repaints then too. */
export function treeInspectorOpen(): boolean {
  return !!closeInspector;
}

/**
 * Wire the Families view rendered by `familiesHtml` inside `root`: a family opens into a drawer
 * under its row while the tile stays where it was, the letter index jumps to a letter, and a
 * word tree opens large in an inspector with pan and zoom. Safe to call after every render: an
 * open inspector stays open when the repaint still shows its tree, and closes otherwise.
 */
export function attachFamilies(root: any): void {
  detachFamilies?.();
  detachFamilies = null;
  const fams = root?.querySelector?.('.nbv-fams') as HTMLElement | null;
  const forest = root?.querySelector?.('.nbv-forest') as HTMLElement | null;
  if (closeInspector) {
    const same = forest
      ? ([...forest.querySelectorAll('.nbv-grove')] as HTMLElement[]).find((g) => g.querySelector('.nbv-tree__base')?.getAttribute('data-q') === inspectorWord)
      : undefined;
    if (same && rebindInspector) rebindInspector(same);
    else closeInspector();
  }
  if (!fams && !forest) return;
  const doc = (fams || forest)!.ownerDocument;
  const win: any = doc.defaultView || globalThis;
  const ac = new AbortController();
  const on = (el: any, type: string, fn: (e: any) => void, opts: AddEventListenerOptions = {}) =>
    el.addEventListener(type, fn, { ...opts, signal: ac.signal });
  const reduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let ro: any = null;

  /* Family drawers */
  let drawer: HTMLElement | null = null;
  let openTile: HTMLDetailsElement | null = null;
  /** The last tile on the open tile's line, or the tiles block itself when that is the last line. */
  const rowEnd = (tile: HTMLElement): HTMLElement => {
    let last = tile;
    for (let n = tile.nextElementSibling as HTMLElement | null; n; n = n.nextElementSibling as HTMLElement | null) {
      if (!n.classList.contains('nbv-fam')) continue;
      if (n.offsetTop !== tile.offsetTop) return last;
      last = n;
    }
    // After the block, so the last line keeps its spacer and its tiles keep their widths.
    return tile.parentElement as HTMLElement;
  };
  const place = (tile: HTMLElement) => {
    if (!drawer) return;
    drawer.remove();
    rowEnd(tile).after(drawer);
    const box = tile.parentElement!.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    drawer.style.setProperty('--notch', `${(r.left - box.left + r.width / 2).toFixed(1)}px`);
  };
  const grow = (el: HTMLElement, from: number) => {
    const to = el.offsetHeight;
    if (Math.abs(to - from) < 1) return;
    el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: reduced() ? 140 : 380, easing: SHEET_EASE });
  };
  const group = (root.querySelector('.nbv-chip.is-active') as HTMLElement | null)?.dataset.group || '';
  const keyOf = (tile: HTMLElement) => `${group}|${tile.querySelector('.nbv-fam__label')?.textContent || ''}`;
  /** `quiet`: reopen after a repaint, in place, with no motion, scrolling or focus change. */
  const openFamily = (tile: HTMLDetailsElement, quiet = false) => {
    const scroller = scrollerOf(tile);
    const before = tile.getBoundingClientRect().top;
    const prev = openTile;
    const sameRow = !!(drawer && prev && prev.parentElement === tile.parentElement && rowEnd(prev) === rowEnd(tile));
    const fromH = sameRow && drawer ? drawer.offsetHeight : 0;
    if (prev) prev.open = false;
    if (drawer && !sameRow) drawer.remove();
    if (!drawer || !sameRow) {
      drawer = doc.createElement('div');
      drawer.setAttribute('role', 'region');
      drawer.tabIndex = -1;
    }
    const d = drawer!;
    tile.open = true;
    openTile = tile;
    openFamilyKey = keyOf(tile);
    d.setAttribute('aria-label', tile.querySelector('.nbv-fam__label')?.textContent || '');
    const kind = [...tile.classList].find((c) => /^nbv-fam--(root|prefix|suffix|deep|char)$/.test(c)) || '';
    d.className = `nbv-drawer${kind ? ` ${kind.replace('nbv-fam', 'nbv-drawer')}` : ''}`;
    const words = tile.querySelector('.nbv-fam__words')?.cloneNode(true) as HTMLElement | undefined;
    d.innerHTML = `<button type="button" class="nbv-drawer__close" data-fam-close aria-label="Close">${ZOOM_ICON.close}</button>`;
    if (words) d.prepend(words);
    place(tile);
    if (quiet) return;
    // Whatever closed above it, the tile stays under the pointer.
    const shift = tile.getBoundingClientRect().top - before;
    if (Math.abs(shift) > 0.5) scroller.scrollTop += shift;
    // Keyboard and screen-reader users land in the words; the page itself does not jump.
    d.focus({ preventScroll: true });
    // A drawer that would open below the fold or under the phone's bar is brought into view,
    // never pushing the tile off the top.
    const full = d.offsetHeight;
    const dTop = d.getBoundingClientRect().top;
    grow(d, fromH);
    revealBelow(tile, dTop, Math.min(full, 160), tile.getBoundingClientRect().top);
  };
  const closeFamily = () => {
    if (!openTile) return;
    openTile.open = false;
    openTile = null;
    openFamilyKey = '';
    const d = drawer;
    drawer = null;
    if (!d) return;
    const ms = reduced() ? 120 : 260;
    d.style.overflow = 'hidden';
    d.animate([{ height: `${d.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: ms, easing: EASE_OUT, fill: 'forwards' });
    // A timer, not onfinish: a hidden page holds animations, and the drawer must still go.
    win.setTimeout(() => d.remove(), ms + 20);
  };
  if (fams) {
    fams.classList.add('is-live');
    on(fams, 'click', (ev: any) => {
      const t = ev.target as HTMLElement;
      if (t.closest?.('[data-fam-close]')) {
        closeFamily();
        return;
      }
      const head = t.closest?.('summary.nbv-fam__head') as HTMLElement | null;
      if (!head || !fams.contains(head)) return;
      ev.preventDefault();
      // A word in the tile's peek looks up; the shell's own click handler takes it from here.
      if (t.closest?.('[data-act]')) return;
      const tile = head.parentElement as HTMLDetailsElement;
      if (tile === openTile) closeFamily();
      else openFamily(tile);
    });
    on(fams, 'keydown', (ev: any) => {
      if (ev.key !== 'Escape' || !openTile) return;
      const tile = openTile;
      closeFamily();
      (tile.querySelector('summary') as HTMLElement | null)?.focus();
      ev.stopPropagation();
    });
    const RO = win.ResizeObserver;
    if (RO) {
      let lastW = fams.clientWidth;
      ro = new RO(() => {
        const w = fams.clientWidth;
        if (Math.abs(w - lastW) < 1) return;
        lastW = w;
        if (openTile) place(openTile);
      });
      ro.observe(fams);
    }
    // A repaint (the phone repaints on resume, the desktop when origins finish tracing) brings
    // back the same family open.
    if (openFamilyKey) {
      const again = ([...fams.querySelectorAll('.nbv-fam')] as HTMLDetailsElement[]).find((x) => keyOf(x) === openFamilyKey);
      if (again) openFamily(again, true);
      else openFamilyKey = '';
    }
  }
  /* Word trees open large */
  if (forest) {
    on(forest, 'click', (ev: any) => {
      const t = ev.target as Element;
      if (t.closest?.('[data-act]')) return;
      const grove = t.closest?.('.nbv-grove') as HTMLElement | null;
      if (grove) openInspector(grove);
    });
  }

  function openInspector(grove: HTMLElement): void {
    closeInspector?.();
    const svg0 = grove.querySelector('svg.nbv-tree-svg') as SVGSVGElement | null;
    if (!svg0) return;
    const [, , W, H] = (svg0.getAttribute('viewBox') || '0 0 300 200').split(/\s+/).map(Number);
    const base = grove.querySelector('.nbv-tree__base') as SVGGElement | null;
    const label = base?.getAttribute('data-q') || '';
    const bx = Number((base?.getAttribute('transform') || '').match(/translate\(([\d.]+)/)?.[1]) || W / 2;
    const n = grove.querySelectorAll('.nbv-tree__word').length;
    const overlay = doc.createElement('div');
    overlay.className = 'nbv nbv-inspect';
    overlay.innerHTML = `<div class="nbv-inspect__sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
      <header class="nbv-inspect__bar">
        <h2 class="nbv-inspect__title">${esc(label)}</h2><span class="nbv-inspect__n">${n} words</span>
        <div class="nbv-inspect__tools">
          <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out">${ZOOM_ICON.out}</button>
          <button type="button" data-zoom="fit" aria-label="Fit" title="Fit">${ZOOM_ICON.fit}</button>
          <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in">${ZOOM_ICON.in}</button>
          <button type="button" class="nbv-inspect__close" data-inspect-close aria-label="Close" title="Close">${ZOOM_ICON.close}</button>
        </div>
      </header>
      <div class="nbv-inspect__view">${svg0.outerHTML}</div>
    </div>`;
    doc.body.appendChild(overlay);
    const sheet = overlay.querySelector('.nbv-inspect__sheet') as HTMLElement;
    const view = overlay.querySelector('.nbv-inspect__view') as HTMLElement;
    const svg = view.querySelector('svg') as SVGSVGElement;
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    const io = new AbortController();
    const onI = (el: any, type: string, fn: (e: any) => void, opts: AddEventListenerOptions = {}) =>
      el.addEventListener(type, fn, { ...opts, signal: io.signal });

    // The view: `s` screen pixels per tree unit, and the tree point (x, y) at the top-left corner.
    let s = 1;
    let x = 0;
    let y = 0;
    let tween = 0;
    const size = () => ({ w: view.clientWidth || 320, h: view.clientHeight || 320 });
    const fitScale = () => {
      const { w, h } = size();
      return Math.min(w / W, h / H) * 0.92;
    };
    const minS = () => Math.min(fitScale(), 1) * 0.75;
    const MAX_S = 5;
    const clampS = (v: number) => Math.min(MAX_S, Math.max(minS(), v));
    const draw = () => {
      const { w, h } = size();
      svg.setAttribute('viewBox', `${x.toFixed(2)} ${y.toFixed(2)} ${(w / s).toFixed(2)} ${(h / s).toFixed(2)}`);
    };
    /** Keep some of the tree on screen however far it is dragged. */
    const bound = () => {
      const { w, h } = size();
      const vw = w / s;
      const vh = h / s;
      x = Math.min(Math.max(x, -vw * 0.8), W - vw * 0.2);
      y = Math.min(Math.max(y, -vh * 0.8), H - vh * 0.2);
    };
    const home = (): { s: number; x: number; y: number } => {
      const { w, h } = size();
      // Fit when the labels stay readable; otherwise start at full size on the trunk.
      const ns = Math.min(2.4, Math.max(fitScale(), 0.9));
      const vw = w / ns;
      const vh = h / ns;
      const nx = W <= vw ? W / 2 - vw / 2 : Math.min(Math.max(bx - vw / 2, 0), W - vw);
      const ny = H <= vh ? H / 2 - vh / 2 : H - vh;
      return { s: ns, x: nx, y: ny };
    };
    const go = (to: { s: number; x: number; y: number }, animate: boolean) => {
      win.cancelAnimationFrame(tween);
      if (!animate) {
        ({ s, x, y } = to);
        bound();
        draw();
        return;
      }
      const from = { s, x, y };
      const ms = reduced() ? 120 : 260;
      const t0 = win.performance.now();
      const step = (now: number) => {
        const k = Math.min(1, Math.max(0, (now - t0) / ms));
        const e = 1 - Math.pow(1 - k, 3);
        s = from.s + (to.s - from.s) * e;
        x = from.x + (to.x - from.x) * e;
        y = from.y + (to.y - from.y) * e;
        draw();
        if (k < 1) tween = win.requestAnimationFrame(step);
        else bound();
      };
      tween = win.requestAnimationFrame(step);
    };
    /** Zoom to `ns` keeping the tree point under (px, py) in place. */
    const zoomAt = (ns: number, px: number, py: number, animate: boolean) => {
      ns = clampS(ns);
      const tx = x + px / s;
      const ty = y + py / s;
      go({ s: ns, x: tx - px / ns, y: ty - py / ns }, animate);
    };
    const local = (ev: any) => {
      const r = view.getBoundingClientRect();
      return { px: ev.clientX - r.left, py: ev.clientY - r.top };
    };
    go(home(), false);

    onI(view, 'wheel', (ev: any) => {
      ev.preventDefault();
      const { px, py } = local(ev);
      zoomAt(s * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0018)), px, py, false);
    }, { passive: false });
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    onI(view, 'pointerdown', (ev: any) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pts.size === 1) moved = 0;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      win.cancelAnimationFrame(tween);
    });
    onI(view, 'pointermove', (ev: any) => {
      const p = pts.get(ev.pointerId);
      if (!p) return;
      const dx = ev.clientX - p.x;
      const dy = ev.clientY - p.y;
      p.x = ev.clientX;
      p.y = ev.clientY;
      if (pts.size === 1) {
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4) {
          view.setPointerCapture?.(ev.pointerId);
          view.classList.add('is-panning');
        }
        x -= dx / s;
        y -= dy / s;
        bound();
        draw();
      } else if (pts.size === 2) {
        moved = 99;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = view.getBoundingClientRect();
        if (pinch) zoomAt(s * (d / pinch), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, false);
        pinch = d;
      }
    });
    const lift = (ev: any) => {
      pts.delete(ev.pointerId);
      if (pts.size < 2) pinch = 0;
      if (!pts.size) view.classList.remove('is-panning');
    };
    onI(view, 'pointerup', lift);
    onI(view, 'pointercancel', lift);
    onI(view, 'dblclick', (ev: any) => {
      const { px, py } = local(ev);
      zoomAt(s * 1.8, px, py, true);
    });
    onI(overlay, 'click', (ev: any) => {
      const t = ev.target as Element;
      if (t === overlay || t.closest?.('[data-inspect-close]')) {
        close();
        return;
      }
      const z = (t.closest?.('[data-zoom]') as HTMLElement | null)?.dataset.zoom;
      if (z) {
        const { w, h } = size();
        if (z === 'fit') go(home(), true);
        else zoomAt(s * (z === 'in' ? 1.5 : 1 / 1.5), w / 2, h / 2, true);
        return;
      }
      // A word: look it up through the tree on the page, which the app is listening on.
      const word = t.closest?.('.nbv-tree__word[data-q]') as Element | null;
      if (!word || moved > 4) return;
      const q = word.getAttribute('data-q') || '';
      const orig = [...grove.querySelectorAll('.nbv-tree__word')].find((g) => g.getAttribute('data-q') === q);
      close();
      orig?.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    onI(doc, 'keydown', (ev: any) => {
      // Ctrl and Cmd shortcuts (the window's own zoom among them) are left to the app.
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const { w, h } = size();
      const pan = 60 / s;
      if (ev.key === 'Escape') close();
      else if (ev.key === '+' || ev.key === '=') zoomAt(s * 1.5, w / 2, h / 2, true);
      else if (ev.key === '-' || ev.key === '_') zoomAt(s / 1.5, w / 2, h / 2, true);
      else if (ev.key === '0') go(home(), true);
      else if (ev.key === 'ArrowLeft') go({ s, x: x - pan, y }, true);
      else if (ev.key === 'ArrowRight') go({ s, x: x + pan, y }, true);
      else if (ev.key === 'ArrowUp') go({ s, x, y: y - pan }, true);
      else if (ev.key === 'ArrowDown') go({ s, x, y: y + pan }, true);
      else if (ev.key === 'Tab') {
        // Focus stays inside the sheet while it is open.
        const f = [...sheet.querySelectorAll('button')] as HTMLElement[];
        const i = f.indexOf(doc.activeElement as HTMLElement);
        f[(i + (ev.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      } else return;
      ev.preventDefault();
      ev.stopPropagation();
    }, { capture: true });
    const RO = win.ResizeObserver;
    let vro: any = null;
    if (RO) {
      vro = new RO(() => draw());
      vro.observe(view);
    }
    const ms = reduced() ? 120 : 280;
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: EASE_OUT });
    sheet.animate([{ opacity: 0, transform: 'translateY(14px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: ms + 60, easing: SHEET_EASE });
    (overlay.querySelector('[data-inspect-close]') as HTMLElement | null)?.focus({ preventScroll: true });

    function close(): void {
      if (closeInspector !== close) return;
      closeInspector = null;
      rebindInspector = null;
      inspectorWord = '';
      io.abort();
      vro?.disconnect();
      win.cancelAnimationFrame(tween);
      const out = reduced() ? 100 : 180;
      overlay.style.pointerEvents = 'none';
      overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: out, easing: EASE_OUT, fill: 'forwards' });
      win.setTimeout(() => overlay.remove(), out + 20);
      (grove.querySelector('[data-tree-open]') as HTMLElement | null)?.focus({ preventScroll: true });
    }
    closeInspector = close;
    inspectorWord = label;
    // A repaint replaced the tree on the page: lookups and focus go to the new one.
    rebindInspector = (g) => {
      grove = g;
    };
  }

  detachFamilies = () => {
    ac.abort();
    ro?.disconnect();
  };
}
