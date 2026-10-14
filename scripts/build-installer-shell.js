/** Build the native WPF setup frontend and wrap the electron-builder backend. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

async function updateInstallerMetadata(installer) {
  const yaml = require('js-yaml');
  const filename = path.basename(installer);
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(installer)) hash.update(chunk);
  const sha512 = hash.digest('base64');
  const size = fs.statSync(installer).size;
  const matches = value => {
    if (typeof value !== 'string') return false;
    try { return path.basename(decodeURIComponent(value.split(/[?#]/)[0]).replace(/\\/g, '/')) === filename; }
    catch { return false; }
  };
  const directory = path.dirname(installer);
  const candidates = new Set([directory, path.dirname(directory)]
    .flatMap(folder => ['latest.yml', 'latest-windows.yml'].map(name => path.join(folder, name))));
  for (const metadataPath of candidates) {
    if (!fs.existsSync(metadataPath)) continue;
    const metadata = yaml.load(fs.readFileSync(metadataPath, 'utf8'));
    if (!metadata || typeof metadata !== 'object') continue;
    let changed = false;
    for (const file of Array.isArray(metadata.files) ? metadata.files : []) {
      if (!file || !matches(file.url)) continue;
      file.sha512 = sha512;
      file.size = size;
      delete file.blockMapSize;
      changed = true;
    }
    if (matches(metadata.path)) {
      metadata.sha512 = sha512;
      if (Object.hasOwn(metadata, 'size')) metadata.size = size;
      delete metadata.blockMapSize;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(metadataPath, yaml.dump(metadata, { lineWidth: -1 }));
      console.log(`[installer-shell] Updated outer installer metadata: ${metadataPath}`);
    }
  }
}

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} exited with ${result.status}`);
}

function compileFrontend(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const frontend = path.join(directory, 'InstallerUi.exe');
  const references = ['PresentationFramework', 'PresentationCore', 'WindowsBase'].map(name => `/reference:${path.join(framework, 'WPF', `${name}.dll`)}`);
  run(path.join(framework, 'csc.exe'), [
    '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+',
    `/out:${frontend}`, `/win32icon:${path.join(root, 'packaging', 'icon.ico')}`,
    `/win32manifest:${path.join(root, 'packaging', 'installer-ui', 'app.manifest')}`,
    '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Xaml.dll',
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
    '/reference:System.Web.Extensions.dll', ...references,
    path.join(root, 'packaging', 'installer-ui', 'InstallerUi.cs'),
  ]);
  fs.copyFileSync(path.join(root, 'packaging', 'installer-ui', 'InstallerUi.exe.config'), `${frontend}.config`);
  fs.copyFileSync(path.join(root, 'packaging', 'installerHero.bmp'), path.join(directory, 'hero.bmp'));
  fs.copyFileSync(path.join(root, 'packaging', 'icon.ico'), path.join(directory, 'icon.ico'));
  const sourceFonts = path.join(root, 'packaging', 'installer-ui', 'fonts');
  const outputFonts = path.join(directory, 'fonts');
  fs.mkdirSync(outputFonts, { recursive: true });
  for (const name of fs.readdirSync(sourceFonts)) {
    if (/\.ttf$/i.test(name) || name === 'LICENSE.txt') {
      fs.copyFileSync(path.join(sourceFonts, name), path.join(outputFonts, name));
    }
  }
  return frontend;
}

async function createSigner() {
  const yaml = require('js-yaml');
  const options = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')).win || {};
  const link = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
  const subject = options.certificateSubjectName || process.env.CSC_NAME;
  if (!link && !subject && !options.certificateFile && !options.certificateSha1) {
    return { sign: async () => {}, cleanup: async () => {} };
  }
  const { TmpDir } = require('temp-file');
  const { importCertificate } = require('app-builder-lib/out/codeSign/codesign');
  const { sign, getCertificateFromStoreInfo } = require('app-builder-lib/out/codeSign/windowsCodeSign');
  const { VmManager } = require('app-builder-lib/out/vm/vm');
  const temporary = new TmpDir('phevere-installer-signing');
  const vm = new VmManager();
  const packager = { appInfo: { type: 'commonjs' }, vm: { value: Promise.resolve(vm) } };
  let certificate;
  try {
    if (subject || options.certificateSha1) {
      certificate = await getCertificateFromStoreInfo({ ...options, certificateSubjectName: subject }, vm);
    } else {
      certificate = {
        file: options.certificateFile ? path.resolve(root, options.certificateFile) : await importCertificate(link, temporary, root),
        password: process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD || null,
      };
    }
  } catch (error) {
    await temporary.cleanup();
    throw error;
  }
  return {
    sign: file => sign({ path: file, name: 'Phevere', cscInfo: certificate, options }, packager),
    cleanup: () => temporary.cleanup(),
  };
}

async function wrapInstaller(arch) {
  if (process.platform !== 'win32') throw new Error('The native installer shell must be built on Windows.');
  const version = require('../package.json').version;
  const filename = `Phevere-Setup-${version}-${arch}.exe`;
  const installer = path.join(root, 'out', 'make', 'nsis', arch, filename);
  if (!fs.existsSync(installer)) throw new Error(`Missing electron-builder backend: ${installer}`);
  // A failed wrapper build must leave the last working backend installer intact.
  const directory = path.join(root, 'out', 'installer-ui', arch);
  const frontend = compileFrontend(directory);
  const signer = await createSigner();
  const backend = path.join(directory, 'Backend.exe');
  const output = path.join(directory, filename);
  try {
    await signer.sign(frontend);
    fs.copyFileSync(installer, backend);
    const { NSIS_PATH, NsisTargetOptions } = require('app-builder-lib/out/targets/nsis/nsisUtil');
    NsisTargetOptions.resolve({});
    const nsisDirectory = await NSIS_PATH();
    run(path.join(nsisDirectory, 'makensis.exe'), [
      '/V2', '/INPUTCHARSET', 'UTF8',
      `/DOUTPUT_FILE=${output}`, `/DBACKEND_FILE=${backend}`, `/DUI_FILE=${frontend}`,
      `/DUI_CONFIG=${frontend}.config`,
      `/DUI_FONTS=${path.join(directory, 'fonts')}`,
      `/DUI_ART=${path.join(directory, 'hero.bmp')}`,
      `/DINSTALLER_ICON=${path.join(root, 'packaging', 'icon.ico')}`,
      `/DAPP_VERSION=${version}`, `/DVERSION_QUAD=${version.split('-')[0]}.0`, `/DAPP_ARCH=${arch}`,
      path.join(root, 'packaging', 'installer-shell.nsi'),
    ]);
    await signer.sign(output);
    fs.copyFileSync(output, installer);
    // electron-builder produced a blockmap for its backend bytes. No updater uses
    // it currently; remove it rather than publish a stale map for the outer shell.
    const blockmap = `${installer}.blockmap`;
    if (fs.existsSync(blockmap)) fs.unlinkSync(blockmap);
    await updateInstallerMetadata(installer);
    console.log(`[installer-shell] ${installer}`);
    return { installer, frontend };
  } finally {
    await signer.cleanup();
    for (const temporary of [backend, output]) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}

if (require.main === module) {
  const archIndex = process.argv.indexOf('--arch');
  const arch = archIndex >= 0 ? process.argv[archIndex + 1] : process.arch;
  wrapInstaller(arch).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { compileFrontend, wrapInstaller, updateInstallerMetadata };
