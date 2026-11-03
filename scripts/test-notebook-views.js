/* Run: node scripts/test-notebook-views.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const coreDir = path.join(__dirname, '..', 'packages', 'core', 'src');
const cache = new Map();

/** Load a core TS module and the core modules it imports, transpiled to CommonJS. */
function load(name) {
  const base = path.join(coreDir, name.replace(/^\.\//, ''));
  // Core is TypeScript, except a few small JavaScript shims such as notebook-map-load.js.
  const file = fs.existsSync(base + '.ts') ? base + '.ts' : base + '.js';
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
// The 3D layout is deterministic too, centred on the origin, with z in use.
const m3a = views.layoutNotebookMap(a, { kinds: ['root', 'char'], dimensions: 3 });
const m3b = views.layoutNotebookMap(a, { kinds: ['root', 'char'], dimensions: 3 });
assert.deepEqual(m3a.nodes.map((n) => [n.x, n.y, n.z]), m3b.nodes.map((n) => [n.x, n.y, n.z]));
assert.ok(m3a.nodes.some((n) => n.z !== 0), 'uses depth');
assert.ok(m3a.radius > 0 && m3a.nodes.every((n) => Math.hypot(n.x, n.y, n.z) <= m3a.radius + 1));
// Words sit nearer their own morpheme than the morphemes are to each other.
const hubOf = (label) => m3a.nodes.find((n) => n.kind !== 'word' && n.label === label);
const wordOf = (label) => m3a.nodes.find((n) => n.kind === 'word' && n.label === label);
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
assert.ok(dist(wordOf('spectator'), hubOf('spect')) < dist(hubOf('spect'), hubOf('対')));
// mapHtml hands the renderers the graph as JSON, with search, filters and the controls.
const mh = views.mapHtml(a, ['root', 'char']);
const json = mh.match(/<script type="application\/json" data-map-data>([\s\S]*?)<\/script>/);
assert.ok(json, 'graph data embedded');
const md = JSON.parse(json[1]);
assert.equal(md.nodes.length, m3a.nodes.length);
assert.ok(md.edges.every(([x, y]) => md.nodes[x] && md.nodes[y]));
assert.match(mh, /data-map-search/);
assert.match(mh, /<option value="inspector">/);
assert.match(mh, /data-act="nb-map-kind" data-kind="root"/);
assert.match(mh, /data-map-act="reset"/);
assert.equal(views.notebookMapData(a, ['root', 'char']), views.notebookMapData(a, ['root', 'char']), 'layout cached');

// Cards: piles by when the words were saved, newest pile and newest card first.
const piles = views.cardPiles(entries, now);
assert.deepEqual(piles.map((p) => p.label).slice(0, 2), ['This week', 'Last week']);
assert.equal(piles.reduce((n, p) => n + p.ids.length, 0), entries.length, 'every card in exactly one pile');
assert.equal(piles[0].ids[0], 'id0', 'newest word on top');
// Past six piles the oldest months fold into "Earlier".
const longAgo = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, lemma: `w${i}`, createdAt: Date.UTC(2025, i, 15) }));
const folded = views.cardPiles(longAgo, now);
assert.equal(folded.length, 6);
assert.equal(folded[5].label, 'Earlier');
assert.equal(folded[0].label, 'December 2025');
assert.equal(folded.reduce((n, p) => n + p.ids.length, 0), 12);

const chtml = views.cardsHtml(entries, a, new Set(['id1']), 'scatter', now);
assert.match(chtml, /<div class="nbv-table" data-layout="scatter">/);
assert.match(chtml, /data-cards-layout="piles"[^>]*aria-pressed="false"/);
assert.match(chtml, /data-cards-layout="scatter"[^>]*aria-pressed="true"/);
assert.match(chtml, /data-cards-layout="grid"/);
// A tap on a card is a lookup; the meaning flip is its own button.
assert.equal((chtml.match(/<article class="nbv-card[^"]*" data-act="lookup" data-q="[^"]+"/g) || []).length, entries.length);
assert.match(chtml, /<article class="nbv-card" data-act="lookup" data-q="inspect"[^>]*tabindex="0"/);
assert.equal((chtml.match(/<button type="button" class="nbv-card__flip" data-act="nb-flip"/g) || []).length, entries.length);
assert.match(chtml, /class="nbv-card is-flipped" data-act="lookup" data-q="inspector"/);
assert.match(chtml, /class="nbv-pile[^"]*" data-pile="week"/);
assert.match(chtml, /This week<b>\d+<\/b>/);
assert.match(chtml, /data-img-lemma="spectator"/);
assert.match(views.cardsHtml(entries, a, new Set(), undefined, now), /data-layout="piles"/);
assert.match(views.cardsHtml([], a, new Set()), /No saved words/);
// Only the top cards of a big pile are drawn; the rest are marked deep.
const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, lemma: `word${i}`, createdAt: now - i * 1000 }));
const mhtml = views.cardsHtml(many, views.analyzeNotebook(many), new Set(), 'piles', now);
assert.equal((mhtml.match(/ data-deep /g) || []).length, 30 - views.PILE_FACE_CARDS);
assert.match(mhtml, /class="nbv-pile has-depth"/);

