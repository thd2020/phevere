/**
 * The picture with its recognised text in place, on desktop and phone alike.
 *
 * Like Live Text, pdf.js's text layer and OCRmyPDF's invisible text, every word is real text
 * laid over its own pixels: font size from the box height, then stretched to the box width
 * (pdf.js's scaleX, PDF's Tz), and turned to the box's angle. The text is transparent, so the
 * picture shows through, and it selects, copies and looks up like any other text.
 *
 * Edit turns each line into a field painted over the picture in the line's own background and
 * ink colours, so changed text replaces the old pixels; Save image draws the same thing into a
 * PNG. Text shows the recognised text alone, paragraph by paragraph, editable the same way.
 * Words the engine was unsure about carry a dotted underline in both views.
 */

import {
  isUnsure,
  lineJoin,
  lineText,
  ocrPageText,
  ocrRangeText,
  pageHyphenated,
  pageLines,
  quadBounds,
  quadLength,
  quadThickness,
  type OcrLine,
  type OcrPage,
  type OcrQuad,
} from './ocr-layout';

export type OcrViewMode = 'picture' | 'text';

export interface OcrViewHost {
  /** Copy text and tell the reader it was copied. */
  copyText(text: string): Promise<void> | void;
  /** Save the picture with its edits; omitted where the platform cannot save a file. */
  saveImage?(png: Blob): Promise<void>;
  /** Put the picture with its edits on the clipboard; omitted where that cannot work. */
  copyImage?(png: Blob): Promise<void>;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (v: number) => Number(v.toFixed(2));

/** The bar: view switch and actions. Labels name the action. */
export function ocrBarHtml(opts: { saveImage?: boolean; copyImage?: boolean; empty?: boolean } = {}): string {
  if (opts.empty) return '<div class="ocr-bar" role="toolbar" aria-label="Scanned text"><span class="ocr-bar__status">No text found</span></div>';
  return `<div class="ocr-bar" role="toolbar" aria-label="Scanned text">
    <div class="ocr-seg" role="radiogroup" aria-label="View">
      <button type="button" role="radio" aria-checked="true" data-ocr-act="picture">Picture</button>
      <button type="button" role="radio" aria-checked="false" data-ocr-act="text">Text</button>
    </div>
    <span class="ocr-bar__gap"></span>
    <button type="button" class="ocr-btn" data-ocr-act="edit" aria-pressed="false">Edit</button>
    <button type="button" class="ocr-btn" data-ocr-act="copy-all">Copy all</button>
    ${opts.copyImage ? '<button type="button" class="ocr-btn" data-ocr-act="copy-image">Copy image</button>' : ''}
    ${opts.saveImage ? '<button type="button" class="ocr-btn" data-ocr-act="save-image">Save image</button>' : ''}
  </div>`;
}

function wordSpan(line: OcrLine, k: number): string {
  const w = line.words[k];
  const q = w.quad;
  const unsure = isUnsure(w.confidence);
  return `<span class="ocr-w${unsure ? ' is-unsure' : ''}" data-l="${line.id}" data-w="${k}" ${geomAttrs(q, line.vertical)}${unsure ? ' title="Unsure"' : ''}>${esc(w.text)}</span>`;
}

function geomAttrs(q: OcrQuad, vertical: boolean): string {
  if (vertical) {
    const b = quadBounds(q);
    return `data-v="1" data-x="${n(b.x)}" data-y="${n(b.y)}" data-len="${n(b.height)}" data-th="${n(b.width)}" data-a="0"`;
  }
  const a = Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]);
  return `data-x="${n(q[0][0])}" data-y="${n(q[0][1])}" data-len="${n(quadLength(q))}" data-th="${n(quadThickness(q))}" data-a="${n((a * 180) / Math.PI)}"`;
}

