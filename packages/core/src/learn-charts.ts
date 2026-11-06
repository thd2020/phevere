/**
 * Charts of the Learn tab, shared by the Today and Progress pages on desktop and phone: bar charts
 * with axes, gridlines and a readout that names the day (or bucket) under the pointer or finger,
 * a calendar heatmap with month and weekday labels, and the memory strip: one dot per word by its
 * chance of recall today, in a week or in a month without review.
 *
 * Rendering is pure HTML and SVG. `attachLearnCharts` adds the pointer, keyboard and switch
 * behaviour; each shell calls it after painting Learn. Without it every chart still shows its
 * numbers and its default readout.
 *
 * Hooks: data-lrc (a chart), data-i (a bar or cell), template[data-for] (its readout),
 * data-lrc-readout, data-lrc-when (a moment on the memory strip), data-lrc-word (a word to point out).
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

/* ------------------------------------------------------------------ memory */

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
export const MEMORY_HORIZONS = [
  { days: 0, label: 'Today' },
  { days: 7, label: 'In a week' },
  { days: 30, label: 'In a month' },
] as const;

export interface MemoryAt {
  days: number;
  /** Words you would recall: the sum of every word's chance of recall (Anki's "estimated total knowledge"). */
  recalled: number;
  /** Words below the target retention, which are due for review by then. */
  below: number;
  /** Recall of each word, in the order given. */
  recall: number[];
}

export function memoryAt(words: RetentionWord[], now: number, days: number): MemoryAt {
  const at = now + days * DAY;
  const recall = words.map((w) => recallAt(w.stability, w.lastReview, at));
  return {
    days,
    recalled: recall.reduce((s, r) => s + r, 0),
    below: recall.filter((r) => r < DESIRED_RETENTION - 1e-9).length,
    recall,
  };
}

/** When a word's recall falls to the target: FSRS stability is the days from the last review until it does. */
export function slipDate(w: RetentionWord): number {
  return w.lastReview + w.stability * DAY;
}

const M_W = 320;
const M_LEFT = 6;
const M_RIGHT = 6;
const M_TOP = 18;
/** The usual height of the dot area; it grows only when the tallest stack cannot fit at the smallest dot. */
const M_DOTS = 70;
/** The smallest dot, so a notebook of thousands of words still fits the strip's width. */
const M_MIN_DOT = 1;
/** The strip runs from 50% recall at the left to 100% at the right; lower recall piles up at the left edge. */
const M_LO = 0.5;

function mx(r: number): number {
  const v = Math.max(M_LO, Math.min(1, r));
  return M_LEFT + ((M_W - M_LEFT - M_RIGHT) * (v - M_LO)) / (1 - M_LO);
}

export interface MemoryLayout {
  /** Dot diameter, the same for every horizon so the dots keep their size as they move. */
  size: number;
  /** Per horizon, each word's centre. */
  at: Array<Array<{ x: number; y: number }>>;
  /** The baseline the stacks rise from; every dot lies between M_TOP and it. */
  base: number;
}

/**
 * A beeswarm of the words along the recall axis for each horizon: words fall into columns one dot
 * wide and stack up from the baseline. The dot size is the largest that fits the tallest stack.
 */
export function memoryLayout(recalls: number[][]): MemoryLayout {
  const usable = M_W - M_LEFT - M_RIGHT;
  const tallest = (size: number) =>
    Math.max(
      0,
      ...recalls.map((rs) => {
        const cols = new Map<number, number>();
        for (const r of rs) {
          const c = Math.round((mx(r) - M_LEFT) / size);
          cols.set(c, (cols.get(c) || 0) + 1);
        }
        return Math.max(0, ...cols.values());
      }),
    );
  let size = 9;
  while (size > M_MIN_DOT && tallest(size) * size > M_DOTS) size -= size > 2 ? 0.5 : 0.25;
  const base = M_TOP + Math.max(M_DOTS, tallest(size) * size);
  const at = recalls.map((rs) => {
    const order = rs.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i);
    const height = new Map<number, number>();
    const out: Array<{ x: number; y: number }> = new Array(rs.length);
    for (const { r, i } of order) {
      const c = Math.min(Math.round(usable / size), Math.max(0, Math.round((mx(r) - M_LEFT) / size)));
      const h = height.get(c) || 0;
      height.set(c, h + 1);
      out[i] = { x: M_LEFT + c * size, y: base - size / 2 - h * size };
    }
    return out;
  });
  return { size, at, base };
}

