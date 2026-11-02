/**
 * Checks for packages/core/src/sense-images.ts against recorded Wikimedia responses
 * (scripts/fixtures/sense-images.json, trimmed to the parts the module reads).
 * Run: node scripts/test-sense-images.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sense-images.json'), 'utf8'));

function load(runtimeStub) {
  const src = fs.readFileSync(path.join(root, 'packages', 'core', 'src', 'sense-images.ts'), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const req = (name) => {
    if (name === './runtime') return runtimeStub;
    if (name === './http') return {};
    return require(name);
  };
  vm.runInNewContext(js, {
    module: mod,
    exports: mod.exports,
    require: req,
    Intl,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    console,
  });
  return mod.exports;
}

/** Values from the vm realm have other prototypes; compare their JSON. */
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, msg);

const offline = { isCoreConfigured: () => false, getHttp: () => null, getLookupCache: () => null };
const si = load(offline);

function wikitext(word) {
  return fx.wiktionary[word].query.pages[0].revisions[0].slots.main.content;
}

// ---------------------------------------------------------------- query building

assert.strictEqual(
  si.buildSenseSearchQuery('crane', 'Any bird of the family Gruidae, large birds with long legs and a long neck.'),
  'crane bird gruidae',
);
assert.strictEqual(
  si.buildSenseSearchQuery('crane', 'A <a href="/wiki/mechanical">mechanical</a> lifting machine or device.'),
  'crane mechanical lifting',
);
assert.strictEqual(si.buildSenseSearchQuery('bank', '(countable) An edge of river, lake, or other watercourse.'), 'bank edge watercourse');

const titleUrl = si.buildWikipediaTitleUrl('Apple');
assert.ok(titleUrl.startsWith('https://en.wikipedia.org/w/api.php?'));
for (const part of ['titles=Apple', 'redirects=1', 'pilicense=free', 'pithumbsize=330', 'ppprop=disambiguation', 'origin=*']) {
  assert.ok(titleUrl.includes(part), `title URL lacks ${part}`);
}
const searchUrl = si.buildWikipediaSearchUrl('crane bird gruidae');
assert.ok(searchUrl.includes('generator=search') && searchUrl.includes('gsrsearch=crane%20bird%20gruidae'));
assert.ok(si.buildWiktionaryUrl('猫').includes('titles=%E7%8C%AB'));
const infoUrl = si.buildImageInfoUrl(['Framing_hammer.jpg']);
assert.ok(infoUrl.startsWith('https://commons.wikimedia.org/') && infoUrl.includes('File%3AFraming%20hammer.jpg'));
assert.ok(infoUrl.includes('iiurlwidth=330'));

// ---------------------------------------------------------------- Wiktionary pictures

