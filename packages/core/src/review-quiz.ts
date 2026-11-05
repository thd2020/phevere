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

export type { ReviewGrade };

/**
 * - meaning-choice: the word is shown, pick its meaning (passive recognition).
 * - word-choice: the meaning is shown, pick the word (active recognition).
 * - listen-choice: the word is played, pick it (early stages only).
 * - recall: the meaning is shown with the first letter or more, type the word (active recall).
 * - listen-type: dictation; the word is played, type it.
 * - cloze: a sentence from the learner's note with the word blanked out, type it.
 * - flash: show the word, then the meaning, and the learner says whether they knew it; used only
 *   when nothing else can be asked (no meaning saved and too few other words).
 */
export type QuestionKind = 'meaning-choice' | 'word-choice' | 'listen-choice' | 'recall' | 'listen-type' | 'cloze' | 'flash';

export type AnswerResult = 'right' | 'close' | 'wrong';

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
  /** How many letters `hint` holds; more for a weaker word (diminishing cues), none for dictation of a firm word. */
  reveal?: number;
  /** Letters revealed on request with Hint. */
  hinted?: number;
  /** The answer box after a Hint: the letters shown so far, for the learner to finish. */
  draft?: string;
  shownAt: number;
  /** Missed LEECH_LAPSES times or more. */
  leech?: boolean;
  /** The word's stage when asked. */
  maturity?: Maturity;
  /** Predicted chance of a right answer to this question, from the word's recall and the learner. */
  predicted?: number;
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
  /** Words set aside with "Already know it" this round, for the summary's Undo. */
  knownMarked?: string[];
}

export interface QuestionOptions {
  /** Pronunciation can be played (sound is on). */
  audio?: boolean;
  now?: number;
  /** Example sentences for a word (from its dictionary entry), for gap-fill questions. */
  examples?: (lemma: string) => string[] | undefined;
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
 * New words for today, which vary with the day's load as MaiMemo's do: `newWordAllowance`, and,
 * once the learner's pace is known, no more than fit beside today's reviews in a usual day's
 * answers with a fifth to spare. A heavy day gets fewer new words and a light day the whole goal.
 */
export function newWordsToday(goal: number, due: number, pace?: StudyPace | null): number {
  const base = newWordAllowance(goal, due);
  if (!pace || !(pace.answersPerDay > 0)) return base;
  const room = (pace.answersPerDay - due * ANSWERS_PER_REVIEW) * 1.2;
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
  /** New words the goal allowed but the review load held back. */
  heldBack: number;
}

/**
 * Today's plan: words due by the end of today, most overdue first, and today's new words (oldest
 * saved first, up to the daily goal less those started today, fewer when many reviews are due,
 * `newWordsToday`) spread among them. One form of each word only.
 */
export function reviewPlan(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0, pace?: StudyPace | null): QueuePlan {
  const end = dayStart(now) + DAY;
  const dueAll = entries.filter((e) => !isNew(e) && e.reviewDue != null && Number(e.reviewDue) < end).sort((x, y) => Number(x.reviewDue) - Number(y.reviewDue));
  const newAll = entries.filter((e) => isNew(e) && clean(e.lemma)).sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0));
  const kept = new Set(dedupeLemmas([...dueAll, ...newAll]));
  const due = dueAll.filter((e) => kept.has(e));
  const fresh = newAll.filter((e) => kept.has(e));
  const left = Math.max(0, goal - startedToday);
  const taken = fresh.slice(0, Math.min(left, newWordsToday(goal, due.length, pace)));
  return { ids: interleaveNew(due, taken).map((e) => e.id), due: due.length, fresh: taken.length, heldBack: Math.min(fresh.length, left) - taken.length };
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
  };
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

export const MATURITY_NAME: Record<Maturity, string> = { new: 'New', learning: 'Learning', relearning: 'Relearning', young: 'Young', mature: 'Mature' };

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

