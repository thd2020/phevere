/**
 * Multilingual sources and offline packs, checked against payloads saved from the
 * live services (scripts/fixtures/multilingual):
 *
 * - Jisho, OpenRussian and kaikki.org parsers and URL builders
 * - FreeDict TEI (whole file and streamed), JMdict, Kengdic and CC-CEDICT parsers
 * - the .xz decoder and tar reader the phone uses for FreeDict downloads
 * - the shared catalog and its language grouping
 * - a full dictionary lookup with HTTP served from the fixtures (Russian, Japanese,
 *   and the English-miss fallback for "Haus")
 *
 * Run: node scripts/test-multilingual-sources.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const CORE = path.join(__dirname, '..', 'packages', 'core', 'src');
const FIX = path.join(__dirname, 'fixtures', 'multilingual');

// Load packages/core TypeScript straight from source.
require.extensions['.ts'] = function compileTs(module, filename) {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};
const core = (name) => require(path.join(CORE, name));
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const json = (name) => JSON.parse(fixture(name));

const src = core('multilingual-sources.ts');
const langs = core('source-languages.ts');
const parsers = core('offline-pack-parsers.ts');
const catalog = core('offline-catalog.ts');
const { xzDecompress, isXz } = core('xz-decode.ts');
const { extractTar } = core('tar-extract.ts');

// ------------------------------------------------------------------ Jisho
{
  const taberu = src.parseJisho(json('jisho-taberu.json'), '食べる');
  assert.strictEqual(taberu.definitions[0].meaning, 'to eat');
  assert.strictEqual(taberu.definitions[0].partOfSpeech, 'verb');
  assert.strictEqual(taberu.definitions[0].source, 'Jisho');
  assert.ok(taberu.definitions.every((d) => !/chili oil/.test(d.meaning)), '食べるラー油 only contains the query');

  const polite = src.parseJisho(json('jisho-tabemashita.json'), 'たべました');
  assert.strictEqual(polite.definitions[0].meaning, 'to eat', 'たべました resolves to its dictionary form');

  const compound = src.parseJisho(json('jisho-youtaiou.json'), '要対応');
  assert.strictEqual(compound.definitions.length, 0, 'entries for 要 or 要求 must not answer 要対応');
  assert.ok(src.jishoUrl('食べる').endsWith('keyword=%E9%A3%9F%E3%81%B9%E3%82%8B'));
}

// ------------------------------------------------------------ OpenRussian
{
  const sobaki = src.parseOpenRussian(json('openrussian-sobaki.json'), 'собаки');
  assert.deepStrictEqual(
    sobaki.definitions.map((d) => [d.partOfSpeech, d.meaning]),
    [['noun', 'dog'], ['noun', '(computing) at sign (@); at symbol']],
    'an inflected form finds its lemma',
  );
  assert.ok(sobaki.examples.some((e) => /neighbours/.test(e)));
  const prefix = src.parseOpenRussian(json('openrussian-soba.json'), 'соба');
  assert.strictEqual(prefix.definitions.length, 0, 'prefix suggestions are not answers');
}

// ----------------------------------------------------------------- kaikki
{
  assert.strictEqual(
    src.kaikkiUrl('Haus', 'German'),
    'https://kaikki.org/dictionary/German/meaning/H/Ha/Haus.jsonl',
  );
  assert.strictEqual(
    src.kaikkiUrl('사랑', src.KAIKKI_ALL_LANGUAGES),
    'https://kaikki.org/dictionary/All%20languages%20combined/meaning/%EC%82%AC/%EC%82%AC%EB%9E%91/%EC%82%AC%EB%9E%91.jsonl',
  );
  assert.strictEqual(src.kaikkiLanguage('de'), 'German');
  assert.strictEqual(src.kaikkiLanguage('en'), null);
  assert.strictEqual(src.kaikkiLanguage('auto'), null);

  const haus = src.parseKaikki(fixture('kaikki-all-haus.jsonl'), { languages: src.KAIKKI_FALLBACK_LANGUAGES });
  const meanings = haus.definitions.map((d) => d.meaning);
  assert.ok(meanings.includes('house, building'), 'German senses kept');
  assert.ok(!meanings.includes('A surname'), 'English excluded from the fallback');
  assert.ok(haus.definitions.length < 12, 'Bavarian, Swabian and the other dialects are left out');
  assert.ok(haus.pronunciations && haus.pronunciations.length, 'IPA comes along');

  const sarang = src.parseKaikki(fixture('kaikki-ko-sarang.jsonl'), { languages: new Set(['ko']) });
  assert.ok(sarang.definitions.some((d) => /love/i.test(d.meaning)));
  assert.strictEqual(src.parseKaikki('<html>404</html>').definitions.length, 0);

  // Wiktionary editions in other languages, read through kaikki.org's extracts.
  assert.strictEqual(
    src.kaikkiUrl('dom', src.KAIKKI_ALL_LANGUAGES, 'ruwiktionary'),
    'https://kaikki.org/ruwiktionary/All%20languages%20combined/meaning/d/do/dom.jsonl',
  );
  assert.ok(src.editionServes('zh', 'en') && src.editionServes('zh', 'zh') && src.editionServes('zh', 'ja'), 'Chinese defines every language');
  assert.ok(src.editionServes('ru', 'ru') && !src.editionServes('ru', 'en'), 'Russian only for Russian');
  assert.ok(src.editionServes('ja', 'ja') && !src.editionServes('ja', 'zh'), 'Japanese only for Japanese');
  const zhOpts = { languages: new Set(['zh', 'lzh']), source: 'Chinese Wiktionary', order: 30, tagLabels: src.WIKTIONARY_EDITIONS.zh.tagLabels };
  const yue = src.parseKaikki(fixture('kaikki-zh-yue.jsonl'), zhOpts);
  assert.ok(yue.definitions.length > 0, '曰 has Chinese senses');
  assert.ok(yue.definitions.every((d) => d.source === 'Chinese Wiktionary'), 'senses carry the edition name');
  assert.ok(yue.definitions.some((d) => d.meaning.startsWith('〈书〉')), 'literary senses are marked 〈书〉');
  assert.ok(/[一-鿿]/.test(yue.definitions[0].meaning), 'definitions are in Chinese');
  const dom = src.parseKaikki(fixture('kaikki-ru-dom.jsonl'), { languages: new Set(['ru']), source: 'Russian Wiktionary' });
  assert.ok(dom.definitions.length > 0 && /[Ѐ-ӿ]/.test(dom.definitions[0].meaning), 'дом is defined in Russian');
  // 学生 on the Chinese edition only points to 學生; the fetcher follows that once.
  assert.strictEqual(src.parseKaikki(fixture('kaikki-zh-xuesheng.jsonl'), zhOpts).definitions.length, 0);
  assert.strictEqual(src.kaikkiRedirect(fixture('kaikki-zh-xuesheng.jsonl'), new Set(['zh'])), '學生');

  assert.ok(src.isNameOnlyGloss(json('wiktionary-haus.json').en[0].definitions[0].definition), 'HTML surname gloss');
  assert.ok(!src.isNameOnlyGloss('house, building'));
}

// ------------------------------------------------------- language hints
assert.ok(langs.looksJapaneseKanji('要対応'));
assert.ok(langs.looksJapaneseKanji('駅前'));
assert.ok(!langs.looksJapaneseKanji('学生'), 'shared Han words stay Chinese');
assert.ok(!langs.looksJapaneseKanji('对应'));
assert.ok(!langs.looksJapaneseKanji('食べる'), 'kana is detected elsewhere');

// --------------------------------------------------- xz, tar and FreeDict
{
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIX, 'freedict-sample.tar.xz')));
  assert.ok(isXz(bytes));
  const tar = xzDecompress(bytes);
  const files = extractTar(tar, (name) => catalog.wantsArchiveMember('freedict-tei', name));
  assert.deepStrictEqual(files.map((f) => f.path), ['sample-eng/sample-eng.tei']);
  const tei = Buffer.from(files[0].bytes).toString('utf8');
  assert.ok(tei.endsWith('</TEI>\n'), 'the whole file decoded');

  const rows = parsers.parseFreedictTei(tei, 'ru');
  assert.ok(rows.length > 300);
  const sobaka = rows.find((r) => r.headword === 'собака');
  assert.strictEqual(sobaka.language, 'ru');
  assert.ok(/^dog\b/.test(sobaka.definition));
  assert.ok(rows.some((r) => r.headword === 'Haus' && /\bhouse\b/.test(r.definition)));

  // The desktop streams the file line by line; odd chunk sizes must give the same rows.
  const streamed = [];
  const stream = new parsers.FreedictTeiStream('ru', (r) => streamed.push(...r));
  for (let i = 0; i < tei.length; i += 997) stream.push(tei.slice(i, i + 997));
  assert.deepStrictEqual(streamed, rows);
}

// ------------------------------------------------------------- JMdict
{
  const rows = parsers.parseJmdictJson(fixture('jmdict-sample.json'));
  const taberu = rows.filter((r) => r.headword === '食べる');
  assert.strictEqual(taberu.length, 1);
  assert.strictEqual(taberu[0].language, 'ja');
  assert.strictEqual(taberu[0].pos, 'verb');
  assert.ok(taberu[0].definition.startsWith('[たべる] to eat; to live on'));
  assert.ok(rows.some((r) => r.headword === '喰べる'), 'search-only spellings are kept for lookup');
  assert.ok(rows.some((r) => r.headword === 'たべる' && !r.definition.startsWith('[')));
  assert.strictEqual(rows.filter((r) => r.headword === '要').length >= 2, true, '要 has two entries');
}

// ------------------------------------------------------------ Kengdic
{
  const rows = parsers.parseKengdicTsv(fixture('kengdic-sample.tsv'));
  const sarang = rows.filter((r) => r.headword === '사랑');
  assert.strictEqual(sarang.length, 1);
  assert.strictEqual(sarang[0].definition, 'love', 'Love and love are one gloss');
  assert.strictEqual(sarang[0].language, 'ko');
  assert.strictEqual(rows.find((r) => r.headword === '대예언서').definition, 'the Major Prophets');
  assert.ok(!rows.some((r) => r.headword === '가가'), 'rows without a gloss are skipped');
}

// ------------------------------------------------------------ CC-CEDICT
{
  const rows = parsers.parseCedictLine('傳統 传统 [chuan2 tong3] /tradition/traditional/');
  assert.deepStrictEqual(rows.map((r) => r.headword), ['传统', '傳統']);
  assert.strictEqual(rows[0].definition, '[chuan2 tong3] tradition; traditional');
}

// ------------------------------------------------------------- catalog
{
  const phone = catalog.catalogFor('phone');
  const desktop = catalog.catalogFor('desktop');
  const ids = new Set(catalog.OFFLINE_CATALOG.map((p) => p.id));
  assert.strictEqual(ids.size, catalog.OFFLINE_CATALOG.length, 'ids are unique');
  assert.ok(desktop.some((p) => p.id === 'freedict-deu-eng') && !phone.some((p) => p.id === 'freedict-deu-eng'));
  assert.ok(desktop.some((p) => p.id === 'jmdict-eng') && phone.some((p) => p.id === 'jmdict-eng-common'));
  for (const p of catalog.OFFLINE_CATALOG) {
    assert.ok(p.urls.length && p.urls.every((u) => u.startsWith('https://')), p.id);
    assert.ok(p.sizeHint && p.consent && p.license, p.id);
  }
  const groups = catalog.groupCatalogByLanguage(phone).map((g) => g.title);
  assert.deepStrictEqual(groups.slice(0, 4), ['English', 'Chinese', 'Japanese', 'Korean']);
  const rest = groups.slice(4);
  assert.deepStrictEqual(rest, [...rest].sort(), 'other languages follow A to Z');
  assert.ok(groups.includes('Russian') && groups.includes('French'));
}

// ------------------------------------------- lookup with fixture HTTP
(async () => {
  const runtime = core('runtime.ts');
  const { DictionaryService } = core('dictionary.ts');
  const routes = [
    [/jisho\.org.*keyword=%E9%A3%9F/, () => fixture('jisho-taberu.json')],
    [/openrussian\.org.*q=%D1%81%D0%BE%D0%B1%D0%B0%D0%BA%D0%B8/, () => fixture('openrussian-sobaki.json')],
    [/kaikki\.org\/dictionary\/All%20languages%20combined\/meaning\/H\/Ha\/Haus\.jsonl/, () => fixture('kaikki-all-haus.jsonl')],
    [/kaikki\.org\/dictionary\/Korean\//, () => fixture('kaikki-ko-sarang.jsonl')],
    [/wiktionary\.org\/api\/rest_v1\/page\/definition\/Haus$/, () => fixture('wiktionary-haus.json')],
  ];
  const seen = [];
  const http = {
    async requestText(url) {
      seen.push(url);
      const hit = routes.find(([re]) => re.test(url));
      return hit ? { ok: true, status: 200, text: hit[1]() } : { ok: false, status: 404, text: '' };
    },
    async requestJson(url) {
      const r = await this.requestText(url);
      if (!r.ok) {
        const { DictionaryError } = core('base.ts');
        throw new DictionaryError(`HTTP ${r.status}`, `HTTP_${r.status}`, false);
      }
      return JSON.parse(r.text);
    },
    async requestBytes() {
      return { ok: false, status: 404, bytes: new Uint8Array(), contentType: '' };
    },
  };
  runtime.configureCore({ http, sha256Hex: () => 'x' });
  // The lookup logs every 404 the fixture server returns; keep the output to the verdict.
  const quiet = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};

  const settle = async (word) => {
    const service = new DictionaryService();
    let latest;
    const first = await service.lookup(word, 'auto', undefined, { skipEtymology: true, onUpdate: (r) => (latest = r) });
    await new Promise((r) => setTimeout(r, 400));
    return latest || first;
  };

  const ru = await settle('собаки');
  assert.ok(ru.sources.includes('OpenRussian'), `OpenRussian answers собаки: ${ru.sources}`);
  assert.ok(ru.definitions.some((d) => d.meaning === 'dog'));
  assert.ok(seen.some((u) => u.includes('kaikki.org/dictionary/Russian/')), 'kaikki asked for Russian');
  assert.ok(seen.some((u) => u.includes('/page/definition/')), 'Wiktionary asked');

  const ja = await settle('食べる');
  assert.ok(ja.sources.includes('Jisho'), `Jisho answers 食べる: ${ja.sources}`);
  assert.strictEqual(ja.detectedLanguage, 'ja');

  const ko = await settle('사랑');
  assert.ok(ko.sources.includes('Kaikki'), `kaikki answers 사랑: ${ko.sources}`);

  seen.length = 0;
  const haus = await settle('Haus');
  assert.ok(haus.sources.includes('Kaikki'), `kaikki fills in Haus: ${haus.sources}`);
  assert.ok(haus.definitions.some((d) => /house, building/.test(d.meaning)));

  // A word English sources know never reaches the fallback.
  routes.push([/dictionaryapi\.dev\/api\/v2\/entries\/en\/table/, () => JSON.stringify([
    { word: 'table', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'Furniture with a top surface.' }] }] },
  ])]);
  seen.length = 0;
  await settle('table');
  // Only the English page, for the word's forms; never the all-languages fallback.
  const kaikki = seen.filter((u) => u.includes('kaikki.org'));
  assert.ok(kaikki.every((u) => u.includes('/dictionary/English/')), `no fallback request for an English word: ${kaikki}`);

  Object.assign(console, quiet);
  console.log('multilingual sources ok');
  // The Chinese edition follows 学生 to 學生 through the soft redirect.
  {
    const pages = {
      [src.kaikkiUrl('学生', src.KAIKKI_ALL_LANGUAGES, 'zhwiktionary')]: fixture('kaikki-zh-xuesheng.jsonl'),
      [src.kaikkiUrl('學生', src.KAIKKI_ALL_LANGUAGES, 'zhwiktionary')]: fixture('kaikki-zh-xuesheng-trad.jsonl'),
    };
    const http = { requestText: async (url) => (pages[url] ? { ok: true, status: 200, text: pages[url] } : { ok: false, status: 404, text: '' }) };
    const senses = await src.fetchWiktionaryEdition(http, '学生', 'zh', 'zh');
    assert.ok(senses.definitions.some((d) => /讀書|學/.test(d.meaning)), '学生 gets the senses of 學生');
  }

  process.exit(0);
})().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
