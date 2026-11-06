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
  // The same word overdue: recall is weaker, so it is recognised, or typed from its first letter
  // only; a weak word gets an easier kind, never a longer cue.
  const late = { ...firm, lastReview: now - 70 * DAY };
  const lateKinds = new Set();
  for (let s = 0; s < 30; s++) {
    const lq = core.buildQuestion(late, pool, { now }, core.seededRandom(s));
    lateKinds.add(lq.kind);
    if (lq.kind === 'recall') {
      assert.equal(lq.reveal, 1, 'a weaker word typed still starts from one letter');
      assert.equal(lq.hint, 'h');
    }
  }
  assert.ok(lateKinds.has('word-choice') && [...lateKinds].every((k) => ['recall', 'word-choice', 'spell-tiles'].includes(k)), `${[...lateKinds]}`);
  // Long forgotten: it steps back to recognition.
  const lost = { ...firm, lastReview: now - 400 * DAY };
  const kinds = new Set();
  for (let s = 0; s < 30; s++) kinds.add(core.buildQuestion(lost, pool, { now }, core.seededRandom(s)).kind);
  assert.ok(kinds.has('word-choice'), `a long-forgotten word steps back to recognition: ${[...kinds]}`);
  // A typed question starts from one letter, however weak the word; dictation from none.
  for (const lemma of ['cat', 'harbour', 'extraordinary', 'idiosyncrasy']) {
    for (const strength of [-3, 0, 3]) assert.equal(core.cueLetters('recall', lemma, strength, null), 1, `${lemma} at ${strength}`);
  }
  assert.equal(core.cueLetters('listen-type', 'harbour', -3, null), 0, 'dictation shows no letter');

  // Hint reveals a letter into the box, one a press, never the last one.
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
  assert.equal(asked.hinted, 5, 'one letter a press');
  const html = core.reviewHtml([firm, ...pool.slice(1)], state, 10, { now });
  assert.match(html, /value="harbou"/);
  assert.match(html, /7 letters/);
  assert.match(html, /class="nbv-type__cue"[^>]*>harbou·</, 'the letters shown stay in sight under the box');
  assert.doesNotMatch(html, /data-act="nb-hint"/, 'no Hint once only the last letter is hidden');
  const a = core.answerReview(state, { typed: 'harbour' }, now + 2000);
  assert.equal(a.result, 'right');
  assert.equal(a.grade, 1, 'hints that gave most of the word: Again, the word was told rather than recalled');
  assert.match(core.reviewHtml([firm, ...pool.slice(1)], state, 10, { now: now + 2100 }), />I knew it</);
  core.overrideReview(state);
  assert.equal(state.answer.grade, 2, '"I knew it" after a hinted answer is Hard at most');
  // Each hint lowers the credit: one letter of six is Hard, three of six Again.
  const graded = (presses) => {
    const s = core.startReview([firm], 10, now);
    s.started = true;
    const q = core.ensureReviewQuestion(s, [firm, ...pool.slice(1)], { now });
    for (let i = 0; i < presses; i++) core.hintReview(s);
    return core.answerReview(s, { typed: 'harbour' }, now + 2000).grade;
  };
  assert.deepEqual([0, 1, 2, 3].map(graded), [4, 2, 2, 1]);
  // Hint keeps what the learner typed as far as it matches, and reveals the letter after it.
  const hintAfter = (typed) => {
    const s = core.startReview([firm], 10, now);
    s.started = true;
    const q = core.ensureReviewQuestion(s, [firm, ...pool.slice(1)], { now });
    return { ok: core.hintReview(s, typed), q };
  };
  assert.equal(hintAfter('harb').q.draft, 'harbo', 'four right letters kept, the fifth revealed');
  assert.equal(hintAfter('harb').q.hinted, 1, 'letters the learner typed are not counted as hints');
  assert.equal(hintAfter('HARB').q.draft, 'HARBo', 'letter case aside, and as typed');
  const wrongTyped = hintAfter('hax').q;
  assert.equal(wrongTyped.draft, 'hax', 'what the learner typed is never cleared');
  assert.equal(core.typedPlaceholder(wrongTyped), 'har····', 'the letters shown appear under the box instead');
  assert.equal(hintAfter('').q.draft, 'ha', 'an empty box gets the letter after the shown one');
  const nearlyDone = hintAfter('harbou');
  assert.equal(nearlyDone.ok, false, 'the last letter is never revealed');
  assert.equal(nearlyDone.q.draft, undefined);
  const kept = hintAfter('harb').q;
  assert.equal(core.typedPlaceholder(kept), 'harbo··');
  assert.equal(core.hintsLeft(kept), 1);
  assert.equal(core.autoGrade('recall', 'right', 2000, 7, { extra: 1 }), 3, 'extra letters up front: at most Good');
  assert.equal(core.autoGrade('recall', 'right', 2000, 7, {}), 4);
  assert.equal(core.autoGrade('recall', 'right', 2000, 12, { hintShare: 1 / 11 }), 2, 'one hint in a long word: Hard');
  assert.equal(core.autoGrade('recall', 'right', 2000, 12, { hintShare: 3 / 11 }), 2);
  assert.equal(core.autoGrade('recall', 'right', 2000, 12, { hintShare: 4 / 11 }), 1, 'more than a third of the word given: Again');
  assert.equal(core.autoGrade('recall', 'right', 2000, 4, { hintShare: 1 / 3 }), 2, 'a third exactly is still Hard');

  // What the learner typed survives any repaint: the box is kept on each keystroke.
  const typing = core.startReview([firm], 10, now);
  typing.started = true;
  core.ensureReviewQuestion(typing, [firm, ...pool.slice(1)], { now });
  core.keepDraft(typing, 'harb');
  assert.match(core.reviewHtml([firm, ...pool.slice(1)], typing, 10, { now: now + 5000 }), /id="nbv-answer"[^>]*value="harb"/);
  assert.ok(core.hintReview(typing), 'Hint goes on from the kept box');
  assert.equal(typing.question.draft, 'harbo');

  // A typo counts as right, as on Duolingo: Good, a tick, and the right spelling with the slip marked.
  const near = core.startReview([firm], 10, now);
  near.started = true;
  core.ensureReviewQuestion(near, [firm, ...pool.slice(1)], { now });
  const na = core.answerReview(near, { typed: 'harbuor' }, now + 2000);
  assert.equal(na.result, 'typo');
  assert.equal(na.grade, 3);
  const nearHtml = core.reviewHtml([firm, ...pool.slice(1)], near, 10, { now: now + 2100 });
  assert.match(nearHtml, /You have a typo<span class="nbv-fix">harb<mark>ou<\/mark>r<\/span>/);
  assert.match(nearHtml, /class="nbv-ink is-right"/, 'the right-answer mark');
  assert.equal((nearHtml.match(/nbv-ink__reveal--/g) || []).length, 1, 'a tick, not a cross');
  assert.match(nearHtml, />I didn't know it</);
  assert.doesNotMatch(nearHtml, /Too easy/, 'a typo cannot be marked too easy');
  core.overrideReview(near);
  assert.equal(near.answer.grade, 1);

  // The stage tag is on every question.
  const tagState = core.startReview([firm], 10, now);
  tagState.started = true;
  assert.match(core.reviewHtml([firm, ...pool.slice(1)], tagState, 10, { now }), /nbv-tag is-young">Young</);
}

/* ------------------------------------------- gap choice and letter tiles */
{
  // Every option of a gap question takes the gap's form.
  assert.equal(core.inflectLike('ignore', 'ignored', 'notice'), 'noticed');
  assert.equal(core.inflectLike('ignore', 'ignoring', 'stop'), 'stopping');
  assert.equal(core.inflectLike('city', 'cities', 'harbour'), 'harbours');
  assert.equal(core.inflectLike('harbour', 'Harbour', 'meadow'), 'Meadow', 'a gap at the start of a sentence');
  assert.equal(core.inflectLike('ignore', 'ignored', 'make up'), null, 'a phrase that cannot take the form is left out');
  assert.deepEqual(core.regularForms('rat'), ['rats', 'ratted', 'ratting'], 'regular forms unchanged');

  const ready = { offset: {}, right: { 'word-choice': 6, 'meaning-choice': 6 } };
  const learning = (e) => ({ ...e, reps: 1, state: 1, stability: 0.4, lastReview: now - 10 * 60_000, reviewDue: now });
  const lantern = learning(pool[1]);
  const examples = (l) => (l === 'lantern' ? ['They walked home by the light of a lantern.', 'Lanterns lined the street.'] : undefined);
  const kindsOf = (entry, opts) => {
    const seen = new Map();
    for (let s = 0; s < 80; s++) {
      const q = core.buildQuestion(entry, pool, { now, learner: ready, asked: s % 3 ? ['word-choice', 'meaning-choice', 'word-choice'] : [], ...opts }, core.seededRandom(s));
      if (!seen.has(q.kind)) seen.set(q.kind, q);
    }
    return seen;
  };
  const withSentence = kindsOf(lantern, { examples });
  const gap = withSentence.get('cloze-choice');
  assert.ok(gap, `a learning word with an example sentence gets the gap among four: ${[...withSentence.keys()]}`);
  assert.equal(gap.options.length, 4);
  assert.equal(gap.options[gap.correct], 'lantern');
  assert.match(gap.prompt, /_____/);
  assert.doesNotMatch(gap.prompt, /lantern/i, 'the sentence never shows the word');
  assert.equal(new Set(gap.options.map((o) => o.toLowerCase())).size, 4, 'four different options');
  assert.ok(!kindsOf(lantern, {}).has('cloze-choice'), 'no sentence, no gap question');
  // Answered like any choice, with the countdown of choice questions.
  assert.ok(core.COUNTDOWN_KINDS.includes('cloze-choice'));
  const gs = core.startReview([lantern], 10, now);
  gs.started = true;
  gs.question = gap;
  assert.match(core.reviewHtml([lantern, ...pool.filter((e) => e.id !== 'lantern')], gs, 10, { now }), /Choose the word for the gap[\s\S]*class="nbv-gap"[\s\S]*data-act="nb-choose"/);
  assert.equal(core.answerReview(gs, { choice: gap.correct }, now + 3000).grade, 3);

  // A plural in the sentence: every option is a plural.
  const inflected = core.buildQuestion(learning(pool[1]), pool, { now, learner: ready, examples: () => ['Lanterns hung from every branch of the old trees.'] }, core.seededRandom(3));
  const pluralGap = inflected.kind === 'cloze-choice' ? inflected : [...kindsOf(learning(pool[1]), { examples: () => ['Lanterns hung from every branch of the old trees.'] }).values()].find((q) => q.kind === 'cloze-choice');
  assert.ok(pluralGap);
  assert.ok(pluralGap.options.every((o) => /^[A-Z].*s$/.test(o)), `${pluralGap.options}`);

  // An -ing gap offers only verbs, so no option is a made-up form of a noun ("lanterning"), and a
  // word that the answer's definition names (a synonym that could fill the gap) is never offered.
  const verb = (lemma, def) => ({ id: lemma, lemma, partOfSpeech: 'verb', sourceLang: 'en', definition: def, createdAt: now - 60 * DAY });
  const wander = learning(verb('wander', 'to walk or roam slowly without a fixed course'));
  const verbs = [wander, verb('gather', 'to bring together'), verb('borrow', 'to take and give back later'), verb('polish', 'to make shiny'), verb('roam', 'to move about aimlessly')];
  const mixed = [...verbs, ...pool];
  const ingSentences = () => ['We spent the afternoon wandering through the old market streets.'];
  let ingGap = null;
  for (let s = 0; s < 80 && !ingGap; s++) {
    const q = core.buildQuestion(wander, mixed, { now, learner: ready, examples: ingSentences }, core.seededRandom(s));
    if (q.kind === 'cloze-choice') ingGap = q;
  }
  assert.ok(ingGap, 'a verb in an -ing gap gets the gap question');
  assert.equal(ingGap.options[ingGap.correct], 'wandering');
  assert.ok(ingGap.options.every((o) => /ing$/.test(o)), `${ingGap.options}`);
  assert.ok(ingGap.optionWords.every((w) => verbs.some((v) => v.lemma === w)), `only verbs: ${ingGap.optionWords}`);
  assert.ok(!ingGap.optionWords.includes('roam'), 'a synonym named in the definition is not offered');

  // Letter tiles: the word's own letters, shuffled, for one word up to fourteen letters.
  assert.ok(core.tileable('harbour') && core.tileable("o'clock") && !core.tileable('make up') && !core.tileable('ab') && !core.tileable('extraordinarily'));
  const tiles = kindsOf(lantern, {}).get('spell-tiles');
  assert.ok(tiles, 'a learning word can be built from its letters');
  assert.deepEqual([...tiles.tiles].sort(), [...'lantern'].sort());
  assert.notEqual(tiles.tiles.join(''), 'lantern', 'the row does not spell the word already');
  assert.ok(!kindsOf(lantern, { learner: { offset: {}, right: {} } }).has('spell-tiles'), 'tiles open after a few words recognised');
  const repeatKinds = new Set();
  for (let s = 0; s < 40; s++) repeatKinds.add(core.buildQuestion(lantern, pool, { now, learner: ready, repeat: 1 }, core.seededRandom(s)).kind);
  assert.ok(!repeatKinds.has('spell-tiles'), 'not for a learning word asked again the same day');
  const build = (order) => {
    const s = core.startReview([lantern], 10, now);
    s.started = true;
    s.question = { ...tiles, placed: [] };
    for (const ch of order) assert.ok(core.tileKey(s, ch, now + 4000) || s.answer, `key ${ch}`);
    return s;
  };
  const good = build('lantern');
  assert.equal(good.answer.result, 'right', 'placing the last tile answers');
  assert.equal(good.answer.grade, 3, 'tiles hand over the letters: Good, never Easy');
  const bad = build('lnatern');
  assert.equal(bad.answer.result, 'wrong', 'tiles hand over the letters, so a swapped pair is wrong, not a typo');
  const s7 = core.startReview([lantern], 10, now);
  s7.started = true;
  s7.question = { ...tiles, placed: [] };
  core.placeTile(s7, 0, now);
  core.placeTile(s7, 1, now);
  assert.equal(core.placeTile(s7, 1, now), false, 'a tile is used once');
  const html7 = core.reviewHtml([lantern, ...pool.filter((e) => e.id !== 'lantern')], s7, 10, { now });
  assert.equal((html7.match(/data-act="nb-tile"/g) || []).length, 5);
  assert.equal((html7.match(/data-act="nb-tile-out"/g) || []).length, 2);
  assert.match(html7, /Spell the word/);
  assert.ok(core.returnTile(s7, 0));
  assert.deepEqual(s7.question.placed, [1]);
  assert.ok(core.tileKey(s7, 'Backspace'));
  assert.deepEqual(s7.question.placed, []);
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
  // Dictation is reachable for a learner whose words are all mature: picking the word heard is
  // never asked of a mature word, so right typed answers open it too.
  const maturesOnly = { offset: {}, right: { 'word-choice': 8, recall: 3 } };
  assert.ok(core.kindUnlocked('listen-type', maturesOnly), 'three right typed answers open dictation');
  const mature = { ...pool[3], reps: 8, state: 2, stability: 60, lastReview: now - 60 * DAY, reviewDue: now };
  const matureKinds = new Set();
  for (let s = 0; s < 120; s++) matureKinds.add(core.buildQuestion(mature, pool, { now, audio: true, learner: maturesOnly, asked: s % 2 ? ['recall', 'cloze', 'word-choice', 'meaning-choice'] : [] }, core.seededRandom(s)).kind);
  assert.ok(matureKinds.has('listen-type'), `a mature word gets dictation: ${[...matureKinds]}`);
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
  // A listening question's countdown waits until its word has played (or failed to).
  const s5 = core.startReview([fresh], 10, Date.now());
  s5.started = true;
  const q5 = core.ensureReviewQuestion(s5, [fresh, ...pool.slice(3)], { now: Date.now() });
  q5.kind = 'listen-choice';
  const prefs5 = { countdown: 0.3, speaking: false };
  assert.ok(core.countdownWaiting(q5));
  assert.match(core.reviewHtml([fresh, ...pool.slice(3)], s5, 10, { now: Date.now() + 3000, learnPrefs: prefs5 }), /class="nbv-countdown is-waiting"[^>]*--cd-t:-0ms/, 'the bar stays full while the word plays');
  core.armCountdown(s5, 0.3, () => true, () => (painted += 1));
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(s5.answer, null, 'no time counts before the word has played');
  assert.equal(core.markHeard(s5, 'someotherword'), false, 'only the word on screen counts');
  assert.equal(core.markHeard(s5, q5.lemma.toUpperCase()), true);
  assert.equal(core.markHeard(s5, q5.lemma), false, 'once');
  // A dictation has no countdown to redraw: the word finishing never repaints the box being typed in.
  const s6 = core.startReview([fresh], 10, Date.now());
  s6.started = true;
  const q6 = core.ensureReviewQuestion(s6, [fresh, ...pool.slice(3)], { now: Date.now() });
  q6.kind = 'listen-type';
  assert.equal(core.markHeard(s6, q6.lemma), false);
  assert.equal(q6.heard, true);
  core.armCountdown(s5, 0.3, () => true, () => (painted += 1));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s5.answer, null, 'the countdown starts from the full time once heard');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(s5.answer?.timedOut, true);
  // A word that never reports back does not hold the countdown for ever.
  assert.equal(core.countdownWaiting({ ...q5, heard: false, shownAt: Date.now() - core.COUNTDOWN_WAIT_MS - 1 }), false);
  assert.equal(core.countdownWaiting({ ...q5, kind: 'word-choice', heard: false }), false, 'choice questions without sound do not wait');
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
  // The synthetic voice takes a while to make. A second press while the first is still being made
  // gives one sound: the first stays silent once it is ready.
  log.length = 0;
  const pendingSynth = [];
  const slowVoice = core.singleVoice({
    ...backend,
    recordings: async () => [],
    speak: (w, alive) =>
      new Promise((r) => pendingSynth.push(() => {
        if (alive()) log.push(`voice:${w}`);
        r();
      })),
  });
  const p1 = slowVoice('ravine');
  await new Promise((r) => setTimeout(r, 0));
  const p2 = slowVoice('ravine');
  await new Promise((r) => setTimeout(r, 0));
  pendingSynth.forEach((done) => done());
  assert.deepEqual([await p1, await p2], ['stale', 'speech']);
  assert.deepEqual(log.filter((x) => x !== 'stop'), ['voice:ravine'], 'one sound for two presses');
  // Moving on to the next question cancels a word still loading: it never plays.
  log.length = 0;
  const p3 = slowVoice('saddle');
  await new Promise((r) => setTimeout(r, 0));
  slowVoice.cancel();
  pendingSynth.splice(0).forEach((done) => done());
  pendingSynth.forEach((done) => done());
  assert.equal(await p3, 'stale');
  assert.deepEqual(log.filter((x) => x !== 'stop'), []);

  // A press before the lookup has the word's pronunciation data waits for it: the first version
  // has no clip and says more is coming, a later one brings the clip.
  const clip = { ipa: '/ˈhɑːbə/', accent: 'uk', audioUrl: 'https://upload.wikimedia.org/x/En-uk-harbour.ogg' };
  let push = null;
  const early = core.awaitRecordings((onUpdate) => {
    push = onUpdate;
    return Promise.resolve({ pronunciations: [{ ipa: '/ˈhɑːbə/', accent: 'uk' }], metadata: { pendingPronunciation: true } });
  }, 5000);
  await new Promise((r) => setTimeout(r, 10));
  push({ pronunciations: [clip], metadata: { pendingPronunciation: true } });
  assert.equal((await early).length, 1, 'the recording that arrived after the press');
  // A word with no recording: the version that says nothing more is coming ends the wait.
  const none = core.awaitRecordings((onUpdate) => {
    setTimeout(() => onUpdate({ pronunciations: [{ ipa: '/x/', accent: 'us' }], metadata: { pendingPronunciation: false } }), 10);
    return Promise.resolve({ pronunciations: [], metadata: { pendingPronunciation: true } });
  }, 5000);
  const t0 = Date.now();
  assert.deepEqual(await none, []);
  assert.ok(Date.now() - t0 < 1000, 'no wait once the lookup says there is no recording');
  // A lookup that never finishes: the wait runs out and the synthetic voice can speak.
  assert.deepEqual(await core.awaitRecordings(() => Promise.resolve({ metadata: { pendingPronunciation: true } }), 30), []);
  // A finished result plays at once, with or without a clip.
  assert.deepEqual(await core.awaitRecordings(() => Promise.resolve({ pronunciations: [] }), 5000), []);
  // The button shows loading only while the recordings are being found.
  const states = [];
  const loud = core.singleVoice({ ...backend, recordings: async () => { states.push('finding'); return ['clip:x']; } });
  await loud('x', { onLoading: (on) => states.push(on ? 'loading' : 'ready') });
  assert.deepEqual(states, ['loading', 'finding', 'ready']);

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
    // A typed question starts from one letter at most.
    assert.ok(asked.every((a) => a.reveal <= 1), `${name}: cue letters`);
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
