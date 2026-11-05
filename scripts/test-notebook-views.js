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
// Families are in A to Z order in one grid, with no letter index or headings; tiles are sized by family size.
assert.doesNotMatch(fhtml, /nbv-letter__head|nbv-abc/);
assert.match(fhtml, /class="nbv-fam nbv-fam--root nbv-fam--s"/);
const order = [...views.familiesHtml(a, 'root').matchAll(/<span class="nbv-fam__label">([^<]*)<\/span>/g)].map((m) => m[1]);
assert.deepEqual(order, [...order].sort((x, y) => x.localeCompare(y)), 'families in alphabetical order');
// A family that knows its other spellings shows them after the main one; without them, none.
const withForms = { ...a, families: a.families.map((f) => (f.key === 'root:spect' ? { ...f, forms: ['spect', 'spic', 'spec'] } : f)) };
assert.match(views.familiesHtml(withForms, 'root'), /<span class="nbv-fam__forms"><span>spic<\/span><span>spec<\/span><\/span>/);
// The analysis gives the spellings as one string; a family it has none for shows none.
assert.match(fhtml, /<span class="nbv-fam__label">spect<\/span>\s*<span class="nbv-fam__forms"><span>spec<\/span><span>spic<\/span><\/span>/);
assert.match(fhtml, /<span class="nbv-fam__label">nat<\/span>\s*<span class="nbv-fam__gloss">/);
assert.match(views.familiesHtml(a, 'tree'), /data-tree-open aria-label="Open the nation tree"/);

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
// mapHtml names the cached graph by its signature, with search, filters and the controls.
const mh = views.mapHtml(a, ['root', 'char']);
const md = views.notebookMapData(a, ['root', 'char']);
assert.match(mh, new RegExp(`data-map-sig="${md.sig.replace(/[+]/g, '\\+')}"`));
assert.ok(!/data-map-data/.test(mh), 'the graph is not written into the page');
assert.equal(md.nodes.length, m3a.nodes.length);
assert.equal(md.total, a.words.size);
assert.ok(md.edges.every(([x, y]) => md.nodes[x] && md.nodes[y]));
assert.match(mh, /data-map-search/);
assert.match(mh, /data-act="nb-map-kind" data-kind="root"/);
assert.match(mh, /data-map-act="reset"/);
// apple shares nothing: it is on the map all the same, unlinked, and Find a word finds it.
assert.match(mh, /data-count="9 words"/);
const apple = md.nodes.find((p) => p.l === 'apple');
assert.equal(apple?.u, 1, 'apple is unlinked');
assert.equal(md.nodes.filter((p) => p.u).length, 1, 'the only unlinked word');
assert.ok(!md.edges.some(([x, y]) => md.nodes[x] === apple || md.nodes[y] === apple));
assert.deepEqual(views.findMapWords(md, 'apple').map((p) => p.l), ['apple']);
assert.match(views.mapHtml(a, ['root', 'char'], { query: 'apple' }), /data-map-goto="[^"]+"/, 'the Words search opens the map on an unlinked word');
assert.equal(views.notebookMapData(a, ['root', 'char']), md, 'layout cached');
// Finding a word: itself first, then the word it inflects, then words starting with it.
assert.deepEqual(views.findMapWords(md, 'inspect').map((p) => p.l), ['inspect', 'inspector']);
assert.deepEqual(views.findMapWords(md, 'inspects').map((p) => p.l), ['inspect', 'inspector']);
assert.deepEqual(views.findMapWords(md, 'spect').map((p) => p.l), ['spect', 'spectator', 'inspect', 'inspector'], 'the part first');
assert.ok(views.queryForms('changes').includes('change'));
assert.ok(views.queryForms('studied').includes('study'));
// The Words search goes to the map: a match opens on it, a miss says so and keeps the map.
assert.match(views.mapHtml(a, ['root', 'char'], { query: 'inspects' }), /data-map-goto="id0"/);
const missed = views.mapHtml(a, ['root', 'char'], { query: 'changes' });
assert.match(missed, /No word matches “changes”/);
assert.match(missed, /data-map-sig=/);
// The focused word survives a rebuilt graph. Saving a book word from its lookup gives it a
// new id (wb:spectator becomes n2); the map finds it again by its headword, keeps it where it
// stood, and so keeps the camera.
const bookWords = ['inspect', 'inspector', 'spectator', 'spectacle', 'prospect', 'respect', 'nation', 'national', 'nationality', 'international', '対応', '対策'];
const bookEntry = (lemma, id = `wb:${lemma}`) => ({ id, lemma, definition: `${lemma} sense`, createdAt: 0, updatedAt: 0 });
const bd1 = views.notebookMapData(views.analyzeNotebook(bookWords.map((w) => bookEntry(w))), ['root', 'char']);
const spot1 = bd1.nodes.find((p) => p.id === 'wb:spectator');
const view = { pos: { x: 1, y: 2, z: 300 }, target: { x: 0, y: 0, z: 0 } };
const mem = { sig: bd1.sig, focus: 'wb:spectator', word: 'spectator', at: [spot1.x, spot1.y, spot1.z], view, query: '' };
const bd2 = views.notebookMapData(views.analyzeNotebook(bookWords.map((w) => (w === 'spectator' ? bookEntry(w, 'n2') : bookEntry(w)))), ['root', 'char']);
assert.notEqual(bd2.sig, bd1.sig);
assert.equal(bd2.from, bd1.sig, 'the new graph grew from the old one');
const spot2 = bd2.nodes.find((p) => p.id === 'n2');
assert.deepEqual([spot2.x, spot2.y, spot2.z], mem.at, 'the saved word keeps its place');
const carried = views.carryMapMemory(mem, bd2);
assert.equal(carried.sig, bd2.sig);
assert.equal(carried.focus, 'n2', 'focus follows the word to its new id');
assert.equal(carried.view, view, 'the camera stays on it');
assert.equal(views.carryMapMemory(carried, bd2), carried, 'the same graph keeps the memory as it is');
// A graph laid out afresh still focuses the word, and drops the camera so the map flies to it.
const fresh = { ...bd2, sig: 'fresh', from: undefined, nodes: bd2.nodes.map((p) => ({ ...p, x: p.x + 40 })) };
const flown = views.carryMapMemory(mem, fresh);
assert.equal(flown.focus, 'n2');
assert.equal(flown.view, null);
// A graph without the word, that did not grow from this one, leaves the memory alone.
const other = views.notebookMapData(views.analyzeNotebook(entries.filter((e) => e.lemma !== 'spectator')), ['root', 'char']);
assert.equal(views.carryMapMemory(mem, other), mem);

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

