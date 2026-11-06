/**
 * Translating a scanned picture in place (packages/core/src/ocr-translate.ts): paragraphs as the
 * units of translation, the area each may fill, line breaking and shrink-to-fit reflow, and the
 * run that translates units a few at a time.
 *
 * The pages are the saved engine outputs in scripts/fixtures/ocr-layout (see test-ocr-layout.js).
 * Run: node scripts/test-ocr-translate.js
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
const T = load('packages/core/src/ocr-translate.ts', { './ocr-layout': L });
const FIX = path.join(__dirname, 'fixtures', 'ocr-layout');
const PAGES = ['web', 'columns', 'photo', 'slide', 'mixed', 'vertical'];

let failures = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch((e) => {
      failures++;
      console.error(`not ok - ${name}\n  ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e}`);
    });
}

const page = (name, engine) => L.buildOcrPage(JSON.parse(fs.readFileSync(path.join(FIX, `${name}.${engine}.json`), 'utf8')));

/** A point in a unit's own frame: along the text and down it. */
function local(unit, p) {
  const { x, y, angle } = unit.area;
  const dx = p[0] - x, dy = p[1] - y;
  return [dx * Math.cos(angle) + dy * Math.sin(angle), -dx * Math.sin(angle) + dy * Math.cos(angle)];
}

const units = {};
for (const name of PAGES) for (const engine of ['ppocr', 'rapid']) units[`${name}.${engine}`] = T.translationUnits(page(name, engine));

