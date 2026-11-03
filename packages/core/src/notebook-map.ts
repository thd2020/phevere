/**
 * Map view: words joined through the morphemes they share.
 *
 * `mapHtml` writes the toolbar, the panel and the graph data as JSON; `attachNotebookMap`
 * turns that into a 3D scene (three.js through 3d-force-graph, loaded on demand) or, where
 * WebGL is missing, a flat SVG. Both renderers share the focus logic in this file: a click
 * focuses a word or a morpheme, lights its neighbourhood, dims the rest and fills the panel.
 */
import type { MorphKind } from './morphology';
import { esc, clean, type NotebookAnalysis } from './notebook-shared';
import { loadMapScene } from './notebook-map-load';

export interface MapNode {
  id: string;
  kind: 'word' | MorphKind;
  label: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  degree: number;
  /** Words in the family for a morpheme; 1 for a word. */
  size: number;
  gloss: string;
}

export interface MapEdge {
  a: number;
  b: number;
  kind: 'morph' | 'derived';
}

export interface MapOptions {
  kinds?: MorphKind[];
  maxWords?: number;
  maxHubs?: number;
  /** 2 (default) lays the graph out on a plane; 3 in space, centred on the origin. */
  dimensions?: 2 | 3;
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  width: number;
  height: number;
  /** 3D layouts: the radius that holds nine in ten nodes with a margin, for framing the camera. */
  radius: number;
}

/**
 * Force-directed layout of words and the morphemes they share. Deterministic: the same
 * notebook always draws the same picture, so the map does not reshuffle on every paint.
 * Morphemes carry a larger charge than words, so they push each other apart and their words
 * gather around them in clusters.
 */
