/**
 * The 3D map scene: three.js through 3d-force-graph, loaded on demand by
 * `notebook-map-load.js`. Positions come precomputed from `layoutNotebookMap`, so nothing
 * moves on its own; the reader turns the camera.
 *
 * Labels are DOM elements (CSS2DRenderer) so they use the app's fonts. A culling pass
 * decides which ones show, in the spirit of sigma.js's label grid: the focused word and
 * the hovered node first, then every morpheme, then the focused neighbourhood, then words
 * near the camera, each placed only where it does not overlap a label already placed.
 */
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { MapData, MapHighlight, MapRenderer, MapRendererOptions, MapView } from './notebook-map';

const BG = '#f4f0ea';
const NODE_COLOR: Record<string, string> = {
  word: '#3b302a',
  root: '#0f6e71',
  prefix: '#d9735a',
  suffix: '#8a7d74',
  char: '#7a5a3a',
};
const FOCUS_COLOR = '#9c3d00';
const EDGE_RGB: Record<string, string> = {
  root: '15,110,113',
  prefix: '196,98,66',
  suffix: '120,108,100',
  char: '122,90,58',
  derived: '156,61,0',
};

interface GNode {
  id: string;
  k: string;
  l: string;
  n: number;
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
}

interface GLink {
  source: string;
  target: string;
  e: number;
  kind: string;
}

interface Label {
  node: GNode;
  obj: CSS2DObject;
  el: HTMLElement;
  mesh: THREE.Mesh;
  hub: boolean;
  w: number;
  h: number;
  shown: boolean;
  opacity: number;
}

