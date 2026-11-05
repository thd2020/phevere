/**
 * Learn adapting to the learner (packages/core/src/review-quiz.ts, learn-adapt.ts,
 * pronounce-once.ts): word stages from FSRS stability, the kind of question chosen from the
 * predicted chance of a right answer, letter cues and Hint, kinds that unlock, the learner model
 * and study pace from the answer history, today's new words varying with the load, prompts never
 * cut short, one voice per press, and simulated learners over many days.
 *
 * Run: node scripts/test-learn-adapt.js
 */
const assert = require('assert/strict');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export * from './src/review-quiz';
      export { scheduleReview, predictedRecall } from './src/review-schedule';
      export * from './src/learn-adapt';
      export * from './src/pronounce-once';
      export { reviewHtml, typedPlaceholder } from './src/notebook-review';
    `,
    resolveDir: path.join(root, 'packages', 'core'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  loader: { '.json': 'json', '.css': 'empty' },
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
const core = mod.exports;

const DAY = 86_400_000;
const now = new Date(2026, 10, 5, 9).getTime();

/* ------------------------------------------------------------------ stages */
{
  assert.equal(core.wordMaturity({ reps: 0, createdAt: now }), 'new');
  assert.equal(core.wordMaturity({ reps: 1, state: 1, stability: 0.4, lastReview: now }), 'learning');
  assert.equal(core.wordMaturity({ reps: 6, state: 3, stability: 30, lapses: 1, lastReview: now }), 'relearning', 'a lapse is relearning whatever the stability');
  assert.equal(core.wordMaturity({ reps: 3, state: 2, stability: 2, lastReview: now }), 'young');
  assert.equal(core.wordMaturity({ reps: 4, state: 2, stability: 20.9, lastReview: now }), 'young');
  assert.equal(core.wordMaturity({ reps: 5, state: 2, stability: 21, lastReview: now }), 'mature', "Anki's 21-day line, on stability");
  assert.equal(core.wordMaturity({ reps: 4, reviewInterval: 30, reviewDue: now, createdAt: now - 90 * DAY }), 'mature', 'SM-2 rows use the interval');
}

/* ------------------------------------------------- prompts are never cut */
{
  const long =
    'A utensil in the shape of an inverted hollow cone terminating in a narrow pipe, for channeling liquids or granular material; typically used when pouring into a container with a small opening.';
  const funnel = { id: 'f', lemma: 'funnel', sourceLang: 'en', definition: `${long}\nA passage or avenue for a fluid or flowing substance.\nThe chimney of a steamship.` };
  const sense = core.bestSense(funnel);
  assert.equal(sense, 'A passage or avenue for a fluid or flowing substance.', 'a long first sense gives way to a shorter real one');
  const only = { id: 'g', lemma: 'funnel', sourceLang: 'en', definition: long };
  assert.equal(core.questionMeaning(only), long, 'with no shorter sense, the long one is shown whole');
  assert.ok(!core.questionMeaning(only).endsWith('…'));
  // The quiz shows it whole too.
  const pool = [only, ...['a', 'b', 'c'].map((x, i) => ({ id: x, lemma: `other${x}`, sourceLang: 'en', definition: `another thing number ${i}` }))];
  const q = core.buildQuestion(only, pool, { now }, core.seededRandom(1));
  assert.ok(q.options.concat(q.prompt).every((t) => !/[^.]…$/.test(t)), 'no option or prompt ends cut off');
}

/* ------------------------------------------------- kinds, cues and hints */
const vocab = (lemma, i, extra = {}) => ({ id: lemma, lemma, partOfSpeech: 'noun', sourceLang: 'en', definition: `the meaning of ${lemma} in plain words number ${i}`, createdAt: now - 60 * DAY, ...extra });
const pool = ['harbour', 'lantern', 'meadow', 'quarry', 'ravine', 'saddle', 'thicket', 'umbrella', 'valley', 'willow'].map((l, i) => vocab(l, i));
{
  // A firm word due today: R about 0.9, typed recall is near the 85% aim.
  const firm = { ...pool[0], reps: 4, state: 2, stability: 10, lastReview: now - 10 * DAY, reviewDue: now };
  const q = core.buildQuestion(firm, pool, { now }, core.seededRandom(2));
  assert.equal(q.kind, 'recall');
  assert.equal(q.reveal, 1);
  assert.equal(q.hint, 'h');
  assert.ok(q.predicted > 0.8 && q.predicted < 0.95, `predicted ${q.predicted}`);
  // The same word overdue: recall is weaker, so it is typed with a second letter shown, or recognised.
  const late = { ...firm, lastReview: now - 70 * DAY };
  const lateKinds = new Set();
  for (let s = 0; s < 30; s++) {
    const lq = core.buildQuestion(late, pool, { now }, core.seededRandom(s));
    lateKinds.add(lq.kind);
    if (lq.kind === 'recall') {
      assert.equal(lq.reveal, 2, 'a weaker word typed gets a second letter');
      assert.equal(lq.hint, 'ha');
    }
  }
  assert.ok(lateKinds.has('recall') && [...lateKinds].every((k) => ['recall', 'word-choice'].includes(k)), `${[...lateKinds]}`);
  // Long forgotten: it steps back to recognition.
  const lost = { ...firm, lastReview: now - 400 * DAY };
  const kinds = new Set();
  for (let s = 0; s < 30; s++) kinds.add(core.buildQuestion(lost, pool, { now }, core.seededRandom(s)).kind);
  assert.ok(kinds.has('word-choice'), `a long-forgotten word steps back to recognition: ${[...kinds]}`);
  // Cues never give away more than a third of a word.
  for (const lemma of ['cat', 'harbour', 'extraordinary']) {
    const n = core.cueLetters('recall', lemma, -3, null);
    assert.ok(n >= 1 && n <= 1 + Math.floor((lemma.length - 2) / 3), `${lemma}: ${n}`);
  }
  assert.equal(core.cueLetters('listen-type', 'harbour', 3, null), 0, 'dictation of a firm word shows no letter');

  // Hint reveals a letter into the box, never the last one, and caps the grade at Hard.
  const state = core.startReview([firm], 10, now);
  state.started = true;
  const asked = core.ensureReviewQuestion(state, [firm, ...pool.slice(1)], { now });
  assert.equal(asked.kind, 'recall');
  assert.equal(core.typedPlaceholder(asked), 'h······');
  assert.ok(core.hintReview(state));
  assert.equal(asked.draft, 'ha');
  assert.equal(core.typedPlaceholder(asked), 'ha·····');
  while (core.hintReview(state));
  assert.equal(asked.draft, 'harbou', 'the last letter stays hidden');
  const html = core.reviewHtml([firm, ...pool.slice(1)], state, 10, { now });
  assert.match(html, /value="harbou"/);
  assert.match(html, /7 letters/);
  assert.doesNotMatch(html, /data-act="nb-hint"/, 'no Hint once only the last letter is hidden');
  const a = core.answerReview(state, { typed: 'harbour' }, now + 2000);
  assert.equal(a.result, 'right');
  assert.equal(a.grade, 2, 'right after a hint is Hard');
  // Hint keeps what the learner typed as far as it matches, and reveals the letter after it.
  const hintAfter = (typed) => {
    const s = core.startReview([firm], 10, now);
    s.started = true;
    const q = core.ensureReviewQuestion(s, [firm, ...pool.slice(1)], { now });
    return { ok: core.hintReview(s, typed), q };
  };
  assert.equal(hintAfter('harb').q.draft, 'harbo', 'four right letters kept, the fifth revealed');
  assert.equal(hintAfter('HARB').q.draft, 'HARBo', 'letter case aside, and as typed');
  assert.equal(hintAfter('hax').q.draft, 'har', 'typing past the first wrong letter is dropped');
  assert.equal(hintAfter('').q.draft, 'ha', 'an empty box gets the letter after the shown one');
  const nearlyDone = hintAfter('harbou');
  assert.equal(nearlyDone.ok, false, 'the last letter is never revealed');
  assert.equal(nearlyDone.q.draft, undefined);
  const kept = hintAfter('harb').q;
  assert.equal(core.typedPlaceholder(kept), 'harbo··');
  assert.equal(core.hintsLeft(kept), 1);
  assert.equal(core.autoGrade('recall', 'right', 2000, 7, { extra: 1 }), 3, 'extra letters up front: at most Good');
  assert.equal(core.autoGrade('recall', 'right', 2000, 7, {}), 4);

  // The stage tag is on every question.
  const tagState = core.startReview([firm], 10, now);
  tagState.started = true;
  assert.match(core.reviewHtml([firm, ...pool.slice(1)], tagState, 10, { now }), /nbv-tag is-young">Young</);
}

/* ---------------------------------------------------------------- unlocks */
{
  const fresh = { offset: {}, right: {} };
  const firm = { ...pool[1], reps: 4, state: 2, stability: 10, lastReview: now - 10 * DAY, reviewDue: now };
  for (let s = 0; s < 20; s++) {
    const k = core.buildQuestion(firm, pool, { now, audio: true, learner: fresh, asked: new Array(6).fill('word-choice') }, core.seededRandom(s)).kind;
    assert.ok(!core.TYPED_KINDS.includes(k), `nothing typed before the learner has recognised words: ${k}`);
  }
  const ready = { offset: {}, right: { 'word-choice': 5, 'listen-choice': 3, recall: 3 } };
  assert.ok(core.kindUnlocked('recall', ready) && core.kindUnlocked('listen-type', ready) && core.kindUnlocked('cloze', ready));
  assert.ok(!core.kindUnlocked('listen-type', { offset: {}, right: { 'listen-choice': 2 } }));
  // Right answers in the session count, so typing opens during the first session.
  const results = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, lemma: 'x', kind: 'word-choice', result: 'right', grade: 3, ms: 3000 }));
  assert.ok(core.kindUnlocked('recall', core.sessionLearner(fresh, results)));
  // Dictation belongs to the later stages and listening by choice to the earlier ones.
  assert.ok(!core.STAGE_KINDS[0].includes('listen-choice') && !core.STAGE_KINDS[3].includes('listen-choice'));
  assert.ok(!core.STAGE_KINDS[1].includes('listen-type') && core.STAGE_KINDS[2].includes('listen-type') && core.STAGE_KINDS[3].includes('listen-type'));
  // A word tagged Young is asked as young, however few days it is held: dictation included.
  const shaky = { ...pool[2], reps: 2, state: 2, stability: 2.5, lastReview: now - 2.5 * DAY, reviewDue: now };
  assert.equal(core.wordMaturity(shaky), 'young');
  assert.equal(core.questionStage(shaky), 2, 'the stage the tag shows');
  const shakyKinds = new Set();
  for (let s = 0; s < 120; s++) {
    const q = core.buildQuestion(shaky, pool, { now, audio: true, learner: ready, asked: s % 2 ? ['recall', 'recall', 'word-choice', 'word-choice'] : [] }, core.seededRandom(s));
    assert.equal(q.maturity, 'young');
    shakyKinds.add(q.kind);
  }
  assert.ok([...shakyKinds].every((k) => core.STAGE_KINDS[2].includes(k)), `young kinds only: ${[...shakyKinds]}`);
  assert.ok(shakyKinds.has('listen-type'), `dictation reachable for a young word held under four days: ${[...shakyKinds]}`);
}

/* ------------------------------------------------- learner model and pace */
const rec = (lemma, kind, correct, answeredAt, grade = correct ? 3 : 1) => ({ id: `${lemma}-${answeredAt}`, lemma, wordId: null, bookId: null, answeredAt, kind, skill: null, correct, ms: 4000, grade, device: null, prior: null });
{
  // Words in review, each due when answered (FSRS recall about 90%): typing is predicted right
  // about nine times in ten and choosing the word almost always.
  const hist = [];
  const due = (lemma, kind, correct, t) => ({ ...rec(lemma, kind, correct, t), prior: { reps: 3, state: 2, stability: 10, difficulty: 5, lastReview: t - 10 * DAY, reviewDue: t, createdAt: t - 40 * DAY } });
  for (let i = 0; i < 40; i++) hist.push(due(`w${i}`, 'recall', i % 10 < 6, now - 3 * DAY + i * 60_000));
  for (let i = 0; i < 40; i++) hist.push(due(`v${i}`, 'word-choice', true, now - 3 * DAY + i * 60_000 + 30_000));
  const m = core.learnerModel(hist, now);
  assert.ok(m.offset.recall < -0.6, `a learner right 60% of the time on typing, against 90% predicted, gets a negative offset: ${m.offset.recall}`);
  assert.ok(m.offset['word-choice'] > 0, `and never missing a choice a positive one: ${m.offset['word-choice']}`);
  assert.equal(m.right['word-choice'], 40);
  assert.equal(m.right.recall, 24);
  assert.ok(core.skillTargets(m).spelling < core.SKILL_TARGET.spelling, 'a weak speller is asked to spell less');
  // The session moves the offsets too.
  const s = core.sessionLearner(m, [{ id: 'a', lemma: 'a', kind: 'recall', result: 'right', grade: 3, ms: 3000, predicted: 0.5 }]);
  assert.ok(s.offset.recall > m.offset.recall);

  assert.equal(core.studyPace(hist, now), null, 'one study day is not a pace');
  // Five days of 100 answers: ten new words a day, each answered 2.5 times on its first day.
  const days = [];
  let n = 0;
  for (let d = 1; d <= 5; d++) {
    const t = now - d * DAY;
    for (let w = 0; w < 10; w++) for (let k = 0; k < 2.5 * 2; k++) if (k < (w % 2 ? 3 : 2)) days.push(rec(`new${d}-${w}`, 'meaning-choice', true, t + n++ * 1000));
    for (let r = 0; days.filter((x) => x.answeredAt >= t && x.answeredAt < t + DAY).length < 100; r++) days.push(rec(`old${r % 60}`, 'recall', r % 10 !== 0, t + n++ * 1000));
  }
  for (let r = 0; r < 60; r++) days.unshift(rec(`old${r}`, 'recall', true, now - 40 * DAY + r * 1000));
  const pace = core.studyPace(days, now);
  assert.equal(pace.days, 5);
  assert.equal(pace.answersPerDay, 100);
  assert.ok(Math.abs(pace.firstDayAnswers - 2.5) < 0.01, `first-day answers ${pace.firstDayAnswers}`);
  assert.ok(Math.abs(pace.accuracy - 0.9) < 0.02, `review accuracy ${pace.accuracy}`);
  assert.equal(pace.suggested, 10, "Anki's ten answers per new word a day");
  const sloppy = core.studyPace(days.map((r) => (r.lemma.startsWith('old') ? { ...r, correct: Number(r.id.length) % 3 !== 0 } : r)), now);
  assert.ok(sloppy.accuracy < 0.8 && sloppy.suggested < pace.suggested, `more misses mean fewer new words: ${sloppy.accuracy} ${sloppy.suggested}`);
  assert.equal(core.suggestGoal(10, pace), null, 'no offer when the goal already fits');
  assert.equal(core.suggestGoal(30, pace), 10);
  assert.equal(core.suggestGoal(9, pace), null, 'small gaps are left alone');

  // Today's new words vary with the load: the full goal on a light day, fewer on a heavy one.
  assert.equal(core.newWordsToday(10, 20, pace), 10);
  assert.ok(core.newWordsToday(10, 70, pace) < 10 && core.newWordsToday(10, 70, pace) > 0);
  assert.equal(core.newWordsToday(10, 120, pace), 0, 'reviews beyond a usual day hold every new word back');
  assert.equal(core.newWordsToday(10, 20, null), 10, 'without a pace, the old rule');
  assert.equal(pace.answersToday, 0, 'nothing answered yet today');
  assert.equal(core.studyPace([...days, rec('today1', 'recall', true, now - 60_000), rec('today2', 'recall', false, now - 30_000)], now).answersToday, 2);

  // The pace is a limit for the day. 60 answers a day, 2.5 for a new word's first day, 10 due:
  // (60 - 12) * 1.2 / 2.5 makes 23 new words, and once they are started and answered, another
  // round plans no new batch; the rest wait for tomorrow.
  const dayPace = { ...pace, answersPerDay: 60, firstDayAnswers: 2.5, answersToday: 0 };
  const dueWords = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, lemma: `due${i}`, definition: 'x', reps: 3, state: 2, stability: 5, lastReview: now - 5 * DAY, reviewDue: now - 1000, createdAt: now - 30 * DAY }));
  const newWords = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, lemma: `fresh${i}`, definition: 'x', reps: 0, createdAt: now - DAY + i }));
  const first = core.reviewPlan([...dueWords, ...newWords], 30, now, 0, dayPace);
  assert.equal(first.fresh, 23);
  assert.equal(first.heldForToday, 7, 'the rest of the goal waits for tomorrow');
  assert.equal(first.heldBack, 0, 'not for the reviews');
  const second = core.reviewPlan(newWords.slice(23), 30, now, 23, { ...dayPace, answersToday: 12 + Math.round(23 * 2.5) });
  assert.equal(second.fresh, 0, 'a second round plans no new batch');
  assert.equal(second.heldForToday, 7);
  assert.match(core.reviewHtml(newWords.slice(23), core.reviewStateFor(second, now), 30, { now }), /Nothing due today/);
  const card = core.reviewHtml([...dueWords, ...newWords], core.reviewStateFor(first, now), 30, { now });
  assert.match(card, /7 new words wait for tomorrow/);
  assert.doesNotMatch(card, /until the reviews are done/);
}

/* ------------------------------------- countdown on choice questions (#37) */
const countdownChecks = async () => {
  const fresh = { ...pool[2], reps: 0, createdAt: now };
  const state = core.startReview([fresh], 10, now);
  state.started = true;
  const q = core.ensureReviewQuestion(state, [fresh, ...pool.slice(3)], { now });
  assert.ok(core.COUNTDOWN_KINDS.includes(q.kind), q.kind);
  assert.equal(core.countdownMs(q, 8), 8000);
  assert.equal(core.countdownMs(q, 0), 0, 'Off');
  assert.equal(core.countdownMs({ ...q, kind: 'recall' }, 8), 0, 'typed questions have no countdown');
  const html = core.reviewHtml([fresh, ...pool.slice(3)], state, 10, { now: now + 3000, learnPrefs: { countdown: 8, speaking: false } });
  assert.match(html, /class="nbv-countdown" role="timer" aria-label="8 seconds to answer" style="--cd:8000ms;--cd-t:-3000ms"/, 'resumes from the question start');
  assert.doesNotMatch(core.reviewHtml([fresh, ...pool.slice(3)], state, 10, { now }), /nbv-countdown/, 'no bar when the countdown is off');
  assert.equal(core.expireCountdown(state, 8, now + 7000), false, 'not yet');
  assert.ok(core.expireCountdown(state, 8, now + 8000));
  assert.equal(state.answer.result, 'wrong');
  assert.equal(state.answer.grade, 1, 'running out counts as not known');
  assert.equal(state.answer.timedOut, true);
  assert.match(core.reviewHtml([fresh, ...pool.slice(3)], state, 10, { now: now + 8100, learnPrefs: { countdown: 8, speaking: false } }), /Time is up/);
  // The timer the shells arm: it answers only the question still on screen.
  const s2 = core.startReview([fresh], 10, Date.now());
  s2.started = true;
  core.ensureReviewQuestion(s2, [fresh, ...pool.slice(3)], { now: Date.now() });
  let painted = 0;
  core.armCountdown(s2, 0.05, () => true, () => (painted += 1));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(painted, 1);
  assert.equal(s2.answer.timedOut, true);
  const s3 = core.startReview([fresh], 10, Date.now());
  s3.started = true;
  core.ensureReviewQuestion(s3, [fresh, ...pool.slice(3)], { now: Date.now() });
  core.armCountdown(s3, 0.05, () => false, () => (painted += 1));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s3.answer, null, 'not answered while Learn is not showing');
  // Time away from the question does not count: back on Learn, the time that was left remains.
  const s4 = core.startReview([fresh], 10, Date.now());
  s4.started = true;
  const q4 = core.ensureReviewQuestion(s4, [fresh, ...pool.slice(3)], { now: Date.now() });
  let onScreen = true;
  core.armCountdown(s4, 0.6, () => onScreen, () => (painted += 1));
  await new Promise((r) => setTimeout(r, 250));
  onScreen = false;
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(s4.answer, null, 'not timed out while away');
  assert.ok(q4.countdownSpent >= 150 && q4.countdownSpent < 450, `time on screen only: ${q4.countdownSpent}`);
  onScreen = true;
  core.armCountdown(s4, 0.6, () => onScreen, () => (painted += 1));
  assert.match(core.reviewHtml([fresh, ...pool.slice(3)], s4, 10, { now: Date.now(), learnPrefs: { countdown: 0.6, speaking: false } }), new RegExp(`--cd-t:-${q4.countdownSpent}ms`), 'the bar resumes where it stood');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s4.answer, null, 'back on screen with time left');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(s4.answer?.timedOut, true, 'and it runs out after the rest of the time');
};

/* ----------------------------------------------------- one voice per press */
(async () => {
  await countdownChecks();
  const log = [];
  let release = null;
  const backend = {
    recordings: (w) => (w === 'slow' ? new Promise((r) => { release = () => r(['clip:slow']); }) : Promise.resolve(w === 'none' ? [] : [`clip:${w}`])),
    playRecording: async (url) => {
      if (url === 'clip:broken') throw new Error('404');
      log.push(url);
    },
    speak: async (w) => log.push(`voice:${w}`),
    stop: () => log.push('stop'),
  };
  const say = core.singleVoice(backend);
  assert.equal(await say('harbour'), 'recording');
  assert.equal(await say('none'), 'speech');
  assert.deepEqual(log.filter((x) => x !== 'stop'), ['clip:harbour', 'voice:none'], 'the recording when there is one, else the voice');
  // A press while an earlier one is still looking up: only the newer word plays, and the older never speaks.
  log.length = 0;
  const first = say('slow');
  const second = say('lantern');
  release();
  assert.equal(await first, 'stale');
  assert.equal(await second, 'recording');
  assert.deepEqual(log.filter((x) => x !== 'stop'), ['clip:lantern']);
  // A clip that cannot load: stopped first, then the voice, so the clip can never follow it.
  log.length = 0;
  const broken = core.singleVoice({ ...backend, recordings: async () => ['clip:broken'] });
  assert.equal(await broken('meadow'), 'speech');
  assert.deepEqual(log, ['stop', 'stop', 'voice:meadow']);

  simulate();
  console.log('test-learn-adapt: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/* ----------------------------------------------------- simulated learners */

/**
 * A learner over 45 days. Their true chance of a right answer is FSRS's recall for the word plus
 * the kind's ease and their own skill, so a weak speller misses typed answers more often than the
 * model expects at first. Each day they answer about `perDay` questions in rounds and stop.
 */
function runLearner({ spelling = 0, listening = 0, perDay = 70, days = 40, words = 420, seed = 7 }) {
  const rand = core.seededRandom(seed);
  const letters = 'bcdfghjklmnprstvz';
  const vowels = 'aeiou';
  const entries = Array.from({ length: words }, (_, i) => {
    let w = '';
    let x = i * 7919 + 13;
    for (let k = 0; k < 3 + (i % 3); k++) {
      w += letters[x % letters.length] + vowels[(x >> 3) % vowels.length];
      x = Math.floor(x / 5) + k * 31;
    }
    return {
      id: `w${i}`,
      lemma: `${w}${i}`.replace(/\d+/, (d) => 'xyq'[d % 3] + letters[d % letters.length]),
      partOfSpeech: 'noun',
      sourceLang: 'en',
      definition: `the plain meaning of item ${i} among the words`,
      note: i % 3 === 0 ? null : undefined,
      reps: 0,
      createdAt: now - 100 * DAY + i,
    };
  });
  // Lemmas must be unique for the quiz to tell words apart.
  const seen = new Set();
  for (const e of entries) {
    while (seen.has(e.lemma)) e.lemma += 'a';
    seen.add(e.lemma);
    if (e.id.endsWith('0')) e.note = `They talked about the ${e.lemma} for a long while yesterday.`;
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  const skill = { meaning: 0.3, spelling, listening };
  const history = [];
  const perWord = new Map();
  const daily = [];
  const asked = [];
  const start = now - days * DAY;
  for (let d = 0; d < days; d++) {
    let t = start + d * DAY;
    const learner = core.learnerModel(history, t);
    const pace = core.studyPace(history, t);
    let answers = 0;
    let started = 0;
    let planned = null;
    while (answers < perDay) {
      const state = core.startReview(entries, 10, t, started, pace);
      if (!planned) planned = { due: state.queue.length, fresh: entries.filter((e) => core.isNewWord(e) && state.queue.includes(e.id)).length };
      if (!state.queue.length) break;
      state.started = true;
      let q;
      while ((q = core.ensureReviewQuestion(state, entries, { audio: true, now: t, learner })) && answers < perDay) {
        const e = byId.get(q.id);
        const wasNew = core.isNewWord(e);
        const maturity = core.wordMaturity(e);
        const r = wasNew ? 0.5 : core.predictedRecall(e, t) ?? 0.5;
        const lg = Math.log(Math.min(0.995, Math.max(0.03, r)) / (1 - Math.min(0.995, Math.max(0.03, r))));
        const typed = core.TYPED_KINDS.includes(q.kind);
        const extra = typed ? Math.max(0, (q.reveal || 0) - (q.kind === 'listen-type' ? 0 : 1)) * core.LETTER_EASE : 0;
        const p = 1 / (1 + Math.exp(-(lg + core.KIND_EASE[q.kind] + skill[core.kindSkill(q.kind)] + extra)));
        const right = rand() < p;
        // A typed answer takes longer than a tap, enough to be Good rather than Easy.
        const ms = typed ? 7000 : 3500;
        if (q.correct >= 0) core.answerReview(state, { choice: right ? q.correct : (q.correct + 1) % q.options.length }, t + ms);
        else if (q.kind === 'flash') core.answerReview(state, { knew: right }, t + ms);
        else core.answerReview(state, { typed: right ? q.answers[0] : 'qqqq' }, t + ms);
        const grade = state.answer.grade;
        t += ms;
        const upd = core.scheduleReview(e, grade, t);
        Object.assign(e, upd);
        history.push(rec(e.lemma.toLowerCase(), q.kind, grade > 1, t, grade));
        const w = perWord.get(e.id) || { kinds: new Set(), typed: 0, maturities: new Set(), firstDay: d };
        w.kinds.add(q.kind);
        w.maturities.add(maturity);
        if (q.kind === 'recall' || q.kind === 'cloze') w.typed += 1;
        perWord.set(e.id, w);
        asked.push({ kind: q.kind, maturity, right: grade > 1, reveal: q.reveal || 0, len: q.answers[0]?.length || 0, day: d });
        if (wasNew) started += 1;
        core.advanceReview(state, e, t);
        t += 2000;
        answers += 1;
      }
      if (state.index < state.queue.length) break;
    }
    daily.push({ day: d, answers, started, due: planned ? planned.due - planned.fresh : 0, fresh: planned ? planned.fresh : 0, pace });
  }
  return { entries, perWord, daily, asked, history };
}

function simulate() {
  const avg = runLearner({ spelling: 0, listening: 0 });
  const weak = runLearner({ spelling: -1.6, listening: -0.5, seed: 11 });
  const strong = runLearner({ spelling: 1.0, listening: 0.5, seed: 13 });

  for (const [name, run] of [['average', avg], ['weak speller', weak], ['strong speller', strong]]) {
    const { entries, perWord, asked } = run;
    if (process.env.LEARN_SIM_DEBUG) {
      const model = core.learnerModel(run.history, now);
      const byKind = {};
      for (const a of asked.filter((x) => x.day >= 10)) {
        const k = `${a.maturity}:${a.kind}`;
        byKind[k] = byKind[k] || [0, 0];
        byKind[k][0] += 1;
        if (a.right) byKind[k][1] += 1;
      }
      console.log(name, JSON.stringify(model.offset), JSON.stringify(core.skillTargets(model)));
      console.log(Object.entries(byKind).sort().map(([k, [n, r]]) => `${k} ${n} ${(r / n).toFixed(2)}`).join('\n'));
    }
    const stages = new Map();
    for (const e of entries) stages.set(core.wordMaturity(e), (stages.get(core.wordMaturity(e)) || 0) + 1);
    // Words pass through every stage, not just new and learned.
    assert.ok(stages.get('mature') > 10 && stages.get('young') > 10 && stages.get('new') > 0, `${name}: stages ${[...stages]}`);
    const startedWords = [...perWord.values()];
    const varied = startedWords.filter((w) => w.kinds.size >= 3).length / startedWords.length;
    assert.ok(varied > 0.5, `${name}: ${Math.round(varied * 100)}% of words met three kinds of question or more`);
    assert.ok(startedWords.filter((w) => w.maturities.size >= 3).length > startedWords.length * 0.4, `${name}: words met at several stages`);
    // Listening by choice only early, dictation only later.
    assert.ok(asked.filter((a) => a.kind === 'listen-choice').every((a) => a.maturity !== 'mature'), `${name}: no listen-choice for a mature word`);
    assert.ok(asked.filter((a) => a.kind === 'listen-type').every((a) => a.maturity === 'young' || a.maturity === 'mature'), `${name}: dictation only for young and mature words`);
    assert.ok(asked.some((a) => a.kind === 'listen-type'), `${name}: dictation happens`);
    const listen = asked.filter((a) => core.kindSkill(a.kind) === 'listening').length / asked.length;
    assert.ok(listen <= core.LISTEN_CAP + 0.01, `${name}: listening ${listen}`);
    // Cues stay within a third of the word.
    assert.ok(asked.every((a) => a.reveal <= 1 + Math.floor(Math.max(0, a.len - 2) / 3)), `${name}: cue letters`);
    // Answers land near the aim, neither trivial nor crushing.
    const late = asked.filter((a) => a.day >= 10);
    const acc = late.filter((a) => a.right).length / late.length;
    assert.ok(acc > 0.72 && acc < 0.96, `${name}: accuracy ${acc.toFixed(3)}`);
    run.acc = acc;
    run.spellShare = late.filter((a) => a.kind === 'recall' || a.kind === 'cloze').length / late.length;
    // Words started in the first fortnight that were never typed in their forty days.
    const early = [...perWord.values()].filter((w) => w.firstDay < 14);
    run.neverTyped = early.filter((w) => !w.typed).length / Math.max(1, early.length);
  }
  // Spelling is asked of some words, less of a weak speller. (A good speller is already typing
  // every word the ladder allows; new and learning words are not typed whoever the learner is.)
  assert.ok(weak.spellShare < avg.spellShare - 0.02 && weak.spellShare < strong.spellShare - 0.02, `spelling share ${weak.spellShare.toFixed(2)}, against ${avg.spellShare.toFixed(2)} and ${strong.spellShare.toFixed(2)}`);
  assert.ok(weak.neverTyped > 0.1, `not every word has to be spelled: ${weak.neverTyped.toFixed(2)} of a weak speller's words never were`);
  // The learner model learns the weak speller: typed answers after a fortnight go right about as often as aimed.
  const weakTyped = weak.asked.filter((a) => a.day >= 14 && (a.kind === 'recall' || a.kind === 'cloze'));
  const weakTypedAcc = weakTyped.filter((a) => a.right).length / Math.max(1, weakTyped.length);
  assert.ok(weakTypedAcc > 0.6, `weak speller's typed answers right ${weakTypedAcc.toFixed(2)} once the model knows them`);
  assert.ok(weak.asked.some((a) => a.kind === 'recall' && a.reveal >= 2), 'a weak speller gets a second letter');

  // New words a day: the pace is learned after three days, and the count varies with the load.
  const withPace = avg.daily.filter((d) => d.pace);
  assert.ok(withPace.length >= avg.daily.length - 4);
  const sug = withPace[withPace.length - 1].pace.suggested;
  assert.ok(sug >= 4 && sug <= 14, `about 80 answers a day suggest ${sug} new words`);
  const freshCounts = new Set(withPace.map((d) => d.fresh));
  assert.ok(freshCounts.size >= 2, `today's new words vary: ${[...freshCounts]}`);
  const heavy = withPace.reduce((a, b) => (b.due > a.due ? b : a));
  const light = withPace.reduce((a, b) => (b.due < a.due ? b : a));
  assert.ok(heavy.fresh <= light.fresh, `heavy day ${heavy.due} due with ${heavy.fresh} new, light day ${light.due} due with ${light.fresh} new`);
  console.log(
    `  simulated 40 days: accuracy ${avg.acc.toFixed(2)} (weak speller ${weak.acc.toFixed(2)}, strong ${strong.acc.toFixed(2)}); spelling share ${weak.spellShare.toFixed(2)}, ${avg.spellShare.toFixed(2)}, ${strong.spellShare.toFixed(2)}; never typed ${weak.neverTyped.toFixed(2)}, ${avg.neverTyped.toFixed(2)}, ${strong.neverTyped.toFixed(2)}; suggested ${sug} new a day`,
  );
}
