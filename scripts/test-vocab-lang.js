/**
 * Sanity checks for packages/core/src/vocab-lang.ts
 * Run: node scripts/test-vocab-lang.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'src', 'vocab-lang.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require });
const { formatVocabLangPair, inferVocabGlossLang, vocabLanguages, filterVocabByLang, vocabLangChipsHtml, vocabHeadwordLang, vocabLookupLang, vocabLangKey, savedForSpelling } = mod.exports;

assert.strictEqual(
  formatVocabLangPair({
    sourceLang: 'en',
    targetLang: 'zh',
    definition: 'A spinning toy.',
    sources: ['Free Dictionary', 'Wiktionary'],
  }),
  'en → en',
);
assert.strictEqual(
  inferVocabGlossLang({
    sourceLang: 'zh',
    targetLang: 'en',
    definition: 'centrifuge',
    sources: ['CC-CEDICT'],
  }),
  'en',
);
assert.strictEqual(
  formatVocabLangPair({
    sourceLang: 'en',
    targetLang: 'zh',
    definition: '离心机',
    sources: ['Google'],
  }),
  'en → zh',
);
// Glosses from the Japanese and Russian Wiktionaries are tagged by their script.
assert.strictEqual(inferVocabGlossLang({ sourceLang: 'ja', targetLang: 'en', definition: '大学などで教育を受ける者。', sources: ['Japanese Wiktionary'] }), 'ja');
assert.strictEqual(inferVocabGlossLang({ sourceLang: 'ru', targetLang: 'en', definition: 'жилое здание', sources: ['Russian Wiktionary'] }), 'ru');
assert.strictEqual(inferVocabGlossLang({ sourceLang: 'zh', targetLang: 'en', definition: '在學校讀書的人', sources: ['Chinese Wiktionary'] }), 'zh');
// The Words language filter. A notebook like the author's: English, a few English phrases the
// detector filed under other languages, one Japanese word. Nothing to choose, so no chips.
const en = Array.from({ length: 40 }, (_, i) => ({ lemma: `word${i}`, sourceLang: 'en' }));
const misfiled = [{ lemma: 'a priori', sourceLang: 'it' }, { lemma: 'bindery', sourceLang: 'mg' }, { lemma: 'kerning' }];
const oneJa = [{ lemma: '学生', sourceLang: 'ja' }];
let langs = vocabLanguages([...en, ...misfiled, ...oneJa]);
assert.strictEqual(langs.groups.length, 0, 'one language worth a chip: no chip row');
assert.strictEqual(langs.langOf(misfiled[0]), 'en', 'a rare Latin-script language counts as English');
assert.strictEqual(vocabHeadwordLang({ lemma: 'собака' }), 'ru');
assert.strictEqual(vocabHeadwordLang({ lemma: 'たべる' }), 'ja');
assert.strictEqual(vocabLangChipsHtml(langs, 'all', 44, (c) => c), '');
// Three Chinese words make a second language: chips appear and the filter splits the list.
const zh = ['学生', '曰', '天气'].map((lemma) => ({ lemma }));
const all = [...en, ...misfiled, ...zh];
langs = vocabLanguages(all);
assert.strictEqual(JSON.stringify(langs.groups.map((g) => [g.code, g.count])), JSON.stringify([['en', 43], ['zh', 3]]));
assert.strictEqual(filterVocabByLang(all, 'zh', langs).length, 3);
assert.strictEqual(filterVocabByLang(all, 'en', langs).length, 43, 'misfiled phrases stay with English');
assert.strictEqual(filterVocabByLang(all, 'all', langs).length, all.length);
assert.strictEqual(filterVocabByLang(all, 'ko', langs).length, all.length, 'a language without a chip shows everything');
const html = vocabLangChipsHtml(langs, 'zh', all.length, (c) => ({ en: 'English', zh: 'Chinese' })[c]);
assert.ok(html.includes('data-lang="all"') && html.includes('Chinese') && /data-lang="zh"[^>]*aria-selected="true"/.test(html));
// The same spelling saved in two languages: a Recent row stands for the plain lookup's word, and the
// Danish one opens in Danish.
const giveEn = { id: 'e', lemma: 'give', sourceLang: 'en' };
const giveDa = { id: 'd', lemma: 'give', sourceLang: 'da' };
assert.strictEqual(savedForSpelling([giveDa, giveEn], 'Give'), giveEn);
assert.strictEqual(savedForSpelling([giveDa], 'give'), giveDa, 'the only saved give is the one shown');
assert.strictEqual(savedForSpelling([giveEn], 'take'), undefined);
assert.strictEqual(vocabLookupLang(giveDa), 'da');
assert.strictEqual(vocabLookupLang(giveEn), '');
assert.strictEqual(vocabLookupLang({ lemma: 'give' }), '', 'a word saved without a language opens as before');
assert.strictEqual(vocabLookupLang({ lemma: '食べる', sourceLang: 'ja' }), '');
assert.notStrictEqual(vocabLangKey(giveEn), vocabLangKey(giveDa));
assert.strictEqual(vocabLangKey({ lemma: 'Give ' }), vocabLangKey(giveEn), 'no language reads as the letters');
console.log('vocab-lang ok');
