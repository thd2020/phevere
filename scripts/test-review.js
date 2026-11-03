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
      export { reviewHtml } from './src/notebook-review';
      export { configureCore } from './src/runtime';
      export { addVocab, listVocab, getVocab, reviewVocab, updateVocabNote } from './src/vocab-store';
      export { syncVocab } from './src/vocab-sync';
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
  assert.equal(core.checkTyped('serendiptiy', ['serendipity']), 'close', 'one swap in a long word');
  assert.equal(core.checkTyped('cat', ['cot']), 'wrong', 'no slack in short words');
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
  assert.equal(core.autoGrade('recall', 'close', 2000, 8), 2, 'a near miss is Hard');
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
  assert.deepEqual([...kinds1].sort(), ['listen-choice', 'word-choice']);
  const noAudio = new Set();
  for (let s = 0; s < 30; s++) noAudio.add(core.buildQuestion(learning, pool, { audio: false, now }, core.seededRandom(s)).kind);
  assert.deepEqual([...noAudio], ['word-choice'], 'no listening question with sound off');

  const firm = { ...pool[0], reps: 4, state: 2, stability: 10, lastReview: now - 10 * DAY };
  const kinds2 = new Set();
  for (let s = 0; s < 40; s++) kinds2.add(core.buildQuestion(firm, pool, { audio: true, now }, core.seededRandom(s)).kind);
  assert.deepEqual([...kinds2].sort(), ['listen-type', 'recall'], 'no cloze without a sentence');
  const recall = core.buildQuestion(firm, pool, { audio: false, now }, core.seededRandom(2));
  assert.equal(recall.kind, 'recall');
  assert.equal(recall.hint, 'a');
  assert.equal(recall.prompt, 'to leave behind for good');

  const strong = { ...firm, stability: 60, note: 'They had to abandon the car in the snow.' };
  const cloze = core.buildQuestion(strong, pool, { audio: true, now }, core.seededRandom(5));
  assert.equal(cloze.kind, 'cloze');
  assert.equal(cloze.prompt, 'They had to _____ the car in the snow.');

  const bare = { id: 'b', lemma: 'zephyr', reps: 0, createdAt: now };
  assert.equal(core.buildQuestion(bare, [bare], { audio: false, now }).kind, 'flash', 'nothing else can be asked');
  assert.equal(core.buildQuestion(bare, [bare, ...pool], { audio: true, now }, core.seededRandom(1)).kind, 'listen-choice');
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
  assert.match(html, /Session done/);
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

  // Sync: a newer device carries the FSRS fields; an older device's record without them keeps
  // the local state when its review progress matches.
  const records = new Map();
  let seq = 0;
  const server = {
    sync(cursor, changes) {
      for (const c of changes) {
        const prev = records.get(c.id);
        if (prev && c.updatedAt <= prev.updatedAt) continue;
        records.set(c.id, { ...c, seq: ++seq });
      }
      const out = [...records.values()].filter((r) => r.seq > cursor).sort((a, b) => a.seq - b.seq);
      return { changes: out.map(({ seq: _s, ...r }) => r), cursor: out.length ? out[out.length - 1].seq : cursor, more: false };
    },
  };
  const account = { getUser: async () => ({ id: 'u' }), sync: async (_ns, cursor, changes) => server.sync(cursor, JSON.parse(JSON.stringify(changes))) };

  const deviceA = loadCore();
  const dbA = new SQL.Database();
  for (const stmt of deviceA.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) dbA.run(stmt);
  deviceA.configureCore({ http: {}, sha256Hex: () => '', vocabDb: vocabDbOn(dbA), newId: () => 'a-001' });
  const deviceB = loadCore();
  const dbB = new SQL.Database();
  for (const stmt of deviceB.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) dbB.run(stmt);
  deviceB.configureCore({ http: {}, sha256Hex: () => '', vocabDb: vocabDbOn(dbB), newId: () => 'b-001' });

  const saved = await deviceA.addVocab({ lemma: 'lantern', definition: 'a lamp with a case' });
  const afterA = await deviceA.reviewVocab(saved.id, 3, Date.now());
  await deviceA.syncVocab(account);
  await deviceB.syncVocab(account);
  const onB = await deviceB.getVocab(saved.id);
  for (const k of ['stability', 'difficulty', 'state', 'lapses', 'lastReview', 'learningSteps', 'reps', 'reviewDue']) {
    assert.equal(onB[k], afterA[k], `${k} synced`);
  }

  // An older app edits the note and pushes a record without FSRS fields.
  const legacyRecord = { ...afterA, note: 'seen in a shop window', updatedAt: Date.now() + 5000 };
  for (const k of ['stability', 'difficulty', 'state', 'lapses', 'lastReview', 'learningSteps']) delete legacyRecord[k];
  server.sync(0, [{ id: saved.id, updatedAt: legacyRecord.updatedAt, deleted: false, data: legacyRecord }]);
  await deviceB.syncVocab(account);
  const merged = await deviceB.getVocab(saved.id);
  assert.equal(merged.note, 'seen in a shop window');
  assert.equal(merged.stability, afterA.stability, 'memory state kept on a note-only edit');

  // An older app reviews the word itself: the state is dropped and rebuilt from SM-2 next time.
  const reviewedOld = { ...legacyRecord, reps: afterA.reps + 1, reviewDue: afterA.reviewDue + 4 * DAY, reviewInterval: 5, updatedAt: Date.now() + 9000 };
  server.sync(0, [{ id: saved.id, updatedAt: reviewedOld.updatedAt, deleted: false, data: reviewedOld }]);
  await deviceB.syncVocab(account);
  const rebuilt = await deviceB.getVocab(saved.id);
  assert.equal(rebuilt.stability, undefined);
  assert.equal(rebuilt.reps, afterA.reps + 1);
  const next = await deviceB.reviewVocab(saved.id, 3, Date.now() + 10000);
  assert.equal(next.state, 2);
  assert.ok(next.stability >= 5, `rebuilt from the five-day interval: ${next.stability}`);

  console.log('test-review: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
