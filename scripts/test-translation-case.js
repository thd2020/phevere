/**
 * The case of short translations (packages/core/src/translation-case.ts): a word or short phrase
 * whose source is lower case or uncased comes back in lower case ("apple" for 苹果, "cat" for
 * French "chat"), while names, languages, days, acronyms, "I" and sentences keep the engine's
 * capitals. The engine answers below are what Google Translate and MyMemory return for these
 * words, and the Wiktionary pages are shortened copies of en.wiktionary.org's REST
 * definitions (fetched 2026-11-06).
 *
 * Run: node scripts/test-translation-case.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const compiled = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../packages/core/src/index.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  nodePaths: [path.join(__dirname, '../node_modules')],
  external: ['cmu-pronouncing-dictionary'],
}).outputFiles[0].text;
const script = new vm.Script(compiled);

const link = (title, text = title) => `<a rel="mw:WikiLink" href="/wiki/${encodeURIComponent(title)}" title="${title}">${text}</a>`;
const entry = (language, partOfSpeech, ...definitions) => ({ partOfSpeech, language, definitions: definitions.map((definition) => ({ definition })) });

/** en.wiktionary.org/api/rest_v1/page/definition/<title>, shortened. Titles not listed are 404. */
const wiktionary = {
  苹果: { ja: [entry('Japanese', 'Noun', `${link('apple')} (fruit)`)] },
  北京: {
    zh: [entry('Chinese', 'Proper noun', '', `(～市) ${link('Beijing')} (a direct-administered municipality, the capital city of China)`)],
    ja: [entry('Japanese', 'Proper noun', `${link('Beijing')} (the capital city of China)`)],
  },
  五月: { zh: [entry('Chinese', 'Noun', link('May'), 'modern name for the fifth month of the Chinese lunar calendar')] },
  我: { ja: [entry('Japanese', 'Pronoun', 'first person singular pronoun: I, me, oneself', 'second person singular pronoun: you')] },
  猫: { ja: [entry('Japanese', 'Noun', `a ${link('cat')}`)] },
  星期一: { zh: [entry('Chinese', 'Noun', link('Monday'))] },
  中国: { ja: [entry('Japanese', 'Proper noun', `${link('China')} any of several kingdoms, empires, or states of the Chinese people`)] },
  china: { en: [entry('English', 'Noun', 'Synonym of porcelain, a hard white translucent ceramic made from kaolin.', 'Chinaware: porcelain tableware.')] },
  chat: {
    en: [entry('English', 'Verb', 'To be engaged in informal conversation.')],
    fr: [entry('French', 'Noun', `${link('cat')} (feline)`, `(male) ${link('cat')}, tom, tomcat`), entry('French', 'Noun', 'chat (online discussion)')],
  },
  Hund: { de: [entry('German', 'Noun', `${link('dog')}, ${link('hound')}`, 'scoundrel; dog (mean or morally reprehensible person)')] },
  Apple: {
    en: [
      entry('English', 'Proper noun', `Nickname for ${link('New York City')}: a major city in New York, United States`, 'A female given name from English.'),
      entry('English', 'Noun', 'A computer produced by the company Apple Inc.'),
    ],
  },
  apple: { en: [entry('English', 'Noun', 'A common, firm, round fruit produced by a tree of the genus Malus.'), entry('English', 'Verb', 'To make (something) appear like an apple.')] },
  Beijing: { en: [entry('English', 'Proper noun', '', 'A direct-administered municipality, the capital city of China.')] },
  Monday: { en: [entry('English', 'Noun', '', 'The second day of the week in many religious traditions.'), entry('English', 'Adverb', 'On Monday.')] },
  English: {
    en: [
      entry('English', 'Adjective', '', `Of or pertaining to ${link('England')}.`),
      entry('English', 'Proper noun', '', 'The language that developed in England.'),
    ],
  },
  english: {
    en: [
      entry('English', 'Noun', '', 'Spinning or rotary motion given to a ball around the vertical axis, as in pool.'),
      entry('English', 'Verb', '', `Alternative form of <a rel="mw:WikiLink" href="/wiki/English#English:_render_into_English" title="English">English</a>.`),
    ],
  },
  London: { en: [entry('English', 'Proper noun', '', 'The capital city of the United Kingdom.')] },
  Cat: {
    en: [
      entry('English', 'Proper noun', 'A diminutive of the female given names Catherine and Caitlin.'),
      entry('English', 'Noun', 'A piece of heavy machinery, such as a backhoe or bulldozer, of the Caterpillar brand.'),
    ],
  },
  cat: { en: [entry('English', 'Noun', 'An animal of the family Felidae.')] },
  Me: { en: [entry('English', 'Noun', 'Abbreviation of methyl.'), entry('English', 'Proper noun', 'Windows Me (Millennium Edition).')] },
  me: { en: [entry('English', 'Pronoun', 'The first-person singular, as the object (of a verb, preposition, etc).')] },
  Nasa: { en: [entry('English', 'Proper noun', `Alternative letter-case form of ${link('NASA')}.`)] },
  Pomme: { fr: [entry('French', 'Proper noun', 'a female given name')] },
  pomme: {
    fr: [
      entry('French', 'Noun', `${link('apple')} (fruit)`),
      entry('French', 'Verb', 'first-person singular present indicative/subjunctive of pommer'),
    ],
  },
  Chine: { fr: [entry('French', 'Proper noun', `${link('China')} (a country in Asia)`)] },
  chine: { fr: [entry('French', 'Verb', `inflection of ${link('chiner')}:`, 'first/third-person singular present indicative/subjunctive')] },
  eating: { en: [entry('English', 'Verb', 'present participle and gerund of eat'), entry('English', 'Noun', 'The act of consuming food.')] },
};