// Review queue: due reviews first, then new words up to the goal.
const rq = [
  { id: 'due', lemma: 'a', reps: 2, reviewDue: now - DAY, createdAt: now - 9 * DAY },
  { id: 'later', lemma: 'b', reps: 2, reviewDue: now + 5 * DAY, createdAt: now - 9 * DAY },
  { id: 'new1', lemma: 'c', reps: 0, createdAt: now - 3 * DAY },
  { id: 'new2', lemma: 'd', reps: 0, createdAt: now - 2 * DAY },
  { id: 'new3', lemma: 'e', reps: 0, createdAt: now - 1 * DAY },
];
assert.deepEqual(views.reviewQueue(rq, 2, now), ['due', 'new1', 'new2']);
// New words already started today count against the goal.
assert.deepEqual(views.reviewQueue(rq, 2, now, 1), ['due', 'new1']);
assert.deepEqual(views.reviewQueue(rq, 2, now, 5), ['due']);
// A lapsed word ("Again": reps 0, due now) is a due review, not a new word.
assert.deepEqual(views.reviewQueue([{ id: 'lapsed', lemma: 'f', reps: 0, reviewDue: now - 1000 }], 0, now), ['lapsed']);
// The Review view: a start screen, then a quiz question, then the empty state.
const rs = views.startReview(rq, 2, now);
assert.match(views.reviewHtml(rq, rs, 10, { now }), /data-act="nb-start"/);
rs.started = true;
assert.match(views.reviewHtml(rq, rs, 10, { now }), /class="nbv-quiz"/);
assert.match(views.reviewHtml([], views.startReview([], 2, now), 10, { now }), /Save words to start reviewing/);
assert.match(views.reviewHtml(rq.slice(1, 2), views.startReview(rq.slice(1, 2), 0, now), 10, { now }), /Nothing due today/);

// Rows: Look up sits in the collapsed row, not only in the details.
const row = vocabEntryHtml({ id: 'x', lemma: 'inspect', definition: 'look' }, false, now);
const head = row.slice(0, row.indexOf('vocab-entry__details'));
assert.match(head, /data-act="lookup"/);
assert.match(head, /data-act="nb-play"/);

// Expanded rows say when and where a word was saved, and where review stands.
const facts = vocabEntryHtml({ id: 'f', lemma: 'holon', device: 'DESKTOP-4K2', sources: ['Wiktionary'], createdAt: now - DAY, reps: 2, reviewDue: now + 3 * DAY }, true, now);
assert.match(facts, /<dt>On<\/dt><dd>DESKTOP-4K2<\/dd>/);
assert.match(facts, /In 3 days, 2 reviews so far/);
assert.match(vocabEntryHtml({ id: 'g', lemma: 'new' }, true, now), /<dd>New<\/dd>/);

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

// Origins and deep roots from Wiktionary templates.
const ety = load('etymology');
const ne = load('notebook-etymology');
const chainOf = (wt) => ety.buildEtymology(`==English==\n===Etymology===\n${wt}\n`)?.chain;
assert.deepEqual(
  ne.etymonFromChain(chainOf('From {{inh|en|enm|edifice}}, from {{der|en|fro|edifice}}, from {{der|en|la|aedificium}}. {{root|en|ine-pro|*dʰeh₁-}}')),
  { origin: 'Latin', via: ['French'], roots: ['*dʰeh₁-'] },
);
assert.equal(ne.etymonFromChain(chainOf('{{inh|en|enm|chyrne}}, from {{inh|en|ang|ċyrn}}')).origin, 'Old English');
// The newer {{ety}} and {{etymon}} templates, and {{ubor}}.
assert.equal(ne.etymonFromChain(chainOf('{{ety|en|:bor|la:cortex<t:bark>|tree=1}}')).origin, 'Latin');
assert.equal(ne.etymonFromChain(chainOf('{{etymon|en|id=x|:ubor|fr:bouquet<id:bundle>}}')).origin, 'French');
assert.equal(ne.etymonFromChain(chainOf('An {{ubor|en|fr|arbitrage}}')).origin, 'French');
// Inflected and derived words are traced through their base word.
assert.equal(ne.baseWord('==English==\n# {{infl of|en|attenuate||ed-form}}'), 'attenuate');
assert.equal(ne.baseWord('==English==\n# {{plural of|en|berry}}'), 'berry');
assert.equal(ne.baseWord('==English==\n===Etymology===\n{{ety|en|:af|capacity|-or<id:-ator>}}\n'), 'capacity');
assert.equal(ne.rootGlossFromWikitext('# to [[grow]] [[old]]<ref>Starostin (1998). [http://x y]</ref>\n'), 'to grow old');
// Deep-root families and strata come from the traced data.
const etyFor = { inspect: { origin: 'Latin', via: [], roots: ['*spek-'] }, spectator: { origin: 'Latin', via: ['French'], roots: ['*spek-'] } };
const lookupEty = (l) => etyFor[l] || null;
assert.deepEqual(views.deepRootFamilies(a, lookupEty).map((f) => [f.label, f.ids.length]), [['*spek-', 2]]);
assert.ok(views.familyGroupings(a, lookupEty).includes('deep'));
const strata = views.originGroups(a, lookupEty);
assert.equal(strata[0].origin, 'Latin');
assert.match(views.familiesHtml(a, 'origin', { etymon: lookupEty }), /via French/);
assert.match(views.familiesHtml(a, 'root'), /Not in a family yet/);

console.log('notebook-views: ok');
