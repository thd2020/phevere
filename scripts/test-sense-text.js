/* Run: node scripts/test-sense-text.js
 * English senses from different dictionaries read alike: a capital, a closing stop, no space before
 * punctuation, no leaked Wiktionary stylesheet text. CJK glosses take no stop. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const file = path.join(__dirname, '..', 'packages', 'core', 'src', 'sense-text.ts');
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { tidySenseText: text, tidySenseHtml: html } = mod.exports;

// WordNet phrases and Wiktionary senses without a stop.
assert.equal(text('a giant supernatural being, especially one living in caves'), 'A giant supernatural being, especially one living in caves.');
assert.equal(text('Careless, hasty writing, doodle or drawing'), 'Careless, hasty writing, doodle or drawing.');
assert.equal(text('A tree-dwelling lizard (Basiliscus)'), 'A tree-dwelling lizard (Basiliscus).');
// Spacing a stripped tag left, and the stylesheet text an old save kept ("moratorium").
assert.equal(text('A suspension of an ongoing activity .'), 'A suspension of an ongoing activity.');
assert.equal(
  text('An authorization to a debtor , permitting temporary suspension of payments. .mw-parser-output .defdate{font-size:smaller}'),
  'An authorization to a debtor, permitting temporary suspension of payments.',
);
// A leading label keeps its case and the sense after it takes the capital.
assert.equal(text('(law) an authorization to a debtor'), '(law) An authorization to a debtor.');
// Left as they are: a sense that introduces sub-senses, a word in mixed case, finished sentences.
assert.equal(text('A room or set of rooms, particularly:'), 'A room or set of rooms, particularly:');
assert.equal(text('pH of the solution'), 'pH of the solution.');
assert.equal(text('Weakened or worn out from age or wear.'), 'Weakened or worn out from age or wear.');
assert.equal(text('“Hello!”'), '“Hello!”');
// Chinese glosses: no stop, no space after full-width punctuation.
assert.equal(text('老态龙钟的； 破旧不堪的'), '老态龙钟的；破旧不堪的');

// The lookup's HTML: links and labels stay, the stop goes after the link that closes the last word.
assert.equal(html('Careless, hasty writing, doodle or <a href="/wiki/drawing">drawing</a>'), 'Careless, hasty writing, doodle or <a href="/wiki/drawing">drawing</a>.');
assert.equal(html('Careless <a>drawing</a><link rel="x">'), 'Careless <a>drawing</a>.<link rel="x">');
assert.equal(html('a word<br>'), 'A word.<br>');
assert.equal(
  html('<span class="usage-label-sense"></span> a <a href="/wiki/suspension">suspension</a> of an <a>activity</a> . <link rel="mw">'),
  '<span class="usage-label-sense"></span> A <a href="/wiki/suspension">suspension</a> of an <a>activity</a>. <link rel="mw">',
);
assert.equal(
  html('<span class="usage-label-sense">(<a>law</a>)</span> an <a>authorization</a><style data-mw>.mw-parser-output .defdate{font-size:smaller}</style>'),
  '<span class="usage-label-sense">(<a>law</a>)</span> An <a>authorization</a>.',
);
assert.equal(html('Weakened or <a href="/wiki/worn-out" title="worn-out">worn out</a> from age or wear.'), 'Weakened or <a href="/wiki/worn-out" title="worn-out">worn out</a> from age or wear.');
assert.equal(html('<a href="/wiki/x" title="lower case title">a</a> letter'), '<a href="/wiki/x" title="lower case title">A</a> letter.');

console.log('Sense text passed: capital, stop, spacing, leaked stylesheet text, labels, sub-sense headings, mixed case, CJK, HTML links.');
