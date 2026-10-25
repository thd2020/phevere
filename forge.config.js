const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDeb } = require('@electron-forge/maker-deb');
const { MakerRpm } = require('@electron-forge/maker-rpm');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
// const { MakerWix } = require('@electron-forge/maker-wix'); // optional MSI — see PACKAGING.md
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');
const { WebpackPlugin } = require('@electron-forge/plugin-webpack');

const { packagerIgnore } = require('./scripts/packager-ignore');
const { ensure: ensureOcrNatives } = require('./scripts/ensure-ocr-natives');
const { verifyDir } = require('./scripts/verify-ocr-pack');
const { stage: stageSpeech } = require('./scripts/stage-speech');
const { rebuildDarwinAx, rebuildWinUia, rebuildLinux } = require('./scripts/rebuild-native-arch');
const { mainConfig } = require('./webpack.main.config.js');
const { rendererConfig } = require('./webpack.renderer.config.js');

/** Linux makers need host tools; skip a maker (with a note) instead of failing `make`. */
function onPath(bin) {
  return spawnSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }).status === 0;
}

/**
 * electron-installer-redhat has no spec option and its spec copies `usr/*` from the
 * current dir, which rpm 4.20+ no longer sets to the BUILD dir. Point it at ours.
 */
function useRpmSpecTemplate() {
  const { Installer } = require('electron-installer-redhat');
  const common = require('electron-installer-common');
  const spec = path.join(__dirname, 'packaging', 'linux', 'phevere.spec.ejs');
  Installer.prototype.createSpec = async function createSpec() {
    return common.wrapError('creating spec file', async () => this.createTemplatedFile(spec, this.specPath));
  };
}

function linuxMakers() {
  if (process.platform !== 'linux') return [];
  // make-linux.js runs one maker per pass (deb, rpm, appimage) so three ~300 MB
  // compressions never run at once on a small machine.
  const only = process.env.PHEVERE_LINUX_MAKER;
  const want = (id) => !only || only === id;
  const shared = {
    name: 'phevere',
    productName: 'Phevere',
    genericName: 'Dictionary',
    description: 'Select a word anywhere to look it up',
    productDescription:
      'Phevere looks up the word you select in any app: definitions, pronunciation, ' +
      'etymology, translation, and screen OCR, with a vocabulary notebook.',
    categories: ['Education', 'Office', 'Dictionary'],
    icon: 'packaging/icon.png',
    homepage: 'https://github.com/thd2020/phevere',
    bin: 'phevere',
    desktopTemplate: path.join(__dirname, 'packaging', 'linux', 'phevere.desktop.ejs'),
  };
  const makers = [];
  if (!want('deb')) {
    /* another pass */
  } else if (onPath('dpkg') && onPath('fakeroot')) {
    makers.push(
      new MakerDeb({
        options: {
          ...shared,
          maintainer: 'thd2020 <xiangyuxiao420@gmail.com>',
          section: 'education',
          priority: 'optional',
          // wl-clipboard: PRIMARY read for --lookup-selection on GNOME. espeak-ng, playerctl: optional extras.
          recommends: ['wl-clipboard', 'espeak-ng', 'playerctl', 'libnotify4'],
        },
      }),
    );
  } else {
    console.warn('[forge] skip deb maker (needs dpkg + fakeroot)');
  }
  if (!want('rpm')) {
    /* another pass */
  } else if (onPath('rpmbuild')) {
    useRpmSpecTemplate();
    makers.push(
      new MakerRpm({
        options: {
          ...shared,
          license: 'MIT',
        },
      }),
    );
  } else {
    console.warn('[forge] skip rpm maker (needs rpmbuild)');
  }
  if (!want('appimage')) {
    /* another pass */
  } else if (onPath('mksquashfs')) {
    const { default: MakerAppImage } = require('@reforged/maker-appimage');
    makers.push(
      new MakerAppImage({
        options: {
          name: 'phevere',
          productName: 'Phevere',
          genericName: 'Dictionary',
          // Wrapper adds --no-sandbox where an AppImage cannot start Chromium's sandbox.
          bin: 'phevere-appimage',
          icon: 'packaging/icon.png',
          categories: ['Education', 'Office', 'Dictionary'],
          compressor: 'zstd',
        },
      }),
    );
  } else {
    console.warn('[forge] skip AppImage maker (needs mksquashfs from squashfs-tools)');
  }
  return makers;
}

/**
 * AppImage entry point. An AppImage cannot ship a root-owned setuid chrome-sandbox,
 * so where the kernel also blocks unprivileged user namespaces (Ubuntu ≥ 24.04
 * AppArmor) Chromium aborts at start. Add --no-sandbox only in that case.
 * deb / rpm install chrome-sandbox setuid and launch `phevere` directly.
 */
