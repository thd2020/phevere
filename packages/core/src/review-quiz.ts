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
import type { ReviewGrade } from './review-schedule';

export type { ReviewGrade };

/**
 * - meaning-choice: the word is shown, pick its meaning (passive recognition).
 * - word-choice: the meaning is shown, pick the word (active recognition).
 * - listen-choice: the word is played, pick it.
 * - recall: the meaning is shown with the first letter, type the word (active recall).
 * - listen-type: the word is played, type it.
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
  /** First letter, for typed questions. */
  hint: string;
  shownAt: number;
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
}

export interface ReviewResult {
  id: string;
  lemma: string;
  kind: QuestionKind;
  result: AnswerResult;
  grade: ReviewGrade;
  ms: number;
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
}

export interface QuestionOptions {
  /** Pronunciation can be played (sound is on). */
  audio?: boolean;
  now?: number;
}

/** A word asked this many times in one session waits for the next session. */
export const MAX_ASKS_PER_SESSION = 3;
/** Like Anki's learn-ahead limit: a word due again within this window comes back this session. */
export const LEARN_AHEAD_MS = 20 * 60_000;

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
 * Words due by the end of today, most overdue first, with today's new words (oldest saved first,
 * up to the daily goal less those already started today) spread evenly among them.
 */
export function reviewQueue(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0): string[] {
  const end = dayStart(now) + DAY;
  const due = entries
    .filter((e) => !isNew(e) && e.reviewDue != null && Number(e.reviewDue) < end)
    .sort((x, y) => Number(x.reviewDue) - Number(y.reviewDue));
  const fresh = entries
    .filter((e) => isNew(e) && clean(e.lemma))
    .sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0))
    .slice(0, Math.max(0, goal - startedToday));
  if (!due.length || !fresh.length) return [...due, ...fresh].map((e) => e.id);
  // Interleave: one new word after every `step` reviews.
  const out: NotebookEntry[] = [];
  const step = Math.max(1, Math.floor(due.length / fresh.length));
  let f = 0;
  due.forEach((e, i) => {
    out.push(e);
    if ((i + 1) % step === 0 && f < fresh.length) out.push(fresh[f++]);
  });
  return [...out, ...fresh.slice(f)].map((e) => e.id);
}

