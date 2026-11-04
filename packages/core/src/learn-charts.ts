/**
 * Charts of the Learn tab, shared by the Today and Progress pages on desktop and phone: bar charts
 * with axes, gridlines and a readout that names the day (or bucket) under the pointer or finger,
 * a calendar heatmap with month and weekday labels, and the retention chart with its "stop
 * reviewing for N days" slider.
 *
 * Rendering is pure HTML and SVG. `attachLearnCharts` adds the pointer, keyboard and slider
 * behaviour; each shell calls it after painting Learn. Without it every chart still shows its
 * numbers and its default readout.
 *
 * Hooks: data-lrc (a chart), data-i (a bar or cell), template[data-for] (its readout),
 * data-lrc-readout, data-lrc-range (the slider), data-lrc-word (a word whose curve to draw).
 */
import { esc } from './notebook-shared';
import { DESIRED_RETENTION, recallAt } from './review-schedule';

const DAY = 86_400_000;
const fmt = (n: number) => n.toLocaleString('en-US');

/* --------------------------------------------------------------- bar chart */

export interface BarSegment {
  /** CSS modifier for the segment colour: lrc-seg--<cls>. */
  cls: string;
  value: number;
}

export interface BarDatum {
  /** Label under the bar (blank to skip). */
  tick: string;
  /** A second, quieter line under the tick (weekday, unit). */
  sub?: string;
  segments: BarSegment[];
  /** Readout HTML when this bar is pointed at or picked. */
  detail: string;
  /** Today, or the bar to stress. */
  mark?: boolean;
  /** Spoken label for the bar. */
  aria: string;
}

export interface BarChartSpec {
  id: string;
  data: BarDatum[];
  /** Name of the y axis, with its unit ("words due"). */
  yLabel: string;
  legend?: Array<{ cls: string; name: string }>;
  /** Readout before anything is picked. */
  summary: string;
  /** Bar shown in the readout at first (picked). */
  picked?: number;
  height?: number;
}

/** A round top for the y axis and two or three gridlines under it (0, 5, 10 / 0, 20, 40 …). */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 2;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) || rough;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function legendHtml(legend: BarChartSpec['legend']): string {
  if (!legend?.length) return '';
  return `<p class="lrc-legend">${legend.map((l) => `<span><i class="lrc-seg--${esc(l.cls)}"></i>${esc(l.name)}</span>`).join('')}</p>`;
}

