/**
 * Settings → Learn, desktop and phone: new words a day for My words and for each subscribed word
 * book, the countdown on choice questions, and the speaking-question switch, which only appears
 * when the device has a microphone (`microphoneAvailable` in learn-prefs.ts). The Learn tab shows
 * the settled goal and links here.
 *
 * Hooks: learn-goal (a preset radio, data-book; empty for My words), learn-goal-input (the
 * "Other" field, same data-book; act on change), learn-countdown (select), learn-speaking (switch).
 * Styles: settings-kit.css.
 */
import { esc, switchRowHtml } from './settings-kit';
import { COUNTDOWN_CHOICES, type LearnPrefs } from './learn-prefs';

export interface LearnSettingsInput {
  /** My words' new words a day. */
  goal: number;
  /** Subscribed word books, in the order Learn lists them. */
  books: Array<{ id: string; title: string; goal: number }>;
  prefs: LearnPrefs;
  /** The device has a microphone the app may use. */
  microphone: boolean;
}

export const GOAL_PRESETS = [5, 10, 20, 40];

function goalRow(key: string, book: string, label: string, goal: number): string {
  const labelId = `learn-goal-${key}`;
  const custom = !GOAL_PRESETS.includes(goal);
  const radios = GOAL_PRESETS.map(
    (g) =>
      `<label class="sv-seg__item"><input type="radio" name="${labelId}" data-act="learn-goal" data-book="${esc(book)}" value="${g}"${g === goal ? ' checked' : ''} />${g}</label>`,
  ).join('');
  return `<div class="sv-row sv-row--goal">
    <span class="sv-row__text"><span class="sv-row__label" id="${labelId}">${esc(label)}</span></span>
    <span class="sv-goal" role="group" aria-labelledby="${labelId}">
      <span class="sv-seg">${radios}</span>
      <input type="number" class="sv-num${custom ? ' is-on' : ''}" inputmode="numeric" min="1" max="999" step="1" value="${custom ? goal : ''}" placeholder="Other" enterkeyhint="done" data-act="learn-goal-input" data-book="${esc(book)}" aria-label="${esc(`${label}, other number a day`)}" />
    </span>
  </div>`;
}

function countdownRow(seconds: number): string {
  const options = COUNTDOWN_CHOICES.map((s) => `<option value="${s}"${s === seconds ? ' selected' : ''}>${s ? `${s} seconds` : 'Off'}</option>`).join('');
  const extra = COUNTDOWN_CHOICES.includes(seconds as (typeof COUNTDOWN_CHOICES)[number]) ? '' : `<option value="${seconds}" selected>${seconds} seconds</option>`;
  return `<div class="sv-row">
    <span class="sv-row__text"><label for="learn-countdown" class="sv-row__label">Countdown on choice questions</label></span>
    <select id="learn-countdown" class="sv-select" data-act="learn-countdown">${options}${extra}</select>
  </div>`;
}

export function learnSettingsHtml(input: LearnSettingsInput): string {
  const goals = [goalRow('mine', '', 'My words', input.goal), ...input.books.map((b, i) => goalRow(`b${i}`, b.id, b.title, b.goal))].join('');
  const speaking = input.microphone
    ? switchRowHtml({ label: 'Speaking questions', on: input.prefs.speaking, attrs: 'data-act="learn-speaking" id="learn-speaking"' })
    : '';
  return `<div class="sv sv-page sv-learn">
    <header class="sv-head"><h3 class="sv-head__title">New words a day</h3></header>
    <div class="sv-ledger">${goals}</div>
    <header class="sv-head"><h3 class="sv-head__title">Questions</h3></header>
    <div class="sv-ledger">${countdownRow(input.prefs.countdown)}${speaking}</div>
  </div>`;
}
