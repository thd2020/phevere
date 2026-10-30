#!/usr/bin/env bash
# Upgrade test for a release APK, run on an emulator by release.yml.
# Installs the previous release, leaves data in the app, installs the new APK over it
# with `adb install -r`, and checks that Android updated in place: the install is
# accepted (same signer, versionCode not lower), firstInstallTime is unchanged, the
# app's files survive, and the new version starts.
# Usage: test-android-upgrade.sh <previous.apk> <new.apk>
set -euo pipefail
OLD="$1"
NEW="$2"
PKG=com.phevere.app
FILES="/data/data/$PKG/files"

pkg_field() { adb shell dumpsys package "$PKG" | sed -n "s/^ *$1=\([^ ]*\).*/\1/p" | head -1; }

adb root >/dev/null
adb wait-for-device
adb uninstall "$PKG" >/dev/null 2>&1 || true

adb install "$OLD"
OLD_VERSION="$(pkg_field versionName)"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 20
adb shell mkdir -p "$FILES"
adb shell "echo phevere-upgrade-marker > $FILES/upgrade-marker.txt"
adb shell am force-stop "$PKG"
FIRST_INSTALL="$(pkg_field firstInstallTime)"
FILES_BEFORE="$(adb shell ls "$FILES" | tr -d '\r' | sort)"
echo "Installed $OLD_VERSION; files: $(echo "$FILES_BEFORE" | tr '\n' ' ')"

adb install -r "$NEW"
NEW_VERSION="$(pkg_field versionName)"
FILES_AFTER="$(adb shell ls "$FILES" | tr -d '\r' | sort)"

test "$(pkg_field firstInstallTime)" = "$FIRST_INSTALL" || { echo "firstInstallTime changed: the app was reinstalled, not updated" >&2; exit 1; }
test "$(adb shell cat "$FILES/upgrade-marker.txt" | tr -d '\r')" = phevere-upgrade-marker || { echo "app data lost in the upgrade" >&2; exit 1; }
missing="$(comm -23 <(echo "$FILES_BEFORE") <(echo "$FILES_AFTER"))"
test -z "$missing" || { echo "files lost in the upgrade: $missing" >&2; exit 1; }

adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 15
adb shell pidof "$PKG" >/dev/null || { echo "$NEW_VERSION did not stay running after the upgrade" >&2; exit 1; }
echo "Upgraded $OLD_VERSION to $NEW_VERSION in place; app data kept"
