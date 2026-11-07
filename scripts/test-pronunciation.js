/**
 * IPA for English words that CMUdict and Wiktionary do not transcribe ("holon", "operon"):
 * Datamuse's `md=r` pronunciation (ARPAbet) becomes the US IPA, and the notebook reading
 * line shows it. Responses recorded from the live services on 2026-11-03 are in
 * scripts/fixtures/pronunciation; everything else answers 404.
 * Run: node scripts/test-pronunciation.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const CORE = path.join(__dirname, '..', 'packages', 'core', 'src');
const FIX = path.join(__dirname, 'fixtures', 'pronunciation');

require.extensions['.ts'] = function compileTs(module, filename) {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};
const core = (name) => require(path.join(CORE, name));
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

const { arpabetToIpa, isCmuWord } = core('cmu-ipa.ts');
const { extractIpaFromWikitext, formatPronunciationLine } = core('pronunciation.ts');

// The chips read like a learner's dictionary: British, then American, one each, the
// transcription most sources agree on leading, and one variant at most. The 'moratorium' list is
// what Free Dictionary, Wiktionary and Kaikki sent on 2026-11-07.
{
  const { tidyPronunciations, inferAccent, ipaKey } = core('pronunciation.ts');
  const shown = (list, lang = 'en') => tidyPronunciations(list, lang).map((p) => `${p.accent} ${p.ipa}`);
  assert.deepStrictEqual(shown([
    { ipa: 'ˌmɔ.ɹəˈtɔ.ɹi.əm', accent: 'us' },
    { ipa: 'ˌmɒ.ɹəˈtɔː.ɹi.əm', accent: 'uk' },
    { ipa: 'ˌmɔː.ɹəˈtɔː.ɹi.əm', accent: 'uk' },
    { ipa: 'ˌmɒ.ɹəˈtɔː.ɹɪəm', accent: 'other' },
    { ipa: 'ˌmɔː.ɹəˈtɔː.ɹɪəm', accent: 'other' },
  ]), ['uk ˌmɒ.ɹəˈtɔː.ɹi.əm', 'us ˌmɔ.ɹəˈtɔ.ɹi.əm'], 'the British /mɔː-/ only adds length marks to the American line');
  // A rare variant listed first loses to the one two sources give.
  assert.deepStrictEqual(shown([
    { ipa: 'ˈiː.ðə', accent: 'uk' },
    { ipa: 'ˈaɪ.ðə', accent: 'uk' },
    { ipa: 'ˈaɪðə', accent: 'uk' },
  ]), ['uk ˈaɪ.ðə', 'uk ˈiː.ðə']);
  // Unlabelled transcriptions are filed by their sounds; one that only repeats a shown one goes.
  assert.strictEqual(inferAccent('ˈhɒlən'), 'uk');
  assert.strictEqual(inferAccent('ˈkɑɹd'), 'us');
  assert.strictEqual(inferAccent('ˈhɑlɚ'), 'us');
  assert.strictEqual(inferAccent('ˈwɪmzi'), null);
  assert.strictEqual(ipaKey('ˌmɒ.ɹəˈtɔː.ɹɪəm'), ipaKey('mɒrəˈtɔːriəm'));
  assert.deepStrictEqual(shown([{ ipa: 'ˈwɪm.zi', accent: 'us' }, { ipa: 'ˈwɪmzi', accent: 'other' }]), ['us ˈwɪm.zi']);
  // Another language keeps its own transcriptions, with no accent read into a Spanish r.
  assert.deepStrictEqual(shown([{ ipa: 'aˈmor', accent: 'other' }, { ipa: 'aˈmoɾ', accent: 'other' }], 'es'), ['other aˈmor', 'other aˈmoɾ']);
}

// Datamuse writes ARPAbet with a trailing space, as its tags come.
assert.strictEqual(arpabetToIpa('HH AA1 L AH0 N '), 'ˈhɑlən');
assert.strictEqual(arpabetToIpa('OW0 P EH1 R AH0 N '), 'oʊˈpɛɹən');

(async () => {
  // The gap: CMUdict lacks both words and holon's Wiktionary page has no Pronunciation section.
  assert.strictEqual(await isCmuWord('holon'), false);
  assert.strictEqual(await isCmuWord('operon'), false);
  const wikitext = JSON.parse(fixture('wiktionary-wikitext-holon.json')).parse.wikitext['*'];
  assert.strictEqual(extractIpaFromWikitext(wikitext).filter((p) => p.ipa).length, 0, 'holon: no IPA on Wiktionary');

  const runtime = core('runtime.ts');
  const { DictionaryService } = core('dictionary.ts');
  const routes = [
    [/api\.datamuse\.com\/words\?sp=holon&md=dr/, () => fixture('datamuse-holon.json')],
    [/api\.datamuse\.com\/words\?sp=operon&md=dr/, () => fixture('datamuse-operon.json')],
    [/wiktionary\.org\/api\/rest_v1\/page\/definition\/holon$/, () => fixture('wiktionary-def-holon.json')],
    [/wiktionary\.org\/w\/api\.php\?action=parse&page=holon&/, () => fixture('wiktionary-wikitext-holon.json')],
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
  const persisted = new Map();
  runtime.configureCore({
    http,
    sha256Hex: () => 'x',
    lookupCache: {
      get: (k) => persisted.get(k) || null,
      set: (k, value, savedAt) => persisted.set(k, { value, savedAt }),
    },
  });
  const quiet = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};

  const settle = async (word) => {
    const service = new DictionaryService();
    let latest;
    const first = await service.lookup(word, 'auto', undefined, { skipEtymology: true, onUpdate: (r) => (latest = r) });
    await new Promise((r) => setTimeout(r, 400));
    return latest || first;
  };

  const holon = await settle('holon');
  assert.ok(holon.definitions.some((d) => /quasiparticle/.test(d.meaning)), 'holon: senses from the fixtures');
  assert.ok(seen.some((u) => u.includes('datamuse.com/words?sp=holon&md=dr')), 'Datamuse asked for the pronunciation');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(holon.pronunciations)),
    [{ ipa: 'ˈhɑlən', accent: 'us', source: 'Datamuse' }],
    'holon: US IPA from Datamuse',
  );
  // The notebook saves formatPronunciationLine(result.pronunciations) as the row's reading.
  assert.strictEqual(formatPronunciationLine(holon.pronunciations), 'US /ˈhɑlən/');

  // Datamuse IPA is the last resort: a Wiktionary or Free Dictionary transcription wins.
  routes.unshift([/api\.dictionaryapi\.dev\/api\/v2\/entries\/en\/operon/, () => JSON.stringify([
    { word: 'operon', phonetic: '/ˈɒpəˌɹɒn/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A unit of genetic material.' }] }] },
  ])]);
  const operon = await settle('operon');
  assert.ok(operon.pronunciations.every((p) => p.source !== 'Datamuse'), `operon: ${JSON.stringify(operon.pronunciations)}`);
  assert.ok(operon.pronunciations.some((p) => p.ipa === 'ˈɒpəˌɹɒn'));

  // A result saved before this fix, with senses but no IPA, is served from the disk cache for a
  // day at most, so the word gets its IPA on a later lookup.
  const [key, saved] = [...persisted.entries()].find(([, v]) => v.value.word === 'holon');
  const stale = JSON.parse(JSON.stringify(saved.value));
  delete stale.pronunciations;
  delete stale.pronunciation;
  persisted.set(key, { value: stale, savedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 });
  seen.length = 0;
  const again = await settle('holon');
  assert.ok(seen.length > 0, 'an old result without IPA is looked up again');
  assert.strictEqual(formatPronunciationLine(again.pronunciations), 'US /ˈhɑlən/');

  Object.assign(console, quiet);
  console.log('pronunciation ok');
  process.exit(0);
})().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
