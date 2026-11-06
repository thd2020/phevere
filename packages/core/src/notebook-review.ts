/**
 * Review, on the Learn tab's Today page: a quiz over today's due and new words in rounds of
 * twenty (logic in `review-quiz.ts`), the daily goal for new words (set in Settings → Learn,
 * `settings-learn.ts`), the reviews due over the next two weeks and the words saved over twelve weeks. The two charts take a pointer or a tap
 * (`learn-charts.ts`).
 */
import { vocabReadings, vocabSenses } from './vocab-view';
import { DAY, clean, dayStart, esc, type NotebookEntry } from './notebook-shared';
import {
  bestSense,
  countdownElapsed,
  countdownMs,
  countdownWaiting,
  ensureReviewQuestion,
  hintsLeft,
  MATURITY_NAME,
  memoryLevel,
  ROUND_WORDS,
  TYPED_KINDS,
  usableSense,
  wordMaturity,
  type LearnerModel,
  type Maturity,
  type ReviewGrade,
  type ReviewQuestion,
  type ReviewState,
  type StudyPace,
} from './review-quiz';
import { suggestGoal } from './learn-adapt';
import { bookName } from './book-names';
import { vocabLookupLang } from './vocab-lang';
import { barChartHtml, dayLabel, heatmapHtml, wordChips, type BarDatum } from './learn-charts';
import type { LearnPrefs } from './learn-prefs';

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
  /** Show the daily goal (changed in Settings → Learn). */
  showGoal?: boolean;
  /** The scope is one word book: the goal shown is that book's instead of My words'. */
  goalBook?: { id: string; goal: number };
  /** Settings → Learn: the countdown on choice questions and the speaking switch (learn-prefs.ts). */
  learnPrefs?: LearnPrefs;
  /** The device has a microphone the app may use; speaking questions need it and `learnPrefs.speaking`. */
  microphone?: boolean;
  /** Book scopes count words started rather than saved. */
  started?: boolean;
  /** Example sentences for a word, for gap-fill questions (from its dictionary entry). */
  examples?: (lemma: string) => string[] | undefined;
  /** The learner model from the answer history (`learnerModel`), for choosing questions. */
  learner?: LearnerModel | null;
  /** How much the learner studies (`studyPace`); the start card offers its number of new words a day. */
  pace?: StudyPace | null;
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

const fmt = (n: number) => n.toLocaleString('en-US');

function isNew(e: NotebookEntry): boolean {
  return memoryLevel(e) === 0;
}

/** Whole days from one local midnight to another, right across daylight-saving changes. */
function daysBetween(a: number, b: number): number {
  return Math.round((dayStart(b) - dayStart(a)) / DAY);
}


/* ------------------------------------------------------------------ charts */