export function barChartHtml(spec: BarChartSpec): string {
  const W = 320;
  const H = spec.height ?? 162;
  const left = 30;
  const right = 4;
  const top = 24;
  const subRow = spec.data.some((d) => d.sub);
  const base = H - (subRow ? 30 : 18);
  const n = Math.max(1, spec.data.length);
  const bw = (W - left - right) / n;
  const totals = spec.data.map((d) => d.segments.reduce((s, x) => s + x.value, 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const yMax = ticks[ticks.length - 1] || 1;
  const y = (v: number) => base - ((base - top) * v) / yMax;
  const grid = ticks
    .map((t) => `<line class="lrc-grid${t === 0 ? ' is-base' : ''}" x1="${left}" x2="${W - right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="lrc-ytick" x="${left - 5}" y="${(y(t) + 3).toFixed(1)}">${fmt(t)}</text>`)
    .join('');
  const gap = Math.min(4, bw * 0.28);
  const bars = spec.data
    .map((d, i) => {
      const x = left + i * bw + gap / 2;
      const w = Math.max(1, bw - gap);
      let acc = 0;
      const segs = d.segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const y0 = y(acc);
          acc += s.value;
          const y1 = y(acc);
          return `<rect class="lrc-seg lrc-seg--${esc(s.cls)}" x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" rx="${Math.min(2.5, w / 3).toFixed(1)}"/>`;
        })
        .join('');
      const cx = x + w / 2;
      const tick = d.tick ? `<text class="lrc-xtick${d.mark ? ' is-mark' : ''}" x="${cx.toFixed(1)}" y="${base + 13}">${esc(d.tick)}</text>` : '';
      const sub = d.sub ? `<text class="lrc-xsub${d.mark ? ' is-mark' : ''}" x="${cx.toFixed(1)}" y="${base + 25}">${esc(d.sub)}</text>` : '';
      const value = totals[i] && bw >= 14 ? `<text class="lrc-val" x="${cx.toFixed(1)}" y="${(y(totals[i]) - 4).toFixed(1)}">${fmt(totals[i])}</text>` : '';
      return `<g class="lrc-bar${d.mark ? ' is-mark' : ''}${spec.picked === i ? ' is-picked' : ''}" data-i="${i}">
        <rect class="lrc-hit" x="${(left + i * bw).toFixed(1)}" y="${top - 6}" width="${bw.toFixed(1)}" height="${(base - top + 6 + (subRow ? 28 : 16)).toFixed(1)}" tabindex="0" role="button" aria-label="${esc(d.aria)}"/>
        <rect class="lrc-col" x="${(left + i * bw).toFixed(1)}" y="${top - 6}" width="${bw.toFixed(1)}" height="${(base - top + 6).toFixed(1)}"/>
        ${segs || `<rect class="lrc-seg lrc-seg--none" x="${x.toFixed(1)}" y="${base - 1}" width="${w.toFixed(1)}" height="1"/>`}${value}${tick}${sub}
      </g>`;
    })
    .join('');
  const templates = spec.data.map((d, i) => `<template data-for="${i}">${d.detail}</template>`).join('');
  const first = spec.picked != null && spec.data[spec.picked] ? spec.data[spec.picked].detail : spec.summary;
  return `<div class="lrc lrc--bars" data-lrc="${esc(spec.id)}"${spec.picked != null ? ` data-picked="${spec.picked}"` : ''}>
    <svg class="lrc-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(spec.yLabel)}">
      <text class="lrc-ylabel" x="0" y="9">${esc(spec.yLabel)}</text>
      ${grid}${bars}
    </svg>
    ${legendHtml(spec.legend)}
    <div class="lrc-readout" data-lrc-readout aria-live="polite">${first}</div>
    <template data-for="summary">${spec.summary}</template>${templates}
  </div>`;
}

/* ----------------------------------------------------------------- heatmap */

export interface HeatCell {
  day: number;
  count: number;
  detail: string;
}

export interface HeatmapSpec {
  id: string;
  /** One cell per day, oldest first, ending today. */
  cells: HeatCell[];
  /** What a cell counts ("saved"). */
  noun: string;
  summary: string;
}

