/* Run: node scripts/test-morpheme.js
 *
 * Morpheme pages and linked words, offline: query shapes and routing, the Wiktionary and
 * Etymonline parsers on saved pages (scripts/fixtures/morpheme), the page sections, and the
 * word links in running text.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const src = path.join(__dirname, '..', 'packages', 'core', 'src');
/** Values from the bundle live in another realm, so compare them as JSON. */
const same = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'morpheme', name), 'utf8');

function bundle(contents) {
  const code = esbuild.buildSync({
    stdin: { contents, resolveDir: src, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['cmu-pronouncing-dictionary'],
  }).outputFiles[0].text;
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, console: { log() {}, warn() {}, error() {} },
    require: (name) => (name === 'cmu-pronouncing-dictionary' ? { dictionary: {} } : require(name)),
    setTimeout, clearTimeout, Date, Error, URL, URLSearchParams, JSON, Promise,
  });
  return mod.exports;
}

const M = bundle(`
  export * from './morpheme';
  export * from './morpheme-view';
  export * from './text-links';
  export { inflectionsHtml, wordFamilyHtml } from './lexicon-parts';
  export { templateToLink, scanTemplates } from './etymology';
  export { setEtymonStore } from './notebook-etymology';
  export { configureCore } from './runtime';
  export { DictionaryService } from './dictionary';
`);

// --- Query shapes -------------------------------------------------------------------------
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

// --- The morpheme tables, read through the analysis ---------------------------------------
assert.equal(M.tableMorph('prefix', 'ob').key, 'ob-');
assert.equal(M.tableMorph('prefix', 'con').key, 'co-');
assert.equal(M.tableMorph('suffix', 'ant').key, '-ant');
assert.equal(M.tableMorph('root', 'fac').key, 'fac');
assert.equal(M.tableMorph('root', 'fic').key, 'fac', 'an allomorph names its root');
assert.equal(M.tableMorph('root', 'xyz'), null);
assert.ok(M.tableVariants('prefix', 'ob').includes('op'), 'ob- assimilates to op-');
assert.ok(M.tableVariants('root', 'fac').includes('fic'));
same(M.tableVariants('suffix', 'ant'), [], 'suffix tables join separate pages');

// Routing of plain words: "con" stays a word with a link to co-; "fac" offers its root.
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

// --- Wiktionary affix pages ---------------------------------------------------------------
const ob = M.parseAffixPage(fixture('ob-.wiki'), M.parseMorphemeQuery('ob-'));
assert.match(ob.senses[0].text, /^\(non-productive\) Against; facing/);
same(ob.variants, ['obs-', 'os-', 'op-'], "the Latin section's assimilated forms");
assert.match(ob.usage, /assimilated into the next consonant/);
assert.equal(ob.category, 'English terms prefixed with ob-');
assert.ok(ob.related.includes('counter-'));

const ant = M.parseAffixPage(fixture('-ant.wiki'), M.parseMorphemeQuery('-ant'));
assert.equal(ant.pronunciations[0].ipa, 'ənt');
same(ant.senses[0].examples, ['serve → servant']);
same(ant.related, ['-ance']);

const tion = M.parseAffixPage(fixture('-tion.wiki'), M.parseMorphemeQuery('-tion'));
same(tion.variants, ['-ion', '-ation', '-sion', '-ition'], 'not "complexion" from "(as in …)"');
assert.equal(M.parseAffixPage('==French==\n===Suffix===\n# x', M.parseMorphemeQuery('-tion')), null);

