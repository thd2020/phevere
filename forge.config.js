const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDeb } = require('@electron-forge/maker-deb');
const { MakerRpm } = require('@electron-forge/maker-rpm');
// const { MakerWix } = require('@electron-forge/maker-wix'); // optional MSI — see PACKAGING.md
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');
const { WebpackPlugin } = require('@electron-forge/plugin-webpack');

const { mainConfig } = require('./webpack.main.config.js');
const { rendererConfig } = require('./webpack.renderer.config.js');

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    // Prefer packaging/icon.ico when available; PNG is fine for electron-builder NSIS.
    // icon: './packaging/icon',
    // koffi + sql.js must unpack; WASM also shipped as extraResource.
    asarUnpack: [
      '**/node_modules/koffi/**/*',
      '**/node_modules/sql.js/**/*',
      '**/node_modules/onnxruntime-node/**/*',
      '**/node_modules/sharp/**/*',
      '**/node_modules/@img/**/*',
      '**/node_modules/@gutenye/**/*',
    ],
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
            js: './src/renderer.ts',
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
