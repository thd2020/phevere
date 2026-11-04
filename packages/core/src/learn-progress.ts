/**
 * The Learn tab's Progress page: today against the daily goals and the streak, what your memory
 * of the words would do if you stopped reviewing (a slider over FSRS's predicted recall), the
 * reviews ahead, answers per day, how firmly the words are held, the skills and the mix of
 * question kinds, each list with what it shares with the others, trouble words and root families.
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
import { LISTEN_CAP, LEECH_LAPSES, memoryLevel } from './review-quiz';
import { barChartHtml, dayLabel, retentionHtml, wordChips, type BarDatum, type RetentionWord } from './learn-charts';
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

function meter(label: string, value: number, target: number, unit = ''): string {
  const r = 26;
  const c = 2 * Math.PI * r;
  const share = target ? Math.min(1, value / target) : value ? 1 : 0;
  return `<div class="lrp-meter">
    <svg viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${esc(label)}: ${value} of ${target}">
      <circle class="lrp-meter__track" cx="32" cy="32" r="${r}"/>
      ${share ? `<circle class="lrp-meter__fill${share >= 1 ? ' is-done' : ''}" cx="32" cy="32" r="${r}" stroke-dasharray="${(share * c).toFixed(2)} ${c.toFixed(2)}"/>` : ''}
    </svg>
    <div><b>${fmt(value)}<small> / ${fmt(target)}${unit}</small></b><span>${esc(label)}</span></div>
  </div>`;
}

function stackBar(known: number, learning: number, total: number, label: string): string {
  const k = total ? (known / total) * 100 : 0;
  const l = total ? (learning / total) * 100 : 0;
  return `<span class="wb-bar lrp-bar" role="img" aria-label="${esc(label)}"><i class="wb-bar__known" style="width:${k.toFixed(2)}%"></i><i class="wb-bar__learning" style="width:${l.toFixed(2)}%"></i></span>`;
}

function perDayChart(perDay: ProgressSummary['perDay']): string {
  const data: BarDatum[] = perDay.map((d, i) => {
    const n = d.right + d.wrong;
    const date = new Date(d.day);
    const last = i === perDay.length - 1;
    const mins = d.ms / 60000;
    const mix = SKILLS.filter((k) => d.skills[k]).map((k) => `${d.skills[k]} ${SKILL_LABEL[k].toLowerCase()}`);
    return {
      tick: last ? 'Today' : date.getDay() === 1 ? String(date.getDate()) : '',
      sub: last ? '' : date.getDay() === 1 ? date.toLocaleDateString('en-US', { month: 'short' }) : '',
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
  const total = perDay.reduce((s, d) => s + d.right + d.wrong, 0);
  const right = perDay.reduce((s, d) => s + d.right, 0);
  const active = perDay.filter((d) => d.right + d.wrong).length;
  const summary = `<p class="lrc-read__head"><b>${fmt(total)}</b> answers in 30 days · <b>${pct(right, total)}%</b> right · ${active} ${active === 1 ? 'day' : 'days'} studied</p>`;
  return barChartHtml({ id: 'answers', data, yLabel: 'Answers', summary, legend: [{ cls: 'right', name: 'Right' }, { cls: 'wrong', name: 'Wrong' }], height: 162 });
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
  const held = strength.slice(3).reduce((s, b) => s + b.words.length, 0);
  const summary = `<p class="lrc-read__head"><b>${fmt(held)}</b> of ${fmt(total)} started words held for 3 weeks or more</p>`;
  return barChartHtml({ id: 'strength', data, yLabel: 'Words', summary, height: 152 });
}

function mixHtml(mix: Record<Skill, number>): string {
  const total = SKILLS.reduce((s, k) => s + mix[k], 0);
  if (!total) return '';
  const seg = SKILLS.map((k) => `<i class="lrp-mix--${k}" style="flex:${mix[k] || 0.0001}" title="${SKILL_LABEL[k]}: ${mix[k]}"></i>`).join('');
  const nums = SKILLS.map((k) => `<span><i class="lrp-mix--${k}"></i>${SKILL_LABEL[k]} <b>${pct(mix[k], total)}%</b></span>`).join('');
  return `<div class="lrp-mix">
    <p class="lrp-label">Last 7 days, ${fmt(total)} questions</p>
    <div class="lrp-mix__bar" role="img" aria-label="${SKILLS.map((k) => `${SKILL_LABEL[k]} ${pct(mix[k], total)}%`).join(', ')}">${seg}<b class="lrp-mix__cap" style="left:${(100 - LISTEN_CAP * 100).toFixed(0)}%" title="Listening at most ${Math.round(LISTEN_CAP * 100)}%"></b></div>
    <p class="lrp-mix__nums">${nums}<span class="lrp-mix__capkey"><i></i>Listening at most ${Math.round(LISTEN_CAP * 100)}%</span></p>
  </div>`;
}

/* --------------------------------------------------------------------- page */

