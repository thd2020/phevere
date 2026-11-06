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
  isCjkChar,
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
import {
  PageTranslation,
  reflow,
  roughMeasure,
  translatedPageText,
  translationUnits,
  type OcrFlow,
  type OcrUnit,
  type UnitResult,
  type UnitState,
} from './ocr-translate';

export type OcrViewMode = 'picture' | 'text';

export interface OcrViewHost {
  /** Copy text and tell the reader it was copied. */
  copyText(text: string): Promise<void> | void;
  /** Save the picture with its edits; omitted where the platform cannot save a file. */
  saveImage?(png: Blob): Promise<void>;
  /** Put the picture with its edits on the clipboard; omitted where that cannot work. */
  copyImage?(png: Blob): Promise<void>;
  /** Translate the picture in place; omitted where no engine can be reached. */
  translator?: OcrTranslator;
}

export interface OcrTranslator {
  /** Languages to translate into. */
  languages: { code: string; name: string }[];
  /** The language to translate into: the setting, with `auto` resolved for this page's text. */
  target(sample: string): Promise<string>;
  /** Keep a language picked in the view as the new setting. */
  setTarget(code: string): void;
  /** One paragraph into `to`; `{ same }` when it is already in `to`, null when no engine answered. */
  translate(text: string, to: string): Promise<UnitResult>;
}

/** What the layer needs to show translations: the units, their states, and which unit owns each line. */
type Shown = { units: OcrUnit[]; states: UnitState[]; byLine: Map<number, number> };

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (v: number) => Number(v.toFixed(2));

