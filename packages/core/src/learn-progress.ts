/**
 * The Learn tab's Progress page: today against the daily goals with the week's study days, the
 * words learned and how that has grown, memory now and without review (FSRS's predicted recall), the
 * reviews ahead, a half-year of study days, the skills and the mix of question kinds, trouble words,
 * and each list with what it shares with the others.
 *
 * Everything comes from the answer history (answer-history.ts) and the words' FSRS state. The
 * charts take a pointer, a tap or the keyboard (`learn-charts.ts`).
 */
import { DAY, clean, dayStart, esc, type NotebookEntry } from './notebook-shared';
import { predictedRecall, scheduleReview, type ScheduleFields } from './review-schedule';
import { SKILLS, historyByWord, skillMastery, type AnswerRecord, type Skill } from './answer-history';
import { bookEntry, bookProgress, learnScopeEntries, wordStatus, wordbookMeta, type WordsContext, type WordsEntry, type WordsScope } from './wordbooks';
import { isLearnable, LEECH_LAPSES, MATURITY_NAME, memoryLevel, wordMaturity, type Maturity } from './review-quiz';
import { dayLabel, heatmapHtml, niceTicks, retentionAt, wordChips, type HeatCell, type RetentionWord } from './learn-charts';
import { forecastChartHtml } from './notebook-review';
import { formatDate, formatList, formatNumber, formatPercent, rawHtml, t, tHtml, type MessageKey } from './i18n/runtime';

export interface ProgressInput {
  history: AnswerRecord[];
  scope: WordsScope;
  ctx: WordsContext | null;
  /** Every saved word. */
  mine: NotebookEntry[];
  /** My words' daily goal for new words. */
  goal: number;
  now?: number;
}

export interface ListOverlap {
  /** Another list's label and how many words the two share. */
  label: string;
  shared: number;
}

export interface ProgressSummary {
  /** Words first answered today, and the day's goal for new words. */
  newToday: number;
  newGoal: number;
  /** Graded answers today, and how many reviews are still due today. */
  reviewsToday: number;
  dueLeft: number;
  correctToday: number;
  /** Days in a row with at least one answer, ending today (or yesterday when today has none yet). */
  streak: number;
  bestStreak: number;
  /** New, learning and known words of each list. */
  lists: Array<{ id: string; label: string; total: number; fresh: number; learning: number; known: number }>;
  /** Per list id: what it shares with the other lists, and words started through another list. */
  overlaps: Record<string, { shared: ListOverlap[]; elsewhere: number }>;
  /** Per skill: words with that skill mastered, and words tested in it at least once. */
  skills: Record<Skill, { mastered: number; tested: number }>;
  /** Questions per skill over the last 7 days. */
  mix: Record<Skill, number>;
  /**
   * Words of the list started (answered or marked known), and learned: past their first steps
   * (tagged Young or Mature, `wordMaturity`) or marked known, the count Anki and WaniKani lead with.
   */
  startedCount: number;
  learnedCount: number;
  /**
   * Words started and words learned at the end of each day since the first answer, oldest first:
   * two weeks at least, ninety days at most.
   */
  growth: Array<{ day: number; started: number; learned: number }>;
  /** Answers to words already started over the last 30 days, and how many were right (Anki's true retention). */
  retention: { right: number; total: number };
  /** Graded answers per day over the last 30 days, oldest first. */
  perDay: Array<{ day: number; right: number; wrong: number; ms: number; words: string[]; skills: Record<Skill, number> }>;
  /** Average predicted recall over the words in rotation, for each of the next 30 days (day 0 is now). */
  curve: number[];
  inRotation: number;
  /** The words in rotation, for the retention chart. */
  rotation: RetentionWord[];
  /** Words by how long they are held: learning, under a week, 1 to 3 weeks, 3 weeks to 3 months, longer. */
  strength: Array<{ label: string; words: string[] }>;
  /** Words missed most, worst first. */
  trouble: Array<{ lemma: string; misses: number; answers: number; lastMiss: number; leech: boolean }>;
}

const SKILL_KEY: Record<Skill, MessageKey> = {
  meaning: 'notebook.learn.skill.meaning',
  spelling: 'notebook.learn.skill.spelling',
  listening: 'notebook.learn.skill.listening',
};
/** "40% meaning": a skill's share of the week's questions. */
const MIX_KEY: Record<Skill, MessageKey> = {
  meaning: 'notebook.learn.mix.meaning',
  spelling: 'notebook.learn.mix.spelling',
  listening: 'notebook.learn.mix.listening',
};
const skillLabel = (k: Skill) => t(SKILL_KEY[k]);
const fmt = (n: number) => formatNumber(n);
const bold = (html: string) => rawHtml(`<b>${html}</b>`);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const key = (s: string) => clean(s).toLowerCase();

