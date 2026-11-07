/**
 * Hover lookup inside Phevere's own pages. The native hover leaves Phevere's windows alone: their
 * accessibility tree is off unless a screen reader runs, and asking UI Automation about our own
 * window from the main process froze the app. So the page finds the word under a resting pointer
 * itself and hands it to the main process, which treats it like a hover anywhere else.
 */

/** How long the pointer rests on a word before it is looked up; the native hover waits as long. */
const DWELL_MS = 450;

/** Controls, fields and chrome: resting on a button's label is not asking what the word means. */
const SKIP =
  'button, input, textarea, select, option, label, [contenteditable=""], [contenteditable="true"], [role="button"], [role="tab"], [role="menuitem"], [role="switch"], .titlebar, .window-controls, .status-bar, .toolbar, [data-no-hover]';

export interface HoverWord {
  word: string;
  /** The word's box, for telling when the pointer leaves it. */
  rect: DOMRect;
}

/** Intl.Segmenter, which the TypeScript lib in use does not declare yet. */
interface WordSegmenter {
  segment(text: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>;
}
const Segmenter = (Intl as unknown as { Segmenter: new (locale?: string, o?: { granularity: 'word' }) => WordSegmenter }).Segmenter;
let segmenter: WordSegmenter | null = null;

/** The word under a point in the page, or null over a gap, a control or punctuation. */
export function wordAtPoint(doc: Document, x: number, y: number): HoverWord | null {
  const range = doc.caretRangeFromPoint?.(x, y);
  const node = range?.startContainer;
  if (!range || !node || node.nodeType !== Node.TEXT_NODE) return null;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return null;
  const text = (node as Text).data;
  const at = range.startOffset;
  segmenter ||= new Segmenter(undefined, { granularity: 'word' });
  for (const s of segmenter.segment(text)) {
    const end = s.index + s.segment.length;
    // The caret lands on the nearer edge of a letter, so a point on a word's last letter can give
    // the offset just past it: both ends count, and the box test below settles which word it is.
    if (at < s.index || at > end || !s.isWordLike) continue;
    const r = doc.createRange();
    r.setStart(node, s.index);
    r.setEnd(node, end);
    const rect = [...r.getClientRects()].find((b) => x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1);
    if (rect && /\p{L}/u.test(s.segment)) return { word: s.segment, rect };
  }
  return null;
}

/**
 * Looks up the word the pointer rests on. `send` gets the pointer's screen point and the word; a
 * word is sent once until the pointer leaves it, and nothing is sent while a button is held or text
 * is selected (selecting has its own lookup).
 *
 * `onRequest` hears the trigger shortcut pressed over this page: the native probe stands aside over
 * a focused Phevere window, so the page reads the word under the pointer then and sends it as asked
 * for, wherever the pointer has moved since the last word went.
 */
export function wireInPageHover(
  send: (screenX: number, screenY: number, word: string, requested?: boolean) => void,
  onRequest?: (answer: (x: number, y: number, screenX: number, screenY: number) => void) => void,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sent: HoverWord | null = null;
  onRequest?.((x, y, screenX, screenY) => {
    const hit = wordAtPoint(document, x, y);
    if (!hit) return;
    sent = hit;
    send(screenX, screenY, hit.word, true);
  });
  document.addEventListener(
    'mousemove',
    (e) => {
      if (timer) clearTimeout(timer);
      timer = null;
      const { clientX: x, clientY: y } = e;
      if (sent && !(x >= sent.rect.left && x <= sent.rect.right && y >= sent.rect.top && y <= sent.rect.bottom)) sent = null;
      if (e.buttons || sent) return;
      timer = setTimeout(() => {
        timer = null;
        if ((window.getSelection()?.toString() || '').trim()) return;
        const hit = wordAtPoint(document, x, y);
        if (!hit) return;
        sent = hit;
        send(e.screenX, e.screenY, hit.word);
      }, DWELL_MS);
    },
    { passive: true },
  );
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  document.addEventListener('mousedown', cancel, true);
  document.addEventListener('mouseleave', cancel);
  window.addEventListener('blur', cancel);
}
