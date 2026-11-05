/**
 * Runs the offline test scripts one after another and stops at the first failure.
 * Run: npm test  (or node scripts/run-tests.js notebook-views review to pick some)
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ALL = [
  'notebook-views', 'desktop-map-bundle', 'morphology', 'review', 'vocab-sync', 'wordbooks', 'vocab-lang', 'vocab-lemma', 'notebook-csv',
  'sense-images', 'sense-frequency', 'pronunciation', 'inflections', 'lang-detect', 'multilingual-sources',
  'etymology-sources', 'etymology-cache', 'etymology-availability', 'etymology-headword', 'etymology-popup',
  'ocr-text', 'ocr-pack', 'speech-stream', 'hover-selection', 'hover-strip','native-selection-repeat',
  'popup-opening', 'popup-retrigger', 'popup-sizing', 'popup-sense-pictures', 'mobile-regressions', 'desktop-diagnostics', 'installer-audio-cli',
  'word-sources', 'book-file', 'plural-forms', 'morpheme', 'word-suggest', 'learn-session', 'learn-adapt', 'word-forms', 'lookup-entry', 'slow-network',
  'installer-audio', 'native-lifecycle', 'android-candidate-workflow', 'updater', 'mobile-update',
];

const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
for (const name of names) {
  const res = spawnSync(process.execPath, [path.join(__dirname, `test-${name}.js`)], { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\ntest-${name} failed`);
    process.exit(res.status || 1);
  }
}
console.log(`\n${names.length} test scripts passed`);
