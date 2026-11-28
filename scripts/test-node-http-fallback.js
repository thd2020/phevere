/* Run: node scripts/test-node-http-fallback.js */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/platform/node-http.ts'), 'utf8');
const compiled = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code;

const coreBundle = esbuild.buildSync({
  entryPoints: [path.join(root, 'packages/core/src/base.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;
const coreMod = { exports: {} };
vm.runInNewContext(coreBundle, { module: coreMod, exports: coreMod.exports, require, console, setTimeout, clearTimeout });

(async () => {
  let electronCalls = 0;
  let nodeCalls = 0;
  let electronShouldFail = false;
  let nodeShouldFail = false;

  const app = new EventEmitter();
  app.isReady = () => true;

  const mockElectron = {
    app,
    net: {
      fetch: async () => {
        electronCalls += 1;
        if (electronShouldFail) throw new Error('net::ERR_CONNECTION_RESET');
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => 'text/plain' },
          text: async () => 'from-electron',
          json: async () => ({ via: 'electron' }),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    },
  };

  const mockNodeFetch = async () => {
    nodeCalls += 1;
    if (nodeShouldFail) throw new Error('ENETUNREACH');
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: async () => 'from-node',
      json: async () => ({ via: 'node' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };

  const mod = { exports: {} };
  vm.runInNewContext(compiled, {
    module: mod,
    exports: mod.exports,
    console,
    setTimeout,
    clearTimeout,
    Buffer,
    URL,
    AbortController,
    require: (name) => {
      if (name === 'electron') return mockElectron;
      if (name === 'node-fetch') return mockNodeFetch;
      if (name === '@phevere/core') return coreMod.exports;
      return require(name);
    },
  });

  const { createNodeHttpClient, _resetElectronNetHealthForTest } = mod.exports;
  const client = createNodeHttpClient();

  // Baseline: Electron net.fetch handles requests when healthy.
  const ok = await client.requestText('https://example.com/ok');
  assert.equal(ok.text, 'from-electron');
  assert.equal(electronCalls, 1);
  assert.equal(nodeCalls, 0);

  // Test 1: Electron fails while node-fetch succeeds -> immediate fallback & bypass next time.
  electronShouldFail = true;
  const recovered = await client.requestText('https://example.com/recover');
  assert.equal(recovered.text, 'from-node');
  assert.equal(electronCalls, 2);
  assert.equal(nodeCalls, 1);

  const afterBypass = await client.requestText('https://example.com/bypass');
  assert.equal(afterBypass.text, 'from-node');
  assert.equal(electronCalls, 2, 'broken Electron net.fetch must be bypassed on later calls');
  assert.equal(nodeCalls, 2);

  // Test 2: Both Electron and node-fetch fail -> throws DictionaryError and does NOT trip bypass.
  _resetElectronNetHealthForTest();
  electronCalls = 0;
  nodeCalls = 0;
  electronShouldFail = true;
  nodeShouldFail = true;
  await assert.rejects(
    () => client.requestText('https://example.com/offline'),
    (err) => err && err.name === 'DictionaryError' && err.code === 'NETWORK_ERROR',
  );
  assert.equal(electronCalls, 1);
  assert.equal(nodeCalls, 1);

  electronShouldFail = false;
  nodeShouldFail = false;
  const onlineAgain = await client.requestText('https://example.com/back');
  assert.equal(onlineAgain.text, 'from-electron', 'mutual offline failure must not disable Electron net.fetch');
  assert.equal(electronCalls, 2);

  // Test 3: 3 Utility child-process-gone crash events within 30s bypass Electron net.fetch immediately.
  _resetElectronNetHealthForTest();
  electronCalls = 0;
  nodeCalls = 0;
  await client.requestText('https://example.com/arm');
  assert.equal(electronCalls, 1);
  app.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed', exitCode: -1073741205 });
  app.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed', exitCode: -1073741205 });
  app.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed', exitCode: -1073741205 });
  const afterCrash = await client.requestText('https://example.com/after-crash');
  assert.equal(afterCrash.text, 'from-node');
  assert.equal(electronCalls, 1, 'Electron net.fetch must be bypassed after 3 Utility crashes');
  assert.equal(nodeCalls, 1);

  console.log('Node HTTP fallback passed: transport fallback, offline distinction, and Utility crash bypass.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
