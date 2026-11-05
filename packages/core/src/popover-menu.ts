/**
 * A small menu that opens from a button, shared by the desktop window, the desktop lookup window
 * and the phone: a word book's actions (Export, Export for Anki, Remove) and the list of your own
 * books a word can be added to. It follows Material's menus: it opens under its button (above it
 * when there is no room below), and on a phone-width screen it opens as a sheet from the bottom.
 * Escape, a tap outside or choosing an item closes it, and the arrow keys move between items.
 *
 * A plain menu closes before `onPick` runs. A checkbox menu (`multi`) stays open: each pick
 * flips the item's tick at once and `onPick` saves it, as YouTube's "Save to playlist" does.
 */
export interface MenuItem {
  label: string;
  /** Handed back to `onPick`, with `data`. */
  act: string;
  data?: Record<string, string>;
  /** A checkbox item: ticked or not. */
  checked?: boolean;
  /** Destructive: drawn in the warning colour. */
  danger?: boolean;
}

export interface MenuOptions {
  label: string;
  items: MenuItem[];
  multi?: boolean;
  /** Force the bottom sheet on or off; by default it follows the window's width. */
  sheet?: boolean;
  onPick: (item: MenuItem) => void | Promise<void>;
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/** Below this width the menu is a bottom sheet. */
const SHEET_BELOW = 600;

let closeCurrent: (() => void) | null = null;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function itemHtml(it: MenuItem, i: number, multi: boolean): string {
  const role = multi ? 'menuitemcheckbox' : 'menuitem';
  const checked = multi ? ` aria-checked="${!!it.checked}"` : '';
  return `<button type="button" role="${role}"${checked} class="pv-menu__item${it.danger ? ' is-danger' : ''}" data-i="${i}">${
    multi ? `<span class="pv-menu__tick">${CHECK}</span>` : ''
  }<span class="pv-menu__label">${esc(it.label)}</span></button>`;
}

/** Whether a menu opened by `openMenu` is showing. */
export function menuOpen(): boolean {
  return !!closeCurrent;
}

/** Closes the open menu, if any. */
export function closeMenu(): void {
  closeCurrent?.();
}

/** Opens a menu from `anchor`. Returns a function that closes it. */
export function openMenu(anchor: HTMLElement, opts: MenuOptions): () => void {
  closeCurrent?.();
  const doc = anchor.ownerDocument;
  const win = doc.defaultView || window;
  const multi = !!opts.multi;
  const sheet = opts.sheet ?? win.innerWidth < SHEET_BELOW;
  const scrim = doc.createElement('div');
  scrim.className = `nbv pv-menu-scrim${sheet ? ' is-sheet' : ''}`;
  const menu = doc.createElement('div');
  menu.className = `pv-menu${sheet ? ' is-sheet' : ''}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', opts.label);
  const paint = () => {
    menu.innerHTML = `${sheet ? `<p class="pv-menu__title">${esc(opts.label)}</p>` : ''}${opts.items.map((it, i) => itemHtml(it, i, multi)).join('')}`;
  };
  paint();
  scrim.appendChild(menu);
  doc.body.appendChild(scrim);
  anchor.setAttribute('aria-expanded', 'true');

  if (!sheet) {
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, win.innerWidth - w - 8));
    const below = r.bottom + 4 + h <= win.innerHeight - 8;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(below ? r.bottom + 4 : Math.max(8, r.top - 4 - h))}px`;
  }

  const items = () => [...menu.querySelectorAll<HTMLElement>('.pv-menu__item')];
  const focusAt = (i: number) => items()[i]?.focus({ preventScroll: true });
  focusAt(0);

  const close = () => {
    if (closeCurrent !== close) return;
    closeCurrent = null;
    scrim.remove();
    doc.removeEventListener('keydown', onKey, true);
    anchor.setAttribute('aria-expanded', 'false');
    if (anchor.isConnected) anchor.focus({ preventScroll: true });
  };
  const onKey = (ev: KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(doc.activeElement as HTMLElement);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      focusAt((at + (ev.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
    } else if (ev.key === 'Tab') close();
  };
  doc.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', (ev) => {
    // The menu's own clicks stay inside it; the shells' click handlers never see them.
    ev.stopPropagation();
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('.pv-menu__item');
    if (!btn) {
      if (!menu.contains(ev.target as Node)) close();
      return;
    }
    const item = opts.items[Number(btn.dataset.i)];
    if (!item) return;
    if (!multi) {
      close();
      void opts.onPick(item);
      return;
    }
    item.checked = !item.checked;
    btn.setAttribute('aria-checked', String(item.checked));
    void Promise.resolve(opts.onPick(item)).catch(() => {
      // Saving failed: the tick goes back.
      item.checked = !item.checked;
      btn.setAttribute('aria-checked', String(item.checked));
    });
  });
  closeCurrent = close;
  return close;
}