/**
 * What the engines answered on 2026-11-06 (source|target → text). Google's free endpoint already
 * follows the source's case for most words; MyMemory starts nearly every answer with a capital.
 */
const engine = {
  google: {
    '苹果|en': 'apple', '北京|en': 'Beijing', '五月|en': 'May', '我|en': 'I', '猫|en': 'cat', '星期一|en': 'Monday',
    '英语|en': 'English', '伦敦|en': 'London', 'chat|en': 'cat', 'Hund|en': 'Dog', '美国宇航局|en': 'NASA', '吃苹果|en': 'eat apple',
    '纽约|en': 'New York', 'apple|fr': 'pomme', 'apple|de': 'Apfel', '中国|fr': 'Chine', '中国|en': 'China', '我很好。|en': 'I am fine.',
  },
  mymemory: {
    '苹果|en': 'Apple', '北京|en': 'Beijing', '五月|en': 'May', '我|en': 'Me', '猫|en': 'Cat', '英语|en': 'English',
    '伦敦|en': 'London', 'chat|en': 'cat', 'Hund|en': 'Dog', '美国宇航局|en': 'Nasa', '苹果手机|en': 'iPhone',
    '吃苹果|en': 'Eating apples', '纽约|en': 'New York', 'apple|de': 'Apfel', '中国|fr': 'Chine', '中国|en': 'China',
  },
};
const isoOf = (l) => (l === 'zh-CN' ? 'zh' : l);

