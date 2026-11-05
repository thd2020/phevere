/**
 * The Learn tab's Progress page: today against the daily goals and the streak, your memory of the
 * words today and after a week or a month without review (FSRS's predicted recall, one dot per
 * word), the reviews ahead, answers per day, how firmly the words are held, the skills and the mix
 * of question kinds, each list with what it shares with the others, trouble words and root families.
 *
 * Everything comes from the answer history (answer-history.ts) and the words' FSRS state. The
 * charts take a pointer, a tap or the keyboard (`learn-charts.ts`).
 */
import { DAY, clean, dayStart, esc, type Family, type NotebookEntry } from './notebook-shared';
import { analyzeNotebook } from './notebook-views';
import { deepRootFamilies } from './notebook-families';
import { predictedRecall } from './review-schedule';
import { SKILLS, historyByWord, skillMastery, type AnswerRecord, type Skill } from './answer-history';
import { bookEntry, bookProgress, scopeEntries, wordStatus, wordbookMeta, type WordsContext, type WordsEntry, type WordsScope } from './wordbooks';
import { LEECH_LAPSES, memoryLevel } from './review-quiz';
import { barChartHtml, dayLabel, memoryHtml, wordChips, type BarDatum, type RetentionWord } from './learn-charts';
import { forecastChartHtml } from './notebook-review';

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
  /** Root families, largest first, with how many of their words are known or being learned. */
  families: Array<{ label: string; gloss: string; size: number; known: number; learning: number }>;
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

const SKILL_LABEL: Record<Skill, string> = { meaning: 'Meaning', spelling: 'Spelling', listening: 'Listening' };
const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const key = (s: string) => clean(s).toLowerCase();

function scopeWords(input: ProgressInput): WordsEntry[] {
  const { scope, ctx, mine } = input;
  if (!ctx) return mine.map((e) => ({ ...e, saved: true }));
  return scopeEntries(scope, ctx);
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

const STRENGTH_LABELS = ['Learning', 'Under 1 week', '1 to 3 weeks', '3 weeks to 3 months', '3 months or more'];

function strengthBucket(e: WordsEntry): number {
  const state = Number(e.state);
  if (state === 1 || state === 3 || memoryLevel(e) <= 1) return 0;
  const s = Number(e.stability ?? e.reviewInterval ?? 0) || 0;
  if (s < 7) return 1;
  if (s < 21) return 2;
  if (s < 90) return 3;
  return 4;
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
  const mineWords = ctx ? scopeEntries('mine', ctx) : input.mine.map((e) => ({ ...e, saved: true }) as WordsEntry);
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
  lists.push({ id: 'mine', label: 'My words', ...count(mineWords) });
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

  // Root families among the words started or saved (a book of thousands would bury them in new words).
  const studied = words.filter((e) => e.saved || wordStatus(e) !== 'new');
  const analysis = analyzeNotebook(studied);
  const fams = new Map<string, Family>();
  for (const f of [...analysis.families.filter((f) => f.kind === 'root'), ...deepRootFamilies(analysis)]) {
    const k = f.label.toLowerCase();
    const prev = fams.get(k);
    if (!prev || f.ids.length > prev.ids.length) fams.set(k, f);
  }
  const byId = new Map(studied.map((e) => [e.id, e]));
  const families = [...fams.values()]
    .sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label))
    .slice(0, 8)
    .map((f) => {
      let known = 0;
      let learning = 0;
      for (const id of f.ids) {
        const e = byId.get(id);
        const st = e ? wordStatus(e) : 'new';
        if (st === 'known') known += 1;
        else if (st === 'learning') learning += 1;
      }
      return { label: f.label, gloss: f.gloss, size: f.ids.length, known, learning };
    });

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
  for (let t = 0; t <= 30; t++) {
    const at = now + t * DAY;
    curve.push(inRot.length ? inRot.reduce((s, e) => s + (predictedRecall(e, at) ?? 0), 0) / inRot.length : 0);
  }
  const strength = STRENGTH_LABELS.map((label) => ({ label, words: [] as string[] }));
  for (const e of words) {
    if (wordStatus(e) === 'new' || (e.known && !e.saved && !Number(e.reps))) continue;
    strength[strengthBucket(e)].words.push(clean(e.lemma));
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
    families,
    perDay,
    curve,
    inRotation: inRot.length,
    rotation,
    strength,
    trouble: trouble.slice(0, 12),
  };
}

/* ------------------------------------------------------------------- pieces */

