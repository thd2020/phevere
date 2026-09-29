/**
 * Copy the speech engines into build/speech for packaging (extraResource):
 *   build/speech/speech-worker.js      scripts/speech-worker.js bundled with its unpack libraries
 *   build/speech/espeak-ng/            eSpeak NG 1.52 WebAssembly (GPL-3.0-or-later) + LICENSE
 *   build/speech/sherpa-onnx-node/     sherpa-onnx JS binding (Apache-2.0)
 *   build/speech/sherpa-onnx-<os>-<cpu>/  native addon for this build's OS and CPU, when npm
 *                                      installed one (there is none for Windows on ARM)
 * The folders sit side by side because sherpa-onnx-node loads ../sherpa-onnx-<os>-<cpu>.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build', 'speech');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function stage(platform = process.platform, arch = process.arch) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const espeak = path.join(root, 'node_modules', 'espeak-ng');
  copyDir(path.join(espeak, 'dist'), path.join(out, 'espeak-ng'));
  fs.copyFileSync(path.join(espeak, 'LICENSE'), path.join(out, 'espeak-ng', 'LICENSE'));
  // espeak-ng.js is an ES module; without this Node would load it as CommonJS.
  fs.writeFileSync(path.join(out, 'espeak-ng', 'package.json'), '{ "type": "module" }\n');
  fs.writeFileSync(
    path.join(out, 'espeak-ng', 'SOURCE.txt'),
    'eSpeak NG is free software under the GNU GPL v3 or later.\n' +
      'Source for this WebAssembly build: https://github.com/ianmarmour/espeak-ng.js\n' +
      'Upstream: https://github.com/espeak-ng/espeak-ng\n',
  );

  // Worker plus its unpack libraries (unbzip2-stream, tar-stream) as one file; the
  // engines themselves stay separate and are found by path at runtime.
  require('esbuild').buildSync({
    entryPoints: [path.join(root, 'scripts', 'speech-worker.js')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: path.join(out, 'speech-worker.js'),
    logLevel: 'error',
  });

  const plat = platform === 'win32' ? 'win' : platform;
  const native = `sherpa-onnx-${plat}-${arch}`;
  const nativeSrc = path.join(root, 'node_modules', native);
  if (fs.existsSync(path.join(nativeSrc, 'sherpa-onnx.node'))) {
    copyDir(path.join(root, 'node_modules', 'sherpa-onnx-node'), path.join(out, 'sherpa-onnx-node'));
    copyDir(nativeSrc, path.join(out, native));
    console.log(`[stage-speech] eSpeak NG + ${native}`);
  } else {
    console.log(`[stage-speech] eSpeak NG only (no ${native}; neural voices hidden on this build)`);
  }
}

module.exports = { stage };

if (require.main === module) stage(process.argv[2], process.argv[3]);
