/**
 * Quiz-style review (docs/REVIEW.md). Each due word becomes one question whose kind depends on how
 * well the word is remembered, from recognising its meaning among four choices up to typing it
 * from the meaning or into a gap in the learner's own example sentence. The answer is graded from
 * correctness and response time, mapped to FSRS's Again, Hard, Good and Easy; the learner can
 * overturn that grade with one tap.
 *
 * Everything here is pure: the shells keep a ReviewState, call these functions on clicks and
 * keys, save the grade through `reviewVocab`, and render with `reviewHtml`.
 */
import { clean, dayStart, DAY, type NotebookEntry } from './notebook-shared';
import { vocabSenses } from './vocab-view';
import { isGrammaticalFormOfGloss } from './lookup-policy';
import { predictedRecall, type ReviewGrade } from './review-schedule';
import { vocabHeadwordLang } from './vocab-lang';
import { classify, sanitize, trimEdges } from './text-normalize';
import { t } from './i18n/runtime';

const langOf = (e: NotebookEntry) => ({ lemma: clean(e.lemma), sourceLang: clean(e.sourceLang) || undefined });

export type { ReviewGrade };

/**
 * - meaning-choice: the word is shown, pick its meaning (passive recognition).
 * - word-choice: the meaning is shown, pick the word (active recognition).
 * - listen-choice: the word is played, pick it (early stages only).
 * - recall: the meaning is shown with the first letter or more, type the word (active recall).
 * - listen-type: dictation; the word is played, type it.
 * - cloze: a sentence from the learner's note with the word blanked out, type it.
 * - cloze-choice: the same kind of sentence, pick the word for the gap among four, each in the
 *   form the gap needs (Duolingo's "Select the missing word"; 百词斩 starts a word from its
 *   example sentence).
 * - spell-tiles: the meaning is shown, build the word from its letters in a shuffled row (百词斩's
 *   spelling drill, Duolingo's word bank); a step between recognising a word and typing it.
 * - synonym-choice: the word is shown, pick the word closest in meaning among four (TOEFL's
 *   "closest in meaning to", the GRE's synonym items); the right one is a synonym from the word's
 *   dictionary entry, the others are words from the notebook.
 * - antonym-choice: the word is shown, pick the word opposite in meaning among four (the GRE's
 *   antonym items, TEM-4's "opposite in meaning"); one wrong option is a synonym when the entry
 *   lists one, since mistaking the direction is the usual slip, the rest are notebook words.
 * - word-form: a sentence with a gap and a related word in capitals, type the form that fits
 *   (Cambridge B2 First and C1 Advanced, Use of English part 3); the capitals are another word of
 *   the family ("DECREPITUDE" for "decrepit"), so the learner produces the word and its form.
 * - flash: show the word, then the meaning, and the learner says whether they knew it; used only
 *   when nothing else can be asked (no meaning saved and too few other words).
 */
export type QuestionKind =
  | 'meaning-choice'
  | 'word-choice'
  | 'listen-choice'
  | 'cloze-choice'
  | 'spell-tiles'
  | 'synonym-choice'
  | 'antonym-choice'
  | 'recall'
  | 'listen-type'
  | 'cloze'
  | 'word-form'
  | 'flash';

/** Every kind, for checking a kind that comes from storage or another process. */
export const QUESTION_KINDS: QuestionKind[] = ['meaning-choice', 'word-choice', 'listen-choice', 'cloze-choice', 'spell-tiles', 'synonym-choice', 'antonym-choice', 'recall', 'listen-type', 'cloze', 'word-form', 'flash'];

/** A typo is one slip in a word the learner otherwise spelt right (`checkTyped`); it counts as right. */
export type AnswerResult = 'right' | 'typo' | 'wrong';

export interface ReviewQuestion {
  id: string;
  kind: QuestionKind;
  lemma: string;
  level: number;
  /** The meaning (word-choice, recall) or the sentence with a gap (cloze). */
  prompt: string;
  /** Choice texts, and the saved word each one belongs to. */
  options: string[];
  optionWords: string[];
  correct: number;
  /** Typed answers that count as right. */
  answers: string[];
  /** The letters shown before typing (typed questions): the first `reveal` letters of the answer. */
  hint: string;
  /** How many letters `hint` holds: the first letter, none for dictation (`cueLetters`). */
  reveal?: number;
  /** How many times Hint gave a letter. */
  hinted?: number;
  /** Leading letters of the answer shown so far, by the question and by Hint. */
  shown?: number;
  /** What the answer box holds, kept on every keystroke so a repaint never clears it. */
  draft?: string;
  shownAt: number;
  /** Missed LEECH_LAPSES times or more. */
  leech?: boolean;
  /** The word's stage when asked. */
  maturity?: Maturity;
  /** Predicted chance of a right answer to this question, from the word's recall and the learner. */
  predicted?: number;
  /** Countdown milliseconds used while the question was on screen (`armCountdown`). */
  countdownSpent?: number;
  /** A listening question's word has played, or could not be played (`markHeard`). */
  heard?: boolean;
  /** Letter tiles (spell-tiles): the word's letters in a shuffled row. */
  tiles?: string[];
  /** Letter tiles placed so far, by their place in `tiles`, in the order tapped. */
  placed?: number[];
  /** Word formation: the related word printed in capitals after the sentence. */
  cue?: string;
}

export interface ReviewAnswer {
  choice: number;
  typed: string;
  result: AnswerResult;
  /** Grade from correctness and time. */
  auto: ReviewGrade;
  /** Grade that will be saved: `auto` unless the learner overturned it. */
  grade: ReviewGrade;
  overridden: boolean;
  ms: number;
  /** The countdown on a choice question ran out before an answer. */
  timedOut?: boolean;
  /** When the answer was given, so a repaint can resume the mark where it was. */
  at?: number;
}

export interface ReviewResult {
  id: string;
  lemma: string;
  kind: QuestionKind;
  result: AnswerResult;
  grade: ReviewGrade;
  ms: number;
  /** Memory level (0 new to 3 held for weeks) before and after the answer. */
  levelBefore?: number;
  levelAfter?: number;
  /** Stage before and after the answer. */
  maturityBefore?: Maturity;
  maturityAfter?: Maturity;
  /** Letters revealed with Hint. */
  hinted?: number;
  /** Share of the hidden letters Hint gave away (`hintShare`), which lowers the answer's credit. */
  hintShare?: number;
  /** The question's predicted chance of a right answer, for updating the learner model. */
  predicted?: number;
}

export interface ReviewState {
  queue: string[];
  index: number;
  started: boolean;
  question: ReviewQuestion | null;
  answer: ReviewAnswer | null;
  /** Flash questions: the meaning is showing. */
  revealed: boolean;
  results: ReviewResult[];
  /** How often each word has been asked this session. */
  seen: Record<string, number>;
  seed: number;
  /** Words due or new today that wait for the next round. */
  rest?: number;
  /** New words held back today because many reviews are due. */
  heldBack?: number;
  /** New words held back until tomorrow because today's answers already fill the learner's usual day. */
  heldForToday?: number;
  /** Words set aside with "Already know it" this round, for the summary's Undo. */
  knownMarked?: string[];
}

export interface QuestionOptions {
  /** Pronunciation can be played (sound is on). */
  audio?: boolean;
  now?: number;
  /** Example sentences for a word (from its dictionary entry), for gap-fill questions. */
  examples?: (lemma: string) => string[] | undefined;
  /** Synonyms of a word (from its dictionary entry), for "closest in meaning" questions. */
  synonyms?: (lemma: string) => string[] | undefined;
  /** Antonyms of a word (from its dictionary entry), for "opposite in meaning" questions. */
  antonyms?: (lemma: string) => string[] | undefined;
  /** Other words of a word's family (from its dictionary entry), for word-formation questions. */
  family?: (lemma: string) => string[] | undefined;
  /** Kinds asked so far this session, oldest first, for the skill balance. */
  asked?: QuestionKind[];
  /** How often this word was asked earlier in this session. */
  repeat?: number;
  /** What the learner's answers say about them (`learnerModel` in learn-adapt.ts). Without it every kind is open. */
  learner?: LearnerModel | null;
}

/**
 * What a learner's own answers say, for choosing questions. `offset` is added to the predicted
 * log-odds of a right answer for each kind: positive when the learner gets that kind right more
 * often than the model expects. `right` counts right answers per kind, for unlocking harder kinds.
 */
export interface LearnerModel {
  offset: Partial<Record<QuestionKind, number>>;
  right: Partial<Record<QuestionKind, number>>;
}

/** How much a learner studies, from their answer history (`studyPace` in learn-adapt.ts). */
export interface StudyPace {
  /** Answers on a usual study day: the median of the recent days with any answers. */
  answersPerDay: number;
  /** Share of review answers that were right on those days. */
  accuracy: number;
  /** Answers a new word takes on the day it is started. */
  firstDayAnswers: number;
  /** Review answers each new word a day adds to a later day's load. */
  reviewsPerNew: number;
  /** New words a day that keep a day's work near the usual day. */
  suggested: number;
  /** Study days the numbers come from. */
  days: number;
  /** Answers given so far today; the shells add each new one, so another round does not plan a new batch. */
  answersToday?: number;
}

/** Taps and keys this soon after a question appears are ignored, so a double tap on Continue cannot answer the next one. */
export const ARM_MS = 400;

/** Whether the current question takes answers yet (`ARM_MS`). */
export function reviewArmed(state: ReviewState | null | undefined, now = Date.now()): boolean {
  const q = state?.question;
  return !q || now - q.shownAt >= ARM_MS;
}

/** A word asked this many times in one session waits for the next session. */
export const MAX_ASKS_PER_SESSION = 3;
/** A leech comes back at most this many times in one session. */
export const MAX_LEECH_ASKS = 2;
/** Like Anki's learn-ahead limit: a word due again within this window comes back this session. */
export const LEARN_AHEAD_MS = 20 * 60_000;
/** Words in one round; what is left waits for the next round. */
export const ROUND_WORDS = 20;
/** Misses after which a word is a leech (Anki's default is 8 lapses; graded quizzes count every miss). */
export const LEECH_LAPSES = 4;
/** Listening questions never pass this share of a session. */
export const LISTEN_CAP = 0.2;

/* ------------------------------------------------------------------ queue */

/**
 * A word never reviewed. Saving a word stamps its due time with the save time, while an SM-2
 * "Again" reset reps to 0 but moved the due time past the save time, so that row still counts
 * as reviewed.
 */
export function isNewWord(e: NotebookEntry): boolean {
  if (Number(e.reps) > 0 || e.lastReview != null || Number(e.state) > 0) return false;
  return e.reviewDue == null || (e.createdAt != null && Number(e.reviewDue) <= Number(e.createdAt));
}

const isNew = isNewWord;

/**
 * Parts of speech that name a sign rather than a word: Wiktionary files ISO codes ("LIL"),
 * chemical and unit symbols and letters such as "𝜓" under Symbol or Letter, and the lookup marks
 * a translated sentence as "sentence".
 */
