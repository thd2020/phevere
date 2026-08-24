/**
 * Shared layout for packaging in-process OCR (no end-user Python / npm).
 */
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

const OCR_SEED_PACKAGES = [
  'onnxruntime-node',
  'onnxruntime-common',
  'sharp',
  '@gutenye/ocr-node',
  '@gutenye/ocr-common',
  '@gutenye/ocr-models',
  'koffi',
  'sql.js',
];

const OCR_MODEL_FILES = [
  'ch_PP-OCRv4_det_infer.onnx',
  'ch_PP-OCRv4_rec_infer.onnx',
  'ppocr_keys_v1.txt',
];

const SHARP_PLATFORM = {
  'darwin/x64': { pkg: '@img/sharp-darwin-x64', ver: '0.33.5', vips: '@img/sharp-libvips-darwin-x64', vipsVer: '1.0.4' },
  'darwin/arm64': { pkg: '@img/sharp-darwin-arm64', ver: '0.33.5', vips: '@img/sharp-libvips-darwin-arm64', vipsVer: '1.0.4' },
  'win32/x64': { pkg: '@img/sharp-win32-x64', ver: '0.33.5' },
  'win32/arm64': { pkg: '@img/sharp-win32-arm64', ver: '0.33.5' },
};

function argvFlag(name) {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('-')) return process.argv[i + 1];
  return null;
}

function targetPlatformArch() {
  const platform = argvFlag('--platform') || process.platform;
  const arch = argvFlag('--arch') || process.arch;
  return { platform, arch };
}

function onnxBindingRel(platform, arch) {
  return path.join('onnxruntime-node', 'bin', 'napi-v6', platform, arch, 'onnxruntime_binding.node');
}

function sharpSpec(platform, arch) {
  return SHARP_PLATFORM[`${platform}/${arch}`] || null;
}

module.exports = {
  ROOT,
  OCR_SEED_PACKAGES,
  OCR_MODEL_FILES,
  SHARP_PLATFORM,
  argvFlag,
  targetPlatformArch,
  onnxBindingRel,
  sharpSpec,
};