export function layoutNotebookMap(a: NotebookAnalysis, opts: MapOptions = {}): MapLayout {
  const dims = opts.dimensions === 3 ? 3 : 2;
  const kinds = new Set<MorphKind>(opts.kinds || ['root', 'prefix', 'char']);
  const hubs = a.families.filter((f) => kinds.has(f.kind)).slice(0, opts.maxHubs ?? 48);
  const wordIndex = new Map<string, number>();
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const maxWords = opts.maxWords ?? 220;
  let wordCount = 0;
  const blank = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, degree: 0 };
  const addWord = (id: string): number => {
    let i = wordIndex.get(id);
    if (i !== undefined) return i;
    if (wordCount >= maxWords) return -1;
    const w = a.words.get(id);
    if (!w) return -1;
    i = nodes.length;
    nodes.push({ id, kind: 'word', label: clean(w.entry.lemma), size: 1, gloss: '', ...blank });
    wordIndex.set(id, i);
    wordCount += 1;
    return i;
  };
  for (const f of hubs) {
    const h = nodes.length;
    nodes.push({ id: f.key, kind: f.kind, label: f.label, size: f.ids.length, gloss: clean(f.gloss), ...blank });
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
  if (!n) return { nodes, edges, width: 0, height: 0, radius: 0 };

  if (dims === 2) {
    // Golden-angle spiral start.
    nodes.forEach((node, i) => {
      const r = 18 * Math.sqrt(i + 1);
      const t = i * 2.399963;
      node.x = Math.cos(t) * r;
      node.y = Math.sin(t) * r;
    });
  } else {
    // Morphemes on a Fibonacci sphere; each word starts at the middle of its morphemes.
    const hubIdx = nodes.map((p, i) => (p.kind === 'word' ? -1 : i)).filter((i) => i >= 0);
    const R = 46 * Math.cbrt(hubIdx.length + 1);
    hubIdx.forEach((i, h) => {
      const y = 1 - (2 * (h + 0.5)) / hubIdx.length;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = h * 2.399963;
      nodes[i].x = Math.cos(t) * r * R;
      nodes[i].y = y * R;
      nodes[i].z = Math.sin(t) * r * R;
    });
    const sum = new Map<number, { x: number; y: number; z: number; c: number }>();
    for (const e of edges) {
      if (e.kind !== 'morph') continue;
      const s = sum.get(e.b) || { x: 0, y: 0, z: 0, c: 0 };
      s.x += nodes[e.a].x;
      s.y += nodes[e.a].y;
      s.z += nodes[e.a].z;
      s.c += 1;
      sum.set(e.b, s);
    }
    nodes.forEach((p, i) => {
      if (p.kind !== 'word') return;
      const s = sum.get(i);
      const t = i * 2.399963;
      const u = ((i * 0.618034) % 1) * 2 - 1;
      const rr = Math.sqrt(1 - u * u) * 12;
      p.x = (s ? s.x / s.c : 0) + Math.cos(t) * rr;
      p.y = (s ? s.y / s.c : 0) + u * 12;
      p.z = (s ? s.z / s.c : 0) + Math.sin(t) * rr;
    });
  }

  const hubCharge = dims === 3 ? 5 : 3;
  const charge = nodes.map((p) => (p.kind === 'word' ? 1 : hubCharge));
  const iterations = n > 200 ? 220 : 300;
  const repulse = dims === 3 ? 1400 : 2000;
  const spring = dims === 3 ? 0.05 : 0.04;
  const restMorph = dims === 3 ? 30 : 74;
  const restDerived = dims === 3 ? 24 : 74;
  const gravity = dims === 3 ? 0.0025 : 0.004;
  const cutoff = dims === 3 ? 62500 : 90000;
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const q = nodes[j];
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        const dz = p.z - q.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.01) {
          dx = 0.1 * (i - j);
          dy = 0.1;
          d2 = dx * dx + dy * dy + dz * dz;
        }
        if (d2 > cutoff) continue;
        const f = (repulse * charge[i] * charge[j]) / d2;
        const d = Math.sqrt(d2);
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
        p.vz += (dz / d) * f;
        q.vx -= (dx / d) * f;
        q.vy -= (dy / d) * f;
        q.vz -= (dz / d) * f;
      }
    }
    for (const e of edges) {
      const p = nodes[e.a];
      const q = nodes[e.b];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dz = q.z - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const f = (d - (e.kind === 'derived' ? restDerived : restMorph)) * spring;
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
      p.vz += (dz / d) * f;
      q.vx -= (dx / d) * f;
      q.vy -= (dy / d) * f;
      q.vz -= (dz / d) * f;
    }
    for (const p of nodes) {
      p.vx -= p.x * gravity;
      p.vy -= p.y * gravity;
      p.vz -= p.z * gravity;
      if (dims === 2) p.vz = 0;
      const len = Math.hypot(p.vx, p.vy, p.vz) || 1;
      const step = Math.min(len, 12 * cool + 0.5);
      p.x += (p.vx / len) * step;
      p.y += (p.vy / len) * step;
      p.z += (p.vz / len) * step;
      p.vx *= 0.5;
      p.vy *= 0.5;
      p.vz *= 0.5;
    }
  }

  if (dims === 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of nodes) {
      cx += p.x / n;
      cy += p.y / n;
      cz += p.z / n;
    }
    const dist: number[] = [];
    for (const p of nodes) {
      p.x = Math.round((p.x - cx) * 10) / 10;
      p.y = Math.round((p.y - cy) * 10) / 10;
      p.z = Math.round((p.z - cz) * 10) / 10;
      dist.push(Math.hypot(p.x, p.y, p.z));
    }
    dist.sort((x, y) => x - y);
    // The radius the camera frames: a few stray words far out should not shrink the rest.
    const core = dist[Math.floor((dist.length - 1) * 0.9)] * 1.1;
    return { nodes, edges, width: 0, height: 0, radius: Math.round(Math.min(dist[dist.length - 1], core)) };
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
    p.z = 0;
  }
  return { nodes, edges, width: Math.round(maxX - minX + pad * 2), height: Math.round(maxY - minY + pad * 2), radius: 0 };
}