/** Reviews due on each of the next `days` days, split by how firmly each word is held, with its words. */
export function forecastChartHtml(entries: NotebookEntry[], now: number, days = 14, id = 'due'): string {
  const today = dayStart(now);
  const slots = Array.from({ length: days }, () => ({ learning: [] as string[], young: [] as string[], mature: [] as string[] }));
  let overdue = 0;
  for (const e of entries) {
    if (e.reviewDue == null || isNew(e) || (e as { known?: boolean }).known) continue;
    const d = daysBetween(today, Number(e.reviewDue));
    if (d >= days) continue;
    if (d < 0) overdue += 1;
    const stage = wordMaturity(e);
    const key = stage === 'young' || stage === 'mature' ? stage : 'learning';
    slots[Math.max(0, d)][key].push(clean(e.lemma));
  }
  const data: BarDatum[] = slots.map((s, i) => {
    const t = today + i * DAY + DAY / 2;
    const date = new Date(t);
    const total = s.learning.length + s.young.length + s.mature.length;
    const when = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayLabel(t);
    const parts = [
      s.learning.length ? `${s.learning.length} learning` : '',
      s.young.length ? `${s.young.length} young` : '',
      s.mature.length ? `${s.mature.length} mature` : '',
    ].filter(Boolean);
    const late = i === 0 && overdue ? `, ${overdue} of them overdue` : '';
    // Two weeks fit a label a day; a month gets one a week.
    const dense = days <= 20;
    const show = dense || i % 7 === 0;
    return {
      tick: show ? String(date.getDate()) : '',
      sub: i === 0 ? 'Today' : !show ? '' : dense ? date.toLocaleDateString('en-US', { weekday: 'narrow' }) : date.toLocaleDateString('en-US', { month: 'short' }),
      segments: [
        { cls: 'learning', value: s.learning.length },
        { cls: 'young', value: s.young.length },
        { cls: 'mature', value: s.mature.length },
      ],
      mark: i === 0,
      aria: `${when}: ${total} due`,
      detail: `<p class="lrc-read__head"><b>${esc(i > 1 ? when : `${when}, ${dayLabel(t)}`)}</b> · ${total ? `${fmt(total)} due${late}` : 'nothing due'}</p>${parts.length ? `<p class="lrc-read__sub">${parts.join(', ')}</p>` : ''}${wordChips([...s.learning, ...s.young, ...s.mature])}`,
    };
  });
  const totals = data.map((d) => d.segments.reduce((a, x) => a + x.value, 0));
  const sum = totals.reduce((a, b) => a + b, 0);
  const peak = totals.indexOf(Math.max(...totals));
  const summary = sum
    ? `<p class="lrc-read__head"><b>${fmt(sum)}</b> due in ${days} days · <b>${fmt(totals[0])}</b> today${peak > 0 && totals[peak] ? ` · most on ${esc(dayLabel(today + peak * DAY + DAY / 2))} (${fmt(totals[peak])})` : ''}</p>`
    : `<p class="lrc-read__head">Nothing due in the next ${days} days</p>`;
  return barChartHtml({
    id,
    data,
    yLabel: 'Words due',
    summary,
    legend: [
      { cls: 'learning', name: 'Learning' },
      { cls: 'young', name: 'Young' },
      { cls: 'mature', name: 'Mature' },
    ],
    height: days > 20 ? 162 : 170,
  });
}

/** Words saved (or, in a book, started) per day over twelve weeks, with the words of each day. */
export function savedHeatmapHtml(entries: NotebookEntry[], now: number, noun = 'saved', weeks = 12): string {
  const today = dayStart(now);
  const start = dayStart(today - (weeks * 7 - 1) * DAY + DAY / 2);
  const byDay = new Map<number, string[]>();
  for (const e of entries) {
    const t = Number(e.createdAt || 0);
    if (!t || t < start) continue;
    const d = dayStart(t);
    const list = byDay.get(d);
    if (list) list.push(clean(e.lemma));
    else byDay.set(d, [clean(e.lemma)]);
  }
  const cells = [];
  for (let d = start; d <= today; d = dayStart(d + DAY + DAY / 2)) {
    const words = byDay.get(d) || [];
    cells.push({
      day: d,
      count: words.length,
      detail: `<p class="lrc-read__head"><b>${esc(dayLabel(d))}</b> · ${words.length ? `${fmt(words.length)} ${noun}` : `nothing ${noun}`}</p>${wordChips(words)}`,
    });
  }
  const total = cells.reduce((s, c) => s + c.count, 0);
  const week = cells.slice(-7).reduce((s, c) => s + c.count, 0);
  const best = cells.reduce((b, c) => (c.count > b.count ? c : b), cells[0]);
  const summary = total
    ? `<p class="lrc-read__head"><b>${fmt(total)}</b> ${noun} in ${weeks} weeks · <b>${fmt(week)}</b> in the last 7 days · most on ${esc(dayLabel(best.day))} (${fmt(best.count)})</p>`
    : `<p class="lrc-read__head">Nothing ${noun} in ${weeks} weeks</p>`;
  return heatmapHtml({ id: `heat-${noun}`, cells, noun, summary });
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
        <span class="wb-bar" role="img" aria-label="${fmt(r.known)} known, ${fmt(r.learning)} learning of ${fmt(r.total)}"><i class="wb-bar__known" style="width:${k.toFixed(2)}%"></i><i class="wb-bar__learning" style="width:${l.toFixed(2)}%"></i></span>
        <span class="nbv-books__n">${fmt(r.known)} / ${fmt(r.total)} known</span>
      </div>`;
    })
    .join('')}</div>`;
}

/** A daily goal typed into the goal field: a whole number from 1 to 999, or null when empty or not a number. */
export function parseGoal(raw: unknown): number | null {
  const n = Math.round(Number(String(raw ?? '').trim()));
  if (!String(raw ?? '').trim() || !Number.isFinite(n)) return null;
  return Math.max(1, Math.min(999, n));
}

