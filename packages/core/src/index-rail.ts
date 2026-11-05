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
