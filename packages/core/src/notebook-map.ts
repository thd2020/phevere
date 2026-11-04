/**
 * Map view: words joined through the morphemes they share.
 *
 * `mapHtml` writes the toolbar and the panel and names the graph it laid out by signature;
 * `attachNotebookMap` turns that graph into a 3D scene (three.js, loaded on demand) or, where
 * WebGL is missing, a flat SVG. Both renderers share the focus logic in this file: a click
 * focuses a word or a morpheme, lights its neighbourhood, dims the rest and fills the panel.
 * The map holds every connected word of the notebook or book, thousands for a large book.
 */
import type { MorphKind } from './morphology';
import { esc, clean, type Family, type NotebookAnalysis, type NotebookEntry, type WordInfo } from './notebook-shared';
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
  /** A morpheme's spellings: "fac · fic · fec · fect". */
  forms?: string;
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
  /** Positions from an earlier layout of the same words: nodes found here keep their place. */
  seed?: Map<string, [number, number, number]>;
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
 * The flat (2D) layout is a full force simulation, kept for small graphs, and keeps its old
 * limits of 48 morphemes and 220 words by default; the 3D layout the map draws holds every
 * connected word (see `layoutSpace`).
 */
export function layoutNotebookMap(a: NotebookAnalysis, opts: MapOptions = {}): MapLayout {
  const dims = opts.dimensions === 3 ? 3 : 2;
  const kinds = new Set<MorphKind>(opts.kinds || ['root', 'prefix', 'char']);
  if (dims === 3) return layoutSpace(a, kinds, opts.maxWords ?? Infinity, opts.maxHubs ?? Infinity, opts.seed);
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

  // Golden-angle spiral start.
  nodes.forEach((node, i) => {
    const r = 18 * Math.sqrt(i + 1);
    const t = i * 2.399963;
    node.x = Math.cos(t) * r;
    node.y = Math.sin(t) * r;
  });

  const charge = nodes.map((p) => (p.kind === 'word' ? 1 : 3));
  const iterations = n > 200 ? 220 : 300;
  const repulse = 2000;
  const spring = 0.04;
  const restMorph = 74;
  const restDerived = 74;
  const gravity = 0.004;
  const cutoff = 90000;
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
      p.vz = 0;
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

/** A deterministic direction for index `i`: points spread evenly over a sphere. */
function spiral(i: number, n: number): [number, number, number] {
  const y = 1 - (2 * (i + 0.5)) / Math.max(1, n);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const t = i * 2.399963;
  return [Math.cos(t) * r, y, Math.sin(t) * r];
}

/**
 * The 3D layout, built to hold a whole word book (thousands of words) in well under a second.
 * Morphemes are laid out first with a force simulation among themselves only, pulled
 * together by the words they share. Each word then sits inside a ball around its morphemes,
 * nearer the more specific one, and a few passes over a spatial grid push apart words that
 * landed on top of each other. Every step is linear in the number of words except the
 * morpheme simulation, which only sees the few hundred morphemes.
 */
function layoutSpace(a: NotebookAnalysis, kinds: Set<MorphKind>, maxWords: number, maxHubs: number, seed?: Map<string, [number, number, number]>): MapLayout {
  const hubs = a.families.filter((f) => kinds.has(f.kind)).slice(0, maxHubs);
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const wordIndex = new Map<string, number>();
  const blank = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, degree: 0 };
  const addWord = (id: string): number => {
    let i = wordIndex.get(id);
    if (i !== undefined) return i;
    if (nodes.length - hubs.length >= maxWords) return -1;
    const w = a.words.get(id);
    if (!w) return -1;
    i = nodes.length;
    nodes.push({ id, kind: 'word', label: clean(w.entry.lemma), size: 1, gloss: '', ...blank });
    wordIndex.set(id, i);
    return i;
  };
  hubs.forEach((f) => nodes.push({ id: f.key, kind: f.kind, label: f.label, size: f.ids.length, gloss: clean(f.gloss), ...(f.forms ? { forms: f.forms } : {}), ...blank }));
  const wordHubs = new Map<number, number[]>();
  hubs.forEach((f, h) => {
    for (const id of f.ids) {
      const i = addWord(id);
      if (i < 0) continue;
      edges.push({ a: h, b: i, kind: 'morph' });
      const list = wordHubs.get(i);
      if (list) list.push(h);
      else wordHubs.set(i, [h]);
    }
  });
  const parentOf = new Map<number, number>();
  for (const [child, par] of a.parent) {
    const c = addWord(child);
    const p = addWord(par);
    if (c < 0 || p < 0) continue;
    edges.push({ a: p, b: c, kind: 'derived' });
    parentOf.set(c, p);
  }
  for (const e of edges) {
    nodes[e.a].degree += 1;
    nodes[e.b].degree += 1;
  }
  const n = nodes.length;
  if (!n) return { nodes, edges, width: 0, height: 0, radius: 0 };
  const H = hubs.length;

  // Morphemes: each owns a ball sized for its words; morphemes sharing words attract.
  const ball = hubs.map((f) => 8 + 6.5 * Math.cbrt(f.ids.length));
  const shared = new Map<number, number>();
  for (const list of wordHubs.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const k = list[x] * 65536 + list[y];
        shared.set(k, (shared.get(k) || 0) + 1);
      }
    }
  }
  // The radius that packs every ball with some air between them.
  const R0 = 1.4 * Math.cbrt(ball.reduce((s, b) => s + b * b * b, 0)) + 20;
  // Nodes from an earlier layout keep their place, so the map does not reshuffle when a
  // Families trace adds a few words or parts; only the new ones are laid out.
  const fixed = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // A word saved from a book comes back under a new id; its headword keeps its place.
    const at = seed?.get(nodes[i].id) ?? (nodes[i].kind === 'word' ? seed?.get(seedWordKey(nodes[i].label)) : undefined);
    if (!at) continue;
    [nodes[i].x, nodes[i].y, nodes[i].z] = at;
    fixed[i] = 1;
  }
  for (let h = 0; h < H; h++) {
    if (fixed[h]) continue;
    const [x, y, z] = spiral(h, H);
    nodes[h].x = x * R0;
    nodes[h].y = y * R0;
    nodes[h].z = z * R0;
  }
  const springs = [...shared].map(([k, count]) => ({ p: Math.floor(k / 65536), q: k % 65536, w: Math.min(1, count / 3) }));
  const iterations = fixed.some((f, i) => i < H && !f) ? 260 : 0;
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < H; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < H; j++) {
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
        const gap = ball[i] + ball[j];
        // Only near neighbours push: a hard push while two balls overlap and a soft one
        // just outside, so the balls pack together under the pull toward the centre.
        if (d2 > 4 * gap * gap) continue;
        const d = Math.sqrt(d2);
        let f = (2 * gap - d) * 0.03;
        if (d < gap * 1.1) f += (gap * 1.1 - d) * 0.4;
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
        p.vz += (dz / d) * f;
        q.vx -= (dx / d) * f;
        q.vy -= (dy / d) * f;
        q.vz -= (dz / d) * f;
      }
    }
    for (const s of springs) {
      const p = nodes[s.p];
      const q = nodes[s.q];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dz = q.z - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const f = (d - (ball[s.p] + ball[s.q]) * 0.9) * 0.03 * s.w;
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
      p.vz += (dz / d) * f;
      q.vx -= (dx / d) * f;
      q.vy -= (dy / d) * f;
      q.vz -= (dz / d) * f;
    }
    for (let i = 0; i < H; i++) {
      const p = nodes[i];
      if (fixed[i]) {
        p.vx = p.vy = p.vz = 0;
        continue;
      }
      p.vx -= p.x * 0.02;
      p.vy -= p.y * 0.02;
      p.vz -= p.z * 0.02;
      const len = Math.hypot(p.vx, p.vy, p.vz) || 1;
      const step = Math.min(len, 8 * cool + 0.3);
      p.x += (p.vx / len) * step;
      p.y += (p.vy / len) * step;
      p.z += (p.vz / len) * step;
      p.vx *= 0.5;
      p.vy *= 0.5;
      p.vz *= 0.5;
    }
  }

  // Words: inside the ball of their most specific morpheme, drawn toward the others.
  const seat = new Map<number, number>();
  const placed = new Uint8Array(n);
  for (let h = 0; h < H; h++) placed[h] = 1;
  for (let i = H; i < n; i++) if (fixed[i]) placed[i] = 1;
  for (const [i, list] of wordHubs) {
    if (fixed[i]) continue;
    let main = list[0];
    for (const h of list) if (hubs[h].ids.length < hubs[main].ids.length) main = h;
    const k = seat.get(main) || 0;
    seat.set(main, k + 1);
    const size = hubs[main].ids.length;
    const [ux, uy, uz] = spiral(k, size);
    const r = 5 + (ball[main] - 5) * Math.cbrt((k + 0.5) / size);
    let cx = nodes[main].x;
    let cy = nodes[main].y;
    let cz = nodes[main].z;
    if (list.length > 1) {
      // Weighted toward the smaller family, so "infect" sits by fac rather than in the middle of in-.
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const h of list) {
        const wgt = 1 / Math.sqrt(hubs[h].ids.length);
        sw += wgt;
        sx += nodes[h].x * wgt;
        sy += nodes[h].y * wgt;
        sz += nodes[h].z * wgt;
      }
      cx = (cx + sx / sw) / 2;
      cy = (cy + sy / sw) / 2;
      cz = (cz + sz / sw) / 2;
    }
    const p = nodes[i];
    p.x = cx + ux * r;
    p.y = cy + uy * r;
    p.z = cz + uz * r;
    placed[i] = 1;
  }
  // Words joined only to other words ("nation", "national", "nationality"): walk out from the
  // words already placed, each beside its neighbour. A family of such words with no morpheme
  // at all goes on a shell just outside the morphemes.
  const near = new Map<number, number[]>();
  for (const [c, p] of parentOf) {
    near.set(c, [...(near.get(c) || []), p]);
    near.set(p, [...(near.get(p) || []), c]);
  }
  const spread = (start: number[]) => {
    const queue = [...start];
    while (queue.length) {
      const at = queue.shift()!;
      for (const next of near.get(at) || []) {
        if (placed[next]) continue;
        const [ux, uy, uz] = spiral(next % 97, 97);
        nodes[next].x = nodes[at].x + ux * 9;
        nodes[next].y = nodes[at].y + uy * 9;
        nodes[next].z = nodes[at].z + uz * 9;
        placed[next] = 1;
        queue.push(next);
      }
    }
  };
  spread([...near.keys()].filter((i) => placed[i]));
  let hubR = 0;
  for (let h = 0; h < H; h++) hubR = Math.max(hubR, Math.hypot(nodes[h].x, nodes[h].y, nodes[h].z) + ball[h]);
  const loose = [...near.keys()].filter((i) => !placed[i]).sort((x, y) => x - y);
  const shell = (hubR || 30) + 25;
  // One seat on the shell per family of loose words, spread over the whole sphere.
  const seen = new Set<number>();
  const heads: number[] = [];
  for (const i of loose) {
    if (seen.has(i)) continue;
    heads.push(i);
    const queue = [i];
    seen.add(i);
    while (queue.length) {
      for (const next of near.get(queue.shift()!) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  let group = 0;
  for (const i of heads) {
    const [ux, uy, uz] = spiral(group++, heads.length);
    nodes[i].x = ux * shell;
    nodes[i].y = uy * shell;
    nodes[i].z = uz * shell;
    placed[i] = 1;
    spread([i]);
  }

  // Push apart words closer than MIN to each other, using a grid so each word only checks its cell's neighbours.
  const MIN = 4.5;
  const CELL = MIN * 2;
  for (let pass = 0; pass < 6; pass++) {
    const grid = new Map<number, number[]>();
    // Cells as one number: 1,024 cells a side is far more than any layout spans.
    const cellKey = (gx: number, gy: number, gz: number) => ((gx + 512) * 1024 + (gy + 512)) * 1024 + (gz + 512);
    const cellOf = (v: number) => Math.floor(v / CELL);
    for (let i = H; i < n; i++) {
      const k = cellKey(cellOf(nodes[i].x), cellOf(nodes[i].y), cellOf(nodes[i].z));
      const list = grid.get(k);
      if (list) list.push(i);
      else grid.set(k, [i]);
    }
    let moved = 0;
    for (let i = H; i < n; i++) {
      const p = nodes[i];
      const gx = cellOf(p.x);
      const gy = cellOf(p.y);
      const gz = cellOf(p.z);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const list = grid.get(cellKey(gx + ox, gy + oy, gz + oz));
            if (!list) continue;
            for (const j of list) {
              if (j <= i) continue;
              const q = nodes[j];
              let dx = p.x - q.x;
              let dy = p.y - q.y;
              let dz = p.z - q.z;
              let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (d >= MIN) continue;
              if (d < 0.01) {
                [dx, dy, dz] = spiral((i * 31 + j) % 50, 50);
                d = 1;
              }
              // A word kept from the earlier layout stays put; the other one moves the whole way.
              if (fixed[i] && fixed[j]) continue;
              const pp = fixed[i] ? 0 : fixed[j] ? MIN - d : (MIN - d) / 2;
              const qq = fixed[j] ? 0 : fixed[i] ? MIN - d : (MIN - d) / 2;
              p.x += (dx / d) * pp;
              p.y += (dy / d) * pp;
              p.z += (dz / d) * pp;
              q.x -= (dx / d) * qq;
              q.y -= (dy / d) * qq;
              q.z -= (dz / d) * qq;
              moved += 1;
            }
          }
        }
      }
    }
    if (!moved) break;
  }

  // Centre the map on the origin, unless it was seeded: then the old nodes stay exactly where
  // the camera last saw them.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  if (!fixed.some((f) => f)) {
    for (const p of nodes) {
      cx += p.x / n;
      cy += p.y / n;
      cz += p.z / n;
    }
  }
  const dist: number[] = [];
  for (const p of nodes) {
    p.x = Math.round((p.x - cx) * 10) / 10;
    p.y = Math.round((p.y - cy) * 10) / 10;
    p.z = Math.round((p.z - cz) * 10) / 10;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    dist.push(Math.hypot(p.x, p.y, p.z));
  }
  dist.sort((x, y) => x - y);
  // The radius the camera frames: a few stray words far out should not shrink the rest.
  const core = dist[Math.floor((dist.length - 1) * 0.9)] * 1.1;
  return { nodes, edges, width: 0, height: 0, radius: Math.round(Math.min(dist[dist.length - 1], core)) };
}