const NOT_WORD_POS = new Set(['symbol', 'letter', 'punctuation', 'sentence']);
/** LingQ's phrase limit: a saved phrase of up to nine words is still a phrase; longer is running text. */
export const MAX_PHRASE_WORDS = 9;
/** The line the lookup saves in place of a meaning when it translated a sentence (`dictionary.ts`). */
const TRANSLATION_PLACEHOLDER = /^translation from [a-z-]{2,}\s+to\s+[a-z-]{2,}\.?$/i;
const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Whether Learn studies a saved entry. Like Language Reactor, which keeps saved sentences apart
 * from saved words, and LingQ and Readlang, whose cards hold words and short phrases, Learn leaves
 * out what is not a word or phrase: a headword without a letter (punctuation, digits, emoji); an
 * entry the dictionary files as a symbol, letter or punctuation mark, or that was looked up as a
 * sentence; a run of text without a part of speech that is longer than MAX_PHRASE_WORDS words or
 * than the lookup's own sentence line (a long CJK line); and an entry whose saved meanings are
 * only the lookup's translation placeholder or the headword repeated back. The entry stays in My
 * words and everywhere else. Phrases, idioms and proverbs a dictionary lists ("cease and desist"),
 * and words of any language with a real sense, stay in.
 * A word with no meaning saved yet (a book word not looked up) stays in too.
 */
export function isLearnable(e: NotebookEntry): boolean {
  const lemma = clean(e.lemma);
  if (!/\p{L}/u.test(lemma)) return false;
  if (NOT_WORD_POS.has(normPos(e.partOfSpeech))) return false;
  // A long run of text is running text, unless a dictionary filed it under a part of speech (a proverb).
  if (!normPos(e.partOfSpeech)) {
    const text = trimEdges(sanitize(lemma));
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > MAX_PHRASE_WORDS) return false;
    // The lookup sends a CJK line of more than twelve characters, or any text past 120 characters, to translation.
    if (classify(text) === 'sentence' && (words === 1 || text.length > 120)) return false;
  }
  const def = clean(e.definition);
  if (!def) return true;
  const own = fold(lemma);
  return vocabSenses(def).some((s) => {
    const t = clean(s);
    return !!t && !TRANSLATION_PLACEHOLDER.test(t) && fold(t) !== own;
  });
}

/** A word missed often enough that more of the same drilling is not working (Anki calls it a leech). */
export function isLeech(e: NotebookEntry): boolean {
  return Number(e.lapses) >= LEECH_LAPSES;
}

/**
 * New words a day allows when reviews pile up, as MaiMemo and Anki's review limit do: the full
 * goal while due reviews are at most five times the goal, then one fewer for every five reviews
 * beyond that, and none at ten times the goal.
 */
export function newWordAllowance(goal: number, due: number): number {
  const g = Math.max(0, Math.round(goal));
  if (!g || due <= 5 * g) return g;
  return Math.max(0, g - Math.ceil((due - 5 * g) / 5));
}

/** Answers a due review takes on average, counting the relearning asks after a miss. */
export const ANSWERS_PER_REVIEW = 1.2;

/**
 * New words that may still start today, which vary with the day's load as MaiMemo's do:
 * `newWordAllowance`, and, once the learner's pace is known, no more than fit in a usual day's
 * answers with a fifth to spare beside the reviews still due and the answers already given today
 * (`pace.answersToday`). The callers take the words already started off the goal, so the pace is
 * a limit for the day: a second round does not plan another batch. A heavy day gets fewer new
 * words and a light day the whole goal.
 */
export function newWordsToday(goal: number, due: number, pace?: StudyPace | null): number {
  const base = newWordAllowance(goal, due);
  if (!pace || !(pace.answersPerDay > 0)) return base;
  const room = (pace.answersPerDay - (pace.answersToday || 0) - due * ANSWERS_PER_REVIEW) * 1.2;
  const byLoad = Math.floor(Math.max(0, room) / Math.max(1, pace.firstDayAnswers));
  return Math.max(0, Math.min(base, byLoad));
}

/**
 * One entry per word, so two saved forms or spellings of one word never share a session
 * (`sameWordEntries`). The first in order is kept, unless only the later one has a sense a
 * question can use. Entries meet through `lemmaKeys`, so this is one pass, not a comparison of
 * every pair.
 */
export function dedupeLemmas<T extends NotebookEntry>(list: T[]): T[] {
  const slots: Array<T | null> = [];
  const byKey = new Map<string, number[]>();
  for (const e of list) {
    const l = clean(e.lemma).toLowerCase();
    if (!l) continue;
    const keys = lemmaKeys(l);
    let hit = -1;
    for (const k of keys) {
      for (const i of byKey.get(k) || []) {
        const kept = slots[i];
        if (kept && sameWordEntries(kept, e)) {
          hit = i;
          break;
        }
      }
      if (hit >= 0) break;
    }
    if (hit >= 0) {
      const kept = slots[hit]!;
      // The word itself rather than its form ("errand", not "errands" saved as "… of errand"),
      // and an entry with a usable sense rather than one without.
      const keptIsForm = new RegExp(`\\bof\\s+["“]?${escRe(clean(e.lemma).toLowerCase())}\\b`, 'i').test(clean(kept.definition));
      if ((keptIsForm && questionMeaning(e)) || (!questionMeaning(kept) && questionMeaning(e))) slots[hit] = e;
      continue;
    }
    const i = slots.push(e) - 1;
    for (const k of keys) {
      const list = byKey.get(k);
      if (list) list.push(i);
      else byKey.set(k, [i]);
    }
  }
  return slots.filter((e): e is T => !!e);
}

/** Reviews in order with the new words spread evenly among them. */
export function interleaveNew<T>(due: T[], fresh: T[]): T[] {
  if (!due.length || !fresh.length) return [...due, ...fresh];
  const out: T[] = [];
  const step = Math.max(1, Math.floor(due.length / fresh.length));
  let f = 0;
  due.forEach((e, i) => {
    out.push(e);
    if ((i + 1) % step === 0 && f < fresh.length) out.push(fresh[f++]);
  });
  return [...out, ...fresh.slice(f)];
}

export interface QueuePlan {
  /** Every word for today, in order; a round takes the first ROUND_WORDS. */
  ids: string[];
  due: number;
  fresh: number;
  /** New words the goal allowed but the review load held back; they come once the reviews are done. */
  heldBack: number;
  /** New words the goal allowed but the learner's usual day has no room for; they wait for tomorrow. */
  heldForToday?: number;
}

/**
 * Today's plan: words due by the end of today, most overdue first, and today's new words (oldest
 * saved first, up to the daily goal less those started today, fewer when many reviews are due,
 * `newWordsToday`) spread among them. One form of each word only, and only what Learn studies
 * (`isLearnable`).
 */
export function reviewPlan(all: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0, pace?: StudyPace | null): QueuePlan {
  const end = dayStart(now) + DAY;
  const entries = all.filter(isLearnable);
  const dueAll = entries.filter((e) => !isNew(e) && e.reviewDue != null && Number(e.reviewDue) < end).sort((x, y) => Number(x.reviewDue) - Number(y.reviewDue));
  const newAll = entries.filter((e) => isNew(e) && clean(e.lemma)).sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0));
  const kept = new Set(dedupeLemmas([...dueAll, ...newAll]));
  const due = dueAll.filter((e) => kept.has(e));
  const fresh = newAll.filter((e) => kept.has(e));
  const left = Math.max(0, goal - startedToday);
  const avail = Math.min(fresh.length, left);
  const byReviews = Math.min(avail, newWordAllowance(goal, due.length));
  const taken = fresh.slice(0, Math.min(byReviews, newWordsToday(goal, due.length, pace)));
  return { ids: interleaveNew(due, taken).map((e) => e.id), due: due.length, fresh: taken.length, heldBack: avail - byReviews, heldForToday: byReviews - taken.length };
}

/** Today's queue (`reviewPlan` ids). */
export function reviewQueue(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0, pace?: StudyPace | null): string[] {
  return reviewPlan(entries, goal, now, startedToday, pace).ids;
}

/** A session over the first round of a plan. */
export function reviewStateFor(plan: QueuePlan, now = Date.now()): ReviewState {
  return {
    queue: plan.ids.slice(0, ROUND_WORDS),
    index: 0,
    started: false,
    question: null,
    answer: null,
    revealed: false,
    results: [],
    seen: {},
    seed: Math.floor(now % 2147483647),
    rest: Math.max(0, plan.ids.length - ROUND_WORDS),
    heldBack: plan.heldBack,
    heldForToday: plan.heldForToday || 0,
  };
}

/** Which extra round "Nothing due today" offers: more new words, or reviews before they are due. */
export type ExtraRound = 'new' | 'ahead';

/**
 * Words for a round past today's plan, as Anki's Custom Study offers: `new` takes the next unstarted
 * words in saved order (book words in book order), `count` of them; `ahead` takes started words not
 * due yet, soonest due first, one round's worth. Known words and what Learn leaves out stay out.
 * Answering early is fine for the schedule, which counts the days that really passed.
 */
export function extraRoundIds(all: NotebookEntry[], kind: ExtraRound, now = Date.now(), count = ROUND_WORDS): string[] {
  const end = dayStart(now) + DAY;
  const entries = dedupeLemmas(all.filter((e) => isLearnable(e) && clean(e.lemma) && !(e as { known?: boolean }).known));
  if (kind === 'new') {
    return entries
      .filter(isNew)
      .sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0))
      .slice(0, Math.max(0, count))
      .map((e) => e.id);
  }
  return entries
    .filter((e) => !isNew(e) && e.reviewDue != null && Number(e.reviewDue) >= end)
    .sort((x, y) => Number(x.reviewDue) - Number(y.reviewDue))
    .slice(0, ROUND_WORDS)
    .map((e) => e.id);
}

/** A started session over an extra round (`extraRoundIds`). */
export function startExtraRound(all: NotebookEntry[], kind: ExtraRound, now = Date.now(), count = ROUND_WORDS): ReviewState {
  const ids = extraRoundIds(all, kind, now, count);
  return { ...reviewStateFor({ ids, due: kind === 'ahead' ? ids.length : 0, fresh: kind === 'new' ? ids.length : 0, heldBack: 0 }, now), started: true };
}

export function startReview(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0, pace?: StudyPace | null): ReviewState {
  return reviewStateFor(reviewPlan(entries, goal, now, startedToday, pace), now);
}

/* ------------------------------------------------------------- strength */

/**
 * 0 for a new word, 1 while learning or relearning or when the memory lasts under four days,
 * 2 under three weeks, 3 beyond. Rows from before FSRS use the SM-2 interval as the stability.
 */
export function memoryLevel(e: NotebookEntry): number {
  if (isNew(e)) return 0;
  const state = Number(e.state);
  if (state === 1 || state === 3) return 1;
  const s = Number(e.stability ?? e.reviewInterval ?? 0) || 0;
  if (s < 4) return 1;
  if (s < MATURE_DAYS) return 2;
  return 3;
}

/**
 * A word's stage, Anki's card stages with FSRS stability in place of the interval: new (never
 * answered), learning (first steps), relearning (after a lapse), young (in review, held under
 * three weeks) and mature (held three weeks or more). Stability, unlike the interval, does not
 * move when the desired retention changes.
 */
export type Maturity = 'new' | 'learning' | 'relearning' | 'young' | 'mature';

/** Anki's line between young and mature, in days of stability. */
export const MATURE_DAYS = 21;

/** A stage's name in the interface language, read when shown (getters, so it follows a language change). */
export const MATURITY_NAME: Record<Maturity, string> = {
  get new() {
    return t('notebook.maturity.new');
  },
  get learning() {
    return t('notebook.maturity.learning');
  },
  get relearning() {
    return t('notebook.maturity.relearning');
  },
  get young() {
    return t('notebook.maturity.young');
  },
  get mature() {
    return t('notebook.maturity.mature');
  },
};

