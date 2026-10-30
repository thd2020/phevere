#!/usr/bin/env bash
# Fetches the sherpa-onnx iOS libraries and the official Swift wrapper that the Neural
# (Kokoro) voices link against. They are pinned by version and SHA-256 and land in
# apps/mobile/ios/App/Speech/, which git ignores; App.xcodeproj references that folder.
set -euo pipefail

VERSION=1.13.3
ARCHIVE_SHA=2f30ff72a2f381ca39b56e62aa87b1cbdc38f19f9e49bbd92c7cc112e3a44f6a
WRAPPER_SHA=94f375d6084667238251a5b6d303a45956a85bb814a93147d5ba22137957b377
BASE=https://github.com/k2-fsa/sherpa-onnx

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/../ios/App/Speech"
STAMP="$DEST/.version"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$VERSION" ] \
  && [ -d "$DEST/sherpa-onnx.xcframework" ] && [ -d "$DEST/onnxruntime.xcframework" ] \
  && [ -f "$DEST/SherpaOnnx.swift" ]; then
  echo "sherpa-onnx $VERSION for iOS is already in place"
  exit 0
fi

sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL --retry 5 --retry-delay 5 -o "$WORK/ios.tar.bz2" \
  "$BASE/releases/download/v$VERSION/sherpa-onnx-v$VERSION-ios.tar.bz2"
test "$(sha256 "$WORK/ios.tar.bz2")" = "$ARCHIVE_SHA" || { echo "sherpa-onnx iOS archive checksum mismatch" >&2; exit 1; }

curl -fsSL --retry 5 --retry-delay 5 -o "$WORK/SherpaOnnx.swift" \
  "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v$VERSION/swift-api-examples/SherpaOnnx.swift"
test "$(sha256 "$WORK/SherpaOnnx.swift")" = "$WRAPPER_SHA" || { echo "SherpaOnnx.swift checksum mismatch" >&2; exit 1; }

mkdir -p "$WORK/x"
tar -xjf "$WORK/ios.tar.bz2" -C "$WORK/x"

rm -rf "$DEST"
mkdir -p "$DEST"
# onnxruntime.xcframework in the archive is a symlink to its versioned folder; copy the target.
cp -R "$WORK/x/build-ios/sherpa-onnx.xcframework" "$DEST/"
cp -RL "$WORK/x/build-ios/ios-onnxruntime/onnxruntime.xcframework" "$DEST/"
cp "$WORK/SherpaOnnx.swift" "$DEST/"
echo "$VERSION" > "$STAMP"
echo "sherpa-onnx $VERSION for iOS is in $DEST"