/** The graph as `mapHtml` hands it to the renderers. */
export interface MapData {
  sig: string;
  radius: number;
  nodes: { id: string; k: 'word' | MorphKind; l: string; x: number; y: number; z: number; n: number; g?: string }[];
  /** [from, to, 1 when the second word is built from the first]. */
  edges: [number, number, 0 | 1][];
}

// The shells repaint the whole view for small reasons (a toast, a filter); keep the last
// few layouts so a repaint does not run the force loop again.
const layoutCache = new Map<string, MapData>();

function graphSignature(a: NotebookAnalysis, kinds: MorphKind[]): string {
  let h = 2166136261;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  for (const f of a.families) if (kinds.includes(f.kind)) mix(f.key + ':' + f.ids.join(','));
  for (const [c, p] of a.parent) mix(c + '<' + p);
  for (const [id, w] of a.words) mix(id + '=' + w.entry.lemma);
  return `${kinds.slice().sort().join('+')}:${a.words.size}:${(h >>> 0).toString(36)}`;
}

export function notebookMapData(a: NotebookAnalysis, kinds: MorphKind[]): MapData {
  const sig = graphSignature(a, kinds);
  const hit = layoutCache.get(sig);
  if (hit) return hit;
  const { nodes, edges, radius } = layoutNotebookMap(a, { kinds, dimensions: 3 });
  const data: MapData = {
    sig,
    radius,
    nodes: nodes.map((p) => ({ id: p.id, k: p.kind, l: p.label, x: p.x, y: p.y, z: p.z, n: p.size, ...(p.gloss ? { g: p.gloss } : {}) })),
    edges: edges.map((e) => [e.a, e.b, e.kind === 'derived' ? 1 : 0]),
  };
  layoutCache.set(sig, data);
  if (layoutCache.size > 6) layoutCache.delete(layoutCache.keys().next().value as string);
  return data;
}

const MAP_KIND_LABEL: Record<MorphKind, string> = { root: 'Roots', prefix: 'Prefixes', suffix: 'Suffixes', char: 'Characters' };

const ICON_RESET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 4.5v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

let mapSeq = 0;

export function mapHtml(a: NotebookAnalysis, kinds: MorphKind[]): string {
  const available = (['root', 'prefix', 'suffix', 'char'] as MorphKind[]).filter((k) => a.families.some((f) => f.kind === k));
  if (!available.length && !a.parent.size) {
    return `<p class="nbv-empty">No connected words yet.</p>`;
  }
  const on = kinds.filter((k) => available.includes(k));
  const active = on.length || a.parent.size ? on : available.slice(0, 1);
  const data = notebookMapData(a, active);
  const words = data.nodes.filter((x) => x.k === 'word');
  const listId = `nbv-map-words-${++mapSeq}`;
  const chips = available
    .map((k) => `<button type="button" class="nbv-chip nbv-chip--${k}${active.includes(k) ? ' is-active' : ''}" data-act="nb-map-kind" data-kind="${k}" aria-pressed="${active.includes(k)}">${MAP_KIND_LABEL[k]}</button>`)
    .join('');
  const search = words.length
    ? `<label class="nbv-map-search">${ICON_SEARCH}<input type="search" data-map-search list="${listId}" placeholder="Find a word" autocomplete="off" enterkeyhint="go" aria-label="Find a word on the map"/></label>
      <datalist id="${listId}">${words
        .map((w) => w.l)
        .sort((x, y) => x.localeCompare(y))
        .map((l) => `<option value="${esc(l)}"></option>`)
        .join('')}</datalist>`
    : '';
  const tools = `<div class="nbv-maptools"><div class="nbv-chips" aria-label="Show">${chips}</div>${search}<span class="nbv-map-hint">${words.length} words</span></div>`;
  if (!data.nodes.length) return tools + `<p class="nbv-empty">Nothing to connect with these filters.</p>`;
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `${tools}<div class="nbv-map" data-map>
    <script type="application/json" data-map-data>${json}</script>
    <div class="nbv-map__stage" data-map-stage role="img" aria-label="Map of related notebook words"></div>
    <div class="nbv-map__ctrl">
      <button type="button" data-map-act="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
      <button type="button" data-map-act="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
      <button type="button" data-map-act="reset" aria-label="Reset view" title="Reset view">${ICON_RESET}</button>
    </div>
    <aside class="nbv-map__panel" data-map-panel aria-live="polite" hidden></aside>
  </div>`;
}

