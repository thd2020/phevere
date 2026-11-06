/**
 * The Learn session builder across My words and word books (packages/core/src/wordbooks.ts,
 * review-quiz.ts): one card per word whichever list it is studied from, new words picked from
 * every book as one pool (shared words and family links first), the review load holding new words
 * back, and the round size. The question mix and the lemma rules are in test-review.js.
 *
 * Run: node scripts/test-learn-session.js
 */
const assert = require('assert/strict');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export * from './src/review-quiz';
      export { buildWordsContext, scopeEntries, bookProgress, scopeReviewPlan, scopeReviewQueue, startScopeReview, pickNewBookWords, wordStatus, registerWordbookWords, markKnownInReview } from './src/wordbooks';
    `,
    resolveDir: path.join(root, 'packages', 'core'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  loader: { '.json': 'json' },
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
const core = mod.exports;

const DAY = 86_400_000;
const now = new Date(2026, 10, 4, 9).getTime();
const sub = (bookId, dailyNew) => ({ bookId, dailyNew, active: true, createdAt: 1, updatedAt: 1 });
const started = (lemma, extra = {}) => ({ lemma, known: false, reps: 2, state: 2, stability: 8, lastReview: now - 2 * DAY, reviewDue: now + 6 * DAY, createdAt: now - 9 * DAY, updatedAt: 1, ...extra });

/* One card per word: a word known through My words counts in every book that lists it. */
{
  const mine = [{ id: 'v-ability', lemma: 'ability', definition: 'being able', reps: 5, state: 2, stability: 40, lastReview: now - DAY, reviewDue: now + 30 * DAY, createdAt: now - 60 * DAY }];
  const books = new Map([
    ['cet4', ['ability', 'able', 'abroad']],
    ['kaoyan', ['abroad', 'ability', 'absence']],
  ]);
  const ctx = core.buildWordsContext(mine, [started('abroad')], [sub('cet4', 5), sub('kaoyan', 5)], books);
  const a = core.bookProgress('cet4', ctx, now);
  const b = core.bookProgress('kaoyan', ctx, now);
  assert.equal(a.known, 1, 'ability known in CET-4 through My words');
  assert.equal(b.known, 1, 'and in 考研');
  assert.equal(a.learning, 1, 'abroad, started from one book, is learning in both');
  assert.equal(b.learning, 1);
  // The same word appears once in All books, as its My words row.
  const all = core.scopeEntries('all', ctx);
  assert.equal(all.filter((e) => e.lemma === 'ability').length, 1);
  assert.equal(all.find((e) => e.lemma === 'ability').id, 'v-ability');
  // A reviewed word due today is asked once, whichever books list it.
  const due = core.buildWordsContext(mine, [started('abroad', { reviewDue: now - 1000 })], [sub('cet4', 5), sub('kaoyan', 5)], books);
  const ids = core.scopeReviewQueue('all', due, { now, mineGoal: 0 });
  assert.equal(ids.filter((id) => id === 'wb:abroad').length, 1);
}

/* New words from one pool: words more of your books list, and families you started, come first. */
{
  const books = new Map([
    ['ngsl', ['apple', 'banana', 'cherry', 'damson', 'elder', 'fig', 'nationality', 'grape']],
    ['cet6', ['grape', 'hazel']],
  ]);
  const mine = [{ id: 'v-nation', lemma: 'nation', definition: 'a country', reps: 2, state: 2, stability: 5, lastReview: now - DAY, reviewDue: now + 4 * DAY, createdAt: now - 20 * DAY }];
  const ctx = core.buildWordsContext(mine, [], [sub('ngsl', 3), sub('cet6', 1)], books);
  const why = new Map();
  const picked = core.pickNewBookWords(['ngsl'], ctx, now, 0, why).map((e) => e.lemma);
  assert.equal(picked.length, 3, 'the book goal sets how many');
  // Book order would give apple, banana, cherry: a family you started moves a word a little forward.
  assert.deepEqual(picked, ['apple', 'banana', 'nationality']);
  assert.equal(why.get('wb:nationality').family, 'nation');
  // All books: one pool, the goals added up, no word twice.
  const plan = core.scopeReviewPlan('all', ctx, { now, mineGoal: 0 });
  assert.equal(plan.fresh, 4);
  assert.equal(new Set(plan.ids).size, plan.ids.length);
  assert.ok(plan.ids.includes('wb:hazel') || plan.ids.includes('wb:grape'));
}

/* A book's own level first: words a lower-level book already teaches wait until the level words run out. */
{
  core.registerWordbookWords('starter', ['state', 'might', 'part', 'system']);
  core.registerWordbookWords('zhongkao', ['fact', 'against']);
  core.registerWordbookWords('gaokao', []);
  const kaoyan = ['state', 'might', 'part', 'against', 'abandon', 'system', 'fact', 'abrupt', 'abstract', 'absurd'];
  const ctx = core.buildWordsContext([], [], [sub('kaoyan', 3)], new Map([['kaoyan', kaoyan]]));
  const picked = core.pickNewBookWords(['kaoyan'], ctx, now).map((e) => e.lemma);
  assert.deepEqual(picked, ['abandon', 'abrupt', 'abstract'], `level words first: ${picked}`);
  // Once the level words are started, the lower-level ones follow in book order.
  const done = ['abandon', 'abrupt', 'abstract', 'absurd'].map((w) => started(w));
  const ctx2 = core.buildWordsContext([], done, [sub('kaoyan', 3)], new Map([['kaoyan', kaoyan]]));
  assert.deepEqual(core.pickNewBookWords(['kaoyan'], ctx2, now).map((e) => e.lemma), ['state', 'might', 'part']);
}

/* Many reviews due hold new words back, in books as in My words; a round takes twenty words. */
{
  const words = Array.from({ length: 80 }, (_, i) => `w${String(i).padStart(2, '0')}word`);
  const progress = words.slice(0, 60).map((w, i) => started(w, { reviewDue: now - (i + 1) * 1000 }));
  const ctx = core.buildWordsContext([], progress, [sub('ngsl', 10)], new Map([['ngsl', words]]));
  const plan = core.scopeReviewPlan('ngsl', ctx, { now });
  assert.equal(plan.due, 60);
  assert.equal(plan.fresh, 8, 'sixty due reviews leave eight of ten new words');
  assert.equal(plan.heldBack, 2);
  const state = core.startScopeReview('ngsl', ctx, { now });
  assert.equal(state.queue.length, core.ROUND_WORDS);
  assert.equal(state.rest, 68 - core.ROUND_WORDS);
  assert.equal(state.heldBack, 2);
}

/* With the learner's pace, today's new words fit beside the reviews, shared between My words and the books by goal. */
{
  const words = Array.from({ length: 80 }, (_, i) => `p${String(i).padStart(2, '0')}word`);
  const mine = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, lemma: `mine${String(i).padStart(2, '0')}word`, definition: 'a word', reps: 0, createdAt: now - DAY - i }));
  const pace = { answersPerDay: 60, accuracy: 0.9, firstDayAnswers: 3, reviewsPerNew: 7.5, suggested: 6, days: 10 };
  const light = core.buildWordsContext(mine, words.slice(0, 5).map((w, i) => started(w, { reviewDue: now - (i + 1) * 1000 })), [sub('ngsl', 10)], new Map([['ngsl', words]]));
  const lp = core.scopeReviewPlan('all', light, { now, mineGoal: 10, pace });
  assert.equal(lp.fresh, 20, 'a light day gives both goals in full');
  const heavy = core.buildWordsContext(mine, words.slice(0, 40).map((w, i) => started(w, { reviewDue: now - (i + 1) * 1000 })), [sub('ngsl', 10)], new Map([['ngsl', words]]));
  const hp = core.scopeReviewPlan('all', heavy, { now, mineGoal: 10, pace });
  // 60 answers a day less 40 reviews (48 answers), a fifth to spare: 14 answers, four new words at three answers each.
  assert.equal(hp.fresh, 4, `a heavy day gives fewer: ${hp.fresh}`);
  assert.equal(hp.ids.filter((id) => id.startsWith('m')).length, 2, 'shared by goal: half from My words');
  assert.equal(hp.heldForToday, 16, 'the pace holds them for tomorrow');
  assert.equal(hp.heldBack, 0, 'the reviews alone would not');
  // Only words that exist wait: My words with no new word holds nothing back.
  const none = core.buildWordsContext([], words.slice(0, 5).map((w) => started(w, { reviewDue: now - 1000 })), [], new Map());
  assert.equal(core.scopeReviewPlan('mine', none, { now, mineGoal: 10, pace }).heldBack, 0);
}

/* Saved sentences and symbols stay in My words but never take a new-word slot or a review, in any scope. */
{
  const mine = [
    { id: 'v-psi', lemma: '𝜓', partOfSpeech: 'symbol', definition: 'A wavefunction.', reps: 0, createdAt: now - 3 * DAY },
    { id: 'v-line', lemma: '曹雪芹写贵重物品:金丝ハ宝攒珠', partOfSpeech: 'sentence', definition: 'Translation from JA to ZH', reps: 0, createdAt: now - 2 * DAY },
    { id: 'v-lil', lemma: 'LIL', partOfSpeech: 'symbol', definition: 'ISO 639-3 language code for Lillooet.', reps: 3, state: 2, stability: 5, lastReview: now - 5 * DAY, reviewDue: now - DAY, createdAt: now - 9 * DAY },
    { id: 'v-pm', lemma: 'papier-mâché', partOfSpeech: 'noun', definition: 'Torn-up paper mixed with paste.', reps: 0, createdAt: now - DAY },
  ];
  const ctx = core.buildWordsContext(mine, [], [sub('ngsl', 1)], new Map([['ngsl', ['apple']]]));
  assert.equal(core.scopeEntries('mine', ctx).length, 4, 'My words still lists every entry');
  for (const scope of ['mine', 'all']) {
    const plan = core.scopeReviewPlan(scope, ctx, { now, mineGoal: 10 });
    assert.ok(!plan.ids.some((id) => ['v-psi', 'v-line', 'v-lil'].includes(id)), `${scope}: ${plan.ids}`);
    assert.equal(plan.due, 0, `${scope}: the due symbol is not a review`);
  }
  assert.deepEqual(core.scopeReviewPlan('mine', ctx, { now, mineGoal: 10 }).ids, ['v-pm']);
  assert.deepEqual(core.scopeReviewPlan('all', ctx, { now, mineGoal: 10 }).ids.sort(), ['v-pm', 'wb:apple']);
}

/* "Already know it" on a saved new word keeps it out of today's new words. */
{
  const mine = [
    { id: 'v1', lemma: 'serene', definition: 'calm', reps: 0, createdAt: now - DAY },
    { id: 'v2', lemma: 'placid', definition: 'calm too', reps: 0, createdAt: now - 2 * DAY },
  ];
  const ctx = core.buildWordsContext(mine, [{ lemma: 'placid', known: true, updatedAt: 1 }], [], new Map());
  assert.deepEqual(core.scopeReviewQueue('mine', ctx, { now, mineGoal: 10 }), ['v1']);
}

/* "Already know it" in a round is remembered for the summary's Undo. */
{
  const state = { queue: ['wb:a', 'wb:b'], index: 0, started: true, question: null, answer: null, revealed: false, results: [], seen: {}, seed: 1 };
  core.markKnownInReview(state, 'alpha');
  assert.deepEqual(state.knownMarked, ['alpha']);
  assert.deepEqual(state.queue, ['wb:b']);
}

// Past today's plan: more new words in saved order, and started words before they are due.
{
  const now = Date.UTC(2026, 10, 7, 9);
  const w = (id, extra) => ({ id, lemma: id, definition: 'a meaning', partOfSpeech: 'noun', createdAt: now - 10 * DAY, ...extra });
  const started = (due) => ({ reps: 2, state: 2, lastReview: now - DAY, reviewDue: due });
  const all = [
    w('newer', { createdAt: now - DAY }),
    w('older'),
    w('known', { known: true }),
    w('later', started(now + 5 * DAY)),
    w('soon', started(now + 2 * DAY)),
    w('today', started(now + 60_000)),
  ];
  assert.deepEqual(core.extraRoundIds(all, 'new', now, 1), ['older'], 'oldest saved new word first, count respected');
  assert.deepEqual(core.extraRoundIds(all, 'ahead', now), ['soon', 'later'], 'not due today, soonest first; words due today and known words stay out');
  const state = core.startExtraRound(all, 'new', now, 5);
  assert.equal(state.started, true);
  assert.deepEqual(state.queue, ['older', 'newer']);
}

console.log('test-learn-session: ok');
