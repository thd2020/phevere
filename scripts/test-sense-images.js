/**
 * Checks for packages/core/src/sense-images.ts against recorded Wikimedia responses
 * (scripts/fixtures/sense-images.json, trimmed to the parts the module reads, and
 * scripts/fixtures/sense-images-fallback.json, keyed by request URL and recorded on 2026-11-02
 * for the whole-word fallback; operon, arbitrage and holon and the file-name Commons searches
 * were added on 2026-11-03, and the disambiguation-link, Wikidata and imageinfo-with-categories
 * requests on 2026-11-04). scripts/fixtures/sense-images-structured.json, keyed by URL and
 * recorded on 2026-11-04, holds crane, equilibrium, however and notion with the senses the
 * Wiktionary REST API gave that day. The rules these checks pin are in docs/SENSE_IMAGES.md.
 * Run: node scripts/test-sense-images.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sense-images.json'), 'utf8'));
const fb = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sense-images-fallback.json'), 'utf8'));
const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sense-images-structured.json'), 'utf8'));

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

// ---------------------------------------------------------------- whole-word fallback

for (const [word, want] of [
  ['inspect', 'inspection'],
  ['run', 'running'],
  ['beautiful', 'beauty'],
  ['ephemeral', 'ephemerality'],
  ['happy', 'happiness'],
  ['stable', 'stability'],
  ['swim', 'swimming'],
]) {
  const titles = si.derivedTitles(word);
  assert.strictEqual(titles[0], word, `${word}: the word itself comes first`);
  assert.ok(titles.includes(want), `${word}: derived title ${want} in ${titles.join(', ')}`);
  assert.ok(titles.length <= 10);
}
same(si.derivedTitles('猫'), ['猫']);

const enReq = si.fallbackTitleQuery('inspect', [{ meaning: 'To examine critically.', partOfSpeech: 'verb' }], 'en');
assert.ok(enReq.url.startsWith('https://en.wikipedia.org/') && enReq.url.includes('pilicense=free'));
assert.strictEqual(enReq.exact, 1);
const jaReq = si.fallbackTitleQuery('猫', [{ meaning: 'a cat', partOfSpeech: 'noun' }], 'ja');
same(jaReq.titles, ['cat'], '猫: the English gloss names the article');
assert.ok(jaReq.url.startsWith('https://en.wikipedia.org/'));
const jaWord = si.fallbackTitleQuery('要対応', [{ meaning: '' }], 'ja');
assert.ok(
  jaWord.url.startsWith('https://ja.wikipedia.org/') && jaWord.url.includes(encodeURIComponent('要対応')),
  'no gloss: the word on its own Wikipedia',
);
assert.strictEqual(si.commonsSearchQuery('要対応', [{ meaning: 'requires action', partOfSpeech: 'phrase' }], 'ja'), 'requires action');
assert.strictEqual(si.commonsSearchQuery('love', [{ meaning: 'Strong affection.' }], 'en'), 'love');
assert.strictEqual(si.commonsFileTitle('File:An action is required - geograph.org.uk - 6143024.jpg'), 'An action is required');
assert.strictEqual(si.commonsFileTitle('File:Serendipity panel (5642891224).jpg'), 'Serendipity panel');

const conceptPage = (over) => ({
  title: 'Justice',
  description: 'Concept of moral fairness',
  pageimage: 'Justice_Statue_Iran.jpg',
  thumbnail: { source: 'https://upload.wikimedia.org/x.jpg', width: 330, height: 400 },
  ...over,
});
assert.ok(si.acceptConceptPage(conceptPage({})));
assert.ok(!si.acceptConceptPage(conceptPage({ pageprops: { disambiguation: '' } })), 'disambiguation page');
assert.ok(!si.acceptConceptPage(conceptPage({ pageimage: undefined })), 'no free lead image');
assert.ok(!si.acceptConceptPage(conceptPage({ description: '2001 film by Peter Chelsom' })), 'a film');
assert.ok(!si.acceptConceptPage(conceptPage({ pageimage: 'Seal_of_the_United_States_Supreme_Court.svg' })), 'a seal');
assert.ok(si.acceptConceptPage(conceptPage({ title: 'Map', pageimage: 'Old_map_of_Europe.jpg' })), 'a map is fine for "map"');

// Recorded Commons searches: portraits, logos and unrelated hits sink.
const commonsPages = (q) => fb.responses[si.buildCommonsSearchUrl(q)].query.pages;
const loveRanked = si.rankCommonsFiles(commonsPages('love'), 'love', 'love', []);
assert.strictEqual(loveRanked[0].title, 'The Love of Paris and Helen by Jacques-Louis David');
assert.ok(!loveRanked.slice(0, 3).some((r) => /Sean Combs/.test(r.title)), 'love: no portrait of a man nicknamed Love near the top');
assert.ok(/\binspect\b/.test(si.rankCommonsFiles(commonsPages('inspect'), 'inspect', 'inspect', [])[0].title), 'inspect: people inspecting');

// A one-word Commons search looks in file names and takes drawings too: a full-text search for
// "arbitrage" returned US Navy repair ships coded "ARB".
const arbUrl = si.buildCommonsSearchUrl('arbitrage');
assert.ok(decodeURIComponent(arbUrl).includes('gsrsearch=intitle:arbitrage filetype:bitmap|drawing'), arbUrl);
assert.ok(decodeURIComponent(si.buildCommonsSearchUrl('requires action')).includes('gsrsearch=requires action filetype:bitmap|drawing'));
const arbRanked = si.rankCommonsFiles(commonsPages('arbitrage'), 'arbitrage', 'arbitrage', si.contentTokens(fb.senses.arbitrage.list[0].meaning, 'arbitrage'));
assert.ok(arbRanked.length && arbRanked.every((r) => /arbitrage/i.test(r.title)), 'arbitrage: every hit names the word');
assert.strictEqual(arbRanked[0].title, 'Statistical Arbitrage with two stocks', 'arbitrage: the finance picture first');
// "Holon" is also a city: with needGloss, city photos that share no gloss word drop out.
const holonPages = commonsPages('holon');
assert.ok(si.rankCommonsFiles(holonPages, 'holon', 'holon', ['part', 'whole']).length > 0, 'holon: city photos name the word');
same(si.rankCommonsFiles(holonPages, 'holon', 'holon', ['part', 'whole'], { needGloss: true }).map((r) => r.title), [], 'holon: no city photo');

// Pictures used in an article without a free lead image: the ones naming the word first, then
// ones naming a gloss word ("Gene structure" for "structural genes"), never navbox pictures (a
// butterfly from "Tree of life") or interface icons.
const operonFiles = fb.responses[si.buildArticleImagesUrl('Operon')].query.pages[0].images.map((i) => i.title);
const operonRanked = si.rankArticleImages(operonFiles, 'operon', si.contentTokens(fb.senses.operon.list[0].meaning, 'operon'));
same(operonRanked, [
  'Lac Operon.svg',
  'Operon 1.png',
  'Trp operon organization across three different bacterial species.png',
  'Gene structure prokaryote 2 unannotated.svg',
]);
same(si.rankArticleImages(['File:OOjs UI icon edit-ltr-progressive.svg', 'File:Commons-logo.svg', 'File:Arbitrage.wav'], 'arbitrage', []), []);

// The large view of an SVG or TIFF is Commons' PNG rendering at 960 px.
const tif = si.imageFromInfo('Structure of L-arabinose operon of E. coli.tif', 'x', {
  url: 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Structure_of_L-arabinose_operon_of_E._coli.tif',
  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Structure_of_L-arabinose_operon_of_E._coli.tif/lossless-page1-330px-Structure_of_L-arabinose_operon_of_E._coli.tif.png',
  mime: 'image/tiff',
  width: 800,
});
assert.ok(tif.url.includes('/lossless-page1-960px-') && tif.url.endsWith('.tif.png'), tif.url);
const svg = si.imageFromInfo('Lac Operon.svg', 'Lac Operon', {
  url: 'https://upload.wikimedia.org/wikipedia/commons/2/22/Lac_Operon.svg',
  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Lac_Operon.svg/330px-Lac_Operon.svg.png',
  mime: 'image/svg+xml',
  width: 600,
});
assert.ok(svg.url.endsWith('/960px-Lac_Operon.svg.png'), svg.url);

// Wiktionary pictures no sense claimed: "love" has two caption-only ones that name the word.
const wiktFor = (w) => Object.entries(fb.responses).find(([u]) => u.includes('wiktionary.org') && u.endsWith(`titles=${w}&origin=*`))[1];
const loveImgs = si.extractWiktionaryImages(wiktFor('love').query.pages[0].revisions[0].slots.main.content, 'en');
const loveSenses = fb.senses.love.list;
assert.strictEqual(si.matchWiktionaryImages(loveImgs, loveSenses, 'love').length, 0, 'love: no caption shares two gloss words');
const loveFallback = si.rankWiktionaryFallback(loveImgs, loveSenses, 'love');
assert.ok(loveFallback.length >= 2 && loveFallback[0].strong, 'love: the captions name the word');
assert.ok(/Romeo and Juliet/.test(loveFallback[0].image.file));
const runImgs = si.extractWiktionaryImages(wiktFor('run').query.pages[0].revisions[0].slots.main.content, 'en');
assert.ok(
  !si.rankWiktionaryFallback(runImgs, [{ meaning: 'To move swiftly.', partOfSpeech: 'verb' }], 'run').some((x) => /runner|Stocking/.test(x.image.file)),
  'run: a picture tied to another sense by {{senseno}} is never the fallback',
);

// ---------------------------------------------------------------- senses to articles

// Titles that name the word: itself, with a qualifier, or as the lower-case head of a compound.
same(
  ['Crane (machine)', 'Crane (bird)', 'Chemical equilibrium', 'Baseball bat', 'Crane fly', 'HMS Bat', 'Johnnie Notions', 'List of types of equilibrium', 'Equilibrium'].map(
    (t) => si.articleKind(t, /equilibrium/i.test(t) ? 'equilibrium' : /bat/i.test(t) ? 'bat' : /notion/i.test(t) ? 'notion' : 'crane'),
  ),
  ['qualifier', 'qualifier', 'compound', 'compound', null, null, null, null, 'exact'],
);
assert.ok(si.glossOverlap(['chemistry'], ['chemical']) === 1, 'chemistry and chemical are one word');
assert.ok(si.glossOverlap(['water'], ['watercourse']) === 1);
assert.strictEqual(si.glossOverlap(['constant'], ['construction']), 0);
assert.strictEqual(si.glossOverlap(['small'], ['small']), 0.5, 'a general word counts half');

const linksPages = (word) => st.responses[si.buildDisambiguationLinksUrl(word)].query.pages;
const plainList = (word) => st.senses[word].map((s) => ({ ...s, meaning: s.meaning }));
const concreteOf = (word) => plainList(word).map((s) => si.isConcreteNounSense(s, word));
{
  const m = si.matchSenseArticles(plainList('crane'), linksPages('crane'), 'crane', { concrete: concreteOf('crane') });
  const bySense = Object.fromEntries(m.map((x) => [x.senseIndex, x.page.title]));
  assert.strictEqual(bySense[1], 'Crane (bird)', 'crane: the bird sense gets the bird article');
  assert.strictEqual(bySense[3], 'Crane (machine)', 'crane: the lifting-machine sense gets the machine article');
  assert.ok(!Object.values(bySense).some((t) => /fly|shot|Texas|Co\./.test(t)), 'crane: no crane fly, crane shot, town or company');
}
{
  const m = si.matchSenseArticles(plainList('equilibrium'), linksPages('equilibrium'), 'equilibrium', { concrete: concreteOf('equilibrium') });
  same(m.map((x) => [x.senseIndex, x.page.title]), [[2, 'Chemical equilibrium'], [3, 'Mechanical equilibrium']]);
}
// A sense that already has a picture keeps its article: the next sense does not inherit it.
{
  const senses = [
    { meaning: 'An institution where one can place and borrow money and take care of financial affairs.', partOfSpeech: 'noun' },
    { meaning: 'A branch office of such an institution.', partOfSpeech: 'noun' },
  ];
  const bank = { title: 'Bank', description: 'Financial institution that accepts deposits', pageimage: 'x.jpg' };
  same(si.matchSenseArticles(senses, [bank], 'bank').map((x) => x.senseIndex), [0]);
  same(si.matchSenseArticles(senses, [bank], 'bank', { skip: new Set([0]) }), [], 'bank: the branch office gets no second bank building');
  // A compound names a kind of the thing: one shared word is not enough for a concrete sense.
  const coin = [{ meaning: 'A device used to store coins or currency.', partOfSpeech: 'noun' }];
  const central = { title: 'Central bank', description: 'Government body that manages currency and monetary policy', pageimage: 'y.jpg' };
  same(si.matchSenseArticles(coin, [central], 'bank', { concrete: [true] }), [], 'bank: a central bank is not a coin box');
  same(si.matchSenseArticles(coin, [{ ...central, description: undefined }], 'bank', { concrete: [false] }), [], 'no description, no match');
}

// A portrait of a named person, and Commons bookkeeping categories.
assert.ok(si.isNamedPersonPicture({ extmetadata: { Categories: { value: '1756 portrait paintings of men|Portraits of Horace Walpole' } } }));
assert.ok(!si.isNamedPersonPicture({ extmetadata: { Categories: { value: 'Portraits of people thinking|Smiling girls' } } }));
assert.strictEqual(
  si.topicCategories('CC-Zero|Artworks with known accession number|Images from Metropolitan Museum of Art|1808 caricatures of the United Kingdom|Horse riding cartoons'),
  '1808 caricatures of the United Kingdom|Horse riding cartoons',
);
// "The Mistaken Notion" is a caricature's title: no gloss word of "notion" in its name or topic.
{
  const url = Object.keys(st.responses).find((u) => u.includes('gsrsearch=intitle%3Anotion'));
  const gloss = si.contentTokens(st.cards.notion, 'notion');
  const ranked = si.rankCommonsFiles(st.responses[url].query.pages, 'notion', 'notion', gloss, { needGloss: true });
  assert.ok(!ranked.some((r) => /Mistaken Notion/.test(r.title)), `notion: rejected ${ranked.map((r) => r.title).join(', ')}`);
  assert.ok(si.rankCommonsFiles(st.responses[url].query.pages, 'notion', 'notion', gloss).some((r) => /Mistaken Notion/.test(r.title)), 'it would rank without the gloss check');
}

// ---------------------------------------------------------------- end to end with recorded responses

/** Module instance answering from a URL-keyed fixture; an unrecorded URL fails the request. */
function replay(responses, log, store = null) {
  return load({
    isCoreConfigured: () => true,
    getHttp: () => ({
      requestJson: async (url) => {
        log.push(url);
        const hit = responses[url];
        if (!hit) throw new Error('unrecorded URL ' + url);
        return JSON.parse(JSON.stringify(hit));
      },
    }),
    getLookupCache: () => store,
  });
}