/** Weeks as columns starting on Monday, months over the columns where they begin, Mon, Wed and Fri down the side. */
export function heatmapHtml(spec: HeatmapSpec): string {
  const cell = 12;
  const gap = 3;
  const left = 26;
  const top = 14;
  const first = new Date(spec.cells[0]?.day ?? Date.now());
  const lead = (first.getDay() + 6) % 7; // rows before the first day in its week (Monday first)
  const max = Math.max(1, ...spec.cells.map((c) => c.count));
  const level = (c: number) => (c ? Math.min(4, Math.ceil((c / max) * 4)) : 0);
  let months = '';
  let lastMonth = -1;
  const rects = spec.cells
    .map((c, i) => {
      const pos = i + lead;
      const col = Math.floor(pos / 7);
      const row = pos % 7;
      const d = new Date(c.day);
      if (d.getMonth() !== lastMonth && (row === 0 || i === 0)) {
        lastMonth = d.getMonth();
        months += `<text class="lrc-month" x="${left + col * (cell + gap)}" y="${top - 4}">${esc(d.toLocaleDateString('en-US', { month: 'short' }))}</text>`;
      }
      const x = left + col * (cell + gap);
      const yy = top + row * (cell + gap);
      const label = `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}: ${c.count} ${spec.noun}`;
      return `<rect class="lrc-heat lrc-heat--${level(c.count)}${i === spec.cells.length - 1 ? ' is-mark' : ''}" data-i="${i}" x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="2.5" tabindex="0" role="button" aria-label="${esc(label)}"/>`;
    })
    .join('');
  const cols = Math.ceil((spec.cells.length + lead) / 7);
  const days = ['Mon', '', 'Wed', '', 'Fri', '', '']
    .map((d, r) => (d ? `<text class="lrc-wday" x="0" y="${top + r * (cell + gap) + cell - 2}">${d}</text>` : ''))
    .join('');
  const W = left + cols * (cell + gap);
  const H = top + 7 * (cell + gap);
  const templates = spec.cells.map((c, i) => `<template data-for="${i}">${c.detail}</template>`).join('');
  const key = [0, 1, 2, 3, 4].map((l) => `<i class="lrc-heat-key lrc-heat--${l}"></i>`).join('');
  return `<div class="lrc lrc--heat" data-lrc="${esc(spec.id)}">
    <svg class="lrc-svg lrc-svg--heat" viewBox="0 0 ${W} ${H}" role="group" aria-label="Words ${esc(spec.noun)} per day">${months}${days}${rects}</svg>
    <p class="lrc-legend lrc-legend--heat"><span>0</span>${key}<span>${fmt(max)} a day</span></p>
    <div class="lrc-readout" data-lrc-readout aria-live="polite">${spec.summary}</div>
    <template data-for="summary">${spec.summary}</template>${templates}
  </div>`;
}

/* --------------------------------------------------------------- retention */

export interface RetentionWord {
  lemma: string;
  stability: number;
  lastReview: number;
}

export interface RetentionSpec {
  id: string;
  words: RetentionWord[];
  now: number;
  /** Days on the slider at first. */
  days?: number;
  /** The slider's end. */
  maxDays?: number;
}

export interface RetentionAt {
  days: number;
  average: number;
  /** Words still at or above the target retention. */
  above: number;
  /** The words lowest at that point, weakest first. */
  weakest: Array<{ lemma: string; recall: number }>;
}

/** Recall of the words if no review happened for `days` from now. */
export function retentionAt(words: RetentionWord[], now: number, days: number, weakest = 6): RetentionAt {
  const at = now + days * DAY;
  const list = words.map((w) => ({ lemma: w.lemma, recall: recallAt(w.stability, w.lastReview, at) }));
  const average = list.length ? list.reduce((s, w) => s + w.recall, 0) / list.length : 0;
  const above = list.filter((w) => w.recall >= DESIRED_RETENTION - 1e-9).length;
  list.sort((a, b) => a.recall - b.recall || a.lemma.localeCompare(b.lemma));
  return { days, average, above, weakest: list.slice(0, weakest) };
}

const R_W = 320;
const R_H = 182;
const R_LEFT = 32;
const R_TOP = 24;
const R_BASE = R_H - 26;
const R_LO = 0;

function rx(day: number, maxDays: number): number {
  return R_LEFT + ((R_W - R_LEFT - 6) * day) / maxDays;
}
function ry(r: number): number {
  return R_TOP + (R_BASE - R_TOP) * (1 - (Math.max(R_LO, Math.min(1, r)) - R_LO) / (1 - R_LO));
}

/** The polyline points of one curve, sampled every day from now. */
export function curvePoints(f: (day: number) => number, maxDays: number): string {
  const pts: string[] = [];
  for (let d = 0; d <= maxDays; d++) pts.push(`${rx(d, maxDays).toFixed(1)},${ry(f(d)).toFixed(1)}`);
  return pts.join(' ');
}