// A layout saved by earlier versions: Scatter became the grid, anything unknown the piles.
assert.equal(views.cardLayoutOf('scatter'), 'grid');
assert.equal(views.cardLayoutOf('grid'), 'grid');
assert.equal(views.cardLayoutOf('piles'), 'piles');
assert.equal(views.cardLayoutOf(null), 'piles');
assert.equal(views.cardLayoutOf('bogus'), 'piles');

const chtml = views.cardsHtml(entries, a, new Set(['id1']), 'scatter', now);
assert.match(chtml, /<div class="nbv-table" data-layout="grid" data-scope="[^"]+">/);
// Each list has its own scope, so an open pile in My words is not open in a book.
assert.notEqual(chtml.match(/data-scope="([^"]+)"/)[1], views.cardsHtml(entries.slice(1), a, new Set(), 'grid', now).match(/data-scope="([^"]+)"/)[1]);
// No layout switch: one Expand all button, which reads Collapse all while every pile is out.
assert.doesNotMatch(chtml, /data-cards-layout/);
assert.match(chtml, /class="nbv-table__all" data-cards-all aria-pressed="true">[\s\S]*?<span>Collapse all<\/span>/);
const phtml = views.cardsHtml(entries, a, new Set(['id1']), 'piles', now);
assert.match(phtml, /data-cards-all aria-pressed="false">[\s\S]*?<span>Expand all<\/span>/);
// The markup holds each pile's top cards; the table draws the rest when they near the screen.
const shownPiles = views.cardPiles(entries, now);
const faceCount = shownPiles.reduce((n, p) => n + Math.min(views.PILE_FACE_CARDS, p.ids.length), 0);
assert.equal((chtml.match(/<article class="nbv-card/g) || []).length, faceCount);
// The card's text is the lookup, not the whole card, so fast clicks on the picture only turn it.
assert.equal((chtml.match(/<article class="nbv-card[^"]*" data-act=/g) || []).length, 0);
assert.equal((chtml.match(/class="nbv-card__body" data-act="lookup" data-q="[^"]+"/g) || []).length, faceCount);
assert.match(chtml, /<article class="nbv-card" data-q="inspect"[^>]*tabindex="0"/);
assert.equal((chtml.match(/<button type="button" class="nbv-card__flip" data-act="nb-flip"/g) || []).length, faceCount);
assert.match(chtml, /class="nbv-card is-flipped" data-q="inspector"/);
// The picture and the back turn the card over; Look up on the back opens the lookup.
assert.equal((chtml.match(/class="nbv-card__pic" data-act="nb-flip"/g) || []).length, faceCount);
assert.equal((chtml.match(/class="nbv-card__face nbv-card__back" data-act="nb-flip"/g) || []).length, faceCount);
assert.match(chtml, /class="nbv-card__look" data-act="lookup" data-q="inspector" tabindex="0"/);
assert.match(chtml, /class="nbv-card__look" data-act="lookup" data-q="inspect" tabindex="-1"/);
assert.match(chtml, /class="nbv-pile[^"]*" data-pile="week" aria-expanded="false"/);
assert.match(chtml, /This week<b>\d+<\/b>/);
assert.match(chtml, /data-img-lemma="spectator"/);
assert.match(views.cardsHtml(entries, a, new Set(), undefined, now), /data-layout="piles"/);
assert.match(views.cardsHtml([], a, new Set()), /No saved words/);
// A big pile draws only its top cards, and none of them is deep.
const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, lemma: `word${i}`, createdAt: now - i * 1000 }));
const mhtml = views.cardsHtml(many, views.analyzeNotebook(many), new Set(), 'piles', now);
assert.equal((mhtml.match(/<article class="nbv-card/g) || []).length, views.PILE_FACE_CARDS);
assert.equal((mhtml.match(/ data-deep /g) || []).length, 0);
assert.match(mhtml, /class="nbv-pile has-depth"/);

// A word book's words that were never started have no date: they go last, in book order, in
// one "New" pile, and every word of the book is in some pile.
const book = [
  { id: 'mine1', lemma: 'alpha', createdAt: now - 1000, saved: true },
  { id: 'wb:started', lemma: 'beta', createdAt: now - 40 * DAY, saved: false },
  ...Array.from({ length: 5000 }, (_, i) => ({ id: `wb:w${i}`, lemma: `w${i}`, createdAt: 0, saved: false })),
  { id: 'old', lemma: 'gamma', createdAt: 0, saved: true },
];
const bookPiles = views.cardPiles(book, now);
assert.equal(bookPiles.reduce((n, p) => n + p.ids.length, 0), book.length, 'every book word has a card');
assert.equal(bookPiles[bookPiles.length - 1].label, 'New');
assert.equal(bookPiles[bookPiles.length - 1].ids.length, 5000);
assert.equal(bookPiles[bookPiles.length - 1].ids[0], 'wb:w0', 'book order kept');
assert.equal(bookPiles[bookPiles.length - 1].ids[4999], 'wb:w4999');
assert.equal(bookPiles[bookPiles.length - 2].label, 'Earlier', 'a saved word with no date stays in Earlier');
// The book's table renders at once however long the book is.
const t0 = Date.now();
const bhtml = views.cardsHtml(book, views.analyzeNotebook(book.slice(0, 50)), new Set(), 'grid', now);
assert.ok(Date.now() - t0 < 1500, 'a 5000-word book renders quickly');
assert.match(bhtml, /New<b>5000<\/b>/);

// The table's flow: a closed pile takes one place, an open pile one place per card, starting
// where the pile lay, so opening a pile moves only the piles after it.
const geo = { width: 600, cardW: 180, cardH: 250, gap: 16 };
const flowPiles = [
  { key: 'a', label: 'A', ids: ['a0', 'a1', 'a2', 'a3', 'a4'] },
  { key: 'b', label: 'B', ids: ['b0', 'b1'] },
  { key: 'c', label: 'C', ids: ['c0'] },
];
const closed = views.planTable(flowPiles, new Set(), geo);
assert.equal(closed.cols, 3);
assert.equal(closed.piles.get('a').y, closed.piles.get('c').y, 'three piles fit one row');
assert.equal(closed.cards.size, 8, 'every card has a place');
const openB = views.planTable(flowPiles, new Set(['b']), geo);
assert.deepEqual(openB.piles.get('a'), closed.piles.get('a'), 'a pile before the open one stays put');
assert.deepEqual(openB.piles.get('b'), closed.piles.get('b'), 'the open pile starts where it lay');
assert.ok(Math.abs(openB.cards.get('b0').x - closed.piles.get('b').x) < 4, 'its first card lands on its place');
assert.ok(Math.abs(openB.cards.get('b1').x - closed.piles.get('c').x) < 4, 'its next card takes the place after');
assert.ok(openB.piles.get('c').y > closed.piles.get('c').y, 'the pile after it is pushed to the next row');
assert.ok(openB.height > closed.height);
const all = views.planTable(flowPiles, new Set(['a', 'b', 'c']), geo);
const ys = [...all.cards.values()].map((p) => p.y);
assert.equal(new Set(flowPiles.flatMap((p) => p.ids).map((id) => Math.round(all.cards.get(id).x / 100))).size, 3, 'poured cards fill three columns');
assert.ok(Math.max(...ys) > Math.min(...ys) + 2 * geo.cardH, 'eight cards make three rows');
for (const p of all.cards.values()) assert.ok(Math.abs(p.rot) <= 1.2, 'poured cards lie nearly straight');
// A 5000-card pile lays out in a few milliseconds.
const big = [{ key: 'new', label: 'New', ids: Array.from({ length: 5000 }, (_, i) => `n${i}`) }];
const t1 = Date.now();
const bigPlan = views.planTable(big, new Set(['new']), { width: 343, cardW: 150, cardH: 220, gap: 10 });
assert.ok(Date.now() - t1 < 200);
assert.equal(bigPlan.cols, 2);
assert.equal(bigPlan.cards.size, 5000);

// Shakes, after Square's Seismic: a quarter second of strong motion is one shake, two with a
// pause between them are a double shake, and one long shake is never two.
const shake = load('shake');
const feed = (det, from, ms, strong) => {
  let hit = 0;
  for (let t = from; t < from + ms; t += 16) if (det.push(t, strong ? ((t / 16) % 2 ? 15 : -15) : 0.2, 9.8, 0)) hit += 1;
  return hit;
};
const one = shake.shakeDetector();
assert.equal(feed(one, 0, 200, true), 0, 'under a quarter second is not a shake');
assert.equal(feed(one, 200, 100, true), 1, 'a quarter second or more is');
assert.equal(feed(shake.shakeDetector(), 0, 3000, false), 0, 'holding the phone is not a shake');
const dbl = shake.doubleShakeDetector();
let t = 0;
assert.equal(feed(dbl, t, 400, true), 0, 'one shake alone does nothing');
t += 400;
assert.equal(feed(dbl, t, 250, false), 0);
t += 250;
assert.equal(feed(dbl, t, 400, true), 1, 'a second shake after a pause is a double shake');
const long = shake.doubleShakeDetector();
assert.equal(feed(long, 0, 2000, true), 0, 'two seconds of shaking without a pause is one shake');
const slow = shake.doubleShakeDetector();
feed(slow, 0, 400, true);
feed(slow, 400, 2000, false);
assert.equal(feed(slow, 2400, 400, true), 0, 'shakes further apart than 1.5 s are two single shakes');
// Walking or a bumpy ride stays under the threshold.
const walk = shake.doubleShakeDetector();
let walked = 0;
for (let i = 0; i < 600; i++) if (walk.push(i * 16, Math.sin(i / 4) * 2.5, 9.8 + Math.sin(i / 3) * 2, 0)) walked += 1;
assert.equal(walked, 0);

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

// Review lives in the Learn tab: the Words switcher has four views, and a saved Review view
// becomes the list with Learn opened instead.
const viewSwitch = views.notebookViewSwitchHtml('list');
assert.equal((viewSwitch.match(/data-act="nb-view"/g) || []).length, 4);
assert.doesNotMatch(viewSwitch, /data-view="review"/);
assert.deepEqual(views.readNotebookView('review'), { view: 'list', learn: true });
assert.deepEqual(views.readNotebookView('cards'), { view: 'cards', learn: false });
assert.deepEqual(views.readNotebookView('bogus'), { view: 'list', learn: false });
{
  const { learnHtml } = load('learn-view');
  const html = learnHtml({ scope: 'mine', ctx: null, mine: rq, review: views.startReview(rq, 2, now), goal: 10, now });
  assert.match(html, /data-act="nb-start"/, 'Learn starts today\'s review');
  assert.match(html, /data-act="nb-goal"/, 'My words keeps its goal chips');
  assert.doesNotMatch(html, /lrn-scopes/, 'no list switcher without word books');
  assert.match(html, /data-act="learn-page" data-page="progress"/);
}

// Progress: today against the goal, the streak, skills, families and the forgetting curve.
{
  const { progressSummary, progressHtml } = load('learn-progress');
  const t0 = new Date(2026, 10, 3, 12).getTime();
  const DAYMS = 86_400_000;
  const words = [
    { id: 'p1', lemma: 'portable', reps: 4, state: 2, stability: 30, lastReview: t0 - 2 * DAYMS, reviewDue: t0 + 20 * DAYMS, createdAt: t0 - 40 * DAYMS },
    { id: 'p2', lemma: 'transport', reps: 1, state: 1, stability: 1, lastReview: t0 - 3600_000, reviewDue: t0 + 3600_000, createdAt: t0 - 2 * DAYMS },
    { id: 'p3', lemma: 'export', reps: 0, createdAt: t0 - DAYMS },
  ];
  const rec = (lemma, at, kind, skill, correct, grade = correct ? 3 : 1) => ({ id: `${lemma}-${at}`, lemma, wordId: null, bookId: null, answeredAt: at, kind, skill, correct, ms: 3000, grade, device: null, prior: null });
  const history = [
    rec('portable', t0 - 40 * DAYMS, 'meaning-choice', 'meaning', true),
    rec('portable', t0 - 2 * DAYMS, 'recall', 'spelling', true),
    rec('portable', t0 - DAYMS, 'recall', 'spelling', true),
    rec('transport', t0 - 3600_000, 'meaning-choice', 'meaning', false),
    rec('transport', t0 - 3000_000, 'listen-choice', 'listening', true),
  ];
  const s = progressSummary({ history, scope: 'mine', ctx: null, mine: words, goal: 10, now: t0 });
  assert.equal(s.newToday, 1, 'transport was first answered today');
  assert.equal(s.newGoal, 10);
  assert.equal(s.reviewsToday, 2);
  assert.equal(s.dueLeft, 1);
  assert.equal(s.streak, 3, 'today, yesterday and the day before');
  assert.deepEqual(s.lists[0], { id: 'mine', label: 'My words', total: 3, fresh: 1, learning: 1, known: 1 });
  assert.deepEqual(s.skills.spelling, { mastered: 1, tested: 1 });
  assert.deepEqual(s.skills.meaning, { mastered: 0, tested: 2 });
  assert.equal(s.families[0].label, 'port');
  assert.equal(s.families[0].known, 1);
  assert.equal(s.perDay.length, 30);
  assert.equal(s.perDay[29].right + s.perDay[29].wrong, 2);
  assert.equal(s.inRotation, 2);
  assert.ok(s.curve[0] > s.curve[30], 'recall falls without review');
  const page = progressHtml({ history, scope: 'mine', ctx: null, mine: words, goal: 10, now: t0 });
  for (const label of ['New words', 'Reviews', 'Streak', 'Skills', 'Root families', 'Answers per day', 'If you stop reviewing', 'Reviews ahead, 30 days', 'How long words are held', 'Trouble words']) assert.match(page, new RegExp(label));
  // Every chart has a y axis label, ticks and a readout, and each bar its own readout.
  assert.match(page, /data-lrc="retention"[\s\S]*data-lrc-range/);
  assert.match(page, /data-lrc="due30"[\s\S]*class="lrc-ylabel"[^>]*>Words due/);
  assert.equal((page.match(/data-lrc="due30"[\s\S]*?<\/svg>/)[0].match(/class="lrc-hit"/g) || []).length, 30, 'one bar a day');
  assert.match(page, /data-lrc="answers"[\s\S]*<template data-for="29"><p class="lrc-read__head"><b>[^<]+<\/b> · 2 answers, 50% right/);
  assert.match(page, />Due at 90% recall</);
  assert.ok(page.includes('<b>2<small> of 3</small></b><span>Reviews, of those due today'), 'the review ring says what it counts');
  assert.doesNotMatch(page, /at most 20%/);
  assert.equal(s.strength.reduce((n, b) => n + b.words.length, 0), 2, 'two started words');
  assert.deepEqual(s.strength[0].words, ['transport'], 'transport is still learning');
  assert.equal(s.mix.listening, 1);
  const r14 = load('learn-charts').retentionAt(s.rotation, t0, 14);
  assert.ok(r14.average < 1 && r14.weakest[0].lemma === 'transport', 'the learning word is weakest after two weeks');
  assert.match(progressHtml({ history: [], scope: 'mine', ctx: null, mine: [], goal: 10, now: t0 }), /No answers yet/);
}

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
assert.match(facts, /<dt>Dictionary<\/dt><dd>Wiktionary<\/dd>/);
assert.doesNotMatch(facts, /<dt>Source<\/dt>/, 'no Source without a context');

// Source: the book with its page, or the page title linked to its address, and the sentence
// with the saved word marked.
const geb = vocabEntryHtml(
  { id: 's1', lemma: 'braid', context: { app: 'Acrobat', doc: 'GEB.pdf', page: 12, sentence: 'An Eternal Golden Braid, a metaphorical fugue.' } },
  true,
  now,
);
assert.match(geb, /<dt>Source<\/dt><dd>GEB\.pdf<span class="vocab-source__more">p\. 12<\/span><\/dd>/);
assert.match(geb, /<blockquote class="vocab-context">An Eternal Golden <mark>Braid<\/mark>, a metaphorical fugue\.<\/blockquote>/);
const web = vocabEntryHtml(
  { id: 's2', lemma: 'strand', context: { app: 'Chrome', title: 'Strand <b>', url: 'https://en.wikipedia.org/wiki/Strand?a=1&b=2' } },
  true,
  now,
);
assert.match(web, /<a href="https:\/\/en\.wikipedia\.org\/wiki\/Strand\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Strand &lt;b&gt;<\/a><span class="vocab-source__more">en\.wikipedia\.org<\/span>/);
assert.doesNotMatch(web, /vocab-context/, 'no quote without a sentence');

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

// A typed daily goal: whole numbers from 1 to 999; empty or not a number is ignored.
assert.strictEqual(views.parseGoal('15'), 15);
assert.strictEqual(views.parseGoal(' 7.6 '), 8);
assert.strictEqual(views.parseGoal('0'), 1);
assert.strictEqual(views.parseGoal('5000'), 999);
assert.strictEqual(views.parseGoal(''), null);
assert.strictEqual(views.parseGoal('abc'), null);

// A repaint after tracing calls the trace again. With nothing new to fetch it must not call
// back, or the two loop forever without yielding (4.0.0 froze on a root with an empty gloss).
(async () => {
  const now = Date.now();
  const saved = new Map([['phevere.etymons.v1', JSON.stringify({
    inspect: { origin: 'Latin', via: [], roots: ['*spek-'], at: now },
    spectator: { origin: 'Latin', via: [], roots: ['*spek-'], at: now },
  })]]);
  ne.setEtymonStore({ get: (k) => saved.get(k) ?? null, set: (k, v) => saved.set(k, v) });
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return { ok: true, text: async () => JSON.stringify({ query: { pages: [{ title: 'Reconstruction:Proto-Indo-European/spek-', revisions: [{ slots: { main: { content: '' } } }] }] } }) };
  };
  let paints = 0;
  const trace = () => views.traceNotebookFamilies(['inspect', 'spectator'], () => null, () => {
    paints += 1;
    if (paints < 50) trace();
  });
  trace();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(requests, 1, 'the empty gloss is fetched once');
  assert.equal(paints, 1, 'one repaint for the new gloss, then the trace stops');
  console.log('notebook-views: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
