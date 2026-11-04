/**
 * Search suggestions (packages/core/src/word-suggest.ts): words ranked by frequency from the
 * shipped word books blended with Datamuse's corpus frequencies, inflected
 * forms and proper nouns left out, and a spelling correction only when nothing begins with
 * what was typed.
 *
 * Run: node scripts/test-word-suggest.js
 */
const assert = require('assert/strict');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
  stdin: {
    contents: `
      export * from './src/word-suggest';
      export { configureCore } from './src/runtime';
    `,
    resolveDir: path.join(root, 'packages', 'core'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  loader: { '.json': 'json' },
  write: false,
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
const core = mod.exports;

(async () => {
  // The shipped books: "the" and other common words come before rarer ones.
  await core.warmSuggestions();
  const th = core.peekSuggestions('th', 6);
  assert.equal(th[0], 'the', `th → ${th.join(', ')}`);
  const eq = core.peekSuggestions('equi', 6);
  assert.ok(eq.includes('equipment'), `equi → ${eq.join(', ')}`);
  assert.ok(eq.indexOf('equipment') < Math.max(0, eq.indexOf('equilibrium')) || !eq.includes('equilibrium'));
  assert.deepEqual(core.peekSuggestions('', 6), []);
  assert.ok(!core.peekSuggestions('the', 6).includes('the'), 'the typed word itself is the lookup row');

  // Fixed books: NGSL order wins over a later book's order.
  core._setSuggestionBooks([
    { id: 'ngsl', order: 'frequency', words: ['change', 'chance', 'chair'] },
    { id: 'kaoyan', order: 'frequency', words: ['champion', 'chamber', 'chair'] },
    { id: 'nawl', order: 'alphabetical', words: ['chaos'] },
  ]);
  assert.deepEqual(core.peekSuggestions('cha', 10), ['change', 'chance', 'chair', 'champion', 'chamber', 'chaos']);

  // Datamuse adds words; a correction shows only without prefix matches.
  const calls = [];
  core.configureCore({
    http: {
      async requestJson(url) {
        calls.push(url);
        if (url.includes('sp=cha')) {
          return [
            { word: 'chapter', tags: ['n', 'f:40'] },
            { word: 'changes', tags: ['n', 'f:90'] },
            { word: 'change', tags: ['n', 'v', 'f:100'] },
            { word: 'charlotte', tags: ['n', 'prop', 'f:60'] },
            { word: 'chain of command', tags: ['n', 'f:50'] },
          ];
        }
        if (url.includes('sp=definately*')) return [{ word: 'definately', tags: ['f:0.007'] }];
        if (url.includes('sp=recieve*')) return [{ word: 'recieved', tags: ['f:0.02'] }, { word: 'reciever', tags: ['f:0.01'] }];
        if (url.includes('sp=recieve&')) return [{ word: 'relieve', tags: ['f:6.8'] }];
        if (url.includes('sp=equip*')) {
          return [{ word: 'equipment', tags: ['n', 'f:80'] }, { word: 'equipped', tags: ['v', 'f:9'] }, { word: 'equip', tags: ['v', 'f:3'] }];
        }
        if (url.includes('sp=paparaz*')) return [{ word: 'paparazzi', tags: ['n', 'f:0.079'] }];
        if (url.includes('sp=definately&')) {
          return [{ word: 'definately', tags: ['f:0.007'] }, { word: 'definitely', tags: ['f:13.5'] }, { word: 'delicately', tags: ['f:1.6'] }];
        }
        return [];
      },
      async requestText() { return { ok: false, status: 0, text: '' }; },
      async requestBytes() { return { ok: false, status: 0, bytes: new Uint8Array(), contentType: '' }; },
    },
    sha256Hex: () => '',
    lookupOffline: async () => null,
    vocabDb: null,
    newId: () => 'x',
  });
  // Book rank and corpus frequency blended; no plural of a listed word, no proper noun, no phrase.
  assert.deepEqual(await core.suggestWords('cha', 4), ['change', 'chance', 'chair', 'chapter']);
  assert.deepEqual(core.peekSuggestions('cha', 4), ['change', 'chance', 'chair', 'chapter'], 'cached for the sync path');
  await core.suggestWords('cha', 4);
  assert.equal(calls.filter((u) => u.includes('sp=cha')).length, 1, 'one request per prefix');
  core._setSuggestionBooks([{ id: 'ngsl', order: 'frequency', words: ['receive', 'relieve', 'recipe'] }]);
  assert.deepEqual(core.peekSuggestions('recieve', 4), ['receive', 'relieve'], 'local corrections, closest first');
  assert.deepEqual(await core.suggestWords('definately', 4), ['definitely', 'delicately'], 'Datamuse corrections by frequency, rare spellings dropped');
  assert.deepEqual(await core.suggestWords('recieve', 4), ['receive', 'relieve'], 'local correction before rare misspellings');
  assert.deepEqual(await core.suggestWords('equip', 4), ['equipment'], 'no doubled-consonant form, and not the typed word');
  assert.deepEqual(await core.suggestWords('paparaz', 4), ['paparazzi'], 'rare but real words stay');
  console.log('word-suggest: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