function retentionReadout(r: RetentionAt, total: number): string {
  const when = r.days === 0 ? 'Now' : `After ${r.days} ${r.days === 1 ? 'day' : 'days'} without review`;
  const weak = r.weakest
    .map((w) => `<button type="button" class="lrc-word" data-lrc-word="${esc(w.lemma)}" aria-pressed="false">${esc(w.lemma)}<small>${Math.round(w.recall * 100)}%</small></button>`)
    .join('');
  return `<p class="lrc-read__head"><b>${when}</b></p>
    <p class="lrc-read__nums"><span><b>${Math.round(r.average * 100)}%</b> average recall</span><span><b>${fmt(r.above)}</b> of ${fmt(total)} words at ${Math.round(DESIRED_RETENTION * 100)}% or more</span></p>
    ${weak ? `<p class="lrc-read__label">Weakest by then</p><div class="lrc-words">${weak}</div>` : ''}`;
}

export function retentionHtml(spec: RetentionSpec): string {
  const maxDays = spec.maxDays ?? 60;
  const days = Math.max(0, Math.min(maxDays, spec.days ?? 14));
  const words = spec.words;
  const avg = (d: number) => retentionAt(words, spec.now, d, 0).average;
  const share = (d: number) => (words.length ? retentionAt(words, spec.now, d, 0).above / words.length : 0);
  const grid = [1, 0.9, 0.75, 0.5, 0.25, 0]
    .map((r) => {
      const target = Math.abs(r - DESIRED_RETENTION) < 1e-9;
      return `<line class="lrc-grid${target ? ' is-target' : ''}" x1="${R_LEFT}" x2="${R_W - 6}" y1="${ry(r).toFixed(1)}" y2="${ry(r).toFixed(1)}"/><text class="lrc-ytick${target ? ' is-target' : ''}" x="${R_LEFT - 5}" y="${(ry(r) + 3).toFixed(1)}">${Math.round(r * 100)}%</text>`;
    })
    .join('');
  const xt = [0, 7, 14, 30, maxDays]
    .filter((d, i, a) => d <= maxDays && a.indexOf(d) === i)
    .map((d) => `<text class="lrc-xtick" x="${rx(d, maxDays).toFixed(1)}" y="${R_BASE + 14}">${d === 0 ? 'Now' : `${d} d`}</text>`)
    .join('');
  const at = retentionAt(words, spec.now, days);
  const data = JSON.stringify({ now: spec.now, max: maxDays, words: words.map((w) => [w.lemma, Math.round(w.stability * 1000) / 1000, w.lastReview]) }).replace(/</g, '\\u003c');
  return `<div class="lrc lrc--retention" data-lrc="${esc(spec.id)}">
    <svg class="lrc-svg" viewBox="0 0 ${R_W} ${R_H}" role="img" aria-label="Predicted recall of your words if you stop reviewing">
      <text class="lrc-ylabel" x="0" y="9">Recall</text>
      ${grid}${xt}
      <text class="lrc-target" x="${R_W - 6}" y="${(ry(DESIRED_RETENTION) - 4).toFixed(1)}">Due at ${Math.round(DESIRED_RETENTION * 100)}% recall</text>
      <polyline class="lrc-line lrc-line--share" points="${curvePoints(share, maxDays)}"/>
      <polyline class="lrc-line lrc-line--avg" points="${curvePoints(avg, maxDays)}"/>
      <polyline class="lrc-line lrc-line--word" data-lrc-wordline points=""/>
      <line class="lrc-cursor" data-lrc-cursor x1="${rx(days, maxDays).toFixed(1)}" x2="${rx(days, maxDays).toFixed(1)}" y1="${R_TOP}" y2="${R_BASE}"/>
      <circle class="lrc-dot" data-lrc-dot cx="${rx(days, maxDays).toFixed(1)}" cy="${ry(at.average).toFixed(1)}" r="4"/>
    </svg>
    <p class="lrc-legend"><span><i class="lrc-seg--avg"></i>Average recall</span><span><i class="lrc-seg--share"></i>Words at ${Math.round(DESIRED_RETENTION * 100)}% or more</span><span data-lrc-wordkey hidden><i class="lrc-seg--word"></i><b></b></span></p>
    <label class="lrc-range"><span>Stop reviewing for</span><input type="range" min="0" max="${maxDays}" step="1" value="${days}" data-lrc-range aria-label="Days without review"/><output data-lrc-days>${days} ${days === 1 ? 'day' : 'days'}</output></label>
    <div class="lrc-readout lrc-readout--retention" data-lrc-readout aria-live="polite">${retentionReadout(at, words.length)}</div>
    <script type="application/json" data-lrc-data>${data}</script>
  </div>`;
}