/** A thin rule that fills towards a target, with its count; teal when the target is met. */
function gauge(label: string, value: number, target: number): string {
  const share = target ? Math.min(1, value / target) : value ? 1 : 0;
  return `<div class="lrp-gauge${share >= 1 ? ' is-done' : ''}" role="img" aria-label="${esc(label)}: ${value} of ${target}">
    <span class="lrp-gauge__label">${esc(label)}</span>
    <span class="lrp-gauge__n"><b>${fmt(value)}</b> of ${fmt(target)}</span>
    <span class="lrp-gauge__bar"><i style="width:${(share * 100).toFixed(1)}%"></i></span>
  </div>`;
}

function stackBar(known: number, learning: number, total: number, label: string): string {
  const k = total ? (known / total) * 100 : 0;
  const l = total ? (learning / total) * 100 : 0;
  return `<span class="wb-bar lrp-bar" role="img" aria-label="${esc(label)}"><i class="wb-bar__known" style="width:${k.toFixed(2)}%"></i><i class="wb-bar__learning" style="width:${l.toFixed(2)}%"></i></span>`;
}

/** A section: a numbered label on a rule, then its body. */
function section(cls: string, n: number, label: string, body: string): string {
  return `<section class="lrp-sec ${cls}" aria-label="${esc(label)}"><h3 class="lrp-sec__label"><span>${String(n).padStart(2, '0')}</span>${esc(label)}</h3>${body}</section>`;
}

/** An oversized number with the sentence that says what it counts. */
function figure(n: string, text: string, cls = ''): string {
  return `<div class="lrp-fig${cls ? ` ${cls}` : ''}"><b class="lrp-fig__n">${n}</b><p class="lrp-fig__text">${text}</p></div>`;
}

function perDayChart(perDay: ProgressSummary['perDay']): string {
  const data: BarDatum[] = perDay.map((d, i) => {
    const n = d.right + d.wrong;
    const date = new Date(d.day);
    const last = i === perDay.length - 1;
    const mins = d.ms / 60000;
    const mix = SKILLS.filter((k) => d.skills[k]).map((k) => `${d.skills[k]} ${SKILL_LABEL[k].toLowerCase()}`);
    return {
      tick: last ? 'Today' : date.getDay() === 1 && i < perDay.length - 3 ? String(date.getDate()) : '',
      sub: !last && date.getDay() === 1 && i < perDay.length - 3 ? date.toLocaleDateString('en-US', { month: 'short' }) : '',
      segments: [
        { cls: 'right', value: d.right },
        { cls: 'wrong', value: d.wrong },
      ],
      mark: last,
      aria: `${dayLabel(d.day)}: ${d.right} right, ${d.wrong} wrong`,
      detail: n
        ? `<p class="lrc-read__head"><b>${esc(dayLabel(d.day))}</b> · ${fmt(n)} answers, ${pct(d.right, n)}% right${mins >= 0.5 ? ` · ${Math.round(mins)} min` : ''}</p><p class="lrc-read__sub">${d.right} right, ${d.wrong} wrong${mix.length ? ` · ${mix.join(', ')}` : ''}</p>${wordChips(d.words, 18)}`
        : `<p class="lrc-read__head"><b>${esc(dayLabel(d.day))}</b> · no answers</p>`,
    };
  });
  const summary = '<p class="lrc-read__sub">Pick a day to see its answers and words</p>';
  return barChartHtml({ id: 'answers', data, yLabel: 'Answers', summary, legend: [{ cls: 'right', name: 'Right' }, { cls: 'wrong', name: 'Wrong' }], height: 150 });
}

function strengthChart(strength: ProgressSummary['strength']): string {
  const short = ['Learning', 'Under 1 wk', '1–3 wk', '3 wk–3 mo', 'Over 3 mo'];
  const total = strength.reduce((s, b) => s + b.words.length, 0);
  const data: BarDatum[] = strength.map((b, i) => ({
    tick: short[i],
    segments: [{ cls: i === 0 ? 'learning' : i <= 2 ? 'young' : 'mature', value: b.words.length }],
    aria: `${b.label}: ${b.words.length} words`,
    detail: `<p class="lrc-read__head"><b>${esc(b.label)}</b> · ${fmt(b.words.length)} ${b.words.length === 1 ? 'word' : 'words'}${total ? ` (${pct(b.words.length, total)}%)` : ''}</p>${wordChips(b.words, 30)}`,
  }));
  const summary = '<p class="lrc-read__sub">Pick a bar to see its words</p>';
  return barChartHtml({ id: 'strength', data, yLabel: 'Words', summary, height: 150 });
}

