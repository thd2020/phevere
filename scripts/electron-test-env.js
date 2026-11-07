/**
 * Shared setup for the test scripts that open Electron windows.
 * On GitHub's Windows runners the GPU process and the sandboxed renderer crash with an access
 * violation, which cuts the page load off with ERR_FAILED. CI renders in software without the
 * sandbox. Crashed processes are logged so a failure says why. The tests check window sizes and
 * positions in DIP, which Windows rounds to physical pixels on a 125% or 150% display (a 460x500
 * pop-up came out 463x505), so they run at a scale of 1 on every machine.
 */
module.exports = function prepareElectronTest(app) {
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  if (process.env.CI) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('no-sandbox');
  }
  app.on('render-process-gone', (_event, _contents, details) => console.error('Renderer process gone:', details));
  app.on('child-process-gone', (_event, details) => console.error('Child process gone:', details));
};
