/*
 * Run: node scripts/test-popup-sense-pictures.js
 * The desktop pop-up's sense pictures when words are looked up one after another. Runs the
 * pop-up's own functions from src/popup-new.html against a stand-in document, so no window opens.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const html = fs.readFileSync(path.join(__dirname, '../src/popup-new.html'), 'utf8');
const start = html.indexOf('<script>') + '<script>'.length;
const script = html.slice(start, html.indexOf('</script>', start));
const ast = ts.createSourceFile('popup.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

/** The source of a function declared anywhere in the pop-up's script. */
function fn(name) {
  let found = '';
  const visit = (node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === name) found = node.getText(ast);
    else ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found, `popup-new.html has no function ${name}`);
  return found;
}

const names = [
  'escapeHtml',
  'stripHtmlToText',
  'isUsablePopupDef',
  'popupSenseKey',
  'currentPopupSenseImages',
  'senseFigureHtml',
  'placePopupSenseFigures',
  'warmPictureHost',
  'loadPopupSenseImages',
];

function popup() {
  const head = { appendChild() {} };
  const document = {
    head,
    getElementById: () => null,
    createElement: () => ({ remove() {} }),
    // No sense list is painted; placing pictures only records that it was asked.
    querySelector: () => null,
  };
  const calls = [];
  const context = {
    document,
    window: {
      dictionaryAPI: {
        senseImages(word, senses, opts, onUpdate) {
          let resolve;
          const p = new Promise((r) => (resolve = r));
          calls.push({ word, onUpdate, resolve });
          return p;
        },
      },
    },
    console,
  };
  vm.createContext(context);
  vm.runInContext(
    `let settings = { senseImages: true }; let currentResult = null; let currentTab = 'lexicon';
     let popupSenseImages = null; let popupSenseImagesPending = '';
     ${names.map(fn).join('\n')}
     this.api = {
       show(result) { currentResult = result; },
       load: loadPopupSenseImages,
       current: currentPopupSenseImages,
     };`,
    context,
  );
  return { api: context.api, calls };
}

const result = (word) => ({ word, definitions: [{ partOfSpeech: 'noun', meaning: `a ${word}`, source: 'Wiktionary' }] });
const picture = (word) => [{ thumb: `https://thumb.wikimedia.org/${word}.jpg`, url: '', title: word, credit: 'CC0', pageUrl: `https://commons.wikimedia.org/wiki/File:${word}.jpg` }];
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  // Word A is looked up, then word B before A's pictures arrive. A's late pictures must not
  // replace B's, or the next repaint of B would drop B's pictures.
  {
    const { api, calls } = popup();
    const a = result('anchor');
    const b = result('meadow');
    api.show(a);
    const loadA = api.load(a);
    api.show(b);
    const loadB = api.load(b);
    assert.equal(calls.length, 2);
    calls[1].onUpdate(picture('meadow'));
    calls[1].resolve(picture('meadow'));
    await loadB;
    assert.equal(api.current(b)[0].title, 'meadow');
    calls[0].onUpdate(picture('anchor'));
    calls[0].resolve(picture('anchor'));
    await loadA;
    await tick();
    const shown = api.current(b);
    assert.ok(shown && shown[0] && shown[0].title === 'meadow', "a late answer for the previous word replaced the current word's pictures");
  }

  // The current word's own updates and final answer are kept.
  {
    const { api, calls } = popup();
    const a = result('lantern');
    api.show(a);
    const load = api.load(a);
    calls[0].onUpdate(picture('first'));
    assert.equal(api.current(a)[0].title, 'first');
    calls[0].resolve(picture('lantern'));
    await load;
    assert.equal(api.current(a)[0].title, 'lantern');
  }

  console.log('popup sense pictures ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