function mixHtml(mix: Record<Skill, number>): string {
  const total = SKILLS.reduce((s, k) => s + mix[k], 0);
  if (!total) return '';
  const seg = SKILLS.map((k) => `<i class="lrp-mix--${k}" style="flex:${mix[k] || 0.0001}" title="${SKILL_LABEL[k]}: ${mix[k]}"></i>`).join('');
  const parts = SKILLS.map((k) => `<span class="lrp-mix__k"><i class="lrp-mix--${k}"></i><b>${pct(mix[k], total)}%</b> ${SKILL_LABEL[k].toLowerCase()}</span>`);
  return `<div class="lrp-mix">
    <div class="lrp-mix__bar" role="img" aria-label="${SKILLS.map((k) => `${SKILL_LABEL[k]} ${pct(mix[k], total)}%`).join(', ')}">${seg}</div>
    <p class="lrp-mix__text">Last 7 days, ${fmt(total)} questions: ${parts[0]}, ${parts[1]} and ${parts[2]}</p>
  </div>`;
}

/** Reviews due within `days` days from today, overdue ones included (as on the forecast chart). */
function dueWithin(words: WordsEntry[], now: number, days: number): number {
  const end = dayStart(now) + days * DAY;
  return words.filter((e) => e.reviewDue != null && memoryLevel(e) > 0 && !e.known && Number(e.reviewDue) < end).length;
}

/* --------------------------------------------------------------------- page */

/**
 * The page reads like a printed spread rather than a grid of cards: a masthead with the streak as
 * a giant numeral and today told in one sentence, then numbered sections on rules, each led by one
 * oversized number with what it counts, at sizes that differ from section to section. Wide windows
 * set the sections on a twelve-column grid in uneven pairs; a phone stacks them.
 */
