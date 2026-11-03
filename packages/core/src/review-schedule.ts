/**
 * Review scheduling with FSRS (ts-fsrs, MIT), the model Anki has offered since 23.10.
 *
 * Each word keeps a memory state: stability (days until recall falls to 90%), difficulty (1 to
 * 10), a card state (new, learning, review, relearning), lapses, the learning step and the time
 * of the last review. Words saved before FSRS carry only the old SM-2 fields (interval, ease,
 * reps); their first FSRS review starts from a state derived from those, with the same formula
 * fsrs-rs uses when Anki switches a collection to FSRS (`memory_state_from_sm2`).
 *
 * The old fields stay filled (`reviewDue`, `reviewInterval`, `reps`, `ease`), so an older app
 * that syncs the same notebook still sees sensible due dates.
 */
import { Rating, State, createEmptyCard, default_w, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs';

export type ReviewGrade = 1 | 2 | 3 | 4;

/** The fields of a notebook entry that scheduling reads. */
export interface ScheduleFields {
  createdAt?: number | string | null;
  reviewDue?: number | null;
  reviewInterval?: number | null;
  ease?: number | null;
  reps?: number | null;
  stability?: number | null;
  difficulty?: number | null;
  state?: number | null;
  lapses?: number | null;
  lastReview?: number | null;
  learningSteps?: number | null;
}

/** What a review writes back. */
export interface ScheduleUpdate {
  reviewDue: number;
  reviewInterval: number;
  ease: number;
  reps: number;
  stability: number;
  difficulty: number;
  state: number;
  lapses: number;
  lastReview: number;
  learningSteps: number;
}

const DAY = 86_400_000;
/** Anki's default desired retention. */
export const DESIRED_RETENTION = 0.9;

const scheduler = fsrs(generatorParameters({ request_retention: DESIRED_RETENTION, enable_fuzz: true, enable_short_term: true }));

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * FSRS memory state from SM-2 values, as fsrs-rs does it for FSRS-6 with the old schedule's
 * retention taken as 90%: stability equals the interval, and difficulty follows from the ease.
 */
export function memoryFromSm2(ease: number, intervalDays: number, w: readonly number[] = default_w): { stability: number; difficulty: number } {
  const retention = 0.9;
  const decay = -w[20];
  const factor = Math.pow(0.9, 1 / decay) - 1;
  const stability = (Math.max(intervalDays, 0.001) * factor) / (Math.pow(retention, 1 / decay) - 1);
  const difficulty = 11 - (ease - 1) / (Math.exp(w[8]) * Math.pow(stability, -w[9]) * Math.expm1((1 - retention) * w[10]));
  return { stability, difficulty: Math.min(10, Math.max(1, Number.isFinite(difficulty) ? difficulty : 5)) };
}

/** The entry as a ts-fsrs card, converting SM-2-only rows on the way. */
export function cardFromEntry(e: ScheduleFields, now: number): Card {
  const reps = Number(e.reps) || 0;
  const stability = num(e.stability);
  const state = num(e.state);
  if (stability != null && stability > 0 && state != null) {
    const last = num(e.lastReview);
    const due = num(e.reviewDue) ?? now;
    return {
      due: new Date(due),
      stability,
      difficulty: num(e.difficulty) ?? 5,
      elapsed_days: last != null ? Math.max(0, Math.floor((now - last) / DAY)) : 0,
      scheduled_days: Math.max(0, Math.round(num(e.reviewInterval) ?? 0)),
      learning_steps: Number(e.learningSteps) || 0,
      reps,
      lapses: Number(e.lapses) || 0,
      state: state as State,
      last_review: last != null ? new Date(last) : undefined,
    };
  }
  if (!reps) return createEmptyCard(new Date(num(e.createdAt) ?? now));
  // Reviewed under SM-2 only.
  const interval = Math.max(1, num(e.reviewInterval) ?? 1);
  const mem = memoryFromSm2(num(e.ease) ?? 2.5, interval);
  const due = num(e.reviewDue) ?? now;
  const last = num(e.lastReview) ?? due - interval * DAY;
  return {
    due: new Date(due),
    stability: mem.stability,
    difficulty: mem.difficulty,
    elapsed_days: Math.max(0, Math.floor((now - last) / DAY)),
    scheduled_days: interval,
    learning_steps: 0,
    reps,
    lapses: 0,
    state: State.Review,
    last_review: new Date(last),
  };
}

const RATING: Record<ReviewGrade, Grade> = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy };

/** The new schedule after one review graded Again (1), Hard (2), Good (3) or Easy (4). */
export function scheduleReview(e: ScheduleFields, grade: ReviewGrade, now = Date.now()): ScheduleUpdate {
  const card = cardFromEntry(e, now);
  const next = scheduler.next(card, new Date(now), RATING[grade] ?? Rating.Good).card;
  const due = next.due.getTime();
  // SM-2 ease kept roughly in step with difficulty for older apps: 1 maps to 3.0, 10 to 1.3.
  const ease = Math.round((3.0 - ((next.difficulty - 1) / 9) * 1.7) * 100) / 100;
  return {
    reviewDue: due,
    reviewInterval: Math.max(0, Math.round((due - now) / DAY)),
    ease,
    reps: next.reps,
    stability: next.stability,
    difficulty: next.difficulty,
    state: next.state,
    lapses: next.lapses,
    lastReview: now,
    learningSteps: next.learning_steps,
  };
}

/** Milliseconds until the word would be due again after this grade, without saving anything. */
export function previewReview(e: ScheduleFields, grade: ReviewGrade, now = Date.now()): number {
  return Math.max(0, scheduleReview(e, grade, now).reviewDue - now);
}

/** "10 min", "3 days", "2 months": how long until a word comes back. */
export function formatReviewGap(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(ms / 3_600_000);
  if (h < 24) return `${h} h`;
  const d = Math.round(ms / DAY);
  if (d < 31) return d === 1 ? '1 day' : `${d} days`;
  const mo = Math.round(d / 30.4);
  if (mo < 12) return mo === 1 ? '1 month' : `${mo} months`;
  const y = Math.round((d / 365) * 10) / 10;
  return y === 1 ? '1 year' : `${y} years`;
}
