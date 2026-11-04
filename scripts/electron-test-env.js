/**
 * Shared setup for the test scripts that open Electron windows.
 * GitHub's Windows runners have no GPU: the GPU process crashes and the page load is cut off
 * with ERR_FAILED, so CI renders in software. Crashed processes are logged so a failure says why.
 */
module.exports = function prepareElectronTest(app) {
  if (process.env.CI) app.disableHardwareAcceleration();
  app.on('render-process-gone', (_event, _contents, details) => console.error('Renderer process gone:', details));
  app.on('child-process-gone', (_event, details) => console.error('Child process gone:', details));
};