/** The scope's words Learn studies (`isLearnable`): sentences and symbols saved to My words are not counted. */
function scopeWords(input: ProgressInput): WordsEntry[] {
  const { scope, ctx, mine } = input;
  if (!ctx) return mine.filter(isLearnable).map((e) => ({ ...e, saved: true }));
  return learnScopeEntries(scope, ctx);
}

function streaks(days: Set<number>, today: number): { streak: number; best: number } {
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = -Infinity;
  for (const d of sorted) {
    run = Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let streak = 0;
  let d = days.has(today) ? today : dayStart(today - DAY / 2);
  while (days.has(d)) {
    streak += 1;
    d = dayStart(d - DAY / 2);
  }
  return { streak, best };
}

/** The stages the words are counted in, as Today and the question tags name them (`wordMaturity`). */
const STAGES: Maturity[] = ['new', 'learning', 'young', 'mature'];

function stageIndex(e: WordsEntry): number {
  const m = wordMaturity(e);
  return m === 'relearning' ? 1 : STAGES.indexOf(m);
}

export function progressSummary(input: ProgressInput): ProgressSummary {
  const now = input.now ?? Date.now();
  const today = dayStart(now);
  const end = today + DAY;
  const words = scopeWords(input);
  const keys = new Set(words.map((e) => key(e.lemma)));
  const history = input.history.filter((r) => keys.has(r.lemma));
  const graded = history.filter((r) => r.grade != null);

  // Today.
  const byWord = historyByWord(graded);
  let newToday = 0;
  for (const list of byWord.values()) {
    const first = list[0];
    if (first && !first.prior && first.answeredAt >= today) newToday += 1;
  }
  const todays = graded.filter((r) => r.answeredAt >= today);
  const dueLeft = words.filter((e) => wordStatus(e) !== 'new' && !(e.known && !e.saved) && e.reviewDue != null && Number(e.reviewDue) < end).length;
  const ctx = input.ctx;
  const bookIds = !ctx || input.scope === 'mine' ? [] : input.scope === 'all' ? ctx.subs.map((s) => s.bookId) : [input.scope];
  const newGoal = (input.scope === 'mine' || input.scope === 'all' || !ctx ? input.goal : 0) + bookIds.reduce((s, id) => s + (ctx?.subs.find((x) => x.bookId === id)?.dailyNew ?? 0), 0);

  // Streak over every answer, whatever the list: a day of study is a day of study.
  const days = new Set(input.history.map((r) => dayStart(r.answeredAt)));
  const { streak, best } = streaks(days, today);

  // Lists, and what each shares with the others.
  const lists: ProgressSummary['lists'] = [];
  const mineWords = ctx ? learnScopeEntries('mine', ctx) : input.mine.filter(isLearnable).map((e) => ({ ...e, saved: true }) as WordsEntry);
  const count = (list: WordsEntry[]) => {
    let fresh = 0;
    let learning = 0;
    let known = 0;
    for (const e of list) {
      const st = wordStatus(e);
      if (st === 'new') fresh += 1;
      else if (st === 'learning') learning += 1;
      else known += 1;
    }
    return { total: list.length, fresh, learning, known };
  };
  lists.push({ id: 'mine', label: t('notebook.myWords'), ...count(mineWords) });
  for (const s of ctx?.subs || []) {
    const p = bookProgress(s.bookId, ctx!, now);
    lists.push({ id: s.bookId, label: wordbookMeta(s.bookId)?.short || s.bookId, total: p.total, fresh: p.total - p.known - p.learning, learning: p.learning, known: p.known });
  }
  const sets = new Map<string, Set<string>>();
  sets.set('mine', new Set(mineWords.map((e) => key(e.lemma))));
  for (const s of ctx?.subs || []) sets.set(s.bookId, new Set((ctx!.books.get(s.bookId) || []).map(key)));
  const studiedIn = new Map<string, Set<string>>();
  for (const r of input.history) {
    const list = r.bookId || (r.wordId ? 'mine' : null);
    if (!list) continue;
    const set = studiedIn.get(list) || new Set<string>();
    set.add(r.lemma);
    studiedIn.set(list, set);
  }
  const overlaps: ProgressSummary['overlaps'] = {};
  for (const l of lists) {
    const own = sets.get(l.id) || new Set<string>();
    const shared: ListOverlap[] = [];
    for (const other of lists) {
      if (other.id === l.id) continue;
      const set = sets.get(other.id);
      if (!set) continue;
      let n = 0;
      for (const w of own) if (set.has(w)) n += 1;
      if (n) shared.push({ label: other.label, shared: n });
    }
    shared.sort((a, b) => b.shared - a.shared);
    // Started words of a book that were never answered while studying it: learned through another list.
    let elsewhere = 0;
    if (l.id !== 'mine' && ctx) {
      const here = studiedIn.get(l.id) || new Set<string>();
      for (const w of ctx.books.get(l.id) || []) {
        const k = key(w);
        if (!here.has(k) && wordStatus(bookEntry(w, ctx)) !== 'new') elsewhere += 1;
      }
    }
    overlaps[l.id] = { shared, elsewhere };
  }

  // Skills, over the words of this list that have been tested.
  const mastery = skillMastery(graded);
  const skills = Object.fromEntries(SKILLS.map((k) => [k, { mastered: 0, tested: 0 }])) as ProgressSummary['skills'];
  for (const word of mastery.values()) {
    for (const k of SKILLS) {
      const m = word[k];
      if (!m) continue;
      skills[k].tested += 1;
      if (m.mastered) skills[k].mastered += 1;
    }
  }
  const mix = Object.fromEntries(SKILLS.map((k) => [k, 0])) as Record<Skill, number>;
  for (const r of graded) if (r.answeredAt >= today - 6 * DAY && r.skill) mix[r.skill] += 1;

  // Answers per day.
  const perDay: ProgressSummary['perDay'] = [];
  const index = new Map<number, ProgressSummary['perDay'][number]>();
  for (let i = 29; i >= 0; i--) {
    const d = dayStart(today - i * DAY + DAY / 2);
    const slot = { day: d, right: 0, wrong: 0, ms: 0, words: [] as string[], skills: { meaning: 0, spelling: 0, listening: 0 } };
    perDay.push(slot);
    index.set(d, slot);
  }
  for (const r of graded) {
    const slot = index.get(dayStart(r.answeredAt));
    if (!slot) continue;
    slot[r.correct ? 'right' : 'wrong'] += 1;
    slot.ms += r.ms || 0;
    if (!slot.words.includes(r.lemma)) slot.words.push(r.lemma);
    if (r.skill) slot.skills[r.skill] += 1;
  }

  // Memory: the words in rotation, their curve and how firmly they are held.
  const inRot = words.filter((e) => !(e.known && !e.saved) && predictedRecall(e, now) != null);
  const rotation: RetentionWord[] = inRot.map((e) => ({ lemma: clean(e.lemma), stability: Number(e.stability), lastReview: Number(e.lastReview) }));
  const curve: number[] = [];
  for (let day = 0; day <= 30; day++) {
    const at = now + day * DAY;
    curve.push(inRot.length ? inRot.reduce((s, e) => s + (predictedRecall(e, at) ?? 0), 0) / inRot.length : 0);
  }
  // Words by stage; a word marked "Already know it" without a review has none.
  const strength = STAGES.map((m) => ({ label: MATURITY_NAME[m], words: [] as string[] }));
  for (const e of words) {
    if (e.known && !e.saved && !Number(e.reps)) continue;
    strength[wordStatus(e) === 'new' ? 0 : stageIndex(e)].words.push(clean(e.lemma));
  }

  // Trouble words: missed three times or more, or leeches.
  const lapses = new Map(words.map((e) => [key(e.lemma), Number(e.lapses) || 0]));
  const trouble: ProgressSummary['trouble'] = [];
  for (const [lemma, list] of byWord) {
    const misses = list.filter((r) => !r.correct).length;
    const leech = (lapses.get(lemma) || 0) >= LEECH_LAPSES;
    if (misses < 3 && !leech) continue;
    const lastMiss = Math.max(0, ...list.filter((r) => !r.correct).map((r) => r.answeredAt));
    trouble.push({ lemma, misses, answers: list.length, lastMiss, leech });
  }
  trouble.sort((a, b) => Number(b.leech) - Number(a.leech) || b.misses / b.answers - a.misses / a.answers || b.lastMiss - a.lastMiss);

  // Growth over 90 days, and the share of reviews right over 30, from this list's answers.
  const first = history.reduce((m, r) => Math.min(m, r.answeredAt), today);
  const growth = growthOver(history, today, Math.min(90, Math.max(14, Math.round((today - dayStart(first)) / DAY) + 1)));
  let reviewed = 0;
  let reviewedRight = 0;
  for (const list of byWord.values()) {
    list.forEach((r, i) => {
      if ((i > 0 || r.prior) && r.answeredAt >= today - 29 * DAY) {
        reviewed += 1;
        if (r.correct) reviewedRight += 1;
      }
    });
  }
  const statuses = words.map((e) => wordStatus(e));
  // The chart ends on today's counts, so its last point reads as the "Known" figure beside it
  // (words started before their answers were kept have no history to replay).
  const startedCount = statuses.filter((st) => st !== 'new').length;
  const learnedCount = words.filter((e) => e.known || isLearned(e)).length;
  if (growth.length) growth[growth.length - 1] = { ...growth[growth.length - 1], started: startedCount, learned: learnedCount };

  return {
    newToday,
    newGoal,
    reviewsToday: todays.length,
    dueLeft,
    correctToday: todays.filter((r) => r.correct).length,
    streak,
    bestStreak: best,
    lists,
    overlaps,
    skills,
    mix,
    startedCount,
    learnedCount,
    growth,
    retention: { right: reviewedRight, total: reviewed },
    perDay,
    curve,
    inRotation: inRot.length,
    rotation,
    strength,
    trouble: trouble.slice(0, 12),
  };
}

/* ------------------------------------------------------------------- pieces */

/** Past its first steps: the stage tag says Young or Mature. */
function isLearned(e: NotebookEntry): boolean {
  const m = wordMaturity(e);
  return m === 'young' || m === 'mature';
}

/** Words started and words learned at the end of each of the last `days` days, oldest first. */
function growthOver(history: AnswerRecord[], today: number, days: number): ProgressSummary['growth'] {
  const learned = (f: ScheduleFields) => isLearned(f as NotebookEntry);
  const words: Array<{ start: number; marks: Array<[number, boolean]> }> = [];
  for (const list of historyByWord(history).values()) {
    let fields: ScheduleFields = {};
    let start: number | null = null;
    let marked = false;
    const marks: Array<[number, boolean]> = [];
    for (const r of list) {
      if (r.kind === 'known') {
        marked = r.correct;
        if (start == null && marked) start = r.answeredAt;
        marks.push([r.answeredAt, marked || learned(fields)]);
        continue;
      }
      if (r.grade == null) continue;
      if (start == null) start = r.answeredAt;
      if (!marks.length && r.prior) fields = { ...r.prior };
      fields = { ...fields, ...scheduleReview(fields, r.grade, r.answeredAt) };
      marks.push([r.answeredAt, marked || learned(fields)]);
    }
    if (start != null) words.push({ start, marks });
  }
  const out: ProgressSummary['growth'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayStart(today - i * DAY + DAY / 2);
    const end = day + DAY;
    let started = 0;
    let held = 0;
    for (const w of words) {
      if (w.start >= end) continue;
      started += 1;
      let last = false;
      for (const [at, k] of w.marks) {
        if (at >= end) break;
        last = k;
      }
      if (last) held += 1;
    }
    out.push({ day, started, learned: held });
  }
  return out;
}

/** A labelled bar that fills towards a target: teal once it is met, with `shown` beside it and `spoken` read out. */
function meter(label: string, value: number, target: number, shown: string, spoken: string): string {
  const share = target ? Math.min(1, value / target) : value ? 1 : 0;
  return `<div class="lp-meter${share >= 1 && value ? ' is-done' : ''}" role="img" aria-label="${tHtml('notebook.learn.gaugeAria', { label, value: spoken })}">
    <span class="lp-meter__label">${esc(label)}</span>
    <span class="lp-meter__n">${shown}</span>
    <span class="lp-meter__bar"><i style="width:${(share * 100).toFixed(1)}%"></i></span>
  </div>`;
}

/** A section: a short heading, then its body. */
function section(cls: string, label: string, body: string): string {
  return `<section class="lp-sec ${cls}" aria-label="${esc(label)}"><h3 class="lp-h">${esc(label)}</h3>${body}</section>`;
}

/** A number with its label and one line of context under it. */
function stat(n: string, label: string, sub = '', cls = ''): string {
  return `<div class="lp-stat${cls ? ` ${cls}` : ''}"><b class="lp-stat__n">${n}</b><span class="lp-stat__label">${esc(label)}</span>${sub ? `<span class="lp-stat__sub">${sub}</span>` : ''}</div>`;
}

/** The last seven days ending today, each a dot filled when it had answers. */
function weekRow(days: Set<number>, today: number): string {
  const cells: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = dayStart(today - i * DAY + DAY / 2);
    const on = days.has(day);
    const name = formatDate(day, { weekday: 'narrow' });
    const spoken = t(on ? 'notebook.learn.week.studied' : 'notebook.learn.week.missed', { day: dayLabel(day) });
    cells.push(`<li class="lp-day${on ? ' is-on' : ''}${i === 0 ? ' is-today' : ''}" aria-label="${esc(spoken)}"><i></i><span>${esc(name)}</span></li>`);
  }
  return `<ol class="lp-week">${cells.join('')}</ol>`;
}

