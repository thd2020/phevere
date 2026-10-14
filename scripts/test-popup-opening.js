/* Run: node scripts/test-popup-opening.js. Uses real popup HTML and Electron resizing. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-popup-opening-'));
  env.PHEVERE_POPUP_OPENING_TEST_DIR = fixture;
  const child = require('node:child_process').spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' });
  fs.rmSync(fixture, { recursive:true, force:true, maxRetries:20, retryDelay:100 });
  process.exit(child.status ?? 1);
}
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fixture = process.env.PHEVERE_POPUP_OPENING_TEST_DIR;
assert.ok(fixture, 'Run through Node so cleanup follows Electron exit');
app.setPath('userData', fixture);
app.on('window-all-closed', () => {});
let win;
const sizeModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/services/popup-size.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: sizeModule, exports: sizeModule.exports });
const main = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
const start = main.indexOf("ipcMain.on('window-resize'");
const end = main.indexOf("ipcMain.on('open-clipboard'", start);
assert.ok(start >= 0 && end > start);
let resize;
vm.runInNewContext(main.slice(start, end), {
  ipcMain: { on: (_name, handler) => { resize = handler; } }, BrowserWindow, screen,
  popupSize: sizeModule.exports.popupSize, inFlightPopup: null,
  log: { debug() {} }, placePopupNearPoint: (x, y) => ({ x, y }),
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 350));
const js = (code) => win.webContents.executeJavaScript(code);
async function assertPanel(word) {
  await tick();
  const actual = await js(`({ collapsed:document.getElementById('toolbar').classList.contains('collapsed'),
    word:document.querySelector('.result-word')?.textContent,
    save:document.getElementById('vocabHeartIcon').getBoundingClientRect().right,
    width:innerWidth, checked:document.getElementById('expandableMode').checked })`);
  assert.equal(actual.collapsed, false);
  assert.equal(actual.word, word, 'opening a panel must perform and display the lookup');
  assert.ok(actual.save <= actual.width, 'Save must fit in the immediate panel');
  assert.equal(actual.checked, true, 'the positive full-panel option is checked');
  assert.ok(win.getSize()[0] >= 460 && win.getSize()[1] >= 200);
}
app.whenReady().then(async () => {
  const preload = path.join(fixture, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');
    contextBridge.exposeInMainWorld('electronAPI',{
      resizeWindow:(w,h,x,y,options)=>ipcRenderer.send('fixture-resize',{width:w,height:h,...options}),
      getLastSelection:async()=>({text:'initial',timestamp:1}),
      onPopupText:cb=>ipcRenderer.on('fixture-selection',(_,text,ts)=>cb(text,ts))
    });
    contextBridge.exposeInMainWorld('dictionaryAPI',{
      lookup:async word=>({word,definitions:[{partOfSpeech:'noun',meaning:'An opening fixture.',source:'Wiktionary'}],translations:[],examples:[],sources:['Wiktionary']}),
      getSupportedLanguages:async()=>[]
    });`);
  ipcMain.on('fixture-resize', (event, request) => resize(event, request));
  win = new BrowserWindow({ width:315,height:36,show:false,frame:false,
    webPreferences:{preload,contextIsolation:true,backgroundThrottling:false} });
  await win.loadFile(path.join(root, 'src/popup-new.html'));
  win.setPosition(-2000,100);
  win.showInactive();
  await tick();
  assert.equal(await js(`document.getElementById('toolbar').classList.contains('collapsed')`), true,
    'existing default remains the collapsed strip');
  await js(`document.getElementById('settingsIcon').click();
    const option=document.getElementById('expandableMode');option.checked=true;
    option.dispatchEvent(new Event('change',{bubbles:true}));`);
  await assertPanel('initial');
  if (process.argv.includes('--screenshot')) {
    await tick();
    const bounds = await js(`(() => { const r=document.getElementById('settingsPanel').getBoundingClientRect();
      return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}; })()`);
    fs.writeFileSync(path.join(root, 'README.assets/desktop-popup-opening.png'),
      (await win.webContents.capturePage(bounds)).toPNG());
  }
  assert.equal(await js(`JSON.parse(localStorage.getItem('phevereSettings')).expandableMode`), false,
    'the existing setting stores the inverse of the positive option');
  await win.reload();
  await assertPanel('initial');
  win.webContents.send('fixture-selection','selected',2);
  await assertPanel('selected');
  win.webContents.send('fixture-selection','shortcut',3);
  await assertPanel('shortcut');
  await js(`activateTab('etymology');`);
  win.webContents.send('fixture-selection','shortcut',3);
  await tick();
  assert.equal(await js(`currentTab`), 'etymology', 'duplicate startup IPC must retain the chosen view');
  win.webContents.send('fixture-selection','shortcut',4);
  await assertPanel('shortcut');
  assert.equal(await js(`currentTab`), 'lexicon', 'a fresh same-word selection still opens the full lookup');
  await js(`const option=document.getElementById('expandableMode');option.checked=false;
    option.dispatchEvent(new Event('change',{bubbles:true}));`);
  await win.reload();
  await tick();
  assert.equal(await js(`document.getElementById('toolbar').classList.contains('collapsed')`), true);
  win.close();
  console.log('Popup opening passed: default strip, positive setting, persistence, successive selection payloads and restored strip.');
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