function writeAppImageLauncher(appDir) {
  const launcher = path.join(appDir, 'phevere-appimage');
  fs.writeFileSync(
    launcher,
    [
      '#!/bin/sh',
      'HERE="$(dirname "$(readlink -f "$0")")"',
      'if ! unshare --user --map-root-user true 2>/dev/null; then',
      '  set -- --no-sandbox "$@"',
      'fi',
      'exec "$HERE/phevere" "$@"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: {
      // @electron/packager has no `asarUnpack` array. AutoUnpackNativesPlugin
      // only unpacks `*.node`. Gutenye is ESM (`import()` cannot read asar).
      unpackDir:
        '{node_modules/onnxruntime-node,node_modules/onnxruntime-common,node_modules/sharp,node_modules/@img,node_modules/@gutenye,node_modules/koffi,node_modules/sql.js}',
    },
    // Our ignore already keeps only .webpack + OCR/native trees. Default prune
    // uses galactus on package roots and can drop nested @img / optional natives.
    prune: false,
    ignore: packagerIgnore,
    // Win: packaging/icon.ico. Mac: packaging/icon.icns (without it the .app keeps electron.icns).
    icon: './packaging/icon',
    extraResource: [
      'resources/tray-icon.png',
      'scripts/ocr_worker.py',
      'scripts/media_now_playing.ps1',
      'scripts/speak_ipa.ps1',
      'scripts/speak_ipa_host.ps1',
      // Speech engines (eSpeak NG, sherpa-onnx for Kokoro) staged by prePackage.
      'build/speech',
      'scripts/media_now_playing.applescript',
      'scripts/foreground_window.applescript',
      'node_modules/sql.js/dist/sql-wasm.wasm',
      'node_modules/sql.js/dist/sql-asm.js',
      // Optional offline seed packs (JSON/JSONL/CEDICT). Copied into userData on first run.
      'resources/seed',
      // PP-OCR ONNX models — bundled in the single Setup.exe; NSIS can skip installing to disk.
      'resources/ocr-models',
      'packaging/icon.ico',
      // Darwin only: Dock / extraResource PNG+icns. Skip on Windows so NSIS payload stays unchanged.
      ...(process.platform === 'darwin' ? ['packaging/icon.png', 'packaging/icon.icns'] : []),
      // Linux: window / notification icon (nativeImage cannot read .ico there).
      ...(process.platform === 'linux' ? ['packaging/icon.png'] : []),
    ],
    // Avoid github.com timeouts when re-fetching Electron (npmmirror). Override via ELECTRON_MIRROR.
    download: {
      mirrorOptions: {
        mirror: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
      },
    },
  },
  rebuildConfig: {},
  makers: [
    // Primary Windows installer: modern NSIS Setup.exe (directory chooser, shortcuts, branding).
    // Configured via electron-builder.yml — see PACKAGING.md.
    {
      name: '@electron-addons/electron-forge-maker-nsis',
      config: {},
      platforms: ['win32'],
    },
    // Optional enterprise MSI — re-enable when WiX Toolset v3 is on PATH:
    // new MakerWix({ name: 'phevere', description: 'Dictionary and text selection monitoring', manufacturer: 'Phevere', ui: { chooseDirectory: true } }),
    new MakerZIP({}, ['darwin']),
    ...linuxMakers(),
  ],
  hooks: {
    prePackage: async (_config, platform, arch) => {
      const packArch = Array.isArray(arch) ? arch[0] : arch;
      if (platform) process.env.PHEVERE_PACK_PLATFORM = platform;
      if (packArch) process.env.PHEVERE_PACK_ARCH = packArch;
      // Darwin: cross-compile AX for the zip's arch (Intel host can emit arm64).
      // Windows: rebuild UIA when packaging a different arch (x64 host → arm64).
      if (platform === 'darwin' && packArch) {
        rebuildDarwinAx(packArch);
      } else if (platform === 'win32' && packArch) {
        rebuildWinUia(packArch);
      } else if (platform === 'linux' && packArch) {
        // Linux: XFixes / Wayland data-control / AT-SPI addon; cross-arch via a sysroot.
        rebuildLinux(packArch);
      } else if (platform && packArch && platform === process.platform && packArch !== process.arch) {
        throw new Error(
          `Refusing to package ${platform}/${packArch} on ${process.platform}/${process.arch}.`
        );
      }
      ensureOcrNatives({ platform, arch: packArch });
      stageSpeech(platform || process.platform, packArch || process.arch);
    },
    postPackage: async (_config, pkg) => {
      const platform = pkg.platform;
      const arch = Array.isArray(pkg.arch) ? pkg.arch[0] : pkg.arch;
      for (const out of pkg.outputPaths || []) {
        verifyDir(out, platform, arch);
        if (platform === 'linux') writeAppImageLauncher(out);
      }
    },
  },
  plugins: [
    new AutoUnpackNativesPlugin({
      asar: true,
    }),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.ts',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
            },
          },
          {
            html: './src/popup-new.html',
            // Dedicated stub — never bundle main renderer.ts / index.css into the popup
            // (that overrode .loading and left a dead infinite-spinner toolstrip).
            js: './src/popup-entry.ts',
            name: 'popup_window',
            preload: {
              js: './src/preload.ts',
            },
          },
          {
            html: './src/ocr-overlay.html',
            js: './src/ocr-overlay.ts',
            name: 'ocr_overlay',
            preload: {
              js: './src/ocr-overlay-preload.ts',
            },
          },
        ],
      },
    }),
  ],
};
