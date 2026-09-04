const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDeb } = require('@electron-forge/maker-deb');
const { MakerRpm } = require('@electron-forge/maker-rpm');
// const { MakerWix } = require('@electron-forge/maker-wix'); // optional MSI — see PACKAGING.md
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');
const { WebpackPlugin } = require('@electron-forge/plugin-webpack');

const { packagerIgnore } = require('./scripts/packager-ignore');
const { ensure: ensureOcrNatives } = require('./scripts/ensure-ocr-natives');
const { verifyDir } = require('./scripts/verify-ocr-pack');
const { rebuildDarwinAx, rebuildWinUia } = require('./scripts/rebuild-native-arch');
const { mainConfig } = require('./webpack.main.config.js');
const { rendererConfig } = require('./webpack.renderer.config.js');

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: {
      // @electron/packager has no `asarUnpack` array. AutoUnpackNativesPlugin
      // only unpacks `*.node`. Gutenye is ESM (`import()` cannot read asar).
      unpackDir:
        '{node_modules/onnxruntime-node,node_modules/onnxruntime-common,node_modules/sharp,node_modules/@img,node_modules/@gutenye,node_modules/koffi,node_modules/sql.js}',
    },
    // Our ignore already keeps only .webpack + OCR/native trees. Default prune
    // uses galactus on package roots and can drop nested @img / optional natives.
    prune: false,
    ignore: packagerIgnore,
    // Win: packaging/icon.ico. Mac: packaging/icon.icns (without it the .app keeps electron.icns).
    icon: './packaging/icon',
    extraResource: [
      'resources/tray-icon.png',
      'scripts/ocr_worker.py',
      'scripts/media_now_playing.ps1',
      'scripts/media_now_playing.applescript',
      'scripts/foreground_window.applescript',
      'node_modules/sql.js/dist/sql-wasm.wasm',
      'node_modules/sql.js/dist/sql-asm.js',
      // Optional offline seed packs (JSON/JSONL/CEDICT). Copied into userData on first run.
      'resources/seed',
      // PP-OCR ONNX models — bundled in the single Setup.exe; NSIS can skip installing to disk.
      'resources/ocr-models',
      'packaging/icon.ico',
      // Darwin only: Dock / extraResource PNG+icns. Skip on Windows so NSIS payload stays unchanged.
      ...(process.platform === 'darwin' ? ['packaging/icon.png', 'packaging/icon.icns'] : []),
    ],
    // Avoid github.com timeouts when re-fetching Electron (npmmirror). Override via ELECTRON_MIRROR.
    download: {
      mirrorOptions: {
        mirror: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
      },
    },
  },
  rebuildConfig: {},
  makers: [
    // Primary Windows installer: modern NSIS Setup.exe (directory chooser, shortcuts, branding).
    // Configured via electron-builder.yml — see PACKAGING.md.
    {
      name: '@electron-addons/electron-forge-maker-nsis',
      config: {},
      platforms: ['win32'],
    },
    // Optional enterprise MSI — re-enable when WiX Toolset v3 is on PATH:
    // new MakerWix({ name: 'phevere', description: 'Dictionary and text selection monitoring', manufacturer: 'Phevere', ui: { chooseDirectory: true } }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  hooks: {
    prePackage: async (_config, platform, arch) => {
      const packArch = Array.isArray(arch) ? arch[0] : arch;
      if (platform) process.env.PHEVERE_PACK_PLATFORM = platform;
      if (packArch) process.env.PHEVERE_PACK_ARCH = packArch;
      // Darwin: cross-compile AX for the zip's arch (Intel host can emit arm64).
      // Windows: rebuild UIA when packaging a different arch (x64 host → arm64).
      if (platform === 'darwin' && packArch) {
        rebuildDarwinAx(packArch);
      } else if (platform === 'win32' && packArch) {
        rebuildWinUia(packArch);
      } else if (platform && packArch && platform === process.platform && packArch !== process.arch) {
        throw new Error(
          `Refusing to package ${platform}/${packArch} on ${process.platform}/${process.arch}.`
        );
      }
      ensureOcrNatives({ platform, arch: packArch });
    },
    postPackage: async (_config, pkg) => {
      const platform = pkg.platform;
      const arch = Array.isArray(pkg.arch) ? pkg.arch[0] : pkg.arch;
      for (const out of pkg.outputPaths || []) {
        verifyDir(out, platform, arch);
      }
    },
  },
  plugins: [
    new AutoUnpackNativesPlugin({
      asar: true,
    }),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.ts',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
            },
          },
          {
            html: './src/popup-new.html',
            // Dedicated stub — never bundle main renderer.ts / index.css into the popup
            // (that overrode .loading and left a dead infinite-spinner toolstrip).
            js: './src/popup-entry.ts',
            name: 'popup_window',
            preload: {
              js: './src/preload.ts',
            },
          },
          {
            html: './src/ocr-overlay.html',
            js: './src/ocr-overlay.ts',
            name: 'ocr_overlay',
            preload: {
              js: './src/ocr-overlay-preload.ts',
            },
          },
        ],
      },
    }),
  ],
};
