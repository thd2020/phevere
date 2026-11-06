/**
 * Settings → Learn, desktop and phone: new words a day for My words and for each subscribed word
 * book, and the countdown on choice questions. As Duolingo sets a daily goal, each list offers a
 * few presets to tap, with a field for any other number; and as MaiMemo shows a book's finish
 * date, each list says under its choices what the goal costs a day and when every word in the
 * list will have been started, updated as soon as another number is picked. The number that suits
 * the learner's usual day (`StudyPace.suggested`) is marked among the presets. The speaking-question
 * switch (shown only with a microphone, `microphoneAvailable` in learn-prefs.ts) stays hidden
 * until speaking questions exist (`SPEAKING_QUESTIONS`); its stored preference is kept.
 *
 * Hooks: learn-goal (a preset radio or the number field, data-book; empty for My words) and
 * learn-countdown (a preset radio; 0 is Off). Each sends a bubbling `change`; the value is in
 * `data-value` on a radio and in `value` on the field (`learnPickValue`). After saving, the host
 * calls `syncLearnPick` with the element, which updates that list's choices and plan line without
 * a repaint, so keyboard focus stays put. learn-speaking (switch). Styles: settings-kit.css.
 */
import { formatDate, t, tHtml } from './i18n/runtime';
import { esc, switchRowHtml } from './settings-kit';
import { COUNTDOWN_MAX, COUNTDOWN_MIN, type LearnPrefs } from './learn-prefs';
import type { StudyPace } from './review-quiz';

export interface LearnSettingsInput {
  /** My words' new words a day. */
  goal: number;
  /** Subscribed word books, in the order Learn lists them; `left` is their words not started yet. */
  books: Array<{ id: string; title: string; goal: number; left?: number }>;
  prefs: LearnPrefs;
  /** The device has a microphone the app may use. */
  microphone: boolean;
  /** My words not started yet; unknown until the words have loaded. */
  mineLeft?: number;
  /** How the learner studies, once there is enough history (`studyPace`). */
  pace?: StudyPace | null;
  now?: number;
}

/** New words a day run from 1 to 999, as `parseGoal` allows. */
export const GOAL_MIN = 1;
export const GOAL_MAX = 999;
/** The presets every list offers; the suggested number joins them when it is not one. */
export const GOAL_PRESETS = [5, 10, 15, 20, 30, 50];
/** Countdown choices in seconds; 0 is Off. */
export const COUNTDOWN_PRESETS = [0, 5, 8, 10, 15, 20, 30].filter((s) => s === 0 || (s >= COUNTDOWN_MIN && s <= COUNTDOWN_MAX));

/** Speaking questions are not built yet, so Settings does not offer the switch for them. */
export const SPEAKING_QUESTIONS = false;

/** Answers one new word a day adds to every day once it is under way: Anki's ten answers per new card. */
const ANSWERS_PER_NEW = 10;
/** Seconds an answer takes, as Learn's round estimate counts it. */
const SECONDS_PER_ANSWER = 8;

/** The plan line under a list's choices: the time a day, then when its last word starts. */
export function goalPlanText(goal: number, left: number | undefined, perNew: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((goal * perNew * SECONDS_PER_ANSWER) / 60));
  const parts = [t('settings.learn.plan.minutes', { count: minutes })];
  if (left != null) {
    if (left <= 0) parts.push(t('settings.learn.plan.allStarted'));
    else {
      const days = Math.ceil(left / Math.max(1, goal));
      const when = new Date(now + (days - 1) * 86_400_000);
      const sameYear = when.getFullYear() === new Date(now).getFullYear();
      parts.push(t('settings.learn.plan.finish', { when: formatDate(when.getTime(), sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }) }));
    }
  }
  return parts.join(' · ');
}

/** The value a learn-goal or learn-countdown element carries: a radio's data-value, the field's value. */
export function learnPickValue(el: HTMLElement): string {
  return el.dataset.value ?? (el as HTMLInputElement).value ?? '';
}