const bankImgs = si.extractWiktionaryImages(wikitext('bank'), 'en');
const boe = bankImgs.find((i) => /Bank of England/.test(i.file));
assert.ok(boe, 'bank: Bank of England picture found');
assert.ok(/institution where one can place and borrow money/.test(boe.senseText), 'bank: senseno resolved to its definition line');
assert.ok(!/senseno|\{\{|\(\s*\)/.test(boe.caption), 'bank: caption is plain text');

const bankSenses = [
  { meaning: '(countable) An institution where one can place and borrow money and take care of financial affairs.', partOfSpeech: 'noun' },
  { meaning: '(countable) A branch office of such an institution.', partOfSpeech: 'noun' },
  { meaning: '(transitive) To put into a bank.', partOfSpeech: 'verb' },
];
const bankMatch = si.matchWiktionaryImages(bankImgs, bankSenses, 'bank');
assert.strictEqual(bankMatch.length, 1, 'bank: one picture, the river bank finds no sense here');
assert.strictEqual(bankMatch[0].senseIndex, 0);
assert.strictEqual(bankImgs[bankMatch[0].imageIndex].file, boe.file);

const hammerImgs = si.extractWiktionaryImages(wikitext('hammer'), 'en');
const hammerMatch = si.matchWiktionaryImages(
  hammerImgs,
  [
    { meaning: 'A tool with a heavy head and a handle used for pounding.', partOfSpeech: 'noun' },
    { meaning: 'The act of using a hammer to hit something.', partOfSpeech: 'noun' },
    { meaning: '(music) In a piano or dulcimer, a piece of wood covered in felt that strikes the string.', partOfSpeech: 'noun' },
  ],
  'hammer',
);
same(
  hammerMatch.map((m) => [m.senseIndex, hammerImgs[m.imageIndex].file]),
  [[0, 'Framing hammer.jpg'], [2, 'Piano hammer.jpg']],
);

const chairImgs = si.extractWiktionaryImages(wikitext('chair'), 'en');
const chairMatch = si.matchWiktionaryImages(
  chairImgs,
  [{ meaning: 'An item of furniture used to sit on or in, comprising a seat, legs, back.', partOfSpeech: 'noun' }],
  'chair',
);
assert.strictEqual(chairMatch.length, 1, 'chair: caption "(item of furniture)" matches');

// Rejections: the Lisp diagram on "car" and the tree-structure diagram on "tree".
const carImgs = si.extractWiktionaryImages(wikitext('car'), 'en');
assert.ok(carImgs.some((i) => /Cons-cells/.test(i.file)), 'car: Lisp diagram extracted');
assert.strictEqual(
  si.matchWiktionaryImages(carImgs, [{ meaning: 'A wheeled vehicle that moves independently, with at least three wheels.', partOfSpeech: 'noun' }], 'car').length,
  0,
  'car: the Lisp diagram is not a picture of a car',
);
const treeImgs = si.extractWiktionaryImages(wikitext('tree'), 'en');
assert.strictEqual(
  si.matchWiktionaryImages(treeImgs, [{ meaning: 'A perennial woody plant, differentiated from a shrub by its larger size.', partOfSpeech: 'noun' }], 'tree').length,
  0,
  'tree: a tree-structure diagram is not a plant',
);
// Audio and video files never count as pictures.
assert.ok(!si.extractWiktionaryImages('==English==\n[[File:En-us-run.ogg|thumb|run]]', 'en').length);
// Parts of speech must agree.
assert.strictEqual(
  si.matchWiktionaryImages(hammerImgs, [{ meaning: 'A tool with a heavy head and a handle used for pounding.', partOfSpeech: 'verb' }], 'hammer').length,
  0,
);

// ---------------------------------------------------------------- concreteness gate

const concrete = (meaning, partOfSpeech = 'noun', lemma = 'x') => si.isConcreteNounSense({ meaning, partOfSpeech }, lemma);
assert.ok(concrete('A common, round fruit produced by the tree Malus domestica.', 'noun', 'apple'));
assert.ok(concrete('(countable) An institution where one can place and borrow money.', 'noun', 'bank'));
assert.ok(!concrete('Act or instance of running, of moving rapidly using the feet.', 'noun', 'run'));
assert.ok(!concrete('A combination of events which have come together by chance to make a surprisingly good outcome.', 'noun', 'serendipity'));
assert.ok(!concrete('An unsought, unintended, and/or unexpected, but fortunate, discovery.', 'noun', 'serendipity'));
assert.ok(!concrete('(slang, uncountable) Money; profit.', 'noun', 'bank'));
assert.ok(!concrete('A surname.', 'noun', 'Haus'));
assert.ok(!concrete('To put into a bank.', 'verb', 'bank'));
assert.ok(!concrete('The state of being happy.', 'noun', 'happiness'));

// ---------------------------------------------------------------- Wikipedia match and reject

const page = (t) => fx.wikipediaTitle[t].query.pages[0];
assert.ok(si.acceptWikipediaPage(page('Apple'), 'apple', 'A common, round fruit produced by the tree Malus domestica.', 'apple'));
assert.ok(!si.acceptWikipediaPage(page('Crane'), 'crane', 'Any bird of the family Gruidae.', 'crane'), 'disambiguation page');
assert.ok(
  !si.acceptWikipediaPage(page('House'), 'house', 'A structure built or serving as an abode of human beings.', 'house'),
  'house: description shares no word with the gloss',
);
assert.ok(
  !si.acceptWikipediaPage(page('Serendipity'), 'serendipity', 'A combination of events which have come together by chance.', 'serendipity'),
);
assert.ok(
  si.acceptWikipediaPage(page('Tree'), 'tree', 'A perennial woody plant, differentiated from a shrub by its larger size.', 'tree', { strict: true }),
  'tree: a later noun sense passes the strict rule with three shared words',
);
assert.ok(si.acceptWikipediaPage(page('Cat'), 'cat', 'cat', '猫', { exactGloss: true }), '猫: the gloss is the article title');
assert.ok(si.acceptWikipediaPage(page('House'), 'house', 'house', 'Haus', { exactGloss: true }), 'Haus: "Building comprising a single dwelling" is not a record single');
assert.strictEqual(si.shortGlossTitle('cat; (dialect) a kind of …'), 'cat');
assert.strictEqual(si.shortGlossTitle('A surname'), 'surname');
assert.strictEqual(si.shortGlossTitle('A common, round fruit produced by the tree Malus domestica'), '');

const catPages = fx.wikipediaSearch.cat.query.pages;
const catPick = si.pickWikipediaPage(catPages, 'cat', 'A small domesticated carnivorous mammal.', 'cat');
assert.strictEqual(catPick && catPick.title, 'Cat');
for (const bad of catPages.filter((p) => p.title !== 'Cat')) {
  assert.ok(!si.acceptWikipediaPage(bad, 'cat', 'A small domesticated carnivorous mammal.', 'cat'), `cat: rejects ${bad.title}`);
}

const craneBird = fx.wikipediaSearch['crane bird gruidae'].query.pages;
assert.strictEqual(si.pickWikipediaPage(craneBird, 'crane', 'Any bird of the family Gruidae.', 'crane').title, 'Crane (bird)');
const craneMachine = fx.wikipediaSearch['crane mechanical lifting'].query.pages;
const machinePick = si.pickWikipediaPage(craneMachine, 'crane', 'A mechanical lifting machine or device.', 'crane');
assert.ok(!machinePick || /machine/i.test(machinePick.title), 'crane: the machine sense never gets the bird');

// ---------------------------------------------------------------- credits

const infoPages = fx.imageinfo.query.pages;
const boeInfo = infoPages.find((p) => /Bank of England/.test(p.title)).imageinfo[0];
assert.strictEqual(si.creditFromInfo(boeInfo), 'Diliff · CC BY-SA 3.0 · Wikimedia Commons');
assert.strictEqual(si.shortArtist('<a href="//commons.wikimedia.org/wiki/User:Ellywa">User:Ellywa</a> (original photo)'), 'Ellywa');
assert.strictEqual(si.shortArtist('fir0002 flagstaffotos [at] gmail.com Canon 20D + Sigma 15mm'), 'fir0002 flagstaffotos');
assert.strictEqual(si.shortArtist('Molly from Bronx, NY, United States of America.'), 'Molly');

// ---------------------------------------------------------------- end to end with recorded responses

function serve(url) {
  const u = new URL(url);
  const q = u.searchParams;
  if (u.hostname === 'en.wiktionary.org') {
    const w = q.get('titles');
    return fx.wiktionary[w] || { query: { pages: [{ title: w, missing: true }] } };
  }
  if (u.hostname === 'en.wikipedia.org' && q.get('generator') === 'search') {
    return fx.wikipediaSearch[q.get('gsrsearch')] || { query: { pages: [] } };
  }
  if (u.hostname === 'en.wikipedia.org') {
    return fx.wikipediaTitle[q.get('titles')] || { query: { pages: [{ title: q.get('titles'), missing: true }] } };
  }
  if (u.hostname === 'commons.wikimedia.org') {
    const want = q.get('titles').split('|').map((t) => t.toLowerCase());
    return { query: { pages: infoPages.filter((p) => want.includes(p.title.toLowerCase())) } };
  }
  throw new Error('unexpected URL ' + url);
}

(async () => {
  const requested = [];
  const persisted = new Map();
  const online = load({
    isCoreConfigured: () => true,
    getHttp: () => ({
      requestJson: async (url) => {
        requested.push(url);
        return JSON.parse(JSON.stringify(serve(url)));
      },
    }),
    getLookupCache: () => ({
      get: (k) => persisted.get(k) || null,
      set: (k, value, savedAt) => persisted.set(k, { value, savedAt }),
    }),
  });

  const senses = fx.senses.crane;
  const imgs = await online.fetchSenseImages('crane', senses, { lang: 'en' });
  assert.strictEqual(imgs.length, senses.length, 'one slot per sense');
  assert.ok(imgs[1], 'crane: the bird sense has a picture');
  assert.strictEqual(imgs[1].title, 'Crane (bird)');
  assert.ok(imgs[1].thumb.includes('/330px-') && !imgs[1].thumb.includes('utm_'), 'thumb is the 330 px step without tracking');
  assert.ok(imgs[1].width > 0 && imgs[1].height > 0, 'thumb size for the aspect box');
  assert.ok(/Wikimedia Commons$/.test(imgs[1].credit));
  assert.ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(imgs[1].pageUrl));
  assert.ok(!imgs[0] && !imgs[5], 'no picture for the empty gloss or the verb');
  assert.ok(imgs.filter(Boolean).length <= 3, 'at most three pictures');

  // Cached: the same call makes no request; a new module instance reads the persistent cache.
  const before = requested.length;
  await online.fetchSenseImages('crane', senses, { lang: 'en' });
  assert.strictEqual(requested.length, before, 'memory cache');
  assert.strictEqual(persisted.size, 1, 'written to the lookup cache');
  const again = load({
    isCoreConfigured: () => true,
    getHttp: () => ({ requestJson: async () => { throw new Error('should not fetch'); } }),
    getLookupCache: () => ({ get: (k) => persisted.get(k) || null, set: () => {} }),
  });
  const cached = await again.fetchSenseImages('crane', senses, { lang: 'en' });
  assert.strictEqual(cached[1].title, 'Crane (bird)', 'persistent cache');

  // Failures resolve to no pictures.
  const failing = load({
    isCoreConfigured: () => true,
    getHttp: () => ({ requestJson: async () => { throw new Error('offline'); } }),
    getLookupCache: () => null,
  });
  const none = await failing.fetchSenseImages('apple', [{ meaning: 'A common, round fruit.', partOfSpeech: 'noun' }]);
  same(none, [null]);
  assert.strictEqual(await failing.fetchWordImage('apple'), null, 'no gloss, no picture');

  console.log('sense-images ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
