/**
 * The phone's notebook shared by two pages (apps/mobile/src/platform/sqljs-vocab-db.ts): the
 * app and the pop-up over another app each hold a copy in memory over one file. A word saved in
 * the pop-up reaches the file at once, shows in the open app, and survives a later save in the
 * app; nothing is lost when the pop-up closes right after Save. The native side
 * (android/.../Notebook.java) is simulated: a version per write, stale writes refused, and the
 * other pages told about each write.
 *
 * Run: node scripts/test-notebook-pages.js
 * Against another copy of the module: node scripts/test-notebook-pages.js path/to/sqljs-vocab-db.ts
 */
const assert = require('assert/strict');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const dbSource = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'apps/mobile/src/platform/sqljs-vocab-db.ts');
const nativeSource = path.join(root, 'apps/mobile/src/platform/native.ts');
const wasm = require.resolve('sql.js/dist/sql-wasm.wasm');

let pageBundle = '';
const pageBundleReady = esbuild.build({
  stdin: {
    contents: `export * from ${JSON.stringify(dbSource)}; export { installNativeCallbacks } from ${JSON.stringify(nativeSource)};`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['sql.js'],
  plugins: [{
    name: 'phone-page',
    setup(build) {
      build.onResolve({ filter: /sql-wasm\.wasm\?url$/ }, () => ({ path: 'wasm-url', namespace: 'stub' }));
      build.onResolve({ filter: /^@phevere\/core$/ }, () => ({ path: 'core', namespace: 'stub' }));
      // Both copies of the module must share the one native.ts.
      build.onResolve({ filter: /^\.\/native$/ }, () => ({ path: nativeSource }));
      build.onLoad({ filter: /^wasm-url$/, namespace: 'stub' }, () => ({ contents: `export default ${JSON.stringify(wasm)};`, loader: 'js' }));
      build.onLoad({ filter: /^core$/, namespace: 'stub' }, () => ({
        contents: `export { VOCAB_SCHEMA_SQL, vocabColumnMigrations } from ${JSON.stringify(path.join(root, 'packages/core/src/schema.ts'))};
export { t } from ${JSON.stringify(path.join(root, 'packages/core/src/i18n/runtime.ts'))};`,
        loader: 'ts',
        resolveDir: root,
      }));
    },
  }],
}).then((r) => { pageBundle = r.outputFiles[0].text; });

const coreBundle = esbuild.buildSync({
  stdin: {
    contents: `
      export { configureCore } from './src/runtime';
      export { addVocab, findByLemma, listVocab } from './src/vocab-store';
      export { syncVocab } from './src/vocab-sync';
    `,
    resolveDir: path.join(root, 'packages', 'core'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;

function load(code, globals) {
  const mod = { exports: {} };
  const names = Object.keys(globals);
  new Function('module', 'exports', 'require', ...names, code)(mod, mod.exports, require, ...names.map((n) => globals[n]));
  return mod.exports;
}

async function settle(ms = 0) {
  const tick = () => new Promise((r) => setImmediate(r));
  for (let i = 0; i < 30; i++) await tick();
  if (ms) await new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30; i++) await tick();
}

/** The phone: one notebook file, one version counter, and the pages open over it. */
function phone() {
  const file = { b64: null, version: 1, writes: 0 };
  const pages = [];
  function call(page, method, params) {
    if (page.failRead && method === 'notebookRead') throw new Error('Out of memory');
    switch (method) {
      case 'notebookRead':
        return { b64: file.b64, version: file.version };
      case 'notebookVersion':
        return { version: file.version };
      case 'notebookWrite': {
        if (params.base !== file.version) return { conflict: true, version: file.version };
        file.b64 = params.b64;
        file.version += 1;
        file.writes += 1;
        const v = file.version;
        for (const other of pages) if (other !== page && !other.deaf) setImmediate(() => other.window.__pvNotebookChanged?.(v));
        return { ok: true, version: v };
      }
      // The bridge before this change, for measuring the old module.
      case 'readFile':
        return { b64: file.b64 };
      case 'writeFile':
        file.b64 = params.b64;
        file.writes += 1;
        return { ok: true };
      case 'notebookFlushed':
        page.flushed += 1;
        return { ok: true };
      default:
        throw new Error(`Unknown method ${method}`);
    }
  }
  function open(name, opts = {}) {
    const listeners = {};
    const page = { name, deaf: false, failRead: !!opts.failRead, flushed: 0 };
    const window = {
      setTimeout,
      clearTimeout,
      PhevereBridge: {
        call(method, id, json) {
          setImmediate(() => {
            let out;
            try {
              out = call(page, method, JSON.parse(json));
            } catch (err) {
              out = { error: err.message };
            }
            window.__pvResolve(id, JSON.stringify(out));
          });
        },
      },
    };
    const document = {
      visibilityState: 'visible',
      addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    };
    const fire = (state) => {
      document.visibilityState = state;
      for (const fn of listeners.visibilitychange || []) fn();
    };
    Object.assign(page, { window, hide: () => fire('hidden'), show: () => fire('visible') });
    page.mod = load(pageBundle, { window, document, localStorage: undefined });
    page.mod.installNativeCallbacks();
    page.db = page.mod.sqlJsVocabDb;
    page.core = load(coreBundle, {});
    let n = 0;
    page.core.configureCore({ http: {}, sha256Hex: () => '', vocabDb: page.db, newId: () => `${name}-${++n}` });
    pages.push(page);
    return page;
  }
  return { file, open };
}

async function fileWords(file) {
  if (!file.b64) return [];
  const SQL = await require('sql.js')();
  const db = new SQL.Database(Buffer.from(file.b64, 'base64'));
  const rows = db.exec('SELECT lemma FROM vocab')[0];
  db.close();
  return rows ? rows.values.map((r) => String(r[0])).sort() : [];
}

const words = async (page) => (await page.core.listVocab(100)).map((e) => e.lemma).sort();
/** The old module has no flush: wait out its 400 ms batching instead. */
const flush = async (page) => (page.mod.flushNotebook ? page.mod.flushNotebook() : settle(600));

async function main() {
  await pageBundleReady;
  let checks = 0;
  const ph = phone();
  const app = ph.open('app');
  await app.db.ready();
  await app.core.addVocab({ lemma: 'braid' });
  await flush(app);
  // The reader switches to the chat app; the app stays alive in the background.
  app.hide();
  let reloaded = 0;
  app.mod.onNotebookReloaded?.(() => { reloaded += 1; });

  // The pop-up opens over the chat app and saves a word.
  const popup = ph.open('popup');
  await popup.db.ready();
  await popup.core.addVocab({ lemma: 'gist', context: { app: 'Grok', appId: 'ai.x.grok' } });
  await flush(popup);
  await settle();
  assert.deepEqual(await fileWords(ph.file), ['braid', 'gist'], 'the pop-up save is in the file at once');
  assert.ok(reloaded >= 1, 'the open app was told and reloaded');
  app.show();
  await settle();
  assert.deepEqual(await words(app), ['braid', 'gist'], 'My words in the app shows the word without a restart');
  assert.deepEqual((await app.core.findByLemma('gist')).context, { app: 'Grok', appId: 'ai.x.grok' }, 'with where it came from');
  checks += 4;

  // The app saves next; its copy must not write the pop-up's word away.
  await app.core.addVocab({ lemma: 'canon' });
  await flush(app);
  assert.deepEqual(await fileWords(ph.file), ['braid', 'canon', 'gist'], 'a later save in the app keeps the pop-up word');
  checks++;

  // A stale copy: the app missed the notice (its page was paused) and saved on top.
  app.deaf = true;
  await popup.core.addVocab({ lemma: 'nuance' });
  await flush(popup);
  await app.core.addVocab({ lemma: 'fugue' });
  await flush(app);
  app.deaf = false;
  await settle();
  assert.deepEqual(await fileWords(ph.file), ['braid', 'canon', 'fugue', 'gist', 'nuance'], 'a stale write is refused, reloaded and applied again');
  assert.deepEqual(await words(popup), ['braid', 'canon', 'fugue', 'gist', 'nuance'], 'and the pop-up sees the app’s word');
  checks += 2;

  // A missed notice is picked up on demand (coming back to the front, or before a sync).
  app.deaf = true;
  await popup.core.addVocab({ lemma: 'motif' });
  await flush(popup);
  app.deaf = false;
  await app.db.refresh();
  assert.ok((await words(app)).includes('motif'), 'refresh() reads the newer file');
  checks++;

  // Save, then a tap outside at once: the pop-up asks its page to finish writing first.
  await popup.core.addVocab({ lemma: 'cadence' });
  assert.equal(popup.window.__pvFlushNotebook(), true, 'something to write: native waits');
  await settle();
  assert.ok((await fileWords(ph.file)).includes('cadence'), 'written before the pop-up closes');
  assert.equal(popup.flushed, 1, 'and native is told it may close');
  assert.equal(popup.window.__pvFlushNotebook(), false, 'nothing left: it closes at once');
  checks += 4;

  // A dictionary pack installs in the app while the pop-up saves a word: both stay, and the
  // install does not fail on a copy swapped out under it.
  const fill = async (d, pause) => {
    d.run('DELETE FROM offline_entries WHERE pack_id = ?', ['p1']);
    for (let i = 0; i < 50; i++) {
      d.run('INSERT INTO offline_entries (headword, language, definition, pack_id) VALUES (?, ?, ?, ?)', [`h${i}`, 'en', 'd', 'p1']);
      if (pause && i === 25) await settle(50);
    }
  };
  const popupSave = (async () => {
    await settle(10);
    await popup.core.addVocab({ lemma: 'ostinato' });
    await flush(popup);
  })();
  if (app.mod.writeDirect) await app.mod.writeDirect((d) => fill(d, true), (d) => fill(d, false));
  else {
    // The module before this fix: rows straight on the database, then marked dirty.
    await fill(app.mod.getSqlDatabase(), true);
    app.mod.markDbDirty();
  }
  await popupSave;
  await settle();
  await flush(app);
  await settle();
  assert.ok((await fileWords(ph.file)).includes('ostinato'), 'the pop-up word survives the pack install');
  const packRows = async () => {
    const SQL = await require('sql.js')();
    const d = new SQL.Database(Buffer.from(ph.file.b64, 'base64'));
    const n = d.exec("SELECT COUNT(*) FROM offline_entries WHERE pack_id = 'p1'")[0].values[0][0];
    d.close();
    return n;
  };
  assert.equal(await packRows(), 50, 'and the pack is whole in the file');
  // The pop-up saves after the install, before the app has written it: the pack is made
  // again on the newer file rather than the app's copy replacing it.
  if (app.mod.writeDirect) await app.mod.writeDirect((d) => fill(d, false), (d) => fill(d, false));
  else {
    await fill(app.mod.getSqlDatabase(), false);
    app.mod.markDbDirty();
  }
  await popup.core.addVocab({ lemma: 'coda' });
  await flush(popup);
  await settle();
  await flush(app);
  await settle();
  assert.ok((await fileWords(ph.file)).includes('coda'), 'a word saved just after a pack install is kept');
  assert.equal(await packRows(), 50, 'with the pack');
  checks += 4;

  // The pop-up saves a word a moment before a sync in the app starts, and its write reaches the
  // file only after the sync has read the notebook. The next sync still sends the word.
  const sent = new Set();
  const account = {
    getUser: async () => ({ id: 'u1' }),
    async sync(_ns, cursor, changes) {
      for (const c of changes) sent.add(c.data?.lemma);
      return { changes: [], cursor, more: false };
    },
  };
  await app.core.syncVocab(account);
  await popup.core.addVocab({ lemma: 'refrain' });
  await settle(5);
  await app.core.syncVocab(account);
  assert.ok(!sent.has('refrain'), 'not in the app yet');
  await flush(popup);
  await settle();
  await app.core.syncVocab(account);
  assert.ok(sent.has('refrain'), 'a pop-up word that reached the app after a sync goes out with the next one');
  checks += 2;

  // A notebook that exists but cannot be read is an error, never a fresh empty notebook.
  const broken = ph.open('broken', { failRead: true });
  await assert.rejects(() => broken.db.ready(), /Out of memory/);
  assert.equal(broken.db.initError(), 'Out of memory');
  checks += 2;

  console.log(`test-notebook-pages: ok (${checks} checks, ${ph.file.writes} file writes)`);
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
