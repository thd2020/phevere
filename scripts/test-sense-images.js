/**
 * Checks for packages/core/src/sense-images.ts: the matching rules against recorded Wiktionary
 * and Wikipedia answers (scripts/fixtures/sense-images.json, trimmed to the parts the module
 * reads), and the whole flow against a stubbed network. Live precision and coverage are measured
 * by scripts/measure-sense-images.js --relevance on scripts/fixtures/sense-images-relevance.json.
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
    console: { ...console, warn: () => {} },
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

const titleUrl = si.buildWikipediaTitleUrl('Apple');
assert.ok(titleUrl.startsWith('https://en.wikipedia.org/w/api.php?'));
for (const part of ['titles=Apple', 'redirects=1', 'pilicense=free', 'pithumbsize=330', 'ppprop=disambiguation', 'origin=*']) {
  assert.ok(titleUrl.includes(part), `title URL lacks ${part}`);
}
assert.ok(si.buildWiktionaryUrl('猫').includes('titles=%E7%8C%AB'));
const infoUrl = si.buildImageInfoUrl(['Framing_hammer.jpg']);
assert.ok(infoUrl.startsWith('https://commons.wikimedia.org/') && infoUrl.includes('File%3AFraming%20hammer.jpg'));
assert.ok(infoUrl.includes('iiurlwidth=330') && infoUrl.includes('Categories'));
const lexUrl = decodeURIComponent(si.buildLexemeQueryUrl(['crane', 'bank'], 'en'));
assert.ok(lexUrl.startsWith('https://query.wikidata.org/sparql?format=json&query='));
assert.ok(lexUrl.includes('VALUES ?lemma { "crane"@en "bank"@en }') && lexUrl.includes('wdt:P5137') && lexUrl.includes('wdt:P18'));

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

const hammerImgs = si.extractWiktionaryImages(wikitext('hammer'), 'en');
same(
  si
    .matchWiktionaryImages(
      hammerImgs,
      [
        { meaning: 'A tool with a heavy head and a handle used for pounding.', partOfSpeech: 'noun' },
        { meaning: 'The act of using a hammer to hit something.', partOfSpeech: 'noun' },
        { meaning: '(music) In a piano or dulcimer, a piece of wood covered in felt that strikes the string.', partOfSpeech: 'noun' },
      ],
      'hammer',
    )
    .map((m) => [m.senseIndex, hammerImgs[m.imageIndex].file]),
  [[0, 'Framing hammer.jpg'], [2, 'Piano hammer.jpg']],
);
const carImgs = si.extractWiktionaryImages(wikitext('car'), 'en');
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
assert.ok(!si.extractWiktionaryImages('==English==\n[[File:En-us-run.ogg|thumb|run]]', 'en').length, 'audio is no picture');
assert.ok(!si.extractWiktionaryImages('==English==\n[[File:Afloat and Ashore, cover.png|thumb|Afloat and Ashore, cover]]', 'en').length, 'a book cover is no picture');
assert.strictEqual(
  si.matchWiktionaryImages(hammerImgs, [{ meaning: 'A tool with a heavy head and a handle used for pounding.', partOfSpeech: 'verb' }], 'hammer').length,
  0,
  'parts of speech must agree',
);

// ---------------------------------------------------------------- Wikipedia articles

const page = (t) => fx.wikipediaTitle[t].query.pages[0];
assert.ok(si.acceptWikipediaPage(page('Apple'), 'apple', 'A common, round fruit produced by the tree Malus domestica.', 'apple'));
assert.ok(!si.acceptWikipediaPage(page('Crane'), 'crane', 'Any bird of the family Gruidae.', 'crane'), 'disambiguation page');
assert.ok(!si.acceptWikipediaPage(page('House'), 'house', 'A structure built or serving as an abode of human beings.', 'house'), 'no shared word');
assert.ok(!si.acceptWikipediaPage(page('Serendipity'), 'serendipity', 'A combination of events which have come together by chance.', 'serendipity'));
assert.ok(si.acceptWikipediaPage(page('Cat'), 'cat', 'cat', '猫', { exactGloss: true }), '猫: the gloss is the article title');
assert.strictEqual(si.shortGlossTitle('cat; (dialect) a kind of …'), 'cat');
assert.strictEqual(si.shortGlossTitle('A common, round fruit produced by the tree Malus domestica'), '');
const conceptPage = (over) => ({
  title: 'Justice',
  description: 'Concept of moral fairness',
  pageimage: 'Justice_Statue_Iran.jpg',
  thumbnail: { source: 'https://upload.wikimedia.org/x.jpg', width: 330, height: 400 },
  ...over,
});
assert.ok(si.acceptConceptPage(conceptPage({})));
assert.ok(!si.acceptConceptPage(conceptPage({ pageprops: { disambiguation: '' } })), 'disambiguation page');
assert.ok(!si.acceptConceptPage(conceptPage({ description: '2001 film by Peter Chelsom' })), 'a film');
assert.ok(!si.acceptConceptPage(conceptPage({ pageimage: 'Seal_of_the_United_States_Supreme_Court.svg' })), 'a seal');
same(
  si.rankArticleImages(['File:Gene structure prokaryote 2 unannotated.svg', 'File:Lac Operon.svg', 'File:OOjs UI icon edit-ltr-progressive.svg', 'File:Tree of life.svg'], 'operon', []),
  ['Lac Operon.svg'],
  'operon: only a picture that names the word',
);

// ---------------------------------------------------------------- credits and file details

const boeInfo = fx.imageinfo.query.pages.find((p) => /Bank of England/.test(p.title)).imageinfo[0];
assert.strictEqual(si.creditFromInfo(boeInfo), 'Diliff · CC BY-SA 3.0 · Wikimedia Commons');
assert.strictEqual(si.shortArtist('<a href="//commons.wikimedia.org/wiki/User:Ellywa">User:Ellywa</a> (original photo)'), 'Ellywa');
assert.strictEqual(si.commonsFileTitle('File:An action is required - geograph.org.uk - 6143024.jpg'), 'An action is required');
const svg = si.imageFromInfo('Lac Operon.svg', 'Lac Operon', {
  url: 'https://upload.wikimedia.org/wikipedia/commons/2/22/Lac_Operon.svg',
  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Lac_Operon.svg/330px-Lac_Operon.svg.png',
  mime: 'image/svg+xml',
  width: 600,
});
assert.ok(svg.url.endsWith('/960px-Lac_Operon.svg.png'), svg.url);

// ---------------------------------------------------------------- major senses

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
  const windText = [
    '==English==',
    '===Etymology 1===',
    '====Noun====',
    '# Real or perceived movement of [[atmospheric]] [[air]].',
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
    { meaning: 'The act of winding or turning; a turn; a bend.', partOfSpeech: 'noun' },
    { meaning: 'To blow air through a wind instrument.', partOfSpeech: 'verb' },
    { meaning: 'To turn coils (of a cord) around something.', partOfSpeech: 'verb' },
  ];
  const ety = Array.from(si.sensesEtymology(windText, 'en', wind, 'wind'));
  same(ety, [1, 2, 1, 2], 'wind: each sense under its etymology');
  assert.ok(si.majorSenses(wind, 'wind', 4, ety).heads.has(1), 'wind: the coil word is an entry of its own');
}

// ---------------------------------------------------------------- Wikidata lexeme senses

const binding = (lemma, sense, cat, gloss, item, label, desc, img) => ({
  lemma: { value: lemma },
  sense: { value: `http://www.wikidata.org/entity/${sense}` },
  cat: { value: `http://www.wikidata.org/entity/${cat}` },
  gloss: gloss ? { value: gloss } : undefined,
  item: item ? { value: `http://www.wikidata.org/entity/${item}` } : undefined,
  itemLabel: label ? { value: label } : undefined,
  itemDesc: desc ? { value: desc } : undefined,
  img: img ? { value: `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}` } : undefined,
});
const craneRows = [
  binding('crane', 'L22641-S1', 'Q1084', 'family of birds', 'Q25365', 'Gruidae', 'family of birds', 'Sarus cranecropped.jpg'),
  binding('crane', 'L22641-S2', 'Q1084', 'type of machine', 'Q178692', 'crane', 'machine used for lifting', 'Turmdrehkran-liebherr.jpg'),
  binding('crane', 'L22641-S3', 'Q1084', 'heraldic animal', 'Q1786481', 'crane', 'heraldic charge', null),
  binding('crane', 'L22643-S5', 'Q24905', 'stretch towards', null, null, null, null),
  binding('bank', 'L3354-S1', 'Q1084', 'financial institution', 'Q22687', 'bank', 'financial institution', 'Bank.jpg'),
];
const craneLex = si.parseLexemeRows(craneRows, 'crane');
same(craneLex.map((l) => [l.sense, l.pos, l.file]), [
  ['L22641-S1', 'noun', 'Sarus cranecropped.jpg'],
  ['L22641-S2', 'noun', 'Turmdrehkran-liebherr.jpg'],
]);
assert.strictEqual(si.glossHead('family of birds'), 'bird');
assert.strictEqual(si.glossHead('sloping edge of a watercourse'), 'edge');
assert.strictEqual(si.glossHead("one of the Earth's four temperate seasons, occurring between winter and summer"), 'season');
assert.strictEqual(
  si.glossHead('in an East Asian context, is a general name for printing stamps and impressions thereof which are used in lieu of signatures'),
  'impression',
);
assert.strictEqual(
  si.bestImage(
    ['http://x/Special:FilePath/Equisetum%20braunii%20(strobilus).jpg', 'http://x/Special:FilePath/Internal%20organs.svg', 'http://x/Special:FilePath/1930s%20bass%20banjo%20ad.jpg'],
    'organ collection of tissues',
  ),
  'http://x/Special:FilePath/Internal%20organs.svg',
  'an image named after the item wins',
);
const fit = (l, meaning, pos = 'noun', lemma = 'crane') => si.lexemeFit(l, { meaning, partOfSpeech: pos }, lemma);
assert.ok(fit(craneLex[0], 'Any bird of the family Gruidae, large birds with long legs.') > 0, 'crane: the bird');
assert.ok(fit(craneLex[1], 'A mechanical lifting machine or device.') > 0, 'crane: the machine');
assert.strictEqual(fit(craneLex[1], 'Any bird of the family Gruidae.'), 0, 'crane: the machine is no bird');
assert.strictEqual(fit(craneLex[0], 'To stretch one’s neck.', 'verb'), 0, 'parts of speech must agree');
const lex = (gloss, itemLabel = '', itemDescription = '') => ({ sense: 'L1-S1', pos: 'noun', gloss, item: 'Q1', itemLabel, itemDescription, file: 'x.jpg' });
assert.strictEqual(fit(lex('drafting instrument'), 'The range of notes of a musical instrument or voice.', 'noun', 'compass'), 0, 'one shared word elsewhere is not enough');
assert.ok(fit(lex('drafting instrument', 'compass', 'technical drawing instrument'), 'A pair of compasses (a device used to draw circular arcs).', 'noun', 'compass') > 0, 'device and instrument name the same head');
assert.strictEqual(
  fit(lex('any of a number of instruments which produce low pitched tones', 'bass instrument'), 'The section of a musical ensemble that produces the lowest-pitched tones.', 'noun', 'bass'),
  0,
  'bass: an instrument is not a section of the ensemble',
);
assert.strictEqual(fit(lex('water source'), 'The source from which an action or supply of something springs.', 'noun', 'spring'), 0, 'spring: a water source is not the source of an action');

// Titles from definition lines: the first clause, whole words only.
assert.strictEqual(si.titleFromGloss('Panthera tigris, a large predatory mammal of the cat family, native to Asia.'), 'Panthera tigris');
assert.strictEqual(si.titleFromGloss('(zoology) A large bird of the family Gruidae with long legs and neck, found on every continent but South America and Antarctica'), 'A large bird of the family Gruidae with long legs and neck…');
assert.ok(!/\s\S{1,2}…$/.test(si.titleFromGloss('An elastic device, usually a coil of metal wire, that regains its original shape after being compressed or extended')), 'no cut words');

// A lexeme item named with a sibling compound is another thing.
assert.ok(si.siblingCompound('keystone', 'capstone'));
assert.ok(!si.siblingCompound('Gruidae', 'crane') && !si.siblingCompound('crane', 'crane') && !si.siblingCompound('tower crane', 'crane') && !si.siblingCompound('seashell', 'shell'));

// Heads behind adjective lists, and articles from a disambiguation page.
same(si.glossHeads('A royal, imperial or princely headdress; a diadem.', 'crown'), ['headdress']);
same(si.glossHeads('Hard, protective outer layers created by an animal that lives in the sea'), ['layer']);
assert.ok(si.pageFitsGloss({ title: 'Crown', description: 'Form of headwear, symbolizing the power of a ruler' }, 'crown', 'A royal, imperial or princely headdress; a diadem.', 'crown'), 'headdress and headwear');
assert.ok(si.relatedTitle('Pitcher (container)', 'pitcher') && si.relatedTitle('Tobacco pipe', 'pipe') && si.relatedTitle('Seashell', 'shell'));
assert.ok(!si.relatedTitle('Pitcher', 'pitcher') && !si.relatedTitle('The Crown', 'crown') && !si.relatedTitle('Pitcher (surname)', 'pitcher') && !si.relatedTitle('Jules Pipe Smith', 'pipe'));
{
  const jug = { meaning: 'A wide-mouthed, deep vessel for holding liquids, with a spout or lip for pouring.', partOfSpeech: 'noun' };
  const player = { meaning: 'The player who delivers the ball to the batter.', partOfSpeech: 'noun' };
  const container = { title: 'Pitcher (container)', description: 'Container with a spout used for storing and pouring liquids', extract: 'A pitcher is a container with a handle and a spout.' };
  assert.ok(si.relatedPageFit(container, jug, 'pitcher') > 0, 'the container fits the jug');
  assert.strictEqual(si.relatedPageFit(container, player, 'pitcher'), 0, 'not the player');
  const cap = { title: 'Cap (crown)', description: 'Cap which fills the inner space of a modern crown', extract: 'The cap of a crown is the cap that fills the inner space of a modern crown.' };
  assert.strictEqual(si.relatedPageFit(cap, { meaning: 'A crown for covering a tooth.', partOfSpeech: 'noun' }, 'cap'), 0, 'a crown cap is not a dental crown');
  const white = { title: 'Whiteboard', description: 'Surface for nonpermanent markings', extract: 'A whiteboard is a glossy surface for nonpermanent markings.' };
  assert.strictEqual(si.relatedPageFit(white, { meaning: 'A flat surface with markings for playing a board game.', partOfSpeech: 'noun' }, 'board'), 0, 'a whiteboard is not a game board');
}

// ---------------------------------------------------------------- assigning pictures from a pool

function poolOf(over) {
  const img = (file) => ({ url: `u/${file}`, thumb: `t/330px-${file}`, title: file, pageUrl: `https://commons.wikimedia.org/wiki/File:${file.replace(/ /g, '_')}`, credit: 'Wikimedia Commons' });
  const pool = { lemma: 'crane', lang: 'en', wiktionary: [], lexemes: craneLex, article: null, glossArticles: [], etymology: [], pictures: [], complete: true, failed: false, ...over };
  pool.pictures = [
    ...pool.lexemes.map((l, k) => ({ file: l.file, source: 'lexeme', ref: k, image: img(l.file) })),
    ...(over && over.pictures ? over.pictures : []),
  ];
  return pool;
}
const craneSenses = [
  { meaning: 'Any bird of the family Gruidae, large birds with long legs and a long neck.', partOfSpeech: 'noun' },
  { meaning: 'Ardea herodias, the great blue heron.', partOfSpeech: 'noun' },
  { meaning: 'A mechanical lifting machine or device, often used for lifting heavy loads.', partOfSpeech: 'noun' },
  { meaning: 'To extend (one’s neck).', partOfSpeech: 'verb' },
];
const assigned = si.assignPictures(poolOf(), craneSenses);
same(assigned.map((x) => x && x.title), ['Sarus cranecropped.jpg', null, 'Turmdrehkran-liebherr.jpg', null], 'crane: the bird and the machine');
same(
  si.assignPictures(poolOf(), craneSenses, { hidden: new Set(['turmdrehkran-liebherr.jpg']) }).map((x) => x && x.title),
  ['Sarus cranecropped.jpg', null, null, null],
  'a hidden picture never shows',
);
{
  // A portrait of a named person never shows, not even on a sense about people.
  const pool = poolOf();
  pool.pictures[0].portrait = true;
  assert.strictEqual(si.assignPictures(pool, craneSenses)[0], null, 'no portrait for a bird');
  assert.strictEqual(si.assignPictures(pool, [{ meaning: 'One who operates a crane.', partOfSpeech: 'noun' }])[0], null, 'no named portrait for a person sense');
}
{
  // The article titled with the word goes to a noun sense its description fits, never a verb.
  const article = { title: 'Wind', description: 'Natural movement of air or other gases', extract: 'Wind is the natural movement of air.', pageimage: 'Wind.gif', thumbnail: { source: 's', width: 1, height: 1 } };
  const pool = poolOf({ lemma: 'wind', lexemes: [], article, pictures: [{ file: 'Wind.gif', source: 'article', ref: 0 }] });
  pool.pictures[0].image = { url: 'u', thumb: 't', title: 'Wind', pageUrl: 'https://commons.wikimedia.org/wiki/File:Wind.gif', credit: 'c' };
  same(
    si
      .assignPictures(pool, [
        { meaning: 'To blow air through a wind instrument.', partOfSpeech: 'verb' },
        { meaning: 'A natural current of air outdoors.', partOfSpeech: 'noun' },
      ])
      .map((x) => x && x.title),
    [null, 'Wind'],
  );
}
{
  // A curated picture of a minor sense waits until the first sense you can see has its own, or
  // until every source has answered without one.
  const bellSenses = [
    { meaning: 'A hollow metallic percussion instrument that rings when struck.', partOfSpeech: 'noun' },
    { meaning: 'The sound of a bell being struck.', partOfSpeech: 'noun' },
    { meaning: 'A bell-shaped flower of the genus Campanula.', partOfSpeech: 'noun' },
  ];
  const flower = { file: 'Campanula.jpg', caption: 'A bell flower', senseText: 'A bell-shaped flower of the genus Campanula.', pos: 'noun', etymology: 0 };
  const img = (file) => ({ url: `u/${file}`, thumb: `t/${file}`, title: file, pageUrl: `p/${file}`, credit: 'c' });
  const only = poolOf({ lemma: 'bell', lexemes: [], wiktionary: [flower], complete: false, pictures: [{ file: flower.file, source: 'wiktionary', ref: 0, image: img(flower.file) }] });
  same(si.assignPictures(only, bellSenses), [null, null, null], 'bell: no flower while the instrument may still get one');
  only.complete = true;
  same(si.assignPictures(only, bellSenses).map((x) => x && x.title), [null, null, 'Campanula.jpg'], 'bell: the flower once no source has the instrument');
  const instrument = { file: 'Church bell.jpg', caption: 'A church bell', senseText: 'A hollow metallic percussion instrument that rings when struck.', pos: 'noun', etymology: 0 };
  const both = poolOf({
    lemma: 'bell',
    lexemes: [],
    wiktionary: [flower, instrument],
    pictures: [
      { file: flower.file, source: 'wiktionary', ref: 0, image: img(flower.file) },
      { file: instrument.file, source: 'wiktionary', ref: 1, image: img(instrument.file) },
    ],
  });
  same(si.assignPictures(both, bellSenses).map((x) => x && x.title), ['Church bell.jpg', null, 'Campanula.jpg'], 'bell: the instrument, then the flower');
  // A curated picture stays on an abstract sense ("hope" has an allegory), but only on that sense.
  const hope = { file: 'Hope allegory.jpg', caption: 'Hope', senseText: 'The belief that something wished for can happen.', pos: 'noun', etymology: 0 };
  const hopePool = poolOf({ lemma: 'hope', lexemes: [], wiktionary: [hope], pictures: [{ file: hope.file, source: 'wiktionary', ref: 0, image: img(hope.file) }] });
  same(
    si.assignPictures(hopePool, [
      { meaning: 'The belief that something wished for can happen.', partOfSpeech: 'noun' },
      { meaning: 'To want something to happen.', partOfSpeech: 'verb' },
    ]).map((x) => x && x.title),
    ['Hope allegory.jpg', null],
  );
}

// ---------------------------------------------------------------- the whole flow, stubbed network

const craneSparql = { results: { bindings: craneRows } };
function stubHttp(log, opts = {}) {
  return {
    requestJson: async (url, o) => {
      log.push({ url, headers: (o && o.headers) || {} });
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      if (opts.fail && opts.fail(url)) throw new Error('HTTP 503');
      const u = new URL(url);
      const q = u.searchParams;
      if (u.hostname === 'query.wikidata.org') {
        // The lexeme query, or the item-image query for Wiktionary's sense lines and articles.
        if (q.get('query').includes('wikibase:lemma')) return JSON.parse(JSON.stringify(craneSparql));
        return { results: { bindings: [] } };
      }
      if (u.hostname === 'en.wiktionary.org') {
        const pages = q.get('titles').split('|').map((t) => (fx.wiktionary[t] ? fx.wiktionary[t].query.pages[0] : { title: t, missing: true }));
        return { query: { pages } };
      }
      if (u.hostname === 'en.wikipedia.org') {
        const t = q.get('titles');
        const name = t.charAt(0).toUpperCase() + t.slice(1);
        return fx.wikipediaTitle[name] ? JSON.parse(JSON.stringify({ query: { ...fx.wikipediaTitle[name].query, normalized: [{ from: t, to: name }] } })) : { query: { pages: [{ title: t, missing: true }] } };
      }
      if (u.hostname === 'commons.wikimedia.org') {
        const pages = q.get('titles').split('|').map((t) => {
          const f = t.replace(/^File:/, '').replace(/ /g, '_');
          return {
            title: t,
            imageinfo: [{ url: `https://upload.wikimedia.org/x/${f}`, thumburl: `https://upload.wikimedia.org/x/330px-${f}`, thumbwidth: 330, thumbheight: 220, width: 900, mime: 'image/jpeg', descriptionurl: `https://commons.wikimedia.org/wiki/${t.replace(/ /g, '_')}`, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } }],
          };
        });
        return { query: { pages } };
      }
      throw new Error('unexpected ' + url);
    },
  };
}
function memoryStore() {
  const m = new Map();
  return { m, get: (k) => m.get(k) || null, set: (k, value, savedAt) => void m.set(k, JSON.parse(JSON.stringify({ value, savedAt }))) };
}

(async () => {
  // The bird and the machine, from four requests: Wiktionary, the lexeme query and the title
  // query start together, then one file-details request (or two, when the sources answer apart).
  const log = [];
  const store = memoryStore();
  const mod = load({ isCoreConfigured: () => true, getHttp: () => stubHttp(log), getLookupCache: () => store });
  const updates = [];
  const imgs = await mod.fetchSenseImages('crane', craneSenses, { lang: 'en', onUpdate: (l) => updates.push(l.filter(Boolean).length) });
  same(imgs.map((x) => x && x.title), ['Gruidae', null, 'crane', null], 'crane: lexeme pictures with their item labels');
  assert.ok(/CC BY-SA 4.0/.test(imgs[0].credit) && /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(imgs[0].pageUrl));
  assert.ok(log.length <= 6, `${log.length} requests`);
  assert.ok(log.every((r) => /^Phevere\/\d.*github\.com\/thd2020\/phevere/.test(r.headers['User-Agent'])), 'User-Agent names the app');
  assert.ok(updates.length >= 1, 'first pictures arrive before the end');

  // The card for the same word reuses the pool: no request at all.
  const before = log.length;
  const card = await mod.fetchWordImage('crane', { lang: 'en', gloss: 'A mechanical lifting machine or device.' });
  assert.strictEqual(card && card.title, 'crane', 'card: the machine');
  // A sense list that changes (a later source) is matched again without asking the network.
  await mod.fetchSenseImages('crane', [...craneSenses, { meaning: 'A siphon.', partOfSpeech: 'noun' }], { lang: 'en' });
  assert.strictEqual(log.length, before, 'one pool per word');

  // A new session reads the saved pool.
  const again = load({ isCoreConfigured: () => true, getHttp: () => ({ requestJson: async () => { throw new Error('should not fetch'); } }), getLookupCache: () => store });
  assert.strictEqual((await again.fetchSenseImages('crane', craneSenses, { lang: 'en' }))[2].title, 'crane', 'persistent pool');

  // Hiding a picture: gone on that sense, also in a new session, and back after Undo.
  await again.hideSenseImage('crane', imgs[2], { lang: 'en', sense: craneSenses[2].meaning });
  assert.strictEqual((await again.fetchSenseImages('crane', craneSenses, { lang: 'en' }))[2], null, 'hidden');
  const third = load({ isCoreConfigured: () => true, getHttp: () => ({ requestJson: async () => { throw new Error('should not fetch'); } }), getLookupCache: () => store });
  assert.strictEqual((await third.fetchSenseImages('crane', craneSenses, { lang: 'en' }))[2], null, 'still hidden after a restart');
  assert.ok(await third.fetchWordImage('crane', { lang: 'en', gloss: 'A mechanical lifting machine or device, often used for lifting heavy loads.' }) === null, 'hidden on a card saved with that sense');
  // The same file on another sense (a gloss that only this picture fits) still shows.
  const other = [{ meaning: 'A machine for lifting loads, with a mechanical arm.', partOfSpeech: 'noun' }];
  assert.ok((await third.fetchSenseImages('crane', other, { lang: 'en' }))[0], 'shown on another sense');
  await third.unhideSenseImage('crane', imgs[2], { lang: 'en', sense: craneSenses[2].meaning });
  assert.ok((await third.fetchSenseImages('crane', craneSenses, { lang: 'en' }))[2], 'back after Undo');
  const fourth = load({ isCoreConfigured: () => true, getHttp: () => ({ requestJson: async () => { throw new Error('should not fetch'); } }), getLookupCache: () => store });
  assert.ok((await fourth.fetchSenseImages('crane', craneSenses, { lang: 'en' }))[2], 'Undo is saved');

  // Offline: no picture, nothing saved.
  {
    const s2 = memoryStore();
    const m2 = load({ isCoreConfigured: () => true, getHttp: () => ({ requestJson: async () => { throw new Error('offline'); } }), getLookupCache: () => s2 });
    same(await m2.fetchSenseImages('crane', craneSenses, { lang: 'en' }), [null, null, null, null]);
    assert.strictEqual([...s2.m.keys()].filter((k) => k.includes(':pool:')).length, 0, 'offline: nothing saved');
  }

  // A failed source still shows the pictures the others found, but the pool is not saved, so
  // the next lookup asks again.
  {
    const s3 = memoryStore();
    const m3 = load({ isCoreConfigured: () => true, getHttp: () => stubHttp([], { fail: (u) => u.includes('wiktionary') }), getLookupCache: () => s3 });
    const got = await m3.fetchSenseImages('crane', craneSenses, { lang: 'en' });
    assert.ok(got[0] && got[2], 'lexeme pictures despite Wiktionary failing');
    assert.strictEqual([...s3.m.keys()].filter((k) => k.includes(':pool:')).length, 0, 'a partial pool is not saved');
  }

  // A lexeme batch that times out is asked again for the one lemma.
  {
    const log5 = [];
    let failedOnce = false;
    const m5 = load({
      isCoreConfigured: () => true,
      getHttp: () => stubHttp(log5, { fail: (u) => decodeURIComponent(u).includes('wikibase:lemma') && !failedOnce && (failedOnce = true) }),
      getLookupCache: () => null,
    });
    const got = await m5.fetchSenseImages('crane', craneSenses, { lang: 'en' });
    assert.ok(got[0], 'lexeme picture after the retry');
    assert.strictEqual(log5.filter((r) => decodeURIComponent(r.url).includes('wikibase:lemma')).length, 2, 'asked twice');
  }

  // Cards on screen share requests: two words, one lexeme query, one Wiktionary request.
  {
    const log2 = [];
    const m4 = load({ isCoreConfigured: () => true, getHttp: () => stubHttp(log2), getLookupCache: () => null });
    await Promise.all([m4.fetchWordImage('crane', { lang: 'en', gloss: 'A mechanical lifting machine.' }), m4.fetchWordImage('bank', { lang: 'en', gloss: 'A financial institution.' })]);
    assert.strictEqual(log2.filter((r) => decodeURIComponent(r.url).includes('wikibase:lemma')).length, 1, 'one lexeme query');
    assert.strictEqual(log2.filter((r) => r.url.includes('wiktionary')).length, 1, 'one Wiktionary request');
    assert.ok(decodeURIComponent(log2.find((r) => r.url.includes('wikidata')).url).includes('"crane"@en "bank"@en'));
  }

  // At most three requests in flight to one host, however many cards ask at once.
  {
    const live = new Map();
    let peak = 0;
    const m5 = load({
      isCoreConfigured: () => true,
      getHttp: () => ({
        requestJson: async (url) => {
          const host = new URL(url).hostname;
          live.set(host, (live.get(host) || 0) + 1);
          peak = Math.max(peak, live.get(host));
          await new Promise((r) => setTimeout(r, 5));
          live.set(host, live.get(host) - 1);
          return stubHttp([]).requestJson(url);
        },
      }),
      getLookupCache: () => null,
    });
    const words = ['crane', 'bank', 'car', 'tree', 'hammer', 'chair', 'apple', 'house', 'cat', 'serendipity'];
    await Promise.all(words.map((w, i) => new Promise((r) => setTimeout(r, i * 20)).then(() => m5.fetchWordImage(w, { lang: 'en' }))));
    assert.ok(peak <= 3, `peak per host ${peak}`);
  }

  // A 429 is retried once after a pause.
  {
    let tries = 0;
    const m6 = load({
      isCoreConfigured: () => true,
      getHttp: () => ({
        requestJson: async (url) => {
          if (decodeURIComponent(url).includes('wikibase:lemma') && tries++ === 0) throw new Error('HTTP 429: Too Many Requests');
          return stubHttp([]).requestJson(url);
        },
      }),
      getLookupCache: () => null,
    });
    assert.ok((await m6.fetchSenseImages('crane', craneSenses, { lang: 'en' }))[0], 'retried');
    assert.strictEqual(tries, 2, 'one retry');
  }

  // The dictionary's own Wiktionary page is reused.
  {
    const log3 = [];
    const m7 = load({ isCoreConfigured: () => true, getHttp: () => stubHttp(log3), getLookupCache: () => null });
    let asked = 0;
    m7.registerWiktionaryWikitextSource(async (w) => {
      asked += 1;
      return wikitext(w);
    });
    await m7.fetchSenseImages('bank', bankSenses, { lang: 'en' });
    assert.strictEqual(asked, 1, 'the dictionary page');
    assert.ok(!log3.some((r) => r.url.includes('wiktionary')), 'no second download');
  }

  console.log('sense-images ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
