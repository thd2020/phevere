/**
 * Where words were saved (packages/core/src/source-context.ts, window-title.ts): window title
 * parsing for browsers and PDF readers, the private-window exclusion, the sentence around the
 * word, and the context column filled once and never replaced.
 *
 * Run: node scripts/test-word-sources.js
 */
const assert = require('assert/strict');
const path = require('path');
const esbuild = require('esbuild');
const initSqlJs = require('sql.js');

const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export * from './src/source-context';
      export * from './src/window-title';
      export { configureCore } from './src/runtime';
      export { addVocab, findByLemma, setVocabContextIfEmpty } from './src/vocab-store';
      export { VOCAB_SCHEMA_SQL } from './src/schema';
      export { clozeFrom } from './src/review-quiz';
      export * from './src/wordbook-store';
      export * from './src/wordbook-sync';
      export { buildWordsContext, sourceGroups, scopeEntries, bookProgress, wordbookMeta } from './src/wordbooks';
      export { sourcesHtml, setAppIconSource, wordsScopeSwitchHtml, wordbookHeaderHtml, wordbookListHtml } from './src/wordbook-views';
      export { listVocab, reviewVocab } from './src/vocab-store';
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

const ZWSP = '\u200b';

function titles() {
  const cases = [
    // [process, title, expected subset]
    ['chrome', 'Gödel, Escher, Bach - Wikipedia - Google Chrome', { app: 'Chrome', kind: 'browser', title: 'Gödel, Escher, Bach - Wikipedia', doc: undefined }],
    ['chrome', 'GEB.pdf - Google Chrome', { app: 'Chrome', title: 'GEB.pdf', doc: 'GEB.pdf' }],
    ['chrome', 'Braid - Google Chrome - Work', { title: 'Braid' }],
    ['msedge', `Braid - Wikipedia and 3 more pages - Personal - Microsoft${ZWSP} Edge`, { app: 'Edge', title: 'Braid - Wikipedia' }],
    ['msedge', `GEB.pdf and 2 more pages - Work - Microsoft${ZWSP} Edge`, { title: 'GEB.pdf', doc: 'GEB.pdf' }],
    ['msedge', `Braid - Wikipedia - Microsoft${ZWSP} Edge`, { title: 'Braid - Wikipedia' }],
    ['firefox', 'Braid — Mozilla Firefox', { app: 'Firefox', title: 'Braid' }],
    ['firefox', 'GEB.pdf — Mozilla Firefox', { doc: 'GEB.pdf' }],
    ['AcroRd32', 'GEB.pdf - Adobe Acrobat Reader (64-bit)', { app: 'Acrobat', kind: 'pdf', doc: 'GEB.pdf', page: undefined }],
    ['Acrobat', 'GEB.pdf - Adobe Acrobat Pro DC', { app: 'Acrobat', doc: 'GEB.pdf' }],
    ['Acrobat', 'Private browsing.pdf - Adobe Acrobat Reader', { doc: 'Private browsing.pdf', private: false }],
    ['FoxitPDFReader', 'GEB.pdf - Foxit PDF Reader', { app: 'Foxit', kind: 'pdf', doc: 'GEB.pdf' }],
    ['FoxitPDFEditor', 'Gödel Escher Bach.pdf - Foxit PDF Editor', { doc: 'Gödel Escher Bach.pdf' }],
    ['SumatraPDF', 'GEB.pdf - SumatraPDF', { app: 'SumatraPDF', doc: 'GEB.pdf', page: undefined }],
    ['SumatraPDF', 'GEB.pdf - [Page 12 of 777] - SumatraPDF', { doc: 'GEB.pdf', page: 12 }],
    ['wps', 'GEB.pdf - WPS Office', { app: 'WPS', kind: 'pdf', doc: 'GEB.pdf' }],
    ['wpspdf', 'GEB.pdf - 第 12 页 - WPS PDF', { doc: 'GEB.pdf', page: 12 }],
    ['WINWORD', 'Thesis.docx - Word', { app: 'Word', kind: 'other', doc: 'Thesis.docx' }],
    ['notepad', 'notes.txt - Notepad', { app: 'Notepad', kind: 'other', title: 'notes.txt - Notepad' }],
    // macOS: app names, titles without the app.
    ['Google Chrome', 'Braid - Wikipedia', { app: 'Chrome', title: 'Braid - Wikipedia' }],
    ['Preview', 'GEB.pdf', { app: 'Preview', kind: 'pdf', doc: 'GEB.pdf' }],
  ];
  for (const [proc, title, want] of cases) {
    const got = core.parseWindowTitle(proc, title);
    for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, `${proc} "${title}": ${k}`);
  }
  return cases.length;
}

