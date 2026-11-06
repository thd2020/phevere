/*
 * Run: node scripts/test-hover-strip.js
 * Hover A, move away, hover B: the strip opens at B's word. Drives the real hover service,
 * the real placement code and the real strip handlers from src/index.ts against fake
 * windows and a fake two-monitor screen (100% and 150%), so no window ever opens.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const transpile = (code) =>
  ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

let now = 10_000;
const clock = { now: () => now };

// Two displays side by side: 1920x1080 at 100%, then 1920x1080 physical at 150% (1280x720 DIP).
const displays = [
  { id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { id: 2, scaleFactor: 1.5, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, workArea: { x: 1920, y: 0, width: 1280, height: 690 } },
];
const inside = (b, p) => p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
let cursor = { x: 0, y: 0 };
const screen = {
  getAllDisplays: () => displays,
  getPrimaryDisplay: () => displays[0],
  getCursorScreenPoint: () => ({ ...cursor }),
  getDisplayNearestPoint: (p) => displays.find((d) => inside(d.bounds, p)) || (p.x >= 1920 ? displays[1] : displays[0]),
  getDisplayMatching: (r) => screen.getDisplayNearestPoint({ x: r.x + r.width / 2, y: r.y + r.height / 2 }),
  screenToDipPoint: (p) => (p.x >= 1920 ? { x: 1920 + (p.x - 1920) / 1.5, y: p.y / 1.5 } : { x: p.x, y: p.y }),
  dipToScreenPoint: (p) => (p.x >= 1920 ? { x: 1920 + (p.x - 1920) * 1.5, y: p.y * 1.5 } : { x: p.x, y: p.y }),
};

function loadModule(file, stubs, platform) {
  const mod = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(path.join(root, file), 'utf8')), {
    module: mod,
    exports: mod.exports,
    require: (name) => stubs[name] || require(name),
    process: { platform },
    Date: clock,
    setInterval: () => 0,
    clearInterval: () => {},
    console,
    Math,
    Number,
  });
  return mod.exports;
}

const placement = loadModule('src/services/popup-placement.ts', { electron: { screen } }, 'win32');

// Hub shared by the hover service and the main-process handler under test.
const handlers = [];
const hub = { onContext: (h) => handlers.push(h), emit: (event) => handlers.forEach((h) => h(event)) };

// Words on screen: the hover service reads whichever word box holds the pointer.
const words = [
  { text: 'alpha', x: 180, y: 290, width: 60, height: 20 },
  { text: 'beta', x: 2480, y: 390, width: 50, height: 20 },
  { text: 'gamma', x: 900, y: 700, width: 70, height: 20 },
  { text: 'the', x: 400, y: 100, width: 30, height: 20 },
  { text: 'the', x: 400, y: 600, width: 30, height: 20 },
];
let wordDelay = null;
const hoverModule = loadModule('src/services/hover-lookup.ts', {
  electron: { screen, BrowserWindow: {} },
  '../logger': { wrapConsole: () => ({ log() {}, warn() {} }) },
  './text-normalize': {
    isLookupWorthy: (t) => !!String(t || '').trim(),
    normalizeQuery: (t) => ({ kind: 'word', trimmed: String(t).trim() }),
  },
  './context-capture': { contextCaptureHub: hub },
  './screen-capture': { captureAroundPoint: async () => null },
  './ocr-engine': { ocrEngine: {}, lineNearPoint: () => null, textNearPoint: () => '' },
}, 'linux');

let mouseDown = false;
const hover = new hoverModule.HoverLookupService({
  dwellMs: 450,
  cooldownMs: 900,
  cursor: { point: () => ({ ...cursor }) },
  isMouseDown: () => mouseDown,
  isBlocked: () => mouseDown,
  getWordAtPoint: (x, y) => {
    const hit = words.find((w) => inside(w, { x, y }));
    const answer = hit ? { text: hit.text, x, y } : { text: '', x, y };
    if (!wordDelay) return answer;
    return new Promise((resolve) => { wordDelay = () => resolve(answer); });
  },
});

// Fake BrowserWindow: records bounds, and rescales the first move onto a display with
// another scale factor the way Windows' WM_DPICHANGED does.
let created = 0;
class FakeWindow {
  constructor(options) {
    created += 1;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.listeners = {};
    this.destroyed = false;
    this.visible = false;
    this.loading = true;
    this.text = '';
    this.webContents = {
      on: (name, fn) => this.on(name, fn),
      isLoadingMainFrame: () => this.loading,
      send: (_channel, text) => { this.text = text; },
    };
    FakeWindow.all.push(this);
  }
  on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); return this; }
  once(name, fn) { return this.on(name, fn); }
  emit(name) { (this.listeners[name] || []).splice(0).forEach((fn) => fn()); }
  loadURL() { return Promise.resolve(); }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  show() { this.visible = true; }
  focus() {}
  getSize() { return [this.bounds.width, this.bounds.height]; }
  getBounds() { return { ...this.bounds }; }
  setBounds(rect) {
    const from = screen.getDisplayMatching(this.bounds).scaleFactor;
    const to = screen.getDisplayMatching(rect).scaleFactor;
    const k = to / from;
    this.bounds = k === 1 ? { ...rect } : { ...rect, width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
  }
  /** Finish loading the page, firing the handlers createPopupWindow registered. */
  finishLoad() {
    this.loading = false;
    this.emit('ready-to-show');
    this.emit('did-finish-load');
  }
  /** close() runs 'close' at once and 'closed' later, like a real window. */
  close() { this.emit('close'); }
  closed() { this.destroyed = true; this.visible = false; this.emit('closed'); }
}
FakeWindow.all = [];
FakeWindow.getFocusedWindow = () => null;

