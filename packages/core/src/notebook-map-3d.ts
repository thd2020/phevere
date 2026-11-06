/**
 * The 3D map scene, drawn with three.js and loaded on demand by `notebook-map-load.js`.
 * Positions come precomputed from `layoutNotebookMap`, so nothing moves on its own; the
 * reader turns the camera.
 *
 * A whole word book can be on the map (thousands of words), so the scene is built for that:
 * every node is one instance of a single mesh and every edge one segment of a single line
 * object, which is two draw calls however large the book. Frames are drawn only while
 * something moves.
 *
 * Labels are DOM elements so they use the app's fonts. Each morpheme has one; words share a
 * small pool. A culling pass in the spirit of sigma.js's label grid decides what shows: the
 * focused word and the hovered node first, then every morpheme, then the focused
 * neighbourhood, then words near the camera, each only where it does not overlap a label
 * already placed. Words linked to nothing are smaller, lighter points in one group with a
 * single caption, and each is named only when pointed at or focused.
 *
 * The camera follows three.js OrbitControls and graph tools such as 3d-force-graph and
 * Obsidian's graph view. With a mouse, drag turns the map (left and right) and tilts it (up
 * and down), right-drag or Shift-drag pans, and the wheel or a trackpad pinch zooms. On a
 * touch screen one finger turns and tilts, and two fingers drag to pan, pinch to zoom and
 * twist to turn, as OrbitControls' two-finger dolly-and-pan and map apps do. A gesture may
 * start on a word or a label; a press that
 * barely moves and lifts quickly is a tap and picks what is under it.
 */
import * as THREE from 'three';
import type { MapData, MapHighlight, MapRenderer, MapRendererOptions, MapView } from './notebook-map';
import { t } from './i18n/runtime';

const BG = '#f4f0ea';
const NODE_COLOR: Record<string, string> = {
  word: '#3b302a',
  root: '#0f6e71',
  prefix: '#d9735a',
  suffix: '#8a7d74',
  char: '#7a5a3a',
};
const FOCUS_COLOR = '#9c3d00';
const EDGE_COLOR: Record<string, string> = {
  root: '#0f6e71',
  prefix: '#c46242',
  suffix: '#786c64',
  char: '#7a5a3a',
  derived: '#9c3d00',
};
/** How strongly an edge shows, as a blend between the background and its colour. */
const EDGE_BASE = 0.3;
const EDGE_DERIVED = 0.6;
const EDGE_LIT = 0.9;
const EDGE_DIM = 0.05;
/** Dimmed nodes blend this far toward the background. */
const NODE_DIM = 0.86;
/** Unlinked words are drawn this much lighter than linked ones. */
const UNLINKED_FADE = 0.45;

/** Pixels a press may move and still count as a tap. */
const TAP_SLOP = { mouse: 5, touch: 10 };
const TAP_MS = 500;
/** Word labels drawn at once; the pool is reused as the camera moves. */
const WORD_LABELS = 90;

interface Label {
  i: number;
  el: HTMLElement;
  w: number;
  h: number;
  shown: boolean;
  opacity: number;
}

