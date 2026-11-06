/* Exercise production shortcut and popup lifecycle handlers with real Electron windows. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-retrigger-'));
  env.PHEVERE_RETRIGGER_TEST_DIR = testDirectory;
  const child = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit' });
  fs.rmSync(testDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  process.exit(child.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
app.on('window-all-closed', () => {});
const directory = process.env.PHEVERE_RETRIGGER_TEST_DIR;
assert.ok(directory, 'Run this test through Node so cleanup follows Electron exit');
app.setPath('userData', directory);
require('./electron-test-env')(app);
const source = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
function declaration(name) {
  const statement = ast.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === name ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => entry.name.getText(ast) === name));
  assert.ok(statement, `Missing production handler ${name}`);
  return statement.getText(ast);
}

let now = 10000;
let created = 0;
// Strips open off screen and never take focus, so the test does not disturb the desktop.
class TrackedWindow extends BrowserWindow {
  constructor(options) { super(options); created++; }
  show() { this.showInactive(); }
  focus() {}
}
const context = vm.createContext({
  BrowserWindow: TrackedWindow,
  Date: { now: () => now },
  monitorSettings: { mode: 'shortcut' },
  TRIGGER_AFTER_SELECTION_MAX_MS: 60000,
  lastSelectionEvent: { text: 'repeat', x: 100, y: 100, timestamp: now, coordSpace: 'dip' },
  lastSelectedText: 'repeat', lastPopupAt: 0, lastPopupText: '', popupWindows: [], inFlightPopup: null,
  placePopupNearPoint: (x, y) => ({ x: x - 4000, y, displayId: 1 }),
  setWindowBounds: (window, rect) => window.setBounds(rect, false),
  stripTargets: new WeakMap(), closingPopups: new WeakSet(), hoverLookup: null,
  panelAnchors: new WeakMap(),
  placePanelNearPoint: (x, y, _w, h) => ({ x: x - 4000, y: y + 14, height: h, displayId: 1 }),
  physicalToDip: (x, y) => ({ x, y }),
  eventCoordSpace: (event) => event.coordSpace || 'dip',
  withWin11Chrome: (options) => options,
  withPopupDevFlag: (url) => url,
  MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: undefined,
  POPUP_WINDOW_WEBPACK_ENTRY: 'data:text/html,<html><body>Lookup fixture</body></html>',
  interceptPopupHistoryKeys: () => {},
  trackPopupFocus: () => {},
  closePopupForOutsideClick: (window) => window.close(),
  sendPopupText: (window, text) => { window.lookupText = text; },
  rememberLookupSource: () => {},
  log: { debug() {}, warn() {}, error() {} }, setTimeout,
});
vm.runInContext(ts.transpileModule(['PANEL_OPEN_WIDTH', 'PANEL_OPEN_HEIGHT', 'applyPanelTarget', 'createPopupWindow', 'onTriggerShortcutAfterSelection']
  .map(declaration).join('\n'), {}).outputText, context);
const tick = () => new Promise((resolve) => setTimeout(resolve, 80));
async function loaded(window) {
  if (!window.webContents.isLoadingMainFrame()) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Lookup fixture did not load')), 10000);
    window.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve(); });
  });
}
async function close(window) {
  await new Promise((resolve) => { window.once('closed', resolve); window.close(); });
}

app.whenReady().then(async () => {
  try {
    context.onTriggerShortcutAfterSelection();
    const first = context.popupWindows[0];
    assert.ok(first);
    context.onTriggerShortcutAfterSelection();
    assert.equal(created, 1, 'A shortcut while the strip is loading must reuse it');
    await loaded(first);
    await close(first);
    assert.equal(context.lastSelectionEvent.text, 'repeat', 'Close must preserve unchanged selected text');
    now += 10;
    context.onTriggerShortcutAfterSelection();
    assert.equal(created, 2, 'The same word must reopen after 10 ms without waiting for another selection event');
    const reopened = context.popupWindows[0];
    await loaded(reopened);
    assert.equal(reopened.lookupText, 'repeat');
    context.createPopupWindow(100, 100);
    assert.equal(created, 2, 'Automatic duplicate events must remain suppressed');
    now += 10;
    context.lastSelectionEvent = { text: 'next', x: 120, y: 100, timestamp: now, coordSpace: 'dip' };
    context.createPopupWindow(120, 100);
    assert.equal(created, 2, 'A new selection must retarget the open strip');
    assert.equal(reopened.lookupText, 'next', 'The retargeted strip must receive the new word, not the last one');
    reopened.setSize(600, 400);
    context.onTriggerShortcutAfterSelection();
    assert.equal(created, 3, 'Explicit lookup may open a strip beside a retained expanded panel');
    context.onTriggerShortcutAfterSelection();
    assert.equal(created, 3, 'Repeated shortcut must reuse that new strip beside the expanded panel');
    await tick();
    assert.deepEqual(reopened.getSize(), [600, 400], 'Existing expanded lookup must not shrink');
    now += 60001;
    context.onTriggerShortcutAfterSelection();
    assert.equal(created, 3, 'Expired selection must not reopen');
    context.monitorSettings.mode = 'off';
    context.lastSelectionEvent.timestamp = now;
    context.onTriggerShortcutAfterSelection();
    assert.equal(created, 3, 'Disabled monitoring mode must not open a shortcut lookup');
    // Settings → Capture → Open lookups as → Full pop-up: one pop-up, opened full and reused.
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) await close(window);
    context.popupWindows.length = 0;
    context.monitorSettings.mode = 'shortcut';
    context.monitorSettings.lookupOpens = 'panel';
    now += 5000;
    context.lastSelectionEvent = { text: 'first', x: 200, y: 100, timestamp: now, coordSpace: 'dip' };
    context.onTriggerShortcutAfterSelection();
    assert.equal(created, 4, 'the trigger opens a pop-up');
    const panel = context.popupWindows[0];
    assert.deepEqual(panel.getSize(), [460, 500], 'the pop-up opens full, not as a strip');
    assert.ok(panel.getURL().includes('lookup=panel') || panel.webContents.isLoadingMainFrame(), 'the page is told to open full');
    await loaded(panel);
    assert.equal(panel.lookupText, 'first');
    now += 10;
    context.lastSelectionEvent = { text: 'second', x: 300, y: 200, timestamp: now, coordSpace: 'dip' };
    context.createPopupWindow(300, 200);
    assert.equal(created, 4, 'a new word shows in the open pop-up');
    assert.equal(panel.lookupText, 'second');
    assert.deepEqual(panel.getPosition(), [300 - 4000, 214], 'the pop-up moves next to the new word');
    context.createPopupWindow(300, 200);
    assert.equal(created, 4, 'a repeated event within a second is skipped');
    context.onTriggerShortcutAfterSelection();
    assert.equal(created, 4, 'the trigger shortcut reuses the full pop-up');
    await close(panel);
    now += 10;
    context.onTriggerShortcutAfterSelection();
    assert.equal(created, 5, 'once closed, the trigger opens the word again');
    assert.deepEqual(context.popupWindows.at(-1).getSize(), [460, 500]);
    console.log('Popup retrigger passed immediate same-word reopen, loading-strip coalescing, automatic debounce, new-word retarget, expanded-panel preservation, expiry, disabled mode, and the full pop-up opened full and reused.');
  } finally {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) await close(window);
  }
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