/** A fresh copy of core on a fake network. `down`: hosts that never answer. */
function app({ down = [] } = {}) {
  const mod = { exports: {} };
  script.runInContext(vm.createContext({
    module: mod, exports: mod.exports, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    require: (name) => (name === 'cmu-pronouncing-dictionary' ? { dictionary: {} } : require(name)),
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Date, Error, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Intl,
  }));
  const core = mod.exports;
  const notFound = () => new core.DictionaryError('HTTP 404', 'HTTP_404', false);
  const asked = [];
  const answer = (u, o) => {
    if (u.hostname === 'en.wiktionary.org' && u.pathname.startsWith('/api/rest_v1/page/definition/')) {
      const title = decodeURIComponent(u.pathname.slice('/api/rest_v1/page/definition/'.length));
      asked.push(title);
      if (wiktionary[title]) return JSON.parse(JSON.stringify(wiktionary[title]));
      throw notFound();
    }
    if (u.hostname === 'translate.googleapis.com' && u.pathname === '/translate_a/t') {
      // The list endpoint a scan uses: one [translation, language] per q.
      return new URLSearchParams(String((o && o.body) || '')).getAll('q').map((q) => {
        const text = engine.google[`${q}|${isoOf(u.searchParams.get('tl'))}`];
        if (!text) throw notFound();
        return [text, /[一-鿿]/.test(q) ? 'zh' : 'de'];
      });
    }
    if (u.hostname === 'translate.googleapis.com') {
      const text = engine.google[`${u.searchParams.get('q')}|${isoOf(u.searchParams.get('tl'))}`];
      if (!text) throw notFound();
      return u.pathname === '/translate_a/single' ? [[[text, u.searchParams.get('q'), null, null]], null, u.searchParams.get('sl')] : [text];
    }
    if (u.hostname === 'api.mymemory.translated.net') {
      const [, to] = String(u.searchParams.get('langpair')).split('|');
      const text = engine.mymemory[`${u.searchParams.get('q')}|${isoOf(to)}`];
      if (!text) throw notFound();
      return { responseStatus: 200, responseData: { translatedText: text } };
    }
    throw notFound();
  };
  const reach = async (url, o) => {
    const u = new URL(url);
    if (down.includes(u.hostname)) {
      await new Promise((r) => setTimeout(r, (o && o.timeoutMs) || 8000));
      throw new core.DictionaryError('Request failed: timed out', 'NETWORK_ERROR', true);
    }
    await new Promise((r) => setTimeout(r, 5));
    return answer(u, o);
  };
  const saved = new Map();
  core.configureCore({
    sha256Hex: (t) => t,
    http: {
      requestJson: (url, o) => reach(url, o),
      requestText: async (url, o) => {
        try {
          return { ok: true, status: 200, text: JSON.stringify(await reach(url, o)) };
        } catch (e) {
          if (e && e.code !== 'HTTP_404') throw e;
          return { ok: false, status: 404, text: '' };
        }
      },
      requestBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: '' }),
    },
    lookupCache: { get: (k) => saved.get(k) || null, set: (k, value, savedAt) => saved.set(k, { value, savedAt }) },
    lookupOffline: async () => [],
  });
  return { core, service: new core.DictionaryService(), asked, saved };
}

const { core } = app();
const { capitalBelongsByWiktionary } = core;
// Plain objects, so deepEqual does not compare the prototypes of core's own context.
const caseVerdict = (...args) => JSON.parse(JSON.stringify(core.caseVerdict(...args)));

// The text alone decides these.
const keep = [
  ['Chat', 'Chat', 'fr', 'en', 'a capitalised source keeps the capital'],
  ['APPLE', 'APPLE', 'en', 'fr', 'a source written in capitals keeps the engine\'s casing'],
  ['美国宇航局', 'NASA', 'zh', 'en', 'an acronym'],
  ['脱氧核糖核酸', 'DNA', 'zh', 'en', 'an acronym'],
  ['苹果手机', 'iPhone', 'zh', 'en', 'inner capitals'],
  ['麦当劳', "McDonald's", 'zh', 'en', 'inner capitals'],
  ['我', 'I', 'zh', 'en', 'the pronoun I'],
  ['我是', "I'm", 'zh', 'en', 'the pronoun I in a contraction'],
  ['纽约', 'New York', 'zh', 'en', 'a later capitalised word marks a name'],
  ['北京大学', 'Peking University', 'zh', 'en', 'a later capitalised word marks a name'],
  ['apple', 'Apfel', 'en', 'de', 'German capitalises every noun'],
  ['我很好。', 'I am fine.', 'zh', 'en', 'a sentence (it ends with a full stop)'],
  ['the cat sat on the mat and looked around', 'Le chat s\'est assis sur le tapis', 'en', 'fr', 'a sentence (five words or more)'],
  ['这是一个很长的句子我们今天去公园散步了', 'This is a long sentence, we went to the park today', 'zh', 'en', 'a sentence (more than twelve characters)'],
  ['apple', '苹果', 'en', 'zh', 'a target without letter case'],
  ['apple', 'apple', 'en', 'fr', 'already lower case'],
];
for (const [src, tr, sl, tl, why] of keep) {
  assert.deepEqual(caseVerdict(src, tr, sl, tl), { kind: 'keep' }, `${src} → ${tr} keeps its case: ${why}`);
}
// "Hund" is capitalised because German capitalises nouns, so it is no evidence of a name.
assert.equal(caseVerdict('Hund', 'Dog', 'de', 'en').kind, 'ask', 'a German noun is treated as uncased');
assert.deepEqual(caseVerdict('HUND', 'DOG', 'de', 'en'), { kind: 'keep' }, 'German written in capitals keeps them');
assert.deepEqual(caseVerdict('苹果', 'Apple', 'zh', 'en'), { kind: 'ask', word: 'Apple', lowered: 'apple' }, '苹果 → Apple asks about Apple');
assert.deepEqual(caseVerdict('吃苹果', 'Eating apples', 'zh', 'en'), { kind: 'ask', word: 'Eating', lowered: 'eating apples' }, 'only the first letter is lowered');
assert.deepEqual(caseVerdict('chat', '"Cat"', 'fr', 'en'), { kind: 'ask', word: 'Cat', lowered: '"cat"' }, 'the letter after an opening quote is lowered');
assert.equal(caseVerdict('çok', 'Ölçek', 'tr', 'de').kind, 'keep', 'German target');
assert.equal(caseVerdict('ağaç', 'İyi', 'tr', 'tr-TR').kind, 'ask', 'Turkish target');
assert.equal(caseVerdict('ağaç', 'İyi', 'tr', 'tr').lowered, 'iyi', 'Turkish dotted capital I lowers to i');
assert.equal(caseVerdict('собака', 'Собака', 'ru', 'ru').lowered, 'собака', 'Cyrillic');
assert.equal(caseVerdict('dog', 'Σκύλος', 'en', 'el').lowered, 'σκύλος', 'Greek');

