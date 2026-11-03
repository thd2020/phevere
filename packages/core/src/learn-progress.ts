/**
 * The Learn tab's Progress page: today against the daily goals, the streak, words per state in
 * each list, skill mastery, root-family mastery, reviews per day and the forgetting curve.
 * Everything comes from the answer history (answer-history.ts) and the words' FSRS state. Charts
 * are inline SVG in the notebook palette, like the forecast and activity charts of Review.
 */
import { DAY, clean, dayStart, esc, type Family, type NotebookEntry } from './notebook-shared';
import { analyzeNotebook } from './notebook-views';
import { deepRootFamilies } from './notebook-families';
import { DESIRED_RETENTION, predictedRecall } from './review-schedule';
import { SKILLS, historyByWord, skillMastery, type AnswerRecord, type Skill } from './answer-history';
import { bookProgress, scopeEntries, wordStatus, wordbookMeta, type WordsContext, type WordsEntry, type WordsScope } from './wordbooks';

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
  /** Per skill: words with that skill mastered, and words tested in it at least once. */
  skills: Record<Skill, { mastered: number; tested: number }>;
  /** Root families, largest first, with how many of their words are known or being learned. */
  families: Array<{ label: string; gloss: string; size: number; known: number; learning: number }>;
  /** Graded answers per day over the last 30 days, oldest first. */
  perDay: Array<{ day: number; right: number; wrong: number }>;
  /** Average predicted recall over the words in rotation, for each of the next 30 days (day 0 is now). */
  curve: number[];
  inRotation: number;
}

const SKILL_LABEL: Record<Skill, string> = { meaning: 'Meaning', spelling: 'Spelling', listening: 'Listening' };
const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

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

