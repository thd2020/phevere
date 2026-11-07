/**
 * Renders Learn → Progress with made-up words into progress-demo.html, for the screenshots in
 * docs/REVIEW.md. The page is the real progressHtml and the real stylesheets; only the words and
 * the answer history are invented (fifty words started over five weeks, two hundred answers).
 * Run: node docs/REVIEW.assets/render-progress.js, then open progress-demo.html and capture it.
 */
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..', '..');
const core = path.join(root, 'packages', 'core', 'src');
const out = esbuild.buildSync({
  stdin: { contents: `export { progressHtml } from './learn-progress'; export { attachLearnCharts } from './learn-charts';`, resolveDir: core, loader: 'ts' },
  bundle: true,
  format: 'iife',
  globalName: 'P',
  platform: 'browser',
  write: false,
  loader: { '.json': 'json', '.css': 'empty' },
}).outputFiles[0].text;

const DAY = 86_400_000;
const now = new Date(2026, 10, 7, 18).getTime();
const words = 'harbour lantern meadow quarry ravine saddle thicket umbrella valley willow ember fathom gable hollow isthmus jetty kernel lattice mantle nettle orchard pebble quiver rafter sickle tether upland vessel wicket yarrow zephyr anvil bramble cinder dapple estuary furrow glade hearth inlet'
  .split(' ')
  .map((lemma, i) => ({ id: `w${i}`, lemma, sourceLang: 'en', definition: `meaning of ${lemma}`, createdAt: now - (40 - i) * DAY }));
const history = [];
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
words.forEach((w, i) => {
  // Started over the last five weeks, answered a few times each, a few missed.
  const start = now - Math.max(1, 36 - i) * DAY;
  const answers = 3 + Math.floor(rand() * 4);
  for (let k = 0; k < answers; k++) {
    const at = start + k * (2 + k) * DAY + 3600_000 * (k + 1);
    if (at > now) break;
    const right = rand() > 0.12;
    const kinds = ['meaning-choice', 'word-choice', 'recall', 'cloze', 'listen-choice'];
    const kind = kinds[Math.min(kinds.length - 1, k)];
    history.push({ id: `${w.lemma}-${k}`, lemma: w.lemma, wordId: w.id, bookId: null, answeredAt: at, kind, skill: null, correct: right, ms: 4000, grade: right ? 3 : 1, device: null, prior: null });
  }
  const mine = history.filter((r) => r.lemma === w.lemma);
  const last = mine[mine.length - 1];
  if (!last) return;
  const stability = Math.max(1, mine.filter((r) => r.correct).length ** 2.2);
  Object.assign(w, { reps: mine.length, state: mine.length > 1 ? 2 : 1, stability, lastReview: last.answeredAt, reviewDue: last.answeredAt + stability * DAY, lapses: mine.filter((r) => !r.correct).length });
});
// Today's round, and two words that keep being missed.
const SKILL = { 'meaning-choice': 'meaning', 'word-choice': 'meaning', recall: 'spelling', cloze: 'spelling', 'listen-choice': 'listening' };
words.slice(0, 24).forEach((w, i) => {
  const right = i % 7 !== 3;
  history.push({ id: `${w.lemma}-today`, lemma: w.lemma, wordId: w.id, bookId: null, answeredAt: now - (i + 1) * 120_000, kind: i % 3 ? 'recall' : 'word-choice', skill: null, correct: right, ms: 4000, grade: right ? 3 : 1, device: null, prior: null });
});
for (const lemma of ['isthmus', 'yarrow']) {
  for (let k = 0; k < 4; k++) history.push({ id: `${lemma}-miss${k}`, lemma, wordId: null, bookId: null, answeredAt: now - (k + 2) * DAY, kind: 'recall', skill: null, correct: false, ms: 6000, grade: 1, device: null, prior: null });
}
for (const r of history) r.skill = SKILL[r.kind] || null;
for (let i = 0; i < 12; i++) words.push({ id: `n${i}`, lemma: `newword${i}`, sourceLang: 'en', definition: 'x', createdAt: now - DAY });

const css = ['notebook-views.css', 'wordbook-views.css', 'learn-views.css'].map((f) => fs.readFileSync(path.join(core, f), 'utf8')).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap" rel="stylesheet">
<style>${css}
:root { --nbv-serif: 'Source Serif 4', Georgia, serif; --nbv-ui: Outfit, 'Segoe UI', sans-serif; }
body { margin: 0; padding: 16px; background: #f4f0ea; }</style></head>
<body><div class="nbv lrn" id="app"></div>
<script>${out}
// #phone: a phone's width, since a headless browser will not open a window that narrow.
if (location.hash === '#phone') document.getElementById('app').style.width = '358px';
document.getElementById('app').innerHTML = P.progressHtml(${JSON.stringify({ history, scope: 'mine', ctx: null, mine: words, goal: 10, now })});
P.attachLearnCharts(document);</script></body></html>`;
fs.writeFileSync(path.join(__dirname, 'progress-demo.html'), html);
console.log('wrote progress-demo.html');
