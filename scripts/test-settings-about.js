/* Run: node scripts/test-settings-about.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const coreDir = path.join(root, 'packages', 'core', 'src');
const cache = new Map();

/** Load a core TS module and the core modules it imports, transpiled to CommonJS. */
function load(name) {
  const base = path.join(coreDir, name.replace(/^\.\//, ''));
  const file = fs.existsSync(base + '.ts') ? base + '.ts' : path.join(base, 'index.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (dep) => (dep.startsWith('.') ? load(path.relative(coreDir, path.resolve(path.dirname(file), dep))) : require(dep)));
  return mod.exports;
}

const about = load('settings-about');
const runtime = load('i18n/runtime');
const { EN } = load('i18n/en');

// The version comes from the host; nothing in the page is a fixed version.
{
  const src = fs.readFileSync(path.join(coreDir, 'settings-about.ts'), 'utf8');
  const shipped = require(path.join(root, 'package.json')).version;
  assert.ok(!src.includes(`'${shipped}'`), 'no version number written into the About page');
  const html = about.aboutSettingsHtml({ version: '9.8.7', build: '1234', platform: 'android', system: 'Android 14' });
  assert.match(html, /Version 9\.8\.7 \(1234\)/);
  assert.match(html, /data-copy="Phevere 9\.8\.7 \(1234\)\nAndroid 14"/);
  assert.match(about.aboutSettingsHtml({ version: '', platform: 'web' }), /Development build/);
  assert.equal(about.aboutVersionLabel({ version: '4.2.0', platform: 'windows' }), 'Version 4.2.0');
}

// The iOS app's own version (CFBundleShortVersionString) is apps/mobile/package.json's, as
// Android's versionName is: every iOS build in CI passes it to xcodebuild.
{
  for (const wf of ['release.yml', 'ci.yml']) {
    const yml = fs.readFileSync(path.join(root, '.github', 'workflows', wf), 'utf8').replace(/\r\n/g, '\n');
    const builds = yml.split(/\n\s*xcodebuild \\\n/).slice(1).map((s) => s.slice(0, s.search(/\n\s+build\n/)));
    assert.ok(builds.length > 0, `${wf} builds iOS`);
    for (const b of builds) assert.match(b, /MARKETING_VERSION="\$\(node -p "require\('\.\.\/\.\.\/package\.json'\)\.version"\)"/, wf);
  }
}

// The star invitation, the repository and the other links.
{
  const html = about.aboutSettingsHtml({ version: '4.2.0', platform: 'windows', system: 'Windows 10.0.19044 x64' });
  assert.match(html, /class="sv-btn sv-btn--accent" href="https:\/\/github\.com\/thd2020\/phevere"[^>]*>.*Star on GitHub/s);
  for (const url of ['/blob/main/CHANGELOG.md', '/blob/main/LICENSE', '/issues/new?body=']) {
    assert.ok(html.includes(`https://github.com/thd2020/phevere${url}`), url);
  }
  // Every link carries the hook the phone uses to open the system browser.
  const anchors = html.match(/<a [^>]*>/g) || [];
  assert.ok(anchors.length > 20);
  for (const a of anchors) assert.match(a, /target="_blank"[^>]*data-act="about-link" data-url="https?:/, a);
  const issue = new URL(about.aboutIssueUrl({ version: '4.2.0', platform: 'macos', system: 'macOS 14.5 arm64' }));
  assert.match(issue.searchParams.get('body'), /---\nPhevere 4\.2\.0\nmacOS 14\.5 arm64$/);
}

// Credits: CC BY-SA works name the licence and link to it; platform-only works stay on their platform.
{
  const ids = (p) => about.aboutCredits(p).map((c) => c.id);
  assert.ok(ids('windows').includes('ppocr'));
  assert.ok(!ids('android').includes('ppocr'), 'no desktop text-recognition models on the phone');
  assert.ok(ids('android').includes('espeak'));
  // The Neural voices' engine reads text through eSpeak NG, so iOS bundles it too.
  assert.ok(ids('ios').includes('espeak'));
  assert.ok(!ids('web').includes('espeak'));
  assert.match(about.aboutSettingsHtml({ version: '4.2.0', platform: 'ios' }), /eSpeak NG<\/a>\s*<span class="sv-row__sub">Pronunciation for the Neural voices</)
  assert.ok(!ids('web').includes('kokoro'), 'no voice downloads in the browser build');
  for (const c of about.ABOUT_CREDITS) {
    assert.ok(EN[`settings.about.provides.${c.id}`], `${c.id} says what it provides`);
    assert.ok(c.licence || c.licenceText, `${c.id} names its licence`);
  }
  const wiktionary = about.ABOUT_CREDITS.find((c) => c.id === 'wiktionary');
  assert.equal(wiktionary.licence.url, 'https://creativecommons.org/licenses/by-sa/4.0/');
  const html = about.aboutSettingsHtml({ version: '4.2.0', platform: 'linux' });
  assert.match(html, /Wiktionary<\/a>[\s\S]*?CC BY-SA 4\.0<\/a>/);
}

// Every string a person reads comes from the catalogue, so a translation covers the page: with
// every message replaced by a marker, no other text is left on the page.
{
  const marker = Object.fromEntries(
    Object.entries(EN).map(([k, v]) => [k, typeof v === 'string' ? `«${k}»` : Object.fromEntries(Object.keys(v).map((form) => [form, `«${k}»`]))]),
  );
  marker['settings.about.version'] = '«settings.about.version {version}»';
  marker['settings.about.versionBuild'] = '«settings.about.versionBuild {version} {build}»';
  runtime.useUiCatalog('de', marker);
  const html = about.aboutSettingsHtml({ version: '4.2.0', build: '7', platform: 'windows' });
  runtime.useUiCatalog('en', EN);
  assert.match(html, /«settings\.about\.versionBuild 4\.2\.0 7»/);
  const text = html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const names = new Set([...about.ABOUT_CREDITS.filter((c) => !c.nameKey).map((c) => c.name), ...about.ABOUT_CREDITS.map((c) => c.licence && c.licence.name), ...about.ABOUT_SERVICES.map((s) => s.name), ',']);
  const leftover = text.filter((s) => !s.includes('«') && !names.has(s) && !['Phevere', 'GitHub', 'MIT', 'thd2020'].includes(s));
  assert.deepEqual(leftover, [], 'untranslatable text on the About page');
}

// The phone's system name for a bug report.
{
  assert.equal(about.systemFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'), 'Android 14');
  assert.equal(about.systemFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X)'), 'iOS 17.2.1');
  assert.equal(about.systemFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), '');
}

console.log('test-settings-about: ok');
