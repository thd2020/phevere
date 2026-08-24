const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDeb } = require('@electron-forge/maker-deb');
const { MakerRpm } = require('@electron-forge/maker-rpm');
// const { MakerWix } = require('@electron-forge/maker-wix'); // optional MSI — see PACKAGING.md
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');
const { WebpackPlugin } = require('@electron-forge/plugin-webpack');

const { packagerIgnore } = require('./scripts/packager-ignore');
const { ensure: ensureOcrNatives } = require('./scripts/ensure-ocr-natives');
const { verifyDir } = require('./scripts/verify-ocr-pack');
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
    // Prefer packaging/icon.ico so the packaged .exe / taskbar use Phevere art (not Electron default).
    icon: './packaging/icon',
    extraResource: [
      'resources/tray-icon.png',
      'scripts/ocr_worker.py',
      'scripts/media_now_playing.ps1',
      'node_modules/sql.js/dist/sql-wasm.wasm',
      'node_modules/sql.js/dist/sql-asm.js',
      // Optional offline seed packs (JSON/JSONL/CEDICT). Copied into userData on first run.
      'resources/seed',
      // PP-OCR ONNX models — bundled in the single Setup.exe; NSIS can skip installing to disk.
      'resources/ocr-models',
      'packaging/icon.ico',
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
      // Accessibility .node is compiled for this host. OCR prebuilds can be
      // fetched cross-arch, but a mixed zip would still fail to load AX.
      if (platform && arch && platform === process.platform && arch !== process.arch) {
        throw new Error(
          `Refusing to package ${platform}/${arch} on ${process.platform}/${process.arch}. ` +
            'Build the Mac zip on matching hardware (CI: macos-latest = arm64, macos-15-intel = x64).'
        );
      }
      ensureOcrNatives({ platform, arch });
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
