/* Browser acceptance for production etymology grouping and popup source controls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-etymology-'));
  const env = { ...process.env, PHEVERE_ETYMOLOGY_TEST_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' });
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  process.exit(child.status ?? 1);
}

const { app, BrowserWindow, ipcMain } = require('electron');
const directory = process.env.PHEVERE_ETYMOLOGY_TEST_DIR;
assert.ok(directory, 'Run through Node so temporary files are removed after Electron exits');
app.setPath('userData', directory);
app.on('window-all-closed', () => {});
const root = path.resolve(__dirname, '..');
const grouping = { exports: {} };
vm.runInNewContext(esbuild.transformSync(fs.readFileSync(path.join(root, 'packages/core/src/etymology-sources.ts'), 'utf8'),
  { loader: 'ts', format: 'cjs' }).code, { module: grouping, exports: grouping.exports });
const { groupYoudaoEtymologies, serializeEtymologySources } = grouping.exports;
const tongPassages = [
  'This is a synthetic regression passage for Tong. ' + 'A complete source passage must remain available. '.repeat(25) + 'Tong first passage tail.',
  'This is a synthetic regression passage for Tong. ' + 'Distinct continuations must remain separate. '.repeat(25) + 'Tong second passage tail.',
  'This is a synthetic regression passage for Tong. ' + 'The final paragraph must remain searchable. '.repeat(25) + 'Tong third passage tail.',
];
const grouped = groupYoudaoEtymologies({
  zh: [
    ...tongPassages.map((value) => ({ source: 'Tong', value })),
    { source: 'Tong', value: tongPassages[0] },
    { source: '有道', value: '来自拉丁语的测试词源，用于核对中文来源的显示。' },
  ],
  en: [
    { source: 'Wiktionary', value: 'From Old English testan. This source has its own complete account.' },
    { source: 'Youdao', value: 'From Latin testum. This English account is grouped separately.' },
  ],
});
assert.equal(grouped.filter((entry) => entry.source === 'Tong').length, 1);
const base = (word) => ({ word, detectedLanguage: 'en', language: 'zh',
  definitions: [{ partOfSpeech: 'noun', meaning: 'A regression example', source: 'Wiktionary', language: 'en' }],
  translations: [{ text: '测试', language: 'zh', source: 'Youdao' }],
  etymology: serializeEtymologySources(grouped),
  metadata: { etymologyUnavailable: [{ source: 'Etymonline', status: 'blocked', url: `https://www.etymonline.com/word/${word}` }] },
});
let result = base('example');
const opened = [];
let win;
const tick = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (code) => win.webContents.executeJavaScript(code);
const active = () => js(`document.querySelector('.etymology-tab.is-active')?.textContent`);
async function clickSource(label) {
  await js(`Array.from(document.querySelectorAll('.etymology-tab')).find(button => button.textContent === ${JSON.stringify(label)}).click()`);
  await tick();
  assert.equal(await active(), label);
}
async function update(next) {
  result = next;
  win.webContents.send('test-lookup-update', result);
  await tick();
}

app.whenReady().then(async () => {
  const preload = path.join(directory, 'preload.cjs');
  fs.writeFileSync(preload, `
    const {contextBridge, ipcRenderer} = require('electron');
    contextBridge.exposeInMainWorld('electronAPI', {
      resizeWindow: () => {},
      getLastSelection: async () => ({text:'example', timestamp:1}),
      onPopupText: cb => ipcRenderer.on('test-text', (_,text,ts) => cb(text,ts)),
      openExternal: url => ipcRenderer.send('test-open-external', url),
    });
    contextBridge.exposeInMainWorld('dictionaryAPI', {
      lookup: () => ipcRenderer.invoke('test-lookup'),
      onLookupUpdate: cb => ipcRenderer.on('test-lookup-update', (_,result) => cb(result)),
    });
    contextBridge.exposeInMainWorld('wikipediaAPI', {search: async () => ({results: []})});
  `);
  ipcMain.handle('test-lookup', () => result);
  ipcMain.on('test-open-external', (_event, url) => opened.push(url));
  try {
    win = new BrowserWindow({ width: 560, height: 620, frame: false, show: false,
      webPreferences: { preload, contextIsolation: true, backgroundThrottling: false } });
    await win.loadFile(path.join(root, 'src/popup-new.html'));
    win.setPosition(-2000, 100);
    win.showInactive();
    await tick(400);
    for (const tab of ['lexicon', 'translation', 'wikipedia', 'etymology']) {
      await js(`document.querySelector('[data-tab="${tab}"]').click()`);
      await tick(150);
      assert.equal(await js(`document.querySelector('[data-tab="${tab}"]').getAttribute('aria-selected')`), 'true');
    }
    const labels = await js(`Array.from(document.querySelectorAll('.etymology-tab')).map(button => button.textContent)`);
    assert.deepEqual(labels, [...grouped.map((entry) => entry.label), 'Etymonline']);
    for (const entry of grouped) {
      await clickSource(entry.label);
      const text = await js(`Array.from(document.querySelectorAll('.etymology-panel-body')).find(panel => panel.style.display !== 'none').textContent`);
      assert.ok(text.replace(/\s/g, '').includes(entry.body.split('\n\n')[0].replace(/\s/g, '')), `Complete opening absent for ${entry.label}`);
    }
    await clickSource('Tong · 中文');
    const tong = await js(`Array.from(document.querySelectorAll('.etymology-panel-body')).find(panel => panel.style.display !== 'none').textContent`);
    for (const passage of tongPassages) assert.ok(tong.replace(/\s/g, '').includes(passage.replace(/\s/g, '')), 'Tong passage must remain complete');
    assert.equal(tong.match(/Tong first passage tail/g).length, 1, 'Complete duplicate passages must render once');
    await clickSource('Etymonline');
    assert.equal(await js(`document.querySelector('.etymology-no-data p').textContent`), 'Etymonline blocked this request.');
    await js(`document.querySelector('[data-ety-open]').click()`);
    await tick();
    assert.deepEqual(opened, ['https://www.etymonline.com/word/example']);
    await clickSource('Wiktionary · English');
    await update({ ...result, etymology: result.etymology + '\n\n--- Alternative etymology ---\n\n[Late source]\nA later complete etymology account.' });
    assert.equal(await active(), 'Wiktionary · English', 'Same-word updates must preserve selected source');
    await js(`document.querySelector('.etymology-tabs').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}))`);
    assert.equal(await active(), 'Youdao · English');
    await js(`document.querySelector('.etymology-tabs').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp',bubbles:true}))`);
    assert.equal(await active(), 'Wiktionary · English');
    await update({ ...result, etymology: result.etymology + '\n\n--- Alternative etymology ---\n\n[Etymonline]\nFrom Old English. A recovered provider account.' });
    await clickSource('Etymonline');
    assert.equal(await js(`document.querySelectorAll('[data-ety-open]').length`), 0, 'Recovered source must clear the blocked state');
    assert.ok(await js(`document.getElementById('dictionary-results').textContent.includes('A recovered provider account.')`));
    result = base('second');
    win.webContents.send('test-text', 'second', Date.now());
    await tick();
    await js(`lookupText('second', {force:true})`);
    await tick();
    assert.equal(await active(), 'Tong · 中文', 'New word must reset the selected source: ' + JSON.stringify(await js(`({currentTab,isExpanded,currentText,word:currentResult?.word,html:document.getElementById('dictionary-results').innerHTML.slice(0,150)})`)));
    for (const invalid of ['javascript:alert(1)', 'https://example.com/word/second', 'https://www.etymonline.com.evil.test/word/second', 'https://www.etymonline.com/about', 'https://name:password@www.etymonline.com/word/second', 'https://www.etymonline.com:8080/word/second', 'https://www.etymonline.com/word/second/extra']) {
      await update({ ...result, metadata: { etymologyUnavailable: [{ source: 'Etymonline', status: 'blocked', url: invalid }] } });
      assert.equal(await js(`document.querySelectorAll('[data-ety-open]').length`), 0, 'Invalid metadata must never create an external action');
    }
    assert.equal(opened.length, 1);
    if (process.argv.includes('--screenshot')) {
      // The README capture uses preserved real provider data, never regression prose.
      const sourceFile = path.join(root, 'out/etymology-source-audit/youdao-orientation.json');
      const live = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
      const liveGroups = groupYoudaoEtymologies(live.etym?.etyms);
      assert.ok(liveGroups.length, 'Real Youdao source capture is required for the README screenshot');
      result = { ...base('orientation'), etymology: serializeEtymologySources(liveGroups) };
      win.webContents.send('test-text', 'orientation', Date.now());
      await tick();
      await js(`lookupText('orientation', {force:true})`);
      await tick();
      await clickSource(liveGroups[0].label);
      await tick();
      fs.writeFileSync(path.join(root, 'README.assets/desktop-etymology-sources.png'), (await win.webContents.capturePage()).toPNG());
    }
    console.log('Etymology popup passed complete grouped passages, source/view tabs, blocked recovery action, late updates, provider recovery, new-word reset, keyboard navigation, and invalid URLs.');
  } finally {
    if (win && !win.isDestroyed()) win.close();
  }
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
