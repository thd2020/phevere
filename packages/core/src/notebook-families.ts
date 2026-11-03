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
import { clean, esc, type Family, type FamilyGrouping, type NotebookAnalysis, type TreeNode, type WordInfo } from './notebook-shared';

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

function wordChip(info: WordInfo, highlight?: Morph, i = 0): string {
  const lemma = clean(info.entry.lemma);
  let shown = esc(lemma);
  if (highlight && highlight.kind !== 'char') {
    const m = info.morphs.find((x) => x.kind === highlight.kind && x.label === highlight.label);
    if (m) shown = `${esc(lemma.slice(0, m.start))}<b>${esc(lemma.slice(m.start, m.end))}</b>${esc(lemma.slice(m.end))}`;
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
}

function familyCard(c: CardSpec): string {
  const n = c.words.length;
  const peek = c.words
    .slice(0, 3)
    .map((w) => esc(clean(w.entry.lemma)))
    .join(', ');
  const size = n >= 8 ? ' is-large' : n >= 4 ? ' is-mid' : '';
  const glyph = c.kind === 'deep' ? '*' : c.origin ? glyphFor(c.origin) : '';
  return `<details class="nbv-fam nbv-fam--${c.kind}${size}" style="--n:${Math.min(n, 3)}">
    <summary class="nbv-fam__head">
      ${glyph ? `<span class="nbv-fam__glyph" aria-hidden="true">${esc(glyph)}</span>` : ''}
      <span class="nbv-fam__title">
        ${positionMark(c.kind)}
        <span class="nbv-fam__label">${esc(c.label)}</span>
        ${c.gloss ? `<span class="nbv-fam__gloss">${esc(c.gloss)}</span>` : ''}
      </span>
      <span class="nbv-fam__meta">${c.origin ? `<span class="nbv-origin">${esc(c.origin)}</span>` : ''}<span class="nbv-fam__n">${n}</span></span>
      <span class="nbv-fam__peek">${peek}${n > 3 ? ` <i>+${n - 3}</i>` : ''}</span>
    </summary>
    <div class="nbv-fam__words">${c.words.map((w, i) => wordChip(w, c.highlight, i)).join('')}</div>
  </details>`;
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
  return `<svg class="nbv-tree-svg" viewBox="0 0 ${width.toFixed(0)} ${height}" width="${width.toFixed(0)}" height="${height}" role="img" aria-label="${esc(root.label)} and the words built from it">${ground}${trunk}${branches}${leaves}${labels}${plate}</svg>`;
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
        return `<figure class="nbv-grove${wide}">${treeSvg(t, a)}</figure>`;
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
    body = `<div class="nbv-fams">${fams
      .map((f) => {
        f.ids.forEach((id) => placed.add(id));
        return familyCard({
          kind: g === 'deep' ? 'deep' : f.kind,
          label: f.label,
          gloss: g === 'deep' ? cachedRootGloss(f.label) : f.gloss,
          origin: g === 'deep' ? '' : f.origin,
          words: byLemma(a, f.ids),
          highlight: g === 'deep' ? undefined : ({ kind: f.kind, label: f.label } as Morph),
        });
      })
      .join('')}</div>`;
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

/** Progress of the trace in flight, for `familiesHtml`'s `tracing` option. */
export function familiesTraceProgress(): { done: number; total: number } | null {
  return tracing;
}

/**
 * Trace origins and deep roots for the notebook's words, updating the progress bar inside
 * `getRoot()` as it goes and calling `onDone` once when new results are in. Both shells call
 * this whenever the Families view is shown; words already traced cost nothing.
 */
export function traceNotebookFamilies(lemmas: string[], getRoot: () => any, onDone: () => void): void {
  if (tracing) return;
  let changed = false;
  void traceEtymons(lemmas, (p) => {
    tracing = p;
    changed = true;
    showTrace(getRoot(), p);
  })
    .then(async () => {
      const roots = new Set<string>();
      for (const l of lemmas) cachedEtymon(l)?.roots.forEach((r) => roots.add(r));
      const before = [...roots].filter((r) => !cachedRootGloss(r)).length;
      await traceRootGlosses([...roots]);
      if (before) changed = true;
    })
    .catch((): void => undefined)
    .finally(() => {
      tracing = null;
      if (changed) onDone();
    });
}