/** The graph as `mapHtml` hands it to the renderers. */
export interface MapData {
  sig: string;
  radius: number;
  /** Words in the notebook or book the map was drawn from, connected or not. */
  total: number;
  /** The signature of the earlier layout this one kept its positions from, if any. */
  from?: string;
  nodes: { id: string; k: 'word' | MorphKind; l: string; x: number; y: number; z: number; n: number; g?: string; f?: string }[];
  /** [from, to, 1 when the second word is built from the first]. */
  edges: [number, number, 0 | 1][];
}

// The shells repaint the whole view for small reasons (a toast, a filter); keep the last
// few layouts so a repaint does not run the layout again. `attachNotebookMap` reads the
// graph from here by its signature, so a book of thousands of words is not written into
// the page as JSON on every paint.
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
  if (hit) {
    // Most recently used last, so the oldest layout is the one dropped.
    layoutCache.delete(sig);
    layoutCache.set(sig, hit);
    return hit;
  }
  // The same words drawn a moment ago under another signature (a Families trace refined a few
  // parts): keep their positions, so the map does not reshuffle under the reader.
  const prev = seedFor(a, kinds);
  const { nodes, edges, radius } = layoutNotebookMap(a, { kinds, dimensions: 3, ...(prev ? { seed: prev.seed } : {}) });
  const data: MapData = {
    sig,
    radius,
    total: a.words.size,
    ...(prev ? { from: prev.sig } : {}),
    nodes: nodes.map((p) => ({
      id: p.id,
      k: p.kind,
      l: p.label,
      x: p.x,
      y: p.y,
      z: p.z,
      n: p.size,
      ...(p.gloss ? { g: p.gloss } : {}),
      ...(p.forms ? { f: p.forms } : {}),
    })),
    edges: edges.map((e) => [e.a, e.b, e.kind === 'derived' ? 1 : 0]),
  };
  layoutCache.set(sig, data);
  if (layoutCache.size > 6) layoutCache.delete(layoutCache.keys().next().value as string);
  return data;
}