function goalRow(key: string, book: string, label: string, goal: number, left: number | undefined, pace: StudyPace | null | undefined, now: number): string {
  const perNew = pace ? pace.firstDayAnswers + pace.reviewsPerNew : ANSWERS_PER_NEW;
  const suggested = pace ? Math.max(GOAL_MIN, Math.min(GOAL_MAX, pace.suggested)) : null;
  const values = [...new Set([...GOAL_PRESETS, ...(suggested != null ? [suggested] : [])])].sort((a, b) => a - b);
  const name = `learn-goal-${key}`;
  const preset = values.includes(goal);
  const picks = values
    .map((v) => {
      const sug = v === suggested;
      return `<label class="sv-pick${v === goal ? ' is-on' : ''}${sug ? ' is-suggested' : ''}"><input type="radio" name="${name}" value="${v}" data-value="${v}" data-act="learn-goal" data-book="${esc(book)}"${v === goal ? ' checked' : ''} /><span class="sv-pick__n">${v}</span>${sug ? `<span class="sv-pick__tag">${tHtml('settings.learn.suggested')}</span>` : ''}</label>`;
    })
    .join('');
  const own = `<label class="sv-pick sv-pick--own${preset ? '' : ' is-on'}"><input type="number" class="sv-pick__field" inputmode="numeric" min="${GOAL_MIN}" max="${GOAL_MAX}" step="1" value="${preset ? '' : goal}" placeholder="${tHtml('settings.learn.other')}" aria-label="${tHtml('settings.learn.otherLabel', { list: label })}" data-act="learn-goal" data-book="${esc(book)}" /></label>`;
  return `<div class="sv-goal" data-per-new="${perNew}" data-now="${now}"${left != null ? ` data-left="${left}"` : ''}>
    <div class="sv-goal__top"><span class="sv-goal__name" id="${name}-label">${esc(label)}</span>${left != null && left > 0 ? `<span class="sv-goal__left">${tHtml('settings.learn.left', { count: left })}</span>` : ''}</div>
    <div class="sv-picks" role="radiogroup" aria-labelledby="${name}-label">${picks}${own}</div>
    <p class="sv-goal__plan" aria-live="polite">${esc(goalPlanText(goal, left, perNew, now))}</p>
  </div>`;
}

function countdownRow(value: number): string {
  const name = 'learn-countdown';
  const picks = COUNTDOWN_PRESETS.map(
    (s) =>
      `<label class="sv-pick${s === value ? ' is-on' : ''}"><input type="radio" name="${name}" value="${s}" data-value="${s}" data-act="learn-countdown"${s === value ? ' checked' : ''} /><span class="sv-pick__n">${s ? tHtml('settings.learn.secondsShort', { count: s }) : tHtml('settings.learn.off')}</span></label>`,
  ).join('');
  return `<div class="sv-goal">
    <div class="sv-goal__top"><span class="sv-goal__name" id="${name}-label">${tHtml('settings.learn.countdown')}</span></div>
    <div class="sv-picks" role="radiogroup" aria-labelledby="${name}-label">${picks}</div>
  </div>`;
}

export function learnSettingsHtml(input: LearnSettingsInput): string {
  const now = input.now ?? Date.now();
  const goals = [
    goalRow('mine', '', t('settings.learn.myWords'), input.goal, input.mineLeft, input.pace, now),
    ...input.books.map((b, i) => goalRow(`b${i}`, b.id, b.title, b.goal, b.left, input.pace, now)),
  ].join('');
  const speaking = SPEAKING_QUESTIONS && input.microphone
    ? `<div class="sv-ledger">${switchRowHtml({ label: t('settings.learn.speaking'), on: input.prefs.speaking, attrs: 'data-act="learn-speaking" id="learn-speaking"' })}</div>`
    : '';
  return `<div class="sv sv-page sv-learn">
    <header class="sv-head"><h3 class="sv-head__title">${tHtml('settings.learn.newWordsHead')}</h3></header>
    <div class="sv-ledger sv-goals">${goals}</div>
    <header class="sv-head"><h3 class="sv-head__title">${tHtml('settings.learn.questionsHead')}</h3></header>
    <div class="sv-ledger sv-goals">${countdownRow(input.prefs.countdown)}</div>
    ${speaking}
  </div>`;
}

/**
 * After a pick is saved: mark it in its list, empty the field when a preset was picked (or untick
 * the presets when a number was typed), and redo the plan line. No repaint, so focus stays.
 */
export function syncLearnPick(el: HTMLElement, value: number): void {
  const row = el.closest<HTMLElement>('.sv-goal');
  if (!row) return;
  const field = row.querySelector<HTMLInputElement>('.sv-pick__field');
  for (const radio of row.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    radio.checked = Number(radio.dataset.value) === value;
    radio.closest('.sv-pick')?.classList.toggle('is-on', radio.checked);
  }
  const preset = [...row.querySelectorAll<HTMLInputElement>('input[type="radio"]')].some((r) => r.checked);
  if (field) {
    if (preset && el !== field) field.value = '';
    if (!preset) field.value = String(value);
    field.closest('.sv-pick')?.classList.toggle('is-on', !preset);
  }
  const plan = row.querySelector<HTMLElement>('.sv-goal__plan');
  if (plan) {
    const left = row.dataset.left != null ? Number(row.dataset.left) : undefined;
    plan.textContent = goalPlanText(value, left, Number(row.dataset.perNew) || ANSWERS_PER_NEW, Number(row.dataset.now) || Date.now());
  }
}