/**
 * Words started and words learned since the first answer as two filled lines, learned in teal over
 * started in its tint, scaled to the started total; the axis carries the top count and the two
 * ends' dates.
 */
function growthChart(growth: ProgressSummary['growth']): string {
  const n = growth.length;
  const top = niceTicks(Math.max(1, ...growth.map((g) => g.started))).slice(-1)[0] || 1;
  const W = 600;
  const H = 140;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W);
  const y = (v: number) => H - (v / top) * H;
  const line = (pick: (g: ProgressSummary['growth'][number]) => number) => growth.map((g, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pick(g)).toFixed(1)}`).join('');
  const area = (pick: (g: ProgressSummary['growth'][number]) => number) => `${line(pick)}L${W},${H}L0,${H}Z`;
  const last = growth[n - 1];
  const first = growth[0];
  const spoken = t('notebook.learn.growth.aria', { learned: last.learned, started: last.started, from: dayLabel(first.day) });
  return `<figure class="lp-growth" role="img" aria-label="${esc(spoken)}">
    <div class="lp-plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line class="lp-grid" x1="0" y1="0.5" x2="${W}" y2="0.5" vector-effect="non-scaling-stroke"/>
        <path class="lp-area lp-area--started" d="${area((g) => g.started)}"/>
        <path class="lp-area lp-area--known" d="${area((g) => g.learned)}"/>
        <path class="lp-line lp-line--started" d="${line((g) => g.started)}" vector-effect="non-scaling-stroke"/>
        <path class="lp-line lp-line--known" d="${line((g) => g.learned)}" vector-effect="non-scaling-stroke"/>
      </svg>
      <span class="lp-axis lp-axis--top">${esc(fmt(top))}</span>
    </div>
    <figcaption class="lp-xaxis"><span>${esc(formatDate(first.day, { month: 'short', day: 'numeric' }))}</span><span>${tHtml('notebook.learn.today')}</span></figcaption>
    <p class="lp-legend"><span><i class="lp-key lp-key--known"></i>${tHtml('notebook.learn.learned')} <b>${esc(fmt(last.learned))}</b></span><span><i class="lp-key lp-key--started"></i>${tHtml('notebook.learn.growth.started')} <b>${esc(fmt(last.started))}</b></span></p>
  </figure>`;
}

/**
 * The words' average chance of recall over the next 30 days if none is reviewed, from 50% up, with
 * the 90% the schedule aims at dashed and the values a week and a month on under it.
 */
function curveChart(curve: number[]): string {
  const W = 600;
  const H = 110;
  const floor = 0.5;
  const x = (d: number) => (d / 30) * W;
  const y = (p: number) => H - ((Math.max(floor, p) - floor) / (1 - floor)) * H;
  const d = curve.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join('');
  const at = (days: number) => formatPercent(Math.round((curve[days] ?? 0) * 100) / 100);
  return `<figure class="lp-curve" role="img" aria-label="${tHtml('notebook.learn.curve.aria', { week: at(7), month: at(30) })}">
    <div class="lp-plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line class="lp-aim" x1="0" y1="${y(0.9).toFixed(1)}" x2="${W}" y2="${y(0.9).toFixed(1)}" vector-effect="non-scaling-stroke"/>
        <path class="lp-area lp-area--recall" d="${d}L${W},${H}L0,${H}Z"/>
        <path class="lp-line lp-line--recall" d="${d}" vector-effect="non-scaling-stroke"/>
        <line class="lp-tick" x1="${x(7)}" y1="0" x2="${x(7)}" y2="${H}" vector-effect="non-scaling-stroke"/>
      </svg>
      <span class="lp-axis lp-axis--aim" style="top:${((y(0.9) / H) * 100).toFixed(1)}%">${esc(formatPercent(0.9))}</span>
    </div>
    <figcaption class="lp-curve__marks">
      <span class="lp-curve__head">${tHtml('notebook.charts.memory.withoutReview')}</span>
      <span>${tHtml('notebook.charts.memory.inWeek')} <b>${esc(at(7))}</b></span>
      <span>${tHtml('notebook.charts.memory.inMonth')} <b>${esc(at(30))}</b></span>
    </figcaption>
  </figure>`;
}

/** Reviews due within `days` days from today, overdue ones included (as on the forecast chart). */
function dueWithin(words: WordsEntry[], now: number, days: number): number {
  const end = dayStart(now) + days * DAY;
  return words.filter((e) => e.reviewDue != null && memoryLevel(e) > 0 && !e.known && Number(e.reviewDue) < end).length;
}

function mixHtml(mix: Record<Skill, number>): string {
  const total = SKILLS.reduce((s, k) => s + mix[k], 0);
  if (!total) return '';
  const share = (k: Skill) => formatPercent(pct(mix[k], total) / 100);
  const seg = SKILLS.map((k) => `<i class="lp-mix--${k}" style="flex:${mix[k] || 0.0001}"></i>`).join('');
  const parts = SKILLS.map((k) => `<span><i class="lp-mix--${k}"></i>${tHtml(MIX_KEY[k], { percent: bold(share(k)) })}</span>`);
  const spoken = formatList(SKILLS.map((k) => t('notebook.learn.mix.shareAria', { skill: skillLabel(k), percent: share(k) })), 'unit');
  return `<div class="lp-mix">
    <p class="lp-mix__head">${tHtml('notebook.learn.mix.head', { count: total })}</p>
    <div class="lp-mix__bar" role="img" aria-label="${esc(spoken)}">${seg}</div>
    <p class="lp-mix__key">${parts.join('')}</p>
  </div>`;
}

/* --------------------------------------------------------------------- page */

const STAGE_CLS = ['new', 'learning', 'young', 'mature'];

/**
 * One column that answers what a learner opens Progress to ask, in that order: is today done, how
 * many words do I know and is that growing, how well do I remember them, what is coming, how often
 * do I study, and where am I weak. It follows what the established study apps show (Anki's
 * heatmap, future due and true retention; WaniKani's stage counts; Duolingo's week of streak dots;
 * 墨墨背单词's memory curve), each part on a plain panel with a short heading. Each number sits
 * beside the label that names it.
 */
export function progressHtml(input: ProgressInput): string {
  const now = input.now ?? Date.now();
  const s = progressSummary(input);
  const words = scopeWords(input);
  const today = dayStart(now);
  const date = formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' });

  // Today: the answers given, then the two things the day asks for, then the week.
  const due = s.reviewsToday + s.dueLeft;
  const answered = s.reviewsToday
    ? `${stat(esc(fmt(s.reviewsToday)), t('notebook.learn.hero.answers'), tHtml('notebook.learn.hero.right', { percent: bold(esc(formatPercent(pct(s.correctToday, s.reviewsToday) / 100))) }), 'is-hero')}`
    : `<p class="lp-quiet">${tHtml('notebook.learn.hero.none')}</p>`;
  const reviewsShown = s.dueLeft ? `${tHtml('notebook.learn.valueOf', { value: bold(fmt(s.reviewsToday)), total: due })} · ${tHtml('notebook.learn.reviewsLeft', { count: s.dueLeft })}` : tHtml('notebook.learn.valueOf', { value: bold(fmt(s.reviewsToday)), total: due });
  const newShown = s.newGoal && s.newToday >= s.newGoal
    ? tHtml('notebook.learn.goalMet', { value: bold(fmt(s.newToday)), total: s.newGoal })
    : tHtml('notebook.learn.valueOf', { value: bold(fmt(s.newToday)), total: s.newGoal });
  const studyDays = new Set(input.history.map((r) => dayStart(r.answeredAt)));
  const todayPanel = `<section class="lp-sec lp-today" aria-label="${tHtml('notebook.learn.today')}">
    <h3 class="lp-h">${tHtml('notebook.learn.today')}<span class="lp-h__date">${esc(date)}</span></h3>
    <div class="lp-today__grid">
      <div class="lp-today__main">${answered}</div>
      <div class="lp-meters">${meter(t('notebook.learn.gauge.reviews'), s.reviewsToday, due, reviewsShown, t('notebook.learn.valueOf', { value: s.reviewsToday, total: due }))}${meter(
        t('notebook.learn.gauge.newWords'),
        s.newToday,
        s.newGoal,
        newShown,
        t(s.newGoal && s.newToday >= s.newGoal ? 'notebook.learn.goalMet' : 'notebook.learn.valueOf', { value: s.newToday, total: s.newGoal }),
      )}</div>
    </div>
    <div class="lp-streak">${weekRow(studyDays, today)}<p class="lp-streak__text"><b>${esc(fmt(s.streak))}</b> ${tHtml('notebook.learn.streak')}<span>${tHtml('notebook.learn.bestStreak', { count: s.bestStreak })}</span></p></div>
  </section>`;

  // Words: how many are learned, how many came this week, and every word by stage.
  const total = s.strength.reduce((n, b) => n + b.words.length, 0);
  const started = s.startedCount;
  const learned = s.learnedCount;
  const learnedWeek = (s.growth[s.growth.length - 1]?.learned ?? 0) - (s.growth[s.growth.length - 8]?.learned ?? 0);
  const stageBar = total
    ? `<div class="lp-stages" role="img" aria-label="${esc(formatList(s.strength.map((b) => t('notebook.learn.strength.aria', { stage: b.label, count: b.words.length })), 'unit'))}">${s.strength
        .map((b, i) => (b.words.length ? `<i class="lp-stage--${STAGE_CLS[i]}" style="flex:${b.words.length}"></i>` : ''))
        .join('')}</div>
      <div class="lp-stage-key">${s.strength
        .map((b, i) =>
          b.words.length
            ? `<details class="lp-stage"><summary><i class="lp-stage--${STAGE_CLS[i]}"></i>${esc(b.label)} <b>${esc(fmt(b.words.length))}</b></summary>${wordChips(b.words, 40)}</details>`
            : `<span class="lp-stage is-empty"><i class="lp-stage--${STAGE_CLS[i]}"></i>${esc(b.label)} <b>0</b></span>`,
        )
        .join('')}</div>`
    : '';
  const wordsBody = started
    ? `<div class="lp-row">${stat(esc(fmt(learned)), t('notebook.learn.learned'), `${tHtml('notebook.learn.ofStarted', { count: started })}${learnedWeek > 0 ? ` · <span class="lp-up">${tHtml('notebook.learn.knownThisWeek', { count: learnedWeek })}</span>` : ''}`, 'is-teal')}</div>${stageBar}${growthChart(s.growth)}`
    : `${stageBar}<p class="lp-quiet">${tHtml('notebook.learn.none.started')}</p>`;

  // Memory: the share remembered now, the share of reviews right, the curve without review, the weakest words.
  const rememberedNow = s.inRotation ? s.curve[0] : 0;
  const fading = s.inRotation ? retentionAt(s.rotation, now, 0, 8).weakest.filter((w) => w.recall < 0.97) : [];
  const fadingChips = fading.length
    ? `<div class="lp-fading"><p class="lp-sub">${tHtml('notebook.charts.memory.fadingFirst')}</p><div class="lrc-chips">${fading
        .map((w) => `<button type="button" class="lrc-chip lp-fade" data-act="lookup" data-q="${esc(w.lemma)}">${esc(w.lemma)} <small>${esc(formatPercent(Math.round(w.recall * 100) / 100))}</small></button>`)
        .join('')}</div></div>`
    : '';
  const retention = s.retention.total
    ? stat(esc(formatPercent(pct(s.retention.right, s.retention.total) / 100)), t('notebook.learn.retention.label'), tHtml('notebook.learn.retention.sub', { percent: formatPercent(0.9) }), pct(s.retention.right, s.retention.total) >= 90 ? 'is-teal' : 'is-ember')
    : '';
  const remembered = Math.round(rememberedNow * s.inRotation);
  const memoryBody = s.inRotation
    ? `<div class="lp-row">${stat(esc(formatPercent(Math.round(rememberedNow * 100) / 100)), t('notebook.charts.memory.remembered'), tHtml('notebook.learn.valueOf', { value: bold(fmt(remembered)), total: s.inRotation }), 'is-teal')}${retention}</div>${curveChart(s.curve)}${fadingChips}`
    : `<p class="lp-quiet">${tHtml('notebook.learn.none.rotation')}</p>`;

  // Reviews ahead: the next two weeks.
  const week = dueWithin(words, now, 7);
  const ahead = `<div class="lp-row">${stat(esc(fmt(week)), t('notebook.learn.dueIn7Days'))}</div>${forecastChartHtml(words, now, 14, 'due14')}`;

  // Study days: 26 weeks of answers to this list's words, as Today counts them.
  const cells: HeatCell[] = [];
  const perDay = new Map<number, number>();
  const listed = new Set(words.map((e) => key(e.lemma)));
  for (const r of input.history) if (r.grade != null && listed.has(r.lemma)) perDay.set(dayStart(r.answeredAt), (perDay.get(dayStart(r.answeredAt)) || 0) + 1);
  const span = 26 * 7;
  for (let i = span - 1; i >= 0; i--) {
    const day = dayStart(today - i * DAY + DAY / 2);
    const count = perDay.get(day) || 0;
    cells.push({ day, count, detail: `<p class="lrc-read__head"><b>${esc(dayLabel(day))}</b> · ${count ? tHtml('notebook.learn.answers.dayCount', { count }) : tHtml('notebook.learn.answers.none')}</p>` });
  }
  const studied = cells.filter((c) => c.count).length;
  const daysBody = studied
    ? heatmapHtml({ id: 'days', cells, noun: 'answered', summary: `<p class="lrc-read__head">${tHtml('notebook.learn.days.summary', { count: studied })}</p>` })
    : `<p class="lp-quiet">${tHtml('notebook.learn.none.answers')}</p>`;

  // Skills: the share of tested words mastered in each, and the week's mix of questions.
  const skills = `<div class="lp-skills">${SKILLS.map((k) => {
    const v = s.skills[k];
    const share = v.tested ? v.mastered / v.tested : 0;
    return `<div class="lp-skill">
      <span class="lp-skill__name">${esc(skillLabel(k))}</span>
      <span class="lp-skill__bar" role="img" aria-label="${tHtml('notebook.learn.mastered', { value: v.mastered, total: v.tested })}"><i style="width:${(share * 100).toFixed(1)}%"></i></span>
      <span class="lp-skill__n">${v.tested ? tHtml('notebook.learn.mastered', { value: bold(fmt(v.mastered)), total: v.tested }) : '–'}</span>
    </div>`;
  }).join('')}</div>${mixHtml(s.mix)}`;

  // Trouble words: the most missed first, leeches marked.
  const trouble = s.trouble.length
    ? `<div class="lrc-chips">${s.trouble
        .map((tw) => {
          const title = tHtml('notebook.learn.trouble.title', { misses: tw.misses, answers: tw.answers, day: dayLabel(tw.lastMiss) });
          return `<button type="button" class="lrc-chip lp-tw${tw.leech ? ' is-leech' : ''}" data-act="lookup" data-q="${esc(tw.lemma)}" title="${title}">${esc(tw.lemma)} <small>${tw.misses}/${tw.answers}</small></button>`;
        })
        .join('')}</div><p class="lp-sub lp-sub--key">${tHtml('notebook.learn.trouble.key')}${s.trouble.some((tw) => tw.leech) ? ` · <i class="lp-leech"></i>${tHtml('notebook.learn.trouble.leech')}` : ''}</p>`
    : `<p class="lp-quiet">${tHtml('notebook.learn.none.trouble')}</p>`;

  // Lists, when there is more than one: each one's known, learning and new words.
  const lists = s.lists.length > 1
    ? `<ul class="lp-lists">${s.lists
        .map((l) => {
          const o = s.overlaps[l.id];
          const extra = [
            o?.elsewhere ? t('notebook.learn.lists.elsewhere', { count: o.elsewhere }) : '',
            ...(o?.shared.slice(0, 2).map((x) => t('notebook.learn.lists.shared', { count: x.shared, list: x.label })) || []),
          ].filter(Boolean);
          const k = l.total ? (l.known / l.total) * 100 : 0;
          const g = l.total ? (l.learning / l.total) * 100 : 0;
          return `<li class="lp-list">
            <span class="lp-list__name">${esc(l.label)}</span>
            <span class="lp-list__n">${tHtml('notebook.learn.known', { value: bold(fmt(l.known)), total: l.total })}</span>
            <span class="lp-list__bar" role="img" aria-label="${tHtml('notebook.learn.known', { value: l.known, total: l.total })}"><i class="lp-stage--mature" style="width:${k.toFixed(2)}%"></i><i class="lp-stage--learning" style="width:${g.toFixed(2)}%"></i></span>
            ${extra.length ? `<span class="lp-list__more">${extra.map(esc).join(' · ')}</span>` : ''}
          </li>`;
        })
        .join('')}</ul>`
    : '';

  return `<div class="lp-frame"><div class="lp">
    ${todayPanel}
    ${section('lp-words', t('notebook.learn.section.lists'), wordsBody)}
    ${section('lp-memory', t('notebook.learn.section.memory'), memoryBody)}
    ${section('lp-ahead', t('notebook.learn.section.ahead'), ahead)}
    ${section('lp-days', t('notebook.learn.section.days'), daysBody)}
    ${section('lp-skills-sec', t('notebook.learn.section.skills'), skills)}
    ${section('lp-trouble', t('notebook.learn.section.trouble'), trouble)}
    ${lists ? section('lp-books', t('notebook.learn.section.books'), lists) : ''}
  </div></div>`;
}