/** What a renderer draws for the current focus. */
export interface MapHighlight {
  focus: string | null;
  nodes: Set<string>;
  edges: Set<number>;
}

/** Saved camera, so a repaint of the same graph keeps the reader where they were. */
export interface MapView {
  pos: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export interface MapRenderer {
  highlight(h: MapHighlight | null, fly: boolean): void;
  /** Pixels the panel covers on the left (wide screens) or at the bottom (phones). */
  inset?(left: number, bottom: number): void;
  zoom(dir: 'in' | 'out'): void;
  reset(): void;
  view(): MapView | null;
  dispose(): void;
}

export interface MapRendererOptions {
  reducedMotion: boolean;
  restore: MapView | null;
  onPick(id: string | null): void;
}

class MapController {
  readonly map: HTMLElement;
  readonly data: MapData;
  private readonly index = new Map<string, number>();
  private readonly adj: number[][];
  private renderer: MapRenderer | null = null;
  private focusId: string | null = null;
  private disposed = false;
  private readonly offs: (() => void)[] = [];

  constructor(map: HTMLElement, data: MapData) {
    this.map = map;
    this.data = data;
    data.nodes.forEach((p, i) => this.index.set(p.id, i));
    this.adj = data.nodes.map((): number[] => []);
    data.edges.forEach((e, k) => {
      this.adj[e[0]].push(k);
      this.adj[e[1]].push(k);
    });
    const onClick = (ev: Event) => {
      const t = (ev.target as HTMLElement | null)?.closest?.('[data-map-act]') as HTMLElement | null;
      if (!t || !map.contains(t)) return;
      ev.stopPropagation();
      const act = t.getAttribute('data-map-act');
      if (act === 'focus') this.focus(t.getAttribute('data-id'), true);
      else if (act === 'close') this.focus(null, false);
      else if (act === 'reset') {
        this.focus(null, false);
        this.renderer?.reset();
      } else if (act === 'zoom-in' || act === 'zoom-out') this.renderer?.zoom(act === 'zoom-in' ? 'in' : 'out');
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && this.focusId) {
        ev.stopPropagation();
        this.focus(null, false);
      }
    };
    map.addEventListener('click', onClick);
    map.addEventListener('keydown', onKey);
    this.offs.push(() => map.removeEventListener('click', onClick), () => map.removeEventListener('keydown', onKey));
    const input = map.parentElement?.querySelector<HTMLInputElement>('[data-map-search]');
    if (input) this.wireSearch(input);
  }

  private wireSearch(input: HTMLInputElement): void {
    const find = (q: string, exact: boolean): string | null => {
      const s = q.trim().toLocaleLowerCase();
      if (!s) return null;
      const words = this.data.nodes.filter((p) => p.k === 'word');
      const by = (f: (l: string) => boolean) => words.filter((p) => f(p.l.toLocaleLowerCase())).sort((x, y) => x.l.length - y.l.length)[0];
      const hit = by((l) => l === s) || (exact ? undefined : by((l) => l.startsWith(s)) || by((l) => l.includes(s)));
      return hit ? hit.id : null;
    };
    const go = (exact: boolean) => {
      const id = find(input.value, exact);
      input.classList.toggle('is-miss', !id && !exact && !!input.value.trim());
      if (id) this.focus(id, true);
    };
    const onInput = (ev: Event) => {
      input.classList.remove('is-miss');
      // A pick from the suggestion list arrives as one replacement, not as typing.
      const type = (ev as InputEvent).inputType;
      if (!type || type === 'insertReplacementText') go(true);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      go(false);
    };
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    this.offs.push(() => input.removeEventListener('input', onInput), () => input.removeEventListener('keydown', onKey));
  }