export function createMapScene(stage: HTMLElement, data: MapData, opts: MapRendererOptions, onDetached: () => void): MapRenderer {
  const reduced = opts.reducedMotion;
  const R = Math.max(40, data.radius);
  const nodes: GNode[] = data.nodes.map((p) => ({ id: p.id, k: p.k, l: p.l, n: p.n, x: p.x, y: p.y, z: p.z, fx: p.x, fy: p.y, fz: p.z }));
  const links: GLink[] = data.edges.map(([a, b, d], e) => ({
    source: data.nodes[a].id,
    target: data.nodes[b].id,
    e,
    kind: d ? 'derived' : data.nodes[a].k,
  }));
  const byId = new Map(nodes.map((p) => [p.id, p]));

  const sphere = new THREE.SphereGeometry(1, 18, 14);
  const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const baseMat: Record<string, THREE.MeshLambertMaterial> = {};
  const dimMat: Record<string, THREE.MeshLambertMaterial> = {};
  for (const [k, c] of Object.entries(NODE_COLOR)) {
    baseMat[k] = new THREE.MeshLambertMaterial({ color: c });
    dimMat[k] = new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: 0.12, depthWrite: false });
  }
  const focusMat = new THREE.MeshLambertMaterial({ color: FOCUS_COLOR, emissive: FOCUS_COLOR, emissiveIntensity: 0.25 });

  const labels: Label[] = [];
  const makeNode = (raw: object): THREE.Object3D => {
    const node = raw as GNode;
    const hub = node.k !== 'word';
    const group = new THREE.Group();
    const r = hub ? Math.min(7, 2.6 + Math.sqrt(node.n) * 0.8) : 1.7;
    const mesh = new THREE.Mesh(sphere, baseMat[node.k] || baseMat.word);
    mesh.scale.setScalar(r);
    group.add(mesh);
    // A larger invisible sphere makes small words easy to hit with a finger.
    const hit = new THREE.Mesh(sphere, hitMat);
    hit.scale.setScalar(hub ? r + 2 : 5);
    group.add(hit);
    const el = document.createElement('div');
    el.className = `nbv-m3-label nbv-m3-label--${node.k}`;
    el.textContent = node.l;
    el.dataset.id = node.id;
    const obj = new CSS2DObject(el);
    if (!hub) obj.center.set(-0.08, 0.5);
    obj.visible = false;
    group.add(obj);
    const label: Label = {
      node,
      obj,
      el,
      mesh,
      hub,
      w: hub ? node.l.length * 8 + 18 : node.l.length * 7.2 + 8,
      h: hub ? 22 : 18,
      shown: false,
      opacity: 1,
    };
    labels.push(label);
    return group;
  };

  let hl: MapHighlight | null = null;
  let hover: string | null = null;
  const linkColor = (raw: object): string => {
    const l = raw as GLink;
    const rgb = EDGE_RGB[l.kind] || EDGE_RGB.root;
    const base = l.kind === 'derived' ? 0.6 : 0.3;
    const a = !hl ? base : hl.edges.has(l.e) ? 0.9 : 0.05;
    return `rgba(${rgb},${a})`;
  };

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'nbv-m3-labels';
  const graph = new ForceGraph3D(stage, {
    controlType: 'orbit',
    // The typings name a Renderer interface that @types/three no longer exports.
    extraRenderers: [labelRenderer as any],
    rendererConfig: { antialias: true, powerPreference: 'low-power' },
  });
  let W = Math.max(1, stage.clientWidth);
  let H = Math.max(1, stage.clientHeight);
  graph
    .width(W)
    .height(H)
    .backgroundColor(BG)
    .showNavInfo(false)
    .enableNodeDrag(false)
    .nodeLabel(() => '')
    .nodeThreeObject(makeNode)
    .nodeThreeObjectExtend(false)
    .linkColor(linkColor)
    .linkOpacity(1)
    .linkWidth(0)
    .warmupTicks(0)
    .cooldownTicks(0)
    .onNodeHover((n) => setHover(n ? String((n as GNode).id) : null))
    .onNodeClick((n) => opts.onPick(String((n as GNode).id)))
    .onBackgroundClick(() => opts.onPick(null))
    .graphData({ nodes, links });

  const scene = graph.scene();
  const camera = graph.camera() as THREE.PerspectiveCamera;
  const renderer = graph.renderer();
  const controls = graph.controls() as any;
  scene.fog = new THREE.Fog(BG, 1, 10000);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.12;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.screenSpacePanning = true;
  controls.minDistance = 12;
  controls.maxDistance = R * 6;

  /** The narrower of the vertical and horizontal fields of view, in radians. */
  const minFov = (visible = false) => {
    const w = visible ? Math.max(80, W - insetL) : W;
    const h = visible ? Math.max(80, H - insetB) : H;
    const v = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (h / H));
    return Math.min(v, 2 * Math.atan(Math.tan(v / 2) * (w / h)));
  };
  const fitDistance = () => (R / Math.sin(minFov() / 2)) * 0.92;

  // The panel covers part of the canvas. Shifting the projection window keeps the camera's
  // target in the middle of what is still visible; the shift eases in and out with the panel.
  let insetL = 0;
  let insetB = 0;
  let offX = 0;
  let offY = 0;
  const applyOffset = () => {
    if (Math.abs(offX) < 0.5 && Math.abs(offY) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(W, H, offX, offY, W, H);
  };
  const stepOffset = () => {
    const tx = -insetL / 2;
    const ty = insetB / 2;
    if (offX === tx && offY === ty) return;
    const k = reduced ? 1 : 0.22;
    offX = Math.abs(tx - offX) < 0.5 ? tx : offX + (tx - offX) * k;
    offY = Math.abs(ty - offY) < 0.5 ? ty : offY + (ty - offY) * k;
    applyOffset();
  };
  const home = () => ({ pos: { x: 0, y: 0, z: fitDistance() }, target: { x: 0, y: 0, z: 0 } });
  const ms = (t: number) => (reduced ? 0 : t);
  const start = opts.restore || home();
  graph.cameraPosition(start.pos, start.target, 0);

  // Labels take clicks too; a press on one must not reach the canvas as a background click.
  const layer = labelRenderer.domElement;
  const labelId = (ev: Event) => ((ev.target as HTMLElement | null)?.closest?.('[data-id]') as HTMLElement | null)?.dataset.id || null;
  const onLabelDown = (ev: PointerEvent) => {
    if (labelId(ev)) ev.stopPropagation();
  };
  const onLabelClick = (ev: MouseEvent) => {
    const id = labelId(ev);
    if (id) opts.onPick(id);
  };
  const onLabelOver = (ev: MouseEvent) => setHover(labelId(ev));
  layer.addEventListener('pointerdown', onLabelDown);
  layer.addEventListener('click', onLabelClick);
  layer.addEventListener('mouseover', onLabelOver);
  layer.addEventListener('mouseleave', () => setHover(null));

  // Rendering stops while nothing moves, so an idle map costs no GPU time; any input wakes it.
  let idle = 0;
  let sleeping = false;
  const wake = () => {
    idle = 0;
    if (sleeping && !hidden) {
      sleeping = false;
      graph.resumeAnimation();
    }
    if (!raf && !timer && !disposed) raf = requestAnimationFrame(loop);
  };
  const wakeEvents = ['pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;
  wakeEvents.forEach((t) => stage.addEventListener(t, wake, { passive: true }));

  let hidden = false;
  const ro = new ResizeObserver(() => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    hidden = !w || !h;
    if (hidden) return;
    if (w !== W || h !== H) {
      W = w;
      H = h;
      graph.width(W).height(H);
      applyOffset();
      lastKey = '';
    }
    wake();
  });
  ro.observe(stage);

  function setHover(id: string | null) {
    if (id === hover) return;
    hover = id;
    stage.style.cursor = id ? 'pointer' : '';
    lastKey = '';
    wake();
  }

  const v = new THREE.Vector3();
  let lastKey = '';
  const cull = (): boolean => {
    const target = controls.target as THREE.Vector3;
    // Labels appear only after the graph digests its data, so their count is part of the key.
    const key = `${camera.matrixWorld.elements.map((x) => x.toFixed(2)).join(',')}|${W}x${H}|${labels.length}|${offX.toFixed(1)},${offY.toFixed(1)}`;
    if (key === lastKey) return false;
    lastKey = key;
    const camDist = camera.position.distanceTo(target);
    const fog = scene.fog as THREE.Fog;
    fog.near = Math.max(1, camDist - R * 0.2);
    fog.far = camDist + R * 1.7;
    const near = Math.max(55, camDist * 0.7);
    const focus = hl?.focus || null;
    const cands: { l: Label; pri: number; d: number; sx: number; sy: number }[] = [];
    for (const l of labels) {
      const n = l.node;
      v.set(n.x, n.y, n.z);
      const d = v.distanceTo(camera.position);
      v.project(camera);
      let pri = 9;
      if (v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15) {
        if (n.id === focus || n.id === hover) pri = 0;
        else if (l.hub) pri = hl && !hl.nodes.has(n.id) ? 3 : 1;
        else if (hl) pri = hl.nodes.has(n.id) ? 2 : 9;
        else if (d < near) pri = 4;
      }
      if (pri === 9) {
        show(l, false);
        continue;
      }
      cands.push({ l, pri, d, sx: ((v.x + 1) / 2) * W, sy: ((1 - v.y) / 2) * H });
    }
    cands.sort((a, b) => a.pri - b.pri || a.d - b.d);
    const CELL = 64;
    const grid = new Map<number, number[][]>();
    const cells = (x0: number, y0: number, x1: number, y1: number, f: (k: number) => boolean | void): boolean => {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          if (f(cx * 4096 + cy)) return true;
        }
      }
      return false;
    };
    for (const c of cands) {
      const { l } = c;
      const x0 = l.hub ? c.sx - l.w / 2 : c.sx + 4;
      const y0 = c.sy - l.h / 2;
      const x1 = x0 + l.w;
      const y1 = y0 + l.h;
      const hit = cells(x0, y0, x1, y1, (k) => (grid.get(k) || []).some((r) => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]));
      // Morpheme labels always show; one that lands on a nearer label turns faint instead of
      // hiding, and words give way. The focused word and the hovered node always win.
      if (hit && !l.hub && c.pri > 0) {
        show(l, false);
        continue;
      }
      cells(x0, y0, x1, y1, (k) => {
        const list = grid.get(k);
        if (list) list.push([x0, y0, x1, y1]);
        else grid.set(k, [[x0, y0, x1, y1]]);
      });
      show(l, true);
      // Morphemes behind the centre of view fade, which reads as depth.
      const depth = Math.min(1, Math.max(0.45, 1.15 - Math.max(0, c.d - camDist) / (R * 1.4)));
      const faint = (hl && !hl.nodes.has(l.node.id)) || (hit && c.pri > 0);
      const op = l.hub ? depth * (faint ? 0.3 : 1) : 1;
      if (Math.abs(op - l.opacity) > 0.04) {
        l.opacity = op;
        l.el.style.opacity = op.toFixed(2);
      }
    }
    return true;
  };
  let changed = false;
  function show(l: Label, on: boolean) {
    if (l.shown === on) return;
    l.shown = on;
    l.obj.visible = on;
    changed = true;
  }

  let raf = 0;
  let timer = 0;
  let disposed = false;
  function loop() {
    raf = 0;
    timer = 0;
    if (disposed) return;
    if (!stage.isConnected) {
      onDetached();
      return;
    }
    if (hidden) {
      if (!sleeping) {
        sleeping = true;
        graph.pauseAnimation();
      }
      timer = window.setTimeout(loop, 500);
      return;
    }
    changed = false;
    stepOffset();
    const moved = cull();
    // A label shown or hidden while rendering sleeps needs one more frame to reach the screen.
    if (changed && sleeping) {
      sleeping = false;
      graph.resumeAnimation();
    }
    idle = moved || changed || hover ? 0 : idle + 1;
    if (idle > 45 && !sleeping) {
      sleeping = true;
      graph.pauseAnimation();
    }
    if (sleeping) timer = window.setTimeout(loop, 500);
    else raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  const flyTo = (id: string) => {
    const n = byId.get(id);
    if (!n) return;
    // Frame the node with its direct neighbours: a word with its morphemes, a morpheme with
    // its words. The camera aims between the node and them, the node counting double.
    const i = data.nodes.findIndex((p) => p.id === id);
    const near = data.edges.filter(([a, b]) => a === i || b === i).map(([a, b]) => data.nodes[a === i ? b : a]);
    const c = new THREE.Vector3(n.x * 2, n.y * 2, n.z * 2);
    for (const q of near) c.add(new THREE.Vector3(q.x, q.y, q.z));
    c.divideScalar(near.length + 2);
    let extent = 12;
    for (const q of [n, ...near]) extent = Math.max(extent, Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z));
    const dist = THREE.MathUtils.clamp((extent / Math.tan(minFov(true) / 2)) * 1.25, 40, R * 3);
    const from = new THREE.Vector3().subVectors(camera.position, c);
    if (from.lengthSq() < 1) from.set(0, 0, 1);
    from.setLength(dist);
    graph.cameraPosition({ x: c.x + from.x, y: c.y + from.y, z: c.z + from.z }, { x: c.x, y: c.y, z: c.z }, ms(900));
  };

  return {
    highlight(h, fly) {
      hl = h;
      for (const l of labels) {
        const id = l.node.id;
        const lit = !h || h.nodes.has(id);
        l.mesh.material = h && id === h.focus ? focusMat : lit ? baseMat[l.node.k] || baseMat.word : dimMat[l.node.k] || dimMat.word;
        l.el.classList.toggle('is-focus', !!h && id === h.focus);
        l.el.classList.toggle('is-lit', !!h && lit);
      }
      graph.linkColor((raw: object) => linkColor(raw));
      if (fly && h?.focus) flyTo(h.focus);
      lastKey = '';
      wake();
    },
    inset(left, bottom) {
      insetL = Math.max(0, Math.min(W * 0.6, left));
      insetB = Math.max(0, Math.min(H * 0.6, bottom));
      wake();
    },
    zoom(dir) {
      const target = controls.target as THREE.Vector3;
      const off = new THREE.Vector3().subVectors(camera.position, target);
      const len = THREE.MathUtils.clamp(off.length() * (dir === 'in' ? 0.7 : 1.4), controls.minDistance, controls.maxDistance);
      off.setLength(len);
      graph.cameraPosition({ x: target.x + off.x, y: target.y + off.y, z: target.z + off.z }, { x: target.x, y: target.y, z: target.z }, ms(300));
      wake();
    },
    reset() {
      const h = home();
      graph.cameraPosition(h.pos, h.target, ms(700));
      wake();
    },
    view(): MapView | null {
      const t = controls.target as THREE.Vector3;
      return { pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, target: { x: t.x, y: t.y, z: t.z } };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
      wakeEvents.forEach((t) => stage.removeEventListener(t, wake));
      layer.removeEventListener('pointerdown', onLabelDown);
      layer.removeEventListener('click', onLabelClick);
      layer.removeEventListener('mouseover', onLabelOver);
      try {
        graph._destructor();
      } catch {
        /* already torn down */
      }
      renderer.forceContextLoss();
      renderer.domElement.remove();
      layer.remove();
      sphere.dispose();
      hitMat.dispose();
      focusMat.dispose();
      Object.values(baseMat).forEach((m) => m.dispose());
      Object.values(dimMat).forEach((m) => m.dispose());
      labels.length = 0;
      // three-render-objects publishes its scene on window for debugging; drop ours.
      const w = window as unknown as { scene?: unknown };
      if (w.scene === scene) delete w.scene;
      stage.innerHTML = '';
    },
  };
}
