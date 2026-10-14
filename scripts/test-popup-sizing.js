/* Run: node scripts/test-popup-sizing.js. Uses the installed Electron runtime. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' });
  process.exit(child.status ?? 1);
}

const { app, BrowserWindow, ipcMain } = require('electron');
app.on('window-all-closed', () => {}); // The test verifies Close before exiting.
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/services/popup-size.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: moduleUnderTest.exports, module: moduleUnderTest });
const { popupSize } = moduleUnderTest.exports;
const mainSource = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
const handlerStart = mainSource.indexOf("ipcMain.on('window-resize'");
const handlerEnd = mainSource.indexOf("ipcMain.on('open-clipboard'", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
let resizeHandler;
const mainContext = {
  ipcMain: { on: (_name, handler) => { resizeHandler = handler; } },
  BrowserWindow, popupSize, inFlightPopup: null,
  screen: require('electron').screen,
  log: { debug() {} },
  placePopupNearPoint: (x, y) => ({ x, y }),
};
vm.runInNewContext(mainSource.slice(handlerStart, handlerEnd), mainContext);

// Exercise the production retarget guard with an expanded window still in flight.
const retargetStart = mainSource.indexOf('const applyStripTarget =');
const retargetEnd = mainSource.indexOf('// An open lookup panel', retargetStart);
const retargetContext = {
  inFlightPopup: { isDestroyed: () => false },
  isCollapsedStrip: () => false,
  popupWidth: 315, popupHeight: 36, space: 'dip',
  placePopupNearPoint: () => { throw Error('expanded popup was retargeted'); },
  log: { warn: (_scope, _message, detail) => { throw Error(detail.err); } },
};
vm.runInNewContext(ts.transpileModule(mainSource.slice(retargetStart, retargetEnd) +
  '\napplyStripTarget(inFlightPopup, 100, 100, "next", true);', {}).outputText, retargetContext);

assert.equal(popupSize(NaN, 300), null);
assert.equal(popupSize(300, Infinity), null);
assert.equal(popupSize(-1, 300), null);
assert.equal(popupSize(160, 36, { mode: 'panel' }).height, 200);
assert.equal(popupSize(160, 36, { mode: 'panel' }).width, 460);
assert.equal(popupSize(160, 36, { mode: 'strip', minWidth: 321 }).width, 321);
assert.equal(popupSize(700, 300, { mode: 'panel', minWidth: 490 }).width, 700);
assert.equal(popupSize(9999, 9999).width, 1200);

let win;
let temp;
const tick = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (code) => win.webContents.executeJavaScript(code);
async function visibleControls(label) {
  const data = await js(`(() => {
    const buttons = [...document.querySelectorAll('.toolbar-icon, .lookup-nav-btn')]
      .filter(b => b.getBoundingClientRect().width > 0);
    return { width: innerWidth, height: innerHeight, controls: buttons.map(b => {
      const r = b.getBoundingClientRect();
      return { id: b.id || b.dataset.tab, left: r.left, right: r.right, bottom: r.bottom };
    }) };
  })()`);
  assert.equal(data.controls.length, label === 'strip' ? 10 : 12, label);
  for (const b of data.controls) {
    assert.ok(b.left >= 0 && b.right <= data.width && b.bottom <= data.height,
      `${label}: ${b.id} clipped at ${JSON.stringify(data)}`);
  }
  return win.getSize();
}

app.whenReady().then(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-popup-test-'));
  const preload = path.join(temp, 'preload.cjs');
  fs.writeFileSync(preload, `
    const {contextBridge, ipcRenderer} = require('electron');
    let entry = null;
    contextBridge.exposeInMainWorld('electronAPI', {
      resizeWindow: (width,height,x,y,options) => ipcRenderer.send('test-resize', {width,height,...options}),
      getLastSelection: async () => ({text:'test', ts:1}),
      onPopupText: cb => ipcRenderer.on('test-text', (_,text,ts) => cb(text,ts)),
    });
    contextBridge.exposeInMainWorld('vocabAPI', {
      find: async () => entry,
      add: async payload => (entry = { ...payload, id:'test-entry' }),
      remove: async () => { entry = null; },
    });
  `);
  win = new BrowserWindow({ width: 315, height: 36, frame: false, show: false,
    webPreferences: { preload, contextIsolation: true, backgroundThrottling: false } });
  ipcMain.on('test-resize', (_event, request) => {
    resizeHandler(_event, request);
  });
  await win.loadFile(path.join(root, 'src/popup-new.html'));
  // Shown outside the work area so Electron lays out without a hidden-window cache.
  win.setPosition(-2000, 100);
  win.showInactive();
  await tick(400);
  console.log('strip', await visibleControls('strip'));
  for (const tab of ['lexicon', 'translation', 'etymology', 'wikipedia']) {
    await js(`document.querySelector('[data-tab="${tab}"]').click()`);
    await tick(350);
    await visibleControls(tab);
  }
  // A native resize attempt cannot hide Save or Close in the expanded toolbar.
  win.setSize(160, 36);
  await tick();
  console.log('constrained panel', await visibleControls('panel'));
  await js(`document.getElementById('vocabHeartIcon').click()`);
  await tick();
  assert.equal(await js(`document.getElementById('vocabHeartIcon').getAttribute('aria-pressed')`), 'true');
  await js(`document.getElementById('vocabHeartIcon').click()`);
  await tick();
  assert.equal(await js(`document.getElementById('vocabHeartIcon').getAttribute('aria-pressed')`), 'false');
  // Rapid collapse/expand queues height fitting before the native resize is observed.
  for (let i = 0; i < 10; i++) {
    await js(`collapseToolbar(); expandToolbar(); fitPanelHeight()`);
    await tick();
    await visibleControls('rapid expansion');
  }
  const before = win.getSize();
  win.webContents.send('test-text', 'another selection', Date.now());
  await tick();
  assert.deepEqual(win.getSize(), before, 'incoming selection keeps the expanded panel size');
  await js(`collapseToolbar()`);
  await tick();
  await visibleControls('strip');
  await js(`document.getElementById('settingsIcon').click()`);
  await tick();
  await visibleControls('options');
  assert.equal(await js(`document.getElementById('settingsPanel').classList.contains('show')`), true);
  await js(`document.getElementById('closeIcon').click()`);
  await tick();
  assert.ok(win.isDestroyed(), 'Close closes the popup');
  // Notebook/history opens the same page with the full-lookup route.
  win = new BrowserWindow({ width: 560, height: 500, frame: false, show: false,
    webPreferences: { preload, contextIsolation: true, backgroundThrottling: false } });
  await win.loadFile(path.join(root, 'src/popup-new.html'), { hash: 'popup' });
  win.setPosition(-2000, 100);
  win.showInactive();
  await tick(400);
  await visibleControls('full lookup');
  assert.equal(await js(`document.getElementById('toolbar').classList.contains('collapsed')`), false);
  if (process.argv.includes('--screenshot')) {
    win.setSize(460, 200);
    await tick();
    fs.writeFileSync(path.join(root, 'README.assets/desktop-popup-minimum.png'),
      (await win.webContents.capturePage()).toPNG());
  }
  win.close();
  console.log('Popup sizing: native constraints, four views, Save, rapid expansion, retarget, Options and Close passed.');
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
app.on('quit', () => {
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
});