/** What separates two consecutive lines in reading order, as a text node the copy keeps. */
function separators(page: OcrPage, edits: ReadonlyMap<number, string>): Map<number, string> {
  const hy = pageHyphenated(page, edits);
  const out = new Map<number, string>();
  let prevEnd: { id: number; text: string } | null = null;
  for (const b of page.blocks) {
    for (const p of b.paragraphs) {
      p.lines.forEach((l, i) => {
        if (prevEnd) out.set(prevEnd.id, i === 0 ? '\n' : lineJoin(prevEnd.text, lineText(l, edits), hy).sep || '');
        prevEnd = { id: l.id, text: lineText(l, edits) };
      });
    }
  }
  return out;
}

/**
 * The text layer over the picture. Unedited lines are invisible words in place; an edited
 * line, or every line while editing, is one painted field.
 */
export function ocrLayerHtml(page: OcrPage, edits: ReadonlyMap<number, string> = new Map(), editing = false): string {
  const sep = separators(page, edits);
  const parts: string[] = [];
  for (const line of pageLines(page)) {
    if (editing || edits.has(line.id)) {
      parts.push(
        `<span class="ocr-ln is-painted" data-l="${line.id}" ${geomAttrs(line.quad, line.vertical)}${editing ? ' contenteditable="plaintext-only" spellcheck="false"' : ''}>${esc(lineText(line, edits))}</span>`,
      );
    } else if (line.estimated) {
      // Without the engine's word boxes the line is one run, stretched to its box.
      const words = line.words.map((w, k) => `<span class="ocr-wt${isUnsure(w.confidence) ? ' is-unsure' : ''}" data-l="${line.id}" data-w="${k}">${esc(w.text)}</span>`);
      const inner = words.map((w, k) => (k ? esc(line.joins[k - 1] ?? ' ') : '') + w).join('');
      parts.push(`<span class="ocr-ln" data-l="${line.id}" ${geomAttrs(line.quad, line.vertical)}>${inner}</span>`);
    } else {
      line.words.forEach((_, k) => {
        if (k) parts.push(esc(line.joins[k - 1] ?? ' '));
        parts.push(wordSpan(line, k));
      });
    }
    const s = sep.get(line.id);
    if (s) parts.push(s === '\n' ? '\n' : esc(s));
  }
  return parts.join('');
}

/** The plain recognised text, paragraph by paragraph; lines stay their own spans so edits map back. */
export function ocrTextHtml(page: OcrPage, edits: ReadonlyMap<number, string> = new Map(), editing = false): string {
  const hy = pageHyphenated(page, edits);
  const paras: string[] = [];
  for (const b of page.blocks) {
    for (const p of b.paragraphs) {
      let prev = '';
      const spans = p.lines.map((l, i) => {
        const t = lineText(l, edits);
        let lead = '';
        if (i > 0) lead = esc(lineJoin(prev, t, hy).sep);
        prev = t;
        const body = edits.has(l.id) || editing
          ? esc(t)
          : l.words
              .map((w, k) => (k ? esc(l.joins[k - 1] ?? ' ') : '') + (isUnsure(w.confidence) ? `<span class="is-unsure" title="Unsure">${esc(w.text)}</span>` : esc(w.text)))
              .join('');
        return `${lead}<span class="ocr-tl" data-l="${l.id}"${editing ? ' contenteditable="plaintext-only" spellcheck="false"' : ''}>${body}</span>`;
      });
      paras.push(`<p>${spans.join('')}</p>`);
    }
  }
  return paras.join('');
}

/** Background and ink colours of a line, the share of its box the ink covers, and whether its type has serifs. */
type Paint = { bg: string; ink: string; cover: number; serif: boolean };

