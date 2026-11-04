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

/** A notebook in sql.js with the reported rows, run through the v2 forms migration (vocab-sync.ts). */
async function savedNotebook(http) {
  const esbuild = require('esbuild');
  const initSqlJs = require('sql.js');
  const bundle = esbuild.buildSync({
    stdin: {
      contents: `
        export { configureCore } from './src/runtime';
        export { addVocab, reviewVocab, findByLemma, updateVocabNote } from './src/vocab-store';
        export { foldStoredForms, resolveStoredForms } from './src/vocab-sync';
        export { VOCAB_SCHEMA_SQL } from './src/schema';
      `,
      resolveDir: path.join(__dirname, '..', 'packages', 'core'),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    // Without the lemmatizer, as on the phone.
    external: ['wink-lemmatizer'],
    loader: { '.json': 'json' },
  }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', bundle)(mod, mod.exports, (d) => {
    if (d === 'wink-lemmatizer') throw new Error('not on the phone');
    return require(d);
  });
  const core = mod.exports;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const stmt of core.VOCAB_SCHEMA_SQL.split(';')) if (stmt.trim()) db.run(stmt);
  const queryAll = async (sql, params = []) => {
    const st = db.prepare(sql);
    try {
      st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally {
      st.free();
    }
  };
  let n = 0;
  core.configureCore({
    http,
    sha256Hex: () => '',
    vocabDb: { ready: async () => {}, initError: () => null, queryAll, queryOne: async (q, p) => (await queryAll(q, p))[0] || null, runWrite: async (q, p = []) => db.run(q, p) },
    deviceName: () => 'test',
    newId: () => `id-${String(++n).padStart(3, '0')}`,
  });
  const add = (lemma, definition, extra = {}) => core.addVocab({ lemma, definition, sourceLang: 'en', ...extra });
  const vicPlural = await add('vicissitudes', "Regular change or succession from one thing to another, or one part of a cycle to the next; alternation; mutual succession; interchange.\n(often in the plural) A change, especially in one's life or fortunes.", { createdAt: 1000 });
  await core.updateVocabNote(vicPlural.id, 'from Middlemarch');
  const vic = await add('vicissitude', "Regular change or succession from one thing to another, or one part of a cycle to the next; alternation; mutual succession; interchange; variability.\nA change, especially in one's life or fortunes.", { createdAt: 5000 });
  for (let i = 0; i < 3; i++) await core.reviewVocab(vic.id, 3, 10_000 + i);
  const gleaned = await add('gleaned', 'To collect (grain, grapes, etc.) left behind after the main harvest or gathering.', { reading: 'US /ɡlind/' });
  await core.reviewVocab(gleaned.id, 3, 20_000);
  await add('paparazzi', 'plural of paparazzo\nAlternative form of paparazzo.');
  await add('paparazzo', 'A freelance photographer who sells photographs of celebrities to the media.');
  const idio = await add(
    'idiosyncracy',
    '↑ “ idiosyncracy ”, in Dictionary.com Unabridged , Dictionary.com, LLC , 1995–present.\n↑ “idiosyncracy”, in The American Heritage Dictionary of the English Language , 4th edition, Boston, Mass. : Houghton Mifflin , 2000 , →ISBN .',
    { createdAt: 2000 },
  );
  await core.reviewVocab(idio.id, 4, 30_000);
  await add('idiosyncrasy', 'A behavior or way of thinking that is characteristic of a person or a group.', { createdAt: 9000 });
  await add('glasses', 'Spectacles, frames bearing two lenses worn in front of the eyes.');
  await add('lobotomized', 'simple past and past participle of lobotomize');
  db.run(`INSERT INTO book_words (lemma, reps, updated_at) VALUES ('gleaned', 2, 1)`);
  db.run(`INSERT INTO user_books (book_id, title, words, created_at, updated_at) VALUES ('u1', 'Reading', '["gleaned","glean","paparazzi"]', 1, 1)`);

  // Offline: the references go, and what the saved data decides is folded.
  await core.foldStoredForms(50_000);
  assert.ok(await core.findByLemma('lobotomize'), '"simple past of lobotomize", a regular ending: decided offline');
  const vicOne = await core.findByLemma('vicissitude');
  assert.equal(await core.findByLemma('vicissitudes'), null, 'merged into the saved singular it shares a meaning with');
  assert.equal(vicOne.createdAt, 1000, 'the earlier save date');
  assert.ok(vicOne.reps >= 3, 'the more studied schedule');
  assert.equal(vicOne.note, 'from Middlemarch');
  assert.equal((await core.findByLemma('idiosyncracy')).definition || '', '', 'reference lines are not a meaning');
  assert.ok(await core.findByLemma('gleaned'), 'past forms need the network unless the saved senses say so');

  // Online, through the fake kaikki pages.
  await core.resolveStoredForms(http, { pauseMs: 0 });
  const glean = await core.findByLemma('glean');
  assert.ok(glean && !(await core.findByLemma('gleaned')));
  assert.equal(glean.definition, 'To collect (grain, grapes, etc.) left behind after the main harvest or gathering.', "glean's own senses, saved with gleaned, stay");
  assert.ok(!glean.reading, "gleaned's IPA is not glean's");
  assert.ok(glean.reps >= 1);
  assert.ok(await core.findByLemma('paparazzo') && !(await core.findByLemma('paparazzi')));
  const idioOne = await core.findByLemma('idiosyncrasy');
  assert.ok(idioOne && !(await core.findByLemma('idiosyncracy')));
  assert.equal(idioOne.createdAt, 2000);
  assert.equal(idioOne.definition, 'A behavior or way of thinking that is characteristic of a person or a group.');
  assert.ok(idioOne.reps >= 1, "the misspelling's review comes along");
  assert.ok(await core.findByLemma('glasses'), 'glasses are spectacles');

  const history = await queryAll(`SELECT lemma FROM answer_history ORDER BY answered_at`);
  assert.ok(!history.some((h) => ['gleaned', 'idiosyncracy', 'vicissitudes'].includes(h.lemma)), 'answers point at the new word');
  assert.ok(history.some((h) => h.lemma === 'glean'));
  assert.deepEqual(await queryAll(`SELECT lemma, reps FROM book_words`), [{ lemma: 'glean', reps: 2 }]);
  assert.deepEqual(JSON.parse((await queryAll(`SELECT words FROM user_books`))[0].words), ['glean', 'paparazzo']);
  const ids = new Set((await queryAll(`SELECT id FROM vocab`)).map((r) => r.id));
  const tombs = (await queryAll(`SELECT id FROM vocab_deleted`)).map((r) => r.id);
  assert.equal(tombs.length, 3, 'vicissitudes, paparazzi and idiosyncracy leave tombstones for sync');
  assert.ok(tombs.every((id) => !ids.has(id)));

  // Once per notebook.
  assert.equal(await core.foldStoredForms(60_000), 0);
  assert.equal(await core.resolveStoredForms(http, { pauseMs: 0 }), 0);
}

