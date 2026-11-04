/**
 * Forms and spellings of other words (packages/core/src/form-of.ts) and the facts in the Forms
 * section (inflections.ts), offline, on trimmed kaikki.org pages in scripts/fixtures/inflections.
 *
 * "gleaned", "paparazzi", "vicissitudes", "children", "went" and "idiosyncracy" are forms of
 * another word; "glasses", "data", "arms", "news" and "is" have meanings of their own. The Forms
 * of paparazzo list paparazzi and drop paparazzos; paparazzi, being a plural, gets no plural.
 *
 * Run: node scripts/test-word-forms.js
 */
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

const fo = load('form-of');
const { inflectionsFromKaikki, selectInflections, weighForms } = load('inflections');
const { inflectionsHtml } = load('lexicon-parts');

const page = (w) => fs.readFileSync(path.join(__dirname, 'fixtures', 'inflections', `en-${w}.jsonl`), 'utf8');
const rows = (table) => Object.fromEntries(table.rows.map((r) => [r.label, r.forms]));

// Forms of one word open as that word; words with meanings of their own stay.
const lemmas = (w) => fo.formOfLemmasFromKaikki(page(w), w);
assert.deepEqual(lemmas('gleaned'), ['glean']);
assert.deepEqual(lemmas('vicissitudes'), ['vicissitude']);
assert.deepEqual(lemmas('paparazzi'), ['paparazzo'], '"Alternative form of" and "taken as a group" are not meanings of its own');
assert.deepEqual(lemmas('idiosyncracy'), ['idiosyncrasy']);
assert.deepEqual(lemmas('went'), ['go'], 'the obsolete noun and the archaic past of wend do not count');
assert.deepEqual(lemmas('children'), ['child', 'childer']);
for (const w of ['glasses', 'data', 'arms', 'news', 'is', 'glean', 'paparazzo', 'vicissitude', 'child', 'go', 'be']) {
  assert.deepEqual(lemmas(w), [], `${w} is a word in its own right`);
}

// Two lemmas: the one far more common wins ("childer" is dialectal); two common ones stay ambiguous.
const freq = new Map([['child', 180.9], ['childer', 0.027], ['axe', 3.3], ['axis', 23.7]]);
assert.equal(fo.dominantLemma(['child', 'childer'], freq), 'child');
assert.equal(fo.dominantLemma(['axe', 'axis'], freq), null);
assert.equal(fo.dominantLemma(['child', 'unknown'], freq), null, 'a lemma without a frequency decides nothing');