export function startReview(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0): ReviewState {
  return {
    queue: reviewQueue(entries, goal, now, startedToday),
    index: 0,
    started: false,
    question: null,
    answer: null,
    revealed: false,
    results: [],
    seen: {},
    seed: Math.floor(now % 2147483647),
  };
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
  if (s < 21) return 2;
  return 3;
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

/** The meaning with the word itself blanked out, so it cannot give the answer away. */
export function maskWord(text: string, lemma: string): string {
  if (!lemma) return text;
  return text.replace(formPattern(lemma), '…');
}

/** First saved sense, trimmed to a readable length. */
export function questionMeaning(e: NotebookEntry): string {
  const sense = vocabSenses(e.definition)[0] || '';
  const masked = maskWord(sense, clean(e.lemma));
  return masked.length > 160 ? `${masked.slice(0, 157).replace(/\s+\S*$/, '')}…` : masked;
}

function normPos(pos: unknown): string {
  const p = clean(pos).toLowerCase().split(/[\s,;/]+/)[0] || '';
  const map: Record<string, string> = { n: 'noun', v: 'verb', vt: 'verb', vi: 'verb', adj: 'adjective', a: 'adjective', adv: 'adverb' };
  return map[p.replace(/\.$/, '')] || p;
}

/** A sentence from the note that uses the word, with the form that appears there. */
export function clozeFrom(e: NotebookEntry): { sentence: string; form: string } | null {
  const lemma = clean(e.lemma);
  const note = clean(e.note);
  if (!lemma || !note) return null;
  for (const raw of note.split(/(?<=[.!?。！？])\s*|\n+/)) {
    const sentence = raw.trim();
    const re = formPattern(lemma);
    const m = re.exec(sentence);
    if (!m) continue;
    const rest = sentence.replace(m[0], ' ').trim();
    const enough = isLatin(lemma) ? rest.split(/\s+/).filter(Boolean).length >= 3 : rest.length >= 4;
    if (!enough) continue;
    return { sentence: sentence.slice(0, m.index) + '_____' + sentence.slice(m.index + m[0].length), form: m[0] };
  }
  return null;
}

/* ----------------------------------------------------------- distractors */

/**
 * Plausible wrong options from other saved words: same language first, then the same part of
 * speech (Little et al. 2012: competitive lures make a choice question a real retrieval), with
 * similar-looking words preferred when the options are words. Never the word itself or a
 * duplicate meaning.
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
  for (const { e } of scored) {
    const text = mode === 'meaning' ? questionMeaning(e).toLowerCase() : clean(e.lemma).toLowerCase();
    if (seenText.has(text)) continue;
    seenText.add(text);
    out.push(e);
    if (out.length >= count) break;
  }
  return out;
}

/* ------------------------------------------------------------- questions */

const LADDER: Record<number, { first: QuestionKind[]; then: QuestionKind[]; keepOrder?: boolean }> = {
  0: { first: ['meaning-choice'], then: ['word-choice', 'listen-choice', 'recall', 'flash'] },
  1: { first: ['word-choice', 'listen-choice'], then: ['meaning-choice', 'recall', 'flash'] },
  2: { first: ['recall', 'listen-type', 'cloze'], then: ['word-choice', 'meaning-choice', 'listen-choice', 'flash'] },
  3: { first: ['cloze', 'recall', 'listen-type'], then: ['word-choice', 'meaning-choice', 'flash'], keepOrder: true },
};

/** Builds the question for one word. `pool` is the whole notebook, for wrong options. */
export function buildQuestion(entry: NotebookEntry, pool: NotebookEntry[], opts: QuestionOptions = {}, rand: () => number = Math.random): ReviewQuestion {
  const now = opts.now ?? Date.now();
  const lemma = clean(entry.lemma);
  const level = memoryLevel(entry);
  const meaning = questionMeaning(entry);
  const hasMeaning = !!meaning && meaning !== '…';
  const cloze = clozeFrom(entry);
  const meaningLures = hasMeaning ? pickDistractors(entry, pool, 'meaning', 3, rand) : [];
  const wordLures = pickDistractors(entry, pool, 'word', 3, rand);
  const can: Record<QuestionKind, boolean> = {
    'meaning-choice': hasMeaning && meaningLures.length >= 2,
    'word-choice': hasMeaning && wordLures.length >= 2,
    'listen-choice': !!opts.audio && wordLures.length >= 2,
    recall: hasMeaning,
    'listen-type': !!opts.audio,
    cloze: !!cloze,
    flash: true,
  };
  const ladder = LADDER[level] || LADDER[0];
  // Level 3 asks a cloze whenever the note has a sentence; otherwise the first choices rotate.
  const first = ladder.keepOrder ? [ladder.first[0], ...shuffle(ladder.first.slice(1), rand)] : shuffle(ladder.first, rand);
  const kind = [...first, ...ladder.then].find((k) => can[k]) || 'flash';

  const base: ReviewQuestion = {
    id: entry.id,
    kind,
    lemma,
    level,
    prompt: '',
    options: [],
    optionWords: [],
    correct: -1,
    answers: [lemma],
    hint: '',
    shownAt: now,
  };
  if (kind === 'meaning-choice' || kind === 'word-choice' || kind === 'listen-choice') {
    const lures = kind === 'meaning-choice' ? meaningLures : wordLures;
    const all = shuffle([entry, ...lures], rand);
    base.options = all.map((e) => (kind === 'meaning-choice' ? questionMeaning(e) : clean(e.lemma)));
    base.optionWords = all.map((e) => clean(e.lemma));
    base.correct = all.indexOf(entry);
    if (kind === 'word-choice') base.prompt = meaning;
  } else if (kind === 'recall') {
    base.prompt = meaning;
    base.hint = lemma.charAt(0);
  } else if (kind === 'cloze' && cloze) {
    base.prompt = cloze.sentence;
    base.answers = [...new Set([cloze.form, lemma])];
    base.hint = cloze.form.charAt(0);
  } else if (kind === 'flash') {
    base.prompt = meaning;
  }
  return base;
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

const TYPED: QuestionKind[] = ['recall', 'listen-type', 'cloze'];

/**
 * Grade from the outcome and the response time. A wrong answer is Again and a near miss is Hard.
 * A right choice is Good, or Hard after ten seconds; recognising a word never earns Easy. A right
 * typed answer is Easy when it came quickly (2.5 s plus a quarter second per letter), Hard when
 * it took more than 15 s plus that allowance, and Good otherwise.
 */
export function autoGrade(kind: QuestionKind, result: AnswerResult, ms: number, length = 0): ReviewGrade {
  if (result === 'wrong') return 1;
  if (result === 'close') return 2;
  if (TYPED.includes(kind)) {
    const allowance = 250 * length;
    if (ms <= 2500 + allowance) return 4;
    if (ms > 15000 + allowance) return 2;
    return 3;
  }
  return ms > 10000 ? 2 : 3;
}

/** The current question, built on first use so it stays put across re-renders. */
export function ensureReviewQuestion(state: ReviewState, entries: NotebookEntry[], opts: QuestionOptions = {}): ReviewQuestion | null {
  if (!state.started || state.index >= state.queue.length) return null;
  const id = state.queue[state.index];
  if (state.question && state.question.id === id) return state.question;
  const entry = entries.find((e) => e.id === id);
  if (!entry) {
    // Deleted meanwhile: skip it.
    state.queue.splice(state.index, 1);
    return ensureReviewQuestion(state, entries, opts);
  }
  const asked = state.seen[id] || 0;
  state.question = buildQuestion(entry, entries, opts, seededRandom(hash(`${id}:${state.seed}:${asked}`)));
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
  const auto = q.kind === 'flash' ? (input.knew ? 3 : 1) : autoGrade(q.kind, result, ms, q.lemma.length);
  state.answer = { choice: input.choice ?? -1, typed: input.typed ?? '', result, auto, grade: auto, overridden: false, ms };
  return state.answer;
}

/** "I knew it" after a miss (Good) or "I didn't know it" after a hit (Again); tapping again undoes it. */
export function overrideReview(state: ReviewState): void {
  const a = state.answer;
  if (!a) return;
  if (a.overridden) {
    a.grade = a.auto;
    a.overridden = false;
  } else {
    a.grade = a.result === 'wrong' ? 3 : 1;
    a.overridden = true;
  }
}

/**
 * Moves past the answered question. `updated` is the word as saved; when it is due again within
 * the learn-ahead window it goes back in the queue, up to MAX_ASKS_PER_SESSION asks.
 */
export function advanceReview(state: ReviewState, updated?: NotebookEntry | null, now = Date.now()): void {
  const q = state.question;
  const a = state.answer;
  if (!q || !a) return;
  state.results.push({ id: q.id, lemma: q.lemma, kind: q.kind, result: a.result, grade: a.grade, ms: a.ms });
  const asked = (state.seen[q.id] || 0) + 1;
  state.seen[q.id] = asked;
  const soon = updated?.reviewDue != null ? Number(updated.reviewDue) - now <= LEARN_AHEAD_MS : a.grade === 1;
  if (soon && asked < MAX_ASKS_PER_SESSION) state.queue.push(q.id);
  state.index += 1;
  state.question = null;
  state.answer = null;
  state.revealed = false;
}