const page = (w) => fs.readFileSync(path.join(__dirname, 'fixtures', 'inflections', `en-${w}.jsonl`), 'utf8');
const rows = (table) => Object.fromEntries(table.rows.map((r) => [r.label, r.forms]));

// Two lemmas: the one far more common wins ("childer" is dialectal); two common ones stay ambiguous.
const freq = new Map([
  ['child', 180.9], ['childer', 0.027], ['ax', 1.2], ['axe', 3.3], ['axis', 23.7], ['be', 2600], ['wer', 0.05], ['tooth', 30], ['teethe', 0.3], ['run', 300], ['rin', 0.01],
]);
assert.equal(fo.dominantLemma(['child', 'childer'], freq), 'child');
assert.equal(fo.dominantLemma(['axe', 'axis'], freq), null);
assert.equal(fo.dominantLemma(['child', 'unknown'], freq), null, 'a lemma without a frequency decides nothing');
assert.equal(fo.dominantLemma(['ax', 'axe', 'axis'], freq, [['ax', 'axe'], ['axis']]), null, '"ax and axe" is one lemma beside axis');

// Through a fake HTTP client: kaikki pages, then Datamuse for frequencies and for definitions.
(async () => {
  const requests = [];
  // WordNet, through Datamuse, defines savings as a word of its own; geese only as a band name.
  const defs = {
    savings: { word: 'savings', defs: ['n\ta fund of money put by as a reserve'] },
    geese: { word: 'geese', defHeadword: 'Geese', defs: ['N\tan American rock band'] },
    paparazzi: { word: 'paparazzi', defs: ['n\t(nonstandard, uncountable) Paparazzi taken as a group.', 'n\t(nonstandard) A paparazzo.'] },
  };
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
      if (/md=d/.test(url)) return defs[w] ? [defs[w]] : [];
      return freq.has(w) ? [{ word: w, tags: [`f:${freq.get(w)}`] }] : [];
    },
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
  };
  const opens = async (w) => fo.resolveFormOf(http, w);
  // Forms of one word open as that word.
  const forms = {
    gleaned: 'glean', vicissitudes: 'vicissitude', paparazzi: 'paparazzo', idiosyncracy: 'idiosyncrasy', went: 'go',
    children: 'child', geese: 'goose', mice: 'mouse', oxen: 'ox', ran: 'run', taught: 'teach', rested: 'rest', men: 'man',
    teeth: 'tooth', is: 'be', was: 'be', were: 'be', been: 'be', had: 'have',
  };
  for (const [w, lemma] of Object.entries(forms)) assert.equal(await opens(w), lemma, `${w} opens ${lemma}`);
  // Words with meanings of their own stay.
  for (const w of ['glasses', 'data', 'arms', 'news', 'savings', 'axes', 'bacteria', 'ironed', 'glean', 'paparazzo', 'vicissitude', 'child', 'go', 'be']) {
    assert.equal(await opens(w), null, `${w} is a word in its own right`);
  }
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
  assert.ok(!octopus.forms.includes('octopii'), 'hypercorrect and rare at once is left out');
  // fish: the zero plural Wiktionary gives first stays.
  assert.deepEqual(rows(selectInflections(inflectionsFromKaikki(page('fish'), 'en', 'fish'), ['noun']).tables[0]).Plural, ['fish', 'fishes']);
  // die: the tool's plural and the cube's, each named.
  const dieRows = selectInflections(inflectionsFromKaikki(page('die'), 'en', 'die'), ['verb', 'noun']).tables.find((t) => t.pos === 'noun').rows;
  assert.ok(dieRows.some((r) => r.forms.includes('dice') && /polyhedron/.test(r.label)), 'dice for the cube');
  assert.ok(dieRows.some((r) => r.forms.includes('dies') && r.label !== 'Plural'), 'dies for the tool, named');
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
  // am and are, was and were are different persons, never "less common" than each other.
  const beTables = selectInflections(inflectionsFromKaikki(page('be'), 'en', 'be'), ['verb']).tables;
  const beWeighed = weighForms(beTables, new Map([['am', 300], ['are', 3000], ['was', 3000], ['were', 900]]));
  assert.ok(!beWeighed[0].rows.some((r) => r.notes), 'no row of be is weighed');
  assert.deepEqual(rows(beWeighed[0]).Past, ['was', 'were']);
  assert.deepEqual(inflectionsFromKaikki(page('went'), 'en', 'went').formOf, [{ lemma: 'go', label: 'past', pos: 'verb' }]);
  assert.deepEqual(rows(selectInflections(inflectionsFromKaikki(page('child'), 'en', 'child'), ['noun']).tables[0]), { Plural: ['children'] });
  assert.deepEqual(rows(selectInflections(inflectionsFromKaikki(page('vicissitude'), 'en', 'vicissitude'), ['noun']).tables[0]), { Plural: ['vicissitudes'] });

  // A regional spelling is the standard where it is used: "estrus" stays.
  const estrus = JSON.stringify({ lang_code: 'en', word: 'estrus', pos: 'noun', senses: [{ tags: ['US', 'alt-of', 'alternative'], alt_of: [{ word: 'oestrus' }], glosses: ['Alternative spelling of oestrus.'] }] });
  assert.deepEqual(fo.formOfLemmasFromKaikki(estrus, 'estrus'), []);

  // The saved notebook, once: forms become their word and merge into it where it is saved.
  await savedNotebook(http);

  console.log(`Word forms passed (${requests.length} fake requests): forms open as their lemma, references are not senses, Forms list standard forms, saved forms fold once.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