// Wiktionary decides whether the capital of a translation's first word belongs to it.
const page = (t) => (t in wiktionary ? wiktionary[t] : null);
const decide = (src, word, sl, tl) => {
  const lower = word.charAt(0).toLowerCase() + word.slice(1);
  return capitalBelongsByWiktionary(word, tl, sl, { sourcePage: tl === 'en' ? page(src) : undefined, ownPage: page(word), lowerPage: page(lower) });
};
const belongs = [
  ['苹果', 'Apple', 'zh', 'en', false, 'the source is glossed "apple"'],
  ['北京', 'Beijing', 'zh', 'en', true, 'the source is glossed "Beijing"'],
  ['五月', 'May', 'zh', 'en', true, 'the source is glossed "May"'],
  ['我', 'Me', 'zh', 'en', false, 'the source is glossed "I, me"'],
  ['猫', 'Cat', 'ja', 'en', false, 'the source is glossed "a cat"'],
  ['星期一', 'Monday', 'zh', 'en', true, 'the source is glossed "Monday"'],
  ['中国', 'China', 'zh', 'en', true, 'the source is glossed "China", though "china" (porcelain) is a word'],
  ['chat', 'Cat', 'fr', 'en', false, 'the French entry is glossed "cat"'],
  ['Hund', 'Dog', 'de', 'en', false, 'the German entry is glossed "dog, hound"'],
  ['英语', 'English', 'zh', 'en', true, 'no source page; "english" is an alternative form of English'],
  ['伦敦', 'London', 'zh', 'en', true, 'no source page; "london" has no page'],
  ['美国宇航局', 'Nasa', 'zh', 'en', true, 'no source page; "nasa" has no English entry'],
  ['吃苹果', 'Eating', 'zh', 'en', false, 'no source page; "eating" is a word'],
  ['apple', 'Pomme', 'en', 'fr', false, '"pomme" is a French noun'],
  ['中国', 'Chine', 'zh', 'fr', true, '"chine" is only a form of chiner, and Chine (China) is a name'],
];
for (const [src, word, sl, tl, want, why] of belongs) {
  assert.equal(decide(src, word, sl, tl), want, `${src} → ${word}: ${why}`);
}
assert.equal(capitalBelongsByWiktionary('Apple', 'en', 'zh', {}), undefined, 'no pages, no answer');
assert.equal(capitalBelongsByWiktionary('Apple', 'en', 'zh', { sourcePage: null, ownPage: page('Apple') }), undefined, 'the lower-case page did not load');

