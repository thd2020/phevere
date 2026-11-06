/**
 * Layout analysis for whole-image OCR (packages/core/src/ocr-layout.ts) and the PP-OCR word
 * boxes from CTC time steps (src/services/ocr-page-onnx.ts).
 *
 * The fixtures are real engine outputs saved from six rendered pages (a web page, a two-column
 * essay, a page photographed at an angle, a slide, mixed Chinese and English, vertical Chinese):
 * `*.ppocr.json` from Phevere's PP-OCRv4 reader, `*.rapid.json` from RapidOCR 3 with word boxes.
 * `truth.json` holds each page's paragraphs in reading order.
 * Run: node scripts/test-ocr-layout.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function load(file, extra = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (id) => extra[id] || require(id));
  return mod.exports;
}

const L = load('packages/core/src/ocr-layout.ts');
const P = load('src/services/ocr-page-onnx.ts', { '@phevere/core/ocr-layout': L });
const FIX = path.join(__dirname, 'fixtures', 'ocr-layout');
const truth = JSON.parse(fs.readFileSync(path.join(FIX, 'truth.json'), 'utf8'));

// Words in order: Han characters one by one, other letters and digits as words.
const tok = (s) => (s.match(/\p{Script=Han}|[^\p{Script=Han}\P{L}]+|\p{N}+/gu) || []).map((w) => w.toLowerCase());
function lcs(a, b) {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Share of truth words found in the same order, truth paragraphs found whole, and paragraph order. */
function score(name, out) {
  const paras = truth[name];
  const gt = tok(paras.join(' '));
  const words = lcs(gt, tok(out.join(' '))) / gt.length;
  const best = paras.map((p) => {
    const t = tok(p);
    let bi = -1, bs = 0;
    out.forEach((o, i) => {
      const s = lcs(t, tok(o)) / Math.max(t.length, tok(o).length);
      if (s > bs) { bs = s; bi = i; }
    });
    return { bi, bs };
  });
  const whole = best.filter((b) => b.bs >= 0.8).length;
  let ordered = 0;
  for (let i = 1; i < best.length; i++) if (best[i].bi > best[i - 1].bi) ordered++;
  return { words, whole, ordered, paras: paras.length };
}

// 1. Saved engine outputs: reading order and paragraphs on every page, for both engines.
for (const engine of ['ppocr', 'rapid']) {
  let whole = 0, total = 0;
  for (const name of Object.keys(truth)) {
    const raw = JSON.parse(fs.readFileSync(path.join(FIX, `${name}.${engine}.json`), 'utf8'));
    const page = L.buildOcrPage(raw);
    const out = L.ocrPageText(page).split('\n');
    const s = score(name, out);
    assert.ok(s.words >= 0.98, `${engine} ${name}: ${(s.words * 100).toFixed(1)}% of words in reading order`);
    assert.strictEqual(s.ordered, s.paras - 1, `${engine} ${name}: paragraphs out of order`);
    whole += s.whole;
    total += s.paras;
  }
  assert.ok(whole >= total - 1, `${engine}: ${whole}/${total} paragraphs found whole`);
}

// 2. Two columns: the left column is read to its end before the right one starts.
{
  const page = L.buildOcrPage(JSON.parse(fs.readFileSync(path.join(FIX, 'columns.ppocr.json'), 'utf8')));
  const text = L.ocrPageText(page);
  assert.ok(text.indexOf('valley floor') < text.indexOf('They are also sensitive'), 'left column first');
  assert.ok(text.includes('Neither partner could survive alone on bare stone'), 'a wrapped sentence reads whole');
}

// 3. A page photographed at an angle: deskewed, title and three paragraphs.
{
  const page = L.buildOcrPage(JSON.parse(fs.readFileSync(path.join(FIX, 'photo.ppocr.json'), 'utf8')));
  assert.ok(Math.abs((page.angle * 180) / Math.PI + 5.8) < 1.5, `page angle ${(page.angle * 180) / Math.PI}`);
  const paras = L.ocrPageText(page).split('\n');
  assert.strictEqual(paras.length, 4);
  assert.strictEqual(paras[0], 'Chapter Three: The Lighthouse Keeper');
}