/** A word's headword, lower case: how the map knows a word again when its id changes. */
const headword = (l: string) => String(l || '').trim().toLocaleLowerCase();
/** A seed key by headword, apart from node ids. */
const seedWordKey = (l: string) => `headword ${headword(l)}`;

/** The most recent cached layout of the same morpheme kinds that shares nearly all its words with `a`. */
function seedFor(a: NotebookAnalysis, kinds: MorphKind[]): { sig: string; seed: Map<string, [number, number, number]> } | null {
  const head = `${kinds.slice().sort().join('+')}:`;
  for (const data of [...layoutCache.values()].reverse()) {
    if (!data.sig.startsWith(head)) continue;
    const words = data.nodes.filter((p) => p.k === 'word');
    if (!words.length) continue;
    const shared = words.reduce((s, p) => s + (a.words.has(p.id) ? 1 : 0), 0);
    if (shared / words.length < 0.9 || Math.abs(a.words.size - data.total) > Math.max(5, data.total * 0.05)) continue;
    const seed = new Map<string, [number, number, number]>();
    for (const p of data.nodes) {
      seed.set(p.id, [p.x, p.y, p.z]);
      if (p.k === 'word' && !seed.has(seedWordKey(p.l))) seed.set(seedWordKey(p.l), [p.x, p.y, p.z]);
    }
    return { sig: data.sig, seed };
  }
  return null;
}