function privateWindows() {
  const yes = [
    ['chrome', 'Braid - Google Chrome', 'Braid - Google Chrome (Incognito)'],
    ['chrome', 'Braid - Google Chrome (Incognito)'],
    ['chrome', 'Braid - Google Chrome（无痕模式）'],
    ['msedge', `New tab and 1 more page - [InPrivate] - Microsoft${ZWSP} Edge`],
    ['msedge', `Braid - InPrivate - Microsoft${ZWSP} Edge`],
    ['firefox', 'Braid — Mozilla Firefox Private Browsing'],
    ['firefox', 'Mozilla Firefox (Private Browsing)'],
    ['firefox', 'Braid — Mozilla Firefox 隐私浏览'],
    ['brave', 'Braid - Brave (Private)'],
    ['opera', 'Braid - Opera (Private)'],
  ];
  for (const [proc, title, name] of yes) {
    assert.equal(core.isPrivateWindow(proc, title, name), true, `${proc} "${title}" is private`);
    assert.equal(core.parseWindowTitle(proc, title, name).private, true);
    assert.equal(core.parseWindowTitle(proc, title, name).title, undefined, 'nothing is read from a private window');
    assert.equal(core.sourceFromWindow(proc, title, { name, url: 'https://example.com/', paragraph: 'A braid of three.' }, 'braid'), null);
  }
  const no = [
    ['chrome', 'Incognito mode explained - Google Help - Google Chrome', 'Incognito mode explained - Google Help - Google Chrome'],
    ['AcroRd32', 'Private browsing.pdf - Adobe Acrobat Reader (64-bit)'],
    ['chrome', 'Braid - Google Chrome', 'Braid - Google Chrome'],
  ];
  // A page about incognito mode in a normal window is excluded too: the check fails closed.
  assert.equal(core.isPrivateWindow(...no[0]), true);
  assert.equal(core.isPrivateWindow(...no[1]), false);
  assert.equal(core.isPrivateWindow(...no[2]), false);
  return yes.length + no.length;
}

