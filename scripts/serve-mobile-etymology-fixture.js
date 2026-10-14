// Real mobile controller/views/styles with an isolated lookup transport fixture.
// Run: node scripts/serve-mobile-etymology-fixture.js [--port 4178]
const http = require('node:http');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 4178 : Number(process.argv[portIndex + 1]);
const states = new Map();
const subscribers = new Map();
let files = new Map();
const fixtureModule = `
import * as real from ${JSON.stringify(path.join(root, 'packages/core/src/index.ts'))};
export * from ${JSON.stringify(path.join(root, 'packages/core/src/index.ts'))};
export const dictionaryService = Object.create(real.dictionaryService);
let activeEvents;
dictionaryService.lookup = async (word, language, sources, options) => {
  activeEvents?.close();
  const events = new EventSource('/__fixture/events?word=' + encodeURIComponent(word));
  activeEvents = events;
  events.onmessage = message => options?.onUpdate?.(JSON.parse(message.data));
  return await (await fetch('/__fixture/lookup?word=' + encodeURIComponent(word))).json();
};
export const listVocab = async () => [];
export const listEmptyDefinitions = async () => [];
export const listEmptyReadings = async () => [];
export const findByLemma = async () => null;
export const fillEmptyDefinitions = async () => 0;
export const addVocab = async () => {};
export const removeVocab = async () => {};
`;

function result(word, forcedState) {
  const normalized = String(word || '').trim();
  const state = forcedState || states.get(normalized) || (normalized === 'empty' ? 'empty' : normalized === 'serendipity' ? 'success' : 'blocked');
  const blocks = [];
  if (state !== 'empty') {
    blocks.push('[Wiktionary]\nFrom an earlier word and a noun-forming suffix.');
    if (state === 'success') blocks.push('[Etymonline]\nAn early noun associated with establishing direction. Later uses describe introduction to a situation.');
    if (normalized !== 'serendipity') blocks.push('[童理民 · 中文]\n该词由 orient 派生，早期表示东向。\n\n后来词义扩大为朝向和方向。\n\n词根与上升、升起的意思相关。');
  }
  return {
    word: normalized, definitions: state === 'empty' ? [] : [{ partOfSpeech: 'noun', meaning: normalized === 'serendipity' ? 'A discovery by chance.' : 'A direction or position.', source: 'Fixture' }],
    translations: [], examples: [], sources: state === 'empty' ? [] : ['Wiktionary', 'Youdao'],
    etymology: blocks.join('\n\n--- Alternative etymology ---\n\n') || undefined,
    metadata: {
      pendingEtymology: state === 'pending',
      etymologyUnavailable: state === 'blocked' || state === 'unavailable' ? [{ source: 'Etymonline', status: state === 'blocked' ? 'blocked' : 'unavailable', code: state === 'blocked' ? 'HTTP_403' : 'HTTP_503', url: 'https://www.etymonline.com/word/' + encodeURIComponent(normalized) }] : undefined,
    },
  };
}

async function rebuild() {
  const built = await esbuild.build({
    stdin: { contents: `import '@fontsource/charis-sil/latin-400.css'; import '@fontsource/charis-sil/latin-ext-400.css'; import ${JSON.stringify(path.join(root, 'apps/mobile/src/styles.css'))}; import { startApp } from ${JSON.stringify(path.join(root, 'apps/mobile/src/app.ts'))}; void startApp();`, resolveDir: root },
    bundle: true, platform: 'browser', format: 'esm', write: false, outdir: path.join(root, 'out/mobile-etymology-fixture'),
    assetNames: 'assets/[name]-[hash]', loader: { '.woff': 'file', '.woff2': 'file' },
    plugins: [{ name: 'isolated-lookup-provider', setup(build) {
      build.onResolve({ filter: /^@phevere\/core$/ }, () => ({ path: 'fixture-core', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixtureModule, resolveDir: root, loader: 'ts' }));
      build.onResolve({ filter: /\/platform\/configure-core$/ }, () => ({ path: 'empty-configure-core', namespace: 'fixture-empty' }));
      build.onResolve({ filter: /\/platform\/offline$/ }, () => ({ path: 'empty-offline', namespace: 'fixture-empty' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture-empty' }, args => ({ contents: args.path === 'empty-offline' ? 'export const listCatalogStatus = async () => []; export const markInstalledPacksOnCore = async () => {}; export const downloadCatalogPack = async () => {}; export const importUserFile = async () => {}; export const removePack = async () => {};' : '', loader: 'js' }));
    } }],
  });
  files = new Map(built.outputFiles.map(file => ['/' + path.relative(path.join(root, 'out/mobile-etymology-fixture'), file.path).replaceAll('\\', '/'), file.contents]));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const word = url.searchParams.get('word') || '';
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/__fixture/events') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); response.write(': connected\n\n');
    const clients = subscribers.get(word) || new Set(); clients.add(response); subscribers.set(word, clients);
    request.on('close', () => clients.delete(response)); return;
  }
  if (url.pathname === '/__fixture/update' && request.method === 'POST') {
    const state = url.searchParams.get('state');
    if (!['success', 'blocked', 'unavailable', 'pending', 'empty'].includes(state)) { response.writeHead(400); response.end('Unknown fixture state'); return; }
    states.set(word, state); const next = result(word, state);
    for (const client of subscribers.get(word) || []) client.write('data: ' + JSON.stringify(next) + '\n\n');
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(next)); return;
  }
  if (url.pathname === '/__fixture/lookup') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result(word))); return; }
  try {
    if (url.pathname === '/') {
      await rebuild(); response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Phevere etymology browser fixture</title><link rel="stylesheet" href="/stdin.css"></head><body><div id="app"></div><script type="module" src="/stdin.js"></script></body></html>'); return;
    }
    const content = files.get(url.pathname);
    if (!content) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2'); response.end(content);
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
server.listen(port, '127.0.0.1', () => console.log(`Mobile etymology fixture: http://127.0.0.1:${port}/ (PID ${process.pid})`));
process.on('SIGTERM', () => { for (const clients of subscribers.values()) for (const client of clients) client.end(); server.close(() => process.exit(0)); });