export function wordMaturity(e: NotebookEntry): Maturity {
  if (isNew(e)) return 'new';
  const state = Number(e.state);
  if (state === 1) return 'learning';
  if (state === 3) return 'relearning';
  const s = Number(e.stability ?? e.reviewInterval ?? 0) || 0;
  if (!s && !state) return 'learning';
  return s >= MATURE_DAYS ? 'mature' : 'young';
}

/* ---------------------------------------------------------------- text */

/** Seeded generator (mulberry32), so a question stays the same across re-renders. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLatin = (s: string) => /^[\p{Script=Latin}\s'’-]+$/u.test(s);

/** Pattern for the word and its common inflections (ignore: ignores, ignored, ignoring). */
function formPattern(lemma: string): RegExp {
  const low = lemma.toLowerCase();
  if (!isLatin(low)) return new RegExp(escRe(low), 'gi');
  let base = low;
  let tail = `${escRe(low.slice(-1))}?`;
  if (base.length > 3 && base.endsWith('e')) {
    base = base.slice(0, -1);
    tail = '';
  } else if (base.length > 3 && base.endsWith('y')) {
    base = base.slice(0, -1);
    tail = '(?:y|i)';
  }
  return new RegExp(`(?<!\\p{L})${escRe(base)}${tail}(?:e|s|es|ed|d|ing|er|ers|est|ly)?(?!\\p{L})`, 'giu');
}

/**
 * The regular forms the saved parts of speech allow: a noun takes -s, a verb -s, -ed and -ing, an
 * adjective or adverb none. A saved noun is never asked as a verb form its dictionary lists only
 * for a rare sense ("erranded" for the noun "errand"). Null (every form) when the part of speech is
 * unknown or one this does not cover.
 */
function formsForPos(lemma: string, pos: unknown): string[] | null {
  const parts = clean(pos).toLowerCase().split(/[\s,;/]+/).map((p) => normPos(p)).filter(Boolean);
  if (!parts.length) return null;
  const slots = regularFormSlots(lemma);
  if (!slots) return null;
  const out = new Set<string>();
  for (const p of parts) {
    if (p === 'noun') out.add(slots.s);
    else if (p === 'verb') [slots.s, slots.ed, slots.ing].forEach((f) => out.add(f));
    else if (p !== 'adjective' && p !== 'adverb') return null;
  }
  out.delete(clean(lemma).toLowerCase());
  return [...out];
}

/** The word and its regular inflections in running text, for gap-fill questions (not leader for lead). */
function clozePattern(lemma: string, pos?: unknown): RegExp {
  const low = lemma.toLowerCase();
  if (!isLatin(low) || /\s/.test(low)) return new RegExp(escRe(low), 'gi');
  const forms = [low, ...(formsForPos(low, pos) ?? regularForms(low))].sort((a, b) => b.length - a.length).map(escRe);
  return new RegExp(`(?<!\\p{L})(?:${forms.join('|')})(?!\\p{L})`, 'giu');
}

/** The meaning with the word itself blanked out, so it cannot give the answer away. */
export function maskWord(text: string, lemma: string): string {
  if (!lemma) return text;
  return text.replace(formPattern(lemma), '…');
}

const VOWELS = /[aeiouy]+/g;

/**
 * The regular inflections of an English word, and nothing else: -s or -es (-ies after a consonant
 * and y), -ed or -d (-ied), and -ing (dropping a final e, ie to y). A final consonant is doubled
 * only before -ed and -ing, and only in a one-syllable word ending consonant, vowel, consonant
 * (rat: ratted, ratting). -er, -est and -ly are left out on purpose: they make other words
 * (leader, forest, early).
 */
export function regularForms(lemma: string): string[] {
  const slots = regularFormSlots(lemma);
  if (!slots) return [];
  const l = clean(lemma).toLowerCase();
  const out = new Set<string>([slots.s, slots.ed, slots.ing]);
  out.delete(l);
  return [...out];
}

/** The regular -s, -ed and -ing forms of an English word (`regularForms`), by ending; null when it has none. */
export function regularFormSlots(lemma: string): { s: string; ed: string; ing: string } | null {
  const l = clean(lemma).toLowerCase();
  if (!/^[a-z]{2,}$/.test(l)) return null;
  const consY = /[^aeiou]y$/.test(l);
  // Plural and third person.
  const s = consY ? `${l.slice(0, -1)}ies` : /(?:s|x|z|ch|sh|o)$/.test(l) ? `${l}es` : `${l}s`;
  // Past.
  const oneSyllable = (l.match(VOWELS) || []).length === 1;
  const doubles = oneSyllable && /[^aeiou][aeiou][bdgklmnprtvz]$/.test(l);
  const ed = /e$/.test(l) ? `${l}d` : consY ? `${l.slice(0, -1)}ied` : doubles ? `${l}${l.slice(-1)}ed` : `${l}ed`;
  // Present participle.
  const ing = /ie$/.test(l)
    ? `${l.slice(0, -2)}ying`
    : /[^e]e$/.test(l) && l.length > 2
      ? `${l.slice(0, -1)}ing`
      : doubles
        ? `${l}${l.slice(-1)}ing`
        : `${l}ing`;
  return { s, ed, ing };
}

/**
 * `other` in the form `form` takes of `lemma`, so every option of a gap question fits the gap's
 * grammar alike: with `lemma` "ignore" and `form` "ignored", "notice" becomes "noticed". The case
 * of the first letter follows `form` (a gap that starts the sentence). Null when `form` is a
 * regular form that `other` cannot take, so the option is left out rather than given away by its
 * ending.
 */
export function inflectLike(lemma: string, form: string, other: string): string | null {
  const l = clean(lemma).toLowerCase();
  const f = clean(form);
  const o = clean(other);
  if (!f || !o) return null;
  const cap = (w: string) => (/^\p{Lu}/u.test(f) && !/^\p{Lu}/u.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w);
  if (f.toLowerCase() === l) return cap(o);
  const mine = regularFormSlots(l);
  const theirs = regularFormSlots(o);
  if (!mine || !theirs) return null;
  const low = f.toLowerCase();
  const slot = (['s', 'ed', 'ing'] as const).find((k) => mine[k] === low);
  return slot ? cap(theirs[slot]) : null;
}

/** Whether `form` is `lemma` or one of its regular inflections (glean: gleaned; not rat: rate). */
export function isFormOf(form: string, lemma: string): boolean {
  const f = clean(form).toLowerCase();
  const l = clean(lemma).toLowerCase();
  if (!f || !l) return false;
  return f === l || regularForms(l).includes(f);
}

/** The words a surface form could be a regular inflection of, checked against `regularForms`. */
function regularBases(form: string): string[] {
  const f = clean(form).toLowerCase();
  if (!/^[a-z]{3,}$/.test(f)) return [];
  const cands = new Set<string>();
  if (f.endsWith('ies')) cands.add(`${f.slice(0, -3)}y`);
  if (f.endsWith('es')) cands.add(f.slice(0, -2));
  if (f.endsWith('s')) cands.add(f.slice(0, -1));
  if (f.endsWith('ied')) cands.add(`${f.slice(0, -3)}y`);
  if (f.endsWith('ed')) {
    cands.add(f.slice(0, -2));
    cands.add(f.slice(0, -1));
    cands.add(f.slice(0, -3));
  }
  if (f.endsWith('ying')) cands.add(`${f.slice(0, -4)}ie`);
  if (f.endsWith('ing')) {
    cands.add(f.slice(0, -3));
    cands.add(`${f.slice(0, -3)}e`);
    cands.add(f.slice(0, -4));
  }
  return [...cands].filter((b) => b.length >= 2 && regularForms(b).includes(f));
}

/**
 * British and American spellings folded together (colour, color; realise, realize; travelled,
 * traveled; centre, center). Nothing that turns one word into another (advice and advise stay
 * apart).
 */
function spellingKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/our$/, 'or')
    .replace(/([^aeiou])is(e|ed|es|ing|ation)$/, '$1iz$2')
    .replace(/([^aeiou])ys(e|ed|es|ing)$/, '$1yz$2')
    .replace(/([^aeiou])tre$/, '$1ter')
    // travelled, traveled; not filling, filing (one syllable before the ll).
    .replace(/^(.*[aeiou].*[^aeiou][aeiou])ll(ed|ing|er)$/, '$1l$2');
}

/** Keys under which two headwords that are one word meet: the spelling key of the word and of each regular base. */
export function lemmaKeys(word: string): string[] {
  const w = clean(word).toLowerCase();
  if (!w) return [];
  return [...new Set([w, spellingKey(w), ...regularBases(w).map(spellingKey)])];
}

/**
 * Two headwords that are one word for a quiz: the same word, a regular inflection of it
 * (vicissitude, vicissitudes) or its other national spelling. Only the spelling decides, so this
 * is for keeping wrong options apart, where treating two words as one costs nothing.
 */
export function sameLemma(a: string, b: string): boolean {
  const x = clean(a).toLowerCase();
  const y = clean(b).toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  if (!isLatin(x) || !isLatin(y)) return false;
  if (isFormOf(x, y) || isFormOf(y, x)) return true;
  return x.length >= 5 && spellingKey(x) === spellingKey(y);
}

function contentWords(text: string): Set<string> {
  return new Set(
    clean(text)
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length > 2),
  );
}

/**
 * Whether two saved entries are one word, so a session asks only one of them. The headwords must
 * be one word by spelling, and the entries must say so too: one is listed as a form of the other
 * ("simple past of glean"), or their saved meanings are mostly the same. Words of a word book are
 * never folded together; each book lists its own headwords.
 */
export function sameWordEntries(a: NotebookEntry, b: NotebookEntry): boolean {
  // The English and the Danish "give" are two words to learn.
  if (vocabHeadwordLang(langOf(a)) !== vocabHeadwordLang(langOf(b))) return false;
  const x = clean(a.lemma).toLowerCase();
  const y = clean(b.lemma).toLowerCase();
  if (x === y) return true;
  if (String(a.id).startsWith('wb:') || String(b.id).startsWith('wb:')) return false;
  if (!sameLemma(x, y)) return false;
  const da = clean(a.definition);
  const db = clean(b.definition);
  const names = (def: string, other: string) => new RegExp(`\\bof\\s+["“]?${escRe(other)}\\b`, 'i').test(def);
  if (names(da, y) || names(db, x)) return true;
  const wa = contentWords(da);
  const wb = contentWords(db);
  if (!wa.size || !wb.size) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / (wa.size + wb.size - shared) >= 0.5;
}
/** Citations and reference lines that sources sometimes return in place of a sense. */
const CITATION = /↑|\bISBN\b|\bOCLC\b|\bUnabridged\b|Dictionary\.com|Merriam-Webster|English Dictionary|Historical Principles|\beditors?\b|\b\d{4}\s*[–-]\s*present\b|^\s*\d{3,4}\s*[,:]|\bRetrieved\b|\bp\.\s*\d|https?:\/\/|mw-parser-output|\{[^}]*:[^}]*\}/i;
/** Senses a learner is unlikely to need first: dialect, obsolete, archaic and rare uses. */
const MARGINAL = /^\(([^)]*\b(?:obsolete|archaic|dialect(?:al)?|rare|nonstandard|regional|historical|dated|uncommon)\b[^)]*)\)/i;