function sentences() {
  const para = 'Mr. Tortoise smiled. In this braid of ideas, Bach, Escher and Gödel turn out to be the same strand! The end.';
  assert.equal(core.extractSentence(para, 'braid'), 'In this braid of ideas, Bach, Escher and Gödel turn out to be the same strand!');
  assert.equal(core.extractSentence('一条金色的辫子。哥德尔、埃舍尔和巴赫。完', '埃舍尔'), '哥德尔、埃舍尔和巴赫。');
  assert.equal(core.extractSentence(para, 'missing'), undefined);
  const long = `${'word '.repeat(120)}the strange loop ${'more '.repeat(120)}.`;
  const cut = core.extractSentence(long, 'strange loop');
  assert.ok(cut.length <= 302, `capped (${cut.length})`);
  assert.ok(cut.startsWith('…') && cut.endsWith('…') && cut.includes('strange loop'));
  assert.deepEqual(core.findWordInSentence('Three braids of hair.', 'braid'), { index: 6, length: 6 });
  assert.deepEqual(core.findWordInSentence('An Eternal Golden Braid', 'braid'), { index: 18, length: 5 });
  assert.equal(core.findWordInSentence('Nothing here', 'braid'), null);
  // The UIA reading becomes a context: URL from the document, sentence from the paragraph.
  const ctx = core.sourceFromWindow(
    'chrome',
    'Braid - Wikipedia - Google Chrome',
    { name: 'Braid - Wikipedia - Google Chrome', url: 'https://en.wikipedia.org/wiki/Braid', paragraph: para, selected: 'braid' },
    'braid',
  );
  assert.deepEqual(ctx, {
    app: 'Chrome',
    title: 'Braid - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Braid',
    sentence: 'In this braid of ideas, Bach, Escher and Gödel turn out to be the same strand!',
  });
  const pdf = core.sourceFromWindow('chrome', 'Gödel, Escher, Bach - Google Chrome', { url: 'https://example.org/books/GEB.pdf', page: 33 }, 'x');
  assert.equal(pdf.doc, 'GEB.pdf', 'a PDF tab is named from its address');
  assert.equal(pdf.page, 33);
  const reader = core.sourceFromWindow('AcroRd32', 'GEB.pdf - Adobe Acrobat Reader (64-bit)', { page: 12 }, 'braid');
  assert.deepEqual(reader, { app: 'Acrobat', doc: 'GEB.pdf', page: 12 });
  return 12;
}

function normalizing() {
  assert.equal(core.normalizeSourceContext({ url: 'file:///C:/Users/me/GEB.pdf' }), null, 'local paths are dropped');
  assert.equal(core.normalizeSourceContext({ url: 'javascript:alert(1)' }), null);
  assert.equal(core.cleanSourceUrl('https://user:pw@example.com/a'), 'https://example.com/a', 'credentials are dropped');
  assert.deepEqual(core.normalizeSourceContext({ app: ' Chrome ', page: '12', doc: 'GEB.pdf', extra: 'x' }), { app: 'Chrome', doc: 'GEB.pdf', page: 12 });
  assert.equal(core.normalizeSourceContext({ page: -3 }), null);
  assert.equal(core.sourceContextFromJson('not json'), undefined);
  assert.deepEqual(core.sourceGroupOf({ doc: 'GEB.pdf', url: 'https://x.org/GEB.pdf' }), { key: 'doc:geb.pdf', kind: 'doc', label: 'GEB.pdf' });
  assert.deepEqual(core.sourceGroupOf({ url: 'https://www.en.wikipedia.org/wiki/Braid' }), { key: 'site:en.wikipedia.org', kind: 'site', label: 'en.wikipedia.org' });
  // A chat or reading app that shows no address groups by the app.
  assert.deepEqual(core.sourceGroupOf({ app: 'Kindle' }), { key: 'app:Kindle', kind: 'app', label: 'Kindle' });
  assert.deepEqual(core.sourceGroupOf({ app: 'Grok', appId: 'ai.x.grok' }), { key: 'app:Grok', kind: 'app', label: 'Grok', appId: 'ai.x.grok' });
  assert.equal(core.sourceGroupOf({ title: 'Untitled' }), null);
  assert.deepEqual(core.normalizeSourceContext({ app: 'Grok', appId: 'ai.x.grok' }), { app: 'Grok', appId: 'ai.x.grok' });
  assert.deepEqual(core.normalizeSourceContext({ app: 'Grok', appId: 'not a package' }), { app: 'Grok' }, 'a malformed package name is dropped');
  assert.equal(core.normalizeSourceContext({ appId: 'ai.x.grok' }), null, 'a package name needs the app it names');
  assert.equal(core.sourceBookTitle('GEB.pdf'), 'GEB');
  assert.equal(core.lookupTextMatches('braids', 'braid'), true);
  assert.equal(core.lookupTextMatches('running', 'run'), true);
  assert.equal(core.lookupTextMatches('ran', 'braid'), false);
  assert.equal(core.lookupTextMatches('ephemeral', 'apple'), false);
  return 19;
}

