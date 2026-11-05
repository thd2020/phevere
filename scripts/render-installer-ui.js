#!/usr/bin/env node
/**
 * Renders the Windows setup front end (packaging/installer-ui/InstallerUi.cs) to PNG files
 * without opening a window: the hero page and Custom options at the default and the minimum
 * window size, and Custom options as Windows ARM64 shows it. Windows only (.NET Framework csc).
 *
 *   node scripts/render-installer-ui.js            writes out/installer-ui-render/*.png
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.error('render-installer-ui needs Windows.');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const out = path.join(root, 'out', 'installer-ui-render');
const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const wpf = ['PresentationFramework', 'PresentationCore', 'WindowsBase'].map((name) => `/reference:${path.join(framework, 'WPF', `${name}.dll`)}`);
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
const exe = path.join(out, 'snapshot.exe');
const built = spawnSync(path.join(framework, 'csc.exe'), [
  '/nologo', '/target:winexe', '/platform:anycpu', `/out:${exe}`, '/main:InstallerUiSnapshot',
  '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Xaml.dll',
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', ...wpf,
  path.join(root, 'packaging', 'installer-ui', 'InstallerUi.cs'), path.join(__dirname, 'installer-ui-snapshot.cs'),
], { encoding: 'utf8', windowsHide: true });
if (built.status !== 0) {
  console.error(built.stdout || built.stderr);
  process.exit(1);
}
// The window loads its fonts and illustration from beside the executable, as Setup does.
const fonts = path.join(root, 'packaging', 'installer-ui', 'fonts');
for (const name of fs.readdirSync(fonts)) if (/\.ttf$/i.test(name)) fs.copyFileSync(path.join(fonts, name), path.join(out, 'fonts', name));
fs.copyFileSync(path.join(root, 'packaging', 'installerHero.bmp'), path.join(out, 'hero.bmp'));
fs.copyFileSync(path.join(root, 'packaging', 'icon.ico'), path.join(out, 'icon.ico'));

// Client sizes of the 840 x 640 default window and the 680 x 560 minimum.
const shots = [
  ['hero', 'x64', 824, 601],
  ['options', 'x64', 824, 601],
  ['options', 'x64', 664, 521],
  ['options', 'arm64', 824, 601],
];
let failed = false;
for (const [page, arch, width, height] of shots) {
  const file = path.join(out, `${page}-${arch}-${width}.png`);
  const run = spawnSync(exe, [file, page, arch, String(width), String(height), require('../package.json').version], { encoding: 'utf8', windowsHide: true });
  failed = failed || run.status !== 0;
  console.log(run.status === 0 ? file : `${file} failed: ${run.stderr || run.status}`);
}
process.exit(failed ? 1 : 0);
