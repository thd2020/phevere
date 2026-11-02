/* Run: node scripts/test-notebook-views.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const coreDir = path.join(__dirname, '..', 'packages', 'core', 'src');
const cache = new Map();

/** Load a core TS module and the core modules it imports, transpiled to CommonJS. */
function load(name) {
  const file = path.join(coreDir, name.replace(/^\.\//, '') + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (dep) => (dep.startsWith('.') ? load(dep) : require(dep)));
  return mod.exports;
}

const { analyzeMorphemes, morphBreakdown } = load('morphology');
const views = load('notebook-views');
const { recentListHtml, vocabEntryHtml } = load('vocab-view');

const split = (w) => morphBreakdown(w).join('·');
const labels = (w) => analyzeMorphemes(w).map((m) => `${m.kind}:${m.label}`);

// Word parts.
assert.equal(split('inspector'), 'in·spect·or');
assert.equal(split('prediction'), 'pre·dict·ion');
assert.equal(split('destruction'), 'de·struct·ion');
assert.equal(split('international'), 'inter·nat·ion·al');
assert.equal(split('spectator'), 'spect·ator');
assert.deepEqual(labels('telephone'), ['prefix:tele-', 'root:phon']);
assert.deepEqual(labels('unhappy'), ['prefix:un-']);
// No false parts on words without them.
for (const w of ['serendipity', 'germane', 'rest', 'disk', 'never', 'open', 'apple', 'bank']) {
  assert.ok(!labels(w).some((l) => l.startsWith('prefix') || l.startsWith('root')), `${w}: ${labels(w)}`);
}
// Han words split into characters.
assert.deepEqual(analyzeMorphemes('要対応').map((m) => m.label), ['要', '対', '応']);
assert.deepEqual(analyzeMorphemes('猫'), []);

const now = Date.UTC(2026, 10, 2, 12);
const DAY = 86_400_000;
const entries = [
  ['inspect', 0], ['inspector', 1], ['spectator', 2], ['nation', 3], ['national', 4], ['nationality', 5],
  ['対応', 6], ['対策', 7], ['apple', 8],
].map(([lemma, i]) => ({ id: `id${i}`, lemma, definition: `${lemma} sense`, createdAt: now - i * DAY, updatedAt: now - i * DAY }));

const a = views.analyzeNotebook(entries);
const fam = (key) => a.families.find((f) => f.key === key);
assert.deepEqual(fam('root:spect').ids.sort(), ['id0', 'id1', 'id2']);
assert.deepEqual(fam('char:対').ids.sort(), ['id6', 'id7']);
assert.equal(a.parent.get('id1'), 'id0', 'inspector grows from inspect');
assert.equal(a.parent.get('id4'), 'id3', 'national grows from nation');
assert.equal(a.parent.get('id5'), 'id4', 'nationality grows from national');
assert.ok(!a.parent.has('id8'));

assert.deepEqual(views.familyGroupings(a), ['root', 'prefix', 'suffix', 'origin', 'tree', 'char']);
const fhtml = views.familiesHtml(a, 'root');
assert.match(fhtml, /in<b>spect<\/b>or/);
assert.match(views.familiesHtml(a, 'tree'), /nationality/);

// Map: deterministic layout, every edge points at real nodes.
const m1 = views.layoutNotebookMap(a, { kinds: ['root', 'char'] });
const m2 = views.layoutNotebookMap(a, { kinds: ['root', 'char'] });
assert.deepEqual(m1.nodes.map((n) => [n.x, n.y]), m2.nodes.map((n) => [n.x, n.y]));
assert.ok(m1.edges.every((e) => m1.nodes[e.a] && m1.nodes[e.b]));
assert.ok(m1.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
assert.match(views.mapHtml(a, ['root']), /<svg class="nbv-map__svg"/);

// Review queue: due reviews first, then new words up to the goal.
const rq = [
  { id: 'due', lemma: 'a', reps: 2, reviewDue: now - DAY, createdAt: now - 9 * DAY },
  { id: 'later', lemma: 'b', reps: 2, reviewDue: now + 5 * DAY, createdAt: now - 9 * DAY },
  { id: 'new1', lemma: 'c', reps: 0, createdAt: now - 3 * DAY },
  { id: 'new2', lemma: 'd', reps: 0, createdAt: now - 2 * DAY },
  { id: 'new3', lemma: 'e', reps: 0, createdAt: now - 1 * DAY },
];
assert.deepEqual(views.reviewQueue(rq, 2, now), ['due', 'new1', 'new2']);
const rh = views.reviewHtml(rq, { queue: ['due'], index: 0, revealed: false, done: 0 }, 10, now);
assert.match(rh, /Show meaning/);
assert.match(views.reviewHtml(rq, { queue: ['due'], index: 0, revealed: true, done: 0 }, 10, now), /data-grade="4"/);
assert.match(views.reviewHtml(rq, { queue: [], index: 0, revealed: false, done: 0 }, 10, now), /Nothing due today/);

// Rows: Look up sits in the collapsed row, not only in the details.
const row = vocabEntryHtml({ id: 'x', lemma: 'inspect', definition: 'look' }, false, now);
const head = row.slice(0, row.indexOf('vocab-entry__details'));
assert.match(head, /data-act="lookup"/);
assert.match(head, /data-act="nb-play"/);

// Recent lookups use the notebook row and show what the notebook knows.
const rec = recentListHtml(
  [{ q: 'inspect', at: now - 1000 }, { q: 'gargantuan', at: now - 2000 }, { q: 'old', at: 0 }],
  (q) => (q === 'inspect' ? { id: 'x', lemma: 'inspect', reading: 'US /ɪnˈspɛkt/', partOfSpeech: 'verb' } : undefined),
  now,
);
assert.match(rec, /class="vocab-item recent-item is-collapsed is-saved"/);
assert.match(rec, /\/ɪnˈspɛkt\//);
assert.equal((rec.match(/class="vocab-group"/g) || []).length, 2, 'Today and Earlier');
assert.equal((rec.match(/data-act="lookup"/g) || []).length, 6, 'row and button per item');

console.log('notebook-views: ok');
