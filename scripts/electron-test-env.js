/**
 * Shared setup for the test scripts that open Electron windows.
 * On GitHub's Windows runners the GPU process and the sandboxed renderer crash with an access
 * violation, which cuts the page load off with ERR_FAILED. CI renders in software without the
 * sandbox. Crashed processes are logged so a failure says why.
 */
module.exports = function prepareElectronTest(app) {
  if (process.env.CI) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('no-sandbox');
  }
  app.on('render-process-gone', (_event, _contents, details) => console.error('Renderer process gone:', details));
  app.on('child-process-gone', (_event, details) => console.error('Child process gone:', details));
};
