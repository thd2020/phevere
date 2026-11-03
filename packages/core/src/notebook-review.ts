/**
 * Review view: a quiz over today's due and new words (logic in `review-quiz.ts`), the daily goal
 * for new words, the next two weeks of reviews and the words saved over twelve weeks.
 */
import { vocabReadings, vocabSenses } from './vocab-view';
import { DAY, clean, dayStart, esc, type NotebookEntry } from './notebook-shared';
import { ensureReviewQuestion, memoryLevel, type ReviewGrade, type ReviewQuestion, type ReviewState } from './review-quiz';
import { bookName } from './book-names';

export * from './review-quiz';

export interface ReviewRenderOptions {
  now?: number;
  /** Pronunciation can be played. */
  audio?: boolean;
  /** Milliseconds until the word would come back after this grade (from `previewReview`). */
  preview?: (entry: NotebookEntry, grade: ReviewGrade) => number;
  /** Turns `preview` into words ("3 days"); `formatReviewGap` from the scheduler. */
  formatGap?: (ms: number) => string;
  /** Word books in this session: today's new and due words and progress for each (`reviewBookRows`). */
  books?: BookPlanRow[];
  /** Show My words' daily goal chips (off when the scope is one word book, whose goal sits in its header). */
  showGoal?: boolean;
  /** Book scopes count words started rather than saved. */
  started?: boolean;
}

export interface BookPlanRow {
  bookId: string;
  total: number;
  known: number;
  learning: number;
  newToday: number;
  due: number;
}

const GRADE_LABEL: Record<ReviewGrade, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4zM15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function isNew(e: NotebookEntry): boolean {
  return memoryLevel(e) === 0;
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
    if (e.reviewDue == null || isNew(e)) continue;
    const d = daysBetween(today, Number(e.reviewDue));
    if (d < days) counts[Math.max(0, d)] += 1;
  }
  const max = Math.max(1, ...counts);
  const W = 280;
  const H = 86;
  const top = 14;
  const base = H - 14;
  const bw = W / days;
  const bars = counts
    .map((c, i) => {
      const h = Math.round((c / max) * (base - top));
      const x = i * bw + 2;
      const label = i === 0 ? 'Today' : new Date(today + i * DAY).toLocaleDateString(undefined, { weekday: 'narrow' });
      const when = i === 0 ? 'today' : i === 1 ? 'tomorrow' : `in ${i} days`;
      return `<g><rect class="nbv-bar${i === 0 ? ' is-today' : ''}" x="${x.toFixed(1)}" y="${base - Math.max(h, 1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(h, 1)}" rx="2"><title>${c} due ${when}</title></rect>${
        c ? `<text class="nbv-bar__n" x="${(x + (bw - 4) / 2).toFixed(1)}" y="${base - h - 3}">${c}</text>` : ''
      }${i === 0 ? `<text x="${x.toFixed(1)}" y="${H - 2}">${esc(label)}</text>` : i > 1 ? `<text class="nbv-bar__d" x="${(x + (bw - 4) / 2).toFixed(1)}" y="${H - 2}">${esc(label)}</text>` : ''}</g>`;
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
    cells += `<rect class="nbv-heat nbv-heat--${level}" x="${col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}" rx="2.5"><title>${new Date(d).toLocaleDateString()}: ${c} saved</title></rect>`;
  }
  const cols = Math.ceil((daysBetween(start, today) + 1) / 7);
  return `<svg class="nbv-activity" viewBox="0 0 ${cols * (cell + gap)} ${7 * (cell + gap)}" role="img" aria-label="Words saved per day over twelve weeks">${cells}</svg>`;
}

function bookRowsHtml(rows: BookPlanRow[]): string {
  if (!rows.length) return '';
  return `<div class="nbv-books" role="list" aria-label="Word books today">${rows
    .map((r) => {
      const k = r.total ? (r.known / r.total) * 100 : 0;
      const l = r.total ? (r.learning / r.total) * 100 : 0;
      return `<div class="nbv-books__row" role="listitem">
        <span class="nbv-books__name">${esc(bookName(r.bookId)?.short || r.bookId)}</span>
        <span class="nbv-books__today">${r.newToday} new · ${r.due} due</span>
        <span class="wb-bar"><i class="wb-bar__known" style="width:${k.toFixed(2)}%"></i><i class="wb-bar__learning" style="width:${l.toFixed(2)}%"></i></span>
        <span class="nbv-books__n">${r.known.toLocaleString('en-US')} / ${r.total.toLocaleString('en-US')} known</span>
      </div>`;
    })
    .join('')}</div>`;
}

