/**
 * What the answer history says about one learner (docs/REVIEW.md, "Adapting to the learner"):
 * how they do on each kind of question (`learnerModel`), which the quiz uses to pick kinds and
 * letter cues, and how much they study (`studyPace`), which sets how many new words a day fit and
 * varies today's new words with the day's reviews.
 *
 * Pure functions over `AnswerRecord` rows; the shells load the history and pass the results to
 * `startReview`, `startScopeReview` and the question options.
 */
import type { AnswerRecord } from './answer-history';
import { predictedRecall, scheduleReview, type ScheduleFields } from './review-schedule';
import { eloStep, successChance, wordStrengthFrom, type LearnerModel, type QuestionKind, type StudyPace } from './review-quiz';

const DAY = 86_400_000;

function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const graded = (r: AnswerRecord) => r.grade != null && !!r.kind && r.kind !== 'known';

function byTime(a: AnswerRecord, b: AnswerRecord): number {
  return a.answeredAt - b.answeredAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Per kind, how much better or worse this learner does than the quiz predicts, in log-odds, as
 * an Elo rating is updated (Pelánek 2016): the history is replayed in time order, each answer's
 * chance is predicted from the word's FSRS recall at that moment (the schedule rebuilt as
 * `replaySchedule` does) and the kind's ease, and the offset moves by the surprise, fast for the
 * first answers of a kind and then more slowly (`eloStep`). A learner who spells well gets a
 * positive offset for typed kinds, harder typed questions and fewer letters shown; one who
 * misspells gets fewer typed questions and more letters. `right` counts right answers per kind.
 * The letters shown at the time are not in the history, so every answer is predicted with the
 * usual cue.
 */
export function learnerModel(history: AnswerRecord[], _now = Date.now()): LearnerModel {
  const model: LearnerModel = { offset: {}, right: {} };
  const counts: Partial<Record<QuestionKind, number>> = {};
  const words = new Map<string, ScheduleFields>();
  for (const r of history.filter(graded).sort(byTime)) {
    const kind = r.kind as QuestionKind;
    let fields = words.get(r.lemma);
    if (!fields && r.prior) fields = { ...r.prior };
    const recall = fields ? predictedRecall(fields, r.answeredAt) : null;
    const p = successChance(kind, wordStrengthFrom(recall), model);
    const n = counts[kind] || 0;
    model.offset[kind] = eloStep(model.offset[kind] || 0, r.correct ? 1 : 0, p, n);
    counts[kind] = n + 1;
    if (r.correct) model.right[kind] = (model.right[kind] || 0) + 1;
    const next = scheduleReview(fields || {}, r.grade as 1 | 2 | 3 | 4, r.answeredAt);
    words.set(r.lemma, { ...(fields || {}), ...next });
  }
  for (const k of Object.keys(model.offset) as QuestionKind[]) model.offset[k] = Math.round((model.offset[k] || 0) * 1000) / 1000;
  return model;
}

/** Study days the pace looks back over, and the window they must fall in. */
const PACE_DAYS = 14;
const PACE_WINDOW_DAYS = 28;
/** Fewer study days than this give no pace. */
const PACE_MIN_DAYS = 3;
/** Anki's rule of thumb: 20 new cards a day settle at about 200 reviews a day, ten answers per new card. */
const ANSWERS_PER_NEW = 10;
const DEFAULT_FIRST_DAY = 2.5;

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * How much the learner studies, from the last fourteen days with answers within four weeks,
 * today left out because it is not over: the median answers a day, how many answers a new word
 * takes on its first day, and how often review answers are right. Each new word a day later adds
 * about 7.5 review answers to every day (Anki's ten answers per new card, less the first day),
 * more when reviews go wrong more often than the 90% the schedule aims at. `suggested` is the
 * number of new words a day that keeps a day near the usual day's answers. Null with fewer than
 * three study days.
 */
export function studyPace(history: AnswerRecord[], now = Date.now()): StudyPace | null {
  const rows = history.filter(graded).sort((a, b) => a.answeredAt - b.answeredAt);
  const today = dayStart(now);
  const from = today - PACE_WINDOW_DAYS * DAY;
  const firstDay = new Map<string, number>();
  for (const r of rows) if (!firstDay.has(r.lemma)) firstDay.set(r.lemma, dayStart(r.answeredAt));
  const perDay = new Map<number, AnswerRecord[]>();
  for (const r of rows) {
    if (r.answeredAt < from || r.answeredAt >= today) continue;
    const d = dayStart(r.answeredAt);
    const list = perDay.get(d);
    if (list) list.push(r);
    else perDay.set(d, [r]);
  }
  const days = [...perDay.keys()].sort((a, b) => b - a).slice(0, PACE_DAYS);
  if (days.length < PACE_MIN_DAYS) return null;
  const counts = days.map((d) => perDay.get(d)!.length);
  let started = 0;
  let firstAnswers = 0;
  let reviews = 0;
  let reviewsRight = 0;
  for (const d of days) {
    for (const r of perDay.get(d)!) {
      if (firstDay.get(r.lemma) === d) firstAnswers += 1;
      else {
        reviews += 1;
        if (r.correct) reviewsRight += 1;
      }
    }
    for (const [, fd] of firstDay) if (fd === d) started += 1;
  }
  const answersPerDay = median(counts);
  const firstDayAnswers = started >= 5 ? Math.min(6, Math.max(1, firstAnswers / started)) : DEFAULT_FIRST_DAY;
  const accuracy = reviews >= 20 ? reviewsRight / reviews : 0.9;
  const reviewsPerNew = (ANSWERS_PER_NEW - DEFAULT_FIRST_DAY) * (1 + 3 * Math.max(0, 0.9 - accuracy));
  const suggested = Math.max(1, Math.min(100, Math.round(answersPerDay / (firstDayAnswers + reviewsPerNew))));
  return {
    answersPerDay,
    accuracy: Math.round(accuracy * 1000) / 1000,
    firstDayAnswers: Math.round(firstDayAnswers * 100) / 100,
    reviewsPerNew: Math.round(reviewsPerNew * 100) / 100,
    suggested,
    days: days.length,
  };
}

/**
 * Whether to offer the suggested number in place of the learner's goal: only when they differ by
 * at least two words and by at least a third of the goal, so it does not nag over small gaps.
 */
export function suggestGoal(goal: number, pace: StudyPace | null | undefined): number | null {
  if (!pace) return null;
  const s = pace.suggested;
  return Math.abs(s - goal) >= Math.max(2, goal / 3) ? s : null;
}