// The same, resolved through a fake HTTP client: kaikki pages, then Datamuse for the tie.
(async () => {
  const requests = [];
  const http = {
    requestText: async (url) => {
      requests.push(url);
      const w = decodeURIComponent(url.split('/').pop().replace(/\.jsonl$/, ''));
      try {
        return { ok: true, status: 200, text: page(w) };
      } catch {
        return { ok: false, status: 404, text: '' };
      }
    },
    requestJson: async (url) => {
      requests.push(url);
      const w = decodeURIComponent(/sp=([^&]+)/.exec(url)[1]);
      return freq.has(w) ? [{ word: w, tags: [`f:${freq.get(w)}`] }] : [];
    },
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  };
  assert.equal(await fo.resolveFormOf(http, 'children'), 'child');
  assert.equal(await fo.resolveFormOf(http, 'gleaned'), 'glean');
  assert.equal(await fo.resolveFormOf(http, 'glasses'), null);
  await assert.rejects(fo.resolveFormOf(http, 'nosuchword'), 'no page is no answer, so the caller falls back');

  // Wiktionary's REST senses as text, the fallback.
  const html = (s) => `<span class="form-of-definition use-with-mention">${s}</span>`;
  assert.equal(fo.formOfLemmaFromGlosses([html('simple <a>past</a> and <a>past</a> <a>participle</a> of <i>glean</i>')], 'gleaned'), 'glean');
  assert.equal(fo.formOfLemmaFromGlosses(['plural of paparazzo', 'Alternative form of paparazzo.', 'Paparazzi taken as a group.'], 'paparazzi'), 'paparazzo');
  assert.equal(fo.formOfLemmaFromGlosses(['Alternative spelling of idiosyncrasy.'], 'idiosyncracy'), 'idiosyncrasy');
  assert.equal(fo.formOfLemmaFromGlosses(['plural of glass', 'Spectacles, frames bearing two lenses.'], 'glasses'), null);
  assert.equal(fo.formOfLemmaFromGlosses(['plural of child', 'plural of childer'], 'children'), null, 'two lemmas need the tagged page');
  assert.equal(fo.formOfLemmaFromGlosses(['British standard spelling of groveler.'], 'groveller'), null, 'a regional standard spelling stays');
  assert.equal(fo.formOfLemmaFromGlosses(['Abbreviation of laboratory.'], 'lab'), null);
  assert.equal(fo.formOfLemmaFromGlosses(['plural of die (“polyhedron used in games of chance”)'], 'dice'), 'die');
  assert.equal(fo.formOfLemmaFromGlosses(['Alternative form of calipers , a device used to measure dimensions.'], 'caliper'), null);

  // References from the page's References section are not senses (the saved "idiosyncracy").
  const saved = [
    '↑ “ idiosyncracy ”, in Dictionary.com Unabridged , Dictionary.com, LLC , 1995–present.',
    '↑ “idiosyncracy”, in The American Heritage Dictionary of the English Language , 4th edition, Boston, Mass. : Houghton Mifflin , 2000 , →ISBN .',
    '↑ James A. H. Murray et al. , editors ( 1884–1928 ), “Idiosyncrasy”, in A New English Dictionary on Historical Principles ( Oxford English Dictionary ), London : Clarendon Press , →OCLC .',
    "↑ Webster's Third New International Dictionary (unabridged) , Chicago, Illinois, Encyclopedia Britannica, Inc., 1993",
  ];
  for (const line of saved) assert.ok(fo.isCitationGloss(line), line);
  assert.ok(fo.isCitationGloss('<span class="mw-cite-backlink"><a href="#cite_ref-1">↑</a></span> <span class="mw-reference-text">x</span>'));
  assert.equal(fo.stripCitationLines(saved.join('\n')), '');
  for (const sense of ['A behavior or way of thinking that is characteristic of a person or a group.', 'plural of paparazzo', 'Any member of the family Cactaceae, first described in 1753.']) {
    assert.ok(!fo.isCitationGloss(sense), sense);
  }
  assert.equal(fo.formOfLemmaFromGlosses(['Alternative spelling of idiosyncrasy.', ...saved], 'idiosyncracy'), 'idiosyncrasy');

  // Regular English endings, for the saved notebook without a network.
  for (const [s, l] of [['vicissitudes', 'vicissitude'], ['gleaned', 'glean'], ['bifurcated', 'bifurcate'], ['stopped', 'stop'], ['sublimating', 'sublimate'], ['berries', 'berry'], ['dying', 'die'], ['nicer', 'nice']]) {
    assert.ok(fo.isRegularInflection(s, l), `${s} is ${l} with an ending`);
  }
  for (const [s, l] of [['paparazzi', 'paparazzo'], ['children', 'child'], ['glean', 'glean'], ['alumni', 'alum']]) {
    assert.ok(!fo.isRegularInflection(s, l), `${s} is not ${l} with a regular ending`);
  }

  // Forms: paparazzo lists paparazzi; paparazzos, which Datamuse barely knows, goes.
  const paparazzo = selectInflections(inflectionsFromKaikki(page('paparazzo'), 'en', 'paparazzo'), ['noun']);
  assert.deepEqual(rows(paparazzo.tables[0]), { Plural: ['paparazzi', 'paparazzos'] }, 'no possessive row');
  const weighed = weighForms(paparazzo.tables, new Map([['paparazzi', 0.079], ['paparazzos', 0]]));
  assert.deepEqual(rows(weighed[0]), { Plural: ['paparazzi'] });
  // cacti, cactuses (less common), and neither cactusses nor the zero plural "cactus".
  const cactus = selectInflections(inflectionsFromKaikki(page('cactus'), 'en', 'cactus'), ['noun']);
  assert.deepEqual(rows(cactus.tables[0]).Plural, ['cacti', 'cactuses', 'cactusses']);
  const cacti = weighForms(cactus.tables, new Map([['cacti', 0.346], ['cactuses', 0.0498], ['cactusses', 0]]))[0].rows[0];
  assert.deepEqual([cacti.forms, cacti.notes], [['cacti', 'cactuses'], ['', 'less common']]);
  // A row is left alone when a frequency is missing (Datamuse did not answer).
  assert.deepEqual(rows(weighForms(cactus.tables, new Map([['cacti', 0.3]]))[0]).Plural, ['cacti', 'cactuses', 'cactusses']);
  // Forms Wiktionary labels keep the label: octopi is hypercorrect, octopodes rare.
  const octopus = selectInflections(inflectionsFromKaikki(page('octopus'), 'en', 'octopus'), ['noun']).tables[0].rows[0];
  assert.equal(octopus.forms[0], 'octopuses');
  assert.equal(octopus.notes[octopus.forms.indexOf('octopi')], 'hypercorrect');
  assert.ok(!octopus.forms.includes('octopusses'), 'a nonstandard form is left out');
  const octHtml = inflectionsHtml({ formOf: [], tables: [{ pos: 'noun', rows: [octopus], grids: [], weight: 6 }] }, 'octopus', 'act');
  assert.match(octHtml, /octopi <span class="lx-note">hypercorrect<\/span>/);

  // A plural gets no plural of its own: paparazzi shows paparazzo's forms, never "paparazzis".
  const paps = inflectionsFromKaikki(page('paparazzi'), 'en', 'paparazzi');
  paps.lemmaTables = inflectionsFromKaikki(page('paparazzo'), 'en', 'paparazzo').tables;
  const papSel = selectInflections(paps, ['noun']);
  assert.equal(papSel.tablesFor, 'paparazzo');
  assert.ok(!JSON.stringify(papSel.tables).includes('paparazzis'));
  assert.deepEqual(papSel.formOf.map((f) => [f.lemma, f.label]), [['paparazzo', 'plural']]);
  // "glasses" (spectacles) has no plural "glasses"; "idiosyncracy" names its standard spelling.
  const glasses = inflectionsFromKaikki(page('glasses'), 'en', 'glasses');
  assert.ok(!glasses.tables.some((t) => t.pos === 'noun'));
  assert.deepEqual(inflectionsFromKaikki(page('idiosyncracy'), 'en', 'idiosyncracy').formOf, [{ lemma: 'idiosyncrasy', label: 'alternative spelling', pos: 'noun' }]);

  // Verbs: glean, go and be; "went" is the past of go and nothing else.
  assert.deepEqual(rows(selectInflections(inflectionsFromKaikki(page('glean'), 'en', 'glean'), ['verb']).tables[0]), {
    'Third-person singular': ['gleans'],
    'Present participle': ['gleaning'],
    Past: ['gleaned'],
    'Past participle': ['gleaned'],
  });
  assert.deepEqual(rows(selectInflections(inflectionsFromKaikki(page('go'), 'en', 'go'), ['verb']).tables[0]), {
    'Third-person singular': ['goes'],
    'Present participle': ['going'],
    Past: ['went'],
    'Past participle': ['gone'],
  });
  assert.deepEqual(rows(selectInflections(inflectionsFromKaikki(page('be'), 'en', 'be'), ['verb']).tables[0]), {
    Present: ['am', 'are'],
    'Third-person singular': ['is'],
    'Present participle': ['being'],
    Past: ['was', 'were'],
    'Past participle': ['been'],
  });
  assert.deepEqual(inflectionsFromKaikki(page('went'), 'en', 'went').formOf, [{ lemma: 'go', label: 'past', pos: 'verb' }]);
  assert.deepEqual(rows(selectInflections(inflectionsFromKaikki(page('child'), 'en', 'child'), ['noun']).tables[0]), { Plural: ['children'] });
  assert.deepEqual(rows(selectInflections(inflectionsFromKaikki(page('vicissitude'), 'en', 'vicissitude'), ['noun']).tables[0]), { Plural: ['vicissitudes'] });

  console.log(`Word forms passed (${requests.length} fake requests): forms open as their lemma, references are not senses, Forms list standard forms.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
