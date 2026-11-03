/** Review view: today's spaced-repetition queue, a daily goal, the forecast and the activity grid. */
import { vocabReadings, vocabSenses } from './vocab-view';
import { DAY, clean, dayStart, esc, type NotebookEntry } from './notebook-shared';

export interface ReviewState {
  queue: string[];
  index: number;
  revealed: boolean;
  done: number;
}

/**
 * Reviews due by the end of today (lapsed words included), oldest first, then words never
 * reviewed, up to the daily goal less the new words already started today.
 */
export function reviewQueue(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0): string[] {
  const end = dayStart(now) + DAY;
  const due = entries
    .filter((e) => e.reviewDue != null && Number(e.reviewDue) < end)
    .sort((x, y) => Number(x.reviewDue) - Number(y.reviewDue));
  const fresh = entries
    .filter((e) => e.reviewDue == null)
    .sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0))
    .slice(0, Math.max(0, goal - startedToday));
  return [...due, ...fresh].map((e) => e.id);
}

/** Whole days from one local midnight to another, right across daylight-saving changes. */
function daysBetween(a: number, b: number): number {
  return Math.round((dayStart(b) - dayStart(a)) / DAY);
}

function forecastSvg(entries: NotebookEntry[], now: number): string {
  const today = dayStart(now);
  const days = 14;
  const counts = new Array(days).fill(0);
  for (const e of entries) {
    if (e.reviewDue == null) continue;
    const d = daysBetween(today, Number(e.reviewDue));
    if (d < days) counts[Math.max(0, d)] += 1;
  }
  const max = Math.max(1, ...counts);
  const W = 280;
  const H = 72;
  const bw = W / days;
  const bars = counts
    .map((c, i) => {
      const h = Math.round((c / max) * (H - 18));
      const label = i === 0 ? 'Today' : new Date(today + i * DAY).toLocaleDateString(undefined, { weekday: 'narrow' });
      return `<g><rect class="nbv-bar${i === 0 ? ' is-today' : ''}" x="${(i * bw + 2).toFixed(1)}" y="${H - 14 - h}" width="${(bw - 4).toFixed(1)}" height="${Math.max(h, c ? 2 : 1)}" rx="2"><title>${c} due ${i === 0 ? 'today' : `in ${i} day${i > 1 ? 's' : ''}`}</title></rect>${
        i === 0 || i % 7 === 0 ? `<text x="${(i * bw + 2).toFixed(1)}" y="${H - 2}">${esc(label)}</text>` : ''
      }</g>`;
    })
    .join('');
  return `<svg class="nbv-forecast" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reviews due over the next two weeks">${bars}</svg>`;
}

function activitySvg(entries: NotebookEntry[], now: number): string {
  const weeks = 12;
  const today = dayStart(now);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (weeks * 7 - 1) - startDate.getDay());
  const start = startDate.getTime();
  const counts = new Map<number, number>();
  for (const e of entries) {
    const t = Number(e.createdAt || 0);
    if (!t || t < start) continue;
    const d = dayStart(t);
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  const cell = 11;
  const gap = 3;
  let cells = '';
  const day = new Date(start);
  for (let i = 0; day.getTime() <= today; i++, day.setDate(day.getDate() + 1)) {
    const d = day.getTime();
    const c = counts.get(d) || 0;
    const level = c ? Math.min(4, Math.ceil((c / max) * 4)) : 0;
    const col = Math.floor(i / 7);
    const row = i % 7;
    cells += `<rect class="nbv-heat nbv-heat--${level}" x="${col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}" rx="2.5"><title>${new Date(d).toLocaleDateString()}: ${c} added</title></rect>`;
  }
  const cols = Math.ceil((daysBetween(start, today) + 1) / 7);
  return `<svg class="nbv-activity" viewBox="0 0 ${cols * (cell + gap)} ${7 * (cell + gap)}" role="img" aria-label="Words added per day over twelve weeks">${cells}</svg>`;
}

export function reviewHtml(entries: NotebookEntry[], state: ReviewState, goal: number, now = Date.now()): string {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const left = state.queue.length - state.index;
  const learned = entries.filter((e) => e.reviewDue != null).length;
  const week = entries.filter((e) => Number(e.createdAt || 0) >= dayStart(now) - 6 * DAY).length;
  const goals = [5, 10, 20, 40];
  const plan = `<section class="nbv-plan">
    <div class="nbv-stats">
      <div><b>${Math.max(0, left)}</b><span>to review today</span></div>
      <div><b>${state.done}</b><span>reviewed</span></div>
      <div><b>${learned}</b><span>in rotation</span></div>
      <div><b>${week}</b><span>added this week</span></div>
    </div>
    <div class="nbv-goal" role="group" aria-label="New words per day">
      <span>New words per day</span>
      ${goals.map((g) => `<button type="button" class="nbv-chip${g === goal ? ' is-active' : ''}" data-act="nb-goal" data-goal="${g}" aria-pressed="${g === goal}">${g}</button>`).join('')}
    </div>
    <div class="nbv-charts">
      <figure><figcaption>Next two weeks</figcaption>${forecastSvg(entries, now)}</figure>
      <figure><figcaption>Words added, twelve weeks</figcaption>${activitySvg(entries, now)}</figure>
    </div>
  </section>`;

  const cur = state.index < state.queue.length ? byId.get(state.queue[state.index]) : undefined;
  let card = '';
  if (!entries.length) {
    card = `<p class="nbv-empty">Save words to start reviewing.</p>`;
  } else if (!cur) {
    card = `<div class="nbv-review nbv-review--done"><p>${state.done ? 'Done for today.' : 'Nothing due today.'}</p></div>`;
  } else {
    const lemma = clean(cur.lemma);
    const reading = vocabReadings(cur.reading)[0];
    const senses = vocabSenses(cur.definition).slice(0, 4);
    const note = clean(cur.note);
    card = `<div class="nbv-review" data-id="${esc(cur.id)}">
      <div class="nbv-review__progress"><span style="width:${Math.round((state.index / Math.max(1, state.queue.length)) * 100)}%"></span></div>
      <div class="nbv-review__front">
        <div class="nbv-card__pic nbv-review__pic" data-img-lemma="${esc(lemma)}" data-img-lang="${esc(clean(cur.sourceLang))}" data-img-gloss="${esc(senses[0] || '')}" aria-hidden="true"></div>
        <h3 class="nbv-review__word">${esc(lemma)}</h3>
        ${reading ? `<p class="nbv-card__ipa">${esc(reading.ipa)}</p>` : ''}
        <button type="button" class="vocab-play" data-act="nb-play" data-lemma="${esc(lemma)}" aria-label="Play ${esc(lemma)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4zM15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      ${state.revealed
        ? `<div class="nbv-review__back">${senses.length ? `<ol>${senses.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p>No definition saved.</p>'}${note ? `<p class="nbv-card__note">${esc(note)}</p>` : ''}</div>
          <div class="nbv-grades">
            <button type="button" data-act="nb-grade" data-grade="1" class="is-again">Again</button>
            <button type="button" data-act="nb-grade" data-grade="2">Hard</button>
            <button type="button" data-act="nb-grade" data-grade="3" class="is-good">Good</button>
            <button type="button" data-act="nb-grade" data-grade="4">Easy</button>
          </div>`
        : `<button type="button" class="nbv-reveal" data-act="nb-reveal">Show meaning</button>`}
      <p class="nbv-review__left">${left} left</p>
    </div>`;
  }
  return `<div class="nbv-review-wrap">${card}${plan}</div>`;
}