/** Background and ink of a box: the median of its rim, and the pixels farthest from it. */
export function sampleColours(data: Uint8ClampedArray, w: number, h: number): Paint {
  const rim: number[][] = [];
  const all: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const px = [data[i], data[i + 1], data[i + 2]];
      all.push(px);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) rim.push(px);
    }
  }
  const med = (k: number) => {
    const s = rim.map((p) => p[k]).sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 255;
  };
  const bg = [med(0), med(1), med(2)];
  const far = all
    .map((p) => ({ p, d: (p[0] - bg[0]) ** 2 + (p[1] - bg[1]) ** 2 + (p[2] - bg[2]) ** 2 }))
    .sort((a, b) => b.d - a.d)
    .slice(0, Math.max(1, Math.round(all.length * 0.08)));
  const ink = [0, 1, 2].map((k) => Math.round(far.reduce((s, f) => s + f.p[k], 0) / far.length));
  const d2 = (p: number[], c: number[]) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  const isInk = all.map((p) => d2(p, ink) < d2(p, bg));
  const cover = isInk.filter(Boolean).length / Math.max(1, all.length);
  // Too little contrast (an empty box): fall back to black or white on the background.
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const inkOk = Math.abs(lum(ink) - lum(bg)) > 40;
  const fallback = lum(bg) > 128 ? [20, 20, 20] : [245, 245, 245];
  const rgb = (c: number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  return { bg: rgb(bg), ink: rgb(inkOk ? ink : fallback), cover, serif: inkOk && hasSerifs(isInk, w, h) };
}

/**
 * Serif type has thick upright strokes and thin cross strokes (Times, Georgia, Song); sans type
 * has strokes of one width. Compared by the commonest run of ink across the line (upright stroke
 * width) and down it (cross stroke width). Only strokes at least 3 pixels wide can show the
 * difference, so small text stays sans.
 */
export function hasSerifs(isInk: boolean[], w: number, h: number): boolean {
  /** The commonest length of an unbroken run of ink along `lines` lines of `len` pixels each. */
  const commonestRun = (lines: number, len: number, at: (line: number, i: number) => number): number => {
    const counts = new Map<number, number>();
    for (let a = 0; a < lines; a++) {
      let run = 0;
      for (let i = 0; i <= len; i++) {
        if (i < len && isInk[at(a, i)]) run++;
        else if (run) {
          counts.set(run, (counts.get(run) || 0) + 1);
          run = 0;
        }
      }
    }
    let best = 0, most = 0;
    for (const [run, n] of counts) if (n > most) [best, most] = [run, n];
    return best;
  };
  const stem = commonestRun(h, w, (y, x) => y * w + x);
  const bar = commonestRun(w, h, (x, y) => y * w + x);
  return stem >= 3 && bar > 0 && stem / bar >= 2;
}

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Noto Sans", "Microsoft YaHei", "PingFang SC", sans-serif';
const SERIF = 'Georgia, "Times New Roman", "Noto Serif", "Songti SC", SimSun, "Noto Serif CJK SC", serif';

/**
 * Wires a view: `root` holds `.ocr-bar`, a `.ocr-frame` with the picture and `.ocr-layer`, and
 * `.ocr-text`. The host keeps zoom, panning and lookups; this keeps text, edits and the actions.
 */