function planHtml(entries: NotebookEntry[], goal: number, now: number, opts: ReviewRenderOptions = {}): string {
  // A word book word marked "already know it" counts as known without a review.
  const marked = (e: NotebookEntry) => !!(e as { known?: boolean }).known;
  const reviewed = entries.filter((e) => !isNew(e) || marked(e));
  const known = reviewed.filter((e) => marked(e) || memoryLevel(e) === 3).length;
  const week = entries.filter((e) => Number(e.createdAt || 0) >= dayStart(now) - 6 * DAY).length;
  const verb = opts.started ? 'Started' : 'Saved';
  const goals = [5, 10, 20, 40];
  const legend = [0, 1, 2, 3, 4].map((l) => `<i class="nbv-heat-key nbv-heat--${l}"></i>`).join('');
  return `<aside class="nbv-plan">
    <div class="nbv-stats">
      <div><b>${reviewed.length - known}</b><span>Learning</span></div>
      <div><b>${known}</b><span>Known</span></div>
      <div><b>${entries.length - reviewed.length}</b><span>Not started</span></div>
      <div><b>${week}</b><span>${verb} this week</span></div>
    </div>
    ${bookRowsHtml(opts.books || [])}
    ${opts.showGoal === false ? '' : `<div class="nbv-goal" role="group" aria-label="New words a day">
      <span>${opts.books?.length ? 'My words, new a day' : 'New words a day'}</span>
      <div class="nbv-goal__chips">${goals.map((g) => `<button type="button" class="nbv-chip${g === goal ? ' is-active' : ''}" data-act="nb-goal" data-goal="${g}" aria-pressed="${g === goal}">${g}</button>`).join('')}</div>
    </div>`}
    <figure><figcaption>Due, next 14 days</figcaption>${forecastSvg(entries, now)}</figure>
    <figure><figcaption>${verb}, last 12 weeks</figcaption>${activitySvg(entries, now)}<div class="nbv-heat-legend"><span>Fewer</span>${legend}<span>More</span></div></figure>
  </aside>`;
}

function playButton(lemma: string, big = false): string {
  return `<button type="button" class="vocab-play${big ? ' nbv-play-big' : ''}" data-act="nb-play" data-lemma="${esc(lemma)}" aria-label="Play ${big ? 'the word' : esc(lemma)}">${PLAY_ICON}</button>`;
}

function picHtml(e: NotebookEntry, gloss: string): string {
  return `<div class="nbv-card__pic nbv-quiz__pic" data-img-lemma="${esc(clean(e.lemma))}" data-img-lang="${esc(clean(e.sourceLang))}" data-img-gloss="${esc(gloss)}" aria-hidden="true"></div>`;
}

const ASK: Record<ReviewQuestion['kind'], string> = {
  'meaning-choice': 'Choose the meaning',
  'word-choice': 'Choose the word',
  'listen-choice': 'Choose the word you hear',
  recall: 'Type the word',
  'listen-type': 'Type the word you hear',
  cloze: 'Fill the gap',
  flash: 'Do you know this word?',
};

function promptHtml(q: ReviewQuestion, e: NotebookEntry): string {
  const reading = vocabReadings(e.reading)[0];
  switch (q.kind) {
    case 'meaning-choice':
    case 'flash':
      return `<div class="nbv-quiz__word"><h3>${esc(q.lemma)}</h3>${reading ? `<p class="nbv-card__ipa">${esc(reading.ipa)}</p>` : ''}${playButton(q.lemma)}</div>`;
    case 'word-choice':
    case 'recall':
      return `<p class="nbv-quiz__meaning">${esc(q.prompt)}</p>${clean(e.partOfSpeech) ? `<p class="nbv-quiz__pos">${esc(clean(e.partOfSpeech))}</p>` : ''}`;
    case 'cloze':
      return `<p class="nbv-quiz__meaning nbv-quiz__cloze">${esc(q.prompt).replace('_____', '<span class="nbv-gap" aria-label="gap"></span>')}</p>`;
    case 'listen-choice':
    case 'listen-type':
      return `<div class="nbv-quiz__listen" data-autoplay="${esc(q.lemma)}">${playButton(q.lemma, true)}</div>`;
    default:
      return '';
  }
}

function optionsHtml(q: ReviewQuestion, state: ReviewState): string {
  const a = state.answer;
  return `<div class="nbv-options${q.kind === 'meaning-choice' ? ' is-meanings' : ''}" role="group" aria-label="Choices">${q.options
    .map((text, i) => {
      let cls = '';
      if (a) {
        if (i === q.correct) cls = ' is-right';
        else if (i === a.choice) cls = ' is-wrong';
        else cls = ' is-dim';
      }
      const word = a && q.kind === 'meaning-choice' && i !== q.correct && i === a.choice ? `<small>${esc(q.optionWords[i])}</small>` : '';
      return `<button type="button" class="nbv-option${cls}" data-act="nb-choose" data-choice="${i}"${a ? ' disabled' : ''}><kbd>${i + 1}</kbd><span>${esc(text)}${word}</span></button>`;
    })
    .join('')}</div>`;
}

