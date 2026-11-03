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
    `,
    resolveDir: path.join(root, 'packages', 'core'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
const core = mod.exports;

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
  assert.equal(core.sourceGroupOf({ app: 'Kindle' }), null);
  assert.equal(core.sourceBookTitle('GEB.pdf'), 'GEB');
  assert.equal(core.lookupTextMatches('braids', 'braid'), true);
  assert.equal(core.lookupTextMatches('running', 'run'), true);
  assert.equal(core.lookupTextMatches('ran', 'braid'), false);
  assert.equal(core.lookupTextMatches('ephemeral', 'apple'), false);
  return 14;
}

async function storage() {
  const SQL = await initSqlJs();
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
  core.configureCore({ http: {}, sha256Hex: () => '', vocabDb, newId: () => `id-${++n}` });
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

(async () => {
  let n = titles() + privateWindows() + sentences() + normalizing();
  n += await storage();
  console.log(`test-word-sources: ok (${n} checks)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
