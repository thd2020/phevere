import type { Configuration } from 'webpack';
import * as path from 'path';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

// Bundled @fontsource fonts (pop-up): emit the font files next to the page.
rules.push({
  test: /\.(woff2?|ttf|otf)$/,
  type: 'asset/resource',
});

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    alias: {
      '@phevere/core': path.resolve(__dirname, 'packages/core/src'),
    },
  },
};
