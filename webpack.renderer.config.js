const { rules } = require('./webpack.rules');
const { plugins } = require('./webpack.plugins');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// Add CSS loader to rules and filter out problematic rules for renderer
const rendererRules = rules.filter(rule => {
  // Exclude the asset relocator loader from renderer process
  if (rule.use && typeof rule.use === 'object' && rule.use.loader === '@vercel/webpack-asset-relocator-loader') {
    return false;
  }
  return true;
});

rendererRules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

const rendererConfig = {
  entry: './src/renderer.ts',
  module: {
    rules: rendererRules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    fallback: {
      "path": false, // Disable path module in renderer
      "fs": false,   // Disable fs module in renderer
      "crypto": false, // Disable crypto module in renderer
      "stream": false, // Disable stream module in renderer
      "util": false,   // Disable util module in renderer
      "buffer": false, // Disable buffer module in renderer
      "url": false,    // Disable url module in renderer
      "querystring": false, // Disable querystring module in renderer
      "http": false,   // Disable http module in renderer
      "https": false,  // Disable https module in renderer
      "os": false,     // Disable os module in renderer
      "assert": false, // Disable assert module in renderer
      "constants": false, // Disable constants module in renderer
      "events": false, // Disable events module in renderer
      "punycode": false, // Disable punycode module in renderer
      "string_decoder": false, // Disable string_decoder module in renderer
      "tty": false,    // Disable tty module in renderer
      "zlib": false,   // Disable zlib module in renderer
    },
  },
};

module.exports = { rendererConfig }; 