export function progressSummary(input: ProgressInput): ProgressSummary {
  const now = input.now ?? Date.now();
  const today = dayStart(now);
  const end = today + DAY;
  const words = scopeWords(input);
  const keys = new Set(words.map((e) => clean(e.lemma).toLowerCase()));
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

  // Lists.
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

  // Root families among the words started or saved (a book of thousands would bury them in new words).
  const studied = words.filter((e) => e.saved || wordStatus(e) !== 'new');
  const analysis = analyzeNotebook(studied);
  const fams = new Map<string, Family>();
  for (const f of [...analysis.families.filter((f) => f.kind === 'root'), ...deepRootFamilies(analysis)]) {
    const key = f.label.toLowerCase();
    const prev = fams.get(key);
    if (!prev || f.ids.length > prev.ids.length) fams.set(key, f);
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

  // Reviews per day.
  const perDay: ProgressSummary['perDay'] = [];
  const index = new Map<number, { right: number; wrong: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = dayStart(today - i * DAY + DAY / 2);
    const slot = { day: d, right: 0, wrong: 0 };
    perDay.push(slot);
    index.set(d, slot);
  }
  for (const r of graded) {
    const slot = index.get(dayStart(r.answeredAt));
    if (slot) slot[r.correct ? 'right' : 'wrong'] += 1;
  }

  // Forgetting curve over the words in rotation.
  const rotation = words.filter((e) => !(e.known && !e.saved) && predictedRecall(e, now) != null);
  const curve: number[] = [];
  for (let t = 0; t <= 30; t++) {
    const at = now + t * DAY;
    curve.push(rotation.length ? rotation.reduce((s, e) => s + (predictedRecall(e, at) ?? 0), 0) / rotation.length : 0);
  }

  return {
    newToday,
    newGoal,
    reviewsToday: todays.length,
    dueLeft,
    correctToday: todays.filter((r) => r.correct).length,
    streak,
    bestStreak: best,
    lists,
    skills,
    families,
    perDay,
    curve,
    inRotation: rotation.length,
  };
}

/* ------------------------------------------------------------------- charts */

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

function perDaySvg(perDay: ProgressSummary['perDay']): string {
  const W = 300;
  const H = 96;
  const top = 12;
  const base = H - 14;
  const bw = W / perDay.length;
  const max = Math.max(1, ...perDay.map((d) => d.right + d.wrong));
  const bars = perDay
    .map((d, i) => {
      const x = i * bw + 1;
      const w = Math.max(1, bw - 2);
      const hr = ((base - top) * d.right) / max;
      const hw = ((base - top) * d.wrong) / max;
      const date = new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const label = i === perDay.length - 1 ? 'Today' : i === 0 || i === 14 ? date : '';
      return `<g><title>${esc(date)}: ${d.right} right, ${d.wrong} wrong</title>
        ${d.right ? `<rect class="lrp-day__right" x="${x.toFixed(1)}" y="${(base - hr).toFixed(1)}" width="${w.toFixed(1)}" height="${hr.toFixed(1)}" rx="1.5"/>` : ''}
        ${d.wrong ? `<rect class="lrp-day__wrong" x="${x.toFixed(1)}" y="${(base - hr - hw).toFixed(1)}" width="${w.toFixed(1)}" height="${hw.toFixed(1)}" rx="1.5"/>` : ''}
        ${!d.right && !d.wrong ? `<rect class="lrp-day__none" x="${x.toFixed(1)}" y="${base - 1}" width="${w.toFixed(1)}" height="1"/>` : ''}
        ${label ? `<text x="${(i === perDay.length - 1 ? x + w : x).toFixed(1)}" y="${H - 2}"${i === perDay.length - 1 ? ' text-anchor="end"' : ''}>${esc(label)}</text>` : ''}
      </g>`;
    })
    .join('');
  return `<svg class="lrp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Answers per day over the last 30 days"><text class="lrp-max" x="0" y="8">${max}</text>${bars}</svg>`;
}

function curveSvg(curve: number[]): string {
  const W = 300;
  const H = 110;
  const left = 26;
  const top = 8;
  const base = H - 16;
  const lo = 0.5;
  const x = (t: number) => left + ((W - left - 4) * t) / (curve.length - 1);
  const y = (r: number) => top + (base - top) * (1 - (Math.max(lo, r) - lo) / (1 - lo));
  const pts = curve.map((r, t) => `${x(t).toFixed(1)},${y(r).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${base} ${pts} ${x(curve.length - 1).toFixed(1)},${base}`;
  const grid = [1, 0.9, 0.75, 0.5]
    .map((r) => `<line class="lrp-grid${r === DESIRED_RETENTION ? ' is-target' : ''}" x1="${left}" x2="${W - 4}" y1="${y(r).toFixed(1)}" y2="${y(r).toFixed(1)}"/><text x="${left - 4}" y="${(y(r) + 3).toFixed(1)}" text-anchor="end">${Math.round(r * 100)}%</text>`)
    .join('');
  const ticks = [0, 7, 14, 30]
    .map((t) => `<text x="${x(t).toFixed(1)}" y="${H - 3}"${t === 30 ? ' text-anchor="end"' : t ? ' text-anchor="middle"' : ''}>${t === 0 ? 'Now' : `${t} d`}</text>`)
    .join('');
  const last = curve[curve.length - 1];
  return `<svg class="lrp-chart lrp-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Predicted recall over the next 30 days, ${Math.round(last * 100)}% after 30 days">
    ${grid}${ticks}
    <polygon class="lrp-curve__area" points="${area}"/>
    <polyline class="lrp-curve__line" points="${pts}"/>
    <circle class="lrp-curve__end" cx="${x(curve.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3"><title>${Math.round(last * 100)}% in 30 days</title></circle>
  </svg>`;
}

/* --------------------------------------------------------------------- page */

export function progressHtml(input: ProgressInput): string {
  const s = progressSummary(input);
  const flame = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.6.2 1.6 1 2.6 2 3 0-3.3-.3-5.8.8-8.4z" fill="currentColor"/></svg>';
  const total = s.reviewsToday + s.dueLeft;
  const lists = s.lists
    .map(
      (l) => `<li class="lrp-list">
        <span class="lrp-list__name">${esc(l.label)}</span>
        ${stackBar(l.known, l.learning, l.total, `${l.known} of ${l.total} known`)}
        <span class="lrp-list__n"><b>${fmt(l.known)}</b> known · ${fmt(l.learning)} learning · ${fmt(l.fresh)} new</span>
      </li>`,
    )
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
  const answered = s.perDay.some((d) => d.right + d.wrong);
  return `<div class="lrp">
    <section class="lrp-card lrp-today" aria-label="Today">
      ${meter('New words', s.newToday, s.newGoal)}
      ${meter('Reviews', s.reviewsToday, total)}
      <div class="lrp-streak${s.streak ? ' is-on' : ''}">${flame}<div><b>${s.streak}<small> ${s.streak === 1 ? 'day' : 'days'}</small></b><span>Streak · best ${s.bestStreak}</span></div></div>
    </section>
    <section class="lrp-card"><h3>Words</h3><ul class="lrp-lists">${lists}</ul>
      <p class="lrp-key"><i class="lrp-key__known"></i>Known<i class="lrp-key__learning"></i>Learning<i class="lrp-key__new"></i>New</p></section>
    <section class="lrp-card"><h3>Skills</h3><ul class="lrp-skills">${skills}</ul></section>
    <section class="lrp-card"><h3>Root families</h3>${fams}</section>
    <section class="lrp-card"><h3>Answers per day</h3>${answered ? perDaySvg(s.perDay) : '<p class="lrp-none">No answers yet</p>'}
      ${answered ? '<p class="lrp-key"><i class="lrp-key__right"></i>Right<i class="lrp-key__wrong"></i>Wrong</p>' : ''}</section>
    <section class="lrp-card"><h3>Forgetting curve</h3>${s.inRotation ? `${curveSvg(s.curve)}<p class="lrp-sub">${fmt(s.inRotation)} words in rotation · ${Math.round(s.curve[7] * 100)}% in a week without review</p>` : '<p class="lrp-none">No words in rotation yet</p>'}</section>
  </div>`;
}