// Through the dictionary service: quick translation and a lookup's Translation tab.
(async () => {
  const { service, asked, saved } = app();
  // [text, from, to, engine, what the engine says, what the reader sees]
  const cases = [
    ['苹果', 'zh', 'en', 'mymemory', 'Apple', 'apple'],
    ['我', 'zh', 'en', 'mymemory', 'Me', 'me'],
    ['猫', 'ja', 'en', 'mymemory', 'Cat', 'cat'],
    ['Hund', 'de', 'en', 'mymemory', 'Dog', 'dog'],
    ['Hund', 'de', 'en', 'google', 'Dog', 'dog'],
    ['吃苹果', 'zh', 'en', 'mymemory', 'Eating apples', 'eating apples'],
    ['北京', 'zh', 'en', 'mymemory', 'Beijing', 'Beijing'],
    ['五月', 'zh', 'en', 'mymemory', 'May', 'May'],
    ['英语', 'zh', 'en', 'mymemory', 'English', 'English'],
    ['伦敦', 'zh', 'en', 'mymemory', 'London', 'London'],
    ['中国', 'zh', 'en', 'mymemory', 'China', 'China'],
    ['星期一', 'zh', 'en', 'google', 'Monday', 'Monday'],
    ['美国宇航局', 'zh', 'en', 'google', 'NASA', 'NASA'],
    ['美国宇航局', 'zh', 'en', 'mymemory', 'Nasa', 'Nasa'],
    ['苹果手机', 'zh', 'en', 'mymemory', 'iPhone', 'iPhone'],
    ['纽约', 'zh', 'en', 'mymemory', 'New York', 'New York'],
    ['我', 'zh', 'en', 'google', 'I', 'I'],
    ['apple', 'en', 'de', 'mymemory', 'Apfel', 'Apfel'],
    ['中国', 'zh', 'fr', 'mymemory', 'Chine', 'Chine'],
    ['我很好。', 'zh', 'en', 'google', 'I am fine.', 'I am fine.'],
    ['苹果', 'zh', 'en', 'google', 'apple', 'apple'],
  ];
  for (const [text, from, to, provider, says, want] of cases) {
    assert.equal(engine[provider][`${text}|${to}`], says, `the fake ${provider} answers ${says} for ${text}`);
    const hit = await service.translateText(text, to, from, provider);
    assert.equal(hit && hit.text, want, `quick translation of ${text} (${from} → ${to}) with ${provider}`);
  }
  // The answer is saved: the same translation again asks Wiktionary nothing.
  const before = asked.length;
  assert.ok([...saved.keys()].some((k) => k.startsWith('translation-case:')), 'the answer is saved in the lookup cache');
  assert.equal((await service.translateText('苹果', 'en', 'zh', 'mymemory')).text, 'apple');
  assert.equal(asked.length, before, 'a repeated translation needs no request');

  // A word lookup's Translation tab gets the same case.
  let latest = null;
  const looked = await service.lookup('猫', 'en', undefined, { translationProvider: 'mymemory', onUpdate: (r) => (latest = r) });
  await new Promise((r) => setTimeout(r, 300));
  const tx = ((latest || looked).translations || []).find((t) => /MyMemory/.test(t.source || ''));
  assert.equal(tx && tx.text, 'cat', `the lookup's translation of 猫 (${JSON.stringify((latest || looked).translations)})`);

  // Wiktionary not answering: the translation follows the source (lower case) within its budget.
  const offline = app({ down: ['en.wiktionary.org'] }).service;
  const started = Date.now();
  const hit = await offline.translateText('苹果', 'en', 'zh', 'mymemory');
  const took = Date.now() - started;
  assert.equal(hit && hit.text, 'apple', 'without Wiktionary, 苹果 still comes back as apple');
  assert.ok(took < 3000, `and within three seconds (${took} ms)`);
  // A scan's batch keeps the same case: Hund gives dog, Beijing and the sentence keep their capitals.
  const batch = await service.translateBatch(['Hund', '北京', '我很好。'], 'en', { provider: 'google' });
  assert.equal(JSON.stringify(batch && batch.map((b) => b.text)), JSON.stringify(['dog', 'Beijing', 'I am fine.']), `a scan batch follows the source case (${JSON.stringify(batch)})`);
  console.log('translation-case: all tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