/** What a typed word could be the inflection of: "changes" also tries "change", "studied" "study". */
export function queryForms(q: string): string[] {
  const s = String(q || '').trim().toLocaleLowerCase();
  if (!s) return [];
  const out = [s];
  const add = (x: string) => {
    if (x.length >= 2 && !out.includes(x)) out.push(x);
  };
  if (s.endsWith('ies') || s.endsWith('ied')) add(s.slice(0, -3) + 'y');
  if (s.endsWith('es')) add(s.slice(0, -2));
  if (s.endsWith('s') && !s.endsWith('ss')) add(s.slice(0, -1));
  if (s.endsWith('ed')) {
    add(s.slice(0, -1));
    add(s.slice(0, -2));
    if (/(.)\1ed$/.test(s)) add(s.slice(0, -3));
  }
  if (s.endsWith('ing')) {
    add(s.slice(0, -3) + 'e');
    add(s.slice(0, -3));
    if (/(.)\1ing$/.test(s)) add(s.slice(0, -4));
  }
  return out;
}

/**
 * Nodes on the map that match what was typed, best first. Word parts come first: one spelled
 * as typed, with or without its hyphen and in any of its spellings ("ob-", "oc", "fect"), then
 * parts that start with it. Then words: the word itself, the word it is an inflection of
 * ("changes" finds "change"), words starting with it, then words containing it.
 */