/* ------------------------------------------------------------------ wiring */

const wired = new WeakSet<HTMLElement>();

function show(chart: HTMLElement, key: string): void {
  const tpl = chart.querySelector<HTMLTemplateElement>(`template[data-for="${key}"]`);
  const out = chart.querySelector<HTMLElement>('[data-lrc-readout]');
  if (!tpl || !out) return;
  out.innerHTML = tpl.innerHTML;
}

function rest(chart: HTMLElement): void {
  const picked = chart.dataset.picked;
  show(chart, picked != null && picked !== '' ? picked : 'summary');
  chart.querySelectorAll('[data-i].is-hover').forEach((el: Element) => el.classList.remove('is-hover'));
}

function pick(chart: HTMLElement, i: string | null): void {
  chart.querySelectorAll('[data-i].is-picked').forEach((el: Element) => el.classList.remove('is-picked'));
  if (i == null || chart.dataset.picked === i) {
    delete chart.dataset.picked;
  } else {
    chart.dataset.picked = i;
    chart.querySelector(`[data-i="${i}"]`)?.classList.add('is-picked');
  }
  rest(chart);
}

function itemOf(target: EventTarget | null, chart: HTMLElement): HTMLElement | null {
  const el = (target as Element | null)?.closest?.('[data-i]') as HTMLElement | null;
  return el && chart.contains(el) ? el : null;
}