  use(renderer: MapRenderer): void {
    if (this.disposed) {
      renderer.dispose();
      return;
    }
    this.renderer = renderer;
    if (memory && memory.sig === this.data.sig && memory.focus && this.index.has(memory.focus)) this.focus(memory.focus, false);
  }

  get alive(): boolean {
    return !this.disposed;
  }

  /** Neighbourhood of a node: a word lights its morphemes, their words and derived words. */
  neighbourhood(id: string): MapHighlight | null {
    const i = this.index.get(id);
    if (i === undefined) return null;
    const nodes = new Set<string>([id]);
    const edges = new Set<number>();
    const d = this.data;
    const isWord = d.nodes[i].k === 'word';
    for (const k of this.adj[i]) {
      edges.add(k);
      const [a, b] = d.edges[k];
      const other = a === i ? b : a;
      nodes.add(d.nodes[other].id);
      if (isWord && d.nodes[other].k !== 'word') {
        for (const k2 of this.adj[other]) {
          const e2 = d.edges[k2];
          if (e2[2]) continue;
          edges.add(k2);
          nodes.add(d.nodes[e2[0] === other ? e2[1] : e2[0]].id);
        }
      }
    }
    return { focus: id, nodes, edges };
  }

  focus(id: string | null, fly: boolean): void {
    if (id && !this.index.has(id)) id = null;
    this.focusId = id;
    if (memory && memory.sig === this.data.sig) memory.focus = id;
    else memory = { sig: this.data.sig, focus: id, view: null };
    const h = id ? this.neighbourhood(id) : null;
    this.map.classList.toggle('is-focus', !!h);
    this.paintPanel(h);
    this.renderer?.highlight(h, fly);
  }

  private paintPanel(h: MapHighlight | null): void {
    const panel = this.map.querySelector<HTMLElement>('[data-map-panel]');
    if (!panel) return;
    if (!h || !h.focus) {
      panel.hidden = true;
      panel.innerHTML = '';
      this.renderer?.inset?.(0, 0);
      return;
    }
    const d = this.data;
    const me = d.nodes[this.index.get(h.focus)!];
    const hubs: typeof d.nodes = [];
    const words: typeof d.nodes = [];
    for (const id of h.nodes) {
      if (id === me.id) continue;
      const p = d.nodes[this.index.get(id)!];
      (p.k === 'word' ? words : hubs).push(p);
    }
    hubs.sort((x, y) => y.n - x.n);
    words.sort((x, y) => x.l.localeCompare(y.l));
    const CAP = 30;
    const wordBtns = words
      .slice(0, CAP)
      .map((p) => `<button type="button" class="nbv-map__word" data-map-act="focus" data-id="${esc(p.id)}">${esc(p.l)}</button>`)
      .join('');
    const more = words.length > CAP ? `<span class="nbv-map__more">and ${words.length - CAP} more</span>` : '';
    const close = `<button type="button" class="nbv-map__close" data-map-act="close" aria-label="Close">×</button>`;
    if (me.k === 'word') {
      const hubBtns = hubs
        .map((p) => `<button type="button" class="nbv-morph nbv-morph--${p.k}" data-map-act="focus" data-id="${esc(p.id)}">${esc(p.l)}</button>`)
        .join('');
      panel.innerHTML = `<div class="nbv-map__head"><h3 class="nbv-map__title">${esc(me.l)}</h3>${close}</div>
        ${hubBtns ? `<div class="nbv-map__hubs">${hubBtns}</div>` : ''}
        ${words.length ? `<p class="nbv-map__sub">Connected words</p><div class="nbv-map__words">${wordBtns}${more}</div>` : ''}
        <button type="button" class="nbv-map__lookup" data-act="lookup" data-q="${esc(me.l)}">Look up</button>`;
    } else {
      panel.innerHTML = `<div class="nbv-map__head"><h3 class="nbv-map__title"><span class="nbv-morph nbv-morph--${me.k}">${esc(me.l)}</span></h3>${close}</div>
        ${me.g ? `<p class="nbv-map__gloss">${esc(me.g)}</p>` : ''}
        <p class="nbv-map__sub">${words.length} ${words.length === 1 ? 'word' : 'words'}</p><div class="nbv-map__words">${wordBtns}${more}</div>`;
    }
    panel.hidden = false;
    const m = this.map.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const side = p.width < m.width * 0.6;
    this.renderer?.inset?.(side ? p.right - m.left : 0, side ? 0 : m.bottom - p.top);
  }