let chordHeld = false;
const context = vm.createContext({
  BrowserWindow: FakeWindow,
  Date: clock,
  WeakMap,
  WeakSet,
  Math,
  monitorSettings: { mode: 'shortcut', triggerShortcut: 'Alt+C' },
  TRIGGER_AFTER_SELECTION_MAX_MS: 60000,
  lastSelectionEvent: null,
  lastSelectedText: '',
  lastPopupAt: 0,
  lastPopupText: '',
  popupWindows: [],
  inFlightPopup: null,
  contextHubWired: false,
  contextCaptureHub: hub,
  hoverLookup: hover,
  mainWindow: null,
  ocrOverlayWindow: null,
  placePopupNearPoint: placement.placePopupNearPoint,
  placePanelNearPoint: placement.placePanelNearPoint,
  eventCoordSpace: placement.eventCoordSpace,
  physicalToDip: placement.physicalToDip,
  setWindowBounds: placement.setWindowBounds,
  isAcceleratorPhysicallyHeld: () => chordHeld,
  rememberLookupSource: (ev) => remembered.push(ev.text),
  withWin11Chrome: (options) => options,
  withPopupDevFlag: (url) => url,
  MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: undefined,
  POPUP_WINDOW_WEBPACK_ENTRY: 'about:blank',
  interceptPopupHistoryKeys: () => {},
  trackPopupFocus: () => {},
  closePopupForOutsideClick: (win) => win.close(),
  sendPopupText: (win, text) => win.webContents.send('popup-text', text),
  log: { debug() {}, info() {}, warn() {}, error() {} },
  setTimeout,
});

const source = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
function declaration(name) {
  const statement = ast.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === name ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => entry.name.getText(ast) === name));
  assert.ok(statement, `Missing production code ${name}`);
  return statement.getText(ast);
}
vm.runInContext(transpile([
  'stripTargets', 'closingPopups', 'panelAnchors', 'PANEL_OPEN_WIDTH', 'PANEL_OPEN_HEIGHT', 'placePanelWindow', 'panelMovedByHand', 'hoverInsideFullPopup', 'applyPanelTarget', 'setLastSelectionEvent', 'hoverYieldsToSelection',
  'onTriggerShortcutAfterSelection', 'createPopupWindow', 'wireContextCaptureHubOnce',
].map(declaration).join('\n') + '\nglobalThis.createPopupWindow = createPopupWindow;'), context);
context.wireContextCaptureHubOnce();
hover.start();