export function findMapWords(data: MapData, q: string, limit = 8): MapData['nodes'] {
  const forms = queryForms(q);
  if (!forms.length) return [];
  const s = forms[0];
  const bare = (x: string) => x.toLocaleLowerCase().replace(/^-+|-+$/g, '');
  const part = bare(s);
  const scored: { p: MapData['nodes'][number]; r: number }[] = [];
  for (const p of data.nodes) {
    if (p.k !== 'word') {
      if (!part) continue;
      const spellings = (p.f ? p.f.split(' · ') : [p.l]).map(bare);
      if (spellings.includes(part)) scored.push({ p, r: -2 });
      else if (part.length >= 2 && spellings.some((x) => x.startsWith(part))) scored.push({ p, r: -1 });
      continue;
    }
    const l = p.l.toLocaleLowerCase();
    const fi = forms.indexOf(l);
    let r = -1;
    if (fi === 0) r = 0;
    else if (fi > 0) r = 1;
    else if (l.startsWith(s)) r = 2;
    else if (forms.some((f, i) => i > 0 && f.length >= 3 && l.startsWith(f))) r = 3;
    else if (s.length >= 2 && l.includes(s)) r = 4;
    if (r >= 0) scored.push({ p, r });
  }
  scored.sort((x, y) => x.r - y.r || x.p.l.length - y.p.l.length || x.p.l.localeCompare(y.p.l));
  return scored.slice(0, limit).map((x) => x.p);
}

const MAP_KIND_LABEL: Record<MorphKind, string> = { root: 'Roots', prefix: 'Prefixes', suffix: 'Suffixes', char: 'Characters' };

const ICON_RESET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 4.5v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

let mapSeq = 0;

const count = (n: number) => n.toLocaleString('en');

export interface MapHtmlOptions {
  /** The Words search: the map opens on the word it finds, or says that nothing matches. */
  query?: string;
}

