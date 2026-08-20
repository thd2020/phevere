/**
 * Windows cmd defaults to a legacy code page; UTF-8 (65001) keeps Chinese
 * logs readable. No-op on macOS/Linux — `chcp` is not a Unix command.
 */
'use strict';

if (process.platform === 'win32') {
  require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
}
