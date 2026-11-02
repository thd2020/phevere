/**
 * Notebook views beyond the list, shared by the desktop window and the phone app:
 *
 * - Families: words grouped by a shared root, prefix, suffix, origin or Han character, and
 *   word trees where one saved word is built from another (nation, national, nationality).
 * - Map: the same relations drawn as a graph, words joined through the morphemes they share.
 * - Cards: a picture, the word split into its parts with their meanings, and the learner's
 *   own note as a mnemonic; the meaning sits on the back of the card.
 * - Review: today's spaced-repetition queue, a daily goal, the coming two weeks of reviews
 *   and the words added over the last twelve weeks.
 *
 * Everything here returns HTML strings with `data-act` hooks, like `vocab-view.ts`; the two
 * DOM helpers at the end (map pan and zoom, card pictures) use only standard DOM calls.
 */
import { analyzeMorphemes, derivationStem, morphBreakdown, wordOrigin, type Morph, type MorphKind } from './morphology';
import { vocabReadings, vocabSenses, type VocabViewEntry } from './vocab-view';

export type NotebookView = 'list' | 'families' | 'map' | 'cards' | 'review';
export type FamilyGrouping = 'root' | 'prefix' | 'suffix' | 'origin' | 'tree' | 'char';

export interface NotebookEntry extends VocabViewEntry {
  reviewDue?: number | null;
  reviewInterval?: number | null;
  reps?: number | null;
}

export interface WordInfo {
  entry: NotebookEntry;
  morphs: Morph[];
  parts: string[];
  origin: string;
}

export interface Family {
  key: string;
  kind: MorphKind;
  label: string;
  gloss: string;
  origin: string;
  ids: string[];
}

export interface TreeNode {
  id: string;
  children: TreeNode[];
}

export interface NotebookAnalysis {
  words: Map<string, WordInfo>;
  families: Family[];
  trees: TreeNode[];
  /** child id → parent id for words built from another saved word. */
  parent: Map<string, string>;
}

