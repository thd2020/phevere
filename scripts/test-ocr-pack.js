/* Run: node scripts/test-ocr-pack.js
 * Builds the release asset with make-ocr-pack.js, then installs it through the
 * real src/services/ocr-pack.ts with Electron stubbed: GitHub release format,
 * the npm tarball fallback, a corrupted download, and the legacy resources folder.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const esbuild = require('esbuild');
const tar = require('tar-stream');
const { makeOcrPack } = require('./make-ocr-pack');
const manifest = require('../src/services/ocr-pack-manifest.json');

const root = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-ocr-pack-'));
const userData = path.join(work, 'userData');
const resources = path.join(work, 'resources');
fs.mkdirSync(resources, { recursive: true });

/** URL → bytes the stubbed net.fetch serves; anything else is a 404. */
const served = new Map();
const requested = [];
const electron = {
  app: { getVersion: () => '9.9.9', isPackaged: true, getPath: () => userData, getAppPath: () => root },
  net: {
    fetch: async (url) => {
      requested.push(url);
      const body = served.get(url);
      if (!body) return { ok: false, status: 404, body: null, headers: new Map() };
      let sent = false;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-length', String(body.length)]]),
        body: {
          getReader: () => ({
            read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new Uint8Array(body) })),
            cancel: async () => {},
            releaseLock: () => {},
          }),
        },
      };
    },
  },
};

async function loadModule() {
  const bundle = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'services', 'ocr-pack.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['electron'],
    plugins: [{
      name: 'logger-stub',
      setup(build) {
        build.onResolve({ filter: /\/logger$/ }, () => ({ path: 'logger', namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const log = { info() {}, warn() {} };', loader: 'js' }));
      },
    }],
  });
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', 'process', bundle.outputFiles[0].text);
  const fakeProcess = Object.assign(Object.create(process), { resourcesPath: resources });
  fn(mod, mod.exports, (id) => (id === 'electron' ? electron : require(id)), fakeProcess);
  return mod.exports;
}

/** npm layout (package/assets/...); `tamper` flips one byte in the recognition model. */
function npmStyleTarball(tamper = false) {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks = [];
    const gzip = zlib.createGzip();
    gzip.on('data', (c) => chunks.push(c));
    gzip.on('end', () => resolve(Buffer.concat(chunks)));
    gzip.on('error', reject);
    pack.pipe(gzip);
    pack.entry({ name: 'package/package.json' }, '{}');
    pack.entry({ name: 'package/assets/ch_ppocr_mobile_v2.0_cls_infer.onnx' }, 'unused');
    for (const f of manifest.files) {
      const body = fs.readFileSync(path.join(root, 'node_modules', '@gutenye', 'ocr-models', 'assets', f.name));
      if (tamper && /rec_infer/.test(f.name)) body[body.length >> 1] ^= 0xff;
      pack.entry({ name: `package/assets/${f.name}` }, body);
    }
    pack.finalize();
  });
}

(async () => {
  const asset = fs.readFileSync(await makeOcrPack(path.join(work, 'make')));
  const ocr = await loadModule();
  const versioned = `https://github.com/thd2020/phevere/releases/download/v9.9.9/${manifest.asset}`;
  const latest = `https://github.com/thd2020/phevere/releases/latest/download/${manifest.asset}`;
  const mirror = `https://registry.npmmirror.com/${manifest.npmTarball}`;
  const installed = path.join(userData, 'ocr-packs', 'pp-ocrv4');

  assert.equal(ocr.getOcrPackState().installed, false, 'A fresh profile has no OCR pack.');

  // A truncated download and a file with a wrong checksum must not install;
  // the mirror then supplies good files.
  served.set(versioned, asset.subarray(0, asset.length - 4096));
  served.set(latest, await npmStyleTarball(true));
  served.set(mirror, await npmStyleTarball());
  const progress = [];
  const stop = ocr.onOcrPackChange((s) => progress.push(s.progress));
  await ocr.installOcrPack();
  stop();
  assert.deepEqual(requested.slice(0, 3), [versioned, latest, mirror], 'Sources are tried in order.');
  assert.ok(progress.some((p) => p > 0 && p < 1), 'Progress is reported during the download.');
  assert.equal(ocr.getOcrPackState().installed, true);
  assert.equal(ocr.findOcrPackRoot(), installed);
  assert.deepEqual(fs.readdirSync(installed).sort(), manifest.files.map((f) => f.name).sort(), 'Only the pack files are installed.');

  // The GitHub release asset installs on its own.
  fs.rmSync(path.join(userData, 'ocr-packs'), { recursive: true, force: true });
  requested.length = 0;
  served.clear();
  served.set(versioned, asset);
  await ocr.installOcrPack();
  assert.deepEqual(requested, [versioned]);
  assert.equal(ocr.findOcrPackRoot(), installed);

  // Every source failing leaves no partial pack and reports one plain error.
  fs.rmSync(path.join(userData, 'ocr-packs'), { recursive: true, force: true });
  served.clear();
  await assert.rejects(ocr.installOcrPack(), /Could not download the OCR pack/);
  assert.equal(ocr.getOcrPackState().installed, false);
  assert.match(ocr.getOcrPackState().error, /Could not download/);
  assert.equal(fs.existsSync(`${installed}.download`), false, 'The staging folder is removed.');

  // Models an older installer left in resources/ocr-models are found without a download.
  const legacy = path.join(resources, 'ocr-models');
  fs.mkdirSync(legacy, { recursive: true });
  for (const f of manifest.files) fs.writeFileSync(path.join(legacy, f.name), 'legacy');
  assert.equal(ocr.findOcrPackRoot(), legacy);
  assert.equal(ocr.getOcrPackState().installed, true);

  fs.rmSync(work, { recursive: true, force: true });
  console.log('PASS: OCR pack build, ordered sources, checksum rejection, npm fallback, cleanup and legacy folder.');
})().catch((err) => {
  fs.rmSync(work, { recursive: true, force: true });
  console.error(err);
  process.exit(1);
});
