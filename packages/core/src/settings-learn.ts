/**
 * Settings → Learn, desktop and phone: new words a day for My words and for each subscribed word
 * book, and the countdown on choice questions. Each is a number wheel (number-wheel.ts) on its own
 * card: drag or flick it, scroll it, step it with the arrow keys, or tap the number to type one.
 * The Learn tab shows the settled goal and links here. The speaking-question switch (shown only
 * with a microphone, `microphoneAvailable` in learn-prefs.ts) stays hidden until speaking
 * questions exist (`SPEAKING_QUESTIONS`); its stored preference is kept.
 *
 * Hooks: learn-goal (a wheel, data-book; empty for My words) and learn-countdown (a wheel; 0 is
 * Off). Both send a bubbling `change` once the wheel settles, with the value in `data-value`;
 * learn-speaking (switch). The host calls `wireNumberWheels` on a container that outlives repaints.
 * Styles: settings-kit.css.
 */
import { esc, switchRowHtml } from './settings-kit';
import { COUNTDOWN_MAX, COUNTDOWN_MIN, type LearnPrefs } from './learn-prefs';
import { numberWheelHtml } from './number-wheel';

export interface LearnSettingsInput {
  /** My words' new words a day. */
  goal: number;
  /** Subscribed word books, in the order Learn lists them. */
  books: Array<{ id: string; title: string; goal: number }>;
  prefs: LearnPrefs;
  /** The device has a microphone the app may use. */
  microphone: boolean;
}

/** New words a day run from 1 to 999, as `parseGoal` allows. */
export const GOAL_MIN = 1;
export const GOAL_MAX = 999;

/** Speaking questions are not built yet, so Settings does not offer the switch for them. */
export const SPEAKING_QUESTIONS = false;

function dial(key: string, label: string, wheel: string): string {
  return `<div class="sv-dial">
    <span class="sv-dial__label" id="${key}-label">${esc(label)}</span>
    ${wheel}
  </div>`;
}

function goalDial(key: string, book: string, label: string, goal: number): string {
  const id = `learn-goal-${key}`;
  return dial(
    id,
    label,
    numberWheelHtml({ id, labelledBy: `${id}-label`, value: goal, min: GOAL_MIN, max: GOAL_MAX, page: 10, attrs: `data-act="learn-goal" data-book="${esc(book)}"` }),
  );
}

export function learnSettingsHtml(input: LearnSettingsInput): string {
  const goals = [goalDial('mine', '', 'My words', input.goal), ...input.books.map((b, i) => goalDial(`b${i}`, b.id, b.title, b.goal))].join('');
  const countdown = dial(
    'learn-countdown',
    'Countdown on choice questions',
    numberWheelHtml({
      id: 'learn-countdown',
      labelledBy: 'learn-countdown-label',
      value: input.prefs.countdown,
      min: COUNTDOWN_MIN,
      max: COUNTDOWN_MAX,
      off: true,
      unit: 'seconds',
      page: 5,
      attrs: 'data-act="learn-countdown"',
    }),
  );
  const speaking = SPEAKING_QUESTIONS && input.microphone
    ? `<div class="sv-ledger">${switchRowHtml({ label: 'Speaking questions', on: input.prefs.speaking, attrs: 'data-act="learn-speaking" id="learn-speaking"' })}</div>`
    : '';
  return `<div class="sv sv-page sv-learn">
    <header class="sv-head"><h3 class="sv-head__title">New words a day</h3></header>
    <div class="sv-dials">${goals}</div>
    <header class="sv-head"><h3 class="sv-head__title">Questions</h3></header>
    <div class="sv-dials">${countdown}</div>
    ${speaking}
  </div>`;
}