/** A sense a question can be built on: a real gloss, not a citation, a "plural of" line or a fragment. */
export function usableSense(text: string, lemma = ''): boolean {
  const t = clean(text);
  if (t.length < 2 || t.length > 400) return false;
  if (CITATION.test(t) || isGrammaticalFormOfGloss(t)) return false;
  if (/^(?:alternative|obsolete|archaic|nonstandard|rare)\s+(?:form|spelling)\s+of\b|^misspelling of\b/i.test(t)) return false;
  const quotes = (t.match(/[“”"«»]/g) || []).length;
  if (quotes >= 8) return false;
  const rest = maskWord(t, lemma).replace(/\([^)]*\)/g, ' ').replace(/…/g, ' ');
  const letters = (rest.match(/\p{L}/gu) || []).length;
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(rest) ? letters >= 2 : letters >= 3;
}

/** A first sense longer than this gives way to a shorter one among the next two everyday senses. */
export const PROMPT_CHARS = 160;

/**
 * The sense a question shows: the first usable one, an everyday sense before a dialect or obsolete
 * one, and a shorter everyday sense when the first runs past PROMPT_CHARS. A sense is never cut:
 * when no shorter one exists the long one is shown whole.
 */
export function bestSense(e: NotebookEntry): string {
  const lemma = clean(e.lemma);
  // "Alternative form of mock-up. [A scale model …]": the bracketed gloss is the sense.
  const senses = vocabSenses(e.definition)
    // Wiktionary style rules that leaked into a gloss (".mw-parser-output .defdate{…}") go; the gloss stays.
    .map((s) => s.replace(/\s*\.?mw-parser-output[^{]*\{[^}]*\}/g, '').replace(/\s+\.\s*$/, '.').trim())
    .map((s) => s.replace(/^(?:(?:alternative|obsolete|archaic|dated)\s+(?:form|spelling)|misspelling)\s+of\s+[^.[]+\.?\s*\[(.+)\]\s*$/i, '$1'))
    .filter((s) => usableSense(s, lemma));
  const everyday = senses.filter((s) => !MARGINAL.test(s));
  const list = everyday.length ? everyday : senses;
  const first = list[0] || '';
  if (first.length <= PROMPT_CHARS) return first;
  return list.slice(1, 3).find((s) => s.length <= PROMPT_CHARS) || first;
}

const meaningCache = new Map<string, string>();

/** The best sense, whole, with the word blanked out; empty when none is usable. */
export function questionMeaning(e: NotebookEntry): string {
  const key = `${clean(e.lemma)}\u0000${clean(e.definition)}`;
  const hit = meaningCache.get(key);
  if (hit != null) return hit;
  const out = maskWord(bestSense(e), clean(e.lemma));
  if (meaningCache.size > 20000) meaningCache.clear();
  meaningCache.set(key, out);
  return out;
}

function normPos(pos: unknown): string {
  const p = clean(pos).toLowerCase().split(/[\s,;/]+/)[0] || '';
  const map: Record<string, string> = { n: 'noun', v: 'verb', vt: 'verb', vi: 'verb', adj: 'adjective', a: 'adjective', adv: 'adverb' };
  return map[p.replace(/\.$/, '')] || p;
}

/** A sentence that uses the word, with the word blanked out and the form it took there. */
export function clozeFromSentences(lemma: string, sentences: string[], pos?: unknown): { sentence: string; form: string } | null {
  if (!lemma) return null;
  for (const block of sentences) {
    for (const raw of clean(block).split(/(?<=[.!?。！？])\s*|\n+/)) {
      const sentence = raw.trim().replace(/^[“"‘']|[”"’']$/g, '');
      if (!sentence || sentence.length > 220) continue;
      const re = clozePattern(lemma, pos);
      const m = re.exec(sentence);
      if (!m) continue;
      const rest = sentence.replace(m[0], ' ').trim();
      const enough = isLatin(lemma) ? rest.split(/\s+/).filter(Boolean).length >= 3 : rest.length >= 4;
      if (!enough) continue;
      return { sentence: sentence.slice(0, m.index) + '_____' + sentence.slice(m.index + m[0].length), form: m[0] };
    }
  }
  return null;
}

/**
 * A sentence that uses the word, with its form there: from the note, then the sentence the word
 * was saved from, then the dictionary's example sentences.
 */
export function clozeFrom(e: NotebookEntry, examples: string[] = []): { sentence: string; form: string } | null {
  const lemma = clean(e.lemma);
  const own = [clean(e.note), clean(e.context?.sentence).replace(/^…|…$/g, '')].filter(Boolean);
  return clozeFromSentences(lemma, [...own, ...examples], e.partOfSpeech);
}

/* ----------------------------------------------------------- distractors */

/**
 * Plausible wrong options from other saved words: same language first, then the same part of
 * speech (Little et al. 2012: competitive lures make a choice question a real retrieval), with
 * similar-looking words preferred when the options are words. Never the word itself, another form
 * or spelling of it, two forms of one other word, or a duplicate meaning.
 */
export function pickDistractors(
  target: NotebookEntry,
  pool: NotebookEntry[],
  mode: 'meaning' | 'word',
  count: number,
  rand: () => number,
): NotebookEntry[] {
  const lemma = clean(target.lemma).toLowerCase();
  const pos = normPos(target.partOfSpeech);
  const lang = clean(target.sourceLang).toLowerCase();
  const meaning = questionMeaning(target).toLowerCase();
  const latin = isLatin(lemma);
  const seenText = new Set<string>([mode === 'meaning' ? meaning : lemma]);
  const scored: Array<{ e: NotebookEntry; score: number }> = [];
  for (const e of pool) {
    const l = clean(e.lemma).toLowerCase();
    if (!l || l === lemma || e.id === target.id) continue;
    if (isLatin(l) !== latin) continue;
    if (sameLemma(l, lemma)) continue;
    let score = rand() * 1.5;
    const elang = clean(e.sourceLang).toLowerCase();
    if (lang && elang && elang !== lang) score -= 6;
    if (pos && normPos(e.partOfSpeech) === pos) score += 3;
    if (mode === 'meaning') {
      const m = questionMeaning(e);
      if (!m || m === '…') continue;
      if (formPattern(lemma).test(m)) continue;
    } else {
      if (Math.abs(l.length - lemma.length) <= 2) score += 1;
      if (l[0] === lemma[0]) score += 1;
    }
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: NotebookEntry[] = [];
  const near = (x: string, y: string) => x.length >= 24 && y.length >= 24 && x.slice(0, 40) === y.slice(0, 40);
  for (const { e } of scored) {
    const text = mode === 'meaning' ? questionMeaning(e).toLowerCase() : clean(e.lemma).toLowerCase();
    if (seenText.has(text)) continue;
    if (mode === 'meaning' && [...seenText].some((t) => near(t, text))) continue;
    if (out.some((o) => sameLemma(clean(o.lemma), clean(e.lemma)))) continue;
    seenText.add(text);
    out.push(e);
    if (out.length >= count) break;
  }
  return out;
}

/* ------------------------------------------------------------- questions */

/**
 * The kinds each stage may ask (docs/REVIEW.md), most fitting first. A new word is recognised; a
 * learning word is recognised, picked for a sentence's gap, heard among four, built from its
 * letters or typed; a young word is typed, built from its letters, filled into a sentence or
 * written from dictation; a mature word is mostly produced. Listening by choice belongs to the
 * early stages and dictation to the later ones. Within a stage the kind is chosen by how likely
 * the learner is to get it right (`chooseKind`).
 */
export const STAGE_KINDS: Record<number, QuestionKind[]> = {
  0: ['meaning-choice', 'word-choice', 'flash'],
  1: ['word-choice', 'cloze-choice', 'meaning-choice', 'listen-choice', 'spell-tiles', 'synonym-choice', 'recall', 'cloze', 'flash'],
  2: ['recall', 'cloze-choice', 'synonym-choice', 'antonym-choice', 'word-choice', 'cloze', 'word-form', 'spell-tiles', 'listen-type', 'listen-choice', 'meaning-choice', 'flash'],
  3: ['cloze', 'word-form', 'recall', 'synonym-choice', 'antonym-choice', 'listen-type', 'cloze-choice', 'word-choice', 'meaning-choice', 'flash'],
};

export type QuizSkill = 'meaning' | 'spelling' | 'listening';

const KIND_SKILL: Record<QuestionKind, QuizSkill> = {
  'meaning-choice': 'meaning',
  'word-choice': 'meaning',
  'cloze-choice': 'meaning',
  'synonym-choice': 'meaning',
  'antonym-choice': 'meaning',
  flash: 'meaning',
  'spell-tiles': 'spelling',
  recall: 'spelling',
  cloze: 'spelling',
  'word-form': 'spelling',
  'listen-choice': 'listening',
  'listen-type': 'listening',
};

/** Kinds answered by typing the word. */
export const TYPED_KINDS: QuestionKind[] = ['recall', 'cloze', 'listen-type', 'word-form'];

/**
 * Shares of a session each skill aims at; listening also has a hard cap (LISTEN_CAP). Producing
 * the word (spelling) gets nearly as much as recognising it: typed recall teaches more per
 * question than picking from four (Nakata 2011; Karpicke and Roediger 2008), and four-option
 * questions overrate what a learner knows by about a fifth against gap-fills (Sevigny et al.
 * 2024).
 */
export const SKILL_TARGET: Record<QuizSkill, number> = { meaning: 0.45, spelling: 0.4, listening: 0.15 };

/**
 * The share of right answers the choice of kind aims at. Wilson et al. (2019) derive about 85%
 * as the best training accuracy, and Duolingo's Birdbrain picks exercises the learner should find
 * just hard enough; the FSRS schedule itself aims at 90% recall when a word falls due.
 */
export const TARGET_SUCCESS = 0.85;

/**
 * Typed questions aim lower: a recall that takes effort and still succeeds is what strengthens
 * memory (Bjork's desirable difficulties), so a word a learner would type right about four times in
 * four is asked typed rather than as an easy choice, while one that has faded below that is still
 * recognised first, since a miss sends it back to relearning. The aim moves back towards TARGET_SUCCESS for
 * a learner whose typed answers go wrong more often than predicted, so typing never becomes a run
 * of misses, and a little lower for one who types well.
 */
export const TYPED_SUCCESS = 0.78;

/** The share of right answers a kind aims at for this learner (`TARGET_SUCCESS`, `TYPED_SUCCESS`). */
export function successAim(kind: QuestionKind, learner?: LearnerModel | null): number {
  if (!TYPED_KINDS.includes(kind)) return TARGET_SUCCESS;
  const typed = typedOffset(learner);
  return Math.min(TARGET_SUCCESS, Math.max(0.72, TYPED_SUCCESS - 0.05 * typed));
}

/** How much better (+) or worse (-) than predicted a learner types, averaged over the typed kinds they have answered. */
function typedOffset(learner?: LearnerModel | null): number {
  if (!learner) return 0;
  const seen = TYPED_KINDS.filter((k) => k !== 'listen-type' && learner.offset[k] != null);
  return seen.length ? seen.reduce((n, k) => n + (learner.offset[k] || 0), 0) / seen.length : 0;
}

/**
 * How much easier (+) or harder (-) each kind is than typing the word from its meaning with its
 * first letter, in log-odds. The order is Laufer and Goldstein's (2004): recognising a meaning is
 * easiest, then recognising the word, then recalling it; dictation adds hearing to spelling.
 * Picking the word for a sentence's gap is recognition with the sentence as a cue, about as easy
 * as picking it from its meaning; building it from its own letters sits between recognising and
 * typing it. Picking a synonym asks the learner to know two words, so it is harder than either
 * choice from a meaning, and an antonym a little harder again, with a synonym among the wrong
 * options. Forming the word from a relative in capitals gives most of its letters but none of its
 * ending, about as hard as typing it into a gap. The learner model corrects each value for each
 * learner.
 */
export const KIND_EASE: Record<QuestionKind, number> = {
  'meaning-choice': 1.8,
  'word-choice': 1.4,
  'cloze-choice': 1.3,
  'listen-choice': 1.1,
  flash: 1.0,
  'spell-tiles': 0.8,
  'synonym-choice': 0.7,
  'antonym-choice': 0.6,
  cloze: 0.1,
  'word-form': 0.1,
  recall: 0,
  'listen-type': -0.5,
};

/** Each letter shown beyond the usual cue makes a typed answer this much easier, in log-odds. */
export const LETTER_EASE = 0.45;

/**
 * Harder kinds open for a learner once they have answered easier ones right this many times,
 * counting every word: typing after recognising words, a sentence gap after typing, dictation
 * after picking words they heard or typing words right. Typed answers count for dictation because
 * picking the word heard is asked only of words not yet mature, so a learner whose words are all
 * mature would otherwise never reach it. Without a learner model every kind is open.
 */
export const KIND_UNLOCK: Partial<Record<QuestionKind, { after: QuestionKind[]; right: number }>> = {
  'spell-tiles': { after: ['word-choice', 'meaning-choice', 'cloze-choice'], right: 3 },
  'synonym-choice': { after: ['meaning-choice', 'word-choice', 'cloze-choice'], right: 5 },
  'antonym-choice': { after: ['meaning-choice', 'word-choice', 'cloze-choice', 'synonym-choice'], right: 8 },
  recall: { after: ['word-choice', 'meaning-choice'], right: 5 },
  cloze: { after: ['recall'], right: 3 },
  'word-form': { after: ['cloze', 'recall'], right: 5 },
  'listen-type': { after: ['listen-choice', 'recall', 'cloze'], right: 3 },
};

export function kindSkill(kind: QuestionKind): QuizSkill {
  return KIND_SKILL[kind] || 'meaning';
}

/** Whether a learner has unlocked a kind (`KIND_UNLOCK`). */
export function kindUnlocked(kind: QuestionKind, learner?: LearnerModel | null): boolean {
  const rule = KIND_UNLOCK[kind];
  if (!rule || !learner) return true;
  return rule.after.reduce((n, k) => n + (learner.right[k] || 0), 0) >= rule.right;
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * How firmly the word is held now, in log-odds: FSRS's predicted recall, an even chance for a word
 * never answered, and a guess from the stage for rows without a memory state.
 */
export function wordStrength(e: NotebookEntry, now = Date.now()): number {
  if (isNew(e)) return 0;
  return wordStrengthFrom(predictedRecall(e, now) ?? [0.5, 0.85, 0.9, 0.93][memoryLevel(e)]);
}

/** A recall probability in log-odds, kept off 0 and 1; null (never answered) is an even chance. */
export function wordStrengthFrom(recall: number | null): number {
  if (recall == null) return 0;
  return logit(Math.min(0.995, Math.max(0.03, recall)));
}

/** Learner offsets stay within this many log-odds. */
const MAX_OFFSET = 2;

/**
 * One Elo-style update of a learner offset: it moves by the surprise (the outcome less the
 * predicted chance), by a step that starts at 0.4 and shrinks as answers of the kind accumulate,
 * never below 0.05, so recent answers keep counting.
 */
export function eloStep(offset: number, outcome: number, predicted: number, answers: number): number {
  const k = Math.max(0.05, 0.4 / (1 + answers / 20));
  return Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offset + k * (outcome - predicted)));
}

/** Letters a typed kind usually shows: the first letter, none for dictation. */
function baseLetters(kind: QuestionKind): number {
  // Word formation's cue is the word in capitals, which already shows most of the letters.
  return kind === 'listen-type' || kind === 'word-form' ? 0 : 1;
}

/** Predicted chance of a right answer to `kind` for a word of `strength`, with `letters` shown. */
export function successChance(kind: QuestionKind, strength: number, learner?: LearnerModel | null, letters = baseLetters(kind)): number {
  const extra = TYPED_KINDS.includes(kind) ? Math.max(0, letters - baseLetters(kind)) * LETTER_EASE : 0;
  return sigmoid(strength + KIND_EASE[kind] + (learner?.offset[kind] || 0) + extra);
}

/**
 * Letters shown before a typed answer: the first letter, none for dictation, whatever the word's
 * strength. More help comes only from Hint, one letter a press, and each press lowers the
 * answer's credit (`autoGrade`). A weak word gets an easier kind of question instead of a longer
 * cue (`chooseKind`), so a typed answer is always mostly the learner's own.
 */
export function cueLetters(kind: QuestionKind, answer: string, _strength?: number, _learner?: LearnerModel | null): number {
  return Math.min(baseLetters(kind), Math.max(0, [...answer].length - 1));
}

/**
 * Skill aims for a session. Spelling is the hardest kind of knowing a word, so its share shrinks
 * for a learner whose typed answers go wrong more often than expected and grows a little for one
 * who spells well; meaning takes the rest.
 */
export function skillTargets(learner?: LearnerModel | null): Record<QuizSkill, number> {
  if (!learner) return SKILL_TARGET;
  const spelling = Math.min(0.5, Math.max(0.15, SKILL_TARGET.spelling + 0.2 * typedOffset(learner)));
  return { meaning: 1 - spelling - SKILL_TARGET.listening, spelling, listening: SKILL_TARGET.listening };
}

/** Whether one more listening question keeps listening within LISTEN_CAP of the session. */
export function listeningAllowed(asked: QuestionKind[]): boolean {
  const listened = asked.filter((k) => KIND_SKILL[k] === 'listening').length;
  return listened + 1 <= LISTEN_CAP * (asked.length + 1) + 1e-9;
}

const STAGE_OF: Record<Maturity, number> = { new: 0, learning: 1, relearning: 1, young: 2, mature: 3 };

/**
 * The stage a word is asked at, by the stage its tag shows (`wordMaturity`): 0 new, 1 learning or
 * relearning, 2 young, 3 mature. A new word coming back in the same session moves to the learning
 * stage; a leech stays at the learning stage. Within a stage the predicted chance of a right
 * answer picks the kind, so a young word held only a few days still gets the easier ones.
 */
export function questionStage(e: NotebookEntry, repeat = 0): number {
  const m = wordMaturity(e);
  const stage = m === 'new' ? Math.min(repeat, 1) : STAGE_OF[m];
  return isLeech(e) ? Math.min(stage, 1) : stage;
}

export interface KindChoice {
  /** Predicted chance of a right answer for each kind. */
  predict?: (kind: QuestionKind) => number;
  /** Skill aims (`skillTargets`). */
  targets?: Record<QuizSkill, number>;
  /** The share of right answers each kind aims at (`successAim`); TARGET_SUCCESS for every kind without it. */
  aim?: (kind: QuestionKind) => number;
}

/**
 * Picks the kind for a word among those its stage allows: the one whose predicted chance of a
 * right answer is nearest its aim (`successAim`; a shortfall counting double), with a kind whose skill the session already leans on
 * costing more, the previous kind costing a little, and listening only within its cap. Listening
 * passes the cap only when nothing else can be asked.
 */
export function chooseKind(stage: number, can: Record<QuestionKind, boolean>, asked: QuestionKind[] = [], rand: () => number = Math.random, choice: KindChoice = {}): QuestionKind {
  const order = STAGE_KINDS[stage] || STAGE_KINDS[0];
  const targets = choice.targets || SKILL_TARGET;
  const total = asked.length;
  const share = (skill: QuizSkill) => (total ? asked.filter((k) => KIND_SKILL[k] === skill).length / total : 0);
  const listenOk = listeningAllowed(asked);
  const last = asked[asked.length - 1];
  let best: QuestionKind | null = null;
  let bestCost = Infinity;
  // A kind's place counts among the kinds this word can be asked, so a kind it lacks the data for
  // (no antonym, no family word) does not push the others down.
  order.filter((k) => can[k]).forEach((k, i) => {
    const skill = KIND_SKILL[k];
    if (skill === 'listening' && !listenOk) return;
    // Falling short of the aim costs twice as much as passing it: a miss sends the word back to
    // relearning, while an easy question still makes the learner retrieve the word.
    const p = choice.predict ? choice.predict(k) : 0;
    // A typed kind's lower aim opens a band up to TARGET_SUCCESS in which it costs nothing; past
    // that it is too easy, as a choice is.
    const aim = choice.aim ? choice.aim(k) : TARGET_SUCCESS;
    const fit = choice.predict ? (p < aim ? 2 * (aim - p) : Math.max(0, p - Math.max(aim, TARGET_SUCCESS))) * 4 : i * 0.5;
    // The plain card is the last resort, whatever the balance says.
    const cost = k === 'flash' ? 99 : fit + i * 0.1 + Math.max(0, share(skill) - targets[skill]) * 4 + (k === last ? 0.5 : 0) + rand() * 0.15;
    if (cost < bestCost) {
      bestCost = cost;
      best = k;
    }
  });
  if (best) return best;
  // Nothing in the stage's order can be asked (no usable meaning): a sentence, then the word
  // heard if the listening cap allows, then the plain card. Never listening past the cap.
  if (can['cloze-choice']) return 'cloze-choice';
  if (can.cloze) return 'cloze';
  if (listenOk && can['listen-choice']) return 'listen-choice';
  if (listenOk && can['listen-type']) return 'listen-type';
  return 'flash';
}

/**
 * Whether the word can be asked at all. A word whose saved senses are all unusable (citations,
 * "plural of" lines) is skipped unless it can be filled into a sentence; it is never pushed into
 * listening for want of anything else. A word with no senses at all (a book word whose lookup
 * failed) gets the plain card: the word, then its pronunciation and picture.
 */
export function canAsk(entry: NotebookEntry, opts: QuestionOptions = {}): boolean {
  if (!clean(entry.definition)) return true;
  if (questionMeaning(entry)) return true;
  return !!clozeFrom(entry, opts.examples?.(clean(entry.lemma)) || []);
}

/** Whether `text` uses `word` or one of its forms (`formPattern`). */
function mentions(text: string, word: string): boolean {
  const t = clean(text);
  return !!t && !!word && formPattern(word).test(t);
}

/**
 * Wrong options for a sentence's gap: other saved words (`pickDistractors`), each put in the form
 * the gap takes, so no option stands out by its ending. Only words of the answer's part of speech
 * are offered when both are known, and an inflected gap takes only words whose part of speech is
 * known (a verb for -ed and -ing), so no option is a made-up form such as "appling". A word that
 * either definition names (a synonym that could fill the gap too), one that cannot take the form,
 * or one whose form is the answer's, is left out.
 */
function gapOptions(target: NotebookEntry, form: string, lures: NotebookEntry[]): Array<{ word: string; lemma: string }> {
  const lemma = clean(target.lemma);
  const pos = normPos(target.partOfSpeech);
  const inflected = clean(form).toLowerCase() !== lemma.toLowerCase();
  const slots = inflected ? regularFormSlots(lemma) : null;
  const verbOnly = !!slots && (slots.ed === clean(form).toLowerCase() || slots.ing === clean(form).toLowerCase());
  const out: Array<{ word: string; lemma: string }> = [];
  const seen = new Set([form.toLowerCase()]);
  for (const e of lures) {
    const other = clean(e.lemma);
    const epos = normPos(e.partOfSpeech);
    if (pos && epos && epos !== pos) continue;
    if (inflected && (!epos || (verbOnly && epos !== 'verb'))) continue;
    if (mentions(target.definition || '', other) || mentions(e.definition || '', lemma)) continue;
    const word = inflectLike(lemma, form, other);
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push({ word, lemma: other });
  }
  return out;
}

/**
 * The synonym a "closest in meaning" question asks for: the first single word (a hyphen allowed)
 * that is not a form of the word itself, so "run" never offers "running".
 */
export function pickSynonym(lemma: string, synonyms: string[]): string {
  const own = new Set(lemmaKeys(clean(lemma).toLowerCase()));
  for (const raw of synonyms) {
    const w = clean(raw);
    if (!/^\p{L}[\p{L}'’-]*$/u.test(w)) continue;
    if (lemmaKeys(w.toLowerCase()).some((k) => own.has(k))) continue;
    return w;
  }
  return '';
}

/** Wrong options for a synonym question: other notebook words, none of them a synonym too or the synonym's own form. */
function synonymLuresFor(lemma: string, synonym: string, synonyms: string[], lures: Array<{ lemma: string } | NotebookEntry>): Array<{ word: string; lemma: string }> {
  const near = new Set([lemma, synonym, ...synonyms].flatMap((w) => lemmaKeys(clean(w).toLowerCase())));
  const out: Array<{ word: string; lemma: string }> = [];
  for (const l of lures) {
    const w = clean(l.lemma);
    if (!w || /\s/.test(w) || lemmaKeys(w.toLowerCase()).some((k) => near.has(k))) continue;
    out.push({ word: w, lemma: w });
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * The antonym an "opposite in meaning" question asks for, chosen as `pickSynonym` chooses; one
 * that is the word with a prefix ("unhappy" for "happy") is passed over, since its letters would
 * give it away.
 */
export function pickAntonym(lemma: string, antonyms: string[]): string {
  const w = clean(lemma).toLowerCase();
  return pickSynonym(lemma, antonyms.filter((a) => !clean(a).toLowerCase().includes(w)));
}

/**
 * Wrong options for an antonym question: notebook words that look like the antonym, and in the
 * last place a synonym of the word when its entry lists one, the option a learner who knows the
 * word's field but not its direction picks.
 */
function antonymLuresFor(lemma: string, antonym: string, antonyms: string[], synonyms: string[], lures: Array<{ lemma: string } | NotebookEntry>): Array<{ word: string; lemma: string }> {
  const out = synonymLuresFor(lemma, antonym, [...antonyms, ...synonyms], lures);
  const trap = pickSynonym(lemma, synonyms.filter((s) => !antonyms.some((a) => clean(a).toLowerCase() === clean(s).toLowerCase())));
  if (trap && out.length >= 2) out.splice(Math.min(out.length, 2), 1, { word: trap, lemma: trap });
  return out;
}

/**
 * The word in capitals for a word-formation question, as Cambridge prints the stem after the
 * line: another word of the family that starts with the same four letters, so it reads as the
 * word changed, and is not one of its inflections or the form the gap takes; the shortest, which
 * is usually the base.
 */
export function familyCue(lemma: string, family: string[], form = lemma): string {
  const w = clean(lemma).toLowerCase();
  if ([...w].length < 4) return '';
  const own = new Set(lemmaKeys(w));
  const stem = w.slice(0, 4);
  const picks = family
    .map(clean)
    .filter((f) => /^\p{L}+$/u.test(f))
    .filter((f) => {
      const l = f.toLowerCase();
      return l !== w && l !== clean(form).toLowerCase() && l.startsWith(stem) && !lemmaKeys(l).some((k) => own.has(k));
    })
    .sort((a, b) => a.length - b.length);
  return picks[0] || '';
}

/** Longest word offered as letter tiles; a longer one is typed instead. */
export const MAX_TILES = 14;

/** A word that can be built from letter tiles: one word of letters (an apostrophe or hyphen allowed), 3 to MAX_TILES long. */
export function tileable(lemma: string): boolean {
  const w = clean(lemma);
  const n = [...w].length;
  return n >= 3 && n <= MAX_TILES && /^\p{L}[\p{L}'’-]*\p{L}$/u.test(w);
}

/** The word's letters in a shuffled row that does not spell the word already, when its letters allow that. */
function tileRow(lemma: string, rand: () => number): string[] {
  const letters = [...clean(lemma)];
  let row = shuffle(letters, rand);
  for (let i = 0; i < 6 && row.join('') === letters.join(''); i++) row = shuffle(letters, rand);
  return row;
}

/**
 * Builds the question for one word. `pool` is the whole notebook, for wrong options. Typed kinds
 * wait until the learner has unlocked them, never come up for a leech, and never come up for a
 * learning word asked again in the same session, so spelling waits for a later day.
 */
export function buildQuestion(entry: NotebookEntry, pool: NotebookEntry[], opts: QuestionOptions = {}, rand: () => number = Math.random): ReviewQuestion {
  const now = opts.now ?? Date.now();
  // Always the word that was asked: answers are recorded under it.
  const lemma = clean(entry.lemma);
  const level = memoryLevel(entry);
  const repeat = opts.repeat ?? 0;
  const stage = questionStage(entry, repeat);
  const learner = opts.learner || null;
  const meaning = questionMeaning(entry);
  const hasMeaning = !!meaning && meaning !== '…';
  const cloze = clozeFrom(entry, opts.examples?.(clean(entry.lemma)) || []);
  const meaningLures = hasMeaning ? pickDistractors(entry, pool, 'meaning', 3, rand) : [];
  // The gap question looks further down the same ranking, since its grammar rules many words out.
  const wideLures = pickDistractors(entry, pool, 'word', 12, rand);
  const wordLures = wideLures.slice(0, 3);
  const typedOk = !isLeech(entry) && !(repeat > 0 && stage <= 1);
  const open = (k: QuestionKind) => kindUnlocked(k, learner) && (!TYPED_KINDS.includes(k) || typedOk);
  // The gap's options, each in the form the gap takes (`inflectLike`).
  const gapLures = cloze ? gapOptions(entry, cloze.form, wideLures) : [];
  const synonym = pickSynonym(lemma, opts.synonyms?.(lemma) || []);
  // Wrong options look like the synonym, not like the word asked, or the one option unlike the
  // others ("impulse" among "vinyl", "vitrine", "vintage" for "vagary") would give the answer away.
  const synonymLures = synonym
    ? synonymLuresFor(lemma, synonym, opts.synonyms?.(lemma) || [], pickDistractors({ ...entry, lemma: synonym }, pool.filter((e) => e !== entry), 'word', 12, rand))
    : [];
  const antonymList = opts.antonyms?.(lemma) || [];
  const antonym = pickAntonym(lemma, antonymList);
  const antonymLures = antonym
    ? antonymLuresFor(lemma, antonym, antonymList, opts.synonyms?.(lemma) || [], pickDistractors({ ...entry, lemma: antonym }, pool.filter((e) => e !== entry), 'word', 12, rand))
    : [];
  const cue = cloze ? familyCue(lemma, opts.family?.(lemma) || [], cloze.form) : '';
  const can: Record<QuestionKind, boolean> = {
    'meaning-choice': hasMeaning && meaningLures.length >= 2,
    'word-choice': hasMeaning && wordLures.length >= 2,
    'listen-choice': !!opts.audio && wordLures.length >= 2,
    'cloze-choice': !!cloze && gapLures.length >= 2,
    // Building the word from its letters is spelling too, so a learning word asked again the same
    // day waits for another day, as typing does; a leech may get it, as an easier way in.
    'spell-tiles': hasMeaning && tileable(lemma) && kindUnlocked('spell-tiles', learner) && !(repeat > 0 && stage <= 1),
    'synonym-choice': !!synonym && synonymLures.length >= 3 && kindUnlocked('synonym-choice', learner),
    'antonym-choice': !!antonym && antonymLures.length >= 3 && kindUnlocked('antonym-choice', learner),
    recall: hasMeaning && open('recall'),
    'listen-type': !!opts.audio && open('listen-type'),
    cloze: !!cloze && open('cloze'),
    'word-form': !!cloze && !!cue && open('word-form'),
    flash: hasMeaning || !clean(entry.definition),
  };
  // Synonym and antonym questions ask the same thing, how the word sits among words of like
  // meaning; a word that has both gets one of them, either one, so the slightly easier synonym
  // does not always win.
  if (can['synonym-choice'] && can['antonym-choice']) can[rand() < 0.5 ? 'synonym-choice' : 'antonym-choice'] = false;
  // Likewise typing the word into the sentence's gap, and forming it there from a relative.
  if (can.cloze && can['word-form']) can[rand() < 0.5 ? 'cloze' : 'word-form'] = false;
  const strength = wordStrength(entry, now);
  const answerOf = (k: QuestionKind) => ((k === 'cloze' || k === 'word-form') && cloze ? cloze.form : lemma);
  const lettersFor = (k: QuestionKind) => (TYPED_KINDS.includes(k) ? cueLetters(k, answerOf(k), strength, learner) : 0);
  const predict = (k: QuestionKind) => successChance(k, strength, learner, lettersFor(k));
  const aim = (k: QuestionKind) => successAim(k, learner);
  const kind = chooseKind(stage, can, opts.asked || [], rand, { predict, targets: skillTargets(learner), aim });

  const answers = [lemma];
  const base: ReviewQuestion = {
    id: entry.id,
    kind,
    lemma,
    level,
    prompt: '',
    options: [],
    optionWords: [],
    correct: -1,
    answers,
    hint: '',
    reveal: 0,
    hinted: 0,
    shownAt: now,
    leech: isLeech(entry),
    maturity: wordMaturity(entry),
    predicted: Math.round(predict(kind) * 1000) / 1000,
  };
  if (kind === 'meaning-choice' || kind === 'word-choice' || kind === 'listen-choice') {
    const lures = kind === 'meaning-choice' ? meaningLures : wordLures;
    const all = shuffle([entry, ...lures], rand);
    base.options = all.map((e) => {
      if (kind === 'meaning-choice') return e === entry ? meaning : questionMeaning(e);
      return e === entry ? lemma : clean(e.lemma);
    });
    base.optionWords = all.map((e) => (e === entry ? lemma : clean(e.lemma)));
    base.correct = all.indexOf(entry);
    if (kind === 'word-choice') base.prompt = meaning;
  } else if (kind === 'cloze-choice' && cloze) {
    const all = shuffle([{ word: cloze.form, lemma }, ...gapLures.slice(0, 3)], rand);
    base.prompt = cloze.sentence;
    base.options = all.map((o) => o.word);
    base.optionWords = all.map((o) => o.lemma);
    base.correct = all.findIndex((o) => o.lemma === lemma);
    base.answers = [cloze.form];
  } else if (kind === 'synonym-choice' && synonym) {
    const all = shuffle([{ word: synonym, lemma }, ...synonymLures.slice(0, 3)], rand);
    base.options = all.map((o) => o.word);
    base.optionWords = all.map((o) => o.lemma);
    base.correct = all.findIndex((o) => o.word === synonym);
  } else if (kind === 'antonym-choice' && antonym) {
    const all = shuffle([{ word: antonym, lemma }, ...antonymLures.slice(0, 3)], rand);
    base.options = all.map((o) => o.word);
    base.optionWords = all.map((o) => o.lemma);
    base.correct = all.findIndex((o) => o.word === antonym);
  } else if (kind === 'word-form' && cloze && cue) {
    base.prompt = cloze.sentence;
    base.cue = cue.toUpperCase();
    base.answers = [...new Set([cloze.form, ...answers])];
    base.reveal = 0;
    base.shown = 0;
  } else if (kind === 'spell-tiles') {
    base.prompt = meaning;
    base.tiles = tileRow(lemma, rand);
    base.placed = [];
  } else if (kind === 'recall' || kind === 'listen-type') {
    if (kind === 'recall') base.prompt = meaning;
    base.reveal = lettersFor(kind);
    base.shown = base.reveal;
    base.hint = [...lemma].slice(0, base.reveal).join('');
  } else if (kind === 'cloze' && cloze) {
    base.prompt = cloze.sentence;
    base.answers = [...new Set([cloze.form, ...answers])];
    base.reveal = lettersFor(kind);
    base.shown = base.reveal;
    base.hint = [...cloze.form].slice(0, base.reveal).join('');
  } else if (kind === 'flash') {
    base.prompt = meaning;
  }
  return base;
}

/** Leading letters of the answer shown so far, by the question and by Hint. */
export function shownLetters(q: ReviewQuestion): number {
  return q.shown ?? (q.reveal || 0) + (q.hinted || 0);
}

/** Letters still hidden that Hint may reveal: all but the last one. */
export function hintsLeft(q: ReviewQuestion): number {
  if (!TYPED_KINDS.includes(q.kind)) return 0;
  const len = [...(q.answers[0] || '')].length;
  return Math.max(0, len - 1 - shownLetters(q));
}

/**
 * The share of the letters the learner had to supply that Hint gave instead. Each press gives
 * one letter, so three presses on a word with twelve hidden letters give a quarter of it.
 */
export function hintShare(q: ReviewQuestion): number {
  if (!q.hinted) return 0;
  const hidden = Math.max(1, [...(q.answers[0] || '')].length - (q.reveal || 0));
  return Math.min(1, q.hinted / hidden);
}

/**
 * Hint gives one more letter: the one after the letters the learner already has right, or after
 * the letters shown so far, whichever reaches further. `typed` is the answer box as it stands
 * (by default the kept draft). The box is never cleared. When it holds the start of the answer,
 * letter case aside, the new letter is added after it; when it holds anything else it stays as
 * typed, and the letters shown appear under it. The last letter is never given. Each press lowers
 * the answer's credit (`hintShare`, `autoGrade`).
 */
export function hintReview(state: ReviewState, typed?: string): boolean {
  const q = state.question;
  if (!q || state.answer || !TYPED_KINDS.includes(q.kind)) return false;
  const box = typed ?? q.draft ?? '';
  const answer = [...(q.answers[0] || '')];
  const mine = [...box];
  let right = 0;
  while (right < mine.length && right < answer.length && mine[right].toLowerCase() === answer[right].toLowerCase()) right += 1;
  const known = Math.max(right, shownLetters(q));
  if (known + 1 > answer.length - 1) return false;
  q.shown = known + 1;
  q.hinted = (q.hinted || 0) + 1;
  q.draft = right === mine.length ? box + answer.slice(right, q.shown).join('') : box;
  return true;
}

/**
 * Letter tiles: places tile `index` after the letters placed so far. Placing the last tile
 * answers the question with the word built. True when something changed, so the shell repaints.
 */
export function placeTile(state: ReviewState, index: number, now = Date.now()): boolean {
  const q = state.question;
  if (!q || state.answer || q.kind !== 'spell-tiles' || !q.tiles) return false;
  const placed = (q.placed ||= []);
  if (!Number.isInteger(index) || index < 0 || index >= q.tiles.length || placed.includes(index)) return false;
  placed.push(index);
  if (placed.length === q.tiles.length) answerReview(state, { typed: placed.map((i) => q.tiles![i]).join('') }, now);
  return true;
}

/** Letter tiles: takes back the letter at `pos` in the word built (the last one by default). */
export function returnTile(state: ReviewState, pos?: number): boolean {
  const q = state.question;
  if (!q || state.answer || q.kind !== 'spell-tiles' || !q.placed?.length) return false;
  const at = pos == null ? q.placed.length - 1 : pos;
  if (!Number.isInteger(at) || at < 0 || at >= q.placed.length) return false;
  q.placed.splice(at, 1);
  return true;
}

/** Letter tiles from the keyboard: a letter places the first unused tile with it, Backspace takes the last one back. */
export function tileKey(state: ReviewState, key: string, now = Date.now()): boolean {
  const q = state.question;
  if (!q || state.answer || q.kind !== 'spell-tiles' || !q.tiles) return false;
  if (key === 'Backspace') return returnTile(state);
  if ([...key].length !== 1) return false;
  const k = key.toLowerCase();
  const placed = q.placed || [];
  const i = q.tiles.findIndex((t, n) => t.toLowerCase() === k && !placed.includes(n));
  return i >= 0 && placeTile(state, i, now);
}

/** Keeps what the answer box holds on each keystroke, so a repaint puts it back. */
export function keepDraft(state: ReviewState | null | undefined, typed: string): void {
  const q = state?.question;
  if (!q || state.answer) return;
  q.draft = typed;
}

/* --------------------------------------------------------------- answers */

export function normalizeAnswer(s: string): string {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^to /, '');
}

/** Edit distance with adjacent swaps (Damerau–Levenshtein, optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Words the app knows (word books and the learner's own words), so a slip that spells one of them is not a typo. */
const listedWords = new Set<string>();
const listedFrom = new WeakSet<object>();

/** Adds words to the set `checkTyped` treats as real words: the word books and the learner's own words. */
export function registerListedWords(words: Iterable<string>): void {
  for (const w of words) {
    const n = normalizeAnswer(w);
    if (n) listedWords.add(n);
  }
}

let listsLoading: Promise<void> | null = null;

/**
 * Loads every shipped word book into the real-word set, once, so a slip that spells a common word
 * ("cat" for "cot") is not taken for a typo. Each book is its own chunk; a failed one is skipped.
 */
export function loadListedWords(): Promise<void> {
  if (listsLoading) return listsLoading;
  const books: Array<() => Promise<unknown>> = [
    () => import('../wordbooks/starter.json'),
    () => import('../wordbooks/zhongkao.json'),
    () => import('../wordbooks/gaokao.json'),
    () => import('../wordbooks/cet4.json'),
    () => import('../wordbooks/cet6.json'),
    () => import('../wordbooks/kaoyan.json'),
    () => import('../wordbooks/ngsl.json'),
    () => import('../wordbooks/nawl.json'),
    () => import('../wordbooks/tsl.json'),
    () => import('../wordbooks/bsl.json'),
  ];
  const one = async (load: () => Promise<unknown>): Promise<void> => {
    try {
      const mod = await load();
      const file = ((mod as { default?: { words?: string[] } }).default || mod) as { words?: string[] };
      registerListedWords(file.words || []);
    } catch {
      // A book that fails to load only leaves its words out of the check.
    }
  };
  listsLoading = Promise.all(books.map(one)).then((): void => undefined);
  return listsLoading;
}

function registerEntryWords(entries: NotebookEntry[]): void {
  if (listedFrom.has(entries)) return;
  listedFrom.add(entries);
  registerListedWords(entries.map((e) => e.lemma));
  void loadListedWords();
}

/** A real word the app knows, or the answer with an ending added (start, starts; use, used, user). */
function isOtherWord(typed: string, answer: string): boolean {
  if (listedWords.has(typed)) return true;
  if (typed === `${answer}s`) return true;
  return /e$/.test(answer) && (typed === `${answer}d` || typed === `${answer}r`);
}

/**
 * The word's other national spelling (colour for color, centre for center, realise for realize),
 * when the app lists it as a word. It is the same word, so it counts as right.
 */
function isOtherSpelling(typed: string, answer: string): boolean {
  return [...answer].length >= 5 && listedWords.has(typed) && spellingKey(typed) === spellingKey(answer);
}

/**
 * One word against the right one: the same, a typo, or wrong. A typo is one letter missing, one
 * extra, one replaced, or two neighbours swapped, in a word of three letters or more, and the slip
 * must not spell another word (Duolingo's rule: "te" passes for "the", "he" does not).
 */
function wordMatch(t: string, a: string): AnswerResult {
  if (t === a || isOtherSpelling(t, a)) return 'right';
  if ([...a].length < 3) return 'wrong';
  if (editDistance(t, a) !== 1) return 'wrong';
  return isOtherWord(t, a) ? 'wrong' : 'typo';
}

/** Right, a typo (`wordMatch` in any word of the answer, each word at most one slip), or wrong. */
export function checkTyped(typed: string, answers: string[]): AnswerResult {
  const t = normalizeAnswer(typed);
  if (!t) return 'wrong';
  let best: AnswerResult = 'wrong';
  for (const raw of answers) {
    const a = normalizeAnswer(raw);
    if (!a) continue;
    if (t === a) return 'right';
    const tw = t.split(' ');
    const aw = a.split(' ');
    if (tw.length !== aw.length) {
      // A space or hyphen missed or swapped inside a phrase or compound (icecream, ice-cream for
      // ice cream). A one-word answer split in two ("a part" for apart) stays wrong.
      if (/[ -]/.test(a) && t.replace(/[ -]/g, '') === a.replace(/[ -]/g, '')) best = 'typo';
      continue;
    }
    const each = aw.map((w, i) => wordMatch(tw[i], w));
    if (each.every((r) => r === 'right')) return 'right';
    if (!each.includes('wrong')) best = 'typo';
  }
  return best;
}

/**
 * Where a typo is, as the right spelling in pieces: `slip` marks the letters the learner got wrong
 * (replaced, missing or swapped; for an extra letter, the letter it followed). Null when the typed
 * answer is not a typo of `answer`.
 */
export function typoMarks(typed: string, answer: string): { text: string; slip: boolean }[] | null {
  const t = normalizeAnswer(typed);
  const shown = String(answer || '').trim();
  const a = normalizeAnswer(shown);
  // The marks are placed on the shown spelling, so it must line up letter for letter with its normal form.
  if (!t || !a || [...a].length !== [...shown].length) return null;
  const tw = t.split(' ');
  const aw = a.split(' ');
  if (tw.length !== aw.length) return null;
  const marked = new Set<number>();
  let offset = 0;
  for (let k = 0; k < aw.length; k++) {
    const x = [...tw[k]];
    const y = [...aw[k]];
    const match = wordMatch(tw[k], aw[k]);
    if (match === 'wrong') return null;
    if (match === 'typo') {
      let i = 0;
      while (i < x.length && i < y.length && x[i] === y[i]) i++;
      if (x.length === y.length) {
        // Replaced, or swapped with the next letter.
        marked.add(offset + i);
        if (x[i + 1] === y[i] && x[i] === y[i + 1]) marked.add(offset + i + 1);
      } else if (x.length < y.length) marked.add(offset + i);
      else marked.add(offset + Math.max(0, i - 1));
    }
    offset += y.length + 1;
  }
  const out: { text: string; slip: boolean }[] = [];
  [...shown].forEach((c, i) => {
    const slip = marked.has(i);
    const last = out[out.length - 1];
    if (last && last.slip === slip) last.text += c;
    else out.push({ text: c, slip });
  });
  return out;
}

/**
 * How much help a typed answer had: letters shown beyond the usual cue, and the share of the
 * hidden letters asked for with Hint (`hintShare`).
 */
export interface AnswerHelp {
  extra?: number;
  hintShare?: number;
}

/** A typed answer that needed Hint for more than this share of its hidden letters was not recalled. */
export const HINT_FAIL_SHARE = 1 / 3;

/**
 * Grade from the outcome and the response time. A wrong answer is Again. A right choice is Good,
 * or Hard after ten seconds; recognising a word never earns Easy. A right typed answer is Easy
 * when it came quickly (2.5 s plus a quarter second per letter), Hard when it took more than 15 s
 * plus that allowance, and Good otherwise. A typo counts as right, as on Duolingo, but is Good at
 * most, since the spelling was not quite there. Hint lowers the credit with the letters it gives:
 * any hint makes the answer Hard at most, and an answer that needed hints for more than a third
 * of its hidden letters (HINT_FAIL_SHARE) is Again, since the learner was told the word rather
 * than recalled it.
 */
export function autoGrade(kind: QuestionKind, result: AnswerResult, ms: number, length = 0, help: AnswerHelp = {}): ReviewGrade {
  if (result === 'wrong') return 1;
  if (TYPED_KINDS.includes(kind)) {
    const share = help.hintShare || 0;
    if (share > HINT_FAIL_SHARE + 1e-9) return 1;
    if (share > 0) return 2;
    const allowance = 250 * length;
    if (ms <= 2500 + allowance) return help.extra || result === 'typo' ? 3 : 4;
    if (ms > 15000 + allowance) return 2;
    return 3;
  }
  // Letter tiles hand the learner the letters, so a quick build is Good, never Easy.
  if (kind === 'spell-tiles') return ms > 15000 + 250 * length ? 2 : 3;
  return ms > 10000 ? 2 : 3;
}

/**
 * The learner model with this session's answers folded in: right answers counted, so harder kinds
 * open during a session, and each offset moved by the session's surprises (`eloStep`).
 */
export function sessionLearner(learner: LearnerModel | null | undefined, results: ReviewResult[]): LearnerModel | null {
  if (!learner) return null;
  const right = { ...learner.right };
  const offset = { ...learner.offset };
  for (const r of results) {
    if (r.grade > 1) right[r.kind] = (right[r.kind] || 0) + 1;
    // A hinted answer counts as only partly right, by the share of the word it was given.
    const outcome = r.grade > 1 ? 1 - (r.hintShare || 0) : 0;
    if (r.predicted != null) offset[r.kind] = eloStep(offset[r.kind] || 0, outcome, r.predicted, 40);
  }
  return { offset, right };
}

/** The current question, built on first use so it stays put across re-renders. */
export function ensureReviewQuestion(state: ReviewState, entries: NotebookEntry[], opts: QuestionOptions = {}): ReviewQuestion | null {
  if (!state.started || state.index >= state.queue.length) return null;
  const id = state.queue[state.index];
  if (state.question && state.question.id === id) return state.question;
  const entry = entries.find((e) => e.id === id);
  if (!entry || !isLearnable(entry) || !canAsk(entry, opts)) {
    // Deleted meanwhile, no longer a word to study (a re-lookup found it is a sentence or symbol),
    // or nothing usable to ask (senses that are only citations): skip it.
    state.queue.splice(state.index, 1);
    return ensureReviewQuestion(state, entries, opts);
  }
  const asked = state.seen[id] || 0;
  const kinds = state.results.map((r) => r.kind);
  const learner = sessionLearner(opts.learner, state.results);
  registerEntryWords(entries);
  state.question = buildQuestion(entry, entries, { ...opts, learner, asked: kinds, repeat: asked }, seededRandom(hash(`${id}:${state.seed}:${asked}`)));
  state.answer = null;
  state.revealed = false;
  return state.question;
}

/**
 * Records the learner's answer: a choice index, typed text, `knew` for a flash card, or nothing
 * at all for "I don't know".
 */
export function answerReview(state: ReviewState, input: { choice?: number; typed?: string; knew?: boolean } = {}, now = Date.now()): ReviewAnswer | null {
  const q = state.question;
  if (!q || state.answer) return null;
  const ms = Math.max(0, now - q.shownAt);
  let result: AnswerResult = 'wrong';
  if (q.kind === 'flash') result = input.knew ? 'right' : 'wrong';
  else if (q.correct >= 0) result = input.choice === q.correct ? 'right' : 'wrong';
  // Tiles hold only the word's own letters, so any slip is a real misspelling.
  else if (q.kind === 'spell-tiles') result = input.typed != null && normalizeAnswer(input.typed) === normalizeAnswer(q.lemma) ? 'right' : 'wrong';
  else if (input.typed != null) result = checkTyped(input.typed, q.answers);
  const help: AnswerHelp = { extra: Math.max(0, (q.reveal || 0) - (q.kind === 'listen-type' ? 0 : 1)), hintShare: hintShare(q) };
  const auto = q.kind === 'flash' ? (input.knew ? 3 : 1) : autoGrade(q.kind, result, ms, q.lemma.length, help);
  state.answer = { choice: input.choice ?? -1, typed: input.typed ?? '', result, auto, grade: auto, overridden: false, ms, at: now };
  return state.answer;
}

/** Kinds the countdown in Settings → Learn applies to: the questions answered by picking one of four. */
export const COUNTDOWN_KINDS: QuestionKind[] = ['meaning-choice', 'word-choice', 'listen-choice', 'cloze-choice', 'synonym-choice', 'antonym-choice'];

/** Milliseconds a question allows with a countdown of `seconds` (0 is off); 0 for kinds without one. */
export function countdownMs(q: ReviewQuestion | null | undefined, seconds: number | null | undefined): number {
  const s = Number(seconds) || 0;
  if (!q || s <= 0 || !COUNTDOWN_KINDS.includes(q.kind)) return 0;
  return s * 1000;
}

/** The longest a listening question's countdown waits for its word to play before it starts anyway. */
export const COUNTDOWN_WAIT_MS = 8000;

/**
 * A listening question's countdown waits until its word has played or failed to load
 * (`markHeard`), and at most COUNTDOWN_WAIT_MS from the question's start.
 */
export function countdownWaiting(q: ReviewQuestion, now = Date.now()): boolean {
  return kindSkill(q.kind) === 'listening' && !q.heard && now - q.shownAt < COUNTDOWN_WAIT_MS;
}

/**
 * The word of the question on screen has played, or could not be played: a listening question's
 * countdown may start. True when that changed something, so the shell repaints.
 */
export function markHeard(state: ReviewState | null | undefined, lemma: string): boolean {
  const q = state?.question;
  if (!q || state.answer || q.heard || clean(q.lemma).toLowerCase() !== clean(lemma).toLowerCase()) return false;
  q.heard = true;
  // Only a question with a countdown has anything to redraw. Repainting a dictation here would
  // interrupt the learner typing while the word plays.
  return COUNTDOWN_KINDS.includes(q.kind);
}

/**
 * Countdown time a question has used: the time it was on screen once `armCountdown` has run, and
 * until then the time since it was shown, or none while a listening question waits for its word.
 */
export function countdownElapsed(q: ReviewQuestion, now = Date.now()): number {
  return q.countdownSpent ?? (countdownWaiting(q, now) ? 0 : Math.max(0, now - q.shownAt));
}

/**
 * The countdown ran out: the question counts as not known (Again), as "I don't know" would, and
 * the answer is marked as timed out. False when there is nothing to time out.
 */
export function expireCountdown(state: ReviewState, seconds: number | null | undefined, now = Date.now()): boolean {
  const q = state.question;
  const ms = countdownMs(q, seconds);
  if (!q || state.answer || !ms || countdownElapsed(q, now) < ms) return false;
  const a = answerReview(state, {}, q.shownAt + ms);
  if (a) a.timedOut = true;
  return !!a;
}

/** How often the countdown checks whether its question is still on screen. */
const COUNTDOWN_TICK_MS = 100;

let countdownTick: ReturnType<typeof setInterval> | null = null;

const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Runs the countdown for the question on screen, replacing any earlier one; the shells call it
 * after every paint of Learn. Time counts only while the question is on screen (`showing`) and
 * the app is in front: a learner who opens Settings or another tab, or puts the phone away, comes
 * back to the time that was left. When it runs out the question is answered as not known and
 * `repaint` draws the answer; `repaint` also redraws the bar when the app comes back to the front.
 */
export function armCountdown(state: ReviewState | null | undefined, seconds: number | null | undefined, showing: () => boolean, repaint: () => void, now = Date.now()): void {
  if (countdownTick) clearInterval(countdownTick);
  countdownTick = null;
  const q = state?.question;
  const ms = countdownMs(q, seconds);
  if (!state || !q || state.answer || !ms) return;
  q.countdownSpent = countdownElapsed(q, now);
  let mark = now;
  let wasHidden = false;
  const stop = () => {
    if (countdownTick === tick) clearInterval(tick);
    if (countdownTick === tick) countdownTick = null;
  };
  const tick: ReturnType<typeof setInterval> = setInterval(() => {
    const t = Date.now();
    // Off screen: the next paint of Learn arms the countdown again from where it stands.
    if (state.question !== q || state.answer || !showing()) return stop();
    // In the background, or a listening question whose word has not played yet: no time counts.
    if (pageHidden() || countdownWaiting(q, t)) {
      wasHidden = true;
      mark = t;
      return;
    }
    q.countdownSpent = (q.countdownSpent || 0) + (t - mark);
    mark = t;
    if (q.countdownSpent >= ms) {
      stop();
      if (expireCountdown(state, seconds, t)) repaint();
    } else if (wasHidden) {
      // Back in front, or the word has played: the bar starts or resumes where the time stands.
      stop();
      repaint();
    }
  }, COUNTDOWN_TICK_MS);
  countdownTick = tick;
}

/**
 * The grade "I knew it" gives an answer graded Again: Good after a miss, and Hard at most after a
 * right answer or a typo that needed many hints.
 */
export function knewItGrade(a: ReviewAnswer): ReviewGrade {
  return a.result === 'wrong' ? 3 : 2;
}

/**
 * Overturns the automatic grade: "I knew it" after an answer graded Again (`knewItGrade`), "I
 * didn't know it" after one graded higher (Again), or `easy` for "Too easy" after a hit (Easy).
 * Tapping the same one again undoes it.
 */
export function overrideReview(state: ReviewState, mode: 'flip' | 'easy' = 'flip'): void {
  const a = state.answer;
  if (!a) return;
  const target: ReviewGrade = mode === 'easy' ? 4 : a.auto === 1 ? knewItGrade(a) : 1;
  if (a.overridden && a.grade === target) {
    a.grade = a.auto;
    a.overridden = false;
  } else {
    a.grade = target;
    a.overridden = true;
  }
}

/**
 * Moves past the answered question. `updated` is the word as saved; when it is due again within
 * the learn-ahead window it goes back in the queue, up to MAX_ASKS_PER_SESSION asks (a leech up
 * to MAX_LEECH_ASKS).
 */
export function advanceReview(state: ReviewState, updated?: NotebookEntry | null, now = Date.now()): void {
  const q = state.question;
  const a = state.answer;
  if (!q || !a) return;
  const levelAfter = updated ? memoryLevel(updated) : q.level;
  const maturityAfter = updated ? wordMaturity(updated) : q.maturity;
  state.results.push({
    id: q.id,
    lemma: q.lemma,
    kind: q.kind,
    result: a.result,
    grade: a.grade,
    ms: a.ms,
    levelBefore: q.level,
    levelAfter,
    maturityBefore: q.maturity,
    maturityAfter,
    hinted: q.hinted || 0,
    hintShare: hintShare(q),
    predicted: q.predicted,
  });
  const asked = (state.seen[q.id] || 0) + 1;
  state.seen[q.id] = asked;
  const soon = updated?.reviewDue != null ? Number(updated.reviewDue) - now <= LEARN_AHEAD_MS : a.grade === 1;
  const cap = q.leech ? MAX_LEECH_ASKS : MAX_ASKS_PER_SESSION;
  if (soon && asked < cap) state.queue.push(q.id);
  state.index += 1;
  state.question = null;
  state.answer = null;
  state.revealed = false;
}