export function progressHtml(input: ProgressInput): string {
  const now = input.now ?? Date.now();
  const s = progressSummary(input);
  const words = scopeWords(input);
  const due = s.reviewsToday + s.dueLeft;
  const date = new Date(now).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  const lede = s.reviewsToday
    ? `Today you started <b>${fmt(s.newToday)}</b> of <b>${fmt(s.newGoal)}</b> new words and answered <b>${fmt(s.reviewsToday)}</b> ${s.reviewsToday === 1 ? 'question' : 'questions'}, <b>${pct(s.correctToday, s.reviewsToday)}%</b> of them right. ${
        s.dueLeft ? `<b>${fmt(s.dueLeft)}</b> ${s.dueLeft === 1 ? 'review is' : 'reviews are'} still due.` : 'Nothing else is due today.'
      }`
    : `Nothing answered yet today. ${s.dueLeft ? `<b>${fmt(s.dueLeft)}</b> ${s.dueLeft === 1 ? 'review is' : 'reviews are'} due` : 'Nothing is due'}, and the goal is <b>${fmt(s.newGoal)}</b> new ${s.newGoal === 1 ? 'word' : 'words'}.`;
  const mast = `<header class="lrp-mast${s.streak ? ' is-on' : ''}" aria-label="Today">
    <p class="lrp-kicker">${esc(date)}</p>
    <div class="lrp-mast__streak">
      <b class="lrp-giant">${fmt(s.streak)}</b>
      <p class="lrp-mast__cap"><span>${s.streak === 1 ? 'day' : 'days'} in a row</span><small>Streak · best ${fmt(s.bestStreak)}</small></p>
    </div>
    <p class="lrp-lede">${lede}</p>
    <div class="lrp-gauges">${gauge('New words', s.newToday, s.newGoal)}${gauge('Reviews', s.reviewsToday, due)}</div>
  </header>`;

  const memory = s.inRotation ? memoryHtml({ id: 'memory', words: s.rotation, now }) : '<p class="lrp-none">No words in rotation yet</p>';

  const week = dueWithin(words, now, 7);
  const ahead = `${figure(fmt(week), `${week === 1 ? 'review' : 'reviews'} in the next 7 days`)}${forecastChartHtml(words, now, 30, 'due30')}`;

  const started = s.strength.reduce((n, b) => n + b.words.length, 0);
  const held = s.strength.slice(3).reduce((n, b) => n + b.words.length, 0);
  const heldBody = started
    ? `${figure(fmt(held), `of ${fmt(started)} started ${started === 1 ? 'word is' : 'words are'} held for 3 weeks or more`, 'is-teal')}${strengthChart(s.strength)}`
    : '<p class="lrp-none">No words started yet</p>';

  const answers30 = s.perDay.reduce((n, d) => n + d.right + d.wrong, 0);
  const right30 = s.perDay.reduce((n, d) => n + d.right, 0);
  const days30 = s.perDay.filter((d) => d.right + d.wrong).length;
  const answersBody = answers30
    ? `${figure(fmt(answers30), `answers in 30 days, <b>${pct(right30, answers30)}%</b> right, on ${days30} ${days30 === 1 ? 'day' : 'days'}`, 'is-wide')}${perDayChart(s.perDay)}`
    : '<p class="lrp-none">No answers yet</p>';

  const skills = `<div class="lrp-skills">${SKILLS.map((k) => {
    const v = s.skills[k];
    const share = v.tested ? v.mastered / v.tested : 0;
    return `<div class="lrp-skill">
      <span class="lrp-skill__name">${SKILL_LABEL[k]}</span>
      <b class="lrp-skill__pct">${v.tested ? `${pct(v.mastered, v.tested)}<small>%</small>` : '–'}</b>
      <span class="lrp-skill__bar" role="img" aria-label="${v.mastered} of ${v.tested} mastered"><i style="width:${(share * 100).toFixed(1)}%"></i></span>
      <span class="lrp-skill__n">${fmt(v.mastered)} of ${fmt(v.tested)} words mastered</span>
    </div>`;
  }).join('')}</div>${mixHtml(s.mix)}`;

  const lists = `<ul class="lrp-lists">${s.lists
    .map((l) => {
      const o = s.overlaps[l.id];
      const shared = o?.shared.slice(0, 3).map((x) => `${fmt(x.shared)} with ${esc(x.label)}`) || [];
      const extra = [o?.elsewhere ? `${fmt(o.elsewhere)} started through other lists` : '', shared.length ? `Shares ${shared.join(', ')}` : ''].filter(Boolean);
      return `<li class="lrp-list">
        <span class="lrp-list__name">${esc(l.label)}</span>
        <span class="lrp-list__n"><b>${fmt(l.known)}</b> of ${fmt(l.total)} known</span>
        ${stackBar(l.known, l.learning, l.total, `${l.known} of ${l.total} known`)}
        <span class="lrp-list__more">${fmt(l.learning)} learning, ${fmt(l.fresh)} new${extra.length ? `. ${extra.join('. ')}` : ''}</span>
      </li>`;
    })
    .join('')}</ul>
    <p class="lrp-key"><i class="lrp-key__known"></i>Known<i class="lrp-key__learning"></i>Learning<i class="lrp-key__new"></i>New</p>`;

  // Trouble words set as one run of type: the more often missed, the larger and darker the word.
  const worst = Math.max(0.0001, ...s.trouble.map((t) => t.misses / Math.max(1, t.answers)));
  const trouble = s.trouble.length
    ? `<p class="lrp-trouble">${s.trouble
        .map((t) => {
          const w = t.misses / Math.max(1, t.answers) / worst;
          return `<button type="button" class="lrp-tw${t.leech ? ' is-leech' : ''}" style="--w:${w.toFixed(2)}" data-act="lookup" data-q="${esc(t.lemma)}" title="${t.misses} of ${t.answers} missed, last ${esc(dayLabel(t.lastMiss))}">${esc(t.lemma)}<sup>${t.misses}/${t.answers}</sup></button>`;
        })
        .join(' ')}</p><p class="lrp-note">Missed of answered${s.trouble.some((t) => t.leech) ? '; leeches in rust' : ''}</p>`
    : '<p class="lrp-none">No trouble words</p>';

  const biggest = Math.max(1, ...s.families.map((f) => f.size));
  const fams = s.families.length
    ? `<ul class="lrp-fams">${s.families
        .map(
          (f) => `<li class="lrp-fam" style="--s:${(f.size / biggest).toFixed(2)}">
            <span class="lrp-fam__root">${esc(f.label)}</span>
            ${f.gloss ? `<span class="lrp-fam__gloss">${esc(f.gloss)}</span>` : ''}
            ${stackBar(f.known, f.learning, f.size, `${f.known} of ${f.size} known`)}
            <span class="lrp-fam__n">${f.known} of ${f.size} known</span>
          </li>`,
        )
        .join('')}</ul>`
    : '<p class="lrp-none">No root families yet</p>';

  let n = 0;
  return `<div class="lrp">
    ${mast}
    ${section('lrp-sec--memory', ++n, 'Memory', memory)}
    ${section('lrp-sec--ahead', ++n, 'Reviews ahead', ahead)}
    ${section('lrp-sec--held', ++n, 'How long words are held', heldBody)}
    ${section('lrp-sec--answers', ++n, 'Answers per day', answersBody)}
    ${section('lrp-sec--skills', ++n, 'Skills', skills)}
    ${section('lrp-sec--lists', ++n, 'Words', lists)}
    ${section('lrp-sec--trouble', ++n, 'Trouble words', trouble)}
    ${section('lrp-sec--fams', ++n, 'Root families', fams)}
  </div>`;
}
