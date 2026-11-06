/**
 * Word book files (packages/core/src/book-file.ts and book-transfer.ts): the .pvbook container,
 * and a book exported on one device and imported on another, each with its own sql.js notebook.
 *
 * - My words keeps every field (saved date, device, sentence) and its schedule, rebuilt from the
 *   answer history on import; importing the same file twice changes nothing
 * - a made book with a name already taken is replaced or kept under "(2)", as the reader chooses
 * - a protected (encrypted or signed) book needs the account; a changed file is refused
 *
 * Run: node scripts/test-book-file.js
 */
const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');
const initSqlJs = require('sql.js');

const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export { configureCore } from './src/runtime';
      export { addVocab, listVocab, reviewVocab, findByLemma } from './src/vocab-store';
      export { createUserBook, listUserBooks } from './src/wordbook-store';
      export { listAnswerHistory } from './src/answer-history';
      export { VOCAB_SCHEMA_SQL } from './src/schema';
      export * from './src/book-file';
      export * from './src/book-transfer';
      export * from './src/anki-import';
      export { listBookProgress } from './src/wordbook-store';
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

function loadCore() {
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
  return mod.exports;
}

async function makeDevice(SQL, name) {
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
    deviceName: () => name,
    newId: () => `${name}-${String(++n).padStart(3, '0')}`,
  });
  return core;
}

