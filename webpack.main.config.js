const { rules } = require('./webpack.rules');
const { plugins } = require('./webpack.plugins');
const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

class CopyLocalDbWorkerPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('CopyLocalDbWorkerPlugin', (compilation) => {
      const from = path.join(__dirname, 'src', 'services', 'local-db-worker.cjs');
      const outDir = (compilation.options.output && compilation.options.output.path) || path.join(__dirname, '.webpack', 'main');
      const to = path.join(outDir, 'local-db-worker.cjs');
      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(from, to);
    });
  }
}

const mainConfig = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/index.ts',
  // Put your normal webpack config below here
  module: {
    rules,
  },
  plugins: [
    ...plugins,
    new CopyLocalDbWorkerPlugin(),
    // Only one OS binding exists per build. Ignore the other so webpack does
    // not fail to resolve a missing .node (index.js requires both paths).
    new webpack.IgnorePlugin({
      resourceRegExp:
        process.platform === 'darwin'
          ? /uiautomation_selection_monitor\.node$/
          : /ax_selection_monitor\.node$/,
    }),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
    alias: {
      '@phevere/core': path.resolve(__dirname, 'packages/core/src'),
    },
  },
  externals: {
    koffi: 'commonjs2 koffi',
    'sql.js': 'commonjs2 sql.js',
    'sql.js/dist/sql-asm.js': 'commonjs2 sql.js/dist/sql-asm.js',
    // Do NOT externalize node-fetch. Forge webpack does not copy pure-JS
    // externals into the packaged asar, so require('node-fetch') crashes the
    // installed app ("Cannot find module 'node-fetch'"). Bundle it instead.
    '@gutenye/ocr-node': 'commonjs2 @gutenye/ocr-node',
    '@gutenye/ocr-common': 'commonjs2 @gutenye/ocr-common',
    '@gutenye/ocr-models': 'commonjs2 @gutenye/ocr-models',
    '@gutenye/ocr-models/node': 'commonjs2 @gutenye/ocr-models/node',
    'onnxruntime-node': 'commonjs2 onnxruntime-node',
    sharp: 'commonjs2 sharp',
  },
};

module.exports = { mainConfig }; 