/** Ease in and out (cubic), for camera flights. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createMapScene(stage: HTMLElement, laid: MapData, opts: MapRendererOptions, onDetached: () => void): MapRenderer {
  // The layout puts the unlinked group beside the graph. On a tall screen, a phone held upright,
  // the scene turns a quarter so the group sits below the graph and both fit the width.
  const tall = stage.clientHeight > stage.clientWidth * 1.15 && laid.nodes.some((p) => p.u);
  const data: MapData = tall ? { ...laid, nodes: laid.nodes.map((p) => ({ ...p, x: p.y, y: -p.x })) } : laid;
  const reduced = opts.reducedMotion;
  const R = Math.max(40, data.radius);
  const N = data.nodes.length;
  const hub = (i: number) => data.nodes[i].k !== 'word';
  const radiusOf = (i: number) => (hub(i) ? Math.min(7, 2.6 + Math.sqrt(data.nodes[i].n) * 0.8) : data.nodes[i].u ? 1.1 : 1.7);
  const byId = new Map<string, number>(data.nodes.map((p, i) => [p.id, i]));

  let W = Math.max(1, stage.clientWidth);
  let H = Math.max(1, stage.clientHeight);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  const ratio = () => Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(ratio());
  renderer.setSize(W, H);
  // A window moved to a screen with another pixel density, or a browser zoom, changes the ratio.
  let dprQuery: MediaQueryList | null = null;
  const onDpr = () => {
    renderer.setPixelRatio(ratio());
    renderer.setSize(W, H);
    watchDpr();
    wake();
  };
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) || null;
    dprQuery?.addEventListener('change', onDpr);
  };
  watchDpr();
  renderer.setClearColor(BG);
  renderer.domElement.style.display = 'block';
  stage.appendChild(renderer.domElement);
  const layer = document.createElement('div');
  layer.className = 'nbv-m3-labels';
  stage.appendChild(layer);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 1, 10000);
  scene.add(new THREE.AmbientLight(0xcccccc, Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
  sun.position.set(0.4, 1, 0.8);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(50, W / H, 1, R * 40);

  // Nodes: one instanced sphere, 80 triangles each, which is round enough at the size nodes draw.
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  const nodeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(sphere, nodeMat, Math.max(1, N));
  mesh.count = N;
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const p = data.nodes[i];
    const r = radiusOf(i);
    m4.makeScale(r, r, r).setPosition(p.x, p.y, p.z);
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Edges: one line object, coloured per vertex.
  const E = data.edges.length;
  const pos = new Float32Array(E * 6);
  const col = new Float32Array(E * 6);
  data.edges.forEach(([a, b], k) => {
    const p = data.nodes[a];
    const q = data.nodes[b];
    pos.set([p.x, p.y, p.z, q.x, q.y, q.z], k * 6);
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const colAttr = new THREE.BufferAttribute(col, 3);
  lineGeo.setAttribute('color', colAttr);
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;
  scene.add(lines);

  const bg = new THREE.Color(BG);
  const tmp = new THREE.Color();
  const edgeKind = data.edges.map(([a, , d]) => (d ? 'derived' : data.nodes[a].k));
  const edgeBase = edgeKind.map((k) => new THREE.Color(EDGE_COLOR[k] || EDGE_COLOR.root));
  const nodeBase = data.nodes.map((p) => {
    const c = new THREE.Color(NODE_COLOR[p.k] || NODE_COLOR.word);
    return p.u ? c.lerp(bg, UNLINKED_FADE) : c;
  });
  const focusColor = new THREE.Color(FOCUS_COLOR);

  let hl: MapHighlight | null = null;
  let hover: number | null = null;
  const paintColors = () => {
    for (let i = 0; i < N; i++) {
      const id = data.nodes[i].id;
      if (hl && id === hl.focus) tmp.copy(focusColor);
      else if (!hl || hl.nodes.has(id)) tmp.copy(nodeBase[i]);
      else tmp.copy(nodeBase[i]).lerp(bg, NODE_DIM);
      mesh.setColorAt(i, tmp);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    for (let k = 0; k < E; k++) {
      const a = !hl ? (edgeKind[k] === 'derived' ? EDGE_DERIVED : EDGE_BASE) : hl.edges.has(k) ? EDGE_LIT : EDGE_DIM;
      tmp.copy(bg).lerp(edgeBase[k], a);
      col[k * 6] = col[k * 6 + 3] = tmp.r;
      col[k * 6 + 1] = col[k * 6 + 4] = tmp.g;
      col[k * 6 + 2] = col[k * 6 + 5] = tmp.b;
    }
    colAttr.needsUpdate = true;
  };
  paintColors();

  // Labels: one per morpheme, a pool for words.
  const hubLabels: Label[] = [];
  const hubLabelOf = new Map<number, Label>();
  const makeEl = (cls: string) => {
    const el = document.createElement('div');
    el.className = cls;
    el.style.display = 'none';
    layer.appendChild(el);
    return el;
  };
  for (let i = 0; i < N; i++) {
    if (!hub(i)) continue;
    const p = data.nodes[i];
    const el = makeEl(`nbv-m3-label nbv-m3-label--${p.k}`);
    el.textContent = p.l;
    el.dataset.id = p.id;
    const l: Label = { i, el, w: p.l.length * 8 + 18, h: 22, shown: false, opacity: 1 };
    hubLabels.push(l);
    hubLabelOf.set(i, l);
  }
  const pool: Label[] = [];
  for (let k = 0; k < Math.min(WORD_LABELS, N); k++) pool.push({ i: -1, el: makeEl('nbv-m3-label nbv-m3-label--word'), w: 0, h: 18, shown: false, opacity: 1 });
  // The group of unlinked words gets one name, above its middle.
  let lone: { centre: THREE.Vector3; r: number; label: Label } | null = null;
  {
    const members = data.nodes.filter((p) => p.u);
    if (members.length) {
      const q = new THREE.Vector3();
      const centre = new THREE.Vector3();
      for (const p of members) centre.add(q.set(p.x, p.y, p.z));
      centre.divideScalar(members.length);
      let r = 0;
      for (const p of members) r = Math.max(r, q.set(p.x, p.y, p.z).distanceTo(centre));
      const el = makeEl('nbv-m3-label nbv-m3-label--group');
      el.textContent = t('notebook.map.unlinked', { count: members.length });
      lone = { centre, r, label: { i: -1, el, w: el.textContent.length * 7 + 16, h: 20, shown: false, opacity: 1 } };
    }
  }
  const wordLabelOf = new Map<number, Label>();

  // Camera: an orbit around `target`.
  const target = new THREE.Vector3();
  const sph = new THREE.Spherical();
  /** The narrower of the vertical and horizontal fields of view, in radians. */
  function minFov(visible = false): number {
    const w = visible ? Math.max(80, W - insetL) : W;
    const h = visible ? Math.max(80, H - insetB) : H;
    const v = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (h / H));
    return Math.min(v, 2 * Math.atan(Math.tan(v / 2) * (w / h)));
  }
  const minDist = 12;
  const maxDist = () => R * 6;
  const place = () => {
    sph.phi = THREE.MathUtils.clamp(sph.phi, 0.05, Math.PI - 0.05);
    sph.radius = THREE.MathUtils.clamp(sph.radius, minDist, maxDist());
    camera.position.setFromSpherical(sph).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };
  const setView = (v: MapView) => {
    target.set(v.target.x, v.target.y, v.target.z);
    sph.setFromVector3(new THREE.Vector3(v.pos.x - v.target.x, v.pos.y - v.target.y, v.pos.z - v.target.z));
    place();
  };
  // The home view looks straight at the map and fits what it frames to the stage, as graph
  // viewers' "zoom to fit" does (3d-force-graph's zoomToFit, Obsidian's graph on open): the
  // nodes' extent, measured across and up the screen, fills the width and the height. Framing
  // a bounding sphere instead leaves a wide desktop stage mostly empty, with the graph a
  // cluster of dots in the middle. A few linked words far out from the rest (the farthest
  // tenth, more than a tenth beyond the others) may fall outside.
  const framed: number[] = (() => {
    const linked: number[] = [];
    const rest: number[] = [];
    data.nodes.forEach((p, i) => (hub(i) || p.u ? rest : linked).push(i));
    if (linked.length < 10) return [...linked, ...rest];
    const c = { x: 0, y: 0, z: 0 };
    for (const i of linked) {
      c.x += data.nodes[i].x / linked.length;
      c.y += data.nodes[i].y / linked.length;
      c.z += data.nodes[i].z / linked.length;
    }
    const far = linked.map((i) => Math.hypot(data.nodes[i].x - c.x, data.nodes[i].y - c.y, data.nodes[i].z - c.z));
    const sorted = [...far].sort((a, b) => a - b);
    const cut = sorted[Math.floor((sorted.length - 1) * 0.9)] * 1.1;
    return [...linked.filter((_, k) => far[k] <= cut), ...rest];
  })();
  const home = (): MapView => {
    if (!framed.length) return { pos: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 } };
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const i of framed) {
      const p = data.nodes[i];
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    // Leave room at the edges for the morphemes' labels and for the zoom buttons.
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 0.86;
    const tanH = tanV * (W / H) * (W > 520 ? 0.9 : 0.94);
    let d = minDist;
    for (const i of framed) {
      const p = data.nodes[i];
      const r = radiusOf(i);
      d = Math.max(d, (Math.abs(p.x - cx) + r) / tanH + p.z, (Math.abs(p.y - cy) + r) / tanV + p.z);
    }
    d = Math.min(d, maxDist());
    return { pos: { x: cx, y: cy, z: d }, target: { x: cx, y: cy, z: 0 } };
  };
  setView(opts.restore || home());

  // The panel covers part of the canvas. Shifting the projection window keeps the camera's
  // target in the middle of what is still visible; the shift eases in and out with the panel.
  let insetL = 0;
  let insetB = 0;
  let offX = 0;
  let offY = 0;
  const applyOffset = () => {
    camera.aspect = W / H;
    if (Math.abs(offX) < 0.5 && Math.abs(offY) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(W, H, offX, offY, W, H);
    camera.updateProjectionMatrix();
  };
  applyOffset();
  const stepOffset = (): boolean => {
    const tx = -insetL / 2;
    const ty = insetB / 2;
    if (offX === tx && offY === ty) return false;
    const k = reduced ? 1 : 0.22;
    offX = Math.abs(tx - offX) < 0.5 ? tx : offX + (tx - offX) * k;
    offY = Math.abs(ty - offY) < 0.5 ? ty : offY + (ty - offY) * k;
    applyOffset();
    return true;
  };

  // Flights: the target and the camera offset move together with an ease.
  let flight: { t0: number; ms: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromS: THREE.Spherical; toS: THREE.Spherical } | null = null;
  const flyView = (v: MapView, ms: number) => {
    const toT = new THREE.Vector3(v.target.x, v.target.y, v.target.z);
    const toS = new THREE.Spherical().setFromVector3(new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z).sub(toT));
    // Turn the short way round.
    let dTheta = toS.theta - sph.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    toS.theta = sph.theta + dTheta;
    spin.theta = 0;
    spin.phi = 0;
    if (reduced || ms <= 0) {
      target.copy(toT);
      sph.copy(toS);
      place();
      flight = null;
    } else flight = { t0: performance.now(), ms, fromT: target.clone(), toT, fromS: sph.clone(), toS };
    wake();
  };
  const stepFlight = (now: number): boolean => {
    if (!flight) return false;
    const t = Math.min(1, (now - flight.t0) / flight.ms);
    const e = ease(t);
    target.lerpVectors(flight.fromT, flight.toT, e);
    sph.radius = flight.fromS.radius + (flight.toS.radius - flight.fromS.radius) * e;
    sph.theta = flight.fromS.theta + (flight.toS.theta - flight.fromS.theta) * e;
    sph.phi = flight.fromS.phi + (flight.toS.phi - flight.fromS.phi) * e;
    place();
    if (t >= 1) flight = null;
    return true;
  };

  // A drag that ends with the pointer still moving keeps turning for a moment, at the speed of
  // its last 80 ms. A pointer held still before it lifts leaves the map where it is.
  const spin = { theta: 0, phi: 0 };
  const turns: { t: number; theta: number; phi: number }[] = [];
  const RELEASE_MS = 80;
  const releaseSpin = () => {
    const now = performance.now();
    const recent = turns.filter((x) => now - x.t <= RELEASE_MS);
    turns.length = 0;
    spin.theta = 0;
    spin.phi = 0;
    if (recent.length < 2) return;
    const span = Math.max(16, now - recent[0].t);
    // Per frame of about 16 ms.
    spin.theta = (recent.reduce((s, x) => s + x.theta, 0) / span) * 16;
    spin.phi = (recent.reduce((s, x) => s + x.phi, 0) / span) * 16;
  };
  const stepSpin = (): boolean => {
    if (reduced || (Math.abs(spin.theta) < 1e-4 && Math.abs(spin.phi) < 1e-4) || pointers.size) return false;
    sph.theta += spin.theta;
    sph.phi += spin.phi;
    spin.theta *= 0.88;
    spin.phi *= 0.88;
    place();
    return true;
  };

  /* ---------------------------------------------------------------- input */

  interface Ptr {
    x: number;
    y: number;
    x0: number;
    y0: number;
    t0: number;
    type: string;
    button: number;
    target: EventTarget | null;
  }
  const pointers = new Map<number, Ptr>();
  let dragging = false;
  let mode: 'rotate' | 'pan' | 'dolly' = 'rotate';
  let pair: { d: number; a: number; mx: number; my: number } | null = null;

  const rect = () => stage.getBoundingClientRect();
  // As in OrbitControls with rotateSpeed 1: a drag across the height of the map is a full turn.
  const turnPerPx = () => (2 * Math.PI) / Math.max(200, H);
  const rotateBy = (dx: number, dy: number) => {
    const k = turnPerPx();
    sph.theta -= dx * k;
    sph.phi -= dy * k;
    turns.push({ t: performance.now(), theta: -dx * k, phi: -dy * k });
    if (turns.length > 30) turns.shift();
    place();
  };
  const panBy = (dx: number, dy: number) => {
    const scale = (2 * sph.radius * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / H;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    place();
  };
  const dollyBy = (factor: number) => {
    sph.radius *= factor;
    place();
  };
  const pairOf = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  const onDown = (ev: PointerEvent) => {
    if (ev.button > 2) return;
    // The buttons and the panel above the canvas handle their own presses.
    if ((ev.target as HTMLElement | null)?.closest?.('.nbv-map__ctrl, .nbv-map__panel')) return;
    flight = null;
    spin.theta = 0;
    spin.phi = 0;
    turns.length = 0;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, t0: performance.now(), type: ev.pointerType, button: ev.button, target: ev.target });
    try {
      stage.setPointerCapture(ev.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    if (pointers.size === 1) {
      dragging = false;
      mode = ev.button === 2 || ev.shiftKey || ev.ctrlKey || ev.metaKey ? 'pan' : ev.button === 1 ? 'dolly' : 'rotate';
    } else if (pointers.size === 2) {
      dragging = true;
      pair = pairOf();
    }
    wake();
  };
  const onMove = (ev: PointerEvent) => {
    const p = pointers.get(ev.pointerId);
    if (!p) {
      if (ev.pointerType === 'mouse' && !ev.buttons) hoverAt(ev.clientX, ev.clientY, ev.target);
      return;
    }
    const dx = ev.clientX - p.x;
    const dy = ev.clientY - p.y;
    p.x = ev.clientX;
    p.y = ev.clientY;
    if (pointers.size === 1) {
      const slop = p.type === 'mouse' ? TAP_SLOP.mouse : TAP_SLOP.touch;
      if (!dragging && Math.hypot(p.x - p.x0, p.y - p.y0) < slop) return;
      if (!dragging) {
        dragging = true;
        setHover(null);
      }
      if (mode === 'pan') panBy(dx, dy);
      else if (mode === 'dolly') dollyBy(Math.exp(dy * 0.01));
      else rotateBy(dx, dy);
    } else if (pointers.size === 2 && pair) {
      const now = pairOf();
      if (now.d > 0 && pair.d > 0) dollyBy(pair.d / now.d);
      let da = now.a - pair.a;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      sph.theta -= da;
      // Both fingers moving together carry the map with them.
      panBy(now.mx - pair.mx, now.my - pair.my);
      pair = now;
    }
    wake();
  };
  const onUp = (ev: PointerEvent) => {
    const p = pointers.get(ev.pointerId);
    if (!p) return;
    pointers.delete(ev.pointerId);
    try {
      stage.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
    if (pointers.size === 1) {
      // From two fingers back to one: carry on turning from where the remaining finger is.
      const rest = [...pointers.values()][0];
      rest.x0 = rest.x;
      rest.y0 = rest.y;
      pair = null;
      mode = 'rotate';
      turns.length = 0;
      return;
    }
    if (pointers.size) return;
    pair = null;
    const tap = !dragging && ev.type === 'pointerup' && performance.now() - p.t0 < TAP_MS && p.button === 0;
    if (dragging && mode === 'rotate') releaseSpin();
    else {
      turns.length = 0;
      spin.theta = 0;
      spin.phi = 0;
    }
    dragging = false;
    if (tap) opts.onPick(pickAt(p.x, p.y, p.target, p.type !== 'mouse'));
    wake();
  };
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    flight = null;
    // Lines and pages from a mouse wheel, pixels from a trackpad; a pinch arrives with ctrlKey.
    const px = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaMode === 2 ? ev.deltaY * H : ev.deltaY;
    dollyBy(Math.exp(THREE.MathUtils.clamp(px, -200, 200) * (ev.ctrlKey ? 0.01 : 0.0015)));
    wake();
  };
  const onContext = (ev: Event) => ev.preventDefault();
  const onLeave = () => setHover(null);
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('pointerleave', onLeave);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', onContext);

  /** The node under a point: a label if the press landed on one, else the nearest drawn node. */
  const v = new THREE.Vector3();
  function pickAt(clientX: number, clientY: number, el: EventTarget | null, touch: boolean): string | null {
    const id = ((el as HTMLElement | null)?.closest?.('[data-id]') as HTMLElement | null)?.dataset.id;
    if (id && byId.has(id)) return id;
    const r = rect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const reach = touch ? 22 : 12;
    let best = -1;
    let bestD = Infinity;
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / H;
    for (let i = 0; i < N; i++) {
      const p = data.nodes[i];
      v.set(p.x, p.y, p.z);
      const dist = v.distanceTo(camera.position);
      v.project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = ((v.x + 1) / 2) * W;
      const sy = ((1 - v.y) / 2) * H;
      const d = Math.hypot(sx - x, sy - y);
      const size = radiusOf(i) / (dist * perPx);
      if (d > Math.max(reach, size + 4)) continue;
      // Nearer to the pointer wins; between two equally near, the one nearer the camera.
      const score = d + dist * 0.001;
      if (score < bestD) {
        bestD = score;
        best = i;
      }
    }
    return best >= 0 ? data.nodes[best].id : null;
  }
  let hoverRaf = 0;
  function hoverAt(clientX: number, clientY: number, el: EventTarget | null) {
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (disposed) return;
      const id = pickAt(clientX, clientY, el, false);
      setHover(id ? byId.get(id)! : null);
    });
  }
  function setHover(i: number | null) {
    if (i === hover) return;
    hover = i;
    stage.style.cursor = i !== null ? 'pointer' : '';
    dirty = true;
    wake();
  }

  /* ------------------------------------------------------------- labels */

  /** `r`: the node's drawn radius in pixels, so a word's label starts beside its ball. */
  const cands: { i: number; pri: number; d: number; sx: number; sy: number; r: number }[] = [];
  const cull = () => {
    const camDist = camera.position.distanceTo(target);
    const fog = scene.fog as THREE.Fog;
    fog.near = Math.max(1, camDist - R * 0.2);
    fog.far = camDist + R * 1.7;
    const near = Math.max(55, camDist * 0.7);
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / H;
    const focus = hl?.focus ?? null;
    cands.length = 0;
    for (let i = 0; i < N; i++) {
      const p = data.nodes[i];
      const isHub = hub(i);
      // Words far from the camera and outside the focus never get a label: skip the projection.
      if (!isHub && i !== hover && p.id !== focus && !(hl && hl.nodes.has(p.id))) {
        if (p.u) continue;
        const dx = p.x - camera.position.x;
        const dy = p.y - camera.position.y;
        const dz = p.z - camera.position.z;
        if (dx * dx + dy * dy + dz * dz > near * near) continue;
      }
      v.set(p.x, p.y, p.z);
      const d = v.distanceTo(camera.position);
      v.project(camera);
      if (!(v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15)) continue;
      let pri = 9;
      if (p.id === focus || i === hover) pri = 0;
      else if (isHub) pri = hl ? (hl.nodes.has(p.id) ? 2 : 3) : 1;
      else if (hl) pri = hl.nodes.has(p.id) ? 2 : 9;
      // An unlinked word is named only when pointed at or focused, so its group stays quiet.
      else if (d < near && !p.u) pri = 4;
      if (pri === 9) continue;
      cands.push({ i, pri, d, sx: ((v.x + 1) / 2) * W, sy: ((1 - v.y) / 2) * H, r: radiusOf(i) / (Math.max(1, d) * perPx) });
    }
    // Within a rank, larger morphemes first, then nearer nodes.
    cands.sort((a, b) => a.pri - b.pri || data.nodes[b.i].n - data.nodes[a.i].n || a.d - b.d);
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
    const hubShown = new Set<number>();
    const words: { c: (typeof cands)[number]; faint: boolean }[] = [];
    if (lone) {
      // The caption sits just above the group as drawn, however the map is turned, so it never
      // lies across the points.
      v.copy(lone.centre);
      const d = v.distanceTo(camera.position);
      v.project(camera);
      const above = lone.r / (Math.max(1, d) * ((2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / H)) + lone.label.h / 2 + 4;
      if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
        const sx = ((v.x + 1) / 2) * W;
        const sy = Math.max(lone.label.h / 2 + 2, ((1 - v.y) / 2) * H - above);
        const { w, h } = lone.label;
        cells(sx - w / 2, sy - h / 2, sx + w / 2, sy + h / 2, (k) => {
          const list = grid.get(k);
          const r = [sx - w / 2, sy - h / 2, sx + w / 2, sy + h / 2];
          if (list) list.push(r);
          else grid.set(k, [r]);
        });
        const depth = Math.min(1, Math.max(0.45, 1.15 - Math.max(0, d - camDist) / (R * 1.4)));
        showLabel(lone.label, sx, sy, true, depth * (hl ? 0.4 : 1));
      } else hideLabel(lone.label);
    }
    for (const c of cands) {
      const isHub = hub(c.i);
      if (!isHub && words.length >= pool.length) continue;
      const p = data.nodes[c.i];
      const w = isHub ? p.l.length * 8 + 18 : p.l.length * 7.2 + 8;
      const h = isHub ? 22 : 18;
      const x0 = isHub ? c.sx - w / 2 : c.sx + c.r + 4;
      const y0 = c.sy - h / 2;
      const x1 = x0 + w;
      const y1 = y0 + h;
      const hit = cells(x0, y0, x1, y1, (k) => (grid.get(k) || []).some((r) => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]));
      // A label that lands on one already placed gives way, except the focused word and the
      // hovered node. A morpheme in the focus turns faint instead, so its name stays readable.
      if (hit && c.pri > 0 && !(isHub && c.pri === 2)) continue;
      cells(x0, y0, x1, y1, (k) => {
        const list = grid.get(k);
        if (list) list.push([x0, y0, x1, y1]);
        else grid.set(k, [[x0, y0, x1, y1]]);
      });
      const faint = (!!hl && !hl.nodes.has(p.id)) || (hit && c.pri > 0);
      if (isHub) {
        hubShown.add(c.i);
        const l = hubLabelOf.get(c.i)!;
        // Morphemes behind the centre of view fade, which reads as depth.
        const depth = Math.min(1, Math.max(0.45, 1.15 - Math.max(0, c.d - camDist) / (R * 1.4)));
        showLabel(l, c.sx, c.sy, true, depth * (faint ? 0.3 : 1));
      } else words.push({ c, faint });
    }
    for (const l of hubLabels) if (!hubShown.has(l.i)) hideLabel(l);
    // Words: keep a pooled element on the word it already shows, so labels do not flicker.
    const want = new Set(words.map((x) => x.c.i));
    for (const [i, l] of wordLabelOf) {
      if (!want.has(i)) {
        wordLabelOf.delete(i);
        hideLabel(l);
        l.i = -1;
      }
    }
    const free = pool.filter((l) => l.i < 0);
    for (const { c } of words) {
      let l = wordLabelOf.get(c.i);
      if (!l) {
        l = free.pop();
        if (!l) break;
        const p = data.nodes[c.i];
        l.i = c.i;
        l.el.textContent = p.l;
        l.el.dataset.id = p.id;
        wordLabelOf.set(c.i, l);
      }
      const id = data.nodes[c.i].id;
      l.el.classList.toggle('is-focus', !!hl && id === hl.focus);
      l.el.classList.toggle('is-lit', !!hl && hl.nodes.has(id));
      showLabel(l, c.sx + c.r, c.sy, false, 1);
    }
  };
  function showLabel(l: Label, x: number, y: number, centred: boolean, opacity: number) {
    if (!l.shown) {
      l.shown = true;
      l.el.style.display = '';
    }
    l.el.style.transform = centred
      ? `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`
      : `translate(${(x + 4).toFixed(1)}px, ${y.toFixed(1)}px) translateY(-50%)`;
    if (Math.abs(opacity - l.opacity) > 0.04) {
      l.opacity = opacity;
      l.el.style.opacity = opacity.toFixed(2);
    }
  }
  function hideLabel(l: Label) {
    if (!l.shown) return;
    l.shown = false;
    l.el.style.display = 'none';
  }

  /* --------------------------------------------------------------- frames */

  let raf = 0;
  let dirty = true;
  let disposed = false;
  let hidden = false;
  let lastKey = '';
  function wake() {
    dirty = true;
    if (!raf && !disposed && !hidden) raf = requestAnimationFrame(frame);
  }
  function frame(now: number) {
    raf = 0;
    if (disposed) return;
    if (!stage.isConnected) {
      onDetached();
      return;
    }
    let moving = stepFlight(now);
    moving = stepSpin() || moving;
    moving = stepOffset() || moving;
    const key = `${camera.matrixWorld.elements.map((x) => x.toFixed(2)).join(',')}|${W}x${H}|${offX.toFixed(1)},${offY.toFixed(1)}`;
    if (dirty || key !== lastKey) {
      lastKey = key;
      dirty = false;
      renderer.render(scene, camera);
      cull();
    }
    if (moving) raf = requestAnimationFrame(frame);
  }
  wake();

  const ro = new ResizeObserver(() => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    hidden = !w || !h;
    if (hidden) return;
    if (w !== W || h !== H || renderer.getPixelRatio() !== ratio()) {
      W = w;
      H = h;
      renderer.setPixelRatio(ratio());
      renderer.setSize(W, H);
      applyOffset();
    }
    wake();
  });
  ro.observe(stage);
  // Shells that replace the map without telling it: notice within a second and let go.
  const watch = window.setInterval(() => {
    if (!stage.isConnected) onDetached();
  }, 1000);

  const flyTo = (id: string) => {
    const i = byId.get(id);
    if (i === undefined) return;
    // Frame the node with its direct neighbours: a word with its morphemes, a morpheme with
    // its words. The camera aims between the node and them, the node counting double.
    const n = data.nodes[i];
    const near = data.edges.filter(([a, b]) => a === i || b === i).map(([a, b]) => data.nodes[a === i ? b : a]);
    const c = new THREE.Vector3(n.x * 2, n.y * 2, n.z * 2);
    for (const q of near) c.add(new THREE.Vector3(q.x, q.y, q.z));
    c.divideScalar(near.length + 2);
    let extent = 12;
    for (const q of [n, ...near]) extent = Math.max(extent, Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z));
    let dist = THREE.MathUtils.clamp((extent / Math.tan(minFov(true) / 2)) * 1.25, 40, R * 3);
    const from = new THREE.Vector3().subVectors(camera.position, c);
    // An unlinked word is seen from outside its group, looking in, so the camera does not end
    // up among the other points.
    if (n.u && lone) {
      const out = new THREE.Vector3(n.x, n.y, n.z).sub(lone.centre);
      if (out.lengthSq() > 1) from.copy(out);
      dist = Math.max(dist, lone.r + 55 - out.length());
    }
    if (from.lengthSq() < 1) from.set(0, 0, 1);
    from.setLength(dist);
    flyView({ pos: { x: c.x + from.x, y: c.y + from.y, z: c.z + from.z }, target: { x: c.x, y: c.y, z: c.z } }, 900);
  };

  return {
    highlight(h, fly) {
      hl = h;
      paintColors();
      for (const l of hubLabels) {
        const id = data.nodes[l.i].id;
        l.el.classList.toggle('is-focus', !!h && id === h.focus);
        l.el.classList.toggle('is-lit', !!h && h.nodes.has(id));
      }
      if (fly && h?.focus) flyTo(h.focus);
      wake();
    },
    inset(left, bottom) {
      insetL = Math.max(0, Math.min(W * 0.6, left));
      insetB = Math.max(0, Math.min(H * 0.6, bottom));
      wake();
    },
    zoom(dir) {
      const off = new THREE.Vector3().subVectors(camera.position, target);
      off.setLength(THREE.MathUtils.clamp(off.length() * (dir === 'in' ? 0.7 : 1.4), minDist, maxDist()));
      flyView({ pos: { x: target.x + off.x, y: target.y + off.y, z: target.z + off.z }, target: { x: target.x, y: target.y, z: target.z } }, 300);
    },
    reset() {
      flyView(home(), 700);
    },
    view(): MapView | null {
      return { pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, target: { x: target.x, y: target.y, z: target.z } };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(hoverRaf);
      clearInterval(watch);
      dprQuery?.removeEventListener('change', onDpr);
      ro.disconnect();
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('contextmenu', onContext);
      sphere.dispose();
      nodeMat.dispose();
      mesh.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.innerHTML = '';
      stage.style.cursor = '';
    },
  };
}