// 4. Vertical Chinese: columns right to left, each top to bottom, glyphs upright.
for (const engine of ['ppocr', 'rapid']) {
  const page = L.buildOcrPage(JSON.parse(fs.readFileSync(path.join(FIX, `vertical.${engine}.json`), 'utf8')));
  const text = L.ocrPageText(page);
  assert.ok(text.startsWith('春天来了'), `${engine}: ${text.slice(0, 10)}`);
  assert.ok(text.includes('河边放风筝'), `${engine}: a column carries on into the next`);
  assert.ok(L.pageLines(page).every((l) => l.vertical), `${engine}: lines are vertical`);
}

// 5. Text the engine was unsure about stays.
{
  const raw = JSON.parse(fs.readFileSync(path.join(FIX, 'web.ppocr.json'), 'utf8'));
  raw.lines[0].confidence = 0.31;
  raw.lines[0].words.forEach((w) => (w.confidence = 0.31));
  const page = L.buildOcrPage(raw);
  const line = L.pageLines(page).find((l) => l.text === raw.lines[0].text);
  assert.ok(line, 'unsure line kept');
  assert.ok(line.words.every((w) => L.isUnsure(w.confidence)));
  assert.ok(!L.isUnsure(0) && !L.isUnsure(undefined) && !L.isUnsure(0.9), 'no score means not unsure');
}

// Synthetic pages for the rules on their own.
const box = (x, y, w, h) => L.rectQuad(x, y, w, h);
const line = (text, x, y, w, h = 20, extra = {}) => ({ text, quad: box(x, y, w, h), ...extra });
const textOf = (lines, width = 1000, height = 1000) => L.ocrPageText(L.buildOcrPage({ width, height, engine: 'test', lines }));

// 6. Hyphenated line ends rejoin, unless the page spells the compound with its hyphen.
assert.strictEqual(textOf([line('the exam-', 0, 0, 180), line('ple shows it', 0, 26, 240)]), 'the example shows it');
assert.strictEqual(
  textOf([line('a well-known fact and a well-', 0, 0, 560), line('known name here', 0, 26, 300)]),
  'a well-known fact and a well-known name here',
);
assert.strictEqual(textOf([line('ends with Paris-', 0, 0, 300), line('Lyon trains', 0, 26, 220)]), 'ends with Paris- Lyon trains');

// 7. Fragments of one line join; a column gutter keeps them apart.
assert.strictEqual(textOf([line('left part', 0, 0, 200), line('right part', 220, 1, 200)]), 'left part right part');
{
  const lines = [];
  for (let i = 0; i < 6; i++) {
    lines.push(line(`left column line ${i} continues`, 0, i * 26, 400));
    lines.push(line(`right column line ${i} continues`, 440, i * 26, 400));
  }
  const out = textOf(lines).split('\n');
  assert.strictEqual(out.length, 2, out.join(' / '));
  assert.ok(out[0].startsWith('left column line 0') && out[0].endsWith('line 5 continues'));
  assert.ok(out[1].startsWith('right column line 0'));
}

// 8. Paragraphs: extra spacing, first-line indent, list marks, short sentence end.
assert.deepStrictEqual(
  textOf([line('First paragraph runs across the', 0, 0, 500), line('whole width here.', 0, 26, 260), line('Second starts after a gap and', 0, 70, 500), line('ends here.', 0, 96, 160)]).split('\n'),
  ['First paragraph runs across the whole width here.', 'Second starts after a gap and ends here.'],
);
assert.deepStrictEqual(
  textOf([line('• apples are red', 0, 0, 260), line('• pears are green', 0, 26, 270), line('• plums are purple', 0, 52, 280)]).split('\n'),
  ['• apples are red', '• pears are green', '• plums are purple'],
);
assert.deepStrictEqual(
  textOf([line('one two three four five six seven', 0, 0, 520), line('eight nine ten.', 0, 26, 200), line('Eleven twelve thirteen fourteen fifteen', 30, 52, 490), line('sixteen seventeen eighteen nineteen', 0, 78, 520)]).split('\n'),
  ['one two three four five six seven eight nine ten.', 'Eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'],
);

// 9. Reading order: a full-width title, two columns, a full-width footer after a wide gap.
{
  const out = textOf([
    line('A Title Across The Page', 200, 0, 600, 34),
    line('left one', 0, 60, 380), line('left two', 0, 86, 380),
    line('right one', 440, 60, 380), line('right two', 440, 86, 380),
    line('footer text at the bottom', 0, 300, 400, 16),
  ]).split('\n');
  assert.deepStrictEqual(out, ['A Title Across The Page', 'left one left two', 'right one right two', 'footer text at the bottom']);
}

