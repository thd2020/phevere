// Registry-free control for native crashes in the Windows installer fixture.
// Run with the same Electron runtime as Phevere, never with plain Node.
const fs = require('fs');
const path = require('path');

const [profileArgument, exitArgument] = process.argv.slice(2);
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP) {
  throw new Error('This diagnostic only runs in the disposable GitHub Actions fixture.');
}
if (!process.versions.electron) throw new Error('Run this diagnostic with Electron.');
const exitCode = Number(exitArgument);
if (exitArgument === undefined || ![0, 1].includes(exitCode)) throw new Error('Expected exit code 0 or 1.');
if (!profileArgument) throw new Error('Expected an owned fixture profile directory.');
const profile = path.resolve(profileArgument);
const runnerRoot = path.resolve(process.env.RUNNER_TEMP);
if (!profile.toLowerCase().startsWith(`${runnerRoot.toLowerCase()}${path.sep}`)) {
  throw new Error('The diagnostic profile must be inside RUNNER_TEMP.');
}

const { app } = require('electron');
const disableGpu = process.argv.includes('--disable-gpu');
if (disableGpu) app.disableHardwareAcceleration();
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);

function event(name, extra = {}) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify({ event: name, pid: process.pid, ...extra })}\n`,
      error => error ? reject(error) : resolve());
  });
}

async function main() {
  await event('exit-probe-boot', { electron: process.versions.electron, arch: process.arch, exitCode, disableGpu });
  await app.whenReady();
  await event('exit-probe-ready');
  // Match the installer CLI: wait for stdout's write callback, then app.exit.
  await event('exit-probe-flushed', { exitCode });
  app.exit(exitCode);
}

void main().catch(async error => {
  try { await event('exit-probe-error', { error: error.message }); } catch { }
  app.exit(1);
});
