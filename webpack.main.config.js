const { rules } = require('./webpack.rules');
const { plugins } = require('./webpack.plugins');

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
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
  externals: {
    koffi: 'commonjs2 koffi',
    'sql.js': 'commonjs2 sql.js',
    'sql.js/dist/sql-asm.js': 'commonjs2 sql.js/dist/sql-asm.js',
    '@gutenye/ocr-node': 'commonjs2 @gutenye/ocr-node',
    '@gutenye/ocr-common': 'commonjs2 @gutenye/ocr-common',
    '@gutenye/ocr-models': 'commonjs2 @gutenye/ocr-models',
    '@gutenye/ocr-models/node': 'commonjs2 @gutenye/ocr-models/node',
    'onnxruntime-node': 'commonjs2 onnxruntime-node',
    sharp: 'commonjs2 sharp',
  },
};

module.exports = { mainConfig }; 