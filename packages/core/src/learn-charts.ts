/**
 * Charts of the Learn tab, shared by the Today and Progress pages on desktop and phone: bar charts
 * with axes, gridlines and a readout that names the day (or bucket) under the pointer or finger,
 * a calendar heatmap with month and weekday labels, and the words' recall at a day to come.
 *
 * Rendering is pure HTML and SVG. `attachLearnCharts` adds the pointer, keyboard and switch
 * behaviour; each shell calls it after painting Learn. Without it every chart still shows its
 * numbers and its default readout.
 *
 * Hooks: data-lrc (a chart), data-i (a bar or cell), template[data-for] (its readout),
 * data-lrc-readout.
 */
import { esc } from './notebook-shared';
import { DESIRED_RETENTION, recallAt } from './review-schedule';
import { formatDate, formatNumber, t, tHtml } from './i18n/runtime';

const DAY = 86_400_000;
const fmt = (n: number) => formatNumber(n);

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

/** Rough width of a label at the axis's 8.5px size: CJK and Hangul take a full em, the rest about 0.62. */
function labelWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 8.5 : 5.3;
  return w;
}

/**
 * Where each label under the bars goes. A label wider than its column ("Today" in Russian or
 * French) leans into the free side at the chart's edges, and a label it would run into is left
 * out, so the row never overlaps whatever the language.
 */
