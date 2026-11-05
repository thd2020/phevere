/**
 * A styled menu in place of a native <select> on a Settings page, as a select-only combobox
 * (WAI-ARIA APG): a button that shows the chosen option, and a listbox that opens under it.
 *
 * The native select stays in the page, hidden, and remains the source of truth. Code that sets
 * select.value or rewrites its options keeps working, and a choice made in the menu sets the
 * select and fires its change event. Styles: settings-kit.css (.sv-menu-btn, .sv-menu).
 *
 * Keys: Enter, Space, Alt+Down or the arrows open it. In the list, the arrows, Home, End,
 * Page Up and Page Down move, typing jumps to a matching option, Enter or Space chooses,
 * Tab chooses and moves on, Escape closes without choosing.
 */

const CHECK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let menuSeq = 0;

export function enhanceSelect(select: HTMLSelectElement): void {
  if (select.dataset.menu === 'on') return;
  select.dataset.menu = 'on';
  const host = (select.closest('.sv-page') as HTMLElement | null) || (select.closest('.sv') as HTMLElement | null) || document.body;
  const id = select.id || `sv-menu-${++menuSeq}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sv-menu-btn';
  button.id = `${id}-menu`;
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<span class="sv-menu-btn__value"></span>';
  const valueEl = button.firstElementChild as HTMLElement;
  const label = select.id ? (document.querySelector(`label[for="${select.id}"]`) as HTMLLabelElement | null) : null;
  if (label) {
    if (!label.id) label.id = `${id}-label`;
    button.setAttribute('aria-labelledby', `${label.id} ${button.id}`);
    // The label points at the hidden select; send its clicks to the button.
    label.addEventListener('click', (e) => {
      e.preventDefault();
      button.focus();
    });
  } else if (select.getAttribute('aria-label')) {
    button.setAttribute('aria-label', select.getAttribute('aria-label') || '');
  }
  select.hidden = true;
  select.tabIndex = -1;
  select.insertAdjacentElement('afterend', button);

  const list = document.createElement('div');
  list.className = 'sv-menu';
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  list.hidden = true;
  if (label) list.setAttribute('aria-labelledby', label.id);
  button.setAttribute('aria-controls', list.id);
  host.appendChild(list);

  let active = -1;
  let typed = '';
  let typedAt = 0;

  const options = () => Array.from(select.options).filter((o) => !o.hidden && !o.disabled);
  const paintButton = () => {
    const chosen = select.selectedOptions[0];
    valueEl.textContent = chosen ? chosen.textContent || '' : '';
    button.disabled = select.disabled;
  };
  const paintList = () => {
    const opts = options();
    list.innerHTML = opts
      .map((o, i) => {
        const on = o.value === select.value;
        return `<div class="sv-menu__item${on ? ' is-on' : ''}" role="option" id="${list.id}-${i}" aria-selected="${on}" data-index="${i}"><span class="sv-menu__check">${on ? CHECK : ''}</span><span class="sv-menu__text"></span></div>`;
      })
      .join('');
    list.querySelectorAll<HTMLElement>('.sv-menu__text').forEach((el, i) => (el.textContent = opts[i].textContent || ''));
  };
  const setActive = (i: number) => {
    const items = list.querySelectorAll<HTMLElement>('.sv-menu__item');
    if (!items.length) return;
    active = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((el, j) => el.classList.toggle('is-active', j === active));
    const el = items[active];
    list.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  };
  const place = () => {
    const r = button.getBoundingClientRect();
    const room = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    list.style.minWidth = `${Math.round(r.width)}px`;
    list.style.maxHeight = '';
    const height = Math.min(list.scrollHeight, 288);
    const up = height > room && above > room;
    const max = Math.max(120, Math.min(288, up ? above : room));
    list.style.maxHeight = `${max}px`;
    const shown = Math.min(height, max);
    const width = list.offsetWidth;
    list.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8)))}px`;
    // In a very short window the list may cover the button rather than run off the edge.
    const top = up ? r.top - 4 - shown : r.bottom + 4;
    list.style.top = `${Math.round(Math.max(8, Math.min(top, window.innerHeight - shown - 8)))}px`;
    list.classList.toggle('is-up', up);
  };
  const isOpen = () => !list.hidden;
  const open = () => {
    if (isOpen() || select.disabled) return;
    paintList();
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    const opts = options();
    setActive(Math.max(0, opts.findIndex((o) => o.value === select.value)));
    list.focus({ preventScroll: true });
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onAway);
    window.addEventListener('blur', onAway);
    document.addEventListener('scroll', onScroll, true);
    // A page still sliding in moves a fixed list with it; place it again when that animation ends.
    document.addEventListener('animationend', onSettled, true);
  };
  function close(refocus = false) {
    if (!isOpen()) return;
    list.hidden = true;
    list.removeAttribute('aria-activedescendant');
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onAway);
    window.removeEventListener('blur', onAway);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('animationend', onSettled, true);
    if (refocus === true) button.focus({ preventScroll: true });
  }
  const choose = (i: number) => {
    const o = options()[i];
    if (o && o.value !== select.value) {
      select.value = o.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  function onSettled(e: Event) {
    if (e.target !== list) place();
  }
  function onAway() {
    close();
  }
  function onOutside(e: Event) {
    const t = e.target as Node;
    if (!list.contains(t) && !button.contains(t)) close();
  }
  function onScroll(e: Event) {
    if (e.target !== list && !list.contains(e.target as Node)) close();
  }
  const typeAhead = (key: string) => {
    const now = Date.now();
    typed = now - typedAt > 700 ? key : typed + key;
    typedAt = now;
    const opts = options();
    const from = typed.length === 1 ? active + 1 : active;
    for (let k = 0; k < opts.length; k++) {
      const i = (from + k) % opts.length;
      if ((opts[i].textContent || '').trim().toLowerCase().startsWith(typed.toLowerCase())) return i;
    }
    return -1;
  };

  button.addEventListener('click', () => (isOpen() ? close(true) : open()));
  button.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      open();
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing on the closed menu picks the next match, as a native select does.
      active = options().findIndex((o) => o.value === select.value);
      const i = typeAhead(e.key);
      if (i >= 0) choose(i);
    }
  });
  list.addEventListener('keydown', (e) => {
    const count = options().length;
    const page = 8;
    switch (e.key) {
      case 'ArrowDown': setActive(active + 1); break;
      case 'ArrowUp': if (e.altKey) { choose(active); close(true); } else setActive(active - 1); break;
      case 'Home': setActive(0); break;
      case 'End': setActive(count - 1); break;
      case 'PageDown': setActive(active + page); break;
      case 'PageUp': setActive(active - page); break;
      case ' ':
        // A space inside a type-ahead search is part of the search, as in a native select.
        if (typed && Date.now() - typedAt <= 700) {
          const i = typeAhead(' ');
          if (i >= 0) setActive(i);
          break;
        }
        choose(active);
        close(true);
        break;
      case 'Enter':
        choose(active);
        close(true);
        break;
      case 'Escape': close(true); break;
      case 'Tab':
        choose(active);
        close(true);
        return; // Let Tab move on from the button.
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const i = typeAhead(e.key);
          if (i >= 0) setActive(i);
          break;
        }
        return;
    }
    e.preventDefault();
  });
  list.addEventListener('focusout', (e) => {
    const to = e.relatedTarget as Node | null;
    if (!to || (!list.contains(to) && to !== button)) close();
  });
  list.addEventListener('pointermove', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.sv-menu__item');
    if (item) setActive(Number(item.dataset.index));
  });
  list.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.sv-menu__item');
    if (!item) return;
    choose(Number(item.dataset.index));
    close(true);
  });

  // Follow the select when code changes its value or its options.
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const protoIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  if (proto?.get && proto.set) {
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return proto.get!.call(select); },
      set(v: string) { proto.set!.call(select, v); paintButton(); },
    });
  }
  if (protoIndex?.get && protoIndex.set) {
    Object.defineProperty(select, 'selectedIndex', {
      configurable: true,
      get() { return protoIndex.get!.call(select); },
      set(v: number) { protoIndex.set!.call(select, v); paintButton(); },
    });
  }
  select.addEventListener('change', paintButton);
  new MutationObserver(() => {
    paintButton();
    if (!isOpen()) return;
    // Options replaced while the list is open: redraw, keep a highlight inside the new list, re-place.
    paintList();
    setActive(Math.min(Math.max(active, 0), options().length - 1));
    place();
  }).observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
  paintButton();
}
