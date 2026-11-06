/**
 * Quiz review and FSRS scheduling (packages/core/src/review-quiz.ts, review-schedule.ts,
 * notebook-review.ts): the queue, which question a word gets, wrong options, answer checking and
 * grading, the session flow, the FSRS update, the column migration and sync of the new fields.
 *
 * Run: node scripts/test-review.js
 */
const assert = require('assert/strict');
const path = require('path');
const esbuild = require('esbuild');
const initSqlJs = require('sql.js');

const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export * from './src/review-quiz';
      export * from './src/review-schedule';
      export { reviewHtml, MARK_MS } from './src/notebook-review';
      export { configureCore } from './src/runtime';
      export { addVocab, listVocab, getVocab, reviewVocab, updateVocabNote } from './src/vocab-store';
      export { syncVocab } from './src/vocab-sync';
      export { listAnswerHistory, replaySchedule, historyByWord, skillMastery, skillFor, localLemma, recordLemmaAliases } from './src/answer-history';
      export { reviewBookWord, setBookWordKnown, listBookProgress, rebuildWordSchedule, subscribeWordbook, listWordbookSubs } from './src/wordbook-store';
      export { syncProgress } from './src/progress-sync';
      export { syncWordbooks } from './src/wordbook-sync';
      export { syncProgressForAccount } from './src/account';
      export { HolarkyAccountError } from './src/holarky-account';
      export { VOCAB_SCHEMA_SQL, vocabColumnMigrations } from './src/schema';
    `,
    resolveDir: path.join(root, 'packages', 'core'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;

function loadCore() {
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
  return mod.exports;
}

const core = loadCore();
const DAY = 86_400_000;
const MIN = 60_000;
const now = new Date(2026, 10, 3, 10, 0, 0).getTime();

/* ------------------------------------------------------------------ queue */
{
  const words = [
    { id: 'due1', lemma: 'a', reps: 3, state: 2, stability: 5, reviewDue: now - 2 * DAY, createdAt: now - 30 * DAY },
    { id: 'due2', lemma: 'b', reps: 3, state: 2, stability: 5, reviewDue: now - DAY, createdAt: now - 30 * DAY },
    { id: 'later', lemma: 'c', reps: 3, state: 2, stability: 9, reviewDue: now + 3 * DAY, createdAt: now - 30 * DAY },
    // Saved by addVocab: due time equals save time, never reviewed.
    { id: 'new1', lemma: 'd', reps: 0, reviewDue: now - 5 * DAY, createdAt: now - 5 * DAY },
    { id: 'new2', lemma: 'e', reps: 0, reviewDue: now - 4 * DAY, createdAt: now - 4 * DAY },
    { id: 'new3', lemma: 'f', reps: 0, createdAt: now - 3 * DAY },
  ];
  const q = core.reviewQueue(words, 2, now);
  assert.deepEqual(q, ['due1', 'new1', 'due2', 'new2'], 'due words oldest first, new words spread among them, goal respected');
  assert.deepEqual(core.reviewQueue(words, 2, now, 2), ['due1', 'due2'], 'new words started today count against the goal');
  assert.ok(!q.includes('later'));
  // An SM-2 "Again" left reps at 0 with the due time after the save time: still a review.
  assert.equal(core.isNewWord({ reps: 0, reviewDue: now, createdAt: now - DAY }), false);
  assert.equal(core.isNewWord({ reps: 0, reviewDue: now - DAY, createdAt: now - DAY }), true);
}

/* -------------------------------------------------------------- strength */
{
  assert.equal(core.memoryLevel({ reps: 0, createdAt: now }), 0);
  assert.equal(core.memoryLevel({ reps: 1, state: 1, stability: 3 }), 1, 'learning');
  assert.equal(core.memoryLevel({ reps: 5, state: 3, stability: 30 }), 1, 'relearning after a lapse');
  assert.equal(core.memoryLevel({ reps: 3, state: 2, stability: 2 }), 1);
  assert.equal(core.memoryLevel({ reps: 3, state: 2, stability: 10 }), 2);
  assert.equal(core.memoryLevel({ reps: 6, state: 2, stability: 40 }), 3);
  assert.equal(core.memoryLevel({ reps: 4, reviewInterval: 25, reviewDue: now, createdAt: now - 90 * DAY }), 3, 'SM-2 rows use the interval');
}

/* ----------------------------------------------------- text helpers, typing */
{
  assert.equal(core.maskWord('the act of ignoring something; ignored', 'ignore'), 'the act of … something; …');
  assert.equal(core.maskWord('running quickly, a runway', 'run'), '… quickly, a runway');
  assert.equal(core.maskWord('more happy; happiest of all', 'happy'), 'more …; … of all');
  assert.deepEqual(core.clozeFrom({ lemma: 'ignore', note: 'Short. She ignored the warning signs completely.' }), {
    sentence: 'She _____ the warning signs completely.',
    form: 'ignored',
  });
  assert.equal(core.clozeFrom({ lemma: 'ignore', note: 'ignore this' }), null, 'too short to be a sentence');
  assert.equal(core.checkTyped('Serendipity', ['serendipity']), 'right');
  // Duolingo's typo rule: one letter missing, extra, replaced or swapped with its neighbour, and
  // the slip must not spell another word.
  assert.equal(core.checkTyped('serendiptiy', ['serendipity']), 'typo', 'one swap');
  for (const t of ['strt', 'stert', 'strart', 'satrt']) assert.equal(core.checkTyped(t, ['start']), 'typo', t);
  assert.equal(core.checkTyped('stret', ['start']), 'wrong', 'two slips');
  assert.equal(core.checkTyped('starts', ['start']), 'wrong', 'another form of the word');
  assert.equal(core.checkTyped('used', ['use']), 'wrong', 'another form of the word');
  core.registerListedWords(['star', 'smart', 'he', 'cat']);
  assert.equal(core.checkTyped('star', ['start']), 'wrong', 'a slip that spells a listed word');
  assert.equal(core.checkTyped('smart', ['start']), 'wrong');
  assert.equal(core.checkTyped('te', ['the']), 'typo', 'a three-letter word still gets one slip');
  assert.equal(core.checkTyped('he', ['the']), 'wrong', '"he" is a word');
  assert.equal(core.checkTyped('cat', ['cot']), 'wrong', '"cat" is a word');
  assert.equal(core.checkTyped('og', ['of']), 'wrong', 'no slip in a word under three letters');
  assert.equal(core.checkTyped('lok aftr', ['look after']), 'typo', 'one slip in each word of a phrase');
  assert.equal(core.checkTyped('lok afer', ['look after']), 'typo');
  assert.equal(core.checkTyped('look', ['look after']), 'wrong', 'a missing word is not a typo');
  const marks = (t, a) => (core.typoMarks(t, a) || []).map((p) => (p.slip ? `[${p.text}]` : p.text)).join('');
  assert.equal(marks('harbuor', 'harbour'), 'harb[ou]r', 'a swap marks both letters');
  assert.equal(marks('harbur', 'harbour'), 'harb[o]ur', 'a missing letter is marked');
  assert.equal(marks('harbeur', 'harbour'), 'harb[o]ur', 'a replaced letter is marked');
  assert.equal(marks('harbiour', 'harbour'), 'har[b]our', 'an extra letter marks the one it followed');
  assert.equal(marks('lok aftr', 'look after'), 'lo[o]k aft[e]r');
  assert.equal(core.typoMarks('stret', 'start'), null);
  assert.equal(core.checkTyped('to abandon', ['abandon']), 'right');
  assert.equal(core.checkTyped('cafe', ['café']), 'right');
  assert.equal(core.checkTyped('', ['x']), 'wrong');
  assert.equal(core.editDistance('kitten', 'sitting'), 3);
}

/* ---------------------------------------------------------------- grading */
{
  assert.equal(core.autoGrade('meaning-choice', 'wrong', 1000), 1);
  assert.equal(core.autoGrade('meaning-choice', 'right', 3000), 3);
  assert.equal(core.autoGrade('meaning-choice', 'right', 12000), 2, 'slow recognition is Hard');
  assert.equal(core.autoGrade('word-choice', 'right', 500), 3, 'recognition never earns Easy');
  assert.equal(core.autoGrade('recall', 'right', 3500, 8), 4, 'quick recall is Easy');
  assert.equal(core.autoGrade('recall', 'right', 9000, 8), 3);
  assert.equal(core.autoGrade('recall', 'right', 20000, 8), 2);
  assert.equal(core.autoGrade('recall', 'typo', 2000, 8), 3, 'a quick typo is Good, never Easy');
  assert.equal(core.autoGrade('recall', 'typo', 20000, 8), 2, 'a slow typo is Hard');
  assert.equal(core.autoGrade('recall', 'typo', 2000, 8, { hintShare: 0.2 }), 2, 'hints still lower a typo');
  assert.equal(core.autoGrade('recall', 'typo', 2000, 8, { hintShare: 0.5 }), 1);
  assert.equal(core.autoGrade('cloze', 'wrong', 2000, 8), 1);
}

/* ------------------------------------------------- distractors, questions */
const pool = [
  { id: 't', lemma: 'abandon', partOfSpeech: 'verb', sourceLang: 'en', definition: 'to leave behind for good', reps: 0, createdAt: now },
  { id: 'v1', lemma: 'abolish', partOfSpeech: 'verb', sourceLang: 'en', definition: 'to end a law or system officially' },
  { id: 'v2', lemma: 'absorb', partOfSpeech: 'verb', sourceLang: 'en', definition: 'to take in a liquid' },
  { id: 'v3', lemma: 'accuse', partOfSpeech: 'verb', sourceLang: 'en', definition: 'to say someone did wrong' },
  { id: 'n1', lemma: 'harbour', partOfSpeech: 'noun', sourceLang: 'en', definition: 'a sheltered place for ships' },
  { id: 'n2', lemma: 'lantern', partOfSpeech: 'noun', sourceLang: 'en', definition: 'a lamp with a case' },
  { id: 'dup', lemma: 'desert', partOfSpeech: 'verb', sourceLang: 'en', definition: 'to leave behind for good' },
  { id: 'self', lemma: 'abandons', partOfSpeech: 'verb', sourceLang: 'en', definition: 'third person of abandon' },
  { id: 'zh', lemma: '放弃', partOfSpeech: 'verb', sourceLang: 'zh', definition: 'to give up' },
];
{
  const rand = core.seededRandom(7);
  const lures = core.pickDistractors(pool[0], pool, 'meaning', 3, rand);
  assert.equal(lures.length, 3);
  const ids = lures.map((e) => e.id);
  assert.ok(ids.every((id) => ['v1', 'v2', 'v3'].includes(id)), `same part of speech first: ${ids}`);
  assert.ok(!ids.includes('dup'), 'no option with the same meaning');
  assert.ok(!ids.includes('self'), 'no option that names the word');
  assert.ok(!ids.includes('zh'), 'no option in another script');
  const words = core.pickDistractors(pool[0], pool, 'word', 3, core.seededRandom(3)).map((e) => e.lemma);
  assert.ok(!words.includes('abandon') && !words.includes('放弃'));

  const q0 = core.buildQuestion(pool[0], pool, { audio: true, now }, core.seededRandom(1));
  assert.equal(q0.kind, 'meaning-choice', 'a new word starts with recognising its meaning');
  assert.equal(q0.options.length, 4);
  assert.equal(q0.options[q0.correct], 'to leave behind for good');
  assert.equal(new Set(q0.options).size, 4);

  const learning = { ...pool[0], reps: 2, state: 1, stability: 2, lastReview: now - DAY };
  const kinds1 = new Set();
  for (let s = 0; s < 30; s++) kinds1.add(core.buildQuestion(learning, pool, { audio: true, now }, core.seededRandom(s)).kind);
  assert.ok(kinds1.has('word-choice'), 'a learning word recalls the word from four');
  assert.ok([...kinds1].every((k) => ['word-choice', 'meaning-choice'].includes(k)), `no listening first thing in a session, and a fresh word is not spelled: ${[...kinds1]}`);
  const heavy = new Array(8).fill('word-choice');
  const kindsHeavy = new Set();
  for (let s = 0; s < 30; s++) kindsHeavy.add(core.buildQuestion(learning, pool, { audio: true, now, asked: heavy }, core.seededRandom(s)).kind);
  assert.ok(kindsHeavy.has('listen-choice'), 'a session full of meaning questions turns to listening');
  assert.ok([...kindsHeavy].every((k) => ['listen-choice', 'recall', 'spell-tiles'].includes(k)), `or to spelling: ${[...kindsHeavy]}`);
  const noAudio = new Set();
  for (let s = 0; s < 30; s++) noAudio.add(core.buildQuestion(learning, pool, { audio: false, now, asked: heavy }, core.seededRandom(s)).kind);
  assert.ok(!noAudio.has('listen-choice'), 'no listening question with sound off');

  const firm = { ...pool[0], reps: 4, state: 2, stability: 10, lastReview: now - 10 * DAY };
  const kinds2 = new Set();
  for (let s = 0; s < 40; s++) kinds2.add(core.buildQuestion(firm, pool, { audio: true, now }, core.seededRandom(s)).kind);
  assert.deepEqual([...kinds2], ['recall'], 'a word held for days is typed; no cloze without a sentence');
  const spelled = new Array(8).fill('recall');
  assert.equal(core.buildQuestion(firm, pool, { audio: true, now, asked: spelled }, core.seededRandom(1)).kind, 'listen-type', 'listening balances a spelling-heavy session');
  // A new word coming back in its first session is recognised again, never spelled: spelling waits for a later day.
  for (const repeat of [1, 2]) {
    for (let s = 0; s < 20; s++) {
      const k = core.buildQuestion(pool[0], pool, { now, repeat, audio: true, asked: new Array(6).fill('meaning-choice') }, core.seededRandom(s)).kind;
      assert.ok(!core.TYPED_KINDS.includes(k), `repeat ${repeat} of a new word asked ${k}`);
    }
  }
  const recall = core.buildQuestion(firm, pool, { audio: false, now }, core.seededRandom(2));
  assert.equal(recall.kind, 'recall');
  assert.equal(recall.hint, 'a');
  assert.equal(recall.prompt, 'to leave behind for good');

  const strong = { ...firm, stability: 60, note: 'They had to abandon the car in the snow.' };
  let cloze = null;
  for (let s = 0; s < 20 && !cloze; s++) {
    const q = core.buildQuestion(strong, pool, { audio: true, now }, core.seededRandom(s));
    assert.ok(core.TYPED_KINDS.includes(q.kind), `a mature word is produced, not recognised: ${q.kind}`);
    if (q.kind === 'cloze') cloze = q;
  }
  assert.ok(cloze, 'a mature word with a sentence gets the gap');
  assert.equal(cloze.prompt, 'They had to _____ the car in the snow.');

  const bare = { id: 'b', lemma: 'zephyr', reps: 0, createdAt: now };
  assert.equal(core.buildQuestion(bare, [bare], { audio: false, now }).kind, 'flash', 'nothing else can be asked');
  assert.equal(core.buildQuestion(bare, [bare, ...pool], { audio: true, now }, core.seededRandom(1)).kind, 'flash', 'a word without senses shows itself first, never forced into listening');
}

/* ------------------------------------------ forms, unusable senses, mix */
{
  // Two forms or spellings of one word are never offered together, and the lemma is the answer.
  assert.ok(core.sameLemma('vicissitude', 'vicissitudes'));
  assert.ok(core.sameLemma('glean', 'gleaned'));
  assert.ok(core.sameLemma('colour', 'color'));
  assert.ok(core.sameLemma('travelled', 'traveled'));
  assert.ok(core.sameLemma('rat', 'ratted') && !core.sameLemma('rat', 'rated'), 'a one-syllable word doubles its consonant');
  // Different words that only look like forms of each other stay apart.
  for (const [a, b] of [
    ['rate', 'rat'], ['huge', 'hug'], ['band', 'ban'], ['forest', 'fore'], ['tower', 'tow'], ['add', 'ad'], ['leader', 'lead'],
    ['recent', 'resent'], ['ascent', 'assent'], ['advice', 'advise'], ['device', 'devise'], ['care', 'car'], ['early', 'ear'],
    ['letter', 'let'], ['corner', 'corn'], ['number', 'numb'], ['award', 'aware'], ['filling', 'filing'],
  ]) assert.ok(!core.sameLemma(a, b), `${a} and ${b} are different words`);
  assert.ok(!core.sameLemma('principal', 'principle'), 'confusable words stay apart');
  assert.ok(!core.sameLemma('ingenious', 'ingenuous'));
  assert.ok(!core.sameLemma('desert', 'dessert'));
  const forms = [
    { id: 'vs', lemma: 'vicissitudes', partOfSpeech: 'noun', sourceLang: 'en', definition: 'regular change or succession from one thing to another; a change in fortunes' },
    { id: 'v', lemma: 'vicissitude', partOfSpeech: 'noun', sourceLang: 'en', definition: 'regular change or succession from one thing to another' },
    { id: 'gd', lemma: 'gleaned', partOfSpeech: 'verb', sourceLang: 'en', definition: 'simple past of glean' },
    { id: 'g', lemma: 'glean', partOfSpeech: 'verb', sourceLang: 'en', definition: 'to collect what is left after a harvest' },
    { id: 'c1', lemma: 'vagary', partOfSpeech: 'noun', sourceLang: 'en', definition: 'an unexpected and inexplicable change' },
    { id: 'c2', lemma: 'citadel', partOfSpeech: 'noun', sourceLang: 'en', definition: 'a fortress on high ground above a city' },
    { id: 'c3', lemma: 'dossier', partOfSpeech: 'noun', sourceLang: 'en', definition: 'a collection of papers about a person' },
    { id: 'c4', lemma: 'prelude', partOfSpeech: 'noun', sourceLang: 'en', definition: 'an action that comes before something more important' },
    { id: 'c5', lemma: 'foliage', partOfSpeech: 'noun', sourceLang: 'en', definition: 'the leaves of a plant' },
  ];
  for (let s = 0; s < 60; s++) {
    for (const target of forms) {
      for (const kind of [{ repeat: 0 }, { repeat: 1 }, { repeat: 1, audio: true, asked: new Array(8).fill('word-choice') }]) {
        const q = core.buildQuestion({ ...target, reps: 0, createdAt: now }, forms, { now, ...kind }, core.seededRandom(s));
        if (!q.optionWords.length) continue;
        for (let i = 0; i < q.optionWords.length; i++) {
          for (let j = i + 1; j < q.optionWords.length; j++) {
            assert.ok(!core.sameLemma(q.optionWords[i], q.optionWords[j]), `${q.kind} for ${target.lemma} offers ${q.optionWords[i]} and ${q.optionWords[j]}`);
          }
        }
      }
    }
  }
  // The word asked is always the word answered and recorded, never another headword.
  const rate = { id: 'wb:rate', lemma: 'rate', partOfSpeech: 'noun', sourceLang: 'en', definition: 'the speed at which something happens', reps: 0, createdAt: now };
  const rat = { id: 'wb:rat', lemma: 'rat', partOfSpeech: 'noun', sourceLang: 'en', definition: 'a rodent larger than a mouse' };
  const rq = core.buildQuestion(rate, [rate, rat, ...forms], { now, repeat: 1 }, core.seededRandom(2));
  assert.equal(rq.lemma, 'rate');
  assert.deepEqual(rq.answers, ['rate']);
  const gq = core.buildQuestion({ ...forms[3], reps: 2, state: 2, stability: 6, createdAt: now }, forms, { now }, core.seededRandom(4));
  assert.equal(gq.lemma, 'glean', 'answered under the word that was asked');
  // Both forms due: one question, when the entries say they are one word (form-of gloss or the same meaning).
  const dueForms = forms.slice(0, 4).map((e, i) => ({ ...e, reps: 2, state: 2, stability: 3, reviewDue: now - (4 - i) * 1000, createdAt: now - 9 * DAY }));
  assert.deepEqual(core.reviewQueue(dueForms, 10, now), ['vs', 'g'], 'one form of each word; the entry with a usable sense is kept');
  // Look-alikes with different meanings both stay.
  const alike = [
    { id: 'a1', lemma: 'lead', definition: 'to guide or conduct', reps: 2, state: 2, stability: 3, reviewDue: now - 2000, createdAt: now - 9 * DAY },
    { id: 'a2', lemma: 'leader', definition: 'one who leads a group', reps: 2, state: 2, stability: 3, reviewDue: now - 1000, createdAt: now - 9 * DAY },
    { id: 'a3', lemma: 'advise', definition: 'to give advice to', reps: 2, state: 2, stability: 3, reviewDue: now - 900, createdAt: now - 9 * DAY },
    { id: 'a4', lemma: 'advice', definition: 'an opinion about what to do', reps: 2, state: 2, stability: 3, reviewDue: now - 800, createdAt: now - 9 * DAY },
  ];
  assert.deepEqual(core.reviewQueue(alike, 10, now), ['a1', 'a2', 'a3', 'a4']);
  // Book words are never folded together, and a pass over a whole book is fast.
  const book = require(path.join(root, 'packages', 'core', 'wordbooks', 'kaoyan.json')).words.map((w) => ({ id: `wb:${w}`, lemma: w, reps: 0 }));
  const t0 = Date.now();
  assert.equal(core.dedupeLemmas(book).length, book.length, 'every kaoyan headword kept');
  assert.ok(Date.now() - t0 < 600, `one pass over kaoyan took ${Date.now() - t0} ms`);

  // Citations instead of a sense: no meaning to ask, so the word is skipped (or only heard).
  const idio = {
    id: 'idio',
    lemma: 'idiosyncracy',
    sourceLang: 'en',
    reps: 0,
    createdAt: now,
    definition:
      '↑ “ idiosyncracy ”, in Dictionary.com Unabridged , Dictionary.com, LLC , 1995–present.\n↑ “idiosyncracy”, in The American Heritage Dictionary of the English Language , 4th edition, Boston, Mass. : Houghton Mifflin , 2000 , →ISBN .',
  };
  assert.equal(core.questionMeaning(idio), '');
  assert.equal(core.canAsk(idio, { audio: false }), false);
  assert.equal(core.canAsk(idio, { audio: true }), false, 'not pushed into listening for want of a meaning');
  const real = { id: 'idio2', lemma: 'idiosyncrasy', sourceLang: 'en', reps: 0, createdAt: now - 1, definition: 'a behaviour or way of thinking peculiar to a person' };
  const both = core.startReview([idio, real], 10, now);
  both.started = true;
  assert.equal(core.ensureReviewQuestion(both, [idio, real, ...forms], { audio: true, now }).id, 'idio2', 'the entry with nothing usable is skipped');
  const skip = core.startReview([idio, forms[4]], 10, now);
  skip.started = true;
  assert.equal(core.ensureReviewQuestion(skip, [idio, ...forms], { audio: false, now }).id, 'c1', 'a word with nothing usable to ask is skipped');
  assert.equal(core.usableSense('plural of vicissitude', 'vicissitudes'), false);
  assert.equal(core.usableSense('An earthenware container, used for burial. .mw-parser-output .deflabel{font-variant:small-caps}', 'urn'), false, 'Wiktionary style text');
  assert.equal(core.usableSense('A change, especially in one’s life or fortunes.', 'vicissitude'), true);
  // An everyday sense before a dialect one.
  const shed = { lemma: 'shed', definition: '(transitive, UK, dialectal) To part, separate or divide.\n(ambitransitive) To part with, cast off, let fall.\nTo pour; to make flow.' };
  assert.match(core.bestSense(shed), /^\(ambitransitive\)/);

  // The mix of a whole session: listening stays under its cap, the other skills both appear.
  const mixPool = [];
  const lemmas = ['harbour', 'lantern', 'meadow', 'quarry', 'ravine', 'saddle', 'thicket', 'umbrella', 'valley', 'willow', 'anchor', 'beacon', 'canyon', 'dune', 'estuary', 'fjord', 'glacier', 'hamlet', 'isthmus', 'jetty'];
  lemmas.forEach((l, i) =>
    mixPool.push({ id: l, lemma: l, partOfSpeech: 'noun', sourceLang: 'en', definition: `a kind of place number ${i} described here`, reps: 3, state: 2, stability: [1, 2, 6, 12, 30][i % 5], lastReview: now - DAY, reviewDue: now - 1000 * (i + 1), createdAt: now - 30 * DAY }),
  );
  const asked = [];
  for (let i = 0; i < 60; i++) {
    const target = mixPool[i % mixPool.length];
    const q = core.buildQuestion(target, mixPool, { audio: true, now, asked }, core.seededRandom(i));
    asked.push(q.kind);
  }
  const share = (skill) => asked.filter((k) => core.kindSkill(k) === skill).length / asked.length;
  assert.ok(share('listening') <= core.LISTEN_CAP + 1e-9, `listening share ${share('listening')}`);
  assert.ok(share('listening') > 0.05, 'listening still appears');
  assert.ok(share('meaning') > 0.2 && share('spelling') > 0.2, `meaning ${share('meaning')}, spelling ${share('spelling')}`);
  // The user's own run had 21 listening questions out of 44; the same words now get at most a fifth.
  assert.ok(asked.slice(0, 44).filter((k) => core.kindSkill(k) === 'listening').length <= 8);
  assert.ok(asked.slice(0, 4).every((k) => core.kindSkill(k) !== 'listening'), 'no listening in the first four');
  // Words without senses (book words whose lookup failed): plain cards, not listening.
  const bare10 = Array.from({ length: 10 }, (_, i) => ({ id: `wb:b${i}`, lemma: `bareword${String.fromCharCode(97 + i)}`, reps: 0, createdAt: now }));
  const bs = core.startReview(bare10, 10, now);
  bs.started = true;
  const bareKinds = [];
  for (let i = 0; i < 10; i++) {
    const q = core.ensureReviewQuestion(bs, bare10, { audio: true, now });
    if (!q) break;
    bareKinds.push(q.kind);
    core.answerReview(bs, { knew: true }, now + 1000);
    core.advanceReview(bs, { ...bare10[i], reviewDue: now + 3 * DAY }, now + 1000);
  }
  assert.equal(bareKinds.length, 10);
  assert.ok(bareKinds.every((k) => k === 'flash'), `kinds ${bareKinds}`);
}

/* ----------------------------------------------- leeches, rounds, allowance */
{
  const leech = { ...pool[0], reps: 9, state: 2, stability: 30, lapses: 5, lastReview: now - DAY, reviewDue: now - 1000 };
  assert.ok(core.isLeech(leech));
  assert.equal(core.questionStage(leech), 1, 'a leech is asked at the learning stage');
  const lq = core.buildQuestion(leech, pool, { now }, core.seededRandom(1));
  assert.equal(lq.leech, true);
  assert.ok(['word-choice', 'meaning-choice'].includes(lq.kind));
  const lpool = [leech, ...pool.slice(1)];
  const ls = core.startReview([leech], 10, now);
  ls.started = true;
  for (let i = 0; i < 5; i++) {
    if (!core.ensureReviewQuestion(ls, lpool, { now })) break;
    core.answerReview(ls, {}, now);
    core.advanceReview(ls, { ...leech, reviewDue: now + MIN }, now);
  }
  assert.equal(ls.results.length, core.MAX_LEECH_ASKS, 'a leech comes back at most once more in a session');

  assert.equal(core.newWordAllowance(10, 30), 10);
  assert.equal(core.newWordAllowance(10, 50), 10);
  assert.equal(core.newWordAllowance(10, 60), 8);
  assert.equal(core.newWordAllowance(10, 100), 0);
  const many = Array.from({ length: 70 }, (_, i) => ({ id: `d${i}`, lemma: `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x`, reps: 2, state: 2, stability: 3, reviewDue: now - (i + 1) * 1000, createdAt: now - 9 * DAY }));
  const fresh = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, lemma: `fresh${String.fromCharCode(97 + i)}q`, reps: 0, createdAt: now - (i + 1) * DAY }));
  const plan = core.reviewPlan([...many, ...fresh], 10, now);
  assert.equal(plan.due, 70);
  assert.equal(plan.fresh, 6, 'seventy reviews due hold back four of ten new words');
  assert.equal(plan.heldBack, 4);
  const round = core.startReview([...many, ...fresh], 10, now);
  assert.equal(round.queue.length, core.ROUND_WORDS, 'a round has twenty words');
  assert.equal(round.rest, 76 - core.ROUND_WORDS);

  // Too easy: a right answer saved as Easy; tapping again undoes it.
  const easy = core.startReview([pool[0]], 10, now);
  easy.started = true;
  const eq = core.ensureReviewQuestion(easy, pool, { now });
  core.answerReview(easy, { choice: eq.correct }, now + 2000);
  assert.equal(easy.answer.grade, 3);
  core.overrideReview(easy, 'easy');
  assert.equal(easy.answer.grade, 4, 'Too easy');
  core.overrideReview(easy, 'easy');
  assert.equal(easy.answer.grade, 3, 'undo');
  core.overrideReview(easy);
  assert.equal(easy.answer.grade, 1, "I didn't know it");
  core.overrideReview(easy, 'easy');
  assert.equal(easy.answer.grade, 4, 'switching straight to Too easy');
}

/* ---------------------------------------------------------- session flow */
{
  const entries = pool.slice(0, 6);
  const state = core.startReview(entries, 10, now);
  assert.equal(state.started, false);
  state.started = true;
  const q = core.ensureReviewQuestion(state, entries, { audio: false, now });
  assert.ok(q);
  assert.equal(core.ensureReviewQuestion(state, entries, { audio: false, now }), q, 'stable across re-renders');
  const wrong = (q.correct + 1) % q.options.length;
  const a = core.answerReview(state, { choice: wrong }, now + 2000);
  assert.equal(a.result, 'wrong');
  assert.equal(a.grade, 1);
  assert.equal(core.answerReview(state, { choice: q.correct }, now + 3000), null, 'one answer per question');
  core.overrideReview(state);
  assert.equal(state.answer.grade, 3, 'I knew it');
  core.overrideReview(state);
  assert.equal(state.answer.grade, 1, 'undo');
  const before = state.queue.length;
  core.advanceReview(state, { ...entries[0], reviewDue: now + 2 * MIN }, now + 4000);
  assert.equal(state.queue.length, before + 1, 'due again within 20 minutes: back in this session');
  assert.equal(state.index, 1);
  assert.equal(state.results.length, 1);
  assert.equal(state.question, null);

  // A typed answer.
  const typedState = core.startReview([pool[0]], 10, now);
  typedState.started = true;
  typedState.question = core.buildQuestion({ ...pool[0], reps: 4, state: 2, stability: 10 }, pool, { audio: false, now }, core.seededRandom(2));
  const ta = core.answerReview(typedState, { typed: 'Abandon' }, now + 3000);
  assert.equal(ta.result, 'right');
  assert.equal(ta.grade, 4);
  core.overrideReview(typedState);
  assert.equal(typedState.answer.grade, 1, "I didn't know it");
  core.advanceReview(typedState, { ...pool[0], reviewDue: now + 3 * DAY }, now + 4000);
  assert.equal(typedState.queue.length, 1, 'due in days: not repeated');

  // At most three asks per word in one session.
  const loop = core.startReview([pool[0]], 10, now);
  loop.started = true;
  for (let i = 0; i < 5; i++) {
    if (!core.ensureReviewQuestion(loop, pool, { now })) break;
    core.answerReview(loop, {}, now);
    core.advanceReview(loop, { ...pool[0], reviewDue: now + MIN }, now);
  }
  assert.equal(loop.results.length, core.MAX_ASKS_PER_SESSION);
  const html = core.reviewHtml(pool, loop, 10, { now });
  assert.match(html, /Done for today/);
  assert.match(html, /data-act="lookup" data-q="abandon"/, 'missed words open in lookup');
}

/* ------------------------------------------------------- rendered feedback */
{
  const state = core.startReview(pool, 10, now);
  state.started = true;
  core.ensureReviewQuestion(state, pool, { audio: true, now });
  let html = core.reviewHtml(pool, state, 10, { now, audio: true });
  assert.match(html, /data-act="nb-choose" data-choice="3"/);
  assert.match(html, /I don't know/);
  core.answerReview(state, {}, now + 1000);
  html = core.reviewHtml(pool, state, 10, {
    now,
    audio: true,
    preview: (e, g) => core.previewReview(e, g, now),
    formatGap: core.formatReviewGap,
  });
  assert.match(html, /Not quite/);
  assert.match(html, /data-act="lookup" data-q="[^"]+">Open in lookup/);
  assert.match(html, /data-act="nb-override"[^>]*>I knew it/);
  assert.match(html, /data-act="nb-next"/);
  assert.match(html, /<b class="is-g1">Again<\/b> · back in 1 min/);
  // The mark is drawn over the whole question: the stage holds the prompt, the options and the ink.
  const stage = html.slice(html.indexOf('nbv-quiz__stage'), html.indexOf('nbv-quiz__actions'));
  assert.match(stage, /class="nbv-options/);
  assert.match(stage, /class="nbv-ink is-wrong"/);
  assert.match(stage, /class="nbv-wash is-wrong"/);
  assert.equal((stage.match(/nbv-ink__reveal--/g) || []).length, 2, 'a cross is two strokes');
  // A repaint a second later resumes the mark from where it is; after it has played it is gone.
  const later = core.reviewHtml(pool, state, 10, { now: now + 2000, audio: true });
  assert.match(later, /nbv-quiz__stage is-wrong" style="--t:-1000ms"/);
  assert.match(later, /nbv-ink is-wrong/);
  const done = core.reviewHtml(pool, state, 10, { now: now + 1000 + core.MARK_MS, audio: true });
  assert.doesNotMatch(done, /nbv-ink/);
  // A right answer offers "Too easy".
  const right = core.startReview(pool, 10, now);
  right.started = true;
  const rq = core.ensureReviewQuestion(right, pool, { now });
  core.answerReview(right, { choice: rq.correct }, now + 1500);
  const rhtml = core.reviewHtml(pool, right, 10, { now: now + 1600 });
  assert.match(rhtml, /data-mode="easy"[^>]*>Too easy/);
  assert.match(rhtml, /class="nbv-ink is-right"/);
  assert.equal((rhtml.match(/nbv-ink__reveal--/g) || []).length, 1, 'a tick is one stroke');
}

/* ------------------------------------------------------------------- FSRS */
{
  const fresh = { reps: 0, createdAt: now };
  const good = core.scheduleReview(fresh, 3, now);
  assert.equal(good.state, 1, 'learning');
  assert.equal(good.reps, 1);
  assert.equal(good.reviewDue - now, 10 * MIN, 'second learning step');
  assert.ok(good.stability > 1 && good.difficulty >= 1 && good.difficulty <= 10);
  const again = core.scheduleReview(fresh, 1, now);
  assert.equal(again.reviewDue - now, MIN);
  const easy = core.scheduleReview(fresh, 4, now);
  assert.equal(easy.state, 2, 'Easy skips learning');
  assert.ok(easy.reviewInterval >= 7, `easy interval ${easy.reviewInterval}`);

  // Through the learning steps into review.
  const second = core.scheduleReview({ ...fresh, ...good }, 3, now + 10 * MIN);
  assert.equal(second.state, 2);
  assert.ok(second.reviewInterval >= 1);

  // SM-2 rows: stability equals the old interval at 90% retention.
  const mem = core.memoryFromSm2(2.5, 10);
  assert.ok(Math.abs(mem.stability - 10) < 1e-6, `stability ${mem.stability}`);
  assert.ok(mem.difficulty >= 1 && mem.difficulty <= 10);
  assert.ok(core.memoryFromSm2(1.3, 10).difficulty > core.memoryFromSm2(2.8, 10).difficulty, 'lower ease, harder word');
  const legacy = { reps: 4, reviewInterval: 10, ease: 2.5, reviewDue: now, createdAt: now - 60 * DAY };
  const card = core.cardFromEntry(legacy, now);
  assert.equal(card.state, 2);
  assert.ok(Math.abs(card.stability - 10) < 1e-6);
  const up = core.scheduleReview(legacy, 3, now);
  assert.ok(up.reviewInterval > 10, `Good on a ten-day word goes further: ${up.reviewInterval}`);
  assert.equal(up.reps, 5);
  const lapse = core.scheduleReview(legacy, 1, now);
  assert.equal(lapse.state, 3, 'relearning');
  assert.equal(lapse.lapses, 1);
  assert.ok(lapse.reviewDue - now <= 10 * MIN);
  assert.ok(lapse.stability < 10);
  assert.equal(core.formatReviewGap(10 * MIN), '10 min');
  assert.equal(core.formatReviewGap(3 * DAY), '3 days');
  assert.equal(core.formatReviewGap(DAY), '1 day');
}

/* ---------------------------------------------- storage, migration, sync */
function vocabDbOn(db) {
  const vdb = {
    ready: async () => {},
    initError: () => null,
    async queryAll(sql, params = []) {
      const st = db.prepare(sql);
      try {
        st.bind(params);
        const rows = [];
        while (st.step()) rows.push(st.getAsObject());
        return rows;
      } finally {
        st.free();
      }
    },
    async queryOne(sql, params) {
      return (await vdb.queryAll(sql, params))[0] || null;
    },
    async runWrite(sql, params = []) {
      db.run(sql, params);
    },
  };
  return vdb;
}

function columns(db) {
  return db.exec('PRAGMA table_info(vocab)')[0].values.map((r) => r[1]);
}

async function main() {
  const SQL = await initSqlJs();

  // A notebook from before FSRS: the old table, one reviewed word.
  const old = new SQL.Database();
  old.run(`CREATE TABLE vocab (id TEXT PRIMARY KEY, lemma TEXT NOT NULL, reading TEXT, definition TEXT, part_of_speech TEXT,
    source_lang TEXT, target_lang TEXT, sources TEXT, note TEXT, tags TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    review_due INTEGER, review_interval INTEGER DEFAULT 0, ease REAL DEFAULT 2.5, reps INTEGER DEFAULT 0)`);
  old.run(`INSERT INTO vocab (id, lemma, definition, created_at, updated_at, review_due, review_interval, ease, reps)
    VALUES ('w1', 'abandon', 'to leave behind', 1, 2, ?, 10, 2.5, 4)`, [now]);
  for (const stmt of core.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) old.run(stmt);
  const alters = core.vocabColumnMigrations(columns(old));
  assert.equal(alters.length, 8);
  for (const sql of alters) old.run(sql);
  assert.deepEqual(core.vocabColumnMigrations(columns(old)), [], 'second run adds nothing');
  for (const c of ['stability', 'difficulty', 'state', 'lapses', 'last_review', 'learning_steps', 'device', 'context']) assert.ok(columns(old).includes(c), c);
  const kept = old.exec(`SELECT lemma, review_interval, reps FROM vocab WHERE id = 'w1'`)[0].values[0];
  assert.deepEqual(kept, ['abandon', 10, 4], 'existing row untouched');

  // Desktop worker migration: same columns, same idempotence (src/services/local-db-worker.cjs).
  const workerSrc = require('fs').readFileSync(path.join(root, 'src', 'services', 'local-db-worker.cjs'), 'utf8');
  for (const c of ['stability', 'difficulty', 'state', 'lapses', 'last_review', 'learning_steps', 'device', 'context']) {
    assert.ok(workerSrc.includes(`['${c}',`), `worker adds ${c}`);
  }

  // Reviewing on the migrated notebook writes FSRS state.
  core.configureCore({ http: {}, sha256Hex: () => '', vocabDb: vocabDbOn(old), newId: () => `id-${Math.random()}` });
  const reviewed = await core.reviewVocab('w1', 3, now);
  assert.equal(reviewed.state, 2);
  assert.ok(reviewed.stability > 10);
  assert.equal(reviewed.lastReview, now);
  assert.ok(reviewed.reviewInterval > 10);
  assert.ok(reviewed.ease >= 1.3 && reviewed.ease <= 3);

  // Answer history: every graded answer and "Already know it" is recorded, and replaying the
  // history in time order gives exactly the state the live updates wrote.
  {
    const db = new SQL.Database();
    for (const stmt of core.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) db.run(stmt);
    let n = 0;
    core.configureCore({ http: {}, sha256Hex: () => '', vocabDb: vocabDbOn(db), newId: () => `h-${++n}`, deviceName: () => 'TEST-PC' });
    const word = await core.addVocab({ lemma: 'harbour', definition: 'a sheltered port' });
    // A word reviewed under SM-2 before the history existed.
    db.run(`INSERT INTO vocab (id, lemma, definition, created_at, updated_at, review_due, review_interval, ease, reps)
      VALUES ('legacy', 'beacon', 'a signal fire', ?, ?, ?, 12, 2.3, 5)`, [now - 90 * DAY, now - 3 * DAY, now - DAY]);
    const steps = [
      [0, 3, 'meaning-choice', 4200],
      [2 * MIN, 1, 'word-choice', 9000],
      [12 * MIN, 3, 'listen-choice', 3100],
      [1 * DAY, 3, 'word-choice', 2500],
      [4 * DAY, 4, 'recall', 2900],
      [15 * DAY, 2, 'recall', 16000],
      [31 * DAY, 3, 'cloze', 5000],
    ];
    let live;
    for (const [dt, grade, kind, ms] of steps) {
      live = await core.reviewVocab(word.id, grade, now + dt, { kind, correct: grade > 1, ms });
      await core.reviewBookWord('quay', grade, now + dt + 1000, { kind, correct: grade > 1, ms, bookId: 'starter' });
    }
    await core.setBookWordKnown('pier', true, now + 2 * DAY, 'starter');
    const legacyLive = await core.reviewVocab('legacy', 3, now, { kind: 'recall', correct: true, ms: 4000 });
    await core.reviewVocab('legacy', 1, now + 20 * DAY, { kind: 'cloze', correct: false, ms: 7000 });
    const legacyAfter = await core.getVocab('legacy');

    const history = await core.listAnswerHistory();
    assert.equal(history.length, steps.length * 2 + 1 + 2, 'every answer and the known mark recorded');
    const first = history.find((r) => r.lemma === 'harbour');
    assert.equal(first.kind, 'meaning-choice');
    assert.equal(first.skill, 'meaning');
    assert.equal(first.ms, 4200);
    assert.equal(first.device, 'TEST-PC');
    assert.equal(first.wordId, word.id);
    assert.equal(first.prior, null, 'a new word has no prior');
    assert.equal(history.find((r) => r.lemma === 'quay').bookId, 'starter');
    const known = history.find((r) => r.lemma === 'pier');
    assert.equal(known.kind, 'known');
    assert.equal(known.grade, null);
    const legacyFirst = history.find((r) => r.lemma === 'beacon');
    assert.equal(legacyFirst.prior.reps, 5, 'a word started before the history keeps its prior schedule');
    assert.equal(history.filter((r) => r.lemma === 'beacon' && r.prior).length, 1, 'only the first answer carries it');

    const byWord = core.historyByWord(history);
    const FIELDS = ['reviewDue', 'reviewInterval', 'ease', 'reps', 'stability', 'difficulty', 'state', 'lapses', 'lastReview', 'learningSteps'];
    const pick = (o) => Object.fromEntries(FIELDS.map((k) => [k, o[k]]));
    assert.deepEqual(pick(core.replaySchedule(byWord.get('harbour')).schedule), pick(live), 'replay equals the live updates');
    const quayRow = (await core.listBookProgress()).find((p) => p.lemma === 'quay');
    assert.deepEqual(pick(core.replaySchedule(byWord.get('quay')).schedule), pick(quayRow), 'book words too');
    assert.equal(core.replaySchedule(byWord.get('pier')).known, true);
    assert.equal(core.replaySchedule(byWord.get('pier')).schedule, null, 'known does not start a word');
    assert.deepEqual(pick(core.replaySchedule(byWord.get('beacon')).schedule), pick(legacyAfter), 'replay starts from the prior');
    assert.ok(legacyLive.stability > 0);
    // Shuffled input replays the same: order comes from the times, not the input.
    const shuffled = [...byWord.get('harbour')].reverse();
    assert.deepEqual(pick(core.replaySchedule(shuffled).schedule), pick(live));

    // A schedule overwritten (say by an older device) is rebuilt from the history.
    db.run(`UPDATE vocab SET stability = 1, reps = 99, state = 1 WHERE id = ?`, [word.id]);
    db.run(`DELETE FROM book_words WHERE lemma = 'quay'`);
    assert.equal(await core.rebuildWordSchedule('harbour'), true);
    assert.equal(await core.rebuildWordSchedule('quay'), true);
    assert.deepEqual(pick(await core.getVocab(word.id)), pick(live));
    const quayBack = (await core.listBookProgress()).find((p) => p.lemma === 'quay');
    assert.deepEqual(pick(quayBack), pick(quayRow));
    assert.equal(quayBack.createdAt, now + 1000, 'started when first answered');
    assert.equal(await core.rebuildWordSchedule('never-seen'), false);

    // Mastery per skill: two right answers in a row master a skill; a miss halves the score.
    const m = core.skillMastery(history).get('harbour');
    assert.equal(m.meaning.answers, 3);
    assert.equal(m.meaning.score, 0.625, 'right, wrong, right');
    assert.equal(m.meaning.mastered, false);
    assert.equal(m.listening.answers, 1);
    assert.equal(m.listening.mastered, false);
    assert.equal(m.spelling.answers, 3);
    assert.equal(m.spelling.mastered, true, 'three typed answers right');
    assert.equal(core.skillFor('listen-type'), 'listening');
    assert.equal(core.skillFor('cloze'), 'spelling');
    assert.equal(core.skillFor('known'), null);
  }

  // Sync split. A fake Holarky server that behaves like holarky-account PR #4: phevere/vocab and
  // phevere/wordbooks are free and stripped of progress fields on the way in and out;
  // phevere/progress is append-only and answers 402 plus_required without Plus.
  const PROGRESS_FIELDS = ['review_due', 'reviewDue', 'review_interval', 'reviewInterval', 'ease', 'reps', 'stability', 'difficulty', 'state', 'lapses', 'last_review', 'lastReview', 'learning_steps', 'learningSteps'];
  const strip = (data) => {
    if (!data || typeof data !== 'object') return data;
    const out = { ...data };
    for (const f of PROGRESS_FIELDS) delete out[f];
    return out;
  };
  const server = { plus: true, keptUntil: null, ns: new Map(), seq: 0, sent: new Map() };
  const store = (ns) => {
    if (!server.ns.has(ns)) server.ns.set(ns, new Map());
    return server.ns.get(ns);
  };
  function serverSync(ns, cursor, changes) {
    const paid = ns === 'phevere/progress';
    if (paid && !server.plus) throw new core.HolarkyAccountError('plus_required', 402, undefined, { error: 'plus_required', keptUntil: server.keptUntil });
    const records = store(ns);
    server.sent.set(ns, [...(server.sent.get(ns) || []), ...changes]);
    for (const c of changes) {
      const prev = records.get(c.id);
      if (paid && prev && !c.id.startsWith('state:')) continue; // append-only
      if (!paid && prev && c.updatedAt <= prev.updatedAt) continue;
      records.set(c.id, { ...c, data: paid ? c.data : strip(c.data), seq: ++server.seq });
    }
    const out = [...records.values()].filter((r) => r.seq > cursor).sort((a, b) => a.seq - b.seq);
    return { changes: out.map(({ seq: _s, ...r }) => ({ ...r, data: paid ? r.data : strip(r.data) })), cursor: out.length ? out[out.length - 1].seq : cursor, more: false };
  }
  const account = {
    getUser: async () => ({ id: 'u' }),
    sync: async (ns, cursor, changes) => serverSync(ns, cursor, JSON.parse(JSON.stringify(changes))),
    getEntitlements: async () => ({
      plus: { active: server.plus, expiresAt: null, endedAt: null },
      packs: [],
      collections: { 'phevere/progress': { access: server.plus, keptUntil: server.plus ? null : server.keptUntil } },
    }),
  };
  const device = (prefix) => {
    const c = loadCore();
    const db = new SQL.Database();
    for (const stmt of c.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) db.run(stmt);
    let n = 0;
    c.configureCore({ http: {}, sha256Hex: () => '', vocabDb: vocabDbOn(db), newId: () => `${prefix}-${String(++n).padStart(3, '0')}`, deviceName: () => prefix });
    return { c, db };
  };
  const SCHEDULE = ['reviewDue', 'reviewInterval', 'ease', 'reps', 'stability', 'difficulty', 'state', 'lapses', 'lastReview', 'learningSteps'];
  const sched = (e) => Object.fromEntries(SCHEDULE.map((k) => [k, e[k]]));

  const A = device('a');
  const B = device('b');
  const saved = await A.c.addVocab({ lemma: 'lantern', definition: 'a lamp with a case' });
  const t1 = now;
  await A.c.reviewVocab(saved.id, 3, t1, { kind: 'meaning-choice', correct: true, ms: 3000 });
  const afterA = await A.c.reviewVocab(saved.id, 3, t1 + 10 * MIN, { kind: 'word-choice', correct: true, ms: 2500 });
  await A.c.syncVocab(account);
  const sentVocab = server.sent.get('phevere/vocab');
  assert.ok(sentVocab.length >= 1);
  for (const c of sentVocab) for (const f of SCHEDULE) assert.equal(c.data?.[f], undefined, `${f} is not sent in phevere/vocab`);

  // A pulls its own record back stripped (another device edited the note) and keeps its schedule.
  const stored = store('phevere/vocab').get(saved.id);
  serverSync('phevere/vocab', 0, [{ ...stored, updatedAt: stored.updatedAt + 5000, data: { ...stored.data, note: 'seen in a shop window' } }]);
  await A.c.syncVocab(account);
  const back = await A.c.getVocab(saved.id);
  assert.equal(back.note, 'seen in a shop window', 'the word edit arrives');
  assert.deepEqual(sched(back), sched(afterA), 'a stripped record keeps the local schedule');
  // A full re-pull from the start (a reinstall of the sync state) keeps it too.
  A.db.run(`UPDATE sync_state SET value = '0' WHERE key = 'vocab.cursor'`);
  await A.c.syncVocab(account);
  assert.deepEqual(sched(await A.c.getVocab(saved.id)), sched(afterA));

  // B gets the word without progress, as a new word.
  await B.c.syncVocab(account);
  const onB = await B.c.getVocab(saved.id);
  assert.equal(onB.note, 'seen in a shop window');
  assert.ok(!(onB.reps > 0) && onB.stability == null, 'no progress through the free collection');

  // With Plus, the answer history syncs and B rebuilds the same schedule by replay.
  const upA = await A.c.syncProgress(account);
  assert.deepEqual(upA, { status: 'synced', pushed: 2, received: 0, rebuilt: 0 });
  const events = [...store('phevere/progress').values()];
  assert.ok(events.every((e) => e.id.startsWith('ev:') && e.data.questionType && typeof e.data.correct === 'boolean' && e.data.reviewedAt > 0 && e.data.lemma === 'lantern'));
  const downB = await B.c.syncProgress(account);
  assert.equal(downB.status, 'synced');
  assert.equal(downB.received, 2);
  assert.equal(downB.rebuilt, 1);
  assert.deepEqual(sched(await B.c.getVocab(saved.id)), sched(afterA), 'merged history replays to the same state');
  assert.deepEqual(await B.c.syncProgress(account), { status: 'synced', pushed: 0, received: 0, rebuilt: 0 }, 'pulled answers are not sent back');

  // B reviews; A pulls B's answer and both agree.
  const afterB = await B.c.reviewVocab(saved.id, 4, t1 + 2 * DAY, { kind: 'recall', correct: true, ms: 2000 });
  await B.c.syncProgress(account);
  await A.c.syncProgress(account);
  assert.deepEqual(sched(await A.c.getVocab(saved.id)), sched(afterB));

  // A device that still files answers under an old headword ("gleaned", "paparazzi"): the answers
  // land on this device's card for the word, by form or by an alias the fold recorded.
  {
    const D = device('d');
    const C = device('c');
    await D.c.reviewBookWord('gleaned', 3, t1 + 4 * DAY, { kind: 'meaning-choice', correct: true, ms: 3000 });
    await D.c.reviewBookWord('paparazzi', 3, t1 + 4 * DAY, { kind: 'meaning-choice', correct: true, ms: 3000 });
    await D.c.syncProgress(account);
    const glean = await C.c.addVocab({ lemma: 'glean', definition: 'to gather bit by bit' });
    await C.c.recordLemmaAliases([['paparazzi', 'paparazzo']]);
    assert.equal(await C.c.localLemma('Gleaned'), 'glean');
    assert.equal(await C.c.localLemma('paparazzi'), 'paparazzo');
    assert.equal(await C.c.localLemma('lantern'), 'lantern', 'a word not saved here keeps its headword');
    await C.c.syncProgress(account);
    const onC = await C.c.listAnswerHistory();
    assert.ok(onC.some((r) => r.lemma === 'glean') && !onC.some((r) => r.lemma === 'gleaned'), 'filed under glean');
    assert.ok(onC.some((r) => r.lemma === 'paparazzo') && !onC.some((r) => r.lemma === 'paparazzi'), 'filed under paparazzo');
    assert.ok((await C.c.getVocab(glean.id)).reps > 0, 'and replayed onto the glean card');
  }

  // Book words that are not in My words: progress and "Already know it" travel only in the history.
  await B.c.reviewBookWord('ember', 3, t1 + 3 * DAY, { kind: 'meaning-choice', correct: true, ms: 3000, bookId: 'starter' });
  await B.c.setBookWordKnown('flint', true, t1 + 3 * DAY, 'starter');
  await B.c.subscribeWordbook('starter', 20, t1);
  await B.c.syncWordbooks(account);
  assert.ok(server.sent.get('phevere/wordbooks').every((c) => c.id.startsWith('sub:')), 'phevere/wordbooks carries subscriptions only');
  await B.c.syncProgress(account);
  await A.c.syncWordbooks(account);
  await A.c.syncProgress(account);
  assert.equal((await A.c.listWordbookSubs())[0].dailyNew, 20);
  const bookA = new Map((await A.c.listBookProgress()).map((p) => [p.lemma, p]));
  const bookB = new Map((await B.c.listBookProgress()).map((p) => [p.lemma, p]));
  assert.deepEqual(sched(bookA.get('ember')), sched(bookB.get('ember')), 'book-word schedule rebuilt from the history');
  assert.equal(bookA.get('flint').known, true, 'Already know it arrives as an answer');

  // Without Plus the sync reports it, keeps the answers unsent, and sends them once Plus returns.
  server.plus = false;
  server.keptUntil = t1 + 60 * DAY;
  await A.c.reviewVocab(saved.id, 3, t1 + 9 * DAY, { kind: 'cloze', correct: true, ms: 5000 });
  assert.deepEqual(await A.c.syncProgress(account), { status: 'plus_required', keptUntil: t1 + 60 * DAY });
  const plusStates = [];
  assert.equal(await A.c.syncProgressForAccount(account, (p) => plusStates.push(p)), 0);
  assert.deepEqual(plusStates.at(-1), { active: false, keptUntil: t1 + 60 * DAY });
  assert.equal(A.db.exec(`SELECT COUNT(*) FROM answer_history WHERE synced = 0`)[0].values[0][0], 1);
  server.plus = true;
  assert.equal(await A.c.syncProgressForAccount(account, (p) => plusStates.push(p)), 0);
  assert.deepEqual(plusStates.at(-1), { active: true, keptUntil: null });
  assert.equal(A.db.exec(`SELECT COUNT(*) FROM answer_history WHERE synced = 0`)[0].values[0][0], 0, 'sent once Plus is back');

  // The server emptied the collection after a lapse: state:purged makes the device send everything again.
  const before = store('phevere/progress').size;
  store('phevere/progress').clear();
  store('phevere/progress').set('state:purged', { id: 'state:purged', updatedAt: t1 + 70 * DAY, deleted: true, data: null, seq: ++server.seq });
  const resent = await A.c.syncProgress(account);
  assert.equal(resent.status, 'synced');
  assert.equal(store('phevere/progress').size - 1, A.db.exec(`SELECT COUNT(*) FROM answer_history`)[0].values[0][0]);
  assert.ok(before > 0);

  // The same word saved on both devices: A folds B's row into its own, and B, which only had
  // progress on its own row, keeps that progress when the tombstone for it arrives.
  const C = device('c');
  const D = device('d');
  const accountCD = { ...account };
  server.ns.delete('phevere/vocab');
  const onC = await C.c.addVocab({ lemma: 'quill', definition: 'a pen made from a feather' });
  const onD = await D.c.addVocab({ lemma: 'quill', definition: 'a feather pen' });
  for (let i = 0; i < 3; i++) await D.c.reviewVocab(onD.id, 3, t1 + i * DAY, { kind: 'recall', correct: true, ms: 3000 });
  const dSched = sched(await D.c.getVocab(onD.id));
  await D.c.syncVocab(accountCD);
  await C.c.syncVocab(accountCD); // C folds d-001 into c-001 and sends the tombstone.
  assert.ok(onC.id < onD.id);
  await D.c.syncVocab(accountCD);
  const rowsD = D.db.exec(`SELECT id FROM vocab WHERE lemma = 'quill'`)[0].values.map((r) => r[0]);
  assert.deepEqual(rowsD, [onC.id], 'one row left on D');
  assert.deepEqual(sched(await D.c.getVocab(onC.id)), dSched, 'D keeps its progress on the merged row');

  console.log('test-review: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