(async () => {
  const SQL = await initSqlJs();
  const A = await makeDevice(SQL, 'laptop');
  const B = await makeDevice(SQL, 'phone');

  // My words on the laptop: a word with a sentence, reviewed twice; one never reviewed.
  const ctx = { app: 'Acrobat', doc: 'GEB.pdf', page: 12, sentence: 'An Eternal Golden Braid.' };
  const braid = await A.addVocab({ lemma: 'braid', definition: 'a length of hair woven together', context: ctx, sourceLang: 'en' });
  await A.addVocab({ lemma: 'fugue', definition: 'a contrapuntal composition' });
  await A.reviewVocab(braid.id, 3, Date.now() - 86_400_000);
  await A.reviewVocab(braid.id, 3, Date.now());
  const before = await A.findByLemma('braid');

  // The container round-trips, and a changed byte is refused.
  const exported = await A.exportBookFile({ kind: 'mine' });
  assert.ok(A.isBookFile(exported.bytes), 'starts with PVBK');
  assert.strictEqual(exported.fileName, 'My words.pvbook');
  const payload = await B.decodeBookFile(exported.bytes);
  assert.strictEqual(payload.words.length, 2);
  assert.ok(payload.answers.length >= 2, 'the answer history comes along');
  const broken = exported.bytes.slice();
  broken[broken.length - 3] ^= 0xff;
  await assert.rejects(B.decodeBookFile(broken), 'a damaged file is refused');

  // Import on the phone: every field, and the same schedule rebuilt from the answers.
  await B.importBookPayload(payload);
  const after = await B.findByLemma('braid');
  assert.strictEqual(after.definition, before.definition);
  assert.deepStrictEqual(after.context, ctx, 'the sentence and book come along');
  assert.strictEqual(after.createdAt, before.createdAt, 'the saved date is kept');
  assert.strictEqual(after.device, 'laptop', 'the device it was saved on is kept');
  assert.strictEqual(after.reps, before.reps, 'the schedule is rebuilt from the history');
  assert.strictEqual(after.reviewDue, before.reviewDue);
  const answersOnce = (await B.listAnswerHistory()).length;
  const savedOnce = (await B.findByLemma('fugue')).updatedAt;
  const again = await B.importBookPayload(await B.decodeBookFile(exported.bytes));
  assert.strictEqual(again.added, 0, 'nothing new the second time');
  assert.strictEqual((await B.findByLemma('fugue')).updatedAt, savedOnce, 'a saved word is not rewritten');
  assert.strictEqual((await B.listAnswerHistory()).length, answersOnce, 'importing twice adds no answers');
  assert.strictEqual((await B.listVocab(100)).length, 2, 'importing twice adds no words');

  // A made book whose name is taken: replace it, or keep both under "(2)".
  await A.createUserBook('Reading list', ['braid', 'fugue', 'canon'], 'doc:geb.pdf');
  const madeA = (await A.listUserBooks())[0];
  const file = await B.decodeBookFile((await A.exportBookFile({ kind: 'user', id: madeA.bookId })).bytes);
  assert.strictEqual(await B.findBookConflict(file), null, 'no conflict on a fresh device');
  await B.importBookPayload(file);
  const conflict = await B.findBookConflict(file);
  assert.ok(conflict && conflict.title === 'Reading list', 'the same name is noticed');
  const kept = await B.importBookPayload(file, 'keep-both');
  assert.strictEqual(kept.title, 'Reading list (2)');
  assert.strictEqual((await B.listUserBooks()).length, 2);
  await B.importBookPayload(file, 'replace');
  const titles = (await B.listUserBooks()).map((b) => b.title).sort();
  assert.deepStrictEqual(titles, ['Reading list', 'Reading list (2)'], 'replace overwrites, it does not add');
  assert.deepStrictEqual((await B.listUserBooks()).find((b) => b.title === 'Reading list').words, ['braid', 'fugue', 'canon']);

  // A protected book: encrypted needs the account's key, signed needs Phevere's public key.
  const locked = exported.bytes.slice();
  locked[5] |= 2;
  await assert.rejects(B.decodeBookFile(locked), (e) => e.name === 'BookLockedError');
  const signed = new Uint8Array(exported.bytes.length + 72);
  signed.set(exported.bytes);
  signed[5] |= 4;
  await assert.rejects(B.decodeBookFile(signed), (e) => e.name === 'BookLockedError');

  // A real signature from a key the app trusts opens; the same file with one byte changed does not.
  const { subtle } = globalThis.crypto;
  const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const body = exported.bytes.slice();
  body[5] |= 4;
  const keyId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const sig = new Uint8Array(await subtle.sign('Ed25519', pair.privateKey, body));
  const issued = new Uint8Array(body.length + 72);
  issued.set(body);
  issued.set(keyId, body.length);
  issued.set(sig, body.length + 8);
  const keys = { '0102030405060708': pub };
  assert.strictEqual((await B.decodeBookFile(issued, { publicKeys: keys })).words.length, 2, 'a signed book opens');
  const forged = issued.slice();
  forged[20] ^= 1;
  await assert.rejects(B.decodeBookFile(forged, { publicKeys: keys }), /changed after it was issued|damaged/);

  // Anki: an old .apkg (collection.anki2), a new one (zstd collection.anki21b next to the
  // "please update" stub), and a text export. Each deck becomes a made book with its meanings.
  const { zipSync } = require('fflate');
  const zlib = require('zlib');
  const openSqlite = async (bytes) => {
    const db = new SQL.Database(bytes);
    return {
      all(sql) {
        const res = db.exec(sql)[0];
        return res ? res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]]))) : [];
      },
      close: () => db.close(),
    };
  };
  const legacy = new SQL.Database();
  legacy.run("CREATE TABLE col (decks TEXT); CREATE TABLE notes (id INTEGER, flds TEXT); CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER)");
  legacy.run('INSERT INTO col VALUES (?)', [JSON.stringify({ 1: { id: 1, name: 'Default' }, 7: { id: 7, name: 'GRE::Barron 333' } })]);
  legacy.run('INSERT INTO notes VALUES (1, ?), (2, ?), (3, ?)', ['abate\u001fto lessen <b>in intensity</b>', 'aberrant\u001fdeviating from the norm<br>[sound:x.mp3]', 'abate\u001fduplicate']);
  legacy.run('INSERT INTO cards VALUES (1, 1, 7), (2, 2, 7), (3, 3, 7)');
  const oldPkg = zipSync({ 'collection.anki2': legacy.export(), media: new TextEncoder().encode('{}') });
  const deck = await B.parseAnkiPackage(oldPkg, openSqlite, 'barron.apkg');
  assert.strictEqual(deck.book.title, 'Barron 333', 'the deck name, not its parent');
  assert.deepStrictEqual(deck.words.map((w) => w.lemma), ['abate', 'aberrant'], 'one word each, in order');
  assert.strictEqual(deck.words[0].definition, 'to lessen in intensity', 'HTML and sounds are stripped');
  const stub = new SQL.Database();
  stub.run('CREATE TABLE col (decks TEXT); CREATE TABLE notes (id INTEGER, flds TEXT); CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER)');
  stub.run("INSERT INTO notes VALUES (1, 'Please update to the latest Anki version\u001f')");
  const modern = new SQL.Database();
  modern.run('CREATE TABLE decks (id INTEGER, name TEXT); CREATE TABLE notes (id INTEGER, flds TEXT); CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER)');
  modern.run("INSERT INTO decks VALUES (3, 'Languages\u001fJapanese N5')");
  modern.run("INSERT INTO notes VALUES (1, '食べる\u001fto eat')");
  modern.run('INSERT INTO cards VALUES (1, 1, 3)');
  const newPkg = zipSync({ 'collection.anki2': stub.export(), 'collection.anki21b': zlib.zstdCompressSync(Buffer.from(modern.export())) });
  const n5 = await B.parseAnkiPackage(newPkg, openSqlite, 'n5.apkg');
  assert.strictEqual(n5.book.title, 'Japanese N5', 'the zstd collection wins over the stub');
  assert.deepStrictEqual(n5.words, [{ lemma: '食べる', definition: 'to eat' }]);
  const txt = B.parseAnkiText('#separator:tab\n#html:true\n#deck:Idioms\nbreak the ice\t<i>to start</i> a conversation\n"a, b"\tquoted\n', 'x.txt');
  assert.strictEqual(txt.book.title, 'Idioms');
  assert.deepStrictEqual(txt.words.map((w) => w.lemma), ['break the ice', 'a, b']);
  const imported = await B.importBookPayload(deck);
  assert.strictEqual(imported.title, 'Barron 333');
  const meanings = new Map((await B.listBookProgress()).map((p) => [p.lemma, p.definition]));
  assert.strictEqual(meanings.get('abate'), 'to lessen in intensity', 'the card back is the quiz meaning');

  // My words from a laptop that saved the Danish "give" go in beside the phone's English "give".
  await A.addVocab({ lemma: 'give', definition: 'to yield', sourceLang: 'da' });
  await B.addVocab({ lemma: 'give', definition: 'to transfer', sourceLang: 'en' });
  const withDanish = await B.importBookPayload(await B.decodeBookFile((await A.exportBookFile({ kind: 'mine' })).bytes));
  assert.strictEqual(withDanish.added, 1, 'the Danish give is new');
  assert.strictEqual((await B.findByLemma('give', 'da'))?.definition, 'to yield');
  assert.strictEqual((await B.findByLemma('give', 'en'))?.definition, 'to transfer', 'the English give is left alone');

  console.log('book-file: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
