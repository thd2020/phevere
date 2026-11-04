/* Run: node scripts/test-morphology.js
 *
 * Roots and prefixes over the 考研 word book (4,801 words): allomorphs are matched, look-alikes
 * are not, and the etymology cache can veto a part. The numbers guard against regressions; a
 * change that moves them should be checked by hand against Wiktionary.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const coreDir = path.join(__dirname, '..', 'packages', 'core', 'src');
const cache = new Map();
function load(name) {
  const base = path.join(coreDir, name.replace(/^\.\//, ''));
  const file = fs.existsSync(base + '.ts') ? base + '.ts' : base + '.js';
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (dep) => (dep.startsWith('.') ? load(dep) : require(dep)));
  return mod.exports;
}

const { analyzeMorphemes, morphBreakdown, morphForms } = load('morphology');
const views = load('notebook-views');

const labels = (w, ety) => analyzeMorphemes(w, ety).map((m) => m.label);
const has = (w, label) => labels(w).includes(label);
const split = (w) => morphBreakdown(w).join('·');

// facere "make, do" in all its spellings; infect is in- + facere, like perfect and efficient.
for (const w of ['factory', 'fact', 'effect', 'infect', 'infection', 'efficient', 'perfect', 'difficult', 'sufficient', 'benefit', 'profit', 'official', 'significant', 'specific', 'artificial', 'sacrifice', 'manufacture', 'feature', 'defeat', 'counterfeit']) {
  assert.ok(has(w, 'fac'), `${w} is in the fac family: ${labels(w)}`);
}
assert.equal(morphForms('root', 'fac'), 'fac · fic · fec · fect');
assert.equal(analyzeMorphemes('infect').find((m) => m.label === 'fac').forms, 'fac · fic · fec · fect');
assert.equal(split('infect'), 'in·fect');
assert.equal(split('significant'), 'sign·i·fic·ant');
assert.equal(split('manufacture'), 'manu·fact·ure');
// facies "face", fingere "shape" and fari "speak" look like facere and are not.
for (const w of ['face', 'surface', 'interface', 'superficial', 'facial', 'fiction', 'preface', 'traffic', 'feather']) {
  assert.ok(!has(w, 'fac'), `${w} is not facere: ${labels(w)}`);
}

// Assimilated prefixes: ob- before c, f and p; ad- before its doubled consonant.
for (const w of ['obtain', 'observe', 'obstacle', 'obvious', 'object', 'occur', 'occasion', 'occupy', 'offer', 'offend', 'oppose', 'opponent', 'oppress', 'opportunity']) {
  assert.ok(has(w, 'ob-'), `${w} has ob-: ${labels(w)}`);
}
for (const w of ['official', 'office', 'operate', 'opinion', 'option', 'ocean', 'open', 'offspring', 'offset', 'opaque']) {
  assert.ok(!has(w, 'ob-'), `${w} has no ob-: ${labels(w)}`);
}
assert.equal(morphForms('prefix', 'ob-'), 'ob- · oc- · of- · op-');
for (const w of ['accept', 'affect', 'aggressive', 'allocate', 'announce', 'appear', 'arrange', 'assist', 'attract', 'admit', 'adjust']) {
  assert.ok(has(w, 'ad-'), `${w} has ad-: ${labels(w)}`);
}
for (const w of ['acid', 'apple', 'attitude', 'advantage', 'annual', 'afford', 'arrow', 'assassinate']) {
  assert.ok(!has(w, 'ad-'), `${w} has no ad-: ${labels(w)}`);
}
for (const w of ['illegal', 'immigrant', 'impossible', 'irregular']) assert.ok(has(w, 'in-'), `${w} has in-`);
for (const w of ['imagine', 'illness', 'inferior', 'irritate', 'inside']) assert.ok(!has(w, 'in-'), `${w} has no in-: ${labels(w)}`);
for (const w of ['collect', 'correct', 'commit', 'compose', 'construct', 'cooperate']) assert.ok(has(w, 'con-'), `${w} has con-`);
for (const w of ['column', 'collar', 'comma', 'coast']) assert.ok(!has(w, 'con-'), `${w} has no con-: ${labels(w)}`);
for (const w of ['effort', 'efficient', 'evident', 'educate', 'emit']) assert.ok(has(w, 'ex-'), `${w} has ex-`);
for (const w of ['eager', 'eagle', 'eastern', 'electric', 'estate', 'everyday']) assert.ok(!has(w, 'ex-'), `${w} has no ex-: ${labels(w)}`);
for (const w of ['success', 'suffer', 'suggest', 'support', 'suspend']) assert.ok(has(w, 'sub-'), `${w} has sub-`);

// Root allomorphs, and the words that only look like them.
for (const w of ['accept', 'concept', 'receive', 'deceive', 'capture', 'capable', 'principle', 'participate', 'anticipate', 'occupy']) {
  assert.ok(has(w, 'cap'), `${w} is capere: ${labels(w)}`);
}
for (const w of ['capital', 'captain', 'cape', 'escape', 'handicap', 'reciprocal']) assert.ok(!has(w, 'cap'), `${w} is not capere: ${labels(w)}`);
for (const w of ['contain', 'obtain', 'retain', 'sustain', 'maintain', 'continue', 'content', 'tenant', 'retention']) {
  assert.ok(has(w, 'ten'), `${w} is tenere: ${labels(w)}`);
}
for (const w of ['certain', 'attain', 'curtain', 'fountain', 'captain', 'distinct', 'extinguish', 'tiny', 'attention']) {
  assert.ok(!has(w, 'ten'), `${w} is not tenere: ${labels(w)}`);
}
for (const w of ['admit', 'mission', 'dismiss', 'permit', 'promise', 'emit', 'intermittent']) assert.ok(has(w, 'mit'), `${w} is mittere: ${labels(w)}`);
for (const w of ['limit', 'summit', 'imitate', 'missing', 'smith']) assert.ok(!has(w, 'mit'), `${w} is not mittere: ${labels(w)}`);
for (const w of ['mission', 'missile']) assert.ok(!has(w, 'mis-'), `${w} has no mis-`);
assert.ok(!has('person', 'per-') && !has('personal', 'son'));

// Look-alikes found in a real notebook.
for (const [w, part] of [['alum', 'luc'], ['metamorphosis', 'am'], ['attenuated', 'ten'], ['capstone', 'cap'], ['dismantle', 'man'], ['estrus', 'struct'], ['utensil', 'tend'], ['forensic', 'fore-'], ['mandible', 'mand'], ['triumphant', 'tri-'], ['voluptuous', 'vol'], ['anomaly', 'nom'], ['diffeomorphism', 'dis-']]) {
  assert.ok(!has(w, part), `${w} is not ${part}: ${labels(w)}`);
}

// Found in blind samples of 考研 checked against Wiktionary.
const wrong = [
  ['massacre', 'sacr'], ['distinguish', 'tact'], ['extinguish', 'tact'], ['reluctant', 'luc'], ['aluminum', 'luc'],
  ['illuminate', 'nat'], ['senate', 'nat'], ['senator', 'nat'], ['stitch', 'sta'], ['juvenile', 'ven'], ['unless', 'un-'],
  ['undergo', 'un-'], ['contrast', 'con-'], ['contrary', 'con-'], ['contract', 'contra-'], ['contribute', 'contra-'],
  ['enlighten', 'lect'], ['astronomy', 'nom'], ['economy', 'nom'], ['latent', 'tend'], ['cruel', 'cresc'],
  ['foremost', 'fore-'], ['periodical', 'dict'], ['adjust', 'jur'], ['allege', 'ad-'],
];
for (const [w, part] of wrong) assert.ok(!has(w, part), `${w} is not ${part}: ${labels(w)}`);
const right = [
  ['contrast', 'contra-'], ['contrary', 'contra-'], ['contradict', 'contra-'], ['contract', 'con-'], ['contract', 'tract'],
  ['undergo', 'under-'], ['receipt', 'cap'], ['intelligent', 'inter-'], ['intelligent', 'lect'], ['intellect', 'lect'],
  ['denote', 'not'], ['annotate', 'not'], ['revelation', 'vel'], ['reveal', 'vel'], ['purpose', 'pro-'], ['purpose', 'pon'],
  ['international', 'nat'], ['illuminate', 'luc'], ['recruit', 'cresc'], ['synonym', 'nom'],
];
for (const [w, part] of right) assert.ok(has(w, part), `${w} has ${part}: ${labels(w)}`);
assert.equal(split('contrary'), 'contra·ry', 'a suffix does not start inside the prefix');

// A word part by its label or any spelling, for pages about one part.
const { morphEntry } = load('morphology');
assert.deepEqual(morphEntry('oc-'), { kind: 'prefix', key: 'ob-', gloss: 'against, toward', origin: 'Latin', forms: ['ob-', 'oc-', 'of-', 'op-'] });
assert.equal(morphEntry('fect').key, 'fac');
assert.deepEqual(morphEntry('fac').forms.slice(0, 4), ['fac', 'fic', 'fec', 'fect']);
assert.equal(morphEntry('ceive').key, 'cap');
assert.equal(morphEntry('-tion').key, '-sion');
assert.equal(morphEntry('zzz'), null);

// The etymology cache: a Germanic word drops its Latin parts, and a root whose PIE root
// differs from the word's is dropped.
assert.ok(has('defeat', 'fac'));
assert.deepEqual(labels('offend', { origin: 'Old English', roots: [] }), []);
assert.ok(!labels('infect', { origin: 'Latin', roots: ['*deyǵʰ-'] }).includes('fac'));
assert.ok(labels('infect', { origin: 'Latin', roots: ['*dʰeh₁-'] }).includes('fac'));
assert.ok(labels('inspect', { origin: 'Latin', roots: ['*spek-'] }).includes('spect'), 'PIE spellings compare without diacritics');

// The whole 考研 book: how many words the map can place, and the size of a few families.
const book = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'wordbooks', 'kaoyan.json'), 'utf8'));
assert.equal(book.words.length, 4801);
const t0 = Date.now();
const a = views.analyzeNotebook(book.words.map((w, i) => ({ id: `k${i}`, lemma: w })), () => null);
const ms = Date.now() - t0;
const fam = (key) => a.families.find((f) => f.key === key);
const members = (key) => new Set((fam(key)?.ids || []).map((id) => a.words.get(id).entry.lemma));
const placed = new Set();
for (const f of a.families) if (f.kind === 'root' || f.kind === 'prefix') f.ids.forEach((id) => placed.add(id));
assert.ok(placed.size >= 1550, `words in a root or prefix family: ${placed.size}`);
assert.ok(members('prefix:ob-').size >= 34, `ob-: ${members('prefix:ob-').size}`);
for (const w of ['obtain', 'observe', 'obstacle', 'obvious', 'occasion', 'offer', 'oppose']) assert.ok(members('prefix:ob-').has(w), `ob- lists ${w}`);
assert.ok(!members('prefix:ob-').has('official'));
assert.ok(members('root:fac').size >= 45, `fac: ${members('root:fac').size}`);
for (const w of ['effect', 'infect', 'efficient', 'sufficient', 'manufacture', 'benefit']) assert.ok(members('root:fac').has(w), `fac lists ${w}`);
for (const w of ['interface', 'superficial', 'preface', 'fiction', 'traffic']) assert.ok(!members('root:fac').has(w), `fac leaves out ${w}`);
assert.equal(fam('root:fac').forms, 'fac · fic · fec · fect');
assert.ok(members('prefix:ad-').size >= 130, `ad-: ${members('prefix:ad-').size}`);
assert.ok(ms < 3000, `analysis of 4,801 words took ${ms} ms`);

// The map holds every connected word of the book (it once stopped at 220), and a morpheme
// lists all of its words.
const t1 = Date.now();
const md = views.notebookMapData(a, ['root', 'prefix', 'char']);
const layoutMs = Date.now() - t1;
const mapWords = md.nodes.filter((p) => p.k === 'word');
assert.equal(md.total, 4801);
assert.ok(mapWords.length >= 2500, `words on the map: ${mapWords.length}`);
const ob = md.nodes.findIndex((p) => p.id === 'prefix:ob-');
assert.ok(ob >= 0, 'ob- is on the map');
assert.equal(md.edges.filter(([x]) => x === ob).length, members('prefix:ob-').size, 'every ob- word is joined to ob-');
assert.equal(md.nodes[md.nodes.findIndex((p) => p.id === 'root:fac')].f, 'fac · fic · fec · fect');
assert.ok(md.nodes.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));
assert.ok(layoutMs < 3000, `layout of the book took ${layoutMs} ms`);
assert.deepEqual(views.findMapWords(md, 'obtains', 1).map((p) => p.l), ['obtain']);
// Without WebGL the flat map draws a readable subset: the largest parts and up to 220 words.
const flat = views.flatMapData(md);
assert.ok(flat.nodes.filter((p) => p.k === 'word').length <= 220 && flat.nodes.filter((p) => p.k !== 'word').length <= 48);
assert.ok(flat.edges.every(([x, y], k) => {
  const e = md.edges[flat.edgeIds[k]];
  return e && md.nodes[e[0]].id === flat.nodes[x].id && md.nodes[e[1]].id === flat.nodes[y].id;
}), 'each flat edge names its edge on the full map');
assert.ok(flat.nodes.every((p) => p.z === 0 && Number.isFinite(p.x) && Number.isFinite(p.y)));

// When a Families trace refines a few words, the map keeps every earlier node where it was.
const traced = views.analyzeNotebook(book.words.map((w, i) => ({ id: `k${i}`, lemma: w })), (l) => (l === 'offend' || l === 'oppose' ? { origin: 'Old English', roots: [] } : null));
const md2 = views.notebookMapData(traced, ['root', 'prefix', 'char']);
assert.notEqual(md2.sig, md.sig, 'the graph changed');
assert.equal(md2.from, md.sig, 'laid out from the earlier map');
const before = new Map(md.nodes.map((p) => [p.id, p]));
const moved = md2.nodes.filter((p) => before.has(p.id) && (before.get(p.id).x !== p.x || before.get(p.id).y !== p.y || before.get(p.id).z !== p.z));
assert.equal(moved.length, 0, `nodes moved: ${moved.slice(0, 5).map((p) => p.l)}`);

// Word parts are found by any spelling, with or without the hyphen, and listed first.
for (const q of ['ob-', 'ob', 'oc-', 'op']) assert.equal(views.findMapWords(md, q, 1)[0]?.id, 'prefix:ob-', `"${q}" finds ob-`);
for (const q of ['fac', 'fect', 'fic']) assert.equal(views.findMapWords(md, q, 1)[0]?.id, 'root:fac', `"${q}" finds fac`);
assert.equal(views.findMapWords(md, 'fac')[1].k, 'word', 'words follow the part');

console.log(`morphology: ok (考研: ${placed.size} of 4801 words in a root or prefix family, ${ms} ms; ${mapWords.length} words on the map, laid out in ${layoutMs} ms)`);