const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The settled daily goal, which opens Settings → Learn, where it is changed. */
function goalFactHtml(goal: number, opts: ReviewRenderOptions): string {
  const current = opts.goalBook ? opts.goalBook.goal : goal;
  return `<button type="button" class="nbv-goalfact" data-act="learn-settings"><b>${fmt(current)}</b><span>new ${current === 1 ? 'word' : 'words'} a day</span>${CHEVRON}</button>`;
}

function planHtml(entries: NotebookEntry[], goal: number, now: number, opts: ReviewRenderOptions = {}): string {
  // A word book word marked "already know it" counts as known without a review.
  const marked = (e: NotebookEntry) => !!(e as { known?: boolean }).known;
  const count: Record<Maturity, number> = { new: 0, learning: 0, relearning: 0, young: 0, mature: 0 };
  for (const e of entries) count[marked(e) ? 'mature' : wordMaturity(e)] += 1;
  const total = Math.max(1, entries.length);
  const parts = [
    { cls: 'mature', n: count.mature, label: 'Mature' },
    { cls: 'young', n: count.young, label: 'Young' },
    { cls: 'learning', n: count.learning + count.relearning, label: 'Learning' },
    { cls: 'new', n: count.new, label: 'New' },
  ];
  const noun = opts.started ? 'started' : 'saved';
  return `<aside class="nbv-plan">
    <div class="nbv-split" role="img" aria-label="${parts.map((p) => `${fmt(p.n)} ${p.label.toLowerCase()}`).join(', ')}">
      <div class="nbv-split__bar">${parts.map((p) => (p.n ? `<i class="nbv-split--${p.cls}" style="flex:${p.n / total}"></i>` : '')).join('')}</div>
      <div class="nbv-split__nums">${parts.map((p) => `<span class="nbv-split__n"><i class="nbv-split--${p.cls}"></i><b>${fmt(p.n)}</b>${p.label}</span>`).join('')}</div>
    </div>
    ${bookRowsHtml(opts.books || [])}
    ${opts.showGoal === false ? '' : goalFactHtml(goal, opts)}
    <figure class="nbv-fig"><figcaption>Reviews due, next 14 days</figcaption>${forecastChartHtml(entries, now)}</figure>
    <figure class="nbv-fig"><figcaption>Words ${noun}, last 12 weeks</figcaption>${savedHeatmapHtml(entries, now, noun)}</figure>
  </aside>`;
}

/* -------------------------------------------------------------------- quiz */

function playButton(lemma: string, big = false): string {
  return `<button type="button" class="vocab-play${big ? ' nbv-play-big' : ''}" data-act="nb-play" data-lemma="${esc(lemma)}" aria-label="Play ${big ? 'the word' : esc(lemma)}">${PLAY_ICON}</button>`;
}