/** The bar: view switch and actions. Labels name the action. */
export function ocrBarHtml(opts: { saveImage?: boolean; copyImage?: boolean; translate?: boolean; empty?: boolean } = {}): string {
  if (opts.empty) return '<div class="ocr-bar" role="toolbar" aria-label="Scanned text"><span class="ocr-bar__status">No text found</span></div>';
  return `<div class="ocr-bar" role="toolbar" aria-label="Scanned text">
    <div class="ocr-seg" role="radiogroup" aria-label="View">
      <button type="button" role="radio" aria-checked="true" data-ocr-act="picture">Picture</button>
      <button type="button" role="radio" aria-checked="false" data-ocr-act="text">Text</button>
    </div>
    ${opts.translate ? `<button type="button" class="ocr-btn" data-ocr-act="translate" aria-pressed="false">Translate</button>
    <select class="ocr-lang" data-ocr-lang aria-label="Translate to" hidden></select>
    <span class="ocr-bar__tr" role="status" aria-live="polite"></span>
    <button type="button" class="ocr-btn" data-ocr-act="retry" hidden>Retry</button>` : ''}
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
export function ocrLayerHtml(page: OcrPage, edits: ReadonlyMap<number, string> = new Map(), editing = false, shown?: Shown): string {
  const sep = separators(page, edits);
  // Every translated unit's background first, so no unit's paint covers a neighbour's text.
  const parts: string[] = shown
    ? shown.states.map((s, i) => (s.status === 'done' ? `<span class="ocr-tr-bg" data-u="${i}" aria-hidden="true"></span>` : '')).filter(Boolean)
    : [];
  for (const line of pageLines(page)) {
    const u = shown?.byLine.get(line.id);
    const unit = u === undefined ? undefined : shown!.units[u];
    const state = u === undefined ? undefined : shown!.states[u];
    if (unit && state?.status === 'done') {
      // A translated paragraph is one painted run over the whole paragraph; fit() sets its lines.
      if (line.id === unit.lineIds[0]) parts.push(`<span class="ocr-tr" data-u="${u}">${esc(state.text)}</span>`);
      // A translated unit ends its own line in a copy, whatever followed the original.
      if (line.id === unit.lineIds[unit.lineIds.length - 1] && sep.has(line.id)) parts.push('\n');
      continue;
    }
    if (unit && state?.status === 'failed' && line.id === unit.lineIds[0]) parts.push(`<span class="ocr-tr-miss" data-u="${u}" aria-hidden="true"></span>`);
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
export function ocrTextHtml(page: OcrPage, edits: ReadonlyMap<number, string> = new Map(), editing = false, shown?: Shown): string {
  if (shown) {
    // Translated: one paragraph per unit, the translation where it arrived.
    return shown.units
      .map((u, i) => {
        const st = shown.states[i];
        return st.status === 'done' ? `<p class="ocr-tp" data-u="${i}">${esc(st.text)}</p>` : `<p data-u="${i}">${esc(u.text)}</p>`;
      })
      .join('');
  }
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
  /** Showing the translation over the picture (and in the Text view). */
  translated = false;
  private run: PageTranslation | null = null;
  private target = '';
  /** Laid-out translation of each unit, keyed by its text and look, so zooming only rescales it. */
  private readonly flows = new Map<number, { key: string; flow: OcrFlow }>();
  private readonly looks = new Map<number, Look>();
  /** Units already on screen, so only a newly arrived translation fades in. */
  private readonly seen = new Set<number>();
  private renderQueued = false;

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
    const onChange = (e: Event) => {
      const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-ocr-lang]');
      if (!sel || !sel.value || !this.host.translator) return;
      this.host.translator.setTarget(sel.value);
      void this.translate(sel.value);
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
    root.addEventListener('change', onChange);
    this.cleanup.push(() => {
      root.removeEventListener('change', onChange);
      this.run?.stop();
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

  /** The page's text in reading order: the translation where there is one while it shows. */
  text(): string {
    const run = this.shownRun();
    return run ? translatedPageText(run.units, run.states) : ocrPageText(this.page, this.edits);
  }

  private shownRun(): PageTranslation | null {
    return this.translated && !this.editing ? this.run : null;
  }

  private shown(): Shown | undefined {
    const run = this.shownRun();
    if (!run) return undefined;
    const byLine = new Map<number, number>();
    run.units.forEach((u, i) => u.lineIds.forEach((id) => byLine.set(id, i)));
    return { units: run.units, states: run.states, byLine };
  }

  render(): void {
    const shown = this.shown();
    const layer = this.layer;
    if (layer) layer.innerHTML = ocrLayerHtml(this.page, this.edits, this.editing && this.mode === 'picture', shown);
    const pane = this.textPane;
    if (pane) pane.innerHTML = ocrTextHtml(this.page, this.edits, this.editing && this.mode === 'text', shown);
    this.root.classList.toggle('is-translated', !!shown);
    this.renderTranslateBar();
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
    layer.querySelectorAll<HTMLElement>('.ocr-tr-bg, .ocr-tr, .ocr-tr-miss').forEach((el) => this.fitUnit(el));
  }

  /** Translate button, language, progress and Retry. */
  private renderTranslateBar(): void {
    const tr = this.host.translator;
    const btn = this.root.querySelector<HTMLElement>('[data-ocr-act="translate"]');
    if (!tr || !btn) return;
    const on = this.translated && !this.editing;
    btn.setAttribute('aria-pressed', String(on));
    const sel = this.root.querySelector<HTMLSelectElement>('select[data-ocr-lang]');
    if (sel) {
      const langs = tr.languages.filter((l) => l.code && l.code !== 'auto');
      if (this.target && !langs.some((l) => l.code === this.target)) langs.push({ code: this.target, name: this.target });
      const opts = langs.map((l) => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
      if (sel.dataset.opts !== opts) {
        sel.innerHTML = opts;
        sel.dataset.opts = opts;
      }
      if (this.target) sel.value = this.target;
      sel.hidden = !on || !this.target;
    }
    const status = this.root.querySelector<HTMLElement>('.ocr-bar__tr');
    const retry = this.root.querySelector<HTMLElement>('[data-ocr-act="retry"]');
    const run = this.run;
    let text = '';
    let canRetry = false;
    if (on) {
      const total = run?.units.length || 0;
      if (!run || run.target !== this.target) text = 'Translating';
      else if (run.pending) text = `Translating ${total - run.pending} of ${total}`;
      else if (run.failed) {
        text = `${run.failed} not translated`;
        canRetry = true;
      } else if (!run.done && total) {
        const name = tr.languages.find((l) => l.code === run.target)?.name || run.target;
        text = `Already in ${name}`;
      }
    }
    if (status) {
      status.textContent = text;
      status.hidden = !text;
    }
    if (retry) retry.hidden = !canRetry;
  }

  /** Repaint once per frame while translations arrive. */
  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    const go = () => {
      this.renderQueued = false;
      this.render();
    };
    // A hidden window runs no frames; its translations are still placed, so Copy all and Save image see them.
    if (typeof requestAnimationFrame === 'function' && !document.hidden) requestAnimationFrame(go);
    else setTimeout(go, 16);
  }

  /**
   * Show the page translated into `to` (the setting when omitted). Paragraphs already
   * translated into that language show at once; the rest arrive one by one.
   */
  async translate(to?: string): Promise<void> {
    const tr = this.host.translator;
    if (!tr) return;
    this.editing = false;
    this.translated = true;
    const units = translationUnits(this.page, this.edits);
    if (!to && this.target) to = this.target;
    if (!to) {
      this.render();
      to = await tr.target(ocrPageText(this.page, this.edits)).catch(() => 'en');
      if (!this.translated) return;
    }
    const same =
      this.run && this.run.target === to && this.run.units.length === units.length && this.run.units.every((u, i) => u.text === units[i].text);
    this.target = to;
    if (same) {
      this.render();
      return;
    }
    this.run?.stop();
    this.flows.clear();
    this.seen.clear();
    const run = new PageTranslation(units, to, (t, l) => tr.translate(t, l), () => {
      if (this.run === run) this.queueRender();
    });
    this.run = run;
    this.render();
    await run.run();
    if (this.run === run) this.queueRender();
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
    // Translated runs keep their own text, with the spaces where their lines wrap kept hidden.
    if (this.shownRun()) return range.toString();
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
      case 'translate':
        if (this.translated && !this.editing) {
          this.translated = false;
          this.render();
        } else await this.translate();
        return;
      case 'retry':
        if (this.run) await this.run.retry();
        return;
      case 'edit':
        this.editing = !this.editing;
        if (this.editing) this.translated = false;
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

  /** Background, ink and type of a translated paragraph, sampled from its pixels. */
  private lookFor(i: number): Look {
    const hit = this.looks.get(i);
    if (hit) return hit;
    const unit = this.run!.units[i];
    const paints = unit.lineIds.map((id) => this.paint(id)).filter((p): p is Paint => !!p);
    const ink = paints[0]?.ink || 'rgb(20, 20, 20)';
    const serif = paints.filter((p) => p.serif).length * 2 > paints.length;
    const bold = paints.filter((p) => this.bold(p)).length * 2 > paints.length;
    const ring = this.ringAround(unit);
    const fallback = parseRgb(paints[0]?.bg) || [255, 255, 255];
    const top = ring?.top || fallback, bottom = ring?.bottom || fallback;
    const avg = [0, 1, 2].map((k) => Math.round((top[k] + bottom[k]) / 2));
    // A background that changes across the paragraph (light falling on a photo) is painted as a gradient.
    const graded = Math.abs(top[0] - bottom[0]) + Math.abs(top[1] - bottom[1]) + Math.abs(top[2] - bottom[2]) > 24;
    const look: Look = {
      top: rgb(graded ? top : avg),
      bottom: rgb(graded ? bottom : avg),
      edge: rgb(avg),
      patch: ring?.patch || null,
      ink: contrasting(parseRgb(ink) || [20, 20, 20], avg),
      weight: bold ? 700 : 400,
      family: serif ? SERIF : FONT,
    };
    this.looks.set(i, look);
    return look;
  }

  /**
   * The background around a unit, sampled on a ring just outside its padded area. A ring of one
   * colour (a screenshot) gives that colour, top and bottom. A ring of many (a photo, a
   * chalkboard) also gives a patch that fills the area from the pixels on either side of its
   * short dimension (above and below a line, left and right of a column), the simplest
   * inpainting, so texture and light carry across.
   */
  private ringAround(unit: OcrUnit): { top: number[]; bottom: number[]; patch: HTMLCanvasElement | null } | null {
    this.loadPixels();
    const px = this.pixels;
    if (!px) return null;
    const { x, y, w, h, angle } = unit.area;
    const m = unit.size * PAD;
    const r = m + Math.max(1, unit.size * 0.1);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const at = (a: number, b: number): number[] | null => {
      const xx = Math.round((x + a * ux - b * uy) * px.s), yy = Math.round((y + a * uy + b * ux) * px.s);
      if (xx < 0 || yy < 0 || xx >= px.w || yy >= px.h) return null;
      const i = (yy * px.w + xx) * 4;
      return [px.data[i], px.data[i + 1], px.data[i + 2]];
    };
    const na = Math.max(8, Math.min(160, Math.round(w * px.s)));
    const nb = Math.max(8, Math.min(160, Math.round(h * px.s)));
    const above: (number[] | null)[] = [], below: (number[] | null)[] = [];
    const left: (number[] | null)[] = [], right: (number[] | null)[] = [];
    for (let k = 0; k <= na; k++) {
      const a = -m + ((w + 2 * m) * k) / na;
      above.push(at(a, -r));
      below.push(at(a, h + r));
    }
    for (let j = 0; j <= nb; j++) {
      const b = -m + ((h + 2 * m) * j) / nb;
      left.push(at(-r, b));
      right.push(at(w + r, b));
    }
    const some = (xs: (number[] | null)[]) => xs.filter((q): q is number[] => !!q);
    const half = (xs: (number[] | null)[], first: boolean) => xs.slice(first ? 0 : xs.length >> 1, first ? (xs.length + 1) >> 1 : xs.length);
    // Pixels inside the area count too: a rule or a border along one side of the ring is
    // common there, but the background is commoner inside, where text covers the least.
    const inTop: number[][] = [], inBottom: number[][] = [];
    for (let j = 0; j <= 12; j++) {
      const b = (h * j) / 12;
      for (let k = 0; k <= 24; k++) {
        const q = at((w * k) / 24, b);
        if (q) (b < h / 2 ? inTop : inBottom).push(q);
      }
    }
    const topPts = [...some(above), ...some(half(left, true)), ...some(half(right, true)), ...inTop];
    const botPts = [...some(below), ...some(half(left, false)), ...some(half(right, false)), ...inBottom];
    if (!topPts.length || !botPts.length) return null;
    // Between the letters of a screenshot is one colour, give or take JPEG noise. When most of
    // the inside is one colour, that is the background, whatever a border, a neighbouring bar
    // or the gap between table rows puts on the ring.
    const inside = [...inTop, ...inBottom];
    if (inside.length) {
      const c = commonest(inside);
      const close = (q: number[]) => Math.abs(q[0] - c[0]) + Math.abs(q[1] - c[1]) + Math.abs(q[2] - c[2]) < 24;
      if (inside.filter(close).length >= inside.length * 0.55) return { top: c, bottom: c, patch: null };
    }
    const top = commonest(topPts), bottom = commonest(botPts);
    // A screenshot's background is one exact colour; a photo's spreads over many shades.
    const all = [...topPts, ...botPts];
    const near = (q: number[], c: number[]) => Math.abs(q[0] - c[0]) + Math.abs(q[1] - c[1]) + Math.abs(q[2] - c[2]) < 12;
    const flat = all.filter((q) => near(q, top) || near(q, bottom)).length >= all.length * 0.45;
    if (flat) return { top, bottom, patch: null };
    const tall = h > w;
    return { top, bottom, patch: tall ? this.patch(left, right, top, bottom, na + 1, false) : this.patch(above, below, top, bottom, nb + 1, true) };
  }

  /**
   * Fill from one side's pixels to the other's, each smoothed by a median over its neighbours.
   * `down`: the sides are above and below (one column per sample); otherwise left and right
   * (one row per sample).
   */
  private patch(first: (number[] | null)[], second: (number[] | null)[], c1: number[], c2: number[], steps: number, down: boolean): HTMLCanvasElement | null {
    const n = first.length;
    const c = document.createElement('canvas');
    c.width = down ? n : steps;
    c.height = down ? steps : n;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(c.width, c.height);
    const span = Math.max(2, Math.round(n / 24));
    const smooth = (side: (number[] | null)[], k: number, fallback: number[]) => {
      const win = side.slice(Math.max(0, k - span), k + span + 1).filter((q): q is number[] => !!q);
      if (!win.length) return fallback;
      return [0, 1, 2].map((ch) => win.map((q) => q[ch]).sort((a, b) => a - b)[win.length >> 1]);
    };
    for (let k = 0; k < n; k++) {
      const t = smooth(first, k, c1), b = smooth(second, k, c2);
      for (let j = 0; j < steps; j++) {
        const f = steps > 1 ? j / (steps - 1) : 0.5;
        const o = down ? (j * c.width + k) * 4 : (k * c.width + j) * 4;
        img.data[o] = t[0] + (b[0] - t[0]) * f;
        img.data[o + 1] = t[1] + (b[1] - t[1]) * f;
        img.data[o + 2] = t[2] + (b[2] - t[2]) * f;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** The translation of unit `i` laid out in its area, in picture pixels. */
  private flowFor(i: number, text: string, look: Look): OcrFlow {
    const key = `${this.target}\u0001${look.weight}\u0001${look.family}\u0001${text}`;
    const hit = this.flows.get(i);
    if (hit && hit.key === key) return hit.flow;
    const ctx = this.measure;
    const measure = ctx
      ? (t: string, size: number) => {
          ctx.font = `${look.weight} ${size}px ${look.family}`;
          return ctx.measureText(t).width;
        }
      : roughMeasure;
    const flow = reflow(text, this.run!.units[i], this.target, measure);
    this.flows.set(i, { key, flow });
    return flow;
  }

  /** Place a translated paragraph (or a failed one's outline) over its area at the current scale. */
  private fitUnit(el: HTMLElement): void {
    const i = Number(el.dataset.u);
    const run = this.run;
    const unit = run?.units[i];
    if (!run || !unit) return;
    const s = this.scale();
    const a = unit.area;
    const st = el.style;
    st.left = `${a.x * s}px`;
    st.top = `${a.y * s}px`;
    st.width = `${a.w * s}px`;
    st.height = `${a.h * s}px`;
    st.transform = a.angle ? `rotate(${a.angle}rad)` : '';
    const state = run.states[i];
    if (state.status !== 'done' || el.classList.contains('ocr-tr-miss')) return;
    const look = this.lookFor(i);
    const flow = this.flowFor(i, state.text, look);
    if (el.classList.contains('ocr-tr-bg')) {
      // The paint reaches a little past the area, so no edge of the original shows, and under
      // the whole translation where it ran into the room beside the area.
      const m = unit.size * PAD * s;
      const [e0, e1] = paintSpan(unit, flow);
      st.width = `${(e1 - e0) * s + 2 * m}px`;
      st.height = `${a.h * s + 2 * m}px`;
      st.transform = `${a.angle ? `rotate(${a.angle}rad) ` : ''}translate(${e0 * s - m}px, ${-m}px)`;
      if (look.patch) {
        if (!look.patchUrl) look.patchUrl = look.patch.toDataURL();
        st.background = `${look.edge} url(${look.patchUrl}) 0 0 / 100% 100% no-repeat`;
      } else st.background = look.top === look.bottom ? look.top : `linear-gradient(${look.top}, ${look.bottom})`;
      if (!this.seen.has(i)) el.classList.add('is-new');
      return;
    }
    const b = unit.box;
    // Across: the box. Along: where the flow starts and how far it runs (the box, unless widened).
    const off = flow.vertical ? 0 : flow.start;
    st.left = `${(b.x + off * Math.cos(a.angle)) * s}px`;
    st.top = `${(b.y + off * Math.sin(a.angle)) * s}px`;
    st.width = `${(flow.vertical ? b.w : flow.span) * s}px`;
    st.height = `${b.h * s}px`;
    st.color = look.ink;
    st.fontFamily = look.family;
    st.fontWeight = String(look.weight);
    st.fontSize = `${flow.size * s}px`;
    st.lineHeight = `${flow.pitch * s}px`;
    st.textAlign = unit.align === 'center' && !flow.vertical ? 'center' : 'start';
    el.classList.toggle('is-v', flow.vertical);
    let inner = el.firstElementChild as HTMLElement | null;
    if (!inner || !inner.classList.contains('ocr-tr-t')) {
      el.textContent = '';
      inner = document.createElement('span');
      inner.className = 'ocr-tr-t';
      el.appendChild(inner);
    }
    const k = flow.lines.join('\n');
    if (inner.dataset.k !== k) {
      inner.innerHTML = linesHtml(state.text, flow.lines);
      inner.dataset.k = k;
    }
    // Each line's glyphs centred on its pitch, the first line starting at the area's edge.
    inner.style.marginBlockStart = `${(-(flow.pitch - flow.size) / 2) * s}px`;
    if (!this.seen.has(i)) {
      this.seen.add(i);
      el.classList.add('is-new');
    }
  }

  /** Draw a translated paragraph into the saved picture, the way fitUnit shows it. */
  private drawUnit(ctx: CanvasRenderingContext2D, i: number, text: string, pass: 'background' | 'text'): void {
    const unit = this.run!.units[i];
    const look = this.lookFor(i);
    const flow = this.flowFor(i, text, look);
    const a = unit.area;
    const m = unit.size * PAD;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle);
    if (pass === 'background') {
      const [e0, e1] = paintSpan(unit, flow);
      ctx.fillStyle = look.edge;
      ctx.fillRect(e0 - m, -m, e1 - e0 + 2 * m, a.h + 2 * m);
      if (look.patch) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(look.patch, e0 - m, -m, e1 - e0 + 2 * m, a.h + 2 * m);
      } else if (look.top !== look.bottom) {
        const g = ctx.createLinearGradient(0, 0, 0, a.h);
        g.addColorStop(0, look.top);
        g.addColorStop(1, look.bottom);
        ctx.fillStyle = g;
        ctx.fillRect(e0, 0, e1 - e0, a.h);
      }
      ctx.restore();
      return;
    }
    // The text is set in the box, which differs from the area only on an unturned page.
    ctx.translate(unit.box.x - a.x, unit.box.y - a.y);
    const bw = unit.box.w;
    ctx.fillStyle = look.ink;
    ctx.font = `${look.weight} ${flow.size}px ${look.family}`;
    ctx.textBaseline = 'middle';
    flow.lines.forEach((ln, k) => {
      const mid = k * flow.pitch + flow.size / 2;
      if (!flow.vertical) {
        const w = ctx.measureText(ln).width;
        ctx.textAlign = 'left';
        ctx.fillText(ln, flow.start + (unit.align === 'center' ? (flow.span - w) / 2 : 0), mid);
        return;
      }
      // Columns right to left; CJK upright, other runs turned a quarter clockwise.
      const cx = bw - mid;
      let y = 0;
      for (const run of [...ln].reduce<string[]>((out, ch) => {
        const last = out[out.length - 1];
        if (!isCjkChar(ch) && last && !isCjkChar([...last][0])) out[out.length - 1] += ch;
        else out.push(ch);
        return out;
      }, [])) {
        if (isCjkChar([...run][0])) {
          ctx.textAlign = 'center';
          ctx.fillText(run, cx, y + flow.size / 2);
          y += flow.size;
        } else {
          ctx.save();
          ctx.translate(cx, y);
          ctx.rotate(Math.PI / 2);
          ctx.textAlign = 'left';
          ctx.fillText(run, 0, 0);
          ctx.restore();
          y += ctx.measureText(run).width;
        }
      }
    });
    ctx.restore();
  }

  /** The picture as shown: edited lines painted in, and the translation while it shows. PNG at the picture's own size. */
  async renderImage(): Promise<Blob> {
    const c = document.createElement('canvas');
    c.width = this.page.width;
    c.height = this.page.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.img, 0, 0, c.width, c.height);
    const shown = this.shown();
    for (const line of pageLines(this.page)) {
      if (!this.edits.has(line.id)) continue;
      const u = shown?.byLine.get(line.id);
      if (u !== undefined && shown!.states[u].status === 'done') continue;
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
    for (const pass of ['background', 'text'] as const) {
      shown?.states.forEach((st, i) => {
        if (st.status === 'done') this.drawUnit(ctx, i, st.text, pass);
      });
    }
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the image'))), 'image/png'));
  }
}

/** How far a translation's background reaches past its area, as a share of the font size. */
const PAD = 0.12;

/** The stretch along the area, from its start, that a unit's paint covers: the area, and any room its translation ran into. */
function paintSpan(unit: OcrUnit, flow: OcrFlow): [number, number] {
  if (flow.vertical) return [0, unit.area.w];
  const at = unit.box.x - unit.area.x + flow.start;
  return [Math.min(0, at), Math.max(unit.area.w, at + flow.span)];
}

/** The commonest colour of a set of pixels, in buckets of 16 levels a channel, averaged within its bucket. */
function commonest(pts: number[][]): number[] {
  const buckets = new Map<number, { n: number; sum: number[] }>();
  for (const p of pts) {
    const key = ((p[0] >> 4) << 8) | ((p[1] >> 4) << 4) | (p[2] >> 4);
    const b = buckets.get(key) || { n: 0, sum: [0, 0, 0] };
    b.n++;
    b.sum[0] += p[0];
    b.sum[1] += p[1];
    b.sum[2] += p[2];
    buckets.set(key, b);
  }
  let best = { n: 0, sum: [255, 255, 255] };
  for (const b of buckets.values()) if (b.n > best.n) best = b;
  return best.sum.map((v) => Math.round(v / Math.max(1, best.n)));
}

/** How a translated paragraph is painted. */
type Look = {
  top: string;
  bottom: string;
  edge: string;
  /** For a textured background: the area filled from the pixels around it (see ringAround). */
  patch: HTMLCanvasElement | null;
  patchUrl?: string;
  ink: string;
  weight: number;
  family: string;
};

const rgb = (c: number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

function parseRgb(s: string | undefined): number[] | null {
  const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(s || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** The sampled ink, or black or white when it would not read on the background. */
function contrasting(ink: number[], bg: number[]): string {
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (Math.abs(lum(ink) - lum(bg)) > 60) return rgb(ink);
  return lum(bg) > 128 ? 'rgb(20, 20, 20)' : 'rgb(245, 245, 245)';
}

/**
 * A translation's lines joined by line breaks. The space a break replaced is kept in a hidden
 * span, so a copy across the break reads as the sentence it was.
 */
function linesHtml(full: string, lines: string[]): string {
  let pos = 0;
  return lines
    .map((ln, k) => {
      const at = full.indexOf(ln, pos);
      const gap = k && at >= 0 ? full.slice(pos, at) : '';
      if (at >= 0) pos = at + ln.length;
      return (k ? `<span class="ocr-tr-sp">${esc(gap)}</span><br>` : '') + esc(ln);
    })
    .join('');
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