function placeSubLabels(labels: string[], left: number, bw: number, rightEdge: number): Array<{ x: number; anchor: 'start' | 'middle' | 'end' } | null> {
  let freeFrom = -Infinity;
  return labels.map((label, i) => {
    if (!label) return null;
    const w = labelWidth(label);
    const cx = left + i * bw + bw / 2;
    let x = cx;
    let anchor: 'start' | 'middle' | 'end' = 'middle';
    let from = cx - w / 2;
    if (from < left - 6) {
      x = left + i * bw + 1;
      anchor = 'start';
      from = x;
    } else if (from + w > rightEdge) {
      x = rightEdge;
      anchor = 'end';
      from = rightEdge - w;
    }
    if (from < freeFrom + 2) return null;
    freeFrom = from + w;
    return { x, anchor };
  });
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
    .map((v) => `<line class="lrc-grid${v === 0 ? ' is-base' : ''}" x1="${left}" x2="${W - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="lrc-ytick" x="${left - 5}" y="${(y(v) + 3).toFixed(1)}">${fmt(v)}</text>`)
    .join('');
  const gap = Math.min(4, bw * 0.28);
  const subs = placeSubLabels(spec.data.map((d) => d.sub || ''), left, bw, W - right);
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
      const at = subs[i];
      const sub = at ? `<text class="lrc-xsub${d.mark ? ' is-mark' : ''}" x="${at.x.toFixed(1)}" y="${base + 25}"${at.anchor !== 'middle' ? ` text-anchor="${at.anchor}"` : ''}>${esc(d.sub || '')}</text>` : null;
      const value = totals[i] && bw >= 14 ? `<text class="lrc-val" x="${cx.toFixed(1)}" y="${(y(totals[i]) - 4).toFixed(1)}">${fmt(totals[i])}</text>` : '';
      return `<g class="lrc-bar${d.mark ? ' is-mark' : ''}${spec.picked === i ? ' is-picked' : ''}" data-i="${i}">
        <rect class="lrc-hit" x="${(left + i * bw).toFixed(1)}" y="${top - 6}" width="${bw.toFixed(1)}" height="${(base - top + 6 + (subRow ? 28 : 16)).toFixed(1)}" tabindex="0" role="button" aria-label="${esc(d.aria)}"/>
        <rect class="lrc-col" x="${(left + i * bw).toFixed(1)}" y="${top - 6}" width="${bw.toFixed(1)}" height="${(base - top + 6).toFixed(1)}"/>
        ${segs || `<rect class="lrc-seg lrc-seg--none" x="${x.toFixed(1)}" y="${base - 1}" width="${w.toFixed(1)}" height="1"/>`}${value}${tick}${sub || ''}
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
  /** What a cell counts: "saved" (words saved), "started" (words started in a word book) or "answered" (answers given). */
  noun: 'saved' | 'started' | 'answered';
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
  const keys = {
    saved: ['notebook.charts.heat.cellSaved', 'notebook.charts.heat.labelSaved'],
    started: ['notebook.charts.heat.cellStarted', 'notebook.charts.heat.labelStarted'],
    answered: ['notebook.charts.heat.cellAnswered', 'notebook.charts.heat.labelAnswered'],
  } as const;
  const [cellKey, labelKey] = keys[spec.noun] || keys.saved;
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
        months += `<text class="lrc-month" x="${left + col * (cell + gap)}" y="${top - 4}">${esc(formatDate(d, { month: 'short' }))}</text>`;
      }
      const x = left + col * (cell + gap);
      const yy = top + row * (cell + gap);
      const date = formatDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
      const label = t(cellKey, { date, count: c.count });
      return `<rect class="lrc-heat lrc-heat--${level(c.count)}${i === spec.cells.length - 1 ? ' is-mark' : ''}" data-i="${i}" x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="2.5" tabindex="0" role="button" aria-label="${esc(label)}"/>`;
    })
    .join('');
  const cols = Math.ceil((spec.cells.length + lead) / 7);
  // Monday, Wednesday and Friday in the interface language (5 January 1970 was a Monday).
  const weekday = (r: number) => formatDate(new Date(1970, 0, 5 + r), { weekday: 'short' });
  const days = [0, 2, 4]
    .map((r) => `<text class="lrc-wday" x="0" y="${top + r * (cell + gap) + cell - 2}">${esc(weekday(r))}</text>`)
    .join('');
  const W = left + cols * (cell + gap);
  const H = top + 7 * (cell + gap);
  const templates = spec.cells.map((c, i) => `<template data-for="${i}">${c.detail}</template>`).join('');
  const key = [0, 1, 2, 3, 4].map((l) => `<i class="lrc-heat-key lrc-heat--${l}"></i>`).join('');
  return `<div class="lrc lrc--heat" data-lrc="${esc(spec.id)}">
    <svg class="lrc-svg lrc-svg--heat" viewBox="0 0 ${W} ${H}" role="group" aria-label="${tHtml(labelKey)}">${months}${days}${rects}</svg>
    <p class="lrc-legend lrc-legend--heat"><span>${fmt(0)}</span>${key}<span>${tHtml('notebook.charts.heat.perDay', { count: max })}</span></p>
    <div class="lrc-readout" data-lrc-readout aria-live="polite">${spec.summary}</div>
    <template data-for="summary">${spec.summary}</template>${templates}
  </div>`;
}

/* ------------------------------------------------------------------ recall */

export interface RetentionWord {
  lemma: string;
  stability: number;
  lastReview: number;
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

/** Today, a week and a month without review: the three moments the memory strip shows. */
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

export function attachLearnCharts(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-lrc]').forEach((chart) => {
    if (wired.has(chart)) return;
    wired.add(chart);
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

/** "Thu, Nov 6", as the interface language writes a short day. */
export function dayLabel(at: number): string {
  return formatDate(at, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Word chips that open the lookup, up to `max`, then how many more. */
export function wordChips(lemmas: string[], max = 24): string {
  if (!lemmas.length) return '';
  const shown = lemmas.slice(0, max).map((l) => `<button type="button" class="lrc-chip" data-act="lookup" data-q="${esc(l)}">${esc(l)}</button>`).join('');
  return `<div class="lrc-chips">${shown}${lemmas.length > max ? `<span class="lrc-more">${tHtml('notebook.charts.moreWords', { count: lemmas.length - max })}</span>` : ''}</div>`;
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
