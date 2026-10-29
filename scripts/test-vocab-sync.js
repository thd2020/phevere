/**
 * Notebook sync (packages/core/src/vocab-sync.ts): two devices, each with its own sql.js notebook,
 * syncing through one account. Checks edits, deletes, the same word saved on both devices, and that
 * the devices end up identical.
 *
 * Run: node scripts/test-vocab-sync.js
 * Against a running Holarky API (e.g. `npm run dev` in holarky-account), with an access token for a
 * test user who has an empty notebook:
 *   PHEVERE_SYNC_TEST_API=http://127.0.0.1:8787 PHEVERE_SYNC_TEST_TOKEN=<token> node scripts/test-vocab-sync.js
 */
const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');
const initSqlJs = require('sql.js');

const root = path.join(__dirname, '..');
const API = process.env.PHEVERE_SYNC_TEST_API || '';
const TOKEN = process.env.PHEVERE_SYNC_TEST_TOKEN || '';

// One bundle of the core pieces under test; each device evaluates its own copy, so each has its
// own configureCore() state, as two installs would.
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export { configureCore } from './src/runtime';
      export { addVocab, listVocab, removeVocab, updateVocabNote, findByLemma } from './src/vocab-store';
      export { syncVocab } from './src/vocab-sync';
      export { VOCAB_SCHEMA_SQL } from './src/schema';
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

const tick = () => new Promise((r) => setTimeout(r, 3));

/** The account server's sync rules, in memory: newest updatedAt per id, seq-ordered pulls. */
function fakeServer() {
  const records = new Map();
  let seq = 0;
  return {
    sync(cursor, changes) {
      for (const c of changes) {
        const prev = records.get(c.id);
        if (prev && c.updatedAt <= prev.updatedAt) continue;
        records.set(c.id, { ...c, data: c.deleted ? null : c.data, seq: ++seq });
      }
      const out = [...records.values()].filter((r) => r.seq > cursor).sort((a, b) => a.seq - b.seq).slice(0, 500);
      return {
        changes: out.map(({ seq: _s, ...r }) => r),
        cursor: out.length ? out[out.length - 1].seq : cursor,
        more: out.length === 500,
      };
    },
  };
}

async function makeDevice(SQL, name, account) {
  const core = loadCore();
  const db = new SQL.Database();
  for (const stmt of core.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) db.run(stmt);
  const vocabDb = {
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
      return (await vocabDb.queryAll(sql, params))[0] || null;
    },
    async runWrite(sql, params = []) {
      db.run(sql, params);
    },
  };
  let n = 0;
  core.configureCore({
    http: {},
    sha256Hex: () => '',
    vocabDb,
    newId: () => `${name}-${String(++n).padStart(3, '0')}-${Math.random().toString(36).slice(2, 6)}`,
  });
  return {
    core,
    name,
    sync: () => core.syncVocab(account),
    async snapshot() {
      const rows = await core.listVocab(1000);
      return rows
        .map((r) => ({ id: r.id, lemma: r.lemma, definition: r.definition || '', note: r.note || '', updatedAt: r.updatedAt }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
    },
  };
}

// ---- Accounts: in-memory, or a real one on a running server ----

function fakeAccount(server) {
  return { getUser: async () => ({ id: 'user-1' }), sync: async (_ns, cursor, changes) => server.sync(cursor, JSON.parse(JSON.stringify(changes))) };
}

/**
 * A real account on a running Holarky API. Sign-in happens in a browser (Auth0), so this takes an
 * access token obtained there; both devices share it, which exercises the same sync calls.
 */
function liveAccount() {
  const sub = JSON.parse(Buffer.from(TOKEN.split('.')[1], 'base64url').toString('utf8')).sub;
  return {
    getUser: async () => ({ id: sub }),
    async sync(ns, cursor, changes) {
      const res = await fetch(`${API}/v1/sync/${ns}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ cursor, changes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`sync failed: ${res.status} ${body.error}`);
      return body;
    },
  };
}

async function main() {
  const SQL = await initSqlJs();
  let accountA;
  let accountB;
  if (API && TOKEN) {
    accountA = liveAccount();
    accountB = accountA;
    console.log(`using live server ${API}`);
  } else {
    const server = fakeServer();
    accountA = fakeAccount(server);
    accountB = fakeAccount(server);
  }
  const A = await makeDevice(SQL, 'a', accountA);
  const B = await makeDevice(SQL, 'b', accountB);
  const both = async () => {
    await A.sync();
    await B.sync();
    await A.sync();
  };

  // 1. A word saved on one device reaches the other with the same id.
  const apple = await A.core.addVocab({ lemma: 'apple', definition: 'a fruit' });
  await both();
  assert.deepStrictEqual((await B.core.findByLemma('apple'))?.id, apple.id);

  // 2. The newer edit wins on both devices.
  await tick();
  await A.core.updateVocabNote(apple.id, 'note from A');
  await tick();
  await B.core.updateVocabNote(apple.id, 'note from B');
  await both();
  assert.strictEqual((await A.core.findByLemma('apple'))?.note, 'note from B');

  // 3. A deletion travels.
  await tick();
  await A.core.removeVocab(apple.id);
  await both();
  assert.strictEqual(await B.core.findByLemma('apple'), null);

  // 4. An edit made after a deletion brings the word back everywhere.
  const pear = await A.core.addVocab({ lemma: 'pear' });
  await both();
  await tick();
  await A.core.removeVocab(pear.id);
  await tick();
  await B.core.updateVocabNote(pear.id, 'still studying this');
  await both();
  assert.strictEqual((await A.core.findByLemma('pear'))?.note, 'still studying this');

  // 5. The same word saved separately on both devices folds into one row.
  const brookA = await A.core.addVocab({ lemma: 'brook', definition: 'a small stream' });
  await tick();
  const brookB = await B.core.addVocab({ lemma: 'Brook', note: 'saw it in a poem' });
  await both();
  await B.sync();
  const keepId = brookA.id < brookB.id ? brookA.id : brookB.id;
  for (const d of [A, B]) {
    const rows = (await d.core.listVocab(1000)).filter((r) => r.lemma.toLowerCase() === 'brook');
    assert.strictEqual(rows.length, 1, `${d.name} keeps one brook`);
    assert.strictEqual(rows[0].id, keepId);
    assert.strictEqual(rows[0].definition, 'a small stream');
    assert.strictEqual(rows[0].note, 'saw it in a poem');
  }

  // 6. Many words, more than one page, and both devices identical at the end.
  for (let i = 0; i < 620; i++) await A.core.addVocab({ lemma: `word${i}` });
  await both();
  await B.sync();
  const [sa, sb] = [await A.snapshot(), await B.snapshot()];
  assert.strictEqual(sa.length, 620 + 2);
  assert.deepStrictEqual(sa, sb, 'devices converge');

  // 7. A sync with nothing new sends only what the server has not seen and receives nothing.
  const quiet = await A.sync();
  assert.strictEqual(quiet.received, 0);
  assert.strictEqual(quiet.merged, 0);

  console.log(`test-vocab-sync: ok (${API && TOKEN ? 'live server' : 'in-memory server'})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