export interface MemorySpec {
  id: string;
  words: RetentionWord[];
  now: number;
}

/** Recall as a whole percent, rounded down, so a word just under the target never reads as 90%. */
const recallPct = (r: number) => `${Math.floor(r * 100 + 1e-9)}%`;

/**
 * The caption under the number of words you would recall: what it counts, then the due and the loss
 * as short figures. "Remembered", not "Recalled": the number is a prediction, and "recalled today"
 * read as answers given today beside a Reviews gauge at 0. "Due" is the chart's word for below 90%.
 */
function memoryLede(m: MemoryAt, total: number, today: MemoryAt, h: (typeof MEMORY_HORIZONS)[number]): string {
  const lost = Math.round(today.recalled) - Math.round(m.recalled);
  const facts = [`<span><b>${fmt(m.below)}</b> due</span>`];
  if (m.days && lost > 0) facts.push(`<span><b>${fmt(lost)}</b> fewer than today</span>`);
  const label = m.days ? `Remembered ${h.label.toLowerCase()}` : 'Remembered';
  return `<span class="lrp-fig__label">${esc(label)}</span><span class="lrp-fig__sub">of ${fmt(total)} ${total === 1 ? 'word' : 'words'}</span><span class="lrp-fig__facts">${facts.join('')}</span>`;
}

function memoryReadout(words: RetentionWord[], m: MemoryAt, picked: number | null, now: number): string {
  const target = `${Math.round(DESIRED_RETENTION * 100)}%`;
  if (picked != null && words[picked]) {
    const w = words[picked];
    const slip = slipDate(w);
    const when = `${slip <= now ? 'Due since' : 'Due'} ${esc(dayLabel(slip))}`;
    const at = m.days ? (MEMORY_HORIZONS.find((h) => h.days === m.days)?.label.toLowerCase() ?? '') : 'today';
    return `<p class="lrc-read__head"><button type="button" class="lrc-chip" data-act="lookup" data-q="${esc(w.lemma)}">${esc(w.lemma)}</button> <b>${recallPct(m.recall[picked])}</b> recall ${esc(at)}</p><p class="lrc-read__sub">Reviewed ${esc(dayLabel(w.lastReview))} · ${when}</p>`;
  }
  const order = m.recall.map((r, i) => ({ r, i })).sort((a, b) => a.r - b.r || words[a.i].lemma.localeCompare(words[b.i].lemma));
  const weak = order
    .slice(0, 8)
    .map(({ r, i }) => `<button type="button" class="lrc-word" data-lrc-word="${i}" aria-pressed="false">${esc(words[i].lemma)}<small>${recallPct(r)}</small></button>`)
    .join('');
  return `<p class="lrc-read__label">Fading first</p><div class="lrc-words">${weak}</div>`;
}

/**
 * Your memory now and after a week or a month without review: one dot per word placed by its
 * chance of recall, the words below 90% (due) in ember, the number of words you would recall
 * and how many fewer that is than today. A word's dot tells when it falls below 90%.
 */