// 10. CJK lines join without spaces; CJK and Latin keep the engine's own spacing.
assert.strictEqual(textOf([line('植物利用阳光、水和二氧化碳制造', 0, 0, 600, 24), line('葡萄糖。', 0, 30, 160, 24)]), '植物利用阳光、水和二氧化碳制造葡萄糖。');
assert.strictEqual(L.lineJoin('the', 'next').sep, ' ');

// 11. Word separators come from the engine's line text; selection text joins like the page text.
{
  const page = L.buildOcrPage({
    width: 600, height: 100, engine: 'test',
    lines: [{
      text: 'Hello, world again',
      quad: box(0, 0, 300, 20),
      words: [
        { text: 'Hello,', quad: box(0, 0, 90, 20) },
        { text: 'world', quad: box(90, 0, 100, 20) },
        { text: 'again', quad: box(190, 0, 110, 20) },
      ],
    }],
  });
  const l = L.pageLines(page)[0];
  assert.strictEqual(l.text, 'Hello, world again');
  assert.deepStrictEqual(l.joins, [' ', ' ']);
  assert.strictEqual(L.ocrRangeText(page, { line: l.id, word: 1, offset: 1 }, { line: l.id, word: 2, offset: 3 }), 'orld aga');
  const edits = new Map([[l.id, 'Hello, there']]);
  assert.strictEqual(L.ocrPageText(page, edits), 'Hello, there');
}

// 12. Phone engines: word boxes as fractions with line numbers, and lines with quads and blocks.
{
  const raw = L.rawFromLegacyWords(
    [
      { t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.05, l: 1 },
      { t: 'there', x: 0.32, y: 0.1, w: 0.2, h: 0.05, l: 1 },
      { t: 'next', x: 0.1, y: 0.16, w: 0.15, h: 0.05, l: 2 },
    ],
    1000, 1000, 'mlkit',
  );
  assert.strictEqual(raw.lines.length, 2);
  assert.strictEqual(L.ocrPageText(L.buildOcrPage(raw)), 'Hello there next');
  const rapid = JSON.parse(fs.readFileSync(path.join(FIX, 'columns.rapid.json'), 'utf8'));
  const flat = (q) => q.flatMap((p) => [p[0] / rapid.width, p[1] / rapid.height]);
  const native = rapid.lines.map((ln) => ({ t: ln.text, q: flat(ln.quad), c: ln.confidence, w: (ln.words || []).map((w) => ({ t: w.text, q: flat(w.quad), c: w.confidence })) }));
  const fromNative = L.buildOcrPage(L.rawFromNativeLines(native, rapid.width, rapid.height, 'mlkit'));
  assert.strictEqual(L.ocrPageText(fromNative), L.ocrPageText(L.buildOcrPage(rapid)), 'normalised quads read the same');
}

// 13. PP-OCR word boxes from CTC time steps.
{
  const dict = ['a', 'b', 'c', ' '];
  // 10 steps x 5 classes (blank + dict): "ab c" with peaks at steps 1, 3, 5 (space), 7.
  const steps = 10, classes = 5;
  const data = new Float32Array(steps * classes);
  const peak = { 1: 1, 3: 2, 5: 4, 7: 3 };
  for (let t = 0; t < steps; t++) data[t * classes + (peak[t] || 0)] = 0.9;
  const chars = P.decodeCtc(data, steps, classes, dict);
  assert.strictEqual(chars.map((c) => c.ch).join(''), 'ab c');
  const words = P.ctcWords(chars, steps);
  assert.deepStrictEqual(words.map((w) => w.text), ['ab', 'c']);
  assert.ok(words[0].t1 <= words[1].t0 + 1e-9, 'word spans do not overlap');
  const horiz = P.readingQuad([[0, 0], [100, 0], [100, 20], [0, 20]]);
  assert.ok(!horiz.rotated);
  const vert = P.readingQuad([[0, 0], [20, 0], [20, 100], [0, 100]]);
  assert.ok(vert.rotated);
  assert.ok(Math.abs(L.quadAngle(vert.quad) - Math.PI / 2) < 1e-6, 'a tall crop reads downwards');
  // A one- or two-character guess over an icon or a texture is dropped; an unsure longer line stays.
  assert.ok(P.isSpeck('贝', 0.25) && P.isSpeck('# ', 0.05));
  assert.ok(!P.isSpeck('贝', 0.9) && !P.isSpeck('abilty t eproduce', 0.3) && !P.isSpeck('OK', undefined));
}