const remembered = [];
const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };
const center = (w) => ({ x: w.x + Math.round(w.width / 2), y: w.y + Math.round(w.height / 2) });
const strips = () => context.popupWindows.filter((w) => !w.isDestroyed());
/** Dwell on a word: move there, wait out the dwell, tick. */
async function dwellOn(word, extraMs = 0) {
  // Arrive from elsewhere, as a hand does; a pointer that never moved has used its dwell.
  cursor = { x: 5, y: 1000 };
  await hover.tick();
  cursor = center(word);
  await hover.tick();
  now += 450 + extraMs;
  await hover.tick();
  await flush();
}
/** Where placePopupNearPoint puts a 315x36 strip for a DIP point. */
const expected = (p) => placement.placePopupNearPoint(p.x, p.y, 315, 36, { space: 'dip' });
function assertStripAt(win, word, message) {
  const want = expected(center(word));
  const got = win.getBounds();
  assert.deepEqual({ x: got.x, y: got.y, width: got.width, height: got.height },
    { x: want.x, y: want.y, width: 315, height: 36 }, message);
  assert.equal(win.text, word.text, `${message}: strip shows ${word.text}`);
}

(async () => {
  const [alpha, beta, gamma, the1, the2] = words;

  // Shortcut mode, the reporter's setting. Hover alpha, press the trigger: strip at alpha.
  await dwellOn(alpha);
  assert.equal(context.lastSelectionEvent?.text, 'alpha', 'hovering stores the word');
  assert.equal(strips().length, 0, 'shortcut mode opens nothing without the trigger');
  context.onTriggerShortcutAfterSelection();
  assert.equal(strips().length, 1);
  const strip = strips()[0];
  strip.finishLoad();
  assertStripAt(strip, alpha, 'trigger over alpha opens at alpha');
  // A save from this strip names the window the word was met in (Sources).
  assert.deepEqual(remembered, ['alpha'], 'the trigger notes where the word came from');

  // Move to beta on the 150% monitor and press the trigger before any dwell finished.
  // Before the fix this reopened alpha at alpha: the strip looked stuck.
  now += 200;
  cursor = center(beta);
  context.onTriggerShortcutAfterSelection();
  await flush();
  assert.equal(strips().length, 1, 'the strip is reused, not duplicated');
  assertStripAt(strip, beta, 'trigger over beta moves the strip to beta');

  // A strip still loading keeps its own target; a hover stored meanwhile does not move it.
  strip.close();
  strip.closed();
  now += 2000;
  cursor = center(gamma);
  context.onTriggerShortcutAfterSelection();
  await flush();
  const loading = strips()[0];
  assert.ok(loading && loading !== strip, 'a new strip opens once the old one closed');
  await dwellOn(alpha, 1000);
  assert.equal(context.lastSelectionEvent?.text, 'alpha');
  loading.finishLoad();
  assertStripAt(loading, gamma, 'a hover stored while the strip loaded must not drag it away');
  loading.close();
  loading.closed();

  // A trigger over empty space opens nothing and leaves nothing waiting for a later hover.
  now += 2000;
  cursor = { x: 1500, y: 900 };
  context.onTriggerShortcutAfterSelection();
  await flush();
  assert.equal(strips().length, 0, 'nothing under the pointer, nothing opens');
  await dwellOn(gamma, 500);
  assert.equal(strips().length, 0, 'a later hover must not be taken for the trigger');

  // "On" mode: hover alone opens the strip.
  context.monitorSettings.mode = 'on';
  now += 5000;
  await dwellOn(alpha);
  const onStrip = strips()[0];
  onStrip.finishLoad();
  assertStripAt(onStrip, alpha, 'hover alpha opens at alpha');

  // Move to gamma well inside the cooldown. The dwell must wait, not be spent.
  now += 10;
  cursor = center(gamma);
  await hover.tick();
  now += 460;
  await hover.tick();
  await flush();
  assert.equal(onStrip.text, 'alpha', 'nothing yet: the dwell ended inside the cooldown');
  now += 500;
  await hover.tick();
  await flush();
  assertStripAt(onStrip, gamma, 'after the cooldown the dwell on gamma moves the strip');

  // A word read after the pointer left is dropped instead of opening where it was.
  now += 2000;
  cursor = center(beta);
  await hover.tick();
  now += 450;
  wordDelay = () => {};
  const slow = hover.tick();
  assert.equal(typeof wordDelay, 'function', 'the dwell on beta started a probe');
  cursor = center(alpha);
  const release = wordDelay;
  wordDelay = null;
  release();
  await slow;
  await flush();
  assert.equal(onStrip.text, 'gamma', 'beta, read after the pointer left it, must not move the strip');
  await hover.tick();
  now += 450;
  await hover.tick();
  await flush();
  assertStripAt(onStrip, alpha, 'the dwell where the pointer is now opens alpha');

  // The same word in another place is a new lookup.
  now += 2000;
  await dwellOn(the1);
  assertStripAt(onStrip, the1, 'first "the"');
  now += 1000;
  await dwellOn(the2);
  assertStripAt(onStrip, the2, 'the same word lower on the page moves the strip there');

  // A strip that started closing is not handed the next word.
  onStrip.close();
  now += 2000;
  await dwellOn(gamma);
  const fresh = strips().find((w) => w !== onStrip);
  assert.ok(fresh, 'a closing strip must not swallow the next word');
  onStrip.closed();
  fresh.finishLoad();
  assertStripAt(fresh, gamma, 'the new strip opens at gamma');

  // A click that dismisses the strip leaves the pointer on gamma; the strip stays shut.
  fresh.close();
  fresh.closed();
  now += 100;
  mouseDown = true;
  await hover.tick();
  mouseDown = false;
  now += 1000;
  await hover.tick();
  now += 1000;
  await hover.tick();
  await flush();
  assert.equal(strips().length, 0, 'the word a click just dismissed must not reopen under the pointer');
  // Leaving the word and coming back opens it again, well inside the old 2.7 s quiet time.
  cursor = { x: 5, y: 1000 };
  await hover.tick();
  cursor = center(gamma);
  await hover.tick();
  now += 460;
  await hover.tick();
  await flush();
  assert.equal(strips().length, 1, 'gamma opens again after the pointer left and came back');
  assert.equal(created, 5);
  const again = strips()[0];
  again.finishLoad();
  again.close();
  again.closed();

  // createPopupWindow's 1 s duplicate skip only applies while a strip is open.
  now += 100;
  context.createPopupWindow(center(gamma).x, center(gamma).y, 'dip');
  assert.equal(created, 6, 'the same word reopens once its strip has closed');
  strips()[0].close();
  strips()[0].closed();

  // Back to shortcut mode for the remaining trigger cases.
  context.monitorSettings.mode = 'shortcut';

  // A trigger pressed while the button is down is dropped, not replayed after the drag.
  now += 3000;
  cursor = center(beta);
  mouseDown = true;
  context.onTriggerShortcutAfterSelection();
  await flush();
  cursor = center(alpha);
  mouseDown = false;
  await hover.tick();
  await flush();
  assert.equal(strips().length, 0, 'a trigger during a drag must not fire later somewhere else');

  // Select a word, click elsewhere (which releases the selection's hold), then press the
  // trigger over beta: beta opens at beta, not the old selection.
  now += 1000;
  context.lastSelectionEvent = null;
  context.setLastSelectionEvent({ text: 'selected', x: 300, y: 600, timestamp: now, origin: 'selection', coordSpace: 'dip' });
  assert.equal(hover.isHeldBySelection(), true);
  mouseDown = true;
  await hover.tick();
  mouseDown = false;
  assert.equal(hover.isHeldBySelection(), false, 'the click released the hold');
  cursor = center(beta);
  context.onTriggerShortcutAfterSelection();
  await flush();
  assert.equal(strips().length, 1);
  const afterSelection = strips()[0];
  afterSelection.finishLoad();
  assertStripAt(afterSelection, beta, 'a selection the user clicked away from does not beat the word under the pointer');
  afterSelection.close();
  afterSelection.closed();

  // Without a click, select-then-trigger still opens the selection where it is.
  now += 1000;
  context.setLastSelectionEvent({ text: 'selected', x: 300, y: 600, timestamp: now, origin: 'selection', coordSpace: 'dip' });
  context.onTriggerShortcutAfterSelection();
  const selected = strips()[0];
  selected.finishLoad();
  assert.equal(selected.text, 'selected', 'select, then trigger, still looks up the selection');
  selected.close();
  selected.closed();
  mouseDown = true;
  await hover.tick();
  mouseDown = false;

  // Resting on a hover word for more than a minute: the trigger still reads it.
  now += 61_000;
  context.lastSelectionEvent = { text: 'beta', x: center(beta).x, y: center(beta).y, timestamp: now - 61_000, origin: 'hover', coordSpace: 'dip' };
  context.onTriggerShortcutAfterSelection();
  await flush();
  assert.equal(strips().length, 1, 'an old hover word still under the pointer opens');
  strips()[0].finishLoad();
  assertStripAt(strips()[0], beta, 'an old hover word still under the pointer opens at it');

  // Physical UIA selection on the 150% monitor still lands on that monitor.
  const sel = placement.placePopupNearPoint(1920 + 900, 600, 315, 36, { space: 'physical' });
  assert.equal(sel.displayId, 2, 'physical point on the 150% monitor maps to it');
  assert.equal(sel.y, 400 + 14, 'physical y is divided by that monitor\'s scale, not the primary\'s');

  strips().forEach((w) => { w.close(); w.closed(); });

  // Settings -> Capture -> Open lookups as -> Full pop-up. Each case: the pop-up opens full,
  // shows the word, does not cover it, and stays on the word's monitor.
  context.monitorSettings.mode = 'on';
  context.monitorSettings.lookupOpens = 'panel';
  const covers = (b, w) => b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y;
  const onScreen = (b) => displays.some((d) => b.x >= d.workArea.x && b.y >= d.workArea.y
    && b.x + b.width <= d.workArea.x + d.workArea.width && b.y + b.height <= d.workArea.y + d.workArea.height);
  function assertPanelBeside(win, word, message) {
    const b = win.getBounds();
    assert.equal(b.width, 460, `${message}: full width, not a strip`);
    assert.ok(b.height >= 200, `${message}: full height, not a strip (${b.height})`);
    assert.ok(!covers(b, word), `${message}: covers ${word.text} ${JSON.stringify(b)}`);
    assert.ok(onScreen(b), `${message}: off screen ${JSON.stringify(b)}`);
    assert.equal(screen.getDisplayMatching(b).id, screen.getDisplayNearestPoint(center(word)).id, `${message}: another monitor`);
    assert.equal(win.text, word.text, `${message}: shows ${word.text}`);
  }
  const panels = () => context.popupWindows.filter((w) => !w.isDestroyed());
  const before = created;
  now += 3000;
  await dwellOn(alpha);
  assert.equal(panels().length, 1, 'hover opens one pop-up');
  const panel = panels()[0];
  panel.finishLoad();
  assertPanelBeside(panel, alpha, 'alpha, with room below');
  assert.equal(panel.getBounds().y, center(alpha).y + 14, 'below the word when it fits');
  // gamma is low on the 100% monitor: the pop-up goes above it.
  now += 3000;
  await dwellOn(gamma);
  assert.equal(created, before + 1, 'the next word reuses the open pop-up');
  assertPanelBeside(panel, gamma, 'gamma, near the bottom');
  assert.ok(panel.getBounds().y + panel.getBounds().height <= gamma.y, 'above gamma');
  // beta on the 150% monitor has room for neither 500 px below nor above: the pop-up takes
  // the larger room and is made shorter, still on that monitor and clear of the word.
  now += 3000;
  await dwellOn(beta);
  assert.equal(created, before + 1);
  assertPanelBeside(panel, beta, 'beta, on the 150% monitor');
  // The page grows the pop-up to its entry: it stays clear of the word.
  context.applyPanelTarget(panel, center(alpha).x, center(alpha).y, 'dip', 'alpha', false);
  const grown = placement.placePanelNearPoint(center(alpha).x, center(alpha).y, 460, 620, { space: 'dip' });
  assert.ok(!covers({ ...grown, width: 460 }, alpha) && grown.height === 620, 'a taller entry still sits below alpha');
  // A pop-up dragged aside by hand stays there; the next word only changes what it shows.
  panel.emit('will-move');
  const dragged = panel.getBounds();
  now += 3000;
  await dwellOn(the1);
  assert.deepEqual(panel.getBounds(), dragged, 'a moved pop-up stays where the user put it');
  assert.equal(panel.text, 'the');
  panel.close();
  panel.closed();
  // A physical selection point on the 150% monitor (Windows UI Automation) opens there.
  now += 3000;
  context.setLastSelectionEvent({ text: 'selected', x: 1920 + 900, y: 300, timestamp: now, origin: 'selection', coordSpace: 'physical' });
  context.createPopupWindow(1920 + 900, 300, 'physical');
  const picked = panels()[0];
  picked.finishLoad();
  const pb = picked.getBounds();
  assert.equal(screen.getDisplayMatching(pb).id, 2, 'a selection on the 150% monitor opens there');
  assert.ok(onScreen(pb) && pb.y >= 200 + 14, 'below the selection point (y 200 in DIP)');
  picked.close();
  picked.closed();
  // A click releases the hold the selection above put on hover.
  mouseDown = true;
  await hover.tick();
  mouseDown = false;
  // Linux reports no will-move: a pop-up dragged there is recognised by its position.
  now += 3000;
  await dwellOn(alpha);
  const linuxPanel = panels()[0];
  linuxPanel.finishLoad();
  assertPanelBeside(linuxPanel, alpha, 'alpha again');
  linuxPanel.setBounds({ ...linuxPanel.getBounds(), x: 1300, y: 80 });
  const draggedOnLinux = linuxPanel.getBounds();
  now += 3000;
  await dwellOn(gamma);
  assert.deepEqual(linuxPanel.getBounds(), draggedOnLinux, 'a pop-up dragged without will-move stays where it was put');
  assert.equal(linuxPanel.text, 'gamma');
  linuxPanel.close();
  linuxPanel.closed();
  // The entry sets the height: a pop-up opened above a word stays above it when a short
  // entry loads, instead of jumping below the word.
  now += 3000;
  await dwellOn(gamma);
  const sticky = panels()[0];
  sticky.finishLoad();
  assert.ok(sticky.getBounds().y + sticky.getBounds().height <= gamma.y, 'opens above gamma');
  vm.runInContext('placePanelWindow', context)(sticky, vm.runInContext('panelAnchors', context).get(sticky), 460, 250, true);
  const sb = sticky.getBounds();
  assert.equal(sb.height, 250);
  assert.ok(sb.y + sb.height <= gamma.y, `a short entry keeps the pop-up above gamma ${JSON.stringify(sb)}`);
  // Resting the pointer on the pop-up's own text while reading leaves the entry alone;
  // the trigger shortcut there still looks the word up.
  const inner = { text: 'inner', x: sb.x + 40, y: sb.y + 60, width: 40, height: 20 };
  words.push(inner);
  now += 3000;
  await dwellOn(inner);
  assert.equal(sticky.text, 'gamma', 'hovering a word inside the pop-up does not replace its entry');
  assert.deepEqual(sticky.getBounds(), sb);
  now += 3000;
  context.monitorSettings.mode = 'shortcut';
  context.onTriggerShortcutAfterSelection();
  await flush();
  await hover.tick();
  await flush();
  assert.equal(sticky.text, 'inner', 'the trigger over a word in the pop-up looks it up there');
  assert.deepEqual(sticky.getBounds(), sb, 'and the pop-up does not move');
  words.pop();
  sticky.close();
  sticky.closed();
  context.monitorSettings.lookupOpens = 'strip';

  hover.stop();
  console.log('Hover strip passed: full pop-up beside the word, above it near the bottom, shorter on a short monitor, reused for the next word, kept where dragged (also with no will-move, as on Linux), physical selection on 150%, keeps its side as the entry sets its height, ignores hover over its own text but not the trigger; trigger reads the word under the pointer, cooldown keeps the dwell, late reads dropped, same word elsewhere, closing strip skipped, load keeps its target, click-away stays shut, drag drops the trigger, clicked-away selection, mixed-DPI move.');
})().catch((error) => { console.error(error); process.exit(1); });