export function memoryHtml(spec: MemorySpec): string {
  const words = spec.words;
  const states = MEMORY_HORIZONS.map((h) => memoryAt(words, spec.now, h.days));
  const layout = memoryLayout(states.map((s) => s.recall));
  const today = states[0];
  const base = layout.base;
  // A small gap between neighbours while the dots are large enough to show one.
  const r = layout.size >= 3 ? layout.size / 2 - 0.4 : layout.size * 0.42;
  const dots = words
    .map((w, i) => {
      const p = layout.at[0][i];
      return `<circle class="lrc-mem__dot${today.recall[i] < DESIRED_RETENTION - 1e-9 ? ' is-due' : ''}" data-w="${i}" r="${r.toFixed(2)}" style="transform:translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px);transition-delay:${Math.round((i / Math.max(1, words.length)) * 160)}ms"/>`;
    })
    .join('');
  const ticks = [0.5, 0.7, 0.9, 1]
    .map((v) => `<text class="lrc-xtick${v === DESIRED_RETENTION ? ' is-mark' : ''}" x="${mx(v).toFixed(1)}" y="${base + 14}">${v === M_LO ? '≤50%' : `${Math.round(v * 100)}%`}</text>`)
    .join('');
  const target = mx(DESIRED_RETENTION);
  const seg = MEMORY_HORIZONS.map(
    (h, i) => `<button type="button" class="lrc-mem__when${i === 0 ? ' is-on' : ''}" data-lrc-when="${i}" aria-pressed="${i === 0}">${esc(h.label)}</button>`,
  ).join('');
  const data = JSON.stringify({
    now: spec.now,
    words: words.map((w) => [w.lemma, Math.round(w.stability * 1000) / 1000, w.lastReview]),
  }).replace(/</g, '\\u003c');
  return `<div class="lrc lrc--memory" data-lrc="${esc(spec.id)}">
    <div class="lrc-mem__head">
      <p class="lrc-mem__big" data-mem-big style="--ch:${fmt(Math.round(today.recalled)).length}">${fmt(Math.round(today.recalled))}</p>
      <p class="lrc-mem__cap" data-mem-lede>${memoryLede(today, words.length, today, MEMORY_HORIZONS[0])}</p>
    </div>
    <div class="lrc-mem__chart">
      <div class="lrc-mem__whens" role="group" aria-label="Without review">${seg}</div>
      <svg class="lrc-svg lrc-mem__svg" viewBox="0 0 ${M_W} ${base + 20}" role="img" aria-label="Your words by chance of recall" tabindex="0">
        <rect class="lrc-mem__zone" x="${M_LEFT - 2}" y="${M_TOP - 6}" width="${(target - M_LEFT + 2).toFixed(1)}" height="${base - M_TOP + 6}" rx="6"/>
        <line class="lrc-grid is-base" x1="${M_LEFT}" x2="${M_W - M_RIGHT}" y1="${base}" y2="${base}"/>
        <line class="lrc-grid is-target" x1="${target.toFixed(1)}" x2="${target.toFixed(1)}" y1="${M_TOP - 6}" y2="${base}"/>
        <text class="lrc-mem__zlabel" x="${(target - 5).toFixed(1)}" y="${M_TOP + 4}">Due</text>
        <text class="lrc-mem__zlabel is-held" x="${(target + 5).toFixed(1)}" y="${M_TOP + 4}">Held</text>
        ${ticks}
        <g class="lrc-mem__dots">${dots}</g>
        <circle class="lrc-mem__ring" data-mem-ring r="${(layout.size / 2 + 2.5).toFixed(2)}" style="opacity:0"/>
      </svg>
      <p class="lrc-xlabel">Chance of recall</p>
    </div>
    <div class="lrc-readout" data-lrc-readout aria-live="polite">${memoryReadout(words, today, null, spec.now)}</div>
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

function wireMemory(chart: HTMLElement): void {
  let data: { now: number; words: Array<[string, number, number]> };
  try {
    data = JSON.parse(chart.querySelector('[data-lrc-data]')?.textContent || '');
  } catch {
    return;
  }
  const words: RetentionWord[] = data.words.map(([lemma, stability, lastReview]) => ({ lemma, stability, lastReview }));
  const states = MEMORY_HORIZONS.map((h) => memoryAt(words, data.now, h.days));
  const layout = memoryLayout(states.map((s) => s.recall));
  const svg = chart.querySelector<SVGSVGElement>('.lrc-mem__svg');
  const dots = [...chart.querySelectorAll<SVGCircleElement>('.lrc-mem__dot')];
  const ring = chart.querySelector<SVGCircleElement>('[data-mem-ring]');
  const big = chart.querySelector<HTMLElement>('[data-mem-big]');
  const lede = chart.querySelector<HTMLElement>('[data-mem-lede]');
  const out = chart.querySelector<HTMLElement>('[data-lrc-readout]');
  let when = 0;
  let picked: number | null = null;
  let hover: number | null = null;
  const place = (i: number) => layout.at[when][i];
  const mark = () => {
    const i = hover ?? picked;
    if (!ring) return;
    if (i == null) {
      ring.style.opacity = '0';
      return;
    }
    const p = place(i);
    ring.style.opacity = '1';
    ring.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
  };
  const readout = () => {
    if (out) out.innerHTML = memoryReadout(words, states[when], hover ?? picked, data.now);
    out?.querySelectorAll<HTMLElement>('[data-lrc-word]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.lrcWord) === picked)));
    mark();
  };
  const show = (next: number) => {
    when = next;
    const m = states[when];
    dots.forEach((dot, i) => {
      const p = place(i);
      dot.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
      dot.classList.toggle('is-due', m.recall[i] < DESIRED_RETENTION - 1e-9);
    });
    if (big) {
      big.textContent = fmt(Math.round(m.recalled));
      big.style.setProperty('--ch', String(big.textContent.length));
    }
    if (lede) lede.innerHTML = memoryLede(m, words.length, states[0], MEMORY_HORIZONS[when]);
    chart.querySelectorAll<HTMLElement>('[data-lrc-when]').forEach((b) => {
      const on = Number(b.dataset.lrcWhen) === when;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    readout();
  };
  /** The word whose dot is nearest the pointer, within a finger's reach. */
  const nearest = (ev: PointerEvent | MouseEvent): number | null => {
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    if (!box.width) return null;
    const scale = M_W / box.width;
    const x = (ev.clientX - box.left) * scale;
    const y = (ev.clientY - box.top) * scale;
    let best: number | null = null;
    let dist = (ev as PointerEvent).pointerType === 'touch' ? 22 * scale : 12 * scale;
    for (let i = 0; i < words.length; i++) {
      const p = place(i);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  };
  chart.addEventListener('click', (ev) => {
    const w = (ev.target as Element | null)?.closest?.('[data-lrc-when]') as HTMLElement | null;
    if (w) {
      show(Number(w.dataset.lrcWhen) || 0);
      return;
    }
    const b = (ev.target as Element | null)?.closest?.('[data-lrc-word]') as HTMLElement | null;
    if (b) {
      const i = Number(b.dataset.lrcWord);
      picked = picked === i ? null : i;
      readout();
    }
  });
  svg?.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    const i = nearest(ev);
    if (i === hover) return;
    hover = i;
    readout();
  });
  svg?.addEventListener('pointerleave', () => {
    if (hover == null) return;
    hover = null;
    readout();
  });
  svg?.addEventListener('click', (ev) => {
    const i = nearest(ev as PointerEvent);
    picked = i == null || i === picked ? null : i;
    hover = null;
    readout();
  });
  // Arrow keys walk the words from the weakest to the strongest at the shown moment.
  svg?.addEventListener('keydown', (ev) => {
    const k = ev.key;
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Escape') return;
    ev.preventDefault();
    if (k === 'Escape') {
      picked = null;
      readout();
      return;
    }
    const order = states[when].recall.map((r, i) => ({ r, i })).sort((a, b) => a.r - b.r || a.i - b.i).map((o) => o.i);
    const at = picked == null ? -1 : order.indexOf(picked);
    const next = k === 'ArrowRight' ? Math.min(order.length - 1, at + 1) : Math.max(0, at - 1);
    picked = order[next] ?? null;
    readout();
  });
}

/** Pointer, touch and keyboard behaviour for every chart under `root`; safe to call after each paint. */
export function attachLearnCharts(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-lrc]').forEach((chart) => {
    if (wired.has(chart)) return;
    wired.add(chart);
    if (chart.classList.contains('lrc--memory')) {
      wireMemory(chart);
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