function typedHtml(q: ReviewQuestion, state: ReviewState): string {
  const a = state.answer;
  if (a) {
    if (!a.typed) return '';
    return `<p class="nbv-typed nbv-typed--${a.result}"><span>${esc(a.typed)}</span></p>`;
  }
  const placeholder = q.hint ? `${q.hint}${'·'.repeat(Math.max(0, Math.min(q.answers[0].length, 14) - 1))}` : '';
  return `<form class="nbv-type" data-act-form="nb-submit" autocomplete="off">
    <input id="nbv-answer" class="nbv-type__input" type="text" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="${esc(placeholder)}" aria-label="Answer" />
    <button type="submit" class="nbv-primary">Check</button>
  </form>`;
}

function verdictHtml(q: ReviewQuestion, state: ReviewState): string {
  const a = state.answer!;
  const text = a.result === 'right' ? 'Correct' : a.result === 'close' ? `Almost: ${esc(q.answers[0])}` : q.kind === 'flash' ? 'Keep practising' : 'Not quite';
  return `<p class="nbv-verdict is-${a.result}" role="status">${text}</p>`;
}

function answerCardHtml(e: NotebookEntry): string {
  const lemma = clean(e.lemma);
  const senses = vocabSenses(e.definition).slice(0, 3);
  const readings = vocabReadings(e.reading).slice(0, 2);
  const note = clean(e.note);
  return `<div class="nbv-answer">
    ${picHtml(e, senses[0] || '')}
    <div class="nbv-answer__text">
      <div class="nbv-answer__head"><h3>${esc(lemma)}</h3>${playButton(lemma)}</div>
      ${readings.length ? `<p class="nbv-card__ipa">${readings.map((r) => `${r.label ? `<span>${esc(r.label)}</span> ` : ''}${esc(r.ipa)}`).join('  ')}</p>` : ''}
      ${senses.length ? `<ol>${senses.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      ${note ? `<p class="nbv-card__note">${esc(note)}</p>` : ''}
    </div>
  </div>`;
}

function questionHtml(q: ReviewQuestion, e: NotebookEntry, state: ReviewState, opts: ReviewRenderOptions): string {
  const a = state.answer;
  const total = state.queue.length;
  const pct = Math.round((state.index / Math.max(1, total)) * 100);
  const choice = q.correct >= 0;
  let body = '';
  if (q.kind === 'flash') {
    if (!a && !state.revealed) body = `<button type="button" class="nbv-primary nbv-wide" data-act="nb-reveal">Show meaning</button>`;
    else if (!a) {
      body = `${answerCardHtml(e)}<div class="nbv-pair">
        <button type="button" class="nbv-secondary" data-act="nb-knew" data-knew="0"><kbd>1</kbd>I didn't know it</button>
        <button type="button" class="nbv-primary" data-act="nb-knew" data-knew="1"><kbd>2</kbd>I knew it</button>
      </div>`;
    }
  } else {
    body = choice ? optionsHtml(q, state) : typedHtml(q, state);
    if (!a) body += `<button type="button" class="nbv-link nbv-skip" data-act="nb-skip">I don't know</button>`;
  }
  // A new word from a word book can be set aside for good, like 斩 in 百词斩.
  if (!a && q.level === 0 && String(e.id).startsWith('wb:')) {
    body += `<button type="button" class="nbv-link nbv-skip" data-act="wb-known-review" data-q="${esc(q.lemma)}">Already know it</button>`;
  }
  let feedback = '';
  if (a) {
    const next = opts.preview && opts.formatGap ? opts.formatGap(opts.preview(e, a.grade)) : '';
    const override =
      q.kind === 'flash'
        ? ''
        : `<button type="button" class="nbv-link" data-act="nb-override" aria-pressed="${a.overridden}">${
            a.overridden ? 'Undo' : a.result === 'wrong' ? 'I knew it' : "I didn't know it"
          }</button>`;
    // Continue sits above the word card, so a picture loading below never moves it.
    feedback = `${verdictHtml(q, state)}
      <div class="nbv-quiz__actions">
        <button type="button" class="nbv-secondary" data-act="lookup" data-q="${esc(q.lemma)}">Open in lookup</button>
        ${override}
        <button type="button" class="nbv-primary" data-act="nb-next" autofocus>Continue<kbd>Enter</kbd></button>
      </div>
      <p class="nbv-quiz__grade"><b class="is-g${a.grade}">${GRADE_LABEL[a.grade]}</b>${next ? ` · back in ${esc(next)}` : ''}</p>
      ${answerCardHtml(e)}`;
    if (q.kind === 'flash') body = '';
  }
  return `<section class="nbv-quiz" data-id="${esc(q.id)}" data-kind="${q.kind}"${a ? ' data-answered="1"' : ''}>
    <div class="nbv-quiz__top">
      <div class="nbv-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${state.index}"><span style="width:${pct}%"></span></div>
      <span class="nbv-quiz__count">${Math.min(state.index + 1, total)} / ${total}</span>
    </div>
    <p class="nbv-quiz__ask">${ASK[q.kind]}</p>
    ${promptHtml(q, e)}
    ${body}
    ${feedback}
  </section>`;
}