/** The word and its regular inflections in running text, for gap-fill questions (not leader for lead). */
function clozePattern(lemma: string): RegExp {
  const low = lemma.toLowerCase();
  if (!isLatin(low) || /\s/.test(low)) return new RegExp(escRe(low), 'gi');
  const forms = [low, ...regularForms(low)].sort((a, b) => b.length - a.length).map(escRe);
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
  const l = clean(lemma).toLowerCase();
  if (!/^[a-z]{2,}$/.test(l)) return [];
  const out = new Set<string>();
  const consY = /[^aeiou]y$/.test(l);
  // Plural and third person.
  if (consY) out.add(`${l.slice(0, -1)}ies`);
  else if (/(?:s|x|z|ch|sh|o)$/.test(l)) out.add(`${l}es`);
  else out.add(`${l}s`);
  // Past.
  const oneSyllable = (l.match(VOWELS) || []).length === 1;
  const doubles = oneSyllable && /[^aeiou][aeiou][bdgklmnprtvz]$/.test(l);
  if (/e$/.test(l)) out.add(`${l}d`);
  else if (consY) out.add(`${l.slice(0, -1)}ied`);
  else out.add(doubles ? `${l}${l.slice(-1)}ed` : `${l}ed`);
  // Present participle.
  if (/ie$/.test(l)) out.add(`${l.slice(0, -2)}ying`);
  else if (/[^e]e$/.test(l) && l.length > 2) out.add(`${l.slice(0, -1)}ing`);
  else out.add(doubles ? `${l}${l.slice(-1)}ing` : `${l}ing`);
  out.delete(l);
  return [...out];
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
export function clozeFromSentences(lemma: string, sentences: string[]): { sentence: string; form: string } | null {
  if (!lemma) return null;
  for (const block of sentences) {
    for (const raw of clean(block).split(/(?<=[.!?。！？])\s*|\n+/)) {
      const sentence = raw.trim().replace(/^[“"‘']|[”"’']$/g, '');
      if (!sentence || sentence.length > 220) continue;
      const re = clozePattern(lemma);
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
  return clozeFromSentences(lemma, [...own, ...examples]);
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
 * learning word is recognised, heard among four or typed; a young word is typed, filled into a
 * sentence or written from dictation; a mature word is mostly produced. Listening by choice
 * belongs to the early stages and dictation to the later ones. Within a stage the kind is chosen
 * by how likely the learner is to get it right (`chooseKind`).
 */
export const STAGE_KINDS: Record<number, QuestionKind[]> = {
  0: ['meaning-choice', 'word-choice', 'flash'],
  1: ['word-choice', 'meaning-choice', 'listen-choice', 'recall', 'cloze', 'flash'],
  2: ['recall', 'word-choice', 'cloze', 'listen-type', 'listen-choice', 'meaning-choice', 'flash'],
  3: ['cloze', 'recall', 'listen-type', 'word-choice', 'meaning-choice', 'flash'],
};

export type QuizSkill = 'meaning' | 'spelling' | 'listening';

const KIND_SKILL: Record<QuestionKind, QuizSkill> = {
  'meaning-choice': 'meaning',
  'word-choice': 'meaning',
  flash: 'meaning',
  recall: 'spelling',
  cloze: 'spelling',
  'listen-choice': 'listening',
  'listen-type': 'listening',
};

/** Kinds answered by typing the word. */
export const TYPED_KINDS: QuestionKind[] = ['recall', 'cloze', 'listen-type'];

/** Shares of a session each skill aims at; listening also has a hard cap (LISTEN_CAP). */
export const SKILL_TARGET: Record<QuizSkill, number> = { meaning: 0.5, spelling: 0.35, listening: 0.15 };

/**
 * The share of right answers the choice of kind aims at. Wilson et al. (2019) derive about 85%
 * as the best training accuracy, and Duolingo's Birdbrain picks exercises the learner should find
 * just hard enough; the FSRS schedule itself aims at 90% recall when a word falls due.
 */
export const TARGET_SUCCESS = 0.85;

/**
 * How much easier (+) or harder (-) each kind is than typing the word from its meaning with its
 * first letter, in log-odds. The order is Laufer and Goldstein's (2004): recognising a meaning is
 * easiest, then recognising the word, then recalling it; dictation adds hearing to spelling.
 */
export const KIND_EASE: Record<QuestionKind, number> = {
  'meaning-choice': 1.8,
  'word-choice': 1.4,
  'listen-choice': 1.1,
  flash: 1.0,
  cloze: 0.1,
  recall: 0,
  'listen-type': -0.5,
};

/** Each letter shown beyond the usual cue makes a typed answer this much easier, in log-odds. */
export const LETTER_EASE = 0.45;

/**
 * Harder kinds open for a learner once they have answered easier ones right this many times,
 * counting every word: typing after recognising words, a sentence gap after typing, dictation
 * after picking words they heard. Without a learner model every kind is open.
 */
export const KIND_UNLOCK: Partial<Record<QuestionKind, { after: QuestionKind[]; right: number }>> = {
  recall: { after: ['word-choice', 'meaning-choice'], right: 5 },
  cloze: { after: ['recall'], right: 3 },
  'listen-type': { after: ['listen-choice'], right: 3 },
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
  return kind === 'listen-type' ? 0 : 1;
}

/** Predicted chance of a right answer to `kind` for a word of `strength`, with `letters` shown. */
export function successChance(kind: QuestionKind, strength: number, learner?: LearnerModel | null, letters = baseLetters(kind)): number {
  const extra = TYPED_KINDS.includes(kind) ? Math.max(0, letters - baseLetters(kind)) * LETTER_EASE : 0;
  return sigmoid(strength + KIND_EASE[kind] + (learner?.offset[kind] || 0) + extra);
}

/**
 * Letters to show for a typed answer, as diminishing cues (Finley et al. 2011, Fiechter and
 * Benjamin 2018): the usual cue, plus a letter at a time while the predicted chance stays below
 * TARGET_SUCCESS, never more than a third of the word.
 */
export function cueLetters(kind: QuestionKind, answer: string, strength: number, learner?: LearnerModel | null): number {
  const base = baseLetters(kind);
  const len = [...answer].length;
  const most = Math.max(0, Math.floor((len - 2) / 3));
  let n = 0;
  while (n < most && successChance(kind, strength, learner, base + n) < TARGET_SUCCESS) n += 1;
  return Math.min(base + n, Math.max(0, len - 1));
}

/**
 * Skill aims for a session. Spelling is the hardest kind of knowing a word, so its share shrinks
 * for a learner whose typed answers go wrong more often than expected and grows a little for one
 * who spells well; meaning takes the rest.
 */
export function skillTargets(learner?: LearnerModel | null): Record<QuizSkill, number> {
  if (!learner) return SKILL_TARGET;
  const typed = ((learner.offset.recall || 0) + (learner.offset.cloze || 0)) / 2;
  const spelling = Math.min(0.45, Math.max(0.15, SKILL_TARGET.spelling + 0.2 * typed));
  return { meaning: 1 - spelling - SKILL_TARGET.listening, spelling, listening: SKILL_TARGET.listening };
}

/** Whether one more listening question keeps listening within LISTEN_CAP of the session. */
export function listeningAllowed(asked: QuestionKind[]): boolean {
  const listened = asked.filter((k) => KIND_SKILL[k] === 'listening').length;
  return listened + 1 <= LISTEN_CAP * (asked.length + 1) + 1e-9;
}

/**
 * The stage a word is asked at: 0 new, 1 learning or relearning or held under four days, 2 young,
 * 3 mature (`memoryLevel`). A new word coming back in the same session moves to the learning
 * stage; a leech stays at the learning stage.
 */
export function questionStage(e: NotebookEntry, repeat = 0): number {
  const level = memoryLevel(e);
  const stage = level === 0 ? Math.min(repeat, 1) : level;
  return isLeech(e) ? Math.min(stage, 1) : stage;
}

export interface KindChoice {
  /** Predicted chance of a right answer for each kind. */
  predict?: (kind: QuestionKind) => number;
  /** Skill aims (`skillTargets`). */
  targets?: Record<QuizSkill, number>;
}

/**
 * Picks the kind for a word among those its stage allows: the one whose predicted chance of a
 * right answer is nearest TARGET_SUCCESS (a shortfall counting double), with a kind whose skill the session already leans on
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
  order.forEach((k, i) => {
    if (!can[k]) return;
    const skill = KIND_SKILL[k];
    if (skill === 'listening' && !listenOk) return;
    // Falling short of the aim costs twice as much as passing it: a miss sends the word back to
    // relearning, while an easy question still makes the learner retrieve the word.
    const p = choice.predict ? choice.predict(k) : 0;
    const fit = choice.predict ? (p < TARGET_SUCCESS ? 2 * (TARGET_SUCCESS - p) : p - TARGET_SUCCESS) * 4 : i * 0.5;
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
  const wordLures = pickDistractors(entry, pool, 'word', 3, rand);
  const typedOk = !isLeech(entry) && !(repeat > 0 && stage <= 1);
  const open = (k: QuestionKind) => kindUnlocked(k, learner) && (!TYPED_KINDS.includes(k) || typedOk);
  const can: Record<QuestionKind, boolean> = {
    'meaning-choice': hasMeaning && meaningLures.length >= 2,
    'word-choice': hasMeaning && wordLures.length >= 2,
    'listen-choice': !!opts.audio && wordLures.length >= 2,
    recall: hasMeaning && open('recall'),
    'listen-type': !!opts.audio && open('listen-type'),
    cloze: !!cloze && open('cloze'),
    flash: hasMeaning || !clean(entry.definition),
  };
  const strength = wordStrength(entry, now);
  const answerOf = (k: QuestionKind) => (k === 'cloze' && cloze ? cloze.form : lemma);
  const lettersFor = (k: QuestionKind) => (TYPED_KINDS.includes(k) ? cueLetters(k, answerOf(k), strength, learner) : 0);
  const predict = (k: QuestionKind) => successChance(k, strength, learner, lettersFor(k));
  const kind = chooseKind(stage, can, opts.asked || [], rand, { predict, targets: skillTargets(learner) });

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
  } else if (kind === 'recall' || kind === 'listen-type') {
    if (kind === 'recall') base.prompt = meaning;
    base.reveal = lettersFor(kind);
    base.hint = [...lemma].slice(0, base.reveal).join('');
  } else if (kind === 'cloze' && cloze) {
    base.prompt = cloze.sentence;
    base.answers = [...new Set([cloze.form, ...answers])];
    base.reveal = lettersFor(kind);
    base.hint = [...cloze.form].slice(0, base.reveal).join('');
  } else if (kind === 'flash') {
    base.prompt = meaning;
  }
  return base;
}

/** Letters still hidden that Hint may reveal: all but the last one. */
export function hintsLeft(q: ReviewQuestion): number {
  if (!TYPED_KINDS.includes(q.kind)) return 0;
  const len = [...(q.answers[0] || '')].length;
  return Math.max(0, len - 1 - (q.reveal || 0) - (q.hinted || 0));
}

/**
 * Hint: reveals the next letter of the answer into the answer box. A right answer after a hint
 * counts as Hard, as a near miss does.
 */
export function hintReview(state: ReviewState): boolean {
  const q = state.question;
  if (!q || state.answer || !hintsLeft(q)) return false;
  q.hinted = (q.hinted || 0) + 1;
  q.draft = [...q.answers[0]].slice(0, (q.reveal || 0) + q.hinted).join('');
  return true;
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

/** Right, close (one slip in a word of five letters or more, two from ten), or wrong. */
export function checkTyped(typed: string, answers: string[]): AnswerResult {
  const t = normalizeAnswer(typed);
  if (!t) return 'wrong';
  let best: AnswerResult = 'wrong';
  for (const raw of answers) {
    const a = normalizeAnswer(raw);
    if (!a) continue;
    if (t === a) return 'right';
    const allowed = a.length >= 10 ? 2 : a.length >= 5 ? 1 : 0;
    if (allowed && editDistance(t, a) <= allowed) best = 'close';
  }
  return best;
}

/** How much help a typed answer had: letters shown beyond the usual cue, and letters asked for with Hint. */
export interface AnswerHelp {
  extra?: number;
  hinted?: number;
}

/**
 * Grade from the outcome and the response time. A wrong answer is Again and a near miss is Hard.
 * A right choice is Good, or Hard after ten seconds; recognising a word never earns Easy. A right
 * typed answer is Easy when it came quickly (2.5 s plus a quarter second per letter), Hard when
 * it took more than 15 s plus that allowance, and Good otherwise. A typed answer finished after a
 * Hint is Hard, and one given extra letters up front is at most Good.
 */
export function autoGrade(kind: QuestionKind, result: AnswerResult, ms: number, length = 0, help: AnswerHelp = {}): ReviewGrade {
  if (result === 'wrong') return 1;
  if (result === 'close') return 2;
  if (TYPED_KINDS.includes(kind)) {
    if (help.hinted) return 2;
    const allowance = 250 * length;
    if (ms <= 2500 + allowance) return help.extra ? 3 : 4;
    if (ms > 15000 + allowance) return 2;
    return 3;
  }
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
    if (r.predicted != null) offset[r.kind] = eloStep(offset[r.kind] || 0, r.grade > 1 ? 1 : 0, r.predicted, 40);
  }
  return { offset, right };
}

/** The current question, built on first use so it stays put across re-renders. */
export function ensureReviewQuestion(state: ReviewState, entries: NotebookEntry[], opts: QuestionOptions = {}): ReviewQuestion | null {
  if (!state.started || state.index >= state.queue.length) return null;
  const id = state.queue[state.index];
  if (state.question && state.question.id === id) return state.question;
  const entry = entries.find((e) => e.id === id);
  if (!entry || !canAsk(entry, opts)) {
    // Deleted meanwhile, or nothing usable to ask (senses that are only citations): skip it.
    state.queue.splice(state.index, 1);
    return ensureReviewQuestion(state, entries, opts);
  }
  const asked = state.seen[id] || 0;
  const kinds = state.results.map((r) => r.kind);
  const learner = sessionLearner(opts.learner, state.results);
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
  else if (input.typed != null) result = checkTyped(input.typed, q.answers);
  const help: AnswerHelp = { extra: Math.max(0, (q.reveal || 0) - (q.kind === 'listen-type' ? 0 : 1)), hinted: q.hinted || 0 };
  const auto = q.kind === 'flash' ? (input.knew ? 3 : 1) : autoGrade(q.kind, result, ms, q.lemma.length, help);
  state.answer = { choice: input.choice ?? -1, typed: input.typed ?? '', result, auto, grade: auto, overridden: false, ms, at: now };
  return state.answer;
}

/**
 * Overturns the automatic grade: "I knew it" after a miss (Good), "I didn't know it" after a hit
 * (Again), or `easy` for "Too easy" after a hit (Easy). Tapping the same one again undoes it.
 */
export function overrideReview(state: ReviewState, mode: 'flip' | 'easy' = 'flip'): void {
  const a = state.answer;
  if (!a) return;
  const target: ReviewGrade = mode === 'easy' ? 4 : a.result === 'wrong' ? 3 : 1;
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