export class OcrView {
  mode: OcrViewMode = 'picture';
  editing = false;
  readonly edits = new Map<number, string>();
  private readonly paints = new Map<number, Paint>();
  private medianCover = NaN;
  private pixels: { data: Uint8ClampedArray; w: number; h: number; s: number } | null = null;
  private readonly measure = document.createElement('canvas').getContext('2d');
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly root: HTMLElement,
    readonly page: OcrPage,
    private readonly img: HTMLImageElement,
    private readonly host: OcrViewHost,
  ) {
    this.render();
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-ocr-act]');
      if (!btn || !root.contains(btn)) return;
      void this.act(btn.dataset.ocrAct || '');
    };
    const onCopy = (e: ClipboardEvent) => {
      const t = this.selectionText();
      if (!t || !e.clipboardData) return;
      e.clipboardData.setData('text/plain', t);
      e.preventDefault();
    };
    const onInput = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-l][contenteditable]');
      if (!el) return;
      const id = Number(el.dataset.l);
      const line = pageLines(page).find((l) => l.id === id);
      if (!line) return;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t === line.text) this.edits.delete(id);
      else this.edits.set(id, t);
      if (el.classList.contains('ocr-ln')) this.fitOne(el);
    };
    const onKey = (e: KeyboardEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-l][contenteditable]');
      if (!el) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Escape') {
          el.blur();
          return;
        }
        const all = [...root.querySelectorAll<HTMLElement>(`${el.classList.contains('ocr-ln') ? '.ocr-ln' : '.ocr-tl'}[contenteditable]`)];
        const next = all[all.indexOf(el) + (e.shiftKey ? -1 : 1)];
        if (next) focusEnd(next);
        else el.blur();
      }
    };
    root.addEventListener('click', onClick);
    root.addEventListener('copy', onCopy);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
    this.cleanup.push(() => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('copy', onCopy);
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKey);
    });
    if (!img.complete) img.addEventListener('load', () => this.fit(), { once: true });
  }

  destroy(): void {
    this.cleanup.forEach((f) => f());
  }

  private get layer(): HTMLElement | null {
    return this.root.querySelector('.ocr-layer');
  }

  private get textPane(): HTMLElement | null {
    return this.root.querySelector('.ocr-text');
  }

  text(): string {
    return ocrPageText(this.page, this.edits);
  }

  render(): void {
    const layer = this.layer;
    if (layer) layer.innerHTML = ocrLayerHtml(this.page, this.edits, this.editing && this.mode === 'picture');
    const pane = this.textPane;
    if (pane) pane.innerHTML = ocrTextHtml(this.page, this.edits, this.editing && this.mode === 'text');
    this.root.dataset.mode = this.mode;
    this.root.classList.toggle('is-editing', this.editing);
    this.root.querySelectorAll<HTMLElement>('[data-ocr-act="picture"],[data-ocr-act="text"]').forEach((b) =>
      b.setAttribute('aria-checked', String(b.dataset.ocrAct === this.mode)),
    );
    this.root.querySelector('[data-ocr-act="edit"]')?.setAttribute('aria-pressed', String(this.editing));
    if (pane) pane.hidden = this.mode !== 'text';
    this.fit();
  }

  /** Size every span to its box at the frame's current scale. Call after the frame resizes. */
  fit(): void {
    const layer = this.layer;
    if (!layer) return;
    layer.querySelectorAll<HTMLElement>('.ocr-w, .ocr-ln').forEach((el) => this.fitOne(el));
  }

  private scale(): number {
    const frame = this.layer?.parentElement;
    return frame && this.page.width ? frame.clientWidth / this.page.width : 1;
  }

  private fitOne(el: HTMLElement): void {
    const s = this.scale();
    const x = Number(el.dataset.x) * s, y = Number(el.dataset.y) * s;
    const len = Number(el.dataset.len) * s, th = Number(el.dataset.th) * s;
    const vertical = el.dataset.v === '1';
    const p = el.classList.contains('is-painted') ? this.paint(Number(el.dataset.l)) : null;
    const weight = p && this.bold(p) ? 700 : 400;
    const family = p?.serif ? SERIF : FONT;
    const size = Math.max(4, th * 0.74);
    const st = el.style;
    st.left = `${x}px`;
    st.top = `${y}px`;
    st.fontSize = `${size}px`;
    st.lineHeight = `${th}px`;
    const textLen = this.textWidth(el.textContent || '', size, vertical, weight, family);
    let stretch = textLen > 0 ? len / textLen : 1;
    let boxLen = textLen;
    if (p) {
      // A painted line keeps the letter widths of the text it replaces, so a shorter edit is not
      // pulled apart to the old length; a longer one narrows to stay inside the box. The paint
      // still covers the whole box, so none of the old text shows past a shorter edit.
      const line = this.lineById(Number(el.dataset.l));
      const orig = line ? this.textWidth(line.text, size, vertical, weight, family) : 0;
      if (orig > 0 && textLen > 0) stretch = Math.min(len / orig, len / textLen);
      boxLen = len / stretch;
    }
    if (vertical) {
      st.width = `${th}px`;
      st.height = `${boxLen}px`;
      st.transform = `scaleY(${stretch})`;
    } else {
      st.height = `${th}px`;
      st.width = `${boxLen}px`;
      st.transform = `rotate(${Number(el.dataset.a) || 0}deg) scaleX(${stretch})`;
    }
    if (p) {
      st.backgroundColor = p.bg;
      st.color = p.ink;
      st.fontWeight = String(weight);
      st.fontFamily = family;
    }
  }

  private textWidth(text: string, size: number, vertical: boolean, weight = 400, family = FONT): number {
    const ctx = this.measure;
    if (!text) return 0;
    if (vertical) return [...text].length * size;
    if (!ctx) return text.length * size * 0.55;
    ctx.font = `${weight === 700 ? '700 ' : ''}${size}px ${family}`;
    return ctx.measureText(text).width;
  }

  private byId: Map<number, OcrLine> | null = null;

  private lineById(id: number): OcrLine | undefined {
    if (!this.byId) this.byId = new Map(pageLines(this.page).map((l) => [l.id, l]));
    return this.byId.get(id);
  }

  private loadPixels(): void {
    if (this.pixels || !this.img.naturalWidth) return;
    try {
      const s = Math.min(1, 2400 / Math.max(this.img.naturalWidth, this.img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(this.page.width * s));
      c.height = Math.max(1, Math.round(this.page.height * s));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(this.img, 0, 0, c.width, c.height);
      this.pixels = { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, s };
    } catch {
      /* a picture the canvas may not read */
    }
  }

  private paint(id: number): Paint | null {
    const hit = this.paints.get(id);
    if (hit) return hit;
    this.loadPixels();
    const px = this.pixels;
    const line = pageLines(this.page).find((l) => l.id === id);
    if (!px || !line) return null;
    const b = quadBounds(line.quad);
    const x0 = Math.max(0, Math.floor(b.x * px.s)), y0 = Math.max(0, Math.floor(b.y * px.s));
    const x1 = Math.min(px.w, Math.ceil((b.x + b.width) * px.s)), y1 = Math.min(px.h, Math.ceil((b.y + b.height) * px.s));
    const w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return null;
    const crop = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) crop.set(px.data.subarray(((y0 + y) * px.w + x0) * 4, ((y0 + y) * px.w + x1) * 4), y * w * 4);
    const p = sampleColours(crop, w, h);
    this.paints.set(id, p);
    return p;
  }

  /** Heavier ink than most lines of the page: a bold line, repainted bold. */
  private bold(p: Paint): boolean {
    if (Number.isNaN(this.medianCover)) {
      const covers = pageLines(this.page)
        .slice(0, 60)
        .map((l) => this.paint(l.id)?.cover)
        .filter((c): c is number => typeof c === 'number')
        .sort((a, b) => a - b);
      this.medianCover = covers.length ? covers[covers.length >> 1] : 0;
    }
    return this.medianCover > 0 && p.cover > this.medianCover * 1.35;
  }

  /** Text of the current selection inside the view, joined the way Copy all joins it. */
  selectionText(): string {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
    const range = sel.getRangeAt(0);
    const layer = this.layer;
    if (!layer || !layer.contains(range.commonAncestorContainer)) return sel.toString();
    const a = this.wordAt(range.startContainer, range.startOffset, true);
    const b = this.wordAt(range.endContainer, range.endOffset, false);
    if (!a || !b) return sel.toString();
    return ocrRangeText(this.page, a, b, this.edits);
  }

  private wordAt(node: Node, offset: number, start: boolean): { line: number; word: number; offset: number } | null {
    const layer = this.layer!;
    let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
    let off = offset;
    // Between word spans: snap to the next word at the start, the previous one at the end.
    if (!el || el === layer || !el.closest('[data-l]')) {
      const kids = [...layer.childNodes];
      let i = node === layer ? offset : kids.indexOf(node as ChildNode);
      if (node !== layer && node.nodeType === 3) i += start ? 1 : 0;
      const step = start ? 1 : -1;
      if (!start) i -= 1;
      while (i >= 0 && i < kids.length && !(kids[i] instanceof Element)) i += step;
      el = (kids[i] as Element) || null;
      if (!el) return null;
      off = start ? 0 : (el.textContent || '').length;
    }
    const host = el.closest<HTMLElement>('[data-l]');
    if (!host) return null;
    const line = Number(host.dataset.l);
    if (host.dataset.w !== undefined) {
      const chars = node.nodeType === 3 && host.contains(node) ? [...(node.textContent || '').slice(0, off)].length : start ? 0 : [...(host.textContent || '')].length;
      return { line, word: Number(host.dataset.w), offset: chars };
    }
    // A painted or estimated line: whole words of it.
    const ln = pageLines(this.page).find((l) => l.id === line);
    return { line, word: start ? 0 : Math.max(0, (ln?.words.length || 1) - 1), offset: start ? 0 : Infinity };
  }

  async act(action: string): Promise<void> {
    switch (action) {
      case 'picture':
      case 'text':
        if (this.mode === action) return;
        this.mode = action;
        this.render();
        return;
      case 'edit':
        this.editing = !this.editing;
        this.render();
        if (this.editing) {
          const first = this.root.querySelector<HTMLElement>(this.mode === 'text' ? '.ocr-tl[contenteditable]' : '.ocr-ln[contenteditable]');
          if (first && this.mode === 'text') focusEnd(first);
        }
        return;
      case 'copy-all':
        await this.host.copyText(this.text());
        return;
      case 'save-image':
        if (this.host.saveImage) await this.host.saveImage(await this.renderImage());
        return;
      case 'copy-image':
        if (this.host.copyImage) await this.host.copyImage(await this.renderImage());
        return;
    }
  }

  /** The picture with every edited line painted in, as a PNG at the picture's own size. */
  async renderImage(): Promise<Blob> {
    const c = document.createElement('canvas');
    c.width = this.page.width;
    c.height = this.page.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.img, 0, 0, c.width, c.height);
    for (const line of pageLines(this.page)) {
      if (!this.edits.has(line.id)) continue;
      const p = this.paint(line.id) || { bg: '#fff', ink: '#111', cover: 0, serif: false };
      const family = p.serif ? SERIF : FONT;
      const t = lineText(line, this.edits);
      ctx.save();
      if (line.vertical) {
        const b = quadBounds(line.quad);
        ctx.fillStyle = p.bg;
        ctx.fillRect(b.x, b.y, b.width, b.height);
        const chars = [...t];
        const step = chars.length ? b.height / chars.length : 0;
        const size = Math.min(b.width * 0.8, step * 0.95);
        ctx.font = `${size}px ${family}`;
        ctx.fillStyle = p.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        chars.forEach((ch, i) => ctx.fillText(ch, b.x + b.width / 2, b.y + step * (i + 0.5)));
      } else {
        const q = line.quad;
        const len = quadLength(q), th = quadThickness(q);
        ctx.translate(q[0][0], q[0][1]);
        ctx.rotate(Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]));
        ctx.fillStyle = p.bg;
        ctx.fillRect(-1, -1, len + 2, th + 2);
        const size = th * 0.74;
        ctx.font = `${this.bold(p) ? '700 ' : ''}${size}px ${family}`;
        const w = ctx.measureText(t).width;
        const orig = ctx.measureText(line.text).width;
        // Same letter widths as the text it replaces; a longer edit narrows to fit the box.
        ctx.scale(w > 0 && orig > 0 ? Math.min(len / orig, len / w) : 1, 1);
        ctx.fillStyle = p.ink;
        ctx.textBaseline = 'middle';
        ctx.fillText(t, 0, th / 2);
      }
      ctx.restore();
    }
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the image'))), 'image/png'));
  }
}

function focusEnd(el: HTMLElement): void {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}