export function progressHtml(input: ProgressInput): string {
  const now = input.now ?? Date.now();
  const s = progressSummary(input);
  const words = scopeWords(input);
  const flame = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.6.2 1.6 1 2.6 2 3 0-3.3-.3-5.8.8-8.4z" fill="currentColor"/></svg>';
  const total = s.reviewsToday + s.dueLeft;
  const lists = s.lists
    .map((l) => {
      const o = s.overlaps[l.id];
      const shared = o?.shared.slice(0, 3).map((x) => `${fmt(x.shared)} with ${esc(x.label)}`) || [];
      const extra = [o?.elsewhere ? `${fmt(o.elsewhere)} started through other lists` : '', shared.length ? `Shares ${shared.join(', ')}` : ''].filter(Boolean);
      return `<li class="lrp-list">
        <span class="lrp-list__name">${esc(l.label)}</span>
        ${stackBar(l.known, l.learning, l.total, `${l.known} of ${l.total} known`)}
        <span class="lrp-list__n"><b>${fmt(l.known)}</b> known · ${fmt(l.learning)} learning · ${fmt(l.fresh)} new</span>
        ${extra.length ? `<span class="lrp-list__share">${extra.join(' · ')}</span>` : ''}
      </li>`;
    })
    .join('');
  const skills = SKILLS.map((k) => {
    const v = s.skills[k];
    return `<li class="lrp-skill">
      <span class="lrp-skill__name">${SKILL_LABEL[k]}</span>
      <span class="wb-bar lrp-bar" role="img" aria-label="${v.mastered} of ${v.tested} mastered"><i class="wb-bar__known" style="width:${pct(v.mastered, v.tested)}%"></i></span>
      <span class="lrp-skill__n">${fmt(v.mastered)} / ${fmt(v.tested)}</span>
    </li>`;
  }).join('');
  const fams = s.families.length
    ? `<ul class="lrp-fams">${s.families
        .map(
          (f) => `<li class="lrp-fam">
            <span class="lrp-fam__root">${esc(f.label)}${f.gloss ? `<small>${esc(f.gloss)}</small>` : ''}</span>
            ${stackBar(f.known, f.learning, f.size, `${f.known} of ${f.size} known`)}
            <span class="lrp-fam__n">${f.known} / ${f.size}</span>
          </li>`,
        )
        .join('')}</ul>`
    : '<p class="lrp-none">No root families yet</p>';
  const trouble = s.trouble.length
    ? `<ul class="lrp-trouble">${s.trouble
        .map(
          (t) => `<li><button type="button" class="nbv-missed__word" data-act="lookup" data-q="${esc(t.lemma)}">${esc(t.lemma)}</button>${t.leech ? '<span class="nbv-tag is-leech">Leech</span>' : ''}<span class="lrp-trouble__n">${t.misses} of ${t.answers} missed · last ${esc(dayLabel(t.lastMiss))}</span></li>`,
        )
        .join('')}</ul>`
    : '<p class="lrp-none">No trouble words</p>';
  const answered = s.perDay.some((d) => d.right + d.wrong);
  const accuracy = s.reviewsToday ? `${pct(s.correctToday, s.reviewsToday)}%` : '–';
  return `<div class="lrp">
    <section class="lrp-card lrp-today" aria-label="Today">
      ${meter('New words', s.newToday, s.newGoal)}
      ${meter('Reviews', s.reviewsToday, total)}
      <div class="lrp-stat"><b>${accuracy}</b><span>Right today</span></div>
      <div class="lrp-streak${s.streak ? ' is-on' : ''}">${flame}<div><b>${s.streak}<small> ${s.streak === 1 ? 'day' : 'days'}</small></b><span>Streak · best ${s.bestStreak}</span></div></div>
    </section>
    <section class="lrp-card lrp-wide"><h3>If you stop reviewing</h3>${
      s.inRotation ? retentionHtml({ id: 'retention', words: s.rotation, now, days: 14, maxDays: 60 }) : '<p class="lrp-none">No words in rotation yet</p>'
    }</section>
    <section class="lrp-card"><h3>Reviews ahead, 30 days</h3>${forecastChartHtml(words, now, 30, 'due30')}</section>
    <section class="lrp-card"><h3>Answers per day</h3>${answered ? perDayChart(s.perDay) : '<p class="lrp-none">No answers yet</p>'}</section>
    <section class="lrp-card"><h3>How long words are held</h3>${s.strength.some((b) => b.words.length) ? strengthChart(s.strength) : '<p class="lrp-none">No words started yet</p>'}</section>
    <section class="lrp-card"><h3>Skills</h3><ul class="lrp-skills">${skills}</ul>${mixHtml(s.mix)}</section>
    <section class="lrp-card"><h3>Words</h3><ul class="lrp-lists">${lists}</ul>
      <p class="lrp-key"><i class="lrp-key__known"></i>Known<i class="lrp-key__learning"></i>Learning<i class="lrp-key__new"></i>New</p></section>
    <section class="lrp-card"><h3>Trouble words</h3>${trouble}</section>
    <section class="lrp-card"><h3>Root families</h3>${fams}</section>
  </div>`;
}