(async () => {
  await test('units cover every line once, in reading order, and on these pages are exactly the paragraphs', () => {
    for (const name of PAGES) {
      for (const engine of ['ppocr', 'rapid']) {
        const p = page(name, engine);
        const us = units[`${name}.${engine}`];
        assert.deepStrictEqual(us.flatMap((u) => u.lineIds), L.pageLines(p).map((l) => l.id), `${name}.${engine}`);
        const paras = p.blocks.flatMap((b) => b.paragraphs).filter((x) => x.lines.length);
        assert.strictEqual(us.length, paras.length, `${name}.${engine}`);
        const hy = L.pageHyphenated(p);
        paras.forEach((para, i) => {
          assert.strictEqual(us[i].text, L.paragraphText(para, undefined, hy));
          assert.strictEqual(us[i].index, i);
        });
        // Joined like Copy all, so an untranslated page copies the same either way.
        assert.strictEqual(T.translatedPageText(us, us.map(() => ({ status: 'pending' }))), L.ocrPageText(p));
      }
    }
  });

  const raw = (lines) => ({ width: 1280, height: 1280, engine: 't', lines });
  const box = (text, x0, y, w, h) => ({ text, quad: [[x0, y], [x0 + w, y], [x0 + w, y + h], [x0, y + h]], confidence: 0.99 });
  const col = (text, x, y, w) => ({ text, quad: [[x + w, y], [x + w, y + [...text].length * w], [x, y + [...text].length * w], [x, y]], confidence: 0.99 });

  await test('a sentence the layout cut in two is one unit; a finished sentence is not joined', () => {
    // The reveal.js demo slide, centred: the layout ends a paragraph at "show you".
    const texts = ['reveal.js enables you to create beautiful interactive slide', 'decks using HTML. This presentation will show you', 'examples of what it can do.'];
    const p = L.buildOcrPage(raw([box('HELLO THERE', 447, 245, 386, 58), ...texts.map((t, i) => box(t, 640 - t.length * 5, 330 + i * 46, t.length * 10, 30))]));
    const us = T.translationUnits(p);
    assert.strictEqual(us.length, 2, JSON.stringify(us.map((u) => u.text)));
    assert.strictEqual(us[1].text, texts.join(' '));
    assert.strictEqual(us[1].align, 'center');
    assert.strictEqual(us[0].align, 'center', 'the one-line title on the middle of the slide stays centred');
    // Two paragraphs, the first ending its sentence: two units, as the layout made them.
    const two = L.buildOcrPage(raw([box('The first paragraph ends here.', 100, 100, 300, 30), box('the second starts in lower case.', 160, 300, 320, 30)]));
    assert.strictEqual(T.translationUnits(two).length, two.blocks.flatMap((b) => b.paragraphs).length);
  });

  await test('an unpunctuated CJK list (a menu board) is translated item by item; CJK prose is not split', () => {
    const menu = L.buildOcrPage(raw([col('明太子炸虾厚吐司', 700, 200, 60), col('日式厚切山型吐司', 630, 200, 60), col('黑松露炸薯条', 560, 200, 60)]));
    const us = T.translationUnits(menu);
    assert.deepStrictEqual(us.map((u) => u.text), ['明太子炸虾厚吐司', '日式厚切山型吐司', '黑松露炸薯条']);
    assert.ok(us.every((u) => u.vertical));
    for (const engine of ['ppocr', 'rapid']) {
      const prose = units[`vertical.${engine}`];
      assert.ok(prose.some((u) => u.lineIds.length > 1), `${engine}: prose columns stay together`);
    }
  });

  await test('a unit keeps the lines of one paragraph together (whole truth paragraphs come out as one unit)', () => {
    const truth = JSON.parse(fs.readFileSync(path.join(FIX, 'truth.json'), 'utf8'));
    const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
    for (const name of ['columns', 'photo', 'mixed']) {
      const got = units[`${name}.rapid`].map((u) => norm(u.text));
      const whole = truth[name].filter((p) => got.includes(norm(p))).length;
      assert.ok(whole >= truth[name].length - 1, `${name}: ${whole} of ${truth[name].length} paragraphs whole`);
    }
  });

  await test('the area covers every line of its unit, in the text direction, also on a photo at an angle', () => {
    for (const [key, us] of Object.entries(units)) {
      const p = page(...key.split('.'));
      const byId = new Map(L.pageLines(p).map((l) => [l.id, l]));
      for (const u of us) {
        for (const id of u.lineIds) {
          for (const pt of byId.get(id).quad) {
            const [a, b] = local(u, pt);
            assert.ok(a >= -0.5 && a <= u.area.w + 0.5 && b >= -0.5 && b <= u.area.h + 0.5, `${key} unit ${u.index}: ${a},${b} outside ${u.area.w}x${u.area.h}`);
          }
        }
      }
    }
    const tilted = units['photo.rapid'].filter((u) => Math.abs(u.area.angle) > 0.02);
    assert.ok(tilted.length >= 3, 'the photographed page is turned');
    // Turned with the text, the area is about as tall as its lines, not the whole slanted box.
    for (const u of tilted) assert.ok(u.area.h < u.pitch * (u.lineIds.length + 1), `unit ${u.index} is ${u.area.h} tall for ${u.lineIds.length} lines`);
  });

  await test('areas of different paragraphs do not overlap', () => {
    for (const [key, us] of Object.entries(units)) {
      for (let i = 0; i < us.length; i++) {
        for (let j = i + 1; j < us.length; j++) {
          const a = us[i].area, b = us[j].area;
          if (Math.abs(a.angle) > 0.02 || Math.abs(b.angle) > 0.02) continue;
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          const over = ox > 0 && oy > 0 ? ox * oy : 0;
          assert.ok(over <= 0.05 * Math.min(a.w * a.h, b.w * b.h), `${key}: units ${i} and ${j} overlap`);
        }
      }
    }
  });

  await test('vertical Chinese stays vertical; size and pitch come from the lines', () => {
    for (const engine of ['ppocr', 'rapid']) {
      const us = units[`vertical.${engine}`];
      assert.ok(us.length >= 2 && us.every((u) => u.vertical && u.area.angle === 0), engine);
      for (const u of us) assert.ok(u.size > 8 && u.pitch >= u.size * 1.15 && u.pitch <= u.size * 1.8);
    }
    for (const u of units['web.rapid']) assert.ok(!u.vertical && u.size > 4 && u.pitch >= u.size * 1.15 && u.pitch <= u.size * 1.8);
  });

  await test('a group whose area would cover another unit\'s text is painted line by line', () => {
    // As on the photographed chalkboard: "Enoki" and "wagyu cubes" joined, "Mushroom" between them.
    const ln = (id, text, x, y, w, h) => ({ id, text, quad: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], angle: 0, size: h, words: [], vertical: false, joins: [], estimated: true });
    const pg = {
      width: 1280, height: 960, engine: 't', angle: 0,
      blocks: [
        { paragraphs: [{ lines: [ln(0, 'Enoki', 397, 363, 180, 71), ln(1, 'wagyu cubes', 386, 424, 382, 88)] }] },
        { paragraphs: [{ lines: [ln(2, 'Mushroom', 566, 367, 255, 61)] }] },
      ],
    };
    assert.deepStrictEqual(T.translationUnits(pg).map((u) => u.text), ['Enoki', 'wagyu cubes', 'Mushroom']);
  });

  await test('text boxes of neighbouring columns do not overlap even where the engine boxes do', () => {
    // Two menu columns whose boxes share 17 px, as on the vertical chalkboard menu.
    const pg = L.buildOcrPage(raw([col('明太子炸虾厚吐司', 717, 200, 78), col('黑松露炸薯条', 778, 200, 81)]));
    const us = T.translationUnits(pg);
    assert.strictEqual(us.length, 2);
    const [a, b] = us.map((u) => u.box).sort((p, q) => p.x - q.x);
    assert.ok(a.x + a.w <= b.x + 0.01, `${a.x + a.w} > ${b.x}`);
    for (const u of us) assert.ok(u.box.w < u.area.w && u.box.x >= u.area.x && u.box.x + u.box.w <= u.area.x + u.area.w + 0.01);
    // English set sideways in the trimmed box stays inside it.
    for (const u of us) {
      const f = T.reflow('Black truffle fried potato sticks with sea salt', u, 'en', T.roughMeasure);
      assert.ok(f.vertical && (f.lines.length - 1) * f.pitch + f.size <= u.box.w + 0.5);
    }
  });

  await test('a left-aligned paragraph is not taken for centred', () => {
    const texts = ['A river does most of its work during floods. When the water', 'rises, it carries sand and gravel that scrape the bed and', 'widen the banks.'];
    const l = T.translationUnits(L.buildOcrPage(raw(texts.map((t, i) => box(t, 160, 330 + i * 46, t.length * 10, 30)))));
    assert.strictEqual(l.length, 1);
    assert.strictEqual(l[0].align, 'start');
  });

  await test('line breaks: spaces, CJK characters, and kinsoku punctuation', () => {
    assert.deepStrictEqual(T.breakTokens('Hello, big world.'), ['Hello, ', 'big ', 'world.']);
    assert.deepStrictEqual(T.breakTokens('你好，世界。'), ['你', '好，', '世', '界。']);
    assert.deepStrictEqual(T.breakTokens('「引用」文字'), ['「引', '用」', '文', '字']);
    assert.deepStrictEqual(T.breakTokens('使用Python编程'), ['使', '用', 'Python', '编', '程']);
    assert.deepStrictEqual(T.breakTokens('ATP和NADPH。'), ['ATP', '和', 'NADPH。']);
  });

  await test('wrapping fills lines greedily, never past the width, and loses no text', () => {
    const m = T.roughMeasure;
    const en = 'A river does most of its work during floods, when the water carries sand and gravel downstream.';
    const lines = T.wrapText(en, 200, 16, m);
    assert.ok(lines.length > 2);
    for (const ln of lines) assert.ok(m(ln, 16) <= 200 + 0.01, ln);
    assert.strictEqual(lines.join(' '), en);
    const zh = '植物利用阳光、水和二氧化碳制造葡萄糖，这个过程叫做光合作用。';
    const zl = T.wrapText(zh, 160, 16, m);
    assert.strictEqual(zl.join(''), zh);
    for (const ln of zl) assert.ok(m(ln, 16) <= 160 + 0.01 && !/^[，。、]/.test(ln), ln);
    // A word longer than a line is cut between its letters.
    const long = T.wrapText('Donaudampfschifffahrtsgesellschaft', 80, 16, m);
    assert.ok(long.length > 1 && long.join('') === 'Donaudampfschifffahrtsgesellschaft');
  });

  await test('reflow keeps the original size when the translation fits and shrinks it when it does not', () => {
    const m = T.roughMeasure;
    const unit = { area: { x: 0, y: 0, w: 400, h: 60, angle: 0 }, size: 18, pitch: 26, vertical: false };
    const short = T.reflow('Short line', unit, 'en', m);
    assert.strictEqual(short.size, 18);
    assert.deepStrictEqual(short.lines, ['Short line']);
    const long = T.reflow('A much longer translation that will not fit into two lines of this paragraph at the original size at all, so it shrinks.', unit, 'en', m);
    assert.ok(long.size < 18, 'shrinks');
    assert.ok((long.lines.length - 1) * long.pitch + long.size <= 60 + 0.5, 'fits down');
    for (const ln of long.lines) assert.ok(m(ln, long.size) <= 400 + 0.5, 'fits across');
    assert.ok(Math.abs(long.pitch / long.size - 26 / 18) < 1e-9, 'keeps the line spacing ratio');
    // English into a one-line Chinese heading's box: smaller, maybe two lines, never outside.
    const oneLine = { area: { x: 0, y: 0, w: 120, h: 30, angle: 0 }, size: 22, pitch: 33, vertical: false };
    const f = T.reflow('Notes on photosynthesis', oneLine, 'en', m);
    assert.ok((f.lines.length - 1) * f.pitch + f.size <= 30.5 && f.lines.every((l) => m(l, f.size) <= 120.5));
    // A word wider than a narrow cell shrinks whole rather than being cut ("distribut / ed").
    const cell = { area: { x: 0, y: 0, w: 60, h: 40, angle: 0 }, size: 14, pitch: 20, vertical: false };
    const word = T.reflow('distributed', cell, 'en', m);
    assert.deepStrictEqual(word.lines, ['distributed']);
    assert.ok(word.size < 14 && m('distributed', word.size) <= 60.5);
  });

  await test('reflow fits every real paragraph translated to twice its length', () => {
    for (const [key, us] of Object.entries(units)) {
      for (const u of us) {
        const text = `${u.text} ${u.text}`;
        const f = T.reflow(text, u, 'en', T.roughMeasure);
        const along = f.vertical ? u.area.h : u.area.w, across = f.vertical ? u.area.w : u.area.h;
        if (f.size > Math.min(u.size, 4)) {
          assert.ok((f.lines.length - 1) * f.pitch + f.size <= across + 0.5, `${key} unit ${u.index} too tall`);
          assert.ok(f.lines.every((l) => T.roughMeasure(l, f.size) <= along + 0.5), `${key} unit ${u.index} too wide`);
        }
        assert.ok(f.size <= u.size);
      }
    }
  });

  await test('vertical text: set vertically into Chinese or Japanese, across into English unless the column is tall', () => {
    const col = { vertical: true, area: { x: 0, y: 0, w: 40, h: 400, angle: 0 } };
    const square = { vertical: true, area: { x: 0, y: 0, w: 300, h: 320, angle: 0 } };
    assert.strictEqual(T.flowsVertically(col, 'zh'), true);
    assert.strictEqual(T.flowsVertically(square, 'ja'), true);
    assert.strictEqual(T.flowsVertically(col, 'en'), true);
    assert.strictEqual(T.flowsVertically(square, 'en'), false);
    assert.strictEqual(T.flowsVertically({ vertical: false, area: col.area }, 'zh'), false);
    const u = units['vertical.rapid'][0];
    const f = T.reflow('春天来了，山上的雪慢慢融化。', u, 'zh-TW', T.roughMeasure);
    assert.ok(f.vertical);
    assert.ok((f.lines.length - 1) * f.pitch + f.size <= u.area.w + 0.5);
  });

  await test('language helpers: base codes, and text with nothing to translate', () => {
    assert.ok(T.sameLanguage('zh-CN', 'zh'));
    assert.ok(T.sameLanguage('en', 'EN-us'));
    assert.ok(!T.sameLanguage('ja', 'zh'));
    assert.ok(!T.sameLanguage('', ''));
    assert.ok(!T.hasWords('$12.50'));
    assert.ok(!T.hasWords('₱160 - 3.'));
    assert.ok(T.hasWords('炒饭'));
    assert.ok(T.hasWords('Tofu 25'));
  });

  const fakeSvc = (log, answers = {}) => ({
    detectLanguage: async (t) => (/[一-鿿]/.test(t) ? 'zh' : 'en'),
    resolveTargetLanguage: (src, req) => (req && req !== 'auto' ? req : src === 'en' ? 'zh' : 'en'),
    translateText: async (t, to, from) => {
      log.push({ t, to, from });
      return t in answers ? answers[t] : { text: `[${to}] ${t}` };
    },
  });

  await test('a unit already in the target language, or without words, is left alone', async () => {
    const log = [];
    const svc = fakeSvc(log, { 'Same here': { text: 'Same here' } });
    assert.deepStrictEqual(await T.translateUnit(svc, '光合作用', 'zh-CN'), { same: true, from: 'zh' });
    assert.deepStrictEqual(await T.translateUnit(svc, '₱160', 'zh'), { same: true, from: '' });
    assert.strictEqual(log.length, 0, 'no engine asked');
    assert.deepStrictEqual(await T.translateUnit(svc, 'Plain rice', 'zh'), { text: '[zh] Plain rice', from: 'en' });
    assert.deepStrictEqual(log[0], { t: 'Plain rice', to: 'zh', from: 'en' });
    assert.deepStrictEqual(await T.translateUnit(svc, 'Same here', 'zh'), { same: true, from: 'en' });
    assert.strictEqual(await T.translateUnit(fakeSvc([], { Lost: null }), 'Lost', 'zh'), null);
  });

  await test('the page target: the setting, or the usual pairing for the page language', async () => {
    const svc = fakeSvc([]);
    assert.strictEqual(await T.pageTarget(svc, 'An English page', 'auto'), 'zh');
    assert.strictEqual(await T.pageTarget(svc, '中文页面', 'auto'), 'en');
    assert.strictEqual(await T.pageTarget(svc, '中文页面', 'ja'), 'ja');
  });

  await test('a page translates a few units at a time, reports each, asks once per text, and retries failures', async () => {
    let active = 0, peak = 0, calls = 0;
    const fail = new Set(['Gamma']);
    const fn = async (text, to) => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (fail.has(text)) return null;
      if (text === 'Delta') return { same: true, from: to };
      return { text: `${text}!`, from: 'en' };
    };
    const texts = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Alpha', 'Epsilon', 'Zeta', 'Eta', 'Theta', '42'];
    const us = texts.map((text, index) => ({ index, text, lineIds: [index], area: { x: 0, y: 0, w: 1, h: 1, angle: 0 }, vertical: false, size: 1, pitch: 1, align: 'start' }));
    const seen = [];
    const run = new T.PageTranslation(us, 'xx-test', fn, (i) => seen.push(i));
    assert.strictEqual(run.states[9].status, 'same', 'a number is never sent');
    await run.run();
    assert.ok(peak <= T.PARALLEL, `at most ${T.PARALLEL} at once (saw ${peak})`);
    assert.strictEqual(calls, 8, 'Alpha asked once');
    assert.strictEqual(run.pending, 0);
    assert.strictEqual(run.failed, 1);
    assert.strictEqual(run.states[2].status, 'failed');
    assert.strictEqual(run.states[3].status, 'same');
    assert.deepStrictEqual(run.states[4], { status: 'done', text: 'Alpha!', from: 'en' });
    assert.strictEqual(new Set(seen).size, 9);
    assert.strictEqual(T.translatedPageText(us, run.states).split('\n')[2], 'Gamma', 'a failed unit copies as its original');
    fail.clear();
    await run.retry();
    assert.strictEqual(run.failed, 0);
    assert.deepStrictEqual(run.states[2], { status: 'done', text: 'Gamma!', from: 'en' });
    assert.strictEqual(T.translatedPageText(us, run.states), 'Alpha!\nBeta!\nGamma!\nDelta\nAlpha!\nEpsilon!\nZeta!\nEta!\nTheta!\n42');
  });

  await test('stopping a run leaves the rest pending', async () => {
    const us = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((text, index) => ({ index, text, lineIds: [index], area: { x: 0, y: 0, w: 1, h: 1, angle: 0 }, vertical: false, size: 1, pitch: 1, align: 'start' }));
    let run;
    const fn = async (text) => {
      await new Promise((r) => setTimeout(r, 5));
      return { text: text.toUpperCase(), from: 'en' };
    };
    run = new T.PageTranslation(us, 'stop-test', fn, () => run.stop(), 1);
    await run.run();
    assert.strictEqual(run.done, 1);
    assert.strictEqual(run.pending, 5);
  });

  if (failures) {
    console.error(`\n${failures} failed`);
    process.exit(1);
  }
  console.log('\nocr-translate: all passed');
})();
