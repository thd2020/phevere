/**
 * What a Copy button does after the text is on the clipboard, on desktop and phone alike: its
 * icon turns into a tick for a moment, as GitHub's and Material's copy buttons do, and a hidden
 * status line tells a screen reader "Copied". Nothing else on the page moves. A button with a
 * text label ("Copy with meaning") reads "Copied" instead, at its old width.
 *
 * Android 13 and later shows its own clipboard confirmation, and Android's guidance asks apps
 * not to add a second one, so this stays on the button rather than raising a toast.
 */

const TICK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** How long the tick stays, in milliseconds. */
export const COPIED_MS = 1500;

const flashing = new WeakMap<HTMLElement, { html: string; timer: number }>();

/** A polite status region outside every repainted view, made once per document. */
function liveRegion(doc: Document): HTMLElement {
  let el = doc.getElementById('pv-copy-status');
  if (el) return el;
  el = doc.createElement('div');
  el.id = 'pv-copy-status';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'position:fixed;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
  doc.body.appendChild(el);
  return el;
}

/** Say `text` to a screen reader once, even when the same text was said a moment ago. */
export function announceStatus(text: string, doc: Document = document): void {
  const el = liveRegion(doc);
  el.textContent = '';
  window.setTimeout(() => {
    el.textContent = text;
  }, 30);
}

/** The button shows it copied, then goes back to how it was. */
export function flashCopied(button: HTMLElement, label = 'Copied'): void {
  announceStatus(label, button.ownerDocument);
  const prior = flashing.get(button);
  if (prior) window.clearTimeout(prior.timer);
  const html = prior ? prior.html : button.innerHTML;
  if (!prior) {
    const text = button.querySelector('span');
    if (text) {
      button.style.minWidth = `${button.offsetWidth}px`;
      text.textContent = label;
      button.querySelector('svg')?.replaceWith(svgFrom(button.ownerDocument, TICK));
    } else {
      button.innerHTML = TICK;
    }
    button.classList.add('is-copied');
  }
  const timer = window.setTimeout(() => {
    flashing.delete(button);
    button.innerHTML = html;
    button.style.minWidth = '';
    button.classList.remove('is-copied');
  }, COPIED_MS);
  flashing.set(button, { html, timer });
}

function svgFrom(doc: Document, markup: string): Element {
  const box = doc.createElement('span');
  box.innerHTML = markup;
  return box.firstElementChild!;
}