function sqlDb(db) {
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
  return vocabDb;
}

/** One install: its own core state and its own notebook. */
function device(SQL, name) {
  const c = name === 'main' ? core : loadCore();
  const db = new SQL.Database();
  for (const stmt of c.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) db.run(stmt);
  let n = 0;
  c.configureCore({ http: {}, sha256Hex: () => '', vocabDb: sqlDb(db), newId: () => `${name}-${++n}` });
  return c;
}

async function storage(SQL) {
  device(SQL, 'main');
  const first = { app: 'Acrobat', doc: 'GEB.pdf', page: 12 };
  const saved = await core.addVocab({ lemma: 'braid' });
  assert.equal(saved.context, undefined);
  const filled = await core.setVocabContextIfEmpty(saved.id, first);
  assert.deepEqual(filled.context, first, 'capture fills an empty context');
  assert.equal(await core.setVocabContextIfEmpty(saved.id, { app: 'Chrome', url: 'https://example.com/' }), null, 'and never replaces it');
  await core.addVocab({ lemma: 'braid', context: { app: 'Firefox', url: 'https://example.org/' } });
  assert.deepEqual((await core.findByLemma('braid')).context, first, 'a later save keeps it');
  const withCtx = await core.addVocab({ lemma: 'strand', context: { app: 'Chrome', url: 'https://en.wikipedia.org/wiki/Strand', sentence: 'A strand of hair.' } });
  assert.equal(withCtx.context.sentence, 'A strand of hair.');
  return 5;
}

function cloze() {
  // The Review quiz's gap-fill uses the sentence the word was saved from when the note has none.
  const e = { lemma: 'braid', context: { sentence: '…the three strands of this golden braid are Gödel, Escher and Bach.' } };
  assert.deepEqual(core.clozeFrom(e), { sentence: 'the three strands of this golden _____ are Gödel, Escher and Bach.', form: 'braid' });
  assert.equal(core.clozeFrom({ lemma: 'braid', note: 'She wore a braid to the dance last night.', context: e.context }).sentence, 'She wore a _____ to the dance last night.', 'the note comes first');
  return 2;
}

