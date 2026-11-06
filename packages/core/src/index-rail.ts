/**
 * The index rails beside the Words list (A to Z, and the date rail on desktop), shared by the
 * desktop window and the phone. They behave like the section index in iOS Contacts and the
 * fast-scroll thumb on Android: a click or tap on an entry jumps to it, and pressing and dragging
 * along the rail scrubs through the entries. Moving the pointer over the rail without pressing
 * does nothing, so the list never jumps under a passing mouse.
 *
 * Entries are the rail's `[data-letter]` children; `jump` receives the entry's `data-letter`.
 * `hud`, when given, is told the entry under the finger while dragging, and `null` when the drag
 * ends, so a shell can show a large letter in the middle of the screen.
 */
export interface IndexRailOptions {
  jump: (key: string) => void;
  hud?: (key: string | null) => void;
}

/** How far the pointer must travel while pressed before a press becomes a drag. */
const DRAG_PX = 6;

export function wireIndexRail(nav: HTMLElement, opts: IndexRailOptions): void {
  const entries = () => [...nav.querySelectorAll<HTMLElement>('[data-letter]')];
  const keyAt = (y: number): string | null => {
    const list = entries();
    if (!list.length) return null;
    const r = nav.getBoundingClientRect();
    const i = Math.max(0, Math.min(list.length - 1, Math.floor(((y - r.top) / Math.max(r.height, 1)) * list.length)));
    return list[i].dataset.letter || null;
  };
  let press: { id: number; y: number; key: string | null } | null = null;
  let dragging = false;
  let last = '';
  const end = () => {
    if (dragging) opts.hud?.(null);
    press = null;
    dragging = false;
    last = '';
  };
  nav.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const hit = (ev.target as HTMLElement).closest?.<HTMLElement>('[data-letter]');
    press = { id: ev.pointerId, y: ev.clientY, key: hit?.dataset.letter || keyAt(ev.clientY) };
    dragging = false;
    try {
      nav.setPointerCapture(ev.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    // No text selection or focus ring from a press on the rail.
    ev.preventDefault();
  });
  nav.addEventListener('pointermove', (ev) => {
    if (!press || ev.pointerId !== press.id) return;
    // A button released outside the window never sent pointerup.
    if (ev.buttons === 0) {
      end();
      return;
    }
    if (!dragging && Math.abs(ev.clientY - press.y) < DRAG_PX) return;
    dragging = true;
    const key = keyAt(ev.clientY);
    if (!key || key === last) return;
    last = key;
    opts.hud?.(key);
    opts.jump(key);
  });
  nav.addEventListener('pointerup', (ev) => {
    if (!press || ev.pointerId !== press.id) return;
    const tap = !dragging ? press.key : null;
    end();
    if (tap) opts.jump(tap);
  });
  nav.addEventListener('pointercancel', end);
  nav.addEventListener('lostpointercapture', () => {
    if (press && !dragging) return; // pointerup follows and handles the tap
    end();
  });
  // Keyboard and screen readers press the button itself; a pointer click was handled above.
  nav.addEventListener('click', (ev) => {
    if ((ev as MouseEvent).detail !== 0) return;
    const key = (ev.target as HTMLElement).closest?.<HTMLElement>('[data-letter]')?.dataset.letter;
    if (key) opts.jump(key);
  });
}

/** Top and bottom edges in viewport pixels. */
export interface RailEdges {
  top: number;
  bottom: number;
}

/**
 * Where a rail goes: inside the list's box on screen, cut by whatever covers the window above
 * (a sticky header) and below (a status bar or tab bar), with a small inset. Null when the list
 * is not laid out or too little of it shows to hold a rail.
 */
export function railBox(list: RailEdges, clip: RailEdges, inset = 8, min = 96): { top: number; height: number } | null {
  if (!(list.bottom > list.top)) return null;
  const top = Math.max(list.top, clip.top) + inset;
  const bottom = Math.min(list.bottom, clip.bottom) - inset;
  if (bottom - top < min) return null;
  return { top: Math.round(top), height: Math.round(bottom - top) };
}

/** Show every n-th entry so the shown ones fit the height; 1 when all of them fit. */
export function railStride(count: number, height: number, rowPx: number): number {
  if (count <= 0 || height <= 0) return 1;
  const fit = Math.max(1, Math.floor(height / Math.max(rowPx, 1)));
  return Math.max(1, Math.ceil(count / fit));
}

export interface RailPlacement {
  /** The list the rail indexes. */
  list: () => HTMLElement | null;
  /** The band of the window not covered by headers above or bars below. */
  clip: () => RailEdges;
}

/** The height an entry needs, with a little air, from the first entry as it renders. */
function entryPx(entries: HTMLElement[]): number {
  const h = entries[0]?.getBoundingClientRect().height || 0;
  return h > 0 ? h + 4 : 14;
}

/**
 * Fit a fixed rail to its list as it is on screen now. A rail with more entries than fit shows
 * every n-th one, as the iOS section index folds letters on a short screen; dragging along the
 * rail still reaches every entry.
 */
export function placeIndexRail(nav: HTMLElement, opts: RailPlacement): void {
  if (nav.hidden || !nav.isConnected) return;
  const list = opts.list();
  const rect = list?.isConnected ? list.getBoundingClientRect() : null;
  const box = rect ? railBox({ top: rect.top, bottom: rect.bottom }, opts.clip()) : null;
  if (!box) {
    nav.style.visibility = 'hidden';
    return;
  }
  nav.style.visibility = '';
  nav.style.top = `${box.top}px`;
  nav.style.bottom = 'auto';
  nav.style.height = `${box.height}px`;
  const entries = [...nav.querySelectorAll<HTMLElement>('[data-letter]')];
  const stride = railStride(entries.length, box.height, entryPx(entries));
  entries.forEach((e, i) => {
    e.hidden = stride > 1 && i % stride !== 0;
  });
}

/**
 * Keep a rail fitted while anything that moves its list changes: the list's own size, headers
 * above it growing (a row of books, fonts arriving late), the window, a tab becoming visible,
 * and scrolling. Measuring once at render time misses all of these, because the list may not be
 * laid out yet. `place` re-fits on demand, for example after the rail's entries change; `stop`
 * disconnects everything.
 */
export function followIndexRail(
  nav: HTMLElement,
  opts: RailPlacement & { watch: Array<Element | null | undefined>; scroller?: EventTarget },
): { place: () => void; stop: () => void } {
  let frame = 0;
  const run = () => {
    frame = 0;
    placeIndexRail(nav, opts);
  };
  const place = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
  for (const el of opts.watch) if (el) observer?.observe(el);
  const scroller = opts.scroller || window;
  scroller.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', place);
  const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  fonts?.addEventListener?.('loadingdone', place);
  void fonts?.ready?.then(place);
  place();
  return {
    place,
    stop: () => {
      observer?.disconnect();
      scroller.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
      fonts?.removeEventListener?.('loadingdone', place);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
