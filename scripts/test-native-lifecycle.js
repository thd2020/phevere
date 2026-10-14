// Real Windows addon lifecycle stress. The child deadline catches shutdown hangs.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('Windows native lifecycle check skipped on this platform.');
} else if (!process.argv.includes('--worker')) {
  const child = spawnSync(process.execPath, ['--expose-gc', __filename, '--worker'], {
    timeout: 60000,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  process.stdout.write(child.stdout);
} else {
  const { UIAutomationSelectionMonitor } = require('../native-addon/build/Release/uiautomation_selection_monitor.node');
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  (async () => {
    let monitor = new UIAutomationSelectionMonitor();
    monitor.setCallback(() => {});
    for (let cycle = 0; cycle < 80; cycle += 1) {
      assert.equal(monitor.start(), true);
      // Include immediate stop while COM is starting and steady-state shutdown.
      if (cycle % 4 === 0) await delay(40);
      monitor.stop();
      monitor.stop();
      monitor.setCallback(() => {});
    }
    monitor = null;
    global.gc();
    await delay(100);
    console.log('Windows native lifecycle passed 80 start/stop/callback-replacement cycles.');
    // Exit naturally. Leaked thread-safe callbacks would keep this child alive.
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
