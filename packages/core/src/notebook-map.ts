/** Map view: words joined through the morphemes they share, drawn as a graph. */
import type { MorphKind } from './morphology';
import { esc, clean, type NotebookAnalysis } from './notebook-shared';

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
