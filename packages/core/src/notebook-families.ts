/** Families view: words grouped by a shared root, prefix, suffix or origin, and word trees. */
import type { Morph, MorphKind } from './morphology';
import { clean, esc, type Family, type FamilyGrouping, type NotebookAnalysis, type TreeNode, type WordInfo } from './notebook-shared';

const GROUP_LABEL: Record<FamilyGrouping, string> = {
  root: 'Roots',
  prefix: 'Prefixes',
  suffix: 'Suffixes',
  origin: 'Origins',
  tree: 'Word trees',
  char: 'Characters',
};

const ORIGIN_ORDER = ['Latin', 'Greek', 'French', 'Old English'];

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