async function sets(SQL) {
  const a = device(SQL, 'a');
  const t0 = Date.UTC(2026, 10, 1);
  const save = (lemma, context, i) => a.addVocab({ lemma, context }).then((e) => e);
  const geb = { app: 'Acrobat', doc: 'GEB.pdf', page: 40 };
  const wiki = { app: 'Chrome', title: 'Strange loop - Wikipedia', url: 'https://en.wikipedia.org/wiki/Strange_loop' };
  for (const w of ['fugue', 'canon', 'isomorphism', 'recursion']) await save(w, geb);
  await save('tangled', wiki);
  await save('hierarchy', { ...wiki, url: 'https://www.en.wikipedia.org/wiki/Hierarchy' });
  await save('kettle', { app: 'Phone' });
  await save('plain');
  const ctxOf = async () =>
    a.buildWordsContext(await a.listVocab(1000), await a.listBookProgress(), await a.listWordbookSubs(), new Map(), await a.listUserBooks(true));

  // Sources: one group per document, otherwise per site, otherwise per app; unsourced words are left out.
  let ctx = await ctxOf();
  const groups = a.sourceGroups(ctx);
  assert.deepEqual(groups.map((g) => [g.label, g.entries.length]).sort(), [['GEB.pdf', 4], ['Phone', 1], ['en.wikipedia.org', 2]]);
  assert.deepEqual(groups.find((g) => g.kind === 'doc').entries.map((e) => e.lemma), ['fugue', 'canon', 'isomorphism', 'recursion'], 'in saved order');
  assert.match(a.wordsScopeSwitchHtml('mine', ctx, false), /data-scope="sources"/, 'the switcher offers Sources');
  let html = a.sourcesHtml(ctx);
  assert.match(html, /GEB\.pdf/);
  assert.match(html, /data-act="src-book" data-source="doc:geb\.pdf"/);
  assert.match(html, /4 words/);

  // Make a word book from a source; it is subscribed and shows in the switcher with its progress.
  const g = groups.find((x) => x.key === 'doc:geb.pdf');
  const book = await a.createUserBook(a.sourceBookTitle(g.label), g.entries.map((e) => e.lemma), g.key);
  assert.ok(a.isUserBookId(book.bookId));
  assert.equal(book.title, 'GEB');
  ctx = await ctxOf();
  assert.ok(ctx.subs.some((s) => s.bookId === book.bookId), 'subscribed');
  assert.match(a.wordsScopeSwitchHtml('mine', ctx, false), new RegExp(`data-scope="${book.bookId}"[^>]*title="GEB: 0 of 4 known"`));
  html = a.sourcesHtml(ctx);
  assert.match(html, /Open word book/);
  assert.doesNotMatch(html, /data-source="doc:geb\.pdf">Make a word book/);
  assert.match(a.wordbookHeaderHtml(book.bookId, ctx), /value="GEB"/);
  assert.match(a.wordbookHeaderHtml(book.bookId, ctx), /From geb\.pdf/);
  // Progress belongs to the word: reviewing a saved word counts in the book.
  const fugue = (await a.listVocab(1000)).find((e) => e.lemma === 'fugue');
  await a.reviewVocab(fugue.id, 3);
  ctx = await ctxOf();
  assert.equal(a.bookProgress(book.bookId, ctx).learning, 1);
  assert.match(a.wordbookListHtml(a.scopeEntries(book.bookId, ctx), { scope: book.bookId, limit: 50 }), /data-act="ub-drop"/);

  // Rename, add and remove words; a later save from the source can be added in one go.
  await a.renameUserBook(book.bookId, 'Gödel, Escher, Bach');
  await a.addUserBookWords(book.bookId, ['strange loop', 'Fugue']);
  await a.removeUserBookWord(book.bookId, 'canon');
  await save('counterpoint', geb);
  ctx = await ctxOf();
  assert.deepEqual(ctx.books.get(book.bookId), ['fugue', 'isomorphism', 'recursion', 'strange loop']);
  assert.equal(a.wordbookMeta(book.bookId).title, 'Gödel, Escher, Bach');
  assert.match(a.sourcesHtml(ctx), /Add 2 new/, 'canon and counterpoint are not in the book');

  // Sync: the book reaches another device as records without progress, split when long.
  const server = (() => {
    const records = new Map();
    let seq = 0;
    return {
      records,
      sync(ns, cursor, changes) {
        assert.equal(ns, 'phevere/wordbooks');
        for (const c of changes) {
          assert.ok(JSON.stringify(c).length < 64 * 1024, `${c.id} fits in 64 KB`);
          const prev = records.get(c.id);
          if (prev && c.updatedAt <= prev.updatedAt) continue;
          records.set(c.id, { ...c, seq: ++seq });
        }
        const out = [...records.values()].filter((r) => r.seq > cursor).sort((x, y) => x.seq - y.seq);
        return { changes: out.map(({ seq: _s, ...r }) => r), cursor: out.length ? out[out.length - 1].seq : cursor, more: false };
      },
    };
  })();
  const account = { getUser: async () => ({ id: 'u1' }), sync: async (ns, c, ch) => server.sync(ns, c, JSON.parse(JSON.stringify(ch))) };
  const long = Array.from({ length: 9000 }, (_, i) => `word${i}-${'x'.repeat(i % 30)}`);
  const big = await a.createUserBook('Long list', long, 'site:example.com');
  await a.syncWordbooks(account);
  const head = server.records.get(`book:${book.bookId}`);
  assert.deepEqual(Object.keys(head.data).sort(), ['createdAt', 'deleted', 'name', 'parts', 'source', 'words']);
  assert.ok(server.records.has(`book:${big.bookId}:1`), 'a long list continues in a second record');
  const b = device(SQL, 'b');
  await b.syncWordbooks(account);
  const bBooks = await b.listUserBooks();
  assert.deepEqual(bBooks.find((x) => x.bookId === book.bookId).words, ['fugue', 'isomorphism', 'recursion', 'strange loop']);
  assert.equal(bBooks.find((x) => x.bookId === book.bookId).title, 'Gödel, Escher, Bach');
  assert.deepEqual(bBooks.find((x) => x.bookId === big.bookId).words, long, 'every piece assembled in order');
  assert.ok((await b.listWordbookSubs()).some((s) => s.bookId === book.bookId), 'subscription synced');

  // Deleting on one device deletes everywhere; the words keep their progress.
  await b.deleteUserBook(book.bookId, Date.now() + 5000);
  await b.syncWordbooks(account);
  await a.syncWordbooks(account);
  assert.equal((await a.listUserBooks()).some((x) => x.bookId === book.bookId), false);
  ctx = await ctxOf();
  assert.ok(!ctx.subs.some((s) => s.bookId === book.bookId));
  assert.match(a.sourcesHtml(ctx), /data-source="doc:geb\.pdf">Make a word book/, 'the source can be made into a book again');
  assert.equal(a.splitWords(['a', 'b', 'c'], 10).length, 2);
  return 30;
}

