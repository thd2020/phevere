/**
 * The interface catalogue: every language has every English key, the same placeholders and the
 * plural forms its own CLDR rules use, and the runtime picks forms and formats numbers through Intl.
 * Run: node scripts/test-i18n-catalog.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const i18nDir = path.join(root, 'packages', 'core', 'src', 'i18n');
const cache = new Map();

/** Load a TS module (and the TS modules it imports) transpiled to CommonJS. */
function load(file) {
  const resolved = fs.existsSync(file + '.ts') ? file + '.ts' : path.join(file, 'index.ts');
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const js = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(resolved, mod);
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (dep) => (dep.startsWith('.') ? load(path.resolve(path.dirname(resolved), dep)) : require(dep)));
  return mod.exports;
}

const { UI_LOCALES, UI_LOCALE_NAMES, resolveUiLocale, matchUiLocale } = load(path.join(i18nDir, 'locales'));
const runtime = load(path.join(i18nDir, 'runtime'));
const { EN } = load(path.join(i18nDir, 'en'));

const namespaces = fs
  .readdirSync(path.join(i18nDir, 'en'))
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .map((f) => f.replace(/\.ts$/, ''));

const placeholders = (s) => new Set((String(s).match(/\{(\w+)\}/g) || []).map((p) => p.slice(1, -1)));
const isPlural = (m) => m && typeof m === 'object';
const forms = (m) => (isPlural(m) ? Object.values(m) : [m]);

// English: each file's keys start with its own name, so two areas never take the same key.
{
  const seen = new Set();
  for (const ns of namespaces) {
    const messages = load(path.join(i18nDir, 'en', ns)).default;
    for (const [key, message] of Object.entries(messages)) {
      assert.ok(key.startsWith(`${ns}.`), `en/${ns}.ts: ${key} starts with "${ns}."`);
      assert.ok(!seen.has(key), `${key} is defined once`);
      seen.add(key);
      for (const f of forms(message)) assert.ok(typeof f === 'string' && f.trim(), `${key} has text`);
      assert.ok(!/<[a-z/][^>]*>/i.test(forms(message).join(' ')), `${key} holds no markup`);
      if (isPlural(message)) {
        assert.deepEqual(Object.keys(message).sort(), ['one', 'other'], `${key}: English plurals have one and other`);
        assert.ok(placeholders(message.other).has('count'), `${key}: the other form shows {count}`);
      }
    }
  }
  assert.equal(seen.size, Object.keys(EN).length, 'en/index.ts spreads every area');
}

// Each language: the same files, every key, the same placeholders, its own plural forms.
const report = [];
for (const locale of UI_LOCALES.filter((l) => l !== 'en')) {
  const dir = path.join(i18nDir, locale);
  const index = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.ok(!/from '\.\.\/en'/.test(index), `${locale}: translated, not a copy of English`);
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories.slice().sort();
  const all = load(dir).default;
  let same = 0;
  let total = 0;
  for (const ns of namespaces) {
    const file = path.join(dir, `${ns}.ts`);
    assert.ok(fs.existsSync(file), `${locale}/${ns}.ts exists`);
    const messages = load(path.join(dir, ns)).default;
    const english = load(path.join(i18nDir, 'en', ns)).default;
    const missing = Object.keys(english).filter((k) => !(k in messages));
    const extra = Object.keys(messages).filter((k) => !(k in english));
    assert.deepEqual(missing, [], `${locale}/${ns}.ts misses keys`);
    assert.deepEqual(extra, [], `${locale}/${ns}.ts has keys English does not`);
    for (const [key, en] of Object.entries(english)) {
      const tr = messages[key];
      assert.equal(isPlural(tr), isPlural(en), `${locale} ${key}: plural like English`);
      for (const f of forms(tr)) assert.ok(typeof f === 'string' && f.trim(), `${locale} ${key} has text`);
      assert.ok(!/<[a-z/][^>]*>/i.test(forms(tr).join(' ')), `${locale} ${key} holds no markup`);
      const want = new Set(forms(en).flatMap((f) => [...placeholders(f)]));
      if (isPlural(tr)) {
        const have = Object.keys(tr).filter((c) => c !== 'zero').sort();
        assert.deepEqual(have, categories, `${locale} ${key}: plural forms ${categories.join(', ')}`);
        for (const [cat, f] of Object.entries(tr)) {
          const got = placeholders(f);
          for (const p of want) {
            // "one" may spell its number out ("un mot", "одно слово"); every other placeholder stays.
            if (p === 'count' && cat !== 'other' && cat !== 'many' && cat !== 'few') continue;
            assert.ok(got.has(p), `${locale} ${key}.${cat} keeps {${p}}`);
          }
          for (const p of got) assert.ok(want.has(p), `${locale} ${key}.${cat}: {${p}} is not an English placeholder`);
        }
      } else {
        assert.deepEqual([...placeholders(tr)].sort(), [...want].sort(), `${locale} ${key}: placeholders`);
      }
      total += 1;
      if (JSON.stringify(tr) === JSON.stringify(en) && /[a-z]{3}/.test(forms(en).join(' '))) same += 1;
    }
  }
  assert.equal(Object.keys(all).length, Object.keys(EN).length, `${locale}/index.ts spreads every area`);
  report.push(`${locale} ${same}/${total} same as English`);
  // Names, versions and codes stay as written, but a catalogue that is mostly English is not a translation.
  assert.ok(same / total < 0.12, `${locale}: ${same} of ${total} messages are left in English`);
}

// Choosing a locale from the system's languages.
{
  assert.equal(resolveUiLocale('system', ['de-AT', 'en-US']), 'de');
  assert.equal(resolveUiLocale('system', ['sv-SE', 'fr-CA']), 'fr');
  assert.equal(resolveUiLocale('system', ['sv-SE']), 'en');
  assert.equal(resolveUiLocale('ja', ['de-DE']), 'ja');
  assert.equal(resolveUiLocale(undefined, []), 'en');
  assert.equal(matchUiLocale('zh-Hant-HK'), 'zh-TW');
  assert.equal(matchUiLocale('zh-HK'), 'zh-TW');
  assert.equal(matchUiLocale('zh-SG'), 'zh-CN');
  assert.equal(matchUiLocale('zh'), 'zh-CN');
  assert.equal(matchUiLocale('zh_TW'), 'zh-TW');
  assert.equal(matchUiLocale('pt-PT'), 'pt-BR');
  assert.equal(matchUiLocale('es-MX'), 'es');
  assert.equal(matchUiLocale('nonsense!'), null);
  assert.deepEqual(Object.keys(UI_LOCALE_NAMES), [...UI_LOCALES]);
}

// Plurals and numbers come from Intl.
(async () => {
  const pluralKey = Object.keys(EN).find((k) => isPlural(EN[k]) && placeholders(EN[k].other).size === 1);
  if (pluralKey) {
    runtime.useUiCatalog('en', EN);
    assert.match(runtime.t(pluralKey, { count: 1 }), /1/);
    assert.match(runtime.t(pluralKey, { count: 1234 }), /1,234/);
  }
  runtime.useUiCatalog('de', EN);
  assert.equal(runtime.formatNumber(1234.5), '1.234,5');
  assert.equal(runtime.formatPercent(0.42), '42 %');
  runtime.useUiCatalog('en', EN);
  assert.equal(runtime.tHtml('common.copy'), 'Copy');
  assert.equal(runtime.t('nope.missing'), 'nope.missing');
  console.log(report.join('\n'));
  console.log('test-i18n-catalog: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