function startHtml(entries: NotebookEntry[], state: ReviewState, now: number): string {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const queued = state.queue.map((id) => byId.get(id)).filter(Boolean) as NotebookEntry[];
  const fresh = queued.filter(isNew).length;
  const due = queued.length - fresh;
  if (!queued.length) {
    const next = entries
      .filter((e) => !isNew(e) && e.reviewDue != null)
      .map((e) => Number(e.reviewDue))
      .sort((a, b) => a - b)[0];
    const when = next == null ? '' : daysBetween(now, next) <= 1 ? 'tomorrow' : new Date(next).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    return `<section class="nbv-quiz nbv-quiz--idle"><p class="nbv-quiz__big">Nothing due today</p>${when ? `<p class="nbv-quiz__sub">Next review ${esc(when)}</p>` : ''}</section>`;
  }
  return `<section class="nbv-quiz nbv-quiz--start">
    <div class="nbv-counts">
      <div><b>${due}</b><span>Due</span></div>
      <div><b>${fresh}</b><span>New</span></div>
    </div>
    <button type="button" class="nbv-primary nbv-wide" data-act="nb-start" autofocus>Start review<kbd>Enter</kbd></button>
  </section>`;
}

function summaryHtml(entries: NotebookEntry[], state: ReviewState, now: number): string {
  const r = state.results;
  // The saved grade counts, so "I knew it" and "I didn't know it" are respected here too.
  const right = r.filter((x) => x.grade > 1).length;
  const missed = [...new Map(r.filter((x) => x.grade === 1).map((x) => [x.id, x])).values()];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const tomorrow = dayStart(now) + DAY;
  const dueTomorrow = entries.filter((e) => !isNew(e) && e.reviewDue != null && Number(e.reviewDue) >= tomorrow && Number(e.reviewDue) < tomorrow + DAY).length;
  const avg = r.length ? r.reduce((s, x) => s + x.ms, 0) / r.length / 1000 : 0;
  return `<section class="nbv-quiz nbv-quiz--done">
    <p class="nbv-quiz__big">Session done</p>
    <div class="nbv-counts">
      <div><b>${r.length}</b><span>Answered</span></div>
      <div><b>${r.length ? Math.round((right / r.length) * 100) : 0}%</b><span>Correct</span></div>
      <div><b>${avg ? avg.toFixed(1) : '0'}s</b><span>Per answer</span></div>
      <div><b>${dueTomorrow}</b><span>Due tomorrow</span></div>
    </div>
    ${missed.length
      ? `<div class="nbv-missed"><p class="nbv-quiz__ask">Missed</p><ul>${missed
          .map((x) => {
            const e = byId.get(x.id);
            const sense = e ? vocabSenses(e.definition)[0] || '' : '';
            return `<li><button type="button" class="nbv-missed__word" data-act="lookup" data-q="${esc(x.lemma)}">${esc(x.lemma)}</button><span>${esc(sense)}</span></li>`;
          })
          .join('')}</ul></div>`
      : ''}
  </section>`;
}

export function reviewHtml(entries: NotebookEntry[], state: ReviewState, goal: number, opts: ReviewRenderOptions = {}): string {
  const now = opts.now ?? Date.now();
  let quiz = '';
  if (!entries.length) {
    quiz = `<p class="nbv-empty">Save words to start reviewing.</p>`;
  } else if (!state.started) {
    quiz = startHtml(entries, state, now);
  } else {
    const q = ensureReviewQuestion(state, entries, { audio: opts.audio, now });
    const e = q ? entries.find((x) => x.id === q.id) : undefined;
    quiz = q && e ? questionHtml(q, e, state, opts) : summaryHtml(entries, state, now);
  }
  return `<div class="nbv-review-wrap">${quiz}${planHtml(entries, goal, now, opts)}</div>`;
}