function picHtml(e: NotebookEntry, gloss: string): string {
  return `<div class="nbv-card__pic nbv-quiz__pic" data-img-lemma="${esc(clean(e.lemma))}" data-img-lang="${esc(clean(e.sourceLang))}" data-img-gloss="${esc(gloss)}" data-img-pos="${esc(clean(e.partOfSpeech || ''))}" aria-hidden="true"></div>`;
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

const OPTION_TICK = '<svg class="nbv-option__mark" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M5 12.5l4.2 4.2L19 7" /></svg>';
const OPTION_CROSS = '<svg class="nbv-option__mark" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M7 7l10 10M17 7L7 17" /></svg>';
const BACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>';

function optionsHtml(q: ReviewQuestion, state: ReviewState): string {
  const a = state.answer;
  return `<div class="nbv-options${q.kind === 'meaning-choice' ? ' is-meanings' : ''}" role="group" aria-label="Choices">${q.options
    .map((text, i) => {
      let cls = '';
      if (a) {
        if (i === q.correct) cls = a.choice === i ? ' is-right is-chosen' : ' is-right';
        else if (i === a.choice) cls = ' is-wrong is-chosen';
        else cls = ' is-dim';
      }
      const word = a && q.kind === 'meaning-choice' && i !== q.correct && i === a.choice ? `<small>${esc(q.optionWords[i])}</small>` : '';
      const tick = cls.includes('is-right') ? OPTION_TICK : cls.includes('is-wrong') ? OPTION_CROSS : '';
      return `<button type="button" class="nbv-option${cls}" data-act="nb-choose" data-choice="${i}"${a ? ' disabled' : ''}><kbd>${i + 1}</kbd><span>${esc(text)}${word}</span>${tick}</button>`;
    })
    .join('')}</div>`;
}

/** The answer box's placeholder: the letters shown, then a dot for each hidden letter, spaces kept. */
export function typedPlaceholder(q: ReviewQuestion): string {
  const chars = [...(q.answers[0] || '')];
  const shown = (q.reveal || 0) + (q.hinted || 0);
  return chars.map((c, i) => (i < shown ? c : /\s/.test(c) ? ' ' : '·')).join('');
}

function letterCount(answer: string): string {
  const n = [...answer].filter((c) => /\p{L}/u.test(c)).length;
  return n === 1 ? '1 letter' : `${n} letters`;
}

function typedHtml(q: ReviewQuestion, state: ReviewState): string {
  const a = state.answer;
  if (a) {
    if (!a.typed) return '';
    return `<p class="nbv-typed nbv-typed--${a.result}"><span>${esc(a.typed)}</span></p>`;
  }
  return `<form class="nbv-type" data-act-form="nb-submit" autocomplete="off">
    <input id="nbv-answer" class="nbv-type__input" type="text" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="${esc(typedPlaceholder(q))}" value="${esc(q.draft || '')}" aria-label="Answer, ${letterCount(q.answers[0] || '')}" />
    <button type="submit" class="nbv-primary">Check</button>
  </form>`;
}

function verdictHtml(q: ReviewQuestion, state: ReviewState): string {
  const a = state.answer!;
  if (a.timedOut) return `<p class="nbv-verdict is-wrong" role="status">Time is up</p>`;
  const text = a.result === 'right' ? 'Correct' : a.result === 'close' ? `Almost: ${esc(q.answers[0])}` : q.kind === 'flash' ? 'Keep practising' : 'Not quite';
  // The mark says right or wrong; only "Almost" carries something to read, the right spelling.
  return `<p class="nbv-verdict is-${a.result}${a.result === 'close' ? '' : ' nbv-vh'}" role="status">${text}</p>`;
}

/** The countdown bar on a choice question (Settings → Learn), resumed from the question's start on a repaint. */
function countdownHtml(q: ReviewQuestion, state: ReviewState, opts: ReviewRenderOptions, now: number): string {
  const ms = countdownMs(q, opts.learnPrefs?.countdown);
  if (!ms || state.answer) return '';
  const elapsed = Math.min(ms, countdownElapsed(q, now));
  const s = Math.round(ms / 1000);
  // A listening question's bar stays full until its word has played.
  const waiting = countdownWaiting(q, now) ? ' is-waiting' : '';
  return `<div class="nbv-countdown${waiting}" role="timer" aria-label="${s} seconds to answer" style="--cd:${ms}ms;--cd-t:-${elapsed}ms"><i></i></div>`;
}

/** How long the mark and the wash play, in milliseconds (keep in step with notebook-views.css). */
export const MARK_MS = 2800;

/*
 * The ink marks, drawn on a 240 by 200 sheet. Each stroke is a tapered brush shape (`body`)
 * revealed by a wide pen line along its centre (`reveal`), so the ink thickens into the turn of
 * the tick and thins at the flick.
 */
const TICK = {
  reveal: 'M34 104 C 54 116, 72 136, 92 166 C 116 118, 156 62, 220 22',
  body: 'M37 101 C 58 109, 76 127, 93 149 C 121 106, 160 56, 214 20 Q 222 17, 219 25 C 162 72, 125 121, 98 170 Q 92 179, 85 171 C 70 146, 54 124, 34 109 Q 30 103, 37 101 Z',
};
const CROSS = [
  {
    reveal: 'M60 46 C 92 80, 134 124, 184 168',
    body: 'M57 49 C 88 78, 130 120, 182 162 Q 189 168, 184 172 C 132 132, 92 92, 64 58 Q 52 44, 57 49 Z',
  },
  {
    reveal: 'M188 44 C 150 82, 110 124, 56 170',
    body: 'M184 41 C 148 76, 108 120, 60 162 Q 52 170, 56 174 C 106 136, 150 94, 192 54 Q 199 44, 184 41 Z',
  },
];

function inkStroke(id: string, s: { reveal: string; body: string }, n: number): string {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="200"><path class="nbv-ink__reveal nbv-ink__reveal--${n}" pathLength="1" d="${s.reveal}"/></mask>
    <g mask="url(#${id})"><path class="nbv-ink__bleed" d="${s.body}"/><path class="nbv-ink__body" d="${s.body}"/></g>`;
}

/**
 * The teacher's mark over the whole question, prompt and options together: a brush tick for a
 * right answer, a lighter one for an almost, a cross for a wrong one, over a soft wash. It takes
 * no taps, so Continue works while it plays. A repaint resumes it where it was (from the answer's
 * time) instead of starting it again, and after MARK_MS it is no longer drawn.
 */
function markHtml(q: ReviewQuestion, state: ReviewState, now: number): string {
  const a = state.answer;
  if (!a || q.kind === 'flash') return '';
  const elapsed = a.at != null ? Math.max(0, now - a.at) : MARK_MS;
  if (elapsed >= MARK_MS) return '';
  const key = `nbv-ink-${state.index}-${String(q.id).replace(/[^\w-]/g, '').slice(-12)}`;
  const strokes = a.result === 'wrong' ? CROSS.map((s, i) => inkStroke(`${key}-${i}`, s, i + 1)).join('') : inkStroke(`${key}-0`, TICK, 1);
  return `<div class="nbv-wash is-${a.result}" aria-hidden="true"></div><div class="nbv-ink is-${a.result}" aria-hidden="true"><svg viewBox="0 0 240 200" preserveAspectRatio="xMidYMid meet">${strokes}</svg></div>`;
}

/** The senses an answer shows: the one the question used first, then other usable ones; never citations. */
function shownSenses(e: NotebookEntry, max = 3): string[] {
  const lemma = clean(e.lemma);
  const best = bestSense(e);
  const rest = vocabSenses(e.definition).filter((s) => s !== best && usableSense(s, lemma));
  return [best, ...rest].filter(Boolean).slice(0, max);
}

function answerCardHtml(e: NotebookEntry): string {
  const lemma = clean(e.lemma);
  const senses = shownSenses(e);
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

/** Small tags beside the instruction: the word's stage, or a leech, and for a new word the books that share it. */
function tagsHtml(q: ReviewQuestion, e: NotebookEntry): string {
  const tags: string[] = [];
  const stage = q.maturity || wordMaturity(e);
  if (q.leech) tags.push('<span class="nbv-tag is-leech">Trouble word</span>');
  else tags.push(`<span class="nbv-tag is-${stage}">${MATURITY_NAME[stage]}</span>`);
  const books = ((e as { books?: string[] | null }).books || []).map((id) => bookName(id)?.short || id);
  if (q.level === 0 && books.length >= 2) tags.push(`<span class="nbv-tag">${esc(books.join(' · '))}</span>`);
  return tags.join('');
}

function overrideButtons(q: ReviewQuestion, state: ReviewState): string {
  const a = state.answer!;
  if (q.kind === 'flash') return '';
  const easyOn = a.overridden && a.grade === 4 && a.result !== 'wrong';
  const flipOn = a.overridden && !easyOn;
  const flip = `<button type="button" class="nbv-link" data-act="nb-override" data-mode="flip" aria-pressed="${flipOn}">${flipOn ? 'Undo' : a.result === 'wrong' ? 'I knew it' : "I didn't know it"}</button>`;
  const easy = a.result === 'right' ? `<button type="button" class="nbv-link" data-act="nb-override" data-mode="easy" aria-pressed="${easyOn}">${easyOn ? 'Undo' : 'Too easy'}</button>` : '';
  return `<span class="nbv-quiz__links">${flip}${easy}</span>`;
}

/** A word saved from another language's entry (the Danish "give") opens in that language. */
function lookupLangAttr(e: NotebookEntry): string {
  const lang = vocabLookupLang({ lemma: clean(e.lemma), sourceLang: clean(e.sourceLang) });
  return lang ? ` data-lang="${esc(lang)}"` : '';
}

function questionHtml(q: ReviewQuestion, e: NotebookEntry, state: ReviewState, opts: ReviewRenderOptions, now: number): string {
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
      </div>${shownSenses(e).length ? '' : `<button type="button" class="nbv-link" data-act="lookup" data-q="${esc(q.lemma)}"${lookupLangAttr(e)}>Open in lookup</button>`}`;
    }
  } else {
    body = choice ? optionsHtml(q, state) : typedHtml(q, state);
  }
  let below = '';
  if (!a && TYPED_KINDS.includes(q.kind)) {
    below += `<span class="nbv-type__count">${letterCount(q.answers[0] || '')}</span>`;
    if (hintsLeft(q)) below += `<button type="button" class="nbv-link" data-act="nb-hint">Hint</button>`;
  }
  if (!a && q.kind !== 'flash') below += `<button type="button" class="nbv-link nbv-skip" data-act="nb-skip">I don't know</button>`;
  // A new word can be set aside for good, like 斩 in 百词斩. It sits in the instruction row, far
  // from where Continue was, so a double tap on Continue cannot reach it; the summary can undo it.
  const known = !a && q.level === 0 ? `<button type="button" class="nbv-known" data-act="wb-known-review" data-q="${esc(clean(e.lemma))}">Already know it</button>` : '';
  let feedback = '';
  if (a) {
    const next = opts.preview && opts.formatGap ? opts.formatGap(opts.preview(e, a.grade)) : '';
    // Continue sits above the word card, so a picture loading below never moves it.
    feedback = `${verdictHtml(q, state)}
      <div class="nbv-quiz__actions">
        <button type="button" class="nbv-secondary" data-act="lookup" data-q="${esc(q.lemma)}"${lookupLangAttr(e)}>Open in lookup</button>
        ${overrideButtons(q, state)}
        <button type="button" class="nbv-primary" data-act="nb-next" autofocus>Continue<kbd>Enter</kbd></button>
      </div>
      <p class="nbv-quiz__grade"><b class="is-g${a.grade}">${GRADE_LABEL[a.grade]}</b>${next ? ` · back in ${esc(next)}` : ''}</p>
      ${answerCardHtml(e)}`;
    if (q.kind === 'flash') body = '';
  }
  const elapsed = a?.at != null ? Math.max(0, now - a.at) : MARK_MS;
  const stageCls = a ? ` is-${a.result}` : '';
  const stageStyle = a ? ` style="--t:-${Math.min(elapsed, MARK_MS)}ms"` : '';
  return `<section class="nbv-quiz" data-id="${esc(q.id)}" data-kind="${q.kind}"${a ? ' data-answered="1"' : ''}>
    <div class="nbv-quiz__top">
      <button type="button" class="nbv-quiz__back" data-act="nb-review-exit" aria-label="Back to Learn" title="Back to Learn">${BACK_ICON}</button>
      <div class="nbv-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${state.index}"><span style="width:${pct}%"></span></div>
      <span class="nbv-quiz__count">${Math.min(state.index + 1, total)} / ${total}</span>
    </div>
    <div class="nbv-quiz__stage${stageCls}"${stageStyle}>
      <p class="nbv-quiz__ask">${ASK[q.kind]}${tagsHtml(q, e)}${known}</p>
      ${countdownHtml(q, state, opts, now)}
      <div class="nbv-quiz__q">${promptHtml(q, e)}</div>
      ${body}
      ${markHtml(q, state, now)}
    </div>
    ${below ? `<div class="nbv-quiz__below">${below}</div>` : ''}
    ${feedback}
  </section>`;
}

