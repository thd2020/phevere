/**
 * One in-page picker for every choice list (translation languages, pronunciation voice).
 * Not <select>: the pop-up is a WebView in an overlay window with no Activity, and
 * Android WebView cannot open a native select list there.
 */
export type PickerItem = { value: string; title: string; sub?: string };

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function pickerHtml(opts: {
  id: string;
  label: string;
  items: PickerItem[];
  selected: string;
  open: boolean;
  /** Button text when it should differ from the selected item's title. */
  display?: string;
}): string {
  const current = opts.items.find((i) => i.value === opts.selected) || opts.items[0];
  const list = opts.items
    .map((i) => {
      const on = i.value === current?.value;
      return `<button type="button" role="option" aria-selected="${on}" class="pick-opt${on ? ' is-on' : ''}" data-act="pick" data-picker="${esc(opts.id)}" data-value="${esc(i.value)}">${esc(i.title)}${i.sub ? ` <span>${esc(i.sub)}</span>` : ''}</button>`;
    })
    .join('');
  return `<div class="pick">
    <span class="pick-label" id="${esc(opts.id)}-label">${esc(opts.label)}</span>
    <button type="button" class="field pick-btn" data-act="pick-open" data-picker="${esc(opts.id)}" aria-haspopup="listbox" aria-expanded="${opts.open}" aria-labelledby="${esc(opts.id)}-label">${esc(opts.display || current?.title || opts.selected)}</button>
    ${opts.open ? `<div class="pick-menu" role="listbox" aria-labelledby="${esc(opts.id)}-label">${list}</div>` : ''}
  </div>`;
}
