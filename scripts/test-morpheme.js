/* Run: node scripts/test-morpheme.js
 *
 * Morpheme pages and linked words, offline: query shapes and routing, the Wiktionary,
 * Etymonline and Datamuse readers on saved responses (scripts/fixtures/morpheme), which words
 * count as built on a part, the page sections, and the word links in running text.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const src = path.join(__dirname, '..', 'packages', 'core', 'src');
/** Values from the bundle live in another realm, so compare them as JSON. */
const same = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
/** Saved responses, with the line ends Wiktionary sends whatever git checked out. */
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'morpheme', name), 'utf8').replace(/\r\n/g, '\n');

function bundle(contents) {
  const code = esbuild.buildSync({
    stdin: { contents, resolveDir: src, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['cmu-pronouncing-dictionary'],
  }).outputFiles[0].text
    // The pronouncing dictionary is a dynamic import; the stub below stands in for it.
    .replace(/import\(\s*["']cmu-pronouncing-dictionary["']\s*\)/g, 'Promise.resolve(require("cmu-pronouncing-dictionary"))');
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, console: { log() {}, warn() {}, error() {} },
    // A small pronouncing dictionary: the words a suffix may stand on ("assist" in assistant).
    require: (name) => (name === 'cmu-pronouncing-dictionary' ? { dictionary: { assist: 'AH0 S IH1 S T', real: 'R IY1 L', please: 'P L IY1 Z' } } : require(name)),
    setTimeout, clearTimeout, Date, Error, URL, URLSearchParams, JSON, Promise,
  });
  return mod.exports;
}

const M = bundle(`
  export * from './morpheme';
  export * from './morpheme-view';
  export * from './morpheme-roots';
  export * from './text-links';
  export { inflectionsHtml, wordFamilyHtml } from './lexicon-parts';
  export { templateToLink, scanTemplates } from './etymology';
  export { setEtymonStore } from './notebook-etymology';
  export { warmCmuIpa, isCmuWord } from './cmu-ipa';
  export { configureCore } from './runtime';
  export { DictionaryService } from './dictionary';
`);
const muse = (...names) => names.flatMap((n) => M.parseDatamuse(fixture(`datamuse-${n}.json`)));
const sec = (list, id) => list.find((s) => s.id === id);

(async () => {
  await M.isCmuWord('assist');

  // --- Query shapes -----------------------------------------------------------------------
  const shape = (q) => {
    const r = M.parseMorphemeQuery(q);
    return r ? [r.kind, r.bare] : null;
  };
  same(shape('ob-'), ['prefix', 'ob']);
  same(shape('-ant'), ['suffix', 'ant']);
  same(shape('-tion'), ['suffix', 'tion']);
  same(shape('-fac-'), ['root', 'fac']);
  same(shape('*bʰeh₂-'), ['reconstructed', 'bʰeh₂']);
  same(shape('‐ant'), ['suffix', 'ant'], 'a typographic hyphen is a hyphen');
  for (const word of ['con', 'obtain', 'well-being', 'pre-war', '-', '*', 'a b-', '--', '2-']) {
    assert.equal(M.parseMorphemeQuery(word), null, `${word} is not a word part`);
  }

  // --- The morpheme tables (morphEntry) -----------------------------------------------------
  assert.equal(M.tableMorph('prefix', 'ob').key, 'ob-');
  same(M.tableMorph('prefix', 'oc').forms.slice(0, 4), ['ob-', 'oc-', 'of-', 'op-'], 'an assimilated spelling names its prefix');
  assert.equal(M.tableMorph('suffix', 'ant').key, '-ant');
  assert.equal(M.tableMorph('root', 'fic').key, 'fac', 'an allomorph names its root');
  assert.equal(M.tableMorph('root', 'fac').pie, '*dʰeh₁-');
  assert.equal(M.tableMorph('root', 'xyz'), null);
  assert.equal(M.ROOT_LEMMA.fac, 'facio');

  // Routing of plain words: "con" stays a word with a link to con-; "fac" offers its root.
  same(M.morphemeOffers('con').map((o) => o.form), ['con-']);
  same(M.morphemeOffers('fac').map((o) => o.form), ['-fac-']);
  same(M.morphemeOffers('house'), []);
  same(M.morphemeOffers('Con'), [], 'a capitalised name is not a part');
  assert.match(M.morphemeOfferHtml({ word: 'con' }, 'act'), /data-q="con-"/);
  assert.equal(M.morphemeOfferHtml({ word: 'ob-', metadata: { morpheme: { kind: 'prefix' } } }, 'act'), '');

  // A card chip's query: a prefix by its canonical form, a suffix by its spelling, a root hyphenated.
  assert.equal(M.morphemeLookupQuery({ kind: 'prefix', label: 'ob-', start: 0, end: 2 }, 'obtain'), 'ob-');
  assert.equal(M.morphemeLookupQuery({ kind: 'suffix', label: '-sion', start: 2, end: 6 }, 'action'), '-tion');
  assert.equal(M.morphemeLookupQuery({ kind: 'root', label: 'fac', start: 2, end: 5 }, 'effect'), '-fac-');

  // --- Which words are built on a part ------------------------------------------------------
  const part = (q) => {
    const p = M.parseMorphemeQuery(q);
    const t = M.tableMorph(p.kind, p.bare);
    return { kind: p.kind, tableKey: t ? t.key : '', bare: p.kind === 'root' && t ? t.key : p.bare, variants: [] };
  };
  const built = (q, words) => words.filter((w) => M.partInWord(part(q), w));
  same(built('-fac-', ['profit', 'benefit', 'defeat', 'efficient', 'traffic', 'preface', 'face']), ['profit', 'benefit', 'defeat', 'efficient']);
  same(built('-ant', ['servant', 'important', 'assistant', 'elephant', 'transplant', 'enchant', 'warrant', 'moment']), ['servant', 'important', 'assistant']);
  same(built('ob-', ['occur', 'offer', 'obvious', 'obtain', 'oppose', 'opaque']), ['occur', 'offer', 'obvious', 'obtain', 'oppose']);
  same(built('-tion', ['nation', 'station', 'motion', 'question', 'lion']), ['nation', 'station', 'motion', 'question']);
  same(built('con-', ['correct', 'company', 'concert']), ['correct', 'company', 'concert']);
  same(built('-ism', ['realism', 'schism', 'chrism']), ['realism']);

  // --- Wiktionary affix pages ---------------------------------------------------------------
  const ob = M.parseAffixPage(fixture('ob-.wiki'), M.parseMorphemeQuery('ob-'), 'Latin');
  same(ob.senses.map((s) => s.text), ['(non-productive) Against; facing; a combining prefix found in verbs of Latin origin.', '(botany) Of a reversed shape.'], 'the clipping of "obligatory" is another homograph');
  same(ob.variants, ['obs-', 'os-', 'op-'], "the Latin section's assimilated forms");
  assert.match(ob.usage, /assimilated into the next consonant/);
  assert.equal(ob.category, 'English terms prefixed with ob-');
  same(ob.related, ['anti-', 'counter-', 'contra-', 'dys-'], 'no "thread tax"');

  const ant = M.parseAffixPage(fixture('-ant.wiki'), M.parseMorphemeQuery('-ant'), 'Latin');
  assert.equal(ant.pronunciations[0].ipa, 'ənt');
  same(ant.senses[0].examples, ['serve → servant']);
  same(ant.related, ['-ance']);

  const tion = M.parseAffixPage(fixture('-tion.wiki'), M.parseMorphemeQuery('-tion'), 'Latin');
  same(tion.variants, ['-ion', '-ation', '-sion', '-ition'], 'not "complexion" from "(as in …)"');
  assert.equal(M.parseAffixPage('==French==\n===Suffix===\n# x', M.parseMorphemeQuery('-tion')), null);

  const con = M.parseAffixPage(fixture('con-.wiki'), M.parseMorphemeQuery('con-'), 'Latin');
  assert.ok(con.senses.length >= 10, 'sub-senses count');
  assert.ok(!con.senses.some((s) => /:\s*$/.test(s.text)), 'no sense ends in a bare colon');
  assert.ok(con.senses.some((s) => /^Indicating a common origin: /.test(s.text)));

  // --- Wiktionary reconstruction page and Etymonline ----------------------------------------
  const groups = M.parseReconstructionPage(fixture('bheh2.wiki'));
  same(groups.map((g) => g.id), ['shine', 'speak']);
  same(groups[0].senses.map((s) => s.text), ['to shine, glow light', 'to appear, be visible']);
  const greek = groups[0].descendants.find((d) => d.language === 'Ancient Greek');
  assert.ok(greek && greek.terms.includes('φῶς'));
  assert.ok(!groups.some((g) => g.descendants.some((d) => /^Proto-[A-Z]{2,}/.test(d.language))), 'unnamed proto-languages are left out');
  assert.ok(!groups.some((g) => g.formations.some((f) => /[[\]#]/.test(f))), 'formations are plain text');

  assert.equal(M.etymonlineRootKey('*bʰeh₂-'), '*bha-');
  assert.equal(M.etymonlineRootKey('*dʰeh₁-'), '*dhe-');
  assert.equal(M.etymonlineRootKey('*h₂eǵ-'), '*ag-');
  const bha = M.parseEtymonlineJson(fixture('etymonline-bha.json'));
  same(bha.map((e) => e.gloss), ['to shine', 'to speak, tell, say']);
  assert.ok(bha[1].formsPartOf.includes('ban'), '"ban (n.1) "proclamation;"" reads as ban');
  same(M.parseEtymonlineJson('{"code":10001}'), []);

  // --- Pages --------------------------------------------------------------------------------
  const pieQ = M.parseMorphemeQuery('*bʰeh₂-');
  const pie = M.morphemeResult(pieQ, M.buildMorphemeEntry(pieQ, { wikitext: fixture('bheh2.wiki'), etymonline: bha }));
  assert.equal(pie.word, '*bʰeh₂-');
  same(pie.sources, ['Wiktionary', 'Etymonline']);
  const pieEntry = M.morphemeOf(pie);
  assert.ok(pieEntry.groups[0].derived.includes('phantom') && pieEntry.groups[1].derived.includes('fame'));
  assert.equal(pieEntry.gloss, 'to shine; to speak, tell, say');

  // ob-: common words first, ranked by frequency; inflections stand under their lemma.
  const obQ = M.parseMorphemeQuery('ob-');
  const obPage = M.morphemeResult(obQ, M.buildMorphemeEntry(obQ, {
    wikitext: fixture('ob-.wiki'),
    etymonline: M.parseEtymonlineJson(fixture('etymonline-ob.json')),
    frequent: muse('ob-', 'oc-', 'of-', 'op-'),
    categories: { 'English terms prefixed with ob-': M.parseCategoryMembers(fixture('category-ob.json')) },
  }));
  const obEntry = M.morphemeOf(obPage);
  const obDerived = obEntry.groups[0].derived;
  same(obDerived.slice(0, 3), ['object', 'occur', 'offer']);
  for (const w of ['obtain', 'observe', 'oppose', 'obvious']) assert.ok(obDerived.includes(w), w);
  for (const w of ['objects', 'obtained', 'occurred']) assert.ok(!obDerived.includes(w), `${w} stands under its lemma`);
  assert.ok(obDerived.indexOf('obcell') < 0 || obDerived.indexOf('obcell') > obDerived.indexOf('obtain'));
  same(obEntry.variants.slice(0, 3), ['oc-', 'of-', 'op-'], 'the table spellings first');
  assert.equal(obPage.definitions.length, 2);

  // -fic- and -fac- are one page: Latin facere with its principal parts, PIE *dʰeh₁-, English words.
  const lemmaSrc = { title: 'facio', wikitext: fixture('facio.wiki'), headline: JSON.parse(fixture('facio-head.json')).expandtemplates.wikitext };
  const facQ = M.parseMorphemeQuery('-fic-');
  const fac = M.morphemeResult(facQ, M.buildMorphemeEntry(facQ, {
    lemma: lemmaSrc,
    etymonline: M.parseEtymonlineJson(fixture('etymonline-dhe.json')),
    frequent: muse('fac', 'fic', 'fec', 'fect', 'fact', 'feat', 'feit', 'fit'),
  }));
  const facEntry = M.morphemeOf(fac);
  assert.equal(fac.word, 'fac');
  assert.equal(facEntry.source.parts, 'faciō, facere, fēcī, factum');
  assert.equal(facEntry.pie, '*dʰeh₁-');
  same(facEntry.variants.slice(0, 3), ['fic', 'fec', 'fect']);
  assert.equal(fac.definitions[0].meaning, 'make, do');
  assert.match(fac.definitions[1].meaning, /^faciō: to do/);
  for (const w of ['effect', 'office', 'difficult', 'efficient', 'profit', 'benefit', 'defeat', 'satisfaction']) assert.ok(facEntry.groups[0].derived.includes(w), w);
  for (const w of ['traffic', 'preface', 'face']) assert.ok(!facEntry.groups[0].derived.includes(w), w);
  assert.match(fac.etymology, /^\[Wiktionary\]\nfaciō: Inherited from Proto-Italic \*fakjō, from Proto-Indo-European \*dʰeh₁-\. /);
  assert.equal(M.principalParts(''), '');

  // --- Sections: the learner's own words first ----------------------------------------------
  const antQ = M.parseMorphemeQuery('-ant');
  const antPage = M.morphemeResult(antQ, M.buildMorphemeEntry(antQ, { wikitext: fixture('-ant.wiki') }));
  const antSections = M.morphemeSections(antPage, { mine: ['servant', 'moment', 'assistant', 'elephant'], books: ['important', 'servant'] }, 'act');
  same(antSections.map((s) => s.id), ['morph-about', 'morph-mine', 'morph-books', 'morph-related']);
  assert.match(sec(antSections, 'morph-mine').html, /data-q="assistant"/);
  assert.doesNotMatch(sec(antSections, 'morph-mine').html, /moment|elephant/);
  assert.doesNotMatch(sec(antSections, 'morph-books').html, /servant/, 'a saved word is not repeated under books');
  assert.equal(M.morphemeSections(antPage, { mine: ['servant', 'moment', 'assistant', 'elephant'], books: ['important', 'servant'] }, 'act'), antSections, 'kept for the same words');

  const facSections = M.morphemeSections(fac, { mine: ['efficient', 'factory', 'face'], books: [] }, 'act');
  const about = sec(facSections, 'morph-about').html;
  assert.match(about, /<dt>Latin<\/dt>/);
  assert.match(about, /data-q="-fic-"/, 'a spelling opens the same root');
  assert.match(about, /<dt>PIE root<\/dt><dd><span class="lx-link" role="link" tabindex="0" data-act="lookup" data-q="\*dʰeh₁-">/);
  assert.doesNotMatch(sec(facSections, 'morph-mine').html, /"face"/);

  M.setEtymonStore({ get: () => JSON.stringify({ beacon: { origin: 'Old English', via: [], roots: ['*bʰeh₂-'], at: 1 } }), set() {} });
  const pieMine = sec(M.morphemeSections(pie, { mine: ['beacon', 'fame', 'house'], books: [] }, 'lookup'), 'morph-mine').html;
  assert.match(pieMine, /data-lookup="beacon"/, 'traced to the root');
  assert.match(pieMine, /data-lookup="fame"/, 'listed by Etymonline');
  assert.doesNotMatch(pieMine, /house/);
  same(M.morphemeSections({ word: 'house', metadata: {} }, { mine: [], books: [] }, 'act'), []);

  // --- Words in running text ----------------------------------------------------------------
  const q = (text) => M.wordTokens(text).map((t) => t.query);
  same(q('From Latin ob- + tenēre, from PIE *bʰeh₂- "to shine"; see -ant.'), ['From', 'Latin', 'ob-', 'tenēre', 'from', 'PIE', '*bʰeh₂-', 'to', 'shine', 'see', '-ant']);
  same(q("it's a well-known pre- and post-war word—done"), ["it's", 'well-known', 'pre-', 'and', 'post-war', 'word', 'done']);
  same(q('-tain-握住 拉丁 ob-'), ['-tain-', 'ob-'], 'Chinese text stays text');
  same(q('from Middle English mid-15c. via -i- and the Rome’s walls'), ['from', 'Middle English', 'mid', 'via', 'and', 'the', 'Rome', 'walls']);
  same(q("He's a I"), ["He's"], 'single letters are not links; "he" alone is no lookup');
  // Only word parts become links in running text; ordinary words stay text.
  assert.equal(M.linkText('a cat', 'lookup'), 'a cat');
  assert.equal(
    M.linkText('from ob- and *bʰeh₂-', 'lookup'),
    'from <span class="lx-w" role="link" tabindex="0" data-lookup="ob-">ob-</span> and <span class="lx-w" role="link" tabindex="0" data-lookup="*bʰeh₂-">*bʰeh₂-</span>',
  );
  assert.equal(M.linkText('pre- and post-war, mid-15c.', 'lookup'), '<span class="lx-w" role="link" tabindex="0" data-lookup="pre-">pre-</span> and post-war, mid-15c.');
  const html = M.linkHtml('<i>Latin</i> &amp; <a href="/wiki/x">kept link</a> from -ant <span class="sense-label lx-nolink">-ism</span> <span class="lx-w" role="link" data-lookup="y">y y</span>', 'act');
  assert.match(html, /<i>Latin<\/i>/, 'a plain word stays text');
  assert.match(html, /<a href="\/wiki\/x">kept link<\/a>/, 'an existing link is left alone');
  assert.match(html, /from <span class="lx-w" role="link" tabindex="0" data-act="lookup" data-q="-ant">-ant<\/span>/, 'a part after a link is linked');
  assert.match(html, /lx-nolink">-ism<\/span>/, 'sense labels stay text');
  assert.match(html, /data-lookup="y">y y<\/span>/, 'a link is not linked twice');
  assert.equal(M.wikiLinkLookup('Reconstruction:Proto-Indo-European/bʰeh₂-'), '*bʰeh₂-');
  assert.equal(M.wikiLinkLookup('Category:English prefixes'), '');

  // Affix templates name their parts with hyphens, so Built from links to the part's page.
  const parts = (t) => M.templateToLink(M.scanTemplates(t)[0]).parts;
  same(parts('{{suffix|en|assist|ant}}'), ['assist', '-ant']);
  same(parts('{{prefix|en|un|happy}}'), ['un-', 'happy']);
  same(parts('{{confix|en|neuro|logy}}'), ['neuro-', '-logy']);
  same(parts('{{af|en|ob-<t:against>|tain}}'), ['ob-', 'tain']);
  assert.match(M.wordFamilyHtml([{ relation: 'affixes', items: [{ word: 'assist' }, { word: '-ant' }] }], 'lookup'), /role="link" tabindex="0" data-lookup="-ant"/);

  // Forms are links too, spans on both shells.
  const forms = M.inflectionsHtml({ formOf: [], tables: [{ pos: 'verb', rows: [{ label: 'Past', forms: ['ran'] }], grids: [] }] }, 'run', 'lookup');
  assert.match(forms, /<span class="lx-w" role="link" tabindex="0" data-lookup="ran">ran<\/span>/);

  // --- Routing through the dictionary service, offline --------------------------------------
  const pages = {
    'ob-': fixture('ob-.wiki'),
    facio: fixture('facio.wiki'),
    'Reconstruction:Proto-Indo-European/bʰeh₂-': fixture('bheh2.wiki'),
  };
  const asked = [];
  M.configureCore({
    sha256Hex: (t) => t,
    http: {
      requestText: async (url) => {
        asked.push(url);
        const u = new URL(url);
        const ok = (text) => ({ ok: true, status: 200, text });
        if (u.hostname === 'www.etymonline.com') {
          const word = u.searchParams.get('word');
          if (word === '*bha-') return ok(fixture('etymonline-bha.json'));
          if (word === '*dhe-') return ok(fixture('etymonline-dhe.json'));
          if (word === 'ob-') return ok(fixture('etymonline-ob.json'));
          return ok('{"code":10001}');
        }
        if (u.hostname === 'api.datamuse.com') {
          const name = `datamuse-${u.searchParams.get('sp').replace(/^\*|\*$/g, '').replace(/\*$/, '')}${/^[a-z]+\*$/.test(u.searchParams.get('sp')) ? '-' : ''}.json`;
          return ok(fs.existsSync(path.join(__dirname, 'fixtures', 'morpheme', name)) ? fixture(name) : '[]');
        }
        if (u.searchParams.get('action') === 'expandtemplates') return ok(fixture('facio-head.json'));
        if (u.searchParams.get('list') === 'categorymembers') {
          return ok(u.searchParams.get('cmtitle').endsWith('with ob-') ? fixture('category-ob.json') : '{"query":{"categorymembers":[]}}');
        }
        const title = u.searchParams.get('titles');
        const content = pages[title];
        return ok(JSON.stringify({ query: { pages: [content ? { title, revisions: [{ slots: { main: { content } } }] } : { title, missing: true }] } }));
      },
      requestJson: async () => ({}),
      requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array() }),
    },
  });
  const service = new M.DictionaryService();
  const obResult = await service.lookup('ob-');
  assert.equal(M.morphemeOf(obResult).kind, 'prefix');
  // Datamuse's counts and the shipped NGSL list together: a common word comes first.
  assert.ok(['object', 'offer', 'occur'].includes(M.morphemeOf(obResult).groups[0].derived[0]));

  const pieResult = await service.lookup('*bʰeh₂-');
  assert.equal(M.morphemeOf(pieResult).groups.length, 2);
  assert.ok(asked.some((u) => u.includes(`word=${encodeURIComponent('*bha-')}`)));

  const before = asked.length;
  await service.lookup('ob-');
  assert.equal(asked.length, before, 'a page is fetched once and kept');

  const ficResult = await service.lookup('-fic-');
  assert.equal(ficResult.word, 'fac');
  assert.equal(M.morphemeOf(ficResult).source.parts, 'faciō, facere, fēcī, factum');
  const again = asked.length;
  const facResult = await service.lookup('-fac-');
  assert.equal(asked.length, again, '-fac- is the page -fic- already fetched');
  assert.equal(facResult, ficResult);

  console.log('test-morpheme: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