/** Minutes a round should take: a review about eight seconds, a new word asked two or three times. */
function roundMinutes(due: number, fresh: number): number {
  return Math.max(1, Math.round(((due * 1.2 + fresh * 2.4) * 8) / 60));
}

/**
 * The start card's offer of the number of new words a day that fits the learner's pace. Hook:
 * learn-use-goal (data-goal, and data-book for a word book; empty for My words), which sets the
 * same goal as Settings → Learn. Only for one goal (My words or one book), not for All books.
 */
function suggestHtml(goal: number, opts: ReviewRenderOptions): string {
  if (opts.showGoal === false || (opts.books?.length && !opts.goalBook)) return '';
  const current = opts.goalBook ? opts.goalBook.goal : goal;
  const n = suggestGoal(current, opts.pace);
  if (n == null) return '';
  return `<p class="nbv-quiz__note nbv-suggest">${fmt(n)} new ${n === 1 ? 'word' : 'words'} a day fits your recent study time <button type="button" class="nbv-link" data-act="learn-use-goal" data-book="${esc(opts.goalBook?.id || '')}" data-goal="${n}">Use ${fmt(n)}</button></p>`;
}

function startHtml(entries: NotebookEntry[], state: ReviewState, now: number, goal = 0, opts: ReviewRenderOptions = {}): string {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const queued = state.queue.map((id) => byId.get(id)).filter(Boolean) as NotebookEntry[];
  const fresh = queued.filter(isNew).length;
  const learning = queued.filter((e) => !isNew(e) && memoryLevel(e) <= 1).length;
  const review = queued.length - fresh - learning;
  if (!queued.length) {
    const next = entries
      .filter((e) => !isNew(e) && e.reviewDue != null && !(e as { known?: boolean }).known)
      .map((e) => Number(e.reviewDue))
      .sort((a, b) => a - b)[0];
    const when = next == null ? '' : daysBetween(now, next) <= 1 ? 'tomorrow' : new Date(next).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    return `<section class="nbv-quiz nbv-quiz--idle"><p class="nbv-quiz__big">Nothing due today</p>${when ? `<p class="nbv-quiz__sub">Next review ${esc(when)}</p>` : ''}</section>`;
  }
  const rest = state.rest || 0;
  const held = state.heldBack || 0;
  const later = state.heldForToday || 0;
  const parts = [
    { cls: 'learning', n: learning, label: 'Learning' },
    { cls: 'review', n: review, label: 'Review' },
    { cls: 'new', n: fresh, label: 'New' },
  ];
  return `<section class="nbv-quiz nbv-quiz--start">
    <div class="nbv-start__head">
      <p class="nbv-quiz__big">${rest ? `Round of ${fmt(queued.length)}` : `${fmt(queued.length)} ${queued.length === 1 ? 'word' : 'words'}`}</p>
      <p class="nbv-quiz__sub">About ${roundMinutes(learning + review, fresh)} min${rest ? ` · ${fmt(rest)} more today` : ''}</p>
    </div>
    <div class="nbv-start__bar" aria-hidden="true">${parts.map((p) => (p.n ? `<i class="nbv-start--${p.cls}" style="flex:${p.n}"></i>` : '')).join('')}</div>
    <div class="nbv-counts">${parts.map((p) => `<div><b>${fmt(p.n)}</b><span><i class="nbv-start--${p.cls}"></i>${p.label}</span></div>`).join('')}</div>
    ${held ? `<p class="nbv-quiz__note">${fmt(held)} new ${held === 1 ? 'word waits' : 'words wait'} until the reviews are done</p>` : ''}
    ${later ? `<p class="nbv-quiz__note">${fmt(later)} new ${later === 1 ? 'word waits' : 'words wait'} for tomorrow</p>` : ''}
    ${suggestHtml(goal, opts)}
    <button type="button" class="nbv-primary nbv-wide" data-act="nb-start" autofocus>Start review<kbd>Enter</kbd></button>
  </section>`;
}

