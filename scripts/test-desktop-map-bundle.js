/*
 * The desktop's 3D map chunk loads in a renderer without Node.
 *
 * Builds a small bundle with the desktop's webpack renderer config, the way Forge packages the
 * app (production, `[name]/index.js`, chunks loaded with <script>), and runs it in a sandbox
 * that has a window and a document but no `process`, as the renderer does with
 * contextIsolation. Then it calls loadMapScene() and checks the 3D scene module came back.
 *
 * Until 2026-11-05 ts-loader's require('three') picked three's CommonJS build, which calls
 * process.emitWarning() when it loads; the map caught the error and drew the flat fallback.
 *
 * Run: node scripts/test-desktop-map-bundle.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');

const repo = path.join(__dirname, '..');
const webpack = require('webpack');
const { rendererConfig } = require(path.join(repo, 'webpack.renderer.config.js'));

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'phevere-map-bundle-'));
const entry = path.join(out, 'entry.js');
fs.writeFileSync(entry, "import { loadMapScene } from '@phevere/core/notebook-map-load';\nwindow.probe = loadMapScene;\n");

function build() {
  const rules = rendererConfig.module.rules.map((r) =>
    r.use && r.use.loader === 'ts-loader' ? { ...r, use: { ...r.use, options: { ...r.use.options, configFile: path.join(repo, 'tsconfig.json') } } } : r,
  );
  return new Promise((resolve, reject) => {
    webpack(
      {
        ...rendererConfig,
        module: { ...rendererConfig.module, rules },
        // The type checker runs in `tsc`; here only the bundle matters.
        plugins: [],
        mode: 'production',
        target: 'web',
        context: repo,
        entry: { main_window: entry },
        output: { path: path.join(out, 'dist'), filename: '[name]/index.js', globalObject: 'self' },
        devtool: false,
      },
      (err, stats) => {
        if (err) return reject(err);
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        resolve();
      },
    );
  });
}

/** A browser-like sandbox: <script> elements appended to the head run their file. No `process`. */
function sandbox(mainUrl) {
  const scripts = [];
  const head = {
    appendChild(el) {
      scripts.push(el);
      setImmediate(() => {
        try {
          vm.runInContext(fs.readFileSync(fileURLToPath(el.src), 'utf8'), context, { filename: el.src });
          el.onload?.({ type: 'load', target: el });
        } catch (error) {
          el.onerror?.({ type: 'error', target: el, error });
          throw error;
        }
      });
    },
    removeChild() {},
  };
  const document = {
    currentScript: { tagName: 'SCRIPT', src: mainUrl },
    baseURI: mainUrl,
    head,
    createElement: () => ({ setAttribute() {}, getAttribute() {}, parentNode: head }),
    getElementsByTagName: (name) => (name === 'head' ? [head] : scripts),
  };
  const context = vm.createContext({ document, console, setTimeout, clearTimeout, Promise });
  context.self = context;
  context.window = context;
  context.globalThis = context;
  return context;
}

(async () => {
  try {
    await build();
    const main = path.join(out, 'dist', 'main_window', 'index.js');
    const context = sandbox(pathToFileURL(main).href);
    assert.equal(vm.runInContext('typeof process', context), 'undefined');
    vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
    const mod = await context.window.probe();
    assert.equal(typeof mod.createMapScene, 'function', 'the 3D map module exports createMapScene');
    console.log('desktop map bundle: the 3D scene loads without Node globals');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
