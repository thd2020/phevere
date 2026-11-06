/**
 * Whole-image PP-OCR for the in-place text view: every detected line with its rotated box,
 * its confidence, and word boxes taken from the recogniser's own CTC time steps (the way
 * RapidOCR's return_word_box does), in the page shape of packages/core/src/ocr-layout.ts.
 *
 * GutenYe's Ocr.detect() is not used here: it drops lines scored under 0.5 and joins every box
 * whose midline matches across the whole image, which runs two columns together.
 */

import * as fs from 'fs';
import type { OcrQuad, OcrRawLine, OcrRawPage, OcrRawWord } from '@phevere/core/ocr-layout';
import { subQuad } from '@phevere/core/ocr-layout';

export type CtcChar = { ch: string; t: number; p: number };

/** Greedy CTC decode of one line: characters with the time step they peak at. */
export function decodeCtc(data: ArrayLike<number>, steps: number, classes: number, dict: string[]): CtcChar[] {
  const out: CtcChar[] = [];
  let prev = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestP = -Infinity;
    const base = t * classes;
    for (let c = 0; c < classes; c++) {
      const v = data[base + c];
      if (v > bestP) {
        bestP = v;
        best = c;
      }
    }
    if (best !== 0 && best !== prev) {
      const ch = dict[best - 1];
      if (ch !== undefined) out.push({ ch, t, p: bestP });
    }
    prev = best;
  }
  return out;
}

/**
 * Words of a decoded line with their spans as fractions of the line crop's width. A word runs
 * from half a character pitch before its first peak to half a pitch after its last.
 */
export function ctcWords(chars: CtcChar[], steps: number): { text: string; t0: number; t1: number; p: number }[] {
  const glyphs = chars.filter((c) => c.ch.trim());
  if (!glyphs.length || steps < 1) return [];
  const span = glyphs.length > 1 ? (glyphs[glyphs.length - 1].t - glyphs[0].t) / (glyphs.length - 1) : 2;
  const pitch = Math.max(1, span);
  const words: { chars: CtcChar[] }[] = [];
  let cur: CtcChar[] = [];
  const cjk = /[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
  for (const c of chars) {
    if (!c.ch.trim()) {
      if (cur.length) words.push({ chars: cur });
      cur = [];
      continue;
    }
    // CJK characters are words of their own; a CJK character next to Latin ends the run.
    const prevCjk = cur.length ? cjk.test(cur[cur.length - 1].ch) : false;
    if (cur.length && (cjk.test(c.ch) || prevCjk)) {
      words.push({ chars: cur });
      cur = [];
    }
    cur.push(c);
  }
  if (cur.length) words.push({ chars: cur });
  return words.map((w) => {
    const a = w.chars[0].t, b = w.chars[w.chars.length - 1].t;
    const t0 = Math.max(0, (a + 0.5 - pitch / 2) / steps);
    const t1 = Math.min(1, (b + 0.5 + pitch / 2) / steps);
    const p = w.chars.reduce((s, c) => s + c.p, 0) / w.chars.length;
    return { text: w.chars.map((c) => c.ch).join(''), t0, t1, p };
  });
}

/** Reading-direction quad of a detected box; crops 1.5 times taller than wide are read top to bottom. */
export function readingQuad(box: number[][]): { quad: OcrQuad; rotated: boolean } {
  const p = box.map((q) => [Number(q[0]), Number(q[1])] as [number, number]);
  const w = Math.max(Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), Math.hypot(p[2][0] - p[3][0], p[2][1] - p[3][1]));
  const h = Math.max(Math.hypot(p[3][0] - p[0][0], p[3][1] - p[0][1]), Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]));
  if (h / Math.max(1, w) >= 1.5) return { quad: [p[1], p[2], p[3], p[0]], rotated: true };
  return { quad: [p[0], p[1], p[2], p[3]], rotated: false };
}

/** The detector and recogniser sessions, shared with the engine that reads screen regions. */
export type PpOcrModels = { detection: any; recognition: any };

export class PpOcrPageReader {
  private det: any = null;
  private rec: any = null;
  private dict: string[] = [];
  private ready: Promise<void> | null = null;

  constructor(
    private readonly dictPath: string,
    private readonly models: () => Promise<PpOcrModels>,
  ) {}

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const m = await this.models();
        this.det = m.detection;
        this.rec = m.recognition;
        this.dict = [...fs.readFileSync(this.dictPath, 'utf8').split('\n').map((s) => s.replace(/\r$/, '')), ' '];
      })().catch((e) => {
        this.ready = null;
        throw e;
      });
    }
    return this.ready;
  }

  /** Read a PNG file of `width` by `height` pixels into raw page lines in its pixel space. */
  async read(file: string, width: number, height: number, opts: { keepCtc?: boolean } = {}): Promise<OcrRawPage> {
    await this.ensure();
    const lineImages: { box: number[][]; image: any }[] = await this.det.run(file);
    // Boxes are in the detector's input, which is resized to multiples of 32.
    const sx = width / Math.max(32, Math.ceil(width / 32) * 32);
    const sy = height / Math.max(32, Math.ceil(height / 32) * 32);
    const lines: OcrRawLine[] = [];
    for (const li of lineImages) {
      if (!li?.box || li.box.length < 4 || !li.image) continue;
      const image = await li.image.resize({ height: 48 });
      const modelData = this.rec.imageToInput(image, {});
      const output = await this.rec.runModel({ modelData });
      const steps = Number(output.dims[1]);
      const classes = Number(output.dims[2]);
      const chars = decodeCtc(output.data, steps, classes, this.dict);
      const text = chars.map((c) => c.ch).join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const scaled = li.box.map((p) => [Number(p[0]) * sx, Number(p[1]) * sy]);
      const { quad } = readingQuad(scaled);
      // Time steps cover the resized crop, whose width the recogniser may pad; scale to the crop.
      const used = Math.min(steps, Math.ceil((image.width || steps * 8) / 8)) || steps;
      const words: OcrRawWord[] = ctcWords(chars, used).map((w) => ({
        text: w.text,
        quad: subQuad(quad, w.t0, w.t1),
        confidence: w.p,
      }));
      const confidence = chars.length ? chars.reduce((s, c) => s + c.p, 0) / chars.length : undefined;
      const line: OcrRawLine & { ctc?: unknown } = { text, quad, confidence, words: words.length ? words : undefined };
      if (opts.keepCtc) line.ctc = { chars, steps: used };
      lines.push(line);
    }
    return { width, height, engine: 'pp-ocr', lines };
  }
}