const MATURITY_RANK: Record<Maturity, number> = { new: 0, relearning: 1, learning: 1, young: 2, mature: 3 };

/** Words set aside with "Already know it" this round, each with Undo while it is still set aside. */
function knownHtml(entries: NotebookEntry[], state: ReviewState): string {
  const marked = state.knownMarked || [];
  if (!marked.length) return '';
  const byLemma = new Map(entries.map((e) => [clean(e.lemma).toLowerCase(), e]));
  const rows = marked
    .map((l) => {
      const still = !!(byLemma.get(l.toLowerCase()) as { known?: boolean } | undefined)?.known;
      return `<li><span class="nbv-missed__word">${esc(l)}</span>${
        still ? `<button type="button" class="nbv-link" data-act="wb-known" data-known="0" data-q="${esc(l)}">Undo</button>` : '<span>Back in your words</span>'
      }</li>`;
    })
    .join('');
  return `<div class="nbv-moved nbv-moved--known"><p class="nbv-quiz__ask">Already known <b>${marked.length}</b></p><ul>${rows}</ul></div>`;
}

function summaryHtml(entries: NotebookEntry[], state: ReviewState, now: number): string {
  const r = state.results;
  // The saved grade counts, so "I knew it" and "I didn't know it" are respected here too.
  const right = r.filter((x) => x.grade > 1).length;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const fallback = (level: number | undefined): Maturity => (['new', 'learning', 'young', 'mature'] as Maturity[])[level ?? 0] || 'new';
  const words = new Map<string, { lemma: string; from: Maturity; to: Maturity; missed: boolean }>();
  for (const x of r) {
    const w = words.get(x.id);
    const before = x.maturityBefore || fallback(x.levelBefore);
    const after = x.maturityAfter || (x.levelAfter != null ? fallback(x.levelAfter) : before);
    if (w) {
      w.to = after;
      w.missed = w.missed || x.grade === 1;
    } else words.set(x.id, { lemma: x.lemma, from: before, to: after, missed: x.grade === 1 });
  }
  const list = [...words.entries()];
  const rank = (m: Maturity) => MATURITY_RANK[m];
  const started = list.filter(([, w]) => w.from === 'new').map(([, w]) => w.lemma);
  // Up a stage, or a lapsed word back in review; down a stage, or into relearning.
  const up = list.filter(([, w]) => w.from !== 'new' && (rank(w.to) > rank(w.from) || (w.from === 'relearning' && w.to !== 'relearning')));
  const down = list.filter(([, w]) => rank(w.to) < rank(w.from) || (w.to === 'relearning' && w.from !== 'relearning'));
  const missed = list.filter(([, w]) => w.missed);
  const secs = r.reduce((s, x) => s + x.ms, 0) / 1000;
  const time = `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
  const tomorrow = dayStart(now) + DAY;
  const dueTomorrow = entries.filter((e) => !isNew(e) && e.reviewDue != null && Number(e.reviewDue) >= tomorrow && Number(e.reviewDue) < tomorrow + DAY).length;
  const rest = state.rest || 0;
  const moved = (rows: typeof up, title: string, cls: string) =>
    rows.length
      ? `<div class="nbv-moved nbv-moved--${cls}"><p class="nbv-quiz__ask">${title} <b>${rows.length}</b></p><ul>${rows
          .map(([, w]) => `<li><button type="button" class="nbv-missed__word" data-act="lookup" data-q="${esc(w.lemma)}">${esc(w.lemma)}</button><span>${MATURITY_NAME[w.from]} → ${MATURITY_NAME[w.to]}</span></li>`)
          .join('')}</ul></div>`
      : '';
  return `<section class="nbv-quiz nbv-quiz--done">
    <p class="nbv-quiz__big">${rest ? 'Round done' : 'Done for today'}</p>
    <div class="nbv-counts">
      <div><b>${r.length}</b><span>Answered</span></div>
      <div><b>${r.length ? Math.round((right / r.length) * 100) : 0}%</b><span>Correct</span></div>
      <div><b>${time}</b><span>Minutes</span></div>
      <div><b>${dueTomorrow}</b><span>Due tomorrow</span></div>
    </div>
    ${started.length ? `<div class="nbv-moved nbv-moved--new"><p class="nbv-quiz__ask">New words started <b>${started.length}</b></p>${wordChips(started, 40)}</div>` : ''}
    ${knownHtml(entries, state)}
    ${moved(up, 'Stronger', 'up')}
    ${moved(down, 'Slipped back', 'down')}
    ${missed.length
      ? `<div class="nbv-missed"><p class="nbv-quiz__ask">Missed <b>${missed.length}</b></p><ul>${missed
          .map(([id, w]) => {
            const e = byId.get(id);
            const sense = e ? bestSense(e) : '';
            return `<li><button type="button" class="nbv-missed__word" data-act="lookup" data-q="${esc(w.lemma)}">${esc(w.lemma)}</button><span>${esc(sense)}</span></li>`;
          })
          .join('')}</ul></div>`
      : ''}
    <div class="nbv-quiz__actions">
      <button type="button" class="nbv-secondary" data-act="nb-review-exit">Back to Learn</button>
      ${rest ? `<button type="button" class="nbv-primary" data-act="nb-round" autofocus>Next round · ${fmt(Math.min(rest, ROUND_WORDS))}<kbd>Enter</kbd></button>` : ''}
    </div>
  </section>`;
}

export function reviewHtml(entries: NotebookEntry[], state: ReviewState, goal: number, opts: ReviewRenderOptions = {}): string {
  const now = opts.now ?? Date.now();
  let quiz = '';
  if (!entries.length) {
    quiz = `<p class="nbv-empty">Save words to start reviewing.</p>`;
  } else if (!state.started) {
    quiz = startHtml(entries, state, now, goal, opts);
  } else {
    const q = ensureReviewQuestion(state, entries, { audio: opts.audio, now, examples: opts.examples, learner: opts.learner });
    const e = q ? entries.find((x) => x.id === q.id) : undefined;
    quiz = q && e ? questionHtml(q, e, state, opts, now) : summaryHtml(entries, state, now);
  }
  return `<div class="nbv-review-wrap${state.started ? ' is-running' : ''}">${quiz}${planHtml(entries, goal, now, opts)}</div>`;
}