export function mapHtml(a: NotebookAnalysis, kinds: MorphKind[], opts: MapHtmlOptions = {}): string {
  const available = (['root', 'prefix', 'suffix', 'char'] as MorphKind[]).filter((k) => a.families.some((f) => f.kind === k));
  if (!available.length && !a.parent.size) {
    return `<p class="nbv-empty">No connected words yet.</p>`;
  }
  const on = kinds.filter((k) => available.includes(k));
  const active = on.length || a.parent.size ? on : available.slice(0, 1);
  const data = notebookMapData(a, active);
  const words = data.nodes.reduce((s, p) => s + (p.k === 'word' ? 1 : 0), 0);
  const q = clean(opts.query);
  const hit = q ? findMapWords(data, q, 1)[0] : undefined;
  const listId = `nbv-map-suggest-${++mapSeq}`;
  const chips = available
    .map((k) => `<button type="button" class="nbv-chip nbv-chip--${k}${active.includes(k) ? ' is-active' : ''}" data-act="nb-map-kind" data-kind="${k}" aria-pressed="${active.includes(k)}">${MAP_KIND_LABEL[k]}</button>`)
    .join('');
  const search = words
    ? `<div class="nbv-map-find" data-map-find>
        <label class="nbv-map-search">${ICON_SEARCH}<input type="search" data-map-search placeholder="Find a word" value="${esc(q)}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${listId}" aria-label="Find a word on the map"/></label>
        <ul class="nbv-map-suggest" id="${listId}" role="listbox" data-map-suggest hidden></ul>
      </div>`
    : '';
  const total = words < data.total ? `${count(words)} of ${count(data.total)} words` : `${count(words)} ${words === 1 ? 'word' : 'words'}`;
  const miss = q && !hit;
  const hint = `<span class="nbv-map-hint${miss ? ' is-miss' : ''}" data-map-hint data-count="${esc(total)}">${miss ? `No word matches “${esc(q)}”` : total}</span>`;
  const tools = `<div class="nbv-maptools"><div class="nbv-chips" aria-label="Show">${chips}</div>${search}${hint}</div>`;
  if (!data.nodes.length) return tools + `<p class="nbv-empty">Nothing to connect with these filters.</p>`;
  return `${tools}<div class="nbv-map" data-map data-map-sig="${esc(data.sig)}"${hit ? ` data-map-goto="${esc(hit.id)}" data-map-query="${esc(q)}"` : ''}>
    <div class="nbv-map__stage" data-map-stage role="img" aria-label="Map of related words"></div>
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
    this.adopt();
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
    const onResize = () => fitMap(map);
    window.addEventListener('resize', onResize);
    this.offs.push(() => window.removeEventListener('resize', onResize));
    this.offs.push(() => map.removeEventListener('click', onClick), () => map.removeEventListener('keydown', onKey));
    const input = map.parentElement?.querySelector<HTMLInputElement>('[data-map-search]');
    if (input) this.wireSearch(input);
  }

  private wireSearch(input: HTMLInputElement): void {
    const list = input.closest('[data-map-find]')?.querySelector<HTMLElement>('[data-map-suggest]') || null;
    const hint = this.map.parentElement?.querySelector<HTMLElement>('[data-map-hint]') || null;
    let items: MapData['nodes'] = [];
    let active = -1;
    const close = () => {
      items = [];
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      if (list) {
        list.hidden = true;
        list.innerHTML = '';
      }
    };
    const paint = () => {
      if (!list || !items.length) return close();
      list.innerHTML = items
        .map((p, i) => {
          const text = p.k === 'word' ? esc(p.l) : `<span class="nbv-morph nbv-morph--${p.k}">${esc(p.f || p.l)}</span>${p.g ? `<span class="nbv-map-suggest__gloss">${esc(p.g)}</span>` : ''}`;
          return `<li role="option" id="${list.id}-${i}" class="nbv-map-suggest__item${i === active ? ' is-active' : ''}" data-i="${i}" aria-selected="${i === active}">${text}</li>`;
        })
        .join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    };
    const say = (miss: string | null) => {
      input.classList.toggle('is-miss', !!miss);
      if (!hint) return;
      hint.textContent = miss ? `No word matches “${miss}”` : hint.dataset.count || '';
      hint.classList.toggle('is-miss', !!miss);
    };
    const go = (p: MapData['nodes'][number]) => {
      input.value = p.l;
      close();
      say(null);
      this.focus(p.id, true);
      if (memory) memory.find = p.l;
    };
    // A repaint (a toast, a meaning arriving) rebuilds the field; keep the word that was found in it.
    if (!input.value && memory && memory.sig === this.data.sig && memory.find && memory.focus) input.value = memory.find;
    const onInput = () => {
      say(null);
      items = input.value.trim() ? findMapWords(this.data, input.value, 8) : [];
      active = items.length ? 0 : -1;
      paint();
    };
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && items.length) {
        ev.preventDefault();
        active = (active + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        paint();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const p = items[active] || findMapWords(this.data, input.value, 1)[0];
        if (p) go(p);
        else if (input.value.trim()) {
          close();
          say(input.value.trim());
        }
      } else if (ev.key === 'Escape' && items.length) {
        ev.stopPropagation();
        close();
      }
    };
    // Keep focus in the field while a suggestion is pressed, so the pick is not lost to blur.
    const onListDown = (ev: Event) => ev.preventDefault();
    const onListClick = (ev: Event) => {
      const li = (ev.target as HTMLElement | null)?.closest?.('[data-i]') as HTMLElement | null;
      const p = li ? items[Number(li.dataset.i)] : undefined;
      if (p) go(p);
    };
    const onBlur = () => close();
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
    list?.addEventListener('pointerdown', onListDown);
    list?.addEventListener('click', onListClick);
    this.offs.push(() => {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
      list?.removeEventListener('pointerdown', onListDown);
      list?.removeEventListener('click', onListClick);
    });
  }

  use(renderer: MapRenderer): void {
    if (this.disposed) {
      renderer.dispose();
      return;
    }
    this.renderer = renderer;
    // Back on the same map (after a lookup, say): the word that was focused stays focused.
    // A new search from the Words field flies to the word it found instead.
    const query = this.map.dataset.mapQuery || '';
    const goto = this.map.dataset.mapGoto || '';
    this.adopt();
    const same = !!memory && memory.sig === this.data.sig;
    if (goto && (!same || memory!.query !== query) && this.index.has(goto)) {
      this.focus(goto, true);
      memory!.query = query;
    } else if (same && memory!.focus && this.index.has(memory!.focus)) {
      // Without a saved camera (a rebuilt graph moved the word, or the flat map) fly back to it.
      this.focus(memory!.focus, !memory!.view);
    }
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
    if (memory && memory.sig === this.data.sig) {
      // Focusing the same word again (a repaint) keeps the word typed to find it.
      if (memory.focus !== id) memory.find = undefined;
      Object.assign(memory, this.spot(id));
    } else memory = { sig: this.data.sig, ...this.spot(id), view: null, query: '' };
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
    const CAP = 300;
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
      panel.innerHTML = `<div class="nbv-map__head"><h3 class="nbv-map__title"><span class="nbv-morph nbv-morph--${me.k}">${esc(me.f || me.l)}</span></h3>${close}</div>
        ${me.g ? `<p class="nbv-map__gloss">${esc(me.g)}</p>` : ''}
        <p class="nbv-map__sub">${words.length} ${words.length === 1 ? 'word' : 'words'}</p><div class="nbv-map__words">${wordBtns}${more}</div>`;
    }
    panel.hidden = false;
    const m = this.map.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const side = p.width < m.width * 0.6;
    this.renderer?.inset?.(side ? p.right - m.left : 0, side ? 0 : m.bottom - p.top);
    // A sheet along the bottom must clear the app's tab bar, so its Look up button can be reached.
    if (!side) {
      const band = visibleBand();
      const below = m.bottom - band.bottom + 8;
      if (below > 0) scrollParent(this.map).scrollBy({ top: below, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
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
    else memory = { sig: this.data.sig, ...this.spot(this.focusId), view, query: '' };
    this.renderer?.dispose();
    this.renderer = null;
    this.offs.splice(0).forEach((f) => f());
    live.delete(this);
  }

  /** The focused node as the memory keeps it: its id, its headword, and where it stands. */
  private spot(id: string | null): Pick<MapMemory, 'focus' | 'word' | 'at'> {
    const p = id ? this.data.nodes[this.index.get(id)!] : null;
    return { focus: id, word: p && p.k === 'word' ? headword(p.l) : null, at: p ? [p.x, p.y, p.z] : null };
  }

  savedView(): MapView | null {
    this.adopt();
    return memory && memory.sig === this.data.sig ? memory.view : null;
  }

  /** Take over the focus and camera remembered on an earlier graph of the same words. */
  private adopt(): void {
    memory = carryMapMemory(memory, this.data);
  }
}

const live = new Set<MapController>();

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The fixed or sticky bar an element at this point sits in, if any. */
function barAt(x: number, y: number): DOMRect | null {
  for (const hit of document.elementsFromPoint?.(x, y) || []) {
    for (let el: Element | null = hit; el && el !== document.body; el = el.parentElement) {
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') return el.getBoundingClientRect();
    }
  }
  return null;
}

/**
 * The part of the window not covered by the shell's fixed bars: a tab bar along the bottom (the
 * phone's Lookup, Words, Learn and Settings) and a sticky header along the top.
 */
function visibleBand(): { top: number; bottom: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const low = barAt(w / 2, h - 2);
  const high = barAt(w / 2, 2);
  return { top: high && high.bottom < h / 2 ? high.bottom : 0, bottom: low && low.top > h / 2 ? low.top : h };
}

function scrollParent(el: HTMLElement): Element {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * Keep the map no taller than the room between the shell's bars, so the whole stage, and the
 * sheet along its bottom, can be on screen at once.
 */
function fitMap(map: HTMLElement): void {
  map.style.height = '';
  const natural = map.getBoundingClientRect().height;
  const band = visibleBand();
  const room = Math.floor(band.bottom - band.top - 16);
  if (room >= 260 && natural > room) map.style.height = `${room}px`;
}
/**
 * What the map remembers between paints: the focused node, the camera, the Words search that
 * last flew somewhere, and the word typed in the map's own field.
 */
export interface MapMemory {
  sig: string;
  focus: string | null;
  /** The focused word's headword, lower case; null for a word part. */
  word?: string | null;
  /** Where the focused node stood when it was focused. */
  at?: [number, number, number] | null;
  view: MapView | null;
  query: string;
  find?: string;
}

/**
 * Carry what the map remembered into a rebuilt graph. A lookup that saves a word, or a trace
 * that refines its parts, draws a new graph, and saving a book word gives it a new id: the
 * focused word is found again by its id, then by its headword. The camera stays only when the
 * word still stands where the camera last saw it; otherwise `view` is dropped and the map flies
 * to the word.
 */
export function carryMapMemory(m: MapMemory | null, data: MapData): MapMemory | null {
  if (!m || m.sig === data.sig) return m;
  let node = m.focus ? data.nodes.find((p) => p.id === m.focus) : undefined;
  if (!node && m.word) node = data.nodes.find((p) => p.k === 'word' && headword(p.l) === m.word);
  // A graph this one did not grow from, without the focused word: nothing to carry.
  if (!node && data.from !== m.sig) return m;
  const still = node ? !!m.at && Math.hypot(node.x - m.at[0], node.y - m.at[1], node.z - m.at[2]) < 0.5 : data.from === m.sig;
  return {
    ...m,
    sig: data.sig,
    focus: node ? node.id : null,
    word: node && node.k === 'word' ? headword(node.l) : null,
    at: node ? [node.x, node.y, node.z] : null,
    view: still ? m.view : null,
  };
}

let memory: MapMemory | null = null;
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
  const data = layoutCache.get(map.dataset.mapSig || '');
  const stage = map.querySelector<HTMLElement>('[data-map-stage]');
  if (!data || !stage) return;
  map.dataset.wired = '1';
  fitMap(map);
  const ctl = new MapController(map, data);
  live.add(ctl);
  const opts: MapRendererOptions = { reducedMotion: reducedMotion(), restore: ctl.savedView(), onPick: ctl.pick };
  const flat = () => {
    if (!ctl.alive || !map.isConnected) return;
    map.classList.add('is-flat');
    ctl.use(createFlatMap(stage, flatMapData(data), opts));
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
/** The flat map's graph: a subset of the map, with each edge's index in the full map. */
interface FlatData extends MapData {
  edgeIds: number[];
}

/**
 * Without WebGL thousands of nodes on a plane are a tangle, so the flat map draws what the old
 * map drew: the 48 largest morphemes and up to 220 of their words, laid out flat by the force
 * simulation. Search and focus still work on the whole map; a word outside the subset is
 * found and listed but not drawn.
 */
export function flatMapData(data: MapData, maxHubs = 48, maxWords = 220): FlatData {
  const hubs = data.nodes
    .map((p, i) => ({ p, i }))
    .filter((x) => x.p.k !== 'word')
    .sort((a, b) => b.p.n - a.p.n || a.p.l.localeCompare(b.p.l))
    .slice(0, maxHubs);
  const byHub = new Map<number, string[]>();
  const parent = new Map<string, string>();
  data.edges.forEach(([a, b, derived]) => {
    if (derived) parent.set(data.nodes[b].id, data.nodes[a].id);
    else byHub.set(a, [...(byHub.get(a) || []), data.nodes[b].id]);
  });
  const words = new Map(
    data.nodes.filter((p) => p.k === 'word').map((p) => [p.id, { entry: { id: p.id, lemma: p.l } as NotebookEntry, morphs: [], parts: [], origin: '' } as WordInfo]),
  );
  const families: Family[] = hubs.map(({ p, i }) => ({ key: p.id, kind: p.k as MorphKind, label: p.l, gloss: p.g || '', origin: '', ids: byHub.get(i) || [], ...(p.f ? { forms: p.f } : {}) }));
  const kinds = [...new Set(families.map((f) => f.kind))];
  const flat = layoutNotebookMap({ words, families, trees: [], parent }, { kinds, dimensions: 2, maxHubs, maxWords });
  const index = new Map(data.nodes.map((p, i) => [p.id, i]));
  const edgeIndex = new Map(data.edges.map(([a, b], k) => [`${data.nodes[a].id}>${data.nodes[b].id}`, k]));
  const nodes = flat.nodes.map((p) => ({ ...data.nodes[index.get(p.id)!], x: p.x, y: -p.y, z: 0 }));
  const edges: MapData['edges'] = flat.edges.map((e) => [e.a, e.b, e.kind === 'derived' ? 1 : 0]);
  const edgeIds = flat.edges.map((e) => edgeIndex.get(`${flat.nodes[e.a].id}>${flat.nodes[e.b].id}`) ?? -1);
  return { ...data, nodes, edges, edgeIds };
}

function createFlatMap(stage: HTMLElement, data: FlatData, opts: MapRendererOptions): MapRenderer {
  const pad = 60;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // The flat layout is already in pixels.
  const scale = 1;
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
      return `<line class="nbv-edge nbv-edge--${kind}" data-e="${data.edgeIds[k]}" x1="${pts[a].x}" y1="${pts[a].y}" x2="${pts[b].x}" y2="${pts[b].y}"/>`;
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
      // A word the flat map does not draw is shown in the panel only; the map stays undimmed.
      const focus = h?.focus;
      if (focus && !data.nodes.some((p) => p.id === focus)) h = null;
      stage.closest('[data-map]')?.classList.toggle('is-focus', !!h);
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
