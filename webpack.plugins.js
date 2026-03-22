const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const webpack = require('webpack');

const plugins = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
  }),
  new webpack.DefinePlugin({
    __PHEVERE_DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  }),
];

module.exports = { plugins }; 