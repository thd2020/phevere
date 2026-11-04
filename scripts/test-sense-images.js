/**
 * Checks for packages/core/src/sense-images.ts against recorded Wikimedia responses
 * (scripts/fixtures/sense-images.json, trimmed to the parts the module reads, and
 * scripts/fixtures/sense-images-fallback.json, keyed by request URL and recorded on 2026-11-02
 * for the whole-word fallback; operon, arbitrage and holon and the file-name Commons searches
 * were added on 2026-11-03; on 2026-11-04 every word was recorded again for pictures per major
 * sense, and equilibrium, afloat, adept, wind and bank were added with Wiktionary's REST senses).
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
// Without a gloss word, a hit naming the word as part of a name ("… school in Holon") drops out.
assert.ok(holonPages.length > 0, 'holon: the search found city photos');
same(si.rankCommonsFiles(holonPages, 'holon', 'holon', ['part', 'whole']).map((r) => r.title), [], 'holon: a place name is no picture of the word');
assert.ok(si.properName('Serendipity Beach, Sihanoukville', 'serendipity') && !si.properName('Static equilibrium same force', 'equilibrium'), 'proper names');
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

// ---------------------------------------------------------------- major senses and stand-ins

// A part of speech that comes back after another starts a new entry ("bank" of money, then of a river).
{
  const bank = [
    { meaning: 'An institution where one can place and borrow money.', partOfSpeech: 'noun' },
    { meaning: 'A branch office of such an institution.', partOfSpeech: 'noun' },
    { meaning: 'To deposit in a bank.', partOfSpeech: 'verb' },
    { meaning: 'An edge of river, lake, or other watercourse.', partOfSpeech: 'noun' },
    { meaning: 'ISO 639-3 language code for Bankal.', partOfSpeech: 'symbol' },
  ];
  const m = si.majorSenses(bank, 'bank', 4);
  same(Array.from(m.order), [0, 3, 2], 'bank: both entries, then the verb');
  assert.ok(m.heads.has(3) && !m.heads.has(1), 'bank: the river sense heads an entry');
  const eq = [
    { meaning: 'The condition of a system in which competing influences are balanced.', partOfSpeech: 'noun' },
    { meaning: 'Mental balance.', partOfSpeech: 'noun' },
    { meaning: 'The state of a reaction in which the rates of the forward and reverse reactions are the same.', partOfSpeech: 'noun' },
  ];
  same(Array.from(si.majorSenseIndexes(eq, 'equilibrium', 4)), [0, 2], 'equilibrium: "Mental balance" is close to "balanced"; the reaction is not');
  same(Array.from(si.majorSenseIndexes(eq, 'equilibrium', 1)), [0], 'max caps the list');

  // A lookup lists "wind" by part of speech; Wiktionary's etymologies say the coil is another word.
  const windText = [
    '==English==',
    '===Etymology 1===',
    '====Noun====',
    '# Real or perceived movement of [[atmospheric]] [[air]].',
    '# The ability to breathe easily.',
    '====Verb====',
    '# To blow air through a wind instrument.',
    '===Etymology 2===',
    '====Verb====',
    '# To turn [[coil]]s (of a cord) around something.',
    '====Noun====',
    '# The act of winding or turning; a turn; a bend.',
  ].join('\n');
  const wind = [
    { meaning: 'Real or perceived movement of atmospheric air.', partOfSpeech: 'noun' },
    { meaning: 'The ability to breathe easily.', partOfSpeech: 'noun' },
    { meaning: 'The act of winding or turning; a turn; a bend.', partOfSpeech: 'noun' },
    { meaning: 'To blow air through a wind instrument.', partOfSpeech: 'verb' },
    { meaning: 'To turn coils (of a cord) around something.', partOfSpeech: 'verb' },
  ];
  const ety = Array.from(si.sensesEtymology(windText, 'en', wind, 'wind'));
  same(ety, [1, 1, 2, 1, 2], 'wind: each sense under its etymology');
  same(Array.from(si.majorSenseIndexes(wind, 'wind', 3)), [0, 3, 1], 'wind without etymologies: by part of speech');
  same(Array.from(si.majorSenses(wind, 'wind', 3, ety).order), [0, 2, 3], 'wind: the coil word is an entry of its own');
}

{
  const link = (w, t = w) => `<a rel="mw:WikiLink" href="/wiki/${t}" title="${t}">${w}</a>`;
  const balance = si.standInWords(`${link('Mental', 'mental')} ${link('balance')}.`, 'equilibrium');
  assert.ok(balance.words.includes('balance') && balance.whole, 'Mental balance: the gloss is the word');
  const system = si.standInWords(`The ${link('condition')} of a ${link('system')} in which competing influences are ${link('balanced', 'balance')}.`, 'equilibrium');
  same(system.words, [], 'a description names arguments, not the meaning');
  const sea = si.standInWords(`In a ${link('vessel')} at ${link('sea')} or on another body of water; ${link('at sea', 'sea')}.`, 'afloat');
  assert.ok(sea.words[0] === 'sea' && !sea.whole, 'afloat: the short clause "at sea"');
  same(si.standInWords('The act of winding or turning; a turn.', 'wind').words, ['turn'], 'no -ing forms');
}

{
  const page = (title, description, extract = '', pageimage = 'X.jpg') => ({
    title, description, extract, pageimage, thumbnail: { source: 'https://x/330px-X.jpg', width: 330, height: 200 },
  });
  const gloss = 'The state of a reaction in which the rates of the forward and reverse reactions are the same.';
  const chem = page('Chemical equilibrium', 'When the ratio of reactants to products of a chemical reaction is constant with time', 'This state results when the forward reaction proceeds at the same rate as the reverse reaction.');
  assert.ok(si.acceptSenseArticle(chem, 'equilibrium', gloss, { strict: true }), 'Chemical equilibrium fits');
  assert.ok(!si.acceptSenseArticle(page('Cow–calf operation', 'Method of raising cattle for beef'), 'cow', 'Beef: the meat of cattle as food.'), 'two more words: something else');
  assert.ok(!si.acceptSenseArticle(page('Equilibrium (film)', 'American film'), 'equilibrium', gloss), 'a film is never the sense');
  assert.ok(si.acceptSenseArticle({ ...chem, pageimage: undefined, thumbnail: undefined }, 'equilibrium', gloss, { strict: true, anyImage: true }), 'no lead image: still the article');
}

{
  const rec = (categories, description = '') => ({
    url: 'u', thumburl: 't', extmetadata: { Categories: { value: categories }, ImageDescription: { value: description } },
  });
  const opts = (word, level, meaning = 'Mental balance.') => ({ word, gloss: si.contentTokens(meaning, 'equilibrium'), lemma: 'equilibrium', level });
  assert.ok(si.verifyPictureRecord('Eo-scale of justice.gif', rec('Scale icons|Balanced scales of justice', 'scale of justice'), opts('balance', 'named')), 'the record names the word');
  assert.ok(!si.verifyPictureRecord('InternationalCoins.JPG', rec('Mixed coins', 'coins, shilling, penny'), opts('change', 'named')), 'coins are not "change" here');
  const walpole = rec('18th-century portrait paintings|Portraits of Horace Walpole');
  assert.ok(!si.verifyPictureRecord('Horace Walpole.jpg', walpole, { gloss: [], lemma: 'serendipity', level: 'portrait' }), 'no portrait for a non-person word');
  assert.ok(si.verifyPictureRecord('Horace Walpole.jpg', walpole, { gloss: [], lemma: 'adept', personGloss: true, level: 'portrait' }), 'a portrait for a word about people');
  assert.ok(!si.verifyPictureRecord('Sea.jpg', rec('Locator maps of seas'), opts('sea', 'clean')), 'no map');
}
assert.ok(!si.buildCommonsSearchUrl('serendipity', { fullText: true }).includes('intitle'), 'full-text Commons search');
assert.ok(si.buildCommonsSearchUrl('serendipity').includes('intitle%3Aserendipity'), 'file-name Commons search');

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
    // "holon": its title is a city in Israel and its concept article has no picture, so none.
    if (word === 'holon') assert.strictEqual(shown.length, 0, 'holon: no photo of the city');
    else assert.ok(shown.length >= 1 && shown.length <= 3, `${word}: one to three pictures`);
    for (const x of imgs.filter(Boolean)) {
      assert.ok(/Wikimedia Commons$/.test(x.credit), `${word}: credit line`);
      assert.ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(x.pageUrl), `${word}: file page`);
      assert.ok(/^https:\/\/(upload|thumb)\.wikimedia\.org\/.*\/330px-/.test(x.thumb) && !x.thumb.includes('utm_'), `${word}: thumb`);
    }
  }

  // Words with no sense-specific picture get one on the first sense: their own article, a
  // Wiktionary caption naming them, a derived noun's article or a Commons file named after them.
  // For a word with no concrete noun sense the requests that do not depend on each other go out
  // together (Wiktionary, the title query, the sense searches and the stand-in queries), and
  // file details for every candidate come in one imageinfo call.
  const want = {
    serendipity: 'Serendipity',
    love: 'Romeo and Juliet in love',
    freedom: 'Freedom',
    inspect: 'Inspection',
    beautiful: 'Beauty',
    justice: 'Justice',
    happiness: 'Happiness',
    要対応: 'An action is required',
    equilibrium: 'Static equilibrium same force',
  };
  for (const [word, title] of Object.entries(want)) {
    const log = [];
    const { lang, list } = fb.senses[word];
    const imgs = await recordedModule(log).fetchSenseImages(word, list, { lang });
    assert.strictEqual(imgs[0] && imgs[0].title, title, `${word}: picture on the first sense`);
    assert.ok(log.length <= 12, `${word}: ${log.length} requests`);
    assert.strictEqual(log.filter((u) => u.includes('prop=imageinfo&')).length <= 2, true, `${word}: file details asked at most twice`);
  }
  // Serendipity's article shows a portrait of Horace Walpole, who coined the word; a portrait
  // of a named person is no picture of a word that is not about people.
  {
    const imgs = await recordedModule([]).fetchSenseImages('serendipity', fb.senses.serendipity.list, { lang: 'en' });
    assert.ok(!imgs.some((x) => x && /Walpole/.test(x.pageUrl)), 'serendipity: no portrait');
  }

  // Unrelated meanings each get a picture: money and river for "bank", air, coil and instrument
  // for "wind" (the coil is another etymology on Wiktionary).
  {
    const bank = await recordedModule([]).fetchSenseImages('bank', fb.senses.bank.list, { lang: 'en' });
    const shown = bank.map((x, i) => (x ? [i, x.title] : null)).filter(Boolean);
    assert.ok(shown.some(([, t]) => /Bank of England/.test(t)) && shown.some(([, t]) => /river bank/i.test(t)), JSON.stringify(shown));
    const wind = await recordedModule([]).fetchSenseImages('wind', fb.senses.wind.list, { lang: 'en' });
    assert.ok(wind.filter(Boolean).length >= 3, 'wind: three meanings pictured');
    assert.ok(/Turn-roundturn/.test(wind.filter(Boolean).map((x) => x.pageUrl).join(' ')), 'wind: a rope wound in turns');
  }

  // The first pictures arrive through onUpdate before the slower steps finish.
  {
    const updates = [];
    const imgs = await recordedModule([]).fetchSenseImages('wind', fb.senses.wind.list, { lang: 'en', onUpdate: (l) => updates.push(l.filter(Boolean).length) });
    assert.ok(updates.length >= 1 && updates[0] >= 1 && updates[0] <= imgs.filter(Boolean).length, `updates ${updates}`);
  }

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
    assert.ok(started.length >= 2 && started.length <= 6, `happiness: ${started.length} requests start together`);
    assert.ok(started.some((u) => u.includes('titles=happiness%7C')), 'happiness: the title query does not wait for Wiktionary');
    assert.ok(started.some((u) => u.includes('wiktionary.org')) && started.some((u) => u.includes('wikipedia.org')));
    release();
    assert.strictEqual((await p)[0].title, 'Happiness');
  }

  // A concrete noun keeps its strict picture and makes no fallback request.
  {
    const log = [];
    await recordedModule(log).fetchSenseImages('apple', fb.senses.apple.list, { lang: 'en' });
    assert.ok(!log.some((u) => u.includes('apple%7C')), 'apple: no fallback title query');
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
    assert.ok(log.some((u) => u.includes('prop=images&') && u.includes('titles=Operon')), 'operon: asks for the article pictures');
    assert.ok(!log.some((u) => u.includes('generator=search&gsrnamespace=6')), 'operon: no Commons search needed');
  }
  // "Arbitrage": the article has no pictures at all, so Commons, finance first, also with no gloss.
  assert.ok(/Arbitrage/.test((await wordImage('arbitrage', 'en')).title), 'arbitrage: a finance picture named after the word');
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
    same(await mod.fetchSenseImages('holon', fb.senses.holon.list, { lang: 'en' }), [null, null], 'holon: no city photo without the title check');
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

  // Cards that load together share one file-details request.
  {
    const asked = [];
    const mod = load({
      isCoreConfigured: () => true,
      getHttp: () => ({
        requestJson: async (url) => {
          asked.push(url);
          const q = new URL(url).searchParams;
          const titles = (q.get('titles') || '').split('|').filter(Boolean);
          if (url.includes('prop=imageinfo')) {
            return {
              query: {
                pages: titles.map((t) => {
                  const f = t.replace(/^File:/, '').replace(/ /g, '_');
                  return {
                    title: t,
                    imageinfo: [{ url: `https://upload.wikimedia.org/x/${f}`, thumburl: `https://upload.wikimedia.org/x/thumb/${f}/330px-${f}`, thumbwidth: 330, thumbheight: 220, width: 800, mime: 'image/jpeg', descriptionurl: `https://commons.wikimedia.org/wiki/${t.replace(/ /g, '_')}` }],
                  };
                }),
              },
            };
          }
          if (url.includes('en.wikipedia.org') && titles.length) {
            const known = titles.filter((t) => t === 'pebble' || t === 'marble');
            const name = (w) => w.charAt(0).toUpperCase() + w.slice(1);
            return {
              query: {
                normalized: known.map((w) => ({ from: w, to: name(w) })),
                pages: known.map((w) => ({ title: name(w), description: 'Small round object', pageimage: `${name(w)}.jpg`, thumbnail: { source: 'https://x/330px-a.jpg', width: 330, height: 220 } })),
              },
            };
          }
          return { query: { pages: [] } };
        },
      }),
      getLookupCache: () => null,
    });
    const [a, b] = await Promise.all([mod.fetchWordImage('pebble', { lang: 'en' }), mod.fetchWordImage('marble', { lang: 'en' })]);
    assert.ok(a && b && a.title === 'Pebble' && b.title === 'Marble', 'both cards have a picture');
    assert.strictEqual(asked.filter((u) => u.includes('prop=imageinfo')).length, 1, 'one imageinfo request for both cards');
    assert.strictEqual(asked.filter((u) => u.includes('en.wikipedia.org') && u.includes('prop=pageimages')).length, 1, 'one title query for both cards');
    assert.strictEqual(asked.filter((u) => u.includes('wiktionary.org') && u.includes('rvprop=content')).length, 1, 'one Wiktionary request for both cards');
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