const ICON = {
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  families: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v5M12 9H6v4M12 9h6v4M4 15h4v5H4zM16 15h4v5h-4zM10 2h4v4h-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.3 8.2l2.6 7.5M15.9 7.6l-2.7 8.1M8.5 6.8l7-.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 15l5-4 4 3 3-2 6 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="16" cy="9" r="1.5" fill="currentColor"/></svg>',
  review: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 10h16M9 3v4M15 3v4M9 15l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const VIEW_LABEL: Record<NotebookView, string> = {
  list: 'List',
  families: 'Families',
  map: 'Map',
  cards: 'Cards',
  review: 'Review',
};

const GROUP_LABEL: Record<FamilyGrouping, string> = {
  root: 'Roots',
  prefix: 'Prefixes',
  suffix: 'Suffixes',
  origin: 'Origins',
  tree: 'Word trees',
  char: 'Characters',
};

const ORIGIN_ORDER = ['Latin', 'Greek', 'French', 'Old English'];
const DAY = 86_400_000;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function clean(s: unknown): string {
  const t = String(s ?? '').trim();
  return t === 'null' || t === 'None' || t === 'undefined' ? '' : t;
}

function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ------------------------------------------------------------------ analysis */

export function analyzeNotebook(entries: NotebookEntry[]): NotebookAnalysis {
  const words = new Map<string, WordInfo>();
  const byMorph = new Map<string, Family>();
  for (const entry of entries) {
    const lemma = clean(entry.lemma);
    if (!lemma) continue;
    const morphs = analyzeMorphemes(lemma);
    words.set(entry.id, { entry, morphs, parts: morphBreakdown(lemma, morphs), origin: wordOrigin(morphs) });
    const seen = new Set<string>();
    for (const m of morphs) {
      const key = `${m.kind}:${m.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let fam = byMorph.get(key);
      if (!fam) {
        fam = { key, kind: m.kind, label: m.label, gloss: m.gloss, origin: m.origin, ids: [] };
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
  const views: NotebookView[] = ['list', 'families', 'map', 'cards', 'review'];
  return `<div class="nbv-switch" role="tablist" aria-label="Notebook view">${views
    .map(
      (v) => `<button type="button" role="tab" class="nbv-switch__btn${v === view ? ' is-active' : ''}" data-act="nb-view" data-view="${v}" aria-selected="${v === view}" title="${VIEW_LABEL[v]}">${ICON[v]}<span>${VIEW_LABEL[v]}</span></button>`,
    )
    .join('')}</div>`;
}

/* ------------------------------------------------------------------ families */

function wordChip(info: WordInfo, highlight?: Morph): string {
  const lemma = clean(info.entry.lemma);
  let shown = esc(lemma);
  if (highlight && highlight.kind !== 'char') {
    const m = info.morphs.find((x) => x.kind === highlight.kind && x.label === highlight.label);
    if (m) shown = `${esc(lemma.slice(0, m.start))}<b>${esc(lemma.slice(m.start, m.end))}</b>${esc(lemma.slice(m.end))}`;
  } else if (highlight) {
    shown = [...lemma].map((ch) => (ch === highlight.label ? `<b>${esc(ch)}</b>` : esc(ch))).join('');
  }
  return `<button type="button" class="nbv-word" data-act="lookup" data-q="${esc(lemma)}">${shown}</button>`;
}

function familyCard(f: Family, a: NotebookAnalysis): string {
  const head = `<header class="nbv-family__head">
      <span class="nbv-morph nbv-morph--${f.kind}">${esc(f.label)}</span>
      ${f.gloss ? `<span class="nbv-family__gloss">${esc(f.gloss)}</span>` : ''}
      ${f.origin ? `<span class="nbv-origin">${esc(f.origin)}</span>` : ''}
      <span class="nbv-count">${f.ids.length}</span>
    </header>`;
  const sample = { kind: f.kind, label: f.label } as Morph;
  const chips = f.ids
    .map((id) => a.words.get(id))
    .filter((w): w is WordInfo => !!w)
    .sort((x, y) => clean(x.entry.lemma).localeCompare(clean(y.entry.lemma)))
    .map((w) => wordChip(w, sample))
    .join('');
  return `<section class="nbv-family">${head}<div class="nbv-family__words">${chips}</div></section>`;
}

function treeHtml(node: TreeNode, a: NotebookAnalysis): string {
  const w = a.words.get(node.id);
  if (!w) return '';
  const kids = node.children.map((c) => treeHtml(c, a)).join('');
  return `<li>${wordChip(w)}${w.parts.length > 1 ? `<span class="nbv-parts">${w.parts.map(esc).join('·')}</span>` : ''}${kids ? `<ul>${kids}</ul>` : ''}</li>`;
}

function originHtml(a: NotebookAnalysis): string {
  const groups = new Map<string, WordInfo[]>();
  for (const w of a.words.values()) {
    if (!w.origin) continue;
    groups.set(w.origin, [...(groups.get(w.origin) || []), w]);
  }
  const order = [...groups.keys()].sort((x, y) => {
    const ix = ORIGIN_ORDER.indexOf(x);
    const iy = ORIGIN_ORDER.indexOf(y);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });
  if (!order.length) return '';
  const total = order.reduce((s, o) => s + groups.get(o)!.length, 0);
  const bar = `<div class="nbv-origin-bar" role="img" aria-label="${esc(order.map((o) => `${o} ${groups.get(o)!.length}`).join(', '))}">${order
    .map((o, i) => `<span class="nbv-origin-bar__seg nbv-tone-${i % 4}" style="flex-grow:${groups.get(o)!.length}"></span>`)
    .join('')}</div>
    <div class="nbv-origin-legend">${order
      .map((o, i) => `<span><i class="nbv-tone-${i % 4}"></i>${esc(o)} ${Math.round((groups.get(o)!.length / total) * 100)}%</span>`)
      .join('')}</div>`;
  const sections = order
    .map((o, i) => {
      const ws = groups.get(o)!.sort((x, y) => clean(x.entry.lemma).localeCompare(clean(y.entry.lemma)));
      return `<section class="nbv-family"><header class="nbv-family__head"><span class="nbv-morph nbv-tone-${i % 4}">${esc(o)}</span><span class="nbv-count">${ws.length}</span></header>
        <div class="nbv-family__words">${ws.map((w) => wordChip(w, w.morphs.find((m) => m.kind === 'root'))).join('')}</div></section>`;
    })
    .join('');
  return bar + sections;
}

/** The groupings worth offering for this notebook, in display order. */
export function familyGroupings(a: NotebookAnalysis): FamilyGrouping[] {
  const has = (k: MorphKind) => a.families.some((f) => f.kind === k);
  const out: FamilyGrouping[] = [];
  if (has('root')) out.push('root');
  if (has('prefix')) out.push('prefix');
  if (has('suffix')) out.push('suffix');
  if ([...a.words.values()].some((w) => w.origin)) out.push('origin');
  if (a.trees.length) out.push('tree');
  if (has('char')) out.push('char');
  return out;
}

export function familiesHtml(a: NotebookAnalysis, grouping: FamilyGrouping): string {
  const options = familyGroupings(a);
  if (!options.length) {
    return `<p class="nbv-empty">No shared roots, affixes or characters yet.</p>`;
  }
  const g = options.includes(grouping) ? grouping : options[0];
  const chips = `<div class="nbv-chips" role="tablist" aria-label="Group by">${options
    .map((o) => `<button type="button" role="tab" class="nbv-chip${o === g ? ' is-active' : ''}" data-act="nb-group" data-group="${o}" aria-selected="${o === g}">${GROUP_LABEL[o]}</button>`)
    .join('')}</div>`;
  let body = '';
  if (g === 'tree') {
    body = `<div class="nbv-trees">${a.trees.map((t) => `<ul class="nbv-tree">${treeHtml(t, a)}</ul>`).join('')}</div>`;
  } else if (g === 'origin') {
    body = originHtml(a);
  } else {
    body = `<div class="nbv-families">${a.families
      .filter((f) => f.kind === g)
      .map((f) => familyCard(f, a))
      .join('')}</div>`;
  }
  return chips + body;
}

/* ----------------------------------------------------------------------- map */

interface MapNode {
  id: string;
  kind: 'word' | MorphKind;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

interface MapEdge {
  a: number;
  b: number;
  kind: 'morph' | 'derived';
}

export interface MapOptions {
  kinds?: MorphKind[];
  maxWords?: number;
  maxHubs?: number;
}

/**
 * Force-directed layout of words and the morphemes they share. Deterministic: the same
 * notebook always draws the same picture, so the map does not reshuffle on every paint.
 */
export function layoutNotebookMap(a: NotebookAnalysis, opts: MapOptions = {}): { nodes: MapNode[]; edges: MapEdge[]; width: number; height: number } {
  const kinds = new Set<MorphKind>(opts.kinds || ['root', 'prefix', 'char']);
  const hubs = a.families.filter((f) => kinds.has(f.kind)).slice(0, opts.maxHubs ?? 48);
  const wordIds: string[] = [];
  const wordIndex = new Map<string, number>();
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const maxWords = opts.maxWords ?? 220;
  const addWord = (id: string): number => {
    let i = wordIndex.get(id);
    if (i !== undefined) return i;
    if (wordIds.length >= maxWords) return -1;
    const w = a.words.get(id);
    if (!w) return -1;
    i = nodes.length;
    nodes.push({ id, kind: 'word', label: clean(w.entry.lemma), x: 0, y: 0, vx: 0, vy: 0, degree: 0 });
    wordIndex.set(id, i);
    wordIds.push(id);
    return i;
  };
  for (const f of hubs) {
    const h = nodes.length;
    nodes.push({ id: f.key, kind: f.kind, label: f.label, x: 0, y: 0, vx: 0, vy: 0, degree: 0 });
    for (const id of f.ids) {
      const i = addWord(id);
      if (i < 0) continue;
      edges.push({ a: h, b: i, kind: 'morph' });
    }
  }
  for (const [child, par] of a.parent) {
    const c = addWord(child);
    const p = addWord(par);
    if (c >= 0 && p >= 0) edges.push({ a: p, b: c, kind: 'derived' });
  }
  for (const e of edges) {
    nodes[e.a].degree += 1;
    nodes[e.b].degree += 1;
  }
  const n = nodes.length;
  if (!n) return { nodes, edges, width: 0, height: 0 };

  // Golden-angle spiral start, then a fixed number of force steps.
  nodes.forEach((node, i) => {
    const r = 18 * Math.sqrt(i + 1);
    const t = i * 2.399963;
    node.x = Math.cos(t) * r;
    node.y = Math.sin(t) * r;
  });
  const iterations = n > 200 ? 220 : 300;
  const repulse = 2000;
  const spring = 0.04;
  const rest = 74;
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const q = nodes[j];
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = 0.1 * (i - j);
          dy = 0.1;
          d2 = dx * dx + dy * dy;
        }
        if (d2 > 90000) continue;
        const f = repulse / d2;
        const d = Math.sqrt(d2);
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
        q.vx -= (dx / d) * f;
        q.vy -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const p = nodes[e.a];
      const q = nodes[e.b];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - rest) * spring;
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
      q.vx -= (dx / d) * f;
      q.vy -= (dy / d) * f;
    }
    for (const p of nodes) {
      p.vx -= p.x * 0.004;
      p.vy -= p.y * 0.004;
      const step = Math.min(Math.hypot(p.vx, p.vy), 12 * cool + 0.5);
      const len = Math.hypot(p.vx, p.vy) || 1;
      p.x += (p.vx / len) * step;
      p.y += (p.vy / len) * step;
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of nodes) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 70;
  for (const p of nodes) {
    p.x = Math.round(p.x - minX + pad);
    p.y = Math.round(p.y - minY + pad);
  }
  return { nodes, edges, width: Math.round(maxX - minX + pad * 2), height: Math.round(maxY - minY + pad * 2) };
}

const MAP_KIND_LABEL: Record<MorphKind, string> = { root: 'Roots', prefix: 'Prefixes', suffix: 'Suffixes', char: 'Characters' };

export function mapHtml(a: NotebookAnalysis, kinds: MorphKind[]): string {
  const available = (['root', 'prefix', 'suffix', 'char'] as MorphKind[]).filter((k) => a.families.some((f) => f.kind === k));
  if (!available.length && !a.parent.size) {
    return `<p class="nbv-empty">No connected words yet.</p>`;
  }
  const on = kinds.filter((k) => available.includes(k));
  const active = on.length || a.parent.size ? on : available.slice(0, 1);
  const { nodes, edges, width, height } = layoutNotebookMap(a, { kinds: active });
  const chips = `<div class="nbv-chips" aria-label="Show">${available
    .map((k) => `<button type="button" class="nbv-chip${active.includes(k) ? ' is-active' : ''}" data-act="nb-map-kind" data-kind="${k}" aria-pressed="${active.includes(k)}">${MAP_KIND_LABEL[k]}</button>`)
    .join('')}<span class="nbv-map-hint">${nodes.filter((x) => x.kind === 'word').length} words</span></div>`;
  if (!nodes.length) return chips + `<p class="nbv-empty">Nothing to connect with these filters.</p>`;
  const edgeSvg = edges
    .map((e) => {
      const p = nodes[e.a];
      const q = nodes[e.b];
      const hub = e.kind === 'morph' ? ` data-h="${esc(p.id)}"` : '';
      return `<line class="nbv-edge nbv-edge--${e.kind === 'derived' ? 'derived' : p.kind}"${hub} data-w="${esc(q.id)}" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/>`;
    })
    .join('');
  const nodeSvg = nodes
    .map((p) => {
      if (p.kind === 'word') {
        const r = Math.min(7, 3.5 + p.degree * 0.6);
        return `<g class="nbv-node nbv-node--word" data-act="lookup" data-q="${esc(p.label)}" data-w="${esc(p.id)}" transform="translate(${p.x} ${p.y})"><circle r="${r.toFixed(1)}"/><text x="${(r + 4).toFixed(1)}" y="4">${esc(p.label)}</text></g>`;
      }
      const w = Math.max(28, p.label.length * 8 + 16);
      return `<g class="nbv-node nbv-node--hub nbv-node--${p.kind}" data-h="${esc(p.id)}" transform="translate(${p.x} ${p.y})"><rect x="${-w / 2}" y="-12" width="${w}" height="24" rx="12"/><text text-anchor="middle" y="4.5">${esc(p.label)}</text></g>`;
    })
    .join('');
  return `${chips}<div class="nbv-map" data-map>
    <svg class="nbv-map__svg" viewBox="0 0 ${width} ${height}" data-w0="${width}" data-h0="${height}" role="img" aria-label="Map of related notebook words">
      <g class="nbv-map__edges">${edgeSvg}</g><g class="nbv-map__nodes">${nodeSvg}</g>
    </svg>
    <div class="nbv-map__zoom">
      <button type="button" data-act="nb-map-zoom" data-dir="in" aria-label="Zoom in">+</button>
      <button type="button" data-act="nb-map-zoom" data-dir="out" aria-label="Zoom out">−</button>
      <button type="button" data-act="nb-map-zoom" data-dir="fit" aria-label="Fit">⤢</button>
    </div>
  </div>`;
}

/* --------------------------------------------------------------------- cards */

export function cardsHtml(entries: NotebookEntry[], a: NotebookAnalysis, flipped: Set<string>): string {
  if (!entries.length) return `<p class="nbv-empty">No saved words.</p>`;
  return `<div class="nbv-cards">${entries
    .map((e) => {
      const w = a.words.get(e.id);
      const lemma = clean(e.lemma);
      const reading = vocabReadings(e.reading)[0];
      const senses = vocabSenses(e.definition).slice(0, 3);
      const morphs = (w?.morphs || []).filter((m) => m.kind !== 'char' || m.gloss);
      const parts = w && w.parts.length > 1 ? w.parts : [];
      const note = clean(e.note);
      const open = flipped.has(e.id);
      return `<article class="nbv-card${open ? ' is-flipped' : ''}" data-id="${esc(e.id)}">
        <div class="nbv-card__pic" data-img-lemma="${esc(lemma)}" data-img-lang="${esc(clean(e.sourceLang))}" data-img-gloss="${esc(senses[0] || '')}" aria-hidden="true"><span>${esc(lemma.charAt(0))}</span></div>
        <div class="nbv-card__body" data-act="nb-flip" data-id="${esc(e.id)}" role="button" tabindex="0" aria-pressed="${open}">
          <h3 class="nbv-card__word">${parts.length ? parts.map((p, i) => `<span>${esc(p)}</span>${i < parts.length - 1 ? '<i>·</i>' : ''}`).join('') : esc(lemma)}</h3>
          ${reading ? `<p class="nbv-card__ipa">${esc(reading.ipa)}</p>` : ''}
          ${morphs.length ? `<ul class="nbv-card__morphs">${morphs
            .map((m) => `<li><span class="nbv-morph nbv-morph--${m.kind}">${esc(m.label)}</span>${esc(m.gloss)}</li>`)
            .join('')}</ul>` : ''}
          ${note ? `<p class="nbv-card__note">${esc(note)}</p>` : ''}
          <div class="nbv-card__back">${senses.length ? `<ol>${senses.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p>No definition saved.</p>'}</div>
          <span class="nbv-card__flip">${open ? 'Hide meaning' : 'Show meaning'}</span>
        </div>
      </article>`;
    })
    .join('')}</div>`;
}

/* -------------------------------------------------------------------- review */

export interface ReviewState {
  queue: string[];
  index: number;
  revealed: boolean;
  done: number;
}

/**
 * Reviews due by the end of today (lapsed words included), oldest first, then words never
 * reviewed, up to the daily goal less the new words already started today.
 */
export function reviewQueue(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0): string[] {
  const end = dayStart(now) + DAY;
  const due = entries
    .filter((e) => e.reviewDue != null && Number(e.reviewDue) < end)
    .sort((x, y) => Number(x.reviewDue) - Number(y.reviewDue));
  const fresh = entries
    .filter((e) => e.reviewDue == null)
    .sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0))
    .slice(0, Math.max(0, goal - startedToday));
  return [...due, ...fresh].map((e) => e.id);
}

/** Whole days from one local midnight to another, right across daylight-saving changes. */
function daysBetween(a: number, b: number): number {
  return Math.round((dayStart(b) - dayStart(a)) / DAY);
}

function forecastSvg(entries: NotebookEntry[], now: number): string {
  const today = dayStart(now);
  const days = 14;
  const counts = new Array(days).fill(0);
  for (const e of entries) {
    if (e.reviewDue == null) continue;
    const d = daysBetween(today, Number(e.reviewDue));
    if (d < days) counts[Math.max(0, d)] += 1;
  }
  const max = Math.max(1, ...counts);
  const W = 280;
  const H = 72;
  const bw = W / days;
  const bars = counts
    .map((c, i) => {
      const h = Math.round((c / max) * (H - 18));
      const label = i === 0 ? 'Today' : new Date(today + i * DAY).toLocaleDateString(undefined, { weekday: 'narrow' });
      return `<g><rect class="nbv-bar${i === 0 ? ' is-today' : ''}" x="${(i * bw + 2).toFixed(1)}" y="${H - 14 - h}" width="${(bw - 4).toFixed(1)}" height="${Math.max(h, c ? 2 : 1)}" rx="2"><title>${c} due ${i === 0 ? 'today' : `in ${i} day${i > 1 ? 's' : ''}`}</title></rect>${
        i === 0 || i % 7 === 0 ? `<text x="${(i * bw + 2).toFixed(1)}" y="${H - 2}">${esc(label)}</text>` : ''
      }</g>`;
    })
    .join('');
  return `<svg class="nbv-forecast" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reviews due over the next two weeks">${bars}</svg>`;
}

function activitySvg(entries: NotebookEntry[], now: number): string {
  const weeks = 12;
  const today = dayStart(now);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (weeks * 7 - 1) - startDate.getDay());
  const start = startDate.getTime();
  const counts = new Map<number, number>();
  for (const e of entries) {
    const t = Number(e.createdAt || 0);
    if (!t || t < start) continue;
    const d = dayStart(t);
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  const cell = 11;
  const gap = 3;
  let cells = '';
  const day = new Date(start);
  for (let i = 0; day.getTime() <= today; i++, day.setDate(day.getDate() + 1)) {
    const d = day.getTime();
    const c = counts.get(d) || 0;
    const level = c ? Math.min(4, Math.ceil((c / max) * 4)) : 0;
    const col = Math.floor(i / 7);
    const row = i % 7;
    cells += `<rect class="nbv-heat nbv-heat--${level}" x="${col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}" rx="2.5"><title>${new Date(d).toLocaleDateString()}: ${c} added</title></rect>`;
  }
  const cols = Math.ceil((daysBetween(start, today) + 1) / 7);
  return `<svg class="nbv-activity" viewBox="0 0 ${cols * (cell + gap)} ${7 * (cell + gap)}" role="img" aria-label="Words added per day over twelve weeks">${cells}</svg>`;
}

export function reviewHtml(entries: NotebookEntry[], state: ReviewState, goal: number, now = Date.now()): string {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const left = state.queue.length - state.index;
  const learned = entries.filter((e) => e.reviewDue != null).length;
  const week = entries.filter((e) => Number(e.createdAt || 0) >= dayStart(now) - 6 * DAY).length;
  const goals = [5, 10, 20, 40];
  const plan = `<section class="nbv-plan">
    <div class="nbv-stats">
      <div><b>${Math.max(0, left)}</b><span>to review today</span></div>
      <div><b>${state.done}</b><span>reviewed</span></div>
      <div><b>${learned}</b><span>in rotation</span></div>
      <div><b>${week}</b><span>added this week</span></div>
    </div>
    <div class="nbv-goal" role="group" aria-label="New words per day">
      <span>New words per day</span>
      ${goals.map((g) => `<button type="button" class="nbv-chip${g === goal ? ' is-active' : ''}" data-act="nb-goal" data-goal="${g}" aria-pressed="${g === goal}">${g}</button>`).join('')}
    </div>
    <div class="nbv-charts">
      <figure><figcaption>Next two weeks</figcaption>${forecastSvg(entries, now)}</figure>
      <figure><figcaption>Words added, twelve weeks</figcaption>${activitySvg(entries, now)}</figure>
    </div>
  </section>`;

  const cur = state.index < state.queue.length ? byId.get(state.queue[state.index]) : undefined;
  let card = '';
  if (!entries.length) {
    card = `<p class="nbv-empty">Save words to start reviewing.</p>`;
  } else if (!cur) {
    card = `<div class="nbv-review nbv-review--done"><p>${state.done ? 'Done for today.' : 'Nothing due today.'}</p></div>`;
  } else {
    const lemma = clean(cur.lemma);
    const reading = vocabReadings(cur.reading)[0];
    const senses = vocabSenses(cur.definition).slice(0, 4);
    const note = clean(cur.note);
    card = `<div class="nbv-review" data-id="${esc(cur.id)}">
      <div class="nbv-review__progress"><span style="width:${Math.round((state.index / Math.max(1, state.queue.length)) * 100)}%"></span></div>
      <div class="nbv-review__front">
        <div class="nbv-card__pic nbv-review__pic" data-img-lemma="${esc(lemma)}" data-img-lang="${esc(clean(cur.sourceLang))}" data-img-gloss="${esc(senses[0] || '')}" aria-hidden="true"></div>
        <h3 class="nbv-review__word">${esc(lemma)}</h3>
        ${reading ? `<p class="nbv-card__ipa">${esc(reading.ipa)}</p>` : ''}
        <button type="button" class="vocab-play" data-act="nb-play" data-lemma="${esc(lemma)}" aria-label="Play ${esc(lemma)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4zM15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      ${state.revealed
        ? `<div class="nbv-review__back">${senses.length ? `<ol>${senses.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p>No definition saved.</p>'}${note ? `<p class="nbv-card__note">${esc(note)}</p>` : ''}</div>
          <div class="nbv-grades">
            <button type="button" data-act="nb-grade" data-grade="1" class="is-again">Again</button>
            <button type="button" data-act="nb-grade" data-grade="2">Hard</button>
            <button type="button" data-act="nb-grade" data-grade="3" class="is-good">Good</button>
            <button type="button" data-act="nb-grade" data-grade="4">Easy</button>
          </div>`
        : `<button type="button" class="nbv-reveal" data-act="nb-reveal">Show meaning</button>`}
      <p class="nbv-review__left">${left} left</p>
    </div>`;
  }
  return `<div class="nbv-review-wrap">${card}${plan}</div>`;
}

/* --------------------------------------------------------------- DOM helpers */

type Img = { thumb: string; title: string; pageUrl: string; credit: string } | null;

/**
 * Fill each `[data-img-lemma]` box with a picture as boxes scroll into view. The word's first
 * sense goes along when it has one, so the picture is checked against what the word means.
 */
export function fillWordImages(root: any, fetchImage: (lemma: string, lang?: string, gloss?: string) => Promise<Img>): void {
  const boxes: any[] = Array.from(root?.querySelectorAll?.('[data-img-lemma]:not([data-img-done])') || []);
  if (!boxes.length) return;
  const load = (box: any) => {
    box.setAttribute('data-img-done', '1');
    const lemma = box.getAttribute('data-img-lemma') || '';
    const gloss = box.getAttribute('data-img-gloss') || undefined;
    void fetchImage(lemma, box.getAttribute('data-img-lang') || undefined, gloss)
      .then((img) => {
        if (!img || !img.thumb) {
          box.classList.add('is-empty');
          return;
        }
        const el = box.ownerDocument.createElement('img');
        el.loading = 'lazy';
        el.decoding = 'async';
        el.alt = '';
        el.src = img.thumb;
        el.title = `${img.title} · ${img.credit}`;
        el.addEventListener('load', () => box.classList.add('has-img'));
        box.appendChild(el);
      })
      .catch(() => box.classList.add('is-empty'));
  };
  const IO = (globalThis as any).IntersectionObserver;
  if (!IO) {
    boxes.slice(0, 24).forEach(load);
    return;
  }
  const io = new IO(
    (items: any[]) => {
      for (const it of items) {
        if (!it.isIntersecting) continue;
        io.unobserve(it.target);
        load(it.target);
      }
    },
    { rootMargin: '200px' },
  );
  boxes.forEach((b) => io.observe(b));
}

/** Pan with a drag, zoom with the wheel or a pinch, highlight a morpheme's words on hover. */
export function attachNotebookMap(root: any): void {
  const map = root?.querySelector?.('[data-map]');
  const svg = map?.querySelector('svg');
  if (!svg || map.dataset.wired) return;
  map.dataset.wired = '1';
  const w0 = Number(svg.dataset.w0) || 1;
  const h0 = Number(svg.dataset.h0) || 1;
  const view = { x: 0, y: 0, w: w0, h: h0 };
  const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const zoomAt = (factor: number, cx = view.x + view.w / 2, cy = view.y + view.h / 2) => {
    const w = Math.min(w0 * 2, Math.max(w0 / 8, view.w * factor));
    const k = w / view.w;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.w = w;
    view.h *= k;
    apply();
  };
  const toSvg = (clientX: number, clientY: number) => {
    const r = svg.getBoundingClientRect();
    return { x: view.x + ((clientX - r.left) / r.width) * view.w, y: view.y + ((clientY - r.top) / r.height) * view.h };
  };
  svg.addEventListener(
    'wheel',
    (e: any) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    },
    { passive: false },
  );
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  let moved = false;
  svg.addEventListener('pointerdown', (e: any) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  svg.addEventListener('pointermove', (e: any) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const r = svg.getBoundingClientRect();
    if (pointers.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) svg.setPointerCapture?.(e.pointerId);
      moved = true;
      view.x -= (dx / r.width) * view.w;
      view.y -= (dy / r.height) * view.h;
      apply();
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) {
        const c = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt(pinch / d, c.x, c.y);
      }
      pinch = d;
      moved = true;
    }
  });
  const up = (e: any) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  // A drag must not end in a lookup on the word under the pointer.
  svg.addEventListener(
    'click',
    (e: any) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    },
    true,
  );
  const highlight = (hub: string | null, word: string | null) => {
    map.classList.toggle('is-focus', !!(hub || word));
    svg.querySelectorAll('.is-lit').forEach((el: any) => el.classList.remove('is-lit'));
    if (!hub && !word) return;
    const words = new Set<string>();
    const hubs = new Set<string>();
    svg.querySelectorAll('.nbv-edge').forEach((el: any) => {
      const h = el.getAttribute('data-h');
      const w = el.getAttribute('data-w');
      if ((hub && h === hub) || (word && (w === word || (!h && el.getAttribute('data-w') === word)))) {
        el.classList.add('is-lit');
        if (w) words.add(w);
        if (h) hubs.add(h);
      }
    });
    if (word) words.add(word);
    if (hub) hubs.add(hub);
    svg.querySelectorAll('.nbv-node').forEach((el: any) => {
      const h = el.getAttribute('data-h');
      const w = el.getAttribute('data-w');
      if ((h && hubs.has(h)) || (w && words.has(w))) el.classList.add('is-lit');
    });
  };
  svg.addEventListener('pointerover', (e: any) => {
    const node = e.target?.closest?.('.nbv-node');
    if (!node) return;
    highlight(node.getAttribute('data-h'), node.getAttribute('data-w'));
  });
  svg.addEventListener('pointerleave', () => highlight(null, null));
  map.querySelectorAll('[data-act="nb-map-zoom"]').forEach((btn: any) =>
    btn.addEventListener('click', (e: any) => {
      e.stopPropagation();
      const dir = btn.getAttribute('data-dir');
      if (dir === 'fit') {
        view.x = 0;
        view.y = 0;
        view.w = w0;
        view.h = h0;
        apply();
      } else zoomAt(dir === 'in' ? 1 / 1.3 : 1.3);
    }),
  );
}
