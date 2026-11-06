/**
 * Grammar codes, usage labels, synonyms and collocations read from Wiktionary's wikitext
 * (packages/core/src/sense-notes.ts), their place in a sense (lexicon-parts.ts), the Phrases
 * section, the language switch, and sister-project boxes kept out of glosses (lookup-policy.ts).
 *
 * Run: node scripts/test-sense-notes.js
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

const { labelTemplateNotes, wikiSenseSections, alignSenseNotes, isGrammarLabel } = load('sense-notes');
const { stripSisterProjects, stripGlossText } = load('lookup-policy');
const { pruneGlossLinks } = load('text-links');
const { senseLabelLead, senseNotesHtml, posGrammarHtml, phrasesHtml, languageSwitchHtml, wordFamilyHtml } = load('lexicon-parts');

// {{lb}} labels are joined and sorted as Wiktionary joins them: qualifiers glue to the next label.
assert.deepEqual(labelTemplateNotes(['countable', 'US', 'politics']), { grammar: ['countable'], labels: ['US', 'politics'] });
assert.deepEqual(labelTemplateNotes(['usually', 'uncountable']), { grammar: ['usually uncountable'], labels: [] });
assert.deepEqual(labelTemplateNotes(['chiefly', 'UK', 'informal']), { grammar: [], labels: ['chiefly UK', 'informal'] });
assert.deepEqual(labelTemplateNotes(['ambitransitive', 'obsolete']), { grammar: ['transitive', 'intransitive'], labels: ['obsolete'] });
assert.deepEqual(labelTemplateNotes(['tr', 'fig']), { grammar: ['transitive'], labels: ['figuratively'] });
assert.deepEqual(labelTemplateNotes(['of a person', '_', 'chiefly', 'archaic']), { grammar: [], labels: ['of a person chiefly archaic'] });
assert.deepEqual(
  labelTemplateNotes(['intransitive', 'with {{m|en|on}} or {{m|en|upon}}, [[formerly]] also with {{m|en|in}}']),
  { grammar: ['intransitive', 'with on or upon, formerly also with in'] , labels: [] },
  'a pattern label keeps its words and loses its markup',
);
assert.ok(isGrammarLabel('often in the plural'));
assert.deepEqual(labelTemplateNotes(['countable', 'and', 'uncountable']), { grammar: ['countable and uncountable'], labels: [] });
assert.ok(!isGrammarLabel('law'));

// Wikitext of "proposition" and "rely" (2026-11-06, shortened): labels before the gloss, synonyms
// and collocations on the lines under it, countability on the headword line.
const wikitext = `==English==
{{wp|<dab>}}

===Etymology===
From {{inh|en|enm|proposicioun}}.

===Noun===
{{en-noun|~}}

# {{lb|en|uncountable}} The act of [[offering]] (an idea) for [[consideration]].
# {{lb|en|countable}} An [[idea]], [[plan]], or [[suggestion]] [[offer]]ed.
## {{lb|en|informal}} A suggestion of [[sexual intercourse]].
# {{wp}} {{lb|en|countable|logic}} The [[content]] of an [[assertion]] that may be taken as being [[true]] or [[false]]; {{lb|en|Aristotelian logic}} a [[predicate]] of a [[subject]].
#: {{ux|en|“Wiktionary is a good dictionary” is a '''proposition'''.}}
#: {{co|en|a tempting '''proposition'''}}
# A [[statement]] of [[religious]] [[doctrine]]; a [[creed]].

====Derived terms====
{{col|en|value proposition}}

===Verb===
{{en-verb}}

# {{lb|en|transitive|informal}} To make an [[offer]] or [[suggestion]] to (someone).
## {{lb|en|transitive|informal}} To make a suggestion of [[sexual intercourse]] to (someone).
##: {{synonyms|en|pass|come on to|hit on}}
#* {{quote-book|en|year=2001|passage=He '''propositioned''' her.}}

==French==

===Noun===
{{fr-noun|f}}

# {{lb|fr|grammar}} [[clause]]
`;
const sections = wikiSenseSections(wikitext, 'English');
assert.deepEqual(sections.map((s) => s.heading), ['Noun', 'Verb'], 'only parts of speech with senses, English only');
assert.deepEqual(sections[0].head, ['countable', 'uncountable'], '{{en-noun|~}}');
assert.deepEqual(sections[0].senses[3].notes, { grammar: ['countable'], labels: ['logic'], collocations: ['a tempting proposition'] }, 'a label later in the line labels a clause, not the sense');
assert.deepEqual(sections[1].senses[1].notes.synonyms, ['pass', 'come on to', 'hit on'], '"##:" belongs to the "##" sense');
assert.equal(sections[1].senses[0].notes.synonyms, undefined);
assert.deepEqual(wikiSenseSections(wikitext, 'French')[0].senses[0].notes, { labels: ['grammar'] });
assert.deepEqual(wikiSenseSections('==English==\n===Noun===\n{{en-noun|-}}\n# [[advice]]\n', 'English')[0].head, ['uncountable']);
assert.deepEqual(wikiSenseSections('==English==\n===Noun===\n{{en-noun|-|s}}\n# [[stuff]]\n', 'English')[0].head, ['usually uncountable']);
assert.deepEqual(wikiSenseSections('==English==\n===Noun===\n{{en-noun}}\n# [[dog]]\n', 'English')[0].head, ['countable']);

// The definitions API's glosses, in its order with its sub-senses flattened, meet the lines by
// their words; a gloss the wikitext lacks gets nothing and the next ones still match.
const glosses = [
  'The act of <a href="/wiki/offering">offering</a> (an idea) for <a href="/wiki/consideration">consideration</a>.',
  'An idea, plan, or suggestion offered.',
  'A gloss added to the page after its wikitext was read.',
  'A suggestion of sexual intercourse.',
  'The content of an assertion that may be taken as being true or false; a predicate of a subject.',
  'A statement of religious doctrine; a creed.',
];
const aligned = alignSenseNotes(sections[0].senses, glosses);
assert.deepEqual(aligned.map((n) => n && (n.grammar || n.labels || [])[0]), ['uncountable', 'countable', undefined, 'countable', 'countable', undefined]);
assert.deepEqual(aligned[3], { grammar: ['countable'], labels: ['informal'] }, "a sub-sense keeps its own labels and takes the grammar of the sense above it");

// Sister-project boxes ({{wp}}, {{commons}}) come out by their class, whatever their words.
const box =
  '<div class="interproject-box sister-wikipedia sister-project noprint floatright" about="#mwt26" typeof="mw:Transclusion"><div style="float: left;" class="interproject-box-logo"><figure class="mw-halign-none" typeof="mw:File"><span><img src="//thumb.wikimedia.org/x.png" alt="" class="mw-file-element"></span><figcaption></figcaption></figure></div><div style="margin-left: 60px;">English <a rel="mw:WikiLink" href="/wiki/Wikipedia" title="Wikipedia">Wikipedia</a> has an article on:<div style="margin-left: 10px;"><b class="Latn" lang="en"><a href="https://en.wikipedia.org/wiki/proposition" class="extiw">proposition</a></b></div></div><span class="interProject"><a href="https://en.wikipedia.org/wiki/proposition" class="extiw">Wikipedia </a></span></div>';
const gloss = 'The <a rel="mw:WikiLink" href="/wiki/content" title="content">content</a> of an assertion.';
assert.equal(stripSisterProjects(box + ' ' + gloss), gloss);
assert.equal(stripGlossText(box + gloss), 'The content of an assertion.');
assert.equal(stripGlossText('<div class="sister-commons sister-project">Wikimedia Commons has media related to: <b>dog</b></div>A mammal.'), 'A mammal.');
assert.equal(pruneGlossLinks(box + gloss), 'The content of an assertion.', 'cached glosses lose the box when shown');
assert.equal(stripSisterProjects('<div class="sister-project">unclosed ' + gloss), '<div class="sister-project">unclosed ' + gloss, 'a box without its end leaves the gloss whole');
assert.equal(stripSisterProjects(gloss), gloss);

// A sense's lead: grammar in square brackets, upright, a pattern's words bold; labels in round ones.
assert.equal(
  senseLabelLead('To trust.', { grammar: ['intransitive', 'with on or upon'], labels: ['formal'] }),
  '<span class="sense-gram lx-nolink">[intransitive; with <b>on</b> or <b>upon</b>]</span> <span class="sense-label lx-nolink">(<i>formal</i>)</span> To trust.',
);
assert.equal(senseLabelLead('Advice.', { grammar: ['uncountable'] }, ['uncountable']), 'Advice.', 'a code the heading gives is not repeated');
assert.equal(
  senseLabelLead('(usually uncountable, politics) The capitalist class.'),
  '<span class="sense-gram lx-nolink">[usually uncountable]</span> <span class="sense-label lx-nolink">(<i>politics</i>)</span> The capitalist class.',
  "a source's own leading bracket is sorted the same way",
);
assert.equal(
  senseLabelLead('(business settings) The terms offered.', { grammar: ['countable'], labels: ['business settings'] }),
  '<span class="sense-gram lx-nolink">[countable]</span> <span class="sense-label lx-nolink">(<i>business settings</i>)</span> The terms offered.',
  'a bracket that repeats the notes shows once',
);
assert.equal(
  senseLabelLead('(with on or upon, formerly also with in) to trust.', { grammar: ['intransitive', 'with on or upon, formerly also with in'] }),
  '<span class="sense-gram lx-nolink">[intransitive; with <b>on</b> or <b>upon</b>, formerly also with <b>in</b>]</span> to trust.',
  'a repeated note with a comma of its own shows once',
);
assert.equal(senseLabelLead('The (main) city.'), 'The (main) city.', 'only a leading bracket is a label');
assert.equal(senseLabelLead('<b>x</b>', { labels: ['<script>'] }), '<span class="sense-label lx-nolink">(<i>&lt;script&gt;</i>)</span> <b>x</b>');

// Under a sense: synonyms and opposites link; a collocation sets the word bold.
const notes = senseNotesHtml({ synonyms: ['pass', 'hit on'], antonyms: ['refusal'], collocations: ['a tempting proposition'] }, 'lookup', 'proposition');
assert.match(notes, /Synonyms<\/span> <span[^>]*data-lookup="pass"/);
assert.match(notes, /Opposite<\/span>/);
assert.match(notes, /<b>proposition<\/b>/);
assert.equal(senseNotesHtml({}, 'act'), '');
assert.equal(senseNotesHtml({ synonyms: [] }, 'act'), '');

// The part of speech carries a code only when every sense shares it.
assert.deepEqual(posGrammarHtml(['uncountable']), { html: '<span class="lx-poscode">[uncountable]</span>', hide: ['uncountable'] });
assert.deepEqual(posGrammarHtml(['countable', 'uncountable']), { html: '', hide: [] });
assert.deepEqual(posGrammarHtml(undefined), { html: '', hide: [] });

// Phrases: phrasal verbs (the verb and its particles), idioms, the rest; the family leaves them out.
const family = [
  { relation: 'derived', items: [{ word: 'giver' }] },
  { relation: 'phrases', items: [{ word: 'give up' }, { word: 'give in' }, { word: 'give and take', label: 'idiom' }, { word: 'give way' }] },
];
const phrases = phrasesHtml(family, 'act', 'give', true);
assert.match(phrases, /Phrasal verbs<\/h4>\s*<p class="lx-words"><button[^>]*data-q="give up"/);
assert.match(phrases, /Idioms<\/h4>\s*<p class="lx-words"><button[^>]*data-q="give and take"/);
assert.match(phrases, /Other phrases<\/h4>\s*<p class="lx-words"><button[^>]*data-q="give way"/);
assert.doesNotMatch(phrasesHtml(family, 'act', 'give', false), /Phrasal verbs/, 'a word with no verb sense has no phrasal verbs');
assert.equal(phrasesHtml([{ relation: 'derived', items: [{ word: 'giver' }] }], 'act', 'give', true), '');
assert.doesNotMatch(wordFamilyHtml(family, 'act', { phrases: false }), /give up/);
assert.match(wordFamilyHtml(family, 'act'), /give up/, 'the family keeps phrases when asked to');

// The language switch: English first, the language shown next and marked, the rest folded past seven.
const langs = (n, current) =>
  ['en', 'fr', 'ia', 'it', 'la', 'de', 'es', 'nl', 'sv', 'da'].slice(0, n).map((code) => ({ code, name: code.toUpperCase(), ...(code === current ? { current: true } : {}) }));
const sw = languageSwitchHtml({ word: 'i.e.', languages: langs(5, 'it') }, 'lookup');
assert.deepEqual([...sw.matchAll(/>([A-Z]{2})</g)].map((m) => m[1]), ['EN', 'IT', 'FR', 'IA', 'LA']);
assert.match(sw, /<span class="lx-lang is-current" aria-current="true">IT<\/span>/);
assert.match(sw, /data-lookup-lang="fr" data-q="i.e."/);
assert.match(languageSwitchHtml({ word: 'a', languages: langs(10, 'en') }, 'act'), /<summary class="lx-lang">\+3<\/summary>/);
assert.doesNotMatch(languageSwitchHtml({ word: 'a', languages: langs(10, 'en') }, 'act', { fold: false }), /summary/);
assert.match(languageSwitchHtml({ word: 'a', languages: langs(3, 'en') }, 'act'), /data-act="lookup-lang" data-q="a" data-lang="fr"/);
assert.equal(languageSwitchHtml({ word: 'dog', languages: langs(1, 'en') }, 'act'), '', 'one language needs no switch');

console.log('sense notes ok: labels sorted into grammar and usage, matched to glosses, sister boxes dropped, phrases and languages shown');