function wireRetention(chart: HTMLElement): void {
  let data: { now: number; max: number; words: Array<[string, number, number]> };
  try {
    data = JSON.parse(chart.querySelector('[data-lrc-data]')?.textContent || '');
  } catch {
    return;
  }
  const words: RetentionWord[] = data.words.map(([lemma, stability, lastReview]) => ({ lemma, stability, lastReview }));
  const range = chart.querySelector<HTMLInputElement>('[data-lrc-range]');
  const out = chart.querySelector<HTMLElement>('[data-lrc-readout]');
  const label = chart.querySelector<HTMLElement>('[data-lrc-days]');
  const cursor = chart.querySelector<SVGLineElement>('[data-lrc-cursor]');
  const dot = chart.querySelector<SVGCircleElement>('[data-lrc-dot]');
  const line = chart.querySelector<SVGPolylineElement>('[data-lrc-wordline]');
  const key = chart.querySelector<HTMLElement>('[data-lrc-wordkey]');
  let word = '';
  const drawWord = () => {
    const w = words.find((x) => x.lemma === word);
    if (!line || !key) return;
    if (!w) {
      line.setAttribute('points', '');
      key.hidden = true;
      return;
    }
    line.setAttribute('points', curvePoints((d) => recallAt(w.stability, w.lastReview, data.now + d * DAY), data.max));
    key.hidden = false;
    const b = key.querySelector('b');
    if (b) b.textContent = w.lemma;
  };
  const update = () => {
    const days = Number(range?.value || 0);
    const r = retentionAt(words, data.now, days);
    if (label) label.textContent = `${days} ${days === 1 ? 'day' : 'days'}`;
    const x = rx(days, data.max).toFixed(1);
    cursor?.setAttribute('x1', x);
    cursor?.setAttribute('x2', x);
    dot?.setAttribute('cx', x);
    dot?.setAttribute('cy', ry(r.average).toFixed(1));
    if (word && !r.weakest.some((w) => w.lemma === word)) {
      const w = words.find((x) => x.lemma === word);
      if (w) r.weakest.push({ lemma: w.lemma, recall: recallAt(w.stability, w.lastReview, data.now + days * DAY) });
    }
    if (out) out.innerHTML = retentionReadout(r, words.length);
    out?.querySelectorAll<HTMLElement>('[data-lrc-word]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lrcWord === word)));
  };
  range?.addEventListener('input', update);
  chart.addEventListener('click', (ev) => {
    const b = (ev.target as Element | null)?.closest?.('[data-lrc-word]') as HTMLElement | null;
    if (!b) return;
    word = word === b.dataset.lrcWord ? '' : b.dataset.lrcWord || '';
    drawWord();
    update();
  });
}

/** Pointer, touch and keyboard behaviour for every chart under `root`; safe to call after each paint. */
export function attachLearnCharts(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-lrc]').forEach((chart) => {
    if (wired.has(chart)) return;
    wired.add(chart);
    if (chart.classList.contains('lrc--retention')) {
      wireRetention(chart);
      return;
    }
    chart.addEventListener('pointerover', (ev) => {
      if ((ev as PointerEvent).pointerType === 'touch') return;
      const el = itemOf(ev.target, chart);
      if (!el) return;
      chart.querySelectorAll('[data-i].is-hover').forEach((x: Element) => x.classList.remove('is-hover'));
      el.classList.add('is-hover');
      show(chart, el.dataset.i || 'summary');
    });
    chart.querySelector('svg')?.addEventListener('pointerleave', () => rest(chart));
    chart.addEventListener('click', (ev) => {
      const el = itemOf(ev.target, chart);
      if (el) pick(chart, el.dataset.i || null);
    });
    chart.addEventListener('focusin', (ev) => {
      const el = itemOf(ev.target, chart);
      if (el) show(chart, el.dataset.i || 'summary');
    });
    chart.addEventListener('keydown', (ev) => {
      const el = itemOf(ev.target, chart);
      if (!el) return;
      const k = (ev as KeyboardEvent).key;
      if (k === 'Enter' || k === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        pick(chart, el.dataset.i || null);
      } else if (k === 'ArrowRight' || k === 'ArrowLeft') {
        ev.preventDefault();
        const i = Number(el.dataset.i) + (k === 'ArrowRight' ? 1 : -1);
        const next = chart.querySelector<HTMLElement>(`[data-i="${i}"] .lrc-hit, rect[data-i="${i}"]`);
        next?.focus();
      }
    });
  });
}

/** "Thu 6 Nov". */
export function dayLabel(t: number): string {
  return new Date(t).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Word chips that open the lookup, up to `max`, then how many more. */
export function wordChips(lemmas: string[], max = 24): string {
  if (!lemmas.length) return '';
  const shown = lemmas.slice(0, max).map((l) => `<button type="button" class="lrc-chip" data-act="lookup" data-q="${esc(l)}">${esc(l)}</button>`).join('');
  return `<div class="lrc-chips">${shown}${lemmas.length > max ? `<span class="lrc-more">+${fmt(lemmas.length - max)} more</span>` : ''}</div>`;
}

/**
 * Brings a new question into view with its progress bar and instruction below the app's sticky
 * header (`header`), when it starts above that line, as after Continue at the bottom of a long answer.
 */
export function revealQuestion(root: ParentNode, header: Element | null): void {
  const quiz = root.querySelector<HTMLElement>('.nbv-quiz:not([data-answered])');
  if (!quiz) return;
  const top = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  if (quiz.getBoundingClientRect().top >= top + 4) return;
  quiz.style.scrollMarginTop = `${top + 8}px`;
  quiz.scrollIntoView({ block: 'start' });
}
