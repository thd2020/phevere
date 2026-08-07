const { MakerWix } = require('@electron-forge/maker-wix');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDeb } = require('@electron-forge/maker-deb');
const { MakerRpm } = require('@electron-forge/maker-rpm');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');
const { WebpackPlugin } = require('@electron-forge/plugin-webpack');

const { mainConfig } = require('./webpack.main.config.js');
const { rendererConfig } = require('./webpack.renderer.config.js');

module.exports = {
  packagerConfig: {
    asar: true,
    // koffi loads a .node binary; must not stay inside app.asar or require() fails in production.
    asarUnpack: ['**/node_modules/koffi/**/*'],
    // Bundled next to app.asar via extraResource; runtime loads process.resourcesPath/tray-icon.png.
    // Source: resources/tray-icon.png (generate with scripts/make-tray-icon.ps1).
    extraResource: ['resources/tray-icon.png', 'scripts/ocr_worker.py'],
  },
  rebuildConfig: {},
  makers: [
    // Classic Windows installer (wizard, optional install dir). Requires WiX Toolset v3 (candle, light on PATH).
    new MakerWix({
      name: 'phevere',
      description: 'Dictionary and text selection monitoring',
      manufacturer: 'Phevere',
      ui: {
        chooseDirectory: true,
      },
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({
      asar: true
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