  pick = (id: string | null): void => {
    if (!id) {
      if (this.focusId) this.focus(null, false);
      return;
    }
    this.focus(id === this.focusId ? null : id, id !== this.focusId);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const view = this.renderer?.view() || null;
    if (memory && memory.sig === this.data.sig) memory.view = view;
    else memory = { sig: this.data.sig, focus: this.focusId, view };
    this.renderer?.dispose();
    this.renderer = null;
    this.offs.splice(0).forEach((f) => f());
    live.delete(this);
  }

  savedView(): MapView | null {
    return memory && memory.sig === this.data.sig ? memory.view : null;
  }
}

const live = new Set<MapController>();
let memory: { sig: string; focus: string | null; view: MapView | null } | null = null;
let webgl: boolean | null = null;

function webglAvailable(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    webgl = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

/** How many maps hold a renderer right now; the leak check in development reads this. */
export function liveNotebookMaps(): number {
  return live.size;
}

/** Release every map's renderer, or only those no longer in the document. */
export function disposeNotebookMaps(onlyDetached = false): void {
  for (const c of [...live]) if (!onlyDetached || !c.map.isConnected) c.dispose();
}

/**
 * Bring the map in `root` to life. Safe to call after every paint: maps that left the
 * document are released first, and a map already wired is left alone.
 */
export function attachNotebookMap(root: any): void {
  disposeNotebookMaps(true);
  const map: HTMLElement | null = root?.querySelector?.('[data-map]') || null;
  if (!map || map.dataset.wired) return;
  const raw = map.querySelector('[data-map-data]')?.textContent;
  const stage = map.querySelector<HTMLElement>('[data-map-stage]');
  if (!raw || !stage) return;
  let data: MapData;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  map.dataset.wired = '1';
  const ctl = new MapController(map, data);
  live.add(ctl);
  const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const opts: MapRendererOptions = { reducedMotion, restore: ctl.savedView(), onPick: ctl.pick };
  const flat = () => {
    if (!ctl.alive || !map.isConnected) return;
    map.classList.add('is-flat');
    ctl.use(createFlatMap(stage, data, opts));
  };
  if (!webglAvailable()) {
    flat();
    return;
  }
  map.classList.add('is-loading');
  loadMapScene()
    .then((mod) => {
      map.classList.remove('is-loading');
      if (!ctl.alive || !map.isConnected) return;
      try {
        ctl.use(mod.createMapScene(stage, data, opts, ctl.dispose.bind(ctl)));
      } catch (error) {
        console.warn('3D map unavailable, drawing it flat', error);
        stage.innerHTML = '';
        flat();
      }
    })
    .catch((error: unknown) => {
      map.classList.remove('is-loading');
      console.warn('3D map failed to load, drawing it flat', error);
      flat();
    });
}

/** The flat SVG map for devices without WebGL: drag to pan, wheel or pinch to zoom. */
function createFlatMap(stage: HTMLElement, data: MapData, opts: MapRendererOptions): MapRenderer {
  const pad = 60;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const scale = 2.2;
  const pts = data.nodes.map((p) => ({ x: p.x * scale, y: -p.y * scale }));
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  pts.forEach((p) => {
    p.x = Math.round(p.x - minX + pad);
    p.y = Math.round(p.y - minY + pad);
  });
  const w0 = Math.round(maxX - minX + pad * 2) || 1;
  const h0 = Math.round(maxY - minY + pad * 2) || 1;
  const edgeSvg = data.edges
    .map(([a, b, derived], k) => {
      const kind = derived ? 'derived' : data.nodes[a].k;
      return `<line class="nbv-edge nbv-edge--${kind}" data-e="${k}" x1="${pts[a].x}" y1="${pts[a].y}" x2="${pts[b].x}" y2="${pts[b].y}"/>`;
    })
    .join('');
  const nodeSvg = data.nodes
    .map((p, i) => {
      const { x, y } = pts[i];
      if (p.k === 'word') {
        return `<g class="nbv-node nbv-node--word" data-id="${esc(p.id)}" transform="translate(${x} ${y})"><circle r="4"/><text x="8" y="4">${esc(p.l)}</text></g>`;
      }
      const w = Math.max(28, p.l.length * 8 + 16);
      return `<g class="nbv-node nbv-node--hub nbv-node--${p.k}" data-id="${esc(p.id)}" transform="translate(${x} ${y})"><rect x="${-w / 2}" y="-12" width="${w}" height="24" rx="12"/><text text-anchor="middle" y="4.5">${esc(p.l)}</text></g>`;
    })
    .join('');
  stage.innerHTML = `<svg class="nbv-map__svg" viewBox="0 0 ${w0} ${h0}"><g>${edgeSvg}</g><g>${nodeSvg}</g></svg>`;
  const svg = stage.querySelector('svg') as SVGSVGElement;
  const view = { x: 0, y: 0, w: w0, h: h0 };
  const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const zoomAt = (factor: number, cx = view.x + view.w / 2, cy = view.y + view.h / 2) => {
    const w = Math.min(w0 * 2, Math.max(w0 / 10, view.w * factor));
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
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = toSvg(e.clientX, e.clientY);
    zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y);
  };
  svg.addEventListener('wheel', onWheel, { passive: false });
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  let moved = false;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  svg.addEventListener('pointermove', (e) => {
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
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('click', (e) => {
    if (moved) {
      moved = false;
      return;
    }
    const node = (e.target as Element).closest?.('.nbv-node');
    opts.onPick(node ? node.getAttribute('data-id') : null);
  });
  let insetL = 0;
  let insetB = 0;
  const centre = (id: string) => {
    const i = data.nodes.findIndex((p) => p.id === id);
    if (i < 0) return;
    // Zoom until labels draw at about their CSS size. The viewBox keeps its aspect ratio, so
    // the scale is set by whichever side fits first.
    const r = svg.getBoundingClientRect();
    const scale = () => Math.max(view.w / (r.width || 1), view.h / (r.height || 1));
    const k = Math.min(1, 1.1 / scale());
    view.w *= k;
    view.h *= k;
    // Keep the node in the middle of the part of the map the panel leaves visible.
    const perPx = scale();
    view.x = pts[i].x - view.w / 2 - (insetL / 2) * perPx;
    view.y = pts[i].y - view.h / 2 + (insetB / 2) * perPx;
    apply();
  };
  return {
    highlight(h, fly) {
      svg.querySelectorAll('.is-lit, .is-focus').forEach((el) => el.classList.remove('is-lit', 'is-focus'));
      if (!h) return;
      svg.querySelectorAll<SVGElement>('.nbv-node').forEach((el) => {
        const id = el.getAttribute('data-id') || '';
        if (h.nodes.has(id)) el.classList.add('is-lit');
        if (id === h.focus) el.classList.add('is-focus');
      });
      svg.querySelectorAll<SVGElement>('.nbv-edge').forEach((el) => {
        if (h.edges.has(Number(el.getAttribute('data-e')))) el.classList.add('is-lit');
      });
      if (fly && h.focus) centre(h.focus);
    },
    inset(left, bottom) {
      insetL = left;
      insetB = bottom;
    },
    zoom(dir) {
      zoomAt(dir === 'in' ? 1 / 1.3 : 1.3);
    },
    reset() {
      view.x = 0;
      view.y = 0;
      view.w = w0;
      view.h = h0;
      apply();
    },
    view: () => null,
    dispose() {
      stage.innerHTML = '';
    },
  };
}
