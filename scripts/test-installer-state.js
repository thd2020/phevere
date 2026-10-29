// Used only by the disposable Windows-runner installer integration test.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const [action, userData, fixture] = process.argv.slice(2);
const sentinel = 'phevere-installer-upgrade-sentinel';
const row = ['installer-upgrade-fixture', 'upgrade-fixture', 'Keep this notebook entry', 'en', 'zh', 1720000000000, 1720000000000];

async function database() {
  const ts = require('typescript');
  const source = fs.readFileSync(path.join(__dirname, '../packages/core/src/schema.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const schema = { exports: {} };
  new Function('module', 'exports', compiled)(schema, schema.exports);
  const SQL = await require('sql.js')();
  const file = path.join(userData, 'phevere.sqlite');
  const db = action === 'seed' ? new SQL.Database() : new SQL.Database(fs.readFileSync(file));
  try {
    if (action === 'seed') {
      fs.mkdirSync(userData, { recursive: true });
      db.run(schema.exports.VOCAB_SCHEMA_SQL);
      db.run('INSERT INTO vocab (id, lemma, definition, source_lang, target_lang, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', row);
      fs.writeFileSync(file, Buffer.from(db.export()));
      fs.writeFileSync(path.join(userData, 'monitor-settings.json'), JSON.stringify({
        mode: 'off', hoverEnabled: false,
        cycleShortcut: 'CommandOrControl+Alt+Shift+M', triggerShortcut: 'CommandOrControl+Alt+Shift+Y',
        ocrShortcut: 'CommandOrControl+Shift+O', hoverShortcut: 'CommandOrControl+Shift+H',
      }, null, 2));
    } else {
      const result = db.exec('SELECT id, lemma, definition, source_lang, target_lang, created_at, updated_at FROM vocab WHERE id = ?', [row[0]]);
      assert.deepEqual(result[0]?.values, [row], 'The saved notebook entry changed during installation');
      assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'monitor-settings.json'), 'utf8')).mode, 'off');
    }
  } finally { db.close(); }
}

async function storage() {
  const { app, BrowserWindow } = require('electron');
  // Electron 28's GPU and sandboxed renderer crash on the 2026-10-21 Windows Server 2025 runner image.
  // This helper only seeds and reads localStorage; the installed app's own launches still run sandboxed.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
  app.setPath('userData', userData);
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
  await window.loadFile(fixture);
  if (action === 'storage-seed') {
    await window.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(sentinel)}, ${JSON.stringify(sentinel)})`);
  } else {
    assert.equal(await window.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(sentinel)})`), sentinel,
      'The Chromium localStorage sentinel was lost');
  }
  await window.webContents.session.flushStorageData();
  window.destroy();
  app.quit();
}

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('This test helper only runs in GitHub Actions');
if (!userData || !fixture) throw new Error('Expected action, userData and fixture arguments');
const operation = action.startsWith('storage-') ? storage : database;
operation().catch((error) => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
