/**
 * Zoom and pan for a picture shown large (the sense picture viewer, desktop pop-up and phone), as
 * photo viewers such as PhotoSwipe and Google Photos do: the wheel or a pinch zooms around the
 * pointer, a double click or double tap toggles between fit and 2.5×, a drag pans a zoomed
 * picture, and + / − / 0 zoom from the keyboard. The picture never zooms out past fit and never
 * pans off its frame, which clips it (`.pic-view__stage`, overflow hidden).
 *
 * The host keeps its own click handling; `gestured()` says whether the last press was a drag,
 * pinch or double tap, so a click that ends one does not also close the viewer.
 */
const DOUBLE_ZOOM = 2.5;
const DOUBLE_MS = 300;
const MOVE_PX = 4;

export interface PictureZoom {
  /** The scale now; 1 is fit. */
  scale(): number;
  /** The last press panned, pinched or double-tapped. */
  gestured(): boolean;
  reset(): void;
}

export function wirePictureZoom(img: HTMLElement, opts: { max?: number } = {}): PictureZoom {
  const max = opts.max ?? 6;
  let s = 1;
  let tx = 0;
  let ty = 0;
  let moved = false;
  let lastTap = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; s: number } | null = null;
  img.style.transformOrigin = '0 0';
  img.style.touchAction = 'none';
  img.style.willChange = 'transform';

  const box = () => {
    // The untransformed box: the transform scales from the top left corner and then moves it.
    const r = img.getBoundingClientRect();
    return { left: r.left - tx, top: r.top - ty, w: r.width / s, h: r.height / s };
  };
  const paint = () => {
    img.style.transform = s === 1 ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
    img.style.cursor = s > 1 ? 'grab' : 'zoom-in';
    img.classList.toggle('is-zoomed', s > 1);
  };
  const clamp = (w: number, h: number) => {
    tx = Math.min(0, Math.max(w - w * s, tx));
    ty = Math.min(0, Math.max(h - h * s, ty));
  };
  /** Zoom to `next`, keeping the picture's point under (cx, cy) where it is. */
  const zoomAt = (next: number, cx: number, cy: number) => {
    const b = box();
    const to = Math.min(max, Math.max(1, next));
    const px = cx - b.left;
    const py = cy - b.top;
    tx = px - ((px - tx) / s) * to;
    ty = py - ((py - ty) / s) * to;
    s = to;
    if (s === 1) tx = ty = 0;
    clamp(b.w, b.h);
    paint();
  };
  const centre = () => {
    const r = img.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  img.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(s * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
    },
    { passive: false },
  );
  img.addEventListener('dblclick', (e) => {
    e.preventDefault();
    moved = true;
    zoomAt(s > 1 ? 1 : DOUBLE_ZOOM, e.clientX, e.clientY);
  });
  img.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    img.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      moved = false;
      // A double tap on a touch screen; a mouse has dblclick.
      if (e.pointerType !== 'mouse') {
        const now = Date.now();
        if (now - lastTap < DOUBLE_MS) {
          moved = true;
          lastTap = 0;
          zoomAt(s > 1 ? 1 : DOUBLE_ZOOM, e.clientX, e.clientY);
        } else lastTap = now;
      }
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s };
      moved = true;
    }
  });
  img.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      zoomAt(pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 0 && s > 1) {
      const b = box();
      tx += dx;
      ty += dy;
      clamp(b.w, b.h);
      paint();
      img.style.cursor = 'grabbing';
    }
    if (Math.abs(dx) > MOVE_PX || Math.abs(dy) > MOVE_PX) moved = true;
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) paint();
  };
  img.addEventListener('pointerup', up);
  img.addEventListener('pointercancel', up);
  // The viewer's own keys: zoom about the centre, 0 back to fit.
  img.addEventListener('keydown', (e) => {
    const c = centre();
    if (e.key === '+' || e.key === '=') zoomAt(s * 1.5, c.x, c.y);
    else if (e.key === '-' || e.key === '_') zoomAt(s / 1.5, c.x, c.y);
    else if (e.key === '0') zoomAt(1, c.x, c.y);
    else return;
    e.preventDefault();
  });
  paint();

  return {
    scale: () => s,
    gestured: () => moved,
    reset: () => {
      s = 1;
      tx = ty = 0;
      paint();
    },
  };
}