// 14. Text wrapping beside a picture and then below it is one paragraph; each line is measured
// against the margin of its own stretch, not the block's widest line.
{
  const words = 'river water flows down the valley and carries sand gravel and stones toward the sea while banks slowly widen over many years'.split(' ');
  const lines = [];
  let y = 0, k = 0;
  // Five lines beside a picture (wrapping near x 500), then four below it (near x 900).
  const take = (limit) => {
    const ws = [];
    while (ws.join(' ').length + words[k % words.length].length + 1 <= limit) ws.push(words[k++ % words.length]);
    return ws.join(' ');
  };
  for (let i = 0; i < 5; i++, y += 26) { const t = take(42); lines.push(line(t, 0, y, t.length * 11.5)); }
  for (let i = 0; i < 4; i++, y += 26) { const t = i === 3 ? 'the end.' : take(78); lines.push(line(t, 0, y, t.length * 11.5)); }
  const out = textOf(lines, 1000, 400).split('\n');
  assert.strictEqual(out.length, 1, out.join(' / '));
}

// 15. A table column of short CJK cells stays one cell per line: the next cell's first
// character would have fitted on the line before.
{
  const cells = ['分析', '烧嘴、火焰', '电导率', '密度', '电压（电动势）', '流量', '手动', '可燃气体和有毒气体'];
  const out = textOf(cells.map((c, i) => line(c, 0, i * 27, c.length * 16, 16)), 600, 300).split('\n');
  assert.deepStrictEqual(out, cells);
}

// 16. A footnote mark makes one line's box taller; the paragraph still reads whole.
assert.strictEqual(
  textOf([line('河流是陆地上自然流动的地表水[1]，绝大部分都是淡', 0, 0, 620, 27), line('水，但有些河流受到潮汐或风暴潮影响可能会成为半', 0, 27, 620, 20), line('咸水。', 0, 52, 60, 20)]),
  '河流是陆地上自然流动的地表水[1]，绝大部分都是淡水，但有些河流受到潮汐或风暴潮影响可能会成为半咸水。',
);

// 17. Bullets without a space (as CJK pages set them) start items; "3.5" at a line start does not.
assert.deepStrictEqual(
  textOf([line('·国务院关于部分节假日安排的通知', 0, 0, 400), line('·国务院关于修改部分行政法规的决定', 0, 30, 420), line('·中共中央关于若干重大问题的决定', 0, 60, 400)]).split('\n').length,
  3,
);
assert.strictEqual(
  textOf([line('the population grew from two to', 0, 0, 360), line('3.5 million people in that decade', 0, 26, 380)]),
  'the population grew from two to 3.5 million people in that decade',
);

// 18. A date set well apart from a CJK title gets a space; "2027年" in running text does not.
{
  const words = (spec) => spec.map(([t, x, w]) => ({ text: t, quad: box(x, 0, w, 20) }));
  const one = (ws) => L.pageLines(L.buildOcrPage({ width: 600, height: 40, engine: 'test', lines: [{ text: ws.map((w) => w.text).join(''), quad: box(0, 0, 400, 20), words: ws }] }))[0].text;
  assert.strictEqual(one(words([['通', 0, 16], ['知', 16, 16], ['2026-11-05', 52, 80]])), '通知 2026-11-05');
  assert.strictEqual(one(words([['于', 0, 16], ['2027', 17, 34], ['年', 52, 16]])), '于2027年');
}

// 19. Repainted lines: serif type (thick stems, thin cross strokes) is told from sans.
{
  const V = load('packages/core/src/ocr-view.ts', { './ocr-layout': L });
  // Letters drawn as a grid: stems `stem` px wide and cross bars `bar` px tall, 40 by 30 px.
  const glyphs = (stem, bar) => {
    const w = 40, h = 30, ink = new Array(w * h).fill(false);
    for (let y = 4; y < 26; y++) for (const x0 of [4, 20]) for (let x = x0; x < x0 + stem; x++) ink[y * w + x] = true;
    for (const y0 of [4, 14, 26 - bar]) for (let y = y0; y < y0 + bar; y++) for (let x = 4; x < 36; x++) if (x % 16 < 12) ink[y * w + x] = true;
    return [ink, w, h];
  };
  assert.ok(V.hasSerifs(...glyphs(4, 1)), 'thick stems and hairlines read as serif');
  assert.ok(!V.hasSerifs(...glyphs(3, 3)), 'even strokes read as sans');
  assert.ok(!V.hasSerifs(...glyphs(2, 1)), 'strokes too thin to tell stay sans');
}

console.log('test-ocr-layout: ok');
