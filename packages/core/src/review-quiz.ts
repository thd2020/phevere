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
  /** Missed LEECH_LAPSES times or more. */
  leech?: boolean;
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
 * saved first, up to the daily goal less those started today, fewer when many reviews are due)
 * spread among them. One form of each word only.
 */
export function reviewPlan(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0): QueuePlan {
  const end = dayStart(now) + DAY;
  const dueAll = entries.filter((e) => !isNew(e) && e.reviewDue != null && Number(e.reviewDue) < end).sort((x, y) => Number(x.reviewDue) - Number(y.reviewDue));
  const newAll = entries.filter((e) => isNew(e) && clean(e.lemma)).sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0));
  const kept = new Set(dedupeLemmas([...dueAll, ...newAll]));
  const due = dueAll.filter((e) => kept.has(e));
  const fresh = newAll.filter((e) => kept.has(e));
  const left = Math.max(0, goal - startedToday);
  const taken = fresh.slice(0, Math.min(left, newWordAllowance(goal, due.length)));
  return { ids: interleaveNew(due, taken).map((e) => e.id), due: due.length, fresh: taken.length, heldBack: Math.min(fresh.length, left) - taken.length };
}

/** Today's queue (`reviewPlan` ids). */
export function reviewQueue(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0): string[] {
  return reviewPlan(entries, goal, now, startedToday).ids;
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

export function startReview(entries: NotebookEntry[], goal: number, now = Date.now(), startedToday = 0): ReviewState {
  return reviewStateFor(reviewPlan(entries, goal, now, startedToday), now);
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
 * The exercise ladder (docs/REVIEW.md). Each stage lists the kinds it asks, most fitting first:
 * a new word is recognised, a learning word is recalled from four, a word held for days is typed,
 * and a word held for weeks is typed into a sentence. Listening joins from the learning stage.
 */
export const STAGE_KINDS: Record<number, QuestionKind[]> = {
  0: ['meaning-choice', 'word-choice', 'flash'],
  1: ['word-choice', 'meaning-choice', 'listen-choice', 'recall', 'cloze', 'flash'],
  2: ['recall', 'cloze', 'listen-type', 'word-choice', 'listen-choice', 'meaning-choice', 'flash'],
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

/** Shares of a session each skill aims at; listening also has a hard cap (LISTEN_CAP). */
export const SKILL_TARGET: Record<QuizSkill, number> = { meaning: 0.45, spelling: 0.4, listening: 0.15 };

export function kindSkill(kind: QuestionKind): QuizSkill {
  return KIND_SKILL[kind] || 'meaning';
}

/** Whether one more listening question keeps listening within LISTEN_CAP of the session. */
export function listeningAllowed(asked: QuestionKind[]): boolean {
  const listened = asked.filter((k) => KIND_SKILL[k] === 'listening').length;
  return listened + 1 <= LISTEN_CAP * (asked.length + 1) + 1e-9;
}

/**
 * The stage a word is asked at: its memory level, moved up a step each time it comes back in the
 * same session (a new word is recognised, then recalled from four, then typed), and held at the
 * learning stage while it is a leech.
 */
export function questionStage(e: NotebookEntry, repeat = 0): number {
  const level = memoryLevel(e);
  const stage = Math.max(level, Math.min(repeat, 2));
  return isLeech(e) ? Math.min(stage, 1) : stage;
}

/**
 * Picks the kind for a word: the stage's order, with a kind whose skill the session already leans
 * on costing more and the previous kind costing a little, and listening only within its cap.
 * Listening passes the cap only when nothing else can be asked.
 */
export function chooseKind(stage: number, can: Record<QuestionKind, boolean>, asked: QuestionKind[] = [], rand: () => number = Math.random): QuestionKind {
  const order = STAGE_KINDS[stage] || STAGE_KINDS[0];
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
    // The plain card is the last resort, whatever the balance says.
    const cost = k === 'flash' ? 99 : i * 0.6 + Math.max(0, share(skill) - SKILL_TARGET[skill]) * 4 + (k === last ? 0.5 : 0) + rand() * 0.25;
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

/** Builds the question for one word. `pool` is the whole notebook, for wrong options. */
export function buildQuestion(entry: NotebookEntry, pool: NotebookEntry[], opts: QuestionOptions = {}, rand: () => number = Math.random): ReviewQuestion {
  const now = opts.now ?? Date.now();
  // Always the word that was asked: answers are recorded under it.
  const lemma = clean(entry.lemma);
  const level = memoryLevel(entry);
  const meaning = questionMeaning(entry);
  const hasMeaning = !!meaning && meaning !== '…';
  const cloze = clozeFrom(entry, opts.examples?.(clean(entry.lemma)) || []);
  const meaningLures = hasMeaning ? pickDistractors(entry, pool, 'meaning', 3, rand) : [];
  const wordLures = pickDistractors(entry, pool, 'word', 3, rand);
  const can: Record<QuestionKind, boolean> = {
    'meaning-choice': hasMeaning && meaningLures.length >= 2,
    'word-choice': hasMeaning && wordLures.length >= 2,
    'listen-choice': !!opts.audio && wordLures.length >= 2,
    recall: hasMeaning,
    'listen-type': !!opts.audio,
    cloze: !!cloze,
    flash: hasMeaning || !clean(entry.definition),
  };
  const kind = chooseKind(questionStage(entry, opts.repeat ?? 0), can, opts.asked || [], rand);

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
    shownAt: now,
    leech: isLeech(entry),
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
  } else if (kind === 'recall') {
    base.prompt = meaning;
    base.hint = lemma.charAt(0);
  } else if (kind === 'cloze' && cloze) {
    base.prompt = cloze.sentence;
    base.answers = [...new Set([cloze.form, ...answers])];
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
  if (!entry || !canAsk(entry, opts)) {
    // Deleted meanwhile, or nothing usable to ask (senses that are only citations): skip it.
    state.queue.splice(state.index, 1);
    return ensureReviewQuestion(state, entries, opts);
  }
  const asked = state.seen[id] || 0;
  const kinds = state.results.map((r) => r.kind);
  state.question = buildQuestion(entry, entries, { ...opts, asked: kinds, repeat: asked }, seededRandom(hash(`${id}:${state.seed}:${asked}`)));
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
  state.results.push({ id: q.id, lemma: q.lemma, kind: q.kind, result: a.result, grade: a.grade, ms: a.ms, levelBefore: q.level, levelAfter });
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