(async () => {
  // crane: the bird and the lifting machine, from the disambiguation page's own articles, in
  // two rounds: Wiktionary, the title query and the disambiguation links side by side, then
  // one imageinfo call.
  {
    const log = [];
    const persisted = new Map();
    const store = { get: (k) => persisted.get(k) || null, set: (k, value, savedAt) => persisted.set(k, { value, savedAt }) };
    const mod = replay(st.responses, log, store);
    const senses = st.senses.crane;
    const imgs = await mod.fetchSenseImages('crane', senses, { lang: 'en' });
    assert.strictEqual(imgs.length, senses.length, 'one slot per sense');
    same(imgs.map((x, i) => x && [i, x.title]).filter(Boolean), [[1, 'Crane (bird)'], [3, 'Crane (machine)']]);
    assert.ok(imgs[1].thumb.includes('/330px-') && !imgs[1].thumb.includes('utm_'), 'thumb is the 330 px step without tracking');
    assert.ok(imgs[1].width > 0 && imgs[1].height > 0, 'thumb size for the aspect box');
    assert.ok(/Wikimedia Commons$/.test(imgs[3].credit));
    assert.ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(imgs[3].pageUrl));
    assert.strictEqual(log.length, 4, `crane: four requests, not ${log.length}`);
    assert.ok(!log.some((u) => u.includes('generator=search')), 'crane: no free-text search');

    // Cached: the same call makes no request; a new module instance reads the persistent cache.
    await mod.fetchSenseImages('crane', senses, { lang: 'en' });
    assert.strictEqual(log.length, 4, 'memory cache');
    assert.strictEqual(persisted.size, 1, 'written to the lookup cache');
    assert.ok([...persisted.keys()][0].startsWith('sense-images:v4:'));
    const again = load({
      isCoreConfigured: () => true,
      getHttp: () => ({ requestJson: async () => { throw new Error('should not fetch'); } }),
      getLookupCache: () => store,
    });
    assert.strictEqual((await again.fetchSenseImages('crane', senses, { lang: 'en' }))[3].title, 'Crane (machine)', 'persistent cache');

    // A card saved with the machine gloss shows the machine.
    assert.strictEqual((await replay(st.responses, []).fetchWordImage('crane', { lang: 'en', gloss: st.cards.crane })).title, 'Crane (machine)');
  }

  // equilibrium: the chemistry sense gets its article's Wikidata image (the article has no free
  // lead image), the mechanics sense its article's diagram; the general and mental senses none.
  {
    const log = [];
    const imgs = await replay(st.responses, log).fetchSenseImages('equilibrium', st.senses.equilibrium, { lang: 'en' });
    same(imgs.map((x, i) => x && [i, x.title]).filter(Boolean), [[2, 'Chemical equilibrium'], [3, 'Mechanical equilibrium']]);
    assert.ok(/Diag_eq\.svg/.test(imgs[2].pageUrl) && /WeightNormal\.svg/.test(imgs[3].pageUrl));
    assert.ok(!imgs[0] && !imgs[1], 'equilibrium: no picture for "condition of a system" or "mental balance"');
    assert.ok(log.some((u) => u.startsWith('https://www.wikidata.org/')), 'equilibrium: asks Wikidata');
    assert.strictEqual(log.length, 5);
  }

  // however: an adverb and conjunction gets no picture, and no search is spent finding none.
  {
    const log = [];
    same(await replay(st.responses, log).fetchSenseImages('however', st.senses.however, { lang: 'en' }), st.senses.however.map(() => null));
    assert.strictEqual(log.length, 2, 'however: Wiktionary and the title query only');
  }

  // notion: the sewing sense has an article of its own; the abstract senses stay bare. As a
  // card with the "idea" gloss, the only Commons hits are a caricature's title and places.
  {
    const imgs = await replay(st.responses, []).fetchSenseImages('notion', st.senses.notion, { lang: 'en' });
    same(imgs.map((x, i) => x && [i, x.title]).filter(Boolean), [[4, 'Notions (sewing)']]);
    const log = [];
    assert.strictEqual(await replay(st.responses, log).fetchWordImage('notion', { lang: 'en', gloss: st.cards.notion }), null, 'notion: no picture beats a wrong one');
    assert.ok(log.some((u) => u.includes('gsrsearch=intitle%3Anotion')), 'notion: the Commons search ran and was rejected');
  }

  // Failures resolve to no pictures.
  const failing = load({
    isCoreConfigured: () => true,
    getHttp: () => ({ requestJson: async () => { throw new Error('offline'); } }),
    getLookupCache: () => null,
  });
  const none = await failing.fetchSenseImages('apple', [{ meaning: 'A common, round fruit.', partOfSpeech: 'noun' }]);
  same(none, [null]);
  assert.strictEqual(await failing.fetchWordImage('apple'), null, 'offline, no picture');

  await fallbackEndToEnd();
  console.log('sense-images ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** Module instance answering from the fallback fixture by URL; an unrecorded URL fails the test. */
function recordedModule(log) {
  return load({
    isCoreConfigured: () => true,
    getHttp: () => ({
      requestJson: async (url) => {
        log.push(url);
        const hit = fb.responses[url];
        if (!hit) throw new Error('unrecorded URL ' + url);
        return JSON.parse(JSON.stringify(hit));
      },
    }),
    getLookupCache: () => null,
  });
}

async function fallbackEndToEnd() {
  // Every recorded word: the same pictures as on the live run, at least one, at most three.
  for (const [word, { lang, list }] of Object.entries(fb.senses)) {
    const imgs = await recordedModule([]).fetchSenseImages(word, list, { lang });
    assert.strictEqual(imgs.length, list.length, `${word}: one slot per sense`);
    const shown = imgs.map((x, i) => (x ? { i, title: x.title } : null)).filter(Boolean);
    same(shown, fb.expected[word].map(({ i, title }) => ({ i, title })), `${word}: recorded pictures`);
    // "serendipity": the article's lead image is a portrait of Horace Walpole, who coined the
    // word, and nothing else fits, so none.
    if (word === 'serendipity') assert.strictEqual(shown.length, 0, 'serendipity: no portrait of the coiner');
    else assert.ok(shown.length >= 1 && shown.length <= 3, `${word}: one to three pictures`);
    // "holon" is also a city in Israel; the picture is the philosophy article's.
    if (word === 'holon') same(shown.map((x) => x.title), ['Holon (philosophy)'], 'holon: no photo of the city');
    for (const x of imgs.filter(Boolean)) {
      assert.ok(/Wikimedia Commons$/.test(x.credit), `${word}: credit line`);
      assert.ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(x.pageUrl), `${word}: file page`);
      assert.ok(/^https:\/\/(upload|thumb)\.wikimedia\.org\/.*\/330px-/.test(x.thumb) && !x.thumb.includes('utm_'), `${word}: thumb`);
    }
  }

  // Words with no sense-specific picture get one on the first sense, in two rounds: Wiktionary,
  // the title query and (for a word with a noun sense) the disambiguation links side by side,
  // then one imageinfo call (or the Commons search, which carries its own file info).
  const want = {
    love: ['Romeo and Juliet in love', 4],
    inspect: ['Inspection', 3],
    ephemeral: ['Ephemerality', 4],
    beautiful: ['Beauty', 4],
    happiness: ['Happiness', 4],
    要対応: ['An action is required', 3],
  };
  for (const [word, [title, requests]] of Object.entries(want)) {
    const log = [];
    const { lang, list } = fb.senses[word];
    const imgs = await recordedModule(log).fetchSenseImages(word, list, { lang });
    assert.strictEqual(imgs[0] && imgs[0].title, title, `${word}: fallback picture on the first sense`);
    assert.ok(imgs.slice(1).every((x) => !x), `${word}: one fallback picture only`);
    assert.strictEqual(log.length, requests, `${word}: ${requests} requests, not ${log.length}`);
  }
  // "justice": the ideal-of-fairness sense matches the article itself, so the statue sits there.
  same(
    (await recordedModule([]).fetchSenseImages('justice', fb.senses.justice.list)).map((x, i) => x && [i, x.title]).filter(Boolean),
    [[1, 'Justice']],
  );
  // "serendipity": Horace Walpole's portrait leads the article; the word gets no picture.
  same(await recordedModule([]).fetchSenseImages('serendipity', fb.senses.serendipity.list), fb.senses.serendipity.list.map(() => null));

  // The title query starts before the Wiktionary answer arrives.
  {
    const started = [];
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const mod = load({
      isCoreConfigured: () => true,
      getHttp: () => ({
        requestJson: async (url) => {
          started.push(url);
          if (started.length === 1) await gate;
          return JSON.parse(JSON.stringify(fb.responses[url]));
        },
      }),
      getLookupCache: () => null,
    });
    const p = mod.fetchSenseImages('happiness', fb.senses.happiness.list, { lang: 'en' });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(started.length, 3, 'happiness: Wiktionary, the title query and the disambiguation links in parallel');
    assert.ok(started.some((u) => u.includes('wiktionary.org')) && started.some((u) => u.includes('generator=links')));
    release();
    assert.strictEqual((await p)[0].title, 'Happiness');
  }

  // A concrete noun keeps its strict picture and makes no fallback request.
  {
    const log = [];
    await recordedModule(log).fetchSenseImages('apple', fb.senses.apple.list, { lang: 'en' });
    assert.ok(!log.some((u) => u.includes('prop=images') || u.includes('gsrnamespace=6')), 'apple: no fallback request');
    assert.strictEqual(log.length, 4, 'apple: two rounds');
  }

  // fetchWordImage works without a gloss and returns the best picture for the word.
  const wordImage = (word, lang) => recordedModule([]).fetchWordImage(word, { lang });
  assert.strictEqual((await wordImage('run', 'en')).title, 'Running');
  assert.strictEqual((await wordImage('inspect', 'en')).title, 'Inspection');
  assert.strictEqual((await wordImage('猫', 'ja')).title, 'ネコ', '猫: the word on Japanese Wikipedia');
  assert.strictEqual(await wordImage('要対応', 'ja'), null, '要対応: no hit names the word, so no picture');

  // "Operon" has no free lead image; its own diagram comes from the article's pictures.
  {
    const log = [];
    const imgs = await recordedModule(log).fetchSenseImages('operon', fb.senses.operon.list, { lang: 'en' });
    assert.strictEqual(imgs[0].title, 'Lac Operon');
    assert.ok(/\/330px-Lac_Operon\.svg\.png$/.test(imgs[0].thumb), imgs[0].thumb);
    assert.ok(log.includes(si.buildArticleImagesUrl('Operon')), 'operon: asks for the article pictures');
    assert.ok(!log.some((u) => u.includes('generator=search&gsrnamespace=6')), 'operon: no Commons search needed');
  }
  // "Arbitrage": the article has no pictures at all, so Commons, finance first, also with no gloss.
  assert.strictEqual((await wordImage('arbitrage', 'en')).title, 'Statistical Arbitrage with two stocks');
  assert.strictEqual((await wordImage('operon', 'en')).title, 'Lac Operon');
  assert.strictEqual(await wordImage('holon', 'en'), null, 'holon: no photo of the city');

  // When the title query fails, the word may name a city too, so Commons hits need a gloss word.
  {
    const mod = load({
      isCoreConfigured: () => true,
      getHttp: () => ({
        requestJson: async (url) => {
          if (url.includes('titles=holon%7C')) throw new Error('HTTP 500');
          return JSON.parse(JSON.stringify(fb.responses[url]));
        },
      }),
      getLookupCache: () => null,
    });
    const imgs = await mod.fetchSenseImages('holon', fb.senses.holon.list, { lang: 'en' });
    same(imgs.map((x) => x && x.title), ['Holon (philosophy)', null], 'holon: no city photo without the title check');
  }

  // Wikimedia identifies the client by User-Agent; the configured client sends ours.
  {
    const seen = [];
    const mod = load({
      isCoreConfigured: () => true,
      getHttp: () => ({
        requestJson: async (url, opts) => {
          seen.push((opts && opts.headers) || {});
          return JSON.parse(JSON.stringify(fb.responses[url]));
        },
      }),
      getLookupCache: () => null,
    });
    await mod.fetchWordImage('operon', { lang: 'en' });
    assert.ok(seen.length && seen.every((h) => /^Phevere\/\d.*github\.com\/thd2020\/phevere/.test(h['User-Agent'])), 'User-Agent names the app');
  }

  // At most three requests in flight, however many cards ask at once.
  {
    let now = 0;
    let peak = 0;
    const mod = load({
      isCoreConfigured: () => true,
      getHttp: () => ({
        requestJson: async (url) => {
          now += 1;
          peak = Math.max(peak, now);
          await new Promise((r) => setTimeout(r, 5));
          now -= 1;
          return JSON.parse(JSON.stringify(fb.responses[url]));
        },
      }),
      getLookupCache: () => null,
    });
    const words = ['operon', 'arbitrage', 'holon', 'run', 'inspect', 'freedom', 'happiness', 'justice'];
    await Promise.all(words.map((w) => mod.fetchWordImage(w, { lang: 'en' }).catch(() => null)));
    assert.ok(peak >= 2 && peak <= 3, `peak concurrency ${peak}`);
  }

  // A 429 is retried once after a pause, and the picture still arrives.
  {
    const hits = new Map();
    const mod = load({
      isCoreConfigured: () => true,
      getHttp: () => ({
        requestJson: async (url) => {
          hits.set(url, (hits.get(url) || 0) + 1);
          if (hits.get(url) === 1 && url.includes('prop=images')) throw new Error('HTTP 429: Too Many Requests');
          return JSON.parse(JSON.stringify(fb.responses[url]));
        },
      }),
      getLookupCache: () => null,
    });
    assert.strictEqual((await mod.fetchWordImage('operon', { lang: 'en' })).title, 'Lac Operon');
    assert.strictEqual(hits.get(si.buildArticleImagesUrl('Operon')), 2, 'one retry');
  }

  // A failed request leaves the result uncached, so the next call (a notebook re-render) asks again.
  {
    let offline = true;
    const persisted = new Map();
    const mod = load({
      isCoreConfigured: () => true,
      getHttp: () => ({
        requestJson: async (url) => {
          if (offline) throw new Error('offline');
          return JSON.parse(JSON.stringify(fb.responses[url]));
        },
      }),
      getLookupCache: () => ({
        get: (k) => persisted.get(k) || null,
        set: (k, value, savedAt) => persisted.set(k, { value, savedAt }),
      }),
    });
    assert.strictEqual(await mod.fetchWordImage('operon', { lang: 'en' }), null, 'offline: no picture');
    assert.strictEqual(persisted.size, 0, 'offline: nothing saved');
    offline = false;
    assert.strictEqual((await mod.fetchWordImage('operon', { lang: 'en' })).title, 'Lac Operon', 'online again: retried');
  }

  // A saved result with no picture expires after six hours (a picture keeps for two weeks), and
  // results saved under the previous cache version are not read at all.
  {
    const persisted = new Map();
    const store = {
      get: (k) => persisted.get(k) || null,
      set: (k, value, savedAt) => persisted.set(k, { value, savedAt }),
    };
    const mod = load({ isCoreConfigured: () => true, getHttp: () => ({ requestJson: async (url) => JSON.parse(JSON.stringify(fb.responses[url])) }), getLookupCache: () => store });
    assert.strictEqual(await mod.fetchWordImage('holon', { lang: 'en' }), null);
    const [key] = [...persisted.keys()];
    assert.ok(key.startsWith('sense-images:v4:'), key);
    // Seven hours later a new session asks the network again.
    persisted.get(key).savedAt -= 7 * 60 * 60 * 1000;
    let asked = 0;
    const later = load({
      isCoreConfigured: () => true,
      getHttp: () => ({ requestJson: async (url) => { asked += 1; return JSON.parse(JSON.stringify(fb.responses[url])); } }),
      getLookupCache: () => store,
    });
    await later.fetchWordImage('holon', { lang: 'en' });
    assert.ok(asked > 0, 'an old empty result is retried');
    // A picture saved seven hours ago is still served from the cache.
    await later.fetchWordImage('operon', { lang: 'en' });
    const opKey = [...persisted.keys()].find((k) => k.includes(':operon:'));
    persisted.get(opKey).savedAt -= 7 * 60 * 60 * 1000;
    const third = load({
      isCoreConfigured: () => true,
      getHttp: () => ({ requestJson: async () => { throw new Error('should not fetch'); } }),
      getLookupCache: () => store,
    });
    assert.strictEqual((await third.fetchWordImage('operon', { lang: 'en' })).title, 'Lac Operon', 'a picture keeps');
  }
}