/** Words saved from an app that shows no address (the phone's pop-up over a chat app). */
async function appSources(SQL) {
  const a = device(SQL, 'apps');
  const ctxOf = async () =>
    a.buildWordsContext(await a.listVocab(1000), await a.listBookProgress(), await a.listWordbookSubs(), new Map(), await a.listUserBooks(true));
  // An older save knew only the app's name; later ones also carry its package name.
  await a.addVocab({ lemma: 'gist', context: { app: 'Grok' } });
  await a.addVocab({ lemma: 'nuance', context: { app: 'Grok', appId: 'ai.x.grok' } });
  await a.addVocab({ lemma: 'braid', context: { app: 'Chrome', url: 'https://en.wikipedia.org/wiki/Braid' } });
  assert.deepEqual((await a.findByLemma('nuance')).context, { app: 'Grok', appId: 'ai.x.grok' }, 'the package name is kept with the word');
  const ctx = await ctxOf();
  const grok = a.sourceGroups(ctx).find((g) => g.kind === 'app');
  assert.deepEqual([grok.key, grok.label, grok.appId, grok.entries.map((e) => e.lemma)], ['app:Grok', 'Grok', 'ai.x.grok', ['gist', 'nuance']], 'one group for the app');
  assert.match(a.wordsScopeSwitchHtml('mine', ctx, false), /data-scope="sources"/, 'the switcher offers Sources');
  // Without an icon (desktop, or the app is not on this phone): the app's first letter.
  a.setAppIconSource(null);
  let html = a.sourcesHtml(ctx);
  assert.match(html, /wb-src__icon--app" aria-hidden="true"><b>G<\/b><\/span>/);
  assert.match(html, /data-act="src-book" data-source="app:Grok"/, 'an app can become a word book');
  // On the phone: the app's launcher icon over the letter.
  const asked = [];
  a.setAppIconSource((id) => { asked.push(id); return 'data:image/png;base64,AAAA'; });
  html = a.sourcesHtml(ctx);
  assert.deepEqual(asked, ['ai.x.grok']);
  assert.match(html, /<b>G<\/b><img src="data:image\/png;base64,AAAA"/);
  a.setAppIconSource(null);
  return 6;
}

(async () => {
  const SQL = await initSqlJs();
  let n = titles() + privateWindows() + sentences() + normalizing() + cloze();
  n += await storage(SQL);
  n += await sets(SQL);
  n += await appSources(SQL);
  console.log(`test-word-sources: ok (${n} checks)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
