/* Run: node scripts/test-notebook-csv.js. Synthetic data; no database or device. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function testNotebookCsv() {
  const writes = [];
  const source = fs.readFileSync(path.join(__dirname, '../apps/mobile/src/platform/notebook-io.ts'), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const imports = {
    '@phevere/core': { addVocab: async (row) => writes.push(row) },
    './native': {},
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => {
    assert.ok(name in imports, `Unexpected import ${name}`);
    return imports[name];
  } });
  const { vocabEntriesToCsv: toCsv, vocabEntriesFromCsv: fromCsv, importNotebookText } = module.exports;
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const entries = [
    { lemma: 'synthetic-one', definition: 'first line\nsecond line', note: 'a,b "quoted"', sources: ['alpha', 'beta'] },
    { lemma: 'synthetic-two', definition: 'third line\nfourth line', reading: '音 😀', note: 'x\r\ny\r\nz' },
  ];
  assert.deepEqual(plain(fromCsv(toCsv(entries))), entries, 'two multiline entries must remain exactly two');
  // Exercise every CSV character combination in each imported scalar field.
  const values = ['', 'plain', ',', '"', '""', '\n', '\r', '\r\n', '\n\n', ' leading/trailing ', '漢字 café 😀', 'a,"b"\r\n\nc\rd'];
  const fields = ['reading', 'definition', 'note', 'partOfSpeech', 'sourceLang', 'targetLang'];
  let roundTrips = 1;
  for (const field of fields) for (const value of values) {
    const entry = { lemma: 'synthetic', [field]: value };
    const expected = value ? entry : { lemma: 'synthetic' }; // Existing optional-field normalization.
    assert.deepEqual(plain(fromCsv(toCsv([entry]))), [expected], `${field}: ${JSON.stringify(value)}`);
    roundTrips++;
  }
  assert.deepEqual(plain(fromCsv(toCsv([{ lemma: '词,"quoted"\nnext', definition: 'ok' }]))),
    [{ lemma: '词,"quoted"\nnext', definition: 'ok' }]);
  roundTrips++;
  for (const newline of ['\n', '\r\n', '\r']) {
    assert.deepEqual(plain(fromCsv('\uFEFFlemma,note' + newline + newline + 'one,"x' + newline + newline + 'y"' + newline + 'two,' + newline)),
      [{ lemma: 'one', note: 'x' + newline + newline + 'y' }, { lemma: 'two' }]);
  }
  assert.deepEqual(plain(fromCsv('note, lemma ,extra\n"a,b",word,ignored')), [{ lemma: 'word', note: 'a,b' }]);
  for (const raw of ['', '\uFEFF', '\r\n\n', 'lemma,note', toCsv([])]) assert.deepEqual(plain(fromCsv(raw)), []);
  assert.deepEqual(plain(fromCsv('lemma,note\n,\n"",""')), [{ lemma: '' }, { lemma: '' }]);
  const malformed = [
    'lemma,note\none,"unterminated', 'lemma,note\none,un"quoted', 'lemma,note\none,"closed"junk',
    'lemma,note\none,"closed" ', 'lemma,note\none', 'lemma,note\none,two,three',
    'note\nvalue', 'lemma,lemma\none,two', 'lemma,\none,two', '"lemma',
    'lemma, note,note\none,two,three',
  ];
  for (const raw of malformed) {
    assert.throws(() => fromCsv(raw), /Invalid CSV/, JSON.stringify(raw));
    writes.length = 0;
    await assert.rejects(importNotebookText('synthetic.CSV', raw), /Invalid CSV/);
    assert.equal(writes.length, 0, 'invalid files must cause no writes');
  }
  writes.length = 0;
  await assert.rejects(importNotebookText('synthetic.csv', 'lemma,note\nvalid,first\nbroken,"unfinished'), /Invalid CSV/);
  assert.equal(writes.length, 0, 'validate the whole file before importing any row');
  assert.deepEqual(plain(await importNotebookText('synthetic.csv', toCsv(entries))), { imported: 2, skipped: 0 });
  assert.deepEqual(plain(writes), entries);
  assert.deepEqual(plain(await importNotebookText('synthetic.csv', 'lemma,note\n,\nvalid,')), { imported: 1, skipped: 1 });
  console.log(`Notebook CSV passed: ${roundTrips} round-trips; LF/CRLF/CR, BOM, blanks, headers; ${malformed.length} malformed inputs; mocked import atomic validation.`);
}

module.exports = testNotebookCsv;
if (require.main === module) testNotebookCsv().catch((error) => { console.error(error); process.exitCode = 1; });
