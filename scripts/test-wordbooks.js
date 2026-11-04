/**
 * Word books (packages/core/src/wordbooks.ts, wordbook-store.ts, wordbook-sync.ts): the shipped
 * data files, the migration on an existing notebook, subscriptions, progress per word counted in
 * every book, the review queue per scope, saving a book word to My words, and sync between two
 * devices.
 *
 * Run: node scripts/test-wordbooks.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const initSqlJs = require('sql.js');

const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export * from './src/wordbooks';
      export * from './src/wordbook-store';
      export * from './src/wordbook-sync';
      export { syncProgress } from './src/progress-sync';
      export { wordbookLibraryHtml, wordbookListHtml, sortBookEntries, wordbookHeaderHtml } from './src/wordbook-views';
      export { configureCore } from './src/runtime';
      export { addVocab, listVocab, reviewVocab, findByLemma } from './src/vocab-store';
      export { syncVocab } from './src/vocab-sync';
      export { VOCAB_SCHEMA_SQL, vocabColumnMigrations } from './src/schema';
      export { advanceReview, answerReview, ensureReviewQuestion } from './src/review-quiz';
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

function sqlDb(db) {
  const api = {
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
      return (await api.queryAll(sql, params))[0] || null;
    },
    async runWrite(sql, params = []) {
      db.run(sql, params);
    },
  };
  return api;
}

function device(SQL, name, db = new SQL.Database()) {
  const core = loadCore();
  for (const stmt of core.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) db.run(stmt);
  let n = 0;
  core.configureCore({ http: {}, sha256Hex: () => '', vocabDb: sqlDb(db), newId: () => `${name}-${++n}` });
  return { core, db };
}

function fakeServer() {
  const spaces = new Map();
  let seq = 0;
  return {
    sync(ns, cursor, changes) {
      if (!spaces.has(ns)) spaces.set(ns, new Map());
      const records = spaces.get(ns);
      for (const c of changes) {
        const prev = records.get(c.id);
        if (prev && c.updatedAt <= prev.updatedAt) continue;
        records.set(c.id, { ...c, seq: ++seq });
      }
      const out = [...records.values()].filter((r) => r.seq > cursor).sort((a, b) => a.seq - b.seq);
      return { changes: out.map(({ seq: _s, ...r }) => r), cursor: out.length ? out[out.length - 1].seq : cursor, more: false };
    },
    spaces,
  };
}

const DAY = 86_400_000;

async function main() {
  const SQL = await initSqlJs();

  // ---- Data files ----
  const dir = path.join(root, 'packages', 'core', 'wordbooks');
  const catalog = loadCore().WORDBOOKS;
  assert.ok(catalog.length >= 10, 'ten books');
  for (const meta of catalog) {
    const book = JSON.parse(fs.readFileSync(path.join(dir, `${meta.id}.json`), 'utf8'));
    for (const k of ['id', 'title', 'level', 'count', 'source', 'sourceUrl', 'licence', 'licenceUrl', 'retrieved']) assert.ok(book[k], `${meta.id}.${k}`);
    assert.equal(book.words.length, meta.count, `${meta.id} count matches`);
    assert.equal(new Set(book.words.map((w) => w.toLowerCase())).size, book.words.length, `${meta.id} has no duplicates`);
    assert.ok(['MIT', 'CC BY-SA 4.0'].includes(book.licence), `${meta.id} licence`);
  }
  assert.deepEqual(catalog.map((b) => b.rank), catalog.map((_, i) => i + 1), 'catalog in path order');
  const ngsl = JSON.parse(fs.readFileSync(path.join(dir, 'ngsl.json'), 'utf8')).words;
  assert.deepEqual(ngsl.slice(0, 3), ['the', 'be', 'and'], 'NGSL keeps frequency order');

  // ---- Migration: an existing notebook gains the tables and keeps its rows ----
  {
    const old = new SQL.Database();
    old.run(`CREATE TABLE vocab (id TEXT PRIMARY KEY, lemma TEXT NOT NULL, reading TEXT, definition TEXT, part_of_speech TEXT, source_lang TEXT, target_lang TEXT,
      sources TEXT, note TEXT, tags TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, review_due INTEGER, review_interval INTEGER DEFAULT 0, ease REAL DEFAULT 2.5, reps INTEGER DEFAULT 0)`);
    old.run(`INSERT INTO vocab (id, lemma, definition, created_at, updated_at, reps) VALUES ('v1', 'ability', 'being able', 1, 1, 2)`);
    const { core } = device(SQL, 'old', old);
    const cols = old.exec('PRAGMA table_info(vocab)')[0].values.map((r) => r[1]);
    for (const sql of core.vocabColumnMigrations(cols)) old.run(sql);
    const tables = old.exec(`SELECT name FROM sqlite_master WHERE type='table'`)[0].values.flat();
    assert.ok(tables.includes('wordbook_subs') && tables.includes('book_words'), 'tables created');
    const rows = await core.listVocab(10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].definition, 'being able', 'vocab row untouched');
    assert.equal(rows[0].reps, 2);
  }

  // ---- Subscriptions, progress and the queue ----
  const { core } = device(SQL, 'a');
  const now = new Date(2026, 10, 3, 9).getTime();
  const bookA = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
  const bookB = ['gamma', 'eta', 'theta', 'beta'];
  core.registerWordbookWords('starter', bookA);
  core.registerWordbookWords('zhongkao', bookB);
  await core.subscribeWordbook('starter', 3, now);
  await core.subscribeWordbook('zhongkao', 2, now);
  await core.unsubscribeWordbook('zhongkao', now + 1);
  assert.deepEqual((await core.listWordbookSubs()).map((s) => s.bookId), ['starter'], 'unsubscribed book hidden');
  await core.subscribeWordbook('zhongkao', undefined, now + 2);
  const subs = await core.listWordbookSubs();
  assert.equal(subs.find((s) => s.bookId === 'zhongkao').dailyNew, 2, 'resubscribing keeps the goal');

  await core.addVocab({ lemma: 'beta', definition: 'second letter' });
  const ctxOf = async () =>
    core.buildWordsContext(
      (await core.listVocab(100)).map((e) => ({ ...e })),
      await core.listBookProgress(),
      await core.listWordbookSubs(),
      new Map([
        ['starter', bookA],
        ['zhongkao', bookB],
      ]),
    );
  let ctx = await ctxOf();
  const listA = core.scopeEntries('starter', ctx);
  assert.deepEqual(listA.map((e) => e.lemma), bookA, 'book scope keeps book order');
  assert.ok(listA[1].saved && !listA[1].id.startsWith('wb:'), 'a saved word shows as its vocab row');
  assert.deepEqual(listA[2].books, ['starter', 'zhongkao'], 'badges list every subscribed book');
  assert.equal(core.scopeEntries('all', ctx).length, 8, 'all books counts each word once');

  const q1 = core.scopeReviewQueue('starter', ctx, { now });
  assert.deepEqual(q1, ['wb:alpha', 'wb:gamma', 'wb:delta'], 'three new words in book order, saved word left to My words');
  const qAll = core.scopeReviewQueue('all', ctx, { now, mineGoal: 10 });
  assert.equal(qAll[0], ctx.saved.get('beta').id, 'My words first in the rotation');
  assert.ok(qAll.includes('wb:eta') && qAll.includes('wb:alpha'), 'every subscribed book contributes');
  assert.equal(new Set(qAll).size, qAll.length, 'no word twice');

  // Learning gamma once counts in both books.
  await core.reviewBookWord('gamma', 3, now);
  await core.setBookWordKnown('alpha', true, now);
  ctx = await ctxOf();
  const pA = core.bookProgress('starter', ctx, now);
  const pB = core.bookProgress('zhongkao', ctx, now);
  assert.equal(pA.known, 1, 'alpha known in starter');
  assert.equal(pA.learning, 1, 'gamma learning in starter');
  assert.equal(pB.learning, 1, 'gamma learning in zhongkao too');
  assert.equal(pA.startedToday, 1);
  assert.equal(pA.newToday, 2, 'goal less started today');
  assert.deepEqual(core.scopeReviewQueue('starter', ctx, { now }).filter((id) => id !== 'wb:gamma'), ['wb:delta', 'wb:epsilon'], 'known word skipped');

  // The meaning cache stays local and does not mark the row changed.
  await core.cacheBookWordMeaning('delta', { definition: 'fourth letter', reading: '/ˈdɛltə/' });
  const deltaRow = (await core.listBookProgress()).find((p) => p.lemma === 'delta');
  assert.equal(deltaRow.updatedAt, 0);
  ctx = await ctxOf();
  const state = core.startScopeReview('starter', ctx, { now });
  const lookups = core.reviewNeedsMeaning(state, core.scopeEntries('starter', ctx), 5);
  assert.ok(lookups.includes('epsilon') && lookups.includes('gamma') && !lookups.includes('delta'), 'only words without a meaning are looked up');

  // Saving a studied book word moves its progress onto the new vocab row.
  const saved = await core.saveBookWord('gamma');
  assert.ok(saved.reps > 0 && saved.stability > 0, 'progress carried to My words');
  ctx = await ctxOf();
  assert.ok(ctx.saved.has('gamma'));
  assert.equal(core.bookProgress('zhongkao', ctx, now).learning, 1, 'still learning in the book');

  // ---- Library: every card keeps its source and licence, folded into a Source disclosure ----
  {
    const lib = core.wordbookLibraryHtml(ctx);
    const cards = lib.split('<li class="wb-path__item').slice(1);
    assert.equal(cards.length, core.WORDBOOKS.length);
    for (const [i, card] of cards.entries()) {
      const meta = core.WORDBOOKS[i];
      const src = card.slice(card.indexOf('<details class="wb-path__src">'), card.indexOf('</details>'));
      assert.ok(src.includes('<summary>Source</summary>'), `${meta.id} has a Source disclosure`);
      assert.ok(src.includes(`href="${meta.sourceUrl}"`) && src.includes(`href="${meta.licenceUrl}"`) && src.includes(meta.licence), `${meta.id} attribution inside it`);
      assert.ok(!card.slice(0, card.indexOf('<details')).includes(meta.licenceUrl), `${meta.id} licence not on the card face`);
    }
  }

  // ---- Sync: subscriptions and progress reach the second device ----
  const server = fakeServer();
  const account = { getUser: async () => ({ id: 'u1' }), sync: async (ns, c, ch) => server.sync(ns, c, JSON.parse(JSON.stringify(ch))) };
  await core.syncWordbooks(account);
  const b = device(SQL, 'b');
  await b.core.syncWordbooks(account);
  assert.deepEqual((await b.core.listWordbookSubs()).map((s) => [s.bookId, s.dailyNew]).sort(), [
    ['starter', 3],
    ['zhongkao', 2],
  ]);
  assert.ok([...server.spaces.get('phevere/wordbooks').keys()].every((id) => id.startsWith('sub:')), 'only subscriptions in phevere/wordbooks');
  assert.equal((await b.core.listBookProgress()).length, 0, 'no progress through the free collection');
  assert.ok(!server.spaces.has('phevere/vocab'), 'word books use their own namespace');
  // Progress and "Already know it" arrive as the answer history (phevere/progress, Plus).
  await core.syncProgress(account);
  await b.core.syncProgress(account);
  const bRows = await b.core.listBookProgress();
  assert.ok(bRows.find((p) => p.lemma === 'alpha').known, 'known flag synced');
  assert.ok(bRows.find((p) => p.lemma === 'gamma').reps > 0, 'progress synced');
  assert.equal(bRows.find((p) => p.lemma === 'delta'), undefined, 'cached meaning not synced');

  // Unsubscribing on device b reaches device a; the newer edit wins.
  await b.core.unsubscribeWordbook('zhongkao', Date.now() + DAY);
  await b.core.syncWordbooks(account);
  await core.syncWordbooks(account);
  assert.deepEqual((await core.listWordbookSubs()).map((s) => s.bookId), ['starter']);

  // A book's list orders by book place, last met, or A to Z, and keeps each word's place number.
  const met = [
    { id: 'a', lemma: 'state', createdAt: 0, lastReview: null },
    { id: 'b', lemma: 'Abate', createdAt: 5000, lastReview: null },
    { id: 'c', lemma: 'might', createdAt: 1000, lastReview: 9000 },
    { id: 'd', lemma: 'part', createdAt: 0, lastReview: null },
  ];
  assert.deepEqual(core.sortBookEntries(met, 'book').map((r) => r.e.lemma), ['state', 'Abate', 'might', 'part']);
  assert.deepEqual(core.sortBookEntries(met, 'recent').map((r) => r.e.lemma), ['might', 'Abate', 'state', 'part']);
  assert.deepEqual(core.sortBookEntries(met, 'az').map((r) => `${r.n}:${r.e.lemma}`), ['2:Abate', '3:might', '4:part', '1:state']);
  const listHtml = core.wordbookListHtml(met, { scope: 'kaoyan', limit: 10, sort: 'az' });
  assert.match(listHtml, /data-act="wb-sort" data-sort="az" aria-pressed="true"/);
  assert.doesNotMatch(core.wordbookHeaderHtml('starter', ctx), /wb-goal|wb-unsub/, 'no goal chips or Remove link in a book header');

  console.log('test-wordbooks: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
