#!/usr/bin/env bash
# Upgrade test for a release APK, run on an emulator by release.yml.
# Installs the previous release, leaves data in the app, installs the new APK over it
# with `adb install -r`, and checks that Android updated in place: the install is
# accepted (same signer, versionCode not lower), firstInstallTime is unchanged, the
# app's data folders (WebView storage with the notebook included) survive, and the
# new version starts.
# Usage: test-android-upgrade.sh <previous.apk> <new.apk>
set -euo pipefail
OLD="$1"
NEW="$2"
PKG=com.phevere.app
DATA="/data/data/$PKG"
FILES="$DATA/files"

pkg_field() { adb shell dumpsys package "$PKG" | sed -n "s/^ *$1=\([^ ]*\).*/\1/p" | head -1; }
# The app's data folders, caches left out.
data_tree() { adb shell "cd $DATA && find . -maxdepth 3 -not -path './cache*' -not -path './code_cache*'" | tr -d '\r' | sort; }

# adbd restarts when it switches to root, so an attempt can drop the connection.
for attempt in 1 2 3 4 5; do
  adb root >/dev/null 2>&1 && break
  sleep 5
done
adb wait-for-device
test "$(adb shell id -u | tr -d '\r')" = 0 || { echo "adb could not switch to root" >&2; exit 1; }
adb uninstall "$PKG" >/dev/null 2>&1 || true

adb install "$OLD"
OLD_VERSION="$(pkg_field versionName)"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 20
adb shell mkdir -p "$FILES"
adb shell "echo phevere-upgrade-marker > $FILES/upgrade-marker.txt"
adb shell am force-stop "$PKG"
FIRST_INSTALL="$(pkg_field firstInstallTime)"
TREE_BEFORE="$(data_tree)"
echo "Installed $OLD_VERSION; $(echo "$TREE_BEFORE" | wc -l) entries in its data folder"

adb install -r "$NEW"
NEW_VERSION="$(pkg_field versionName)"
TREE_AFTER="$(data_tree)"

test "$(pkg_field firstInstallTime)" = "$FIRST_INSTALL" || { echo "firstInstallTime changed: the app was reinstalled, not updated" >&2; exit 1; }
test "$(adb shell cat "$FILES/upgrade-marker.txt" | tr -d '\r')" = phevere-upgrade-marker || { echo "app data lost in the upgrade" >&2; exit 1; }
missing="$(comm -23 <(echo "$TREE_BEFORE") <(echo "$TREE_AFTER"))"
test -z "$missing" || { echo "data lost in the upgrade: $missing" >&2; exit 1; }

adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 15
adb shell pidof "$PKG" >/dev/null || { echo "$NEW_VERSION did not stay running after the upgrade" >&2; exit 1; }
echo "Upgraded $OLD_VERSION to $NEW_VERSION in place; $(echo "$TREE_AFTER" | wc -l) data entries kept"
