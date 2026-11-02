/**
 * Frequency-based sense ordering (packages/core/src/sense-frequency.ts).
 * Run: node scripts/test-sense-frequency.js
 *
 * The glosses below are real Free Dictionary API responses (all entries,
 * first six senses of each part of speech), in the order the API returns them.
 */
const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

const src = path.join(__dirname, '..', 'packages', 'core', 'src');
const bundle = esbuild.buildSync({
  stdin: {
    contents:
      "export * from './sense-frequency'; export * from './sense-gloss-tokens';" +
      " export { mergeSimilarDefinitions, sortDefinitionsByReadingOrder, canonicalPos } from './definition-merge';" +
      " export * from './sense-frequency-data';",
    resolveDir: src,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['wink-lemmatizer'],
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
const sf = mod.exports;

const FIXTURES = {
  run: [
    ["verb","To run."],
    ["noun","Act or instance of running, of moving rapidly using the feet."],
    ["noun","Act or instance of hurrying (to or from a place) (not necessarily by foot); dash or errand, trip."],
    ["noun","A pleasure trip."],
    ["noun","Flight, instance or period of fleeing."],
    ["noun","Migration (of fish)."],
    ["noun","A group of fish that migrate, or ascend a river for the purpose of spawning."],
    ["verb","To move swiftly."],
    ["verb","(fluids) To flow."],
    ["verb","(of a vessel) To sail before the wind, in distinction from reaching or sailing close-hauled."],
    ["verb","To control or manage, be in charge of."],
    ["verb","To be a candidate in an election."],
    ["verb","To make run in a race or an election."],
    ["adjective","In a liquid state; melted or molten."],
    ["adjective","Cast in a mould."],
    ["adjective","Exhausted; depleted (especially with \"down\" or \"out\")."],
    ["adjective","(of a zoology) Travelled, migrated; having made a migration or a spawning run."],
    ["adjective","Smuggled."],
  ],
  bank: [
    ["noun","An institution where one can place and borrow money and take care of financial affairs."],
    ["noun","A branch office of such an institution."],
    ["noun","An underwriter or controller of a card game; also banque."],
    ["noun","A fund from deposits or contributions, to be used in transacting business; a joint stock or capital."],
    ["noun","The sum of money etc. which the dealer or banker has as a fund from which to draw stakes and pay losses."],
    ["noun","Money; profit"],
    ["verb","To deal with a bank or financial institution, or for an institution to provide financial services to a client."],
    ["verb","To put into a bank."],
    ["verb","To conceal in the rectum for use in prison."],
    ["noun","An edge of river, lake, or other watercourse."],
    ["noun","An elevation, or rising ground, under the sea; a shallow area of shifting sand, gravel, mud, and so forth (for example, a sandbank or mudbank)."],
    ["noun","A slope of earth, sand, etc.; an embankment."],
    ["noun","The incline of an aircraft, especially during a turn."],
    ["noun","An incline, a hill."],
    ["noun","A mass noun for a quantity of clouds."],
    ["verb","To roll or incline laterally in order to turn."],
    ["verb","To cause (an aircraft) to bank."],
    ["verb","To form into a bank or heap, to bank up."],
    ["verb","To cover the embers of a fire with ashes in order to retain heat."],
    ["verb","To raise a mound or dike about; to enclose, defend, or fortify with a bank; to embank."],
    ["verb","To pass by the banks of."],
    ["noun","A row or panel of items stored or grouped together."],
    ["noun","A row of keys on a musical keyboard or the equivalent on a typewriter keyboard."],
    ["noun","A contiguous block of memory that is of fixed, hardware-dependent size, but often larger than a page and partitioning the memory such that two distinct banks do not overlap."],
    ["noun","A set of multiple adjacent drop targets."],
    ["verb","(order and arrangement) To arrange or order in a row."],
    ["noun","A bench, as for rowers in a galley; also, a tier of oars."],
    ["noun","A bench or seat for judges in court."],
    ["noun","The regular term of a court of law, or the full court sitting to hear arguments upon questions of law, as distinguished from a sitting at nisi prius, or a court held for jury trials. See banc."],
    ["noun","A kind of table used by printers."],
    ["noun","A bench, or row of keys belonging to a keyboard, as in an organ."],
    ["noun","Slang for money"],
  ],
  bear: [
    ["noun","A large omnivorous mammal, related to the dog and raccoon, having shaggy hair, a very small tail, and flat feet; a member of family Ursidae."],
    ["noun","A rough, unmannerly, uncouth person."],
    ["noun","An investor who sells commodities, securities or futures in anticipation of a fall in prices."],
    ["noun","A state policeman (short for smokey bear)."],
    ["noun","A large, hairy man, especially one who is homosexual."],
    ["noun","A portable punching machine."],
    ["verb","To endeavour to depress the price of, or prices in."],
    ["adjective","(investments) Characterized by declining prices in securities markets or by belief that the prices will fall."],
    ["verb","To carry or convey, literally or figuratively."],
    ["verb","To support, sustain, or endure."],
    ["verb","To support, keep up, or maintain."],
    ["verb","To press or impinge upon."],
    ["verb","To produce, yield, give birth to."],
    ["verb","(originally nautical) To be, or head, in a specific direction or azimuth (from somewhere)."],
    ["noun","Barley, especially four-rowed barley or six-rowed barley."],
    ["noun","A pillowcase; a fabric case or covering as for a pillow."],
  ],
  light: [
    ["noun","Visible electromagnetic radiation. The human eye can typically detect radiation (light) in the wavelength range of about 400 to 750 nanometers. Nearby shorter and longer wavelength ranges, although not visible, are commonly called ultraviolet and infrared light."],
    ["noun","A source of illumination."],
    ["noun","Spiritual or mental illumination; enlightenment, useful information."],
    ["noun","(in the plural) Facts; pieces of information; ideas, concepts."],
    ["noun","A notable person within a specific field or discipline."],
    ["noun","The manner in which the light strikes a picture; that part of a picture which represents those objects upon which the light is supposed to fall; the more illuminated part of a landscape or other scene; opposed to shade."],
    ["verb","To start (a fire)."],
    ["verb","To set fire to; to set burning."],
    ["verb","To illuminate; to provide light for when it is dark."],
    ["verb","To become ignited; to take fire."],
    ["verb","To attend or conduct with a light; to show the way to by means of a light."],
    ["verb","To make (a bonus) available to be collected by hitting a target, and thus light up the feature light corresponding to that bonus to indicate its availability."],
    ["adjective","Having light; bright; clear; not dark or obscure."],
    ["adjective","Pale or whitish in color; highly luminous and more or less deficient in chroma."],
    ["adjective","(of coffee) Served with extra milk or cream."],
    ["noun","A stone that is not thrown hard enough."],
    ["noun","See lights."],
    ["verb","To unload a ship, or to jettison material to make it lighter"],
    ["verb","To lighten; to ease of a burden; to take off."],
    ["adjective","Having little or relatively little actual weight; not cumbrous or unwieldy."],
    ["adjective","Having little weight as compared with bulk; of little density or specific gravity."],
    ["adjective","Of short or insufficient weight; weighing less than the legal, standard or proper amount; clipped or diminished."],
    ["adjective","Lacking that which burdens or makes heavy."],
    ["adjective","Not heavy or soggy; spongy; well raised."],
    ["adjective","Gentle; having little force or momentum."],
    ["adverb","Carrying little."],
    ["verb","To find by chance."],
    ["verb","To stop upon (of eyes or a glance); to notice"],
    ["verb","To alight; to land or come down."],
  ],
  fair: [
    ["noun","Something which is fair (in various senses of the adjective)."],
    ["noun","A woman, a member of the ‘fair sex’; also as a collective singular, women."],
    ["noun","Fairness, beauty."],
    ["noun","A fair woman; a sweetheart."],
    ["noun","Good fortune; good luck."],
    ["verb","To smoothen or even a surface (especially a connection or junction on a surface)."],
    ["verb","To bring into perfect alignment (especially about rivet holes when connecting structural members)."],
    ["verb","To construct or design a structure whose primary function is to produce a smooth outline or reduce air drag or water resistance."],
    ["verb","To make fair or beautiful."],
    ["adjective","Beautiful, of a pleasing appearance, with a pure and fresh quality."],
    ["adjective","Unblemished (figuratively or literally); clean and pure; innocent."],
    ["adjective","Light in color, pale, particularly with regard to skin tone but also referring to blond hair."],
    ["adjective","Just, equitable."],
    ["adjective","Adequate, reasonable, or decent."],
    ["adjective","(of a wind) Favorable to a ship's course."],
    ["adverb","Clearly, openly, frankly, civilly, honestly, favorably, auspiciously, agreeably"],
    ["noun","A community gathering to celebrate and exhibit local achievements."],
    ["noun","An event for public entertainment and trade, a market."],
    ["noun","An event for professionals in a trade to learn of new products and do business, a trade fair."],
    ["noun","A travelling amusement park (called a funfair in British English and a (travelling) carnival in US English)."],
  ],
  set: [
    ["verb","To put (something) down, to rest."],
    ["verb","To attach or affix (something) to something else, or in or upon a certain place."],
    ["verb","To put in a specified condition or state; to cause to be."],
    ["verb","To start (a fire)."],
    ["verb","To cause to stop or stick; to obstruct; to fasten to a spot."],
    ["verb","To determine or settle."],
    ["noun","A punch for setting nails in wood."],
    ["noun","A device for receiving broadcast radio waves (or, more recently, broadcast data); a radio or television."],
    ["noun","A small tuber or bulb used instead of seed, particularly onion sets and potato sets."],
    ["noun","The amount the teeth of a saw protrude to the side in order to create the kerf."],
    ["noun","That which is staked; a wager; hence, a gambling game."],
    ["noun","Permanent change of shape caused by excessive strain, as from compression, tension, bending, twisting, etc."],
    ["noun","The system of tunnels that is the home of a badger."],
    ["noun","The pattern of distinctive threads and yarns that make up the plaid of a Scottish tartan."],
    ["noun","A small, square-cut piece of quarried stone used for paving and edging."],
    ["adjective","Fixed in position."],
    ["adjective","Rigid, solidified."],
    ["adjective","Ready, prepared."],
    ["adjective","Intent, determined (to do something)."],
    ["adjective","Prearranged."],
    ["adjective","Fixed in one’s opinion."],
    ["noun","A young plant fit for setting out; a slip; shoot."],
    ["noun","A rudimentary fruit."],
    ["noun","The setting of the sun or other luminary; (by extension) the close of the day."],
    ["noun","General movement; direction; drift; tendency."],
    ["noun","A matching collection of similar things. (Note the similar meaning in Etymology 1, Noun.)"],
    ["noun","A collection of various objects for a particular purpose."],
    ["verb","To divide a class group in a subject according to ability"],
  ],
  book: [
    ["noun","A collection of sheets of paper bound together to hinge at one edge, containing printed or written material, pictures, etc."],
    ["noun","A long work fit for publication, typically prose, such as a novel or textbook, and typically published as such a bound collection of sheets, but now sometimes electronically as an e-book."],
    ["noun","A major division of a long work."],
    ["noun","A record of betting (from the use of a notebook to record what each person has bet)."],
    ["noun","A convenient collection, in a form resembling a book, of small paper items for individual use."],
    ["noun","The script of a musical or opera."],
    ["verb","To reserve (something) for future use."],
    ["verb","To write down, to register or record in a book or as in a book."],
    ["verb","(law enforcement) To record the name and other details of a suspected offender and the offence for later judicial action."],
    ["verb","To issue with a caution, usually a yellow card, or a red card if a yellow card has already been issued."],
    ["verb","To travel very fast."],
    ["verb","To record bets as bookmaker."],
  ],
};

function defsFor(word, order) {
  let rows = FIXTURES[word];
  if (order) rows = order.flatMap((pos) => rows.filter((r) => r[0] === pos));
  const defs = rows.map(([partOfSpeech, meaning], i) => ({
    partOfSpeech,
    meaning,
    source: 'Free Dictionary API',
    senseOrder: i,
  }));
  return sf.sortDefinitionsByReadingOrder(sf.mergeSimilarDefinitions(defs));
}

function posOrder(defs) {
  const order = [];
  for (const d of defs) {
    const pos = sf.canonicalPos(d.partOfSpeech);
    if (!order.includes(pos)) order.push(pos);
  }
  return order;
}

const indexOf = (defs, re) => defs.findIndex((d) => re.test(d.meaning));
const find = (defs, re) => defs.find((d) => re.test(d.meaning));

// Not loaded yet: the input comes back untouched (the first lookup must not wait).
{
  const defs = defsFor('bear');
  assert.strictEqual(sf.senseFrequencyReady(), false);
  assert.strictEqual(sf.orderSensesByFrequency('bear', defs), defs);
}

sf.primeSenseFrequency({
  words: sf.SENSE_FREQUENCY_WORDS,
  vocab: sf.SENSE_FREQUENCY_VOCAB,
  synsets: sf.SENSE_FREQUENCY_SYNSETS,
});
assert.strictEqual(sf.senseFrequencyReady(), true);

// Tokeniser: the build script and the runtime must reduce words the same way.
assert.deepStrictEqual(sf.glossTokens('Financial institution; (countable) finances'), ['financ', 'institu']);
assert.deepStrictEqual(sf.glossTokens('currency, currents'), ['currenc', 'current']);
assert.deepStrictEqual(sf.glossTokens('moving, moved, move'), ['mov']);

assert.strictEqual(sf.frequencyBand(0), 0);
assert.strictEqual(sf.frequencyBand(1), 1);
assert.strictEqual(sf.frequencyBand(20), 4);
assert.strictEqual(sf.frequencyBand(25), 4);
assert.strictEqual(sf.frequencyBand(106), 6);

// run: SemCor tags the verb about 300 times and the noun about 30. Fed noun-first
// (as Datamuse lists it), the verb still leads, and "to move swiftly" aligns to
// WordNet's first verb sense (106 tags) and comes before "to control or manage" (20).
{
  const out = sf.orderSensesByFrequency('run', defsFor('run', ['noun', 'adjective', 'verb']));
  assert.deepStrictEqual(posOrder(out), ['verb', 'noun', 'adjective']);
  assert.strictEqual(find(out, /^To move swiftly/).frequency, 106);
  assert.strictEqual(find(out, /^To control or manage/).frequency, 20);
  assert.ok(indexOf(out, /^To move swiftly/) < indexOf(out, /^To control or manage/));
  assert.ok(indexOf(out, /^To control or manage/) < indexOf(out, /^\(of a vessel\) To sail/));
}

// bank: the financial institution stays ahead of the river bank. SemCor has 20
// and 25 tags for them, the same frequency band, so the source order decides;
// both still align to the right WordNet sense. The noun (48 tags) beats the verb (3).
{
  const out = sf.orderSensesByFrequency('bank', defsFor('bank'));
  assert.deepStrictEqual(posOrder(out), ['noun', 'verb']);
  assert.strictEqual(find(out, /^An institution where one can place/).frequency, 20);
  assert.strictEqual(find(out, /^An edge of river/).frequency, 25);
  assert.ok(indexOf(out, /^An institution where one can place/) < indexOf(out, /^An edge of river/));
  assert.ok(indexOf(out, /^An edge of river/) < indexOf(out, /^A kind of table used by printers/));
  const aligned = sf.alignToWordNet('bank', [
    { partOfSpeech: 'noun', meaning: 'A device used to store coins or currency.', source: 'x' },
  ]);
  assert.notStrictEqual(aligned[0]?.sense, 1, '"currency" must not match the river bank\'s "currents".');
}

// bear: the verb (about 100 tags) moves ahead of the animal noun (1 tag), and
// "to produce, give birth" (17) and "to support, endure" (13) lead the verbs.
{
  const out = sf.orderSensesByFrequency('bear', defsFor('bear'));
  assert.deepStrictEqual(posOrder(out), ['verb', 'noun', 'adjective']);
  assert.ok(indexOf(out, /^To produce, yield/) < indexOf(out, /^To endeavour to depress the price/));
  assert.ok(indexOf(out, /^To support, sustain/) < indexOf(out, /^To press or impinge/));
}

// light: noun (117 tags) before adjective (about 45) before verb (27), and the
// physics sense (46) before "a notable person" (no match, stays by its neighbour).
{
  const out = sf.orderSensesByFrequency('light', defsFor('light'));
  assert.deepStrictEqual(posOrder(out), ['noun', 'adjective', 'verb', 'adverb']);
  assert.match(out[0].meaning, /^Visible electromagnetic radiation/);
  assert.strictEqual(out[0].frequency, 46);
  assert.strictEqual(find(out, /^A source of illumination/).frequency, 23);
}

// fair: the adjective (13 tags) moves ahead of the noun the API lists first.
{
  const out = sf.orderSensesByFrequency('fair', defsFor('fair'));
  assert.deepStrictEqual(posOrder(out), ['adjective', 'noun', 'verb', 'adverb']);
  assert.ok(indexOf(out, /^A travelling amusement park/) < indexOf(out, /^A fair woman; a sweetheart/));
}

// set: verb (about 150 tags) before noun before adjective; "to put down" (30)
// leads and "to start (a fire)" with no WordNet match stays near its neighbours.
{
  const out = sf.orderSensesByFrequency('set', defsFor('set', ['adjective', 'noun', 'verb']));
  assert.deepStrictEqual(posOrder(out), ['verb', 'noun', 'adjective']);
  assert.match(out[0].meaning, /^To put \(something\) down/);
}

// book: noun (59 tags) before verb (5), whichever comes first in the source.
{
  const out = sf.orderSensesByFrequency('book', defsFor('book', ['verb', 'noun']));
  assert.deepStrictEqual(posOrder(out), ['noun', 'verb']);
  assert.strictEqual(find(out, /^A long work fit for publication/).frequency, 46);
  assert.ok(indexOf(out, /^A long work fit for publication/) < indexOf(out, /^The script of a musical/));
}

// Function-word classes WordNet lacks lead: "like" as a preposition before the verb.
{
  const out = sf.orderSensesByFrequency('like', [
    { partOfSpeech: 'verb', meaning: 'To enjoy, be pleased by; to favor; to be in favor of.', source: 'x' },
    { partOfSpeech: 'noun', meaning: 'Something that a person likes.', source: 'x' },
    { partOfSpeech: 'preposition', meaning: 'Similar to, reminiscent of.', source: 'x' },
    { partOfSpeech: 'interjection', meaning: 'Used to express mild agreement.', source: 'x' },
  ]);
  assert.deepStrictEqual(posOrder(out), ['preposition', 'verb', 'noun', 'interjection']);
}

// No counts for the word: nothing moves.
{
  const defs = [
    { partOfSpeech: 'noun', meaning: 'b', source: 'x' },
    { partOfSpeech: 'verb', meaning: 'a', source: 'x' },
  ];
  assert.strictEqual(sf.orderSensesByFrequency('phevere', defs), defs);
}

console.log('sense-frequency ok');