// --- Wiktionary reconstruction page and Etymonline ----------------------------------------
const groups = M.parseReconstructionPage(fixture('bheh2.wiki'));
same(groups.map((g) => g.id), ['shine', 'speak']);
same(groups[0].senses.map((s) => s.text), ['to shine, glow light', 'to appear, be visible']);
const greek = groups[0].descendants.find((d) => d.language === 'Ancient Greek');
assert.ok(greek && greek.terms.includes('φῶς'));
assert.ok(groups[0].descendants.findIndex((d) => d.proto) > groups[0].descendants.findIndex((d) => !d.proto));
assert.ok(!groups.some((g) => g.descendants.some((d) => /^Proto-[A-Z]{2,}/.test(d.language))), 'unnamed proto-languages are left out');
assert.ok(!groups.some((g) => g.formations.some((f) => /[[\]#]/.test(f))), 'formations are plain text');

assert.equal(M.etymonlineRootKey('*bʰeh₂-'), '*bha-');
assert.equal(M.etymonlineRootKey('*dʰeh₁-'), '*dhe-');
assert.equal(M.etymonlineRootKey('*h₂eǵ-'), '*ag-');
assert.equal(M.etymonlineRootKey('*bʰer-'), '*bher-');
const bha = M.parseEtymonlineJson(fixture('etymonline-bha.json'));
same(bha.map((e) => e.gloss), ['to shine', 'to speak, tell, say']);
assert.ok(bha[0].formsPartOf.includes('phantom') && bha[0].formsPartOf.includes('-phane'));
assert.ok(bha[1].formsPartOf.includes('ban'), '"ban (n.1) "proclamation"" reads as ban');
assert.match(bha[1].sourceOf, /^Greek pheme/);
same(M.parseEtymonlineJson('{"code":10001}'), []);

// --- Assembled pages ----------------------------------------------------------------------
const pieQ = M.parseMorphemeQuery('*bʰeh₂-');
const pie = M.morphemeResult(pieQ, M.buildMorphemeEntry(pieQ, { wikitext: fixture('bheh2.wiki'), etymonline: bha }));
assert.equal(pie.word, '*bʰeh₂-');
same(pie.definitions.map((d) => d.partOfSpeech), ['root', 'root', 'root', 'root']);
same(pie.sources, ['Wiktionary', 'Etymonline']);
const pieEntry = M.morphemeOf(pie);
assert.ok(pieEntry.groups[0].derived.includes('phantom'), 'shine takes the shine list');
assert.ok(pieEntry.groups[1].derived.includes('fame'), 'speak takes the speak list');
assert.equal(pieEntry.gloss, 'to shine; to speak, tell, say');
assert.match(pie.etymology, /^\[Etymonline\]\n\*bha- \(1\): /);

const obQ = M.parseMorphemeQuery('ob-');
const obPage = M.morphemeResult(
  obQ,
  M.buildMorphemeEntry(obQ, {
    wikitext: fixture('ob-.wiki'),
    etymonline: M.parseEtymonlineJson(fixture('etymonline-ob.json')),
    categories: { 'English terms prefixed with ob-': M.parseCategoryMembers(fixture('category-ob.json')) },
  }),
);
const obEntry = M.morphemeOf(obPage);
assert.equal(obEntry.origin, 'Latin');
assert.equal(obEntry.gloss, 'against, toward');
same(obEntry.variants.slice(0, 2), ['oc-', 'op-'], 'table spellings first, then Wiktionary’s');
assert.ok(obEntry.groups[0].derived.length > 10);
assert.match(obPage.etymology, /\[Wiktionary\][\s\S]*--- Alternative etymology ---[\s\S]*\[Etymonline\]/);

const facQ = M.parseMorphemeQuery('-fac-');
const fac = M.morphemeResult(facQ, M.buildMorphemeEntry(facQ, {}));
assert.equal(fac.word, 'fac');
same(fac.definitions.map((d) => [d.partOfSpeech, d.meaning]), [['root', 'make, do']]);

// --- Sections: the learner's own words first ----------------------------------------------
const antQ = M.parseMorphemeQuery('-ant');
const antPage = M.morphemeResult(antQ, M.buildMorphemeEntry(antQ, { wikitext: fixture('-ant.wiki') }));
const antSections = M.morphemeSections(antPage, { mine: ['servant', 'moment', 'assistant'], books: ['pleasant', 'servant'] }, 'act');
const sec = (list, id) => list.find((s) => s.id === id);
same(antSections.map((s) => s.id), ['morph-about', 'morph-mine', 'morph-books', 'morph-related']);
assert.match(sec(antSections, 'morph-mine').html, /data-q="servant"/);
assert.doesNotMatch(sec(antSections, 'morph-mine').html, /moment/, 'mom·ent is not built on -ant');
assert.doesNotMatch(sec(antSections, 'morph-books').html, /servant/, 'a saved word is not repeated under books');

const facSections = M.morphemeSections(fac, { mine: ['efficient', 'factory', 'house'], books: [] }, 'act');
const facMine = sec(facSections, 'morph-mine').html;
assert.match(facMine, /data-q="efficient"/);
assert.match(facMine, /data-q="factory"/);
assert.match(sec(facSections, 'morph-about').html, /data-q="-fic-"/, 'a root variant opens its root page');

M.setEtymonStore({ get: () => JSON.stringify({ beacon: { origin: 'Old English', via: [], roots: ['*bʰeh₂-'], at: 1 } }), set() {} });
const pieSections = M.morphemeSections(pie, { mine: ['beacon', 'fame', 'house'], books: [] }, 'lookup');
const pieMine = sec(pieSections, 'morph-mine').html;
assert.match(pieMine, /data-lookup="beacon"/, 'traced to the root');
assert.match(pieMine, /data-lookup="fame"/, 'listed by Etymonline');
assert.doesNotMatch(pieMine, /house/);
assert.ok(sec(pieSections, 'morph-descendants'));
same(M.morphemeSections({ word: 'house', metadata: {} }, { mine: [], books: [] }, 'act'), []);

// --- Words in running text ----------------------------------------------------------------
const q = (text) => M.wordTokens(text).map((t) => t.query);
same(q('From Latin ob- + tenēre, from PIE *bʰeh₂- "to shine"; see -ant.'), [
  'From', 'Latin', 'ob-', 'tenēre', 'from', 'PIE', '*bʰeh₂-', 'to', 'shine', 'see', '-ant',
]);
same(q("it's a well-known pre- and post-war word—done"), ['it', 'well-known', 'pre-', 'and', 'post-war', 'word', 'done']);
same(q('-tain-握住 拉丁 ob-'), ['-tain-', 'ob-'], 'Chinese text stays text');
assert.equal(
  M.linkText('a cat', 'lookup'),
  'a <a href="#" class="lx-w" data-lookup="cat">cat</a>',
  'single letters are not links',
);
const html = M.linkHtml('<i>Latin</i> &amp; <a href="/wiki/x">kept link</a> don&#39;t <span class="sense-label lx-nolink">botany</span>', 'act');
assert.match(html, /<i><span class="lx-w" data-act="lookup" data-q="Latin">Latin<\/span><\/i>/);
assert.match(html, /<a href="\/wiki\/x">kept link<\/a>/, 'an existing link is left alone');
assert.match(html, /data-q="don&#39;t"/, 'text after a link is linked again');
assert.match(html, /lx-nolink">botany<\/span>/, 'sense labels stay text');
assert.match(M.linkText('x <b> & "y"', 'act'), /&lt;b&gt; &amp; &quot;/);
assert.equal(M.wikiLinkLookup('Reconstruction:Proto-Indo-European/bʰeh₂-'), '*bʰeh₂-');
assert.equal(M.wikiLinkLookup('Category:English prefixes'), '');
assert.equal(M.wikiLinkLookup('obtain#English'), 'obtain');

// Affix templates name their parts with hyphens, so Built from links to the part's page.
const parts = (t) => M.templateToLink(M.scanTemplates(t)[0]).parts;
same(parts('{{suffix|en|assist|ant}}'), ['assist', '-ant']);
same(parts('{{prefix|en|un|happy}}'), ['un-', 'happy']);
same(parts('{{confix|en|neuro|logy}}'), ['neuro-', '-logy']);
same(parts('{{af|en|ob-<t:against>|tain}}'), ['ob-', 'tain']);
assert.match(M.wordFamilyHtml([{ relation: 'affixes', items: [{ word: 'assist' }, { word: '-ant' }] }], 'act'), /data-q="-ant"/);

// Forms are links too.
const forms = M.inflectionsHtml({ formOf: [], tables: [{ pos: 'verb', rows: [{ label: 'Past', forms: ['ran'] }], grids: [] }] }, 'run', 'lookup');
assert.match(forms, /<a href="#" class="lx-w" data-lookup="ran">ran<\/a>/);

// --- Routing through the dictionary service, offline --------------------------------------
const pages = {
  'ob-': fixture('ob-.wiki'),
  'Reconstruction:Proto-Indo-European/bʰeh₂-': fixture('bheh2.wiki'),
};
const asked = [];
M.configureCore({
  sha256Hex: (t) => t,
  http: {
    requestText: async (url) => {
      asked.push(url);
      const u = new URL(url);
      if (u.hostname === 'www.etymonline.com') {
        const word = u.searchParams.get('word');
        if (word === '*bha-') return { ok: true, status: 200, text: fixture('etymonline-bha.json') };
        if (word === 'ob-') return { ok: true, status: 200, text: fixture('etymonline-ob.json') };
        return { ok: true, status: 200, text: '{"code":10001}' };
      }
      if (u.searchParams.get('list') === 'categorymembers') {
        return { ok: true, status: 200, text: u.searchParams.get('cmtitle').endsWith('with ob-') ? fixture('category-ob.json') : '{"query":{"categorymembers":[]}}' };
      }
      const title = u.searchParams.get('titles');
      const content = pages[title];
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({ query: { pages: [content ? { title, revisions: [{ slots: { main: { content } } }] } : { title, missing: true }] } }),
      };
    },
    requestJson: async () => ({}),
    requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array() }),
  },
});
const service = new M.DictionaryService();
(async () => {
  const obResult = await service.lookup('ob-');
  assert.equal(obResult.word, 'ob-');
  assert.equal(M.morphemeOf(obResult).kind, 'prefix');
  assert.ok(obResult.definitions.length >= 2);
  assert.ok(asked.some((u) => u.includes('etymonline.com/api/etymology?word=ob-')));

  const pieResult = await service.lookup('*bʰeh₂-');
  assert.equal(M.morphemeOf(pieResult).groups.length, 2);
  assert.ok(asked.some((u) => u.includes(encodeURIComponent('Reconstruction:Proto-Indo-European/bʰeh₂-'))));
  assert.ok(asked.some((u) => u.includes(`word=${encodeURIComponent('*bha-')}`)));

  const before = asked.length;
  await service.lookup('ob-');
  assert.equal(asked.length, before, 'a page is fetched once and kept');

  const rootResult = await service.lookup('-fac-');
  assert.equal(rootResult.word, 'fac');
  assert.equal(rootResult.definitions[0].meaning, 'make, do');

  console.log('test-morpheme: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
