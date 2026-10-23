# Persistent Android release signing

This configuration requires provisioning before any Android release is run.
CI debug builds need no signing secrets. Release builds never fall back to a debug key.

Repository Actions secrets for `thd2020/phevere`:

- `ANDROID_KEYSTORE_BASE64`: canonical single-line base64 of the protected keystore.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing entry alias.
- `ANDROID_KEY_PASSWORD`: private-key password.

Repository Actions variable `ANDROID_SIGNING_CERT_SHA256` contains the approved
certificate SHA-256 fingerprint as 64 hex characters without colons. This is
public certificate metadata, not a private key.

The release job restores the key to `$RUNNER_TEMP/phevere-release.jks`, builds
with `./gradlew assembleRelease --no-daemon`, and removes the temporary key even
after a build failure. Gradle reads credentials from environment variables.
The APK is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
Never commit keystores, passwords, or generated credential files.

Use `targets=android` with `attach_tag` for an Android-only replacement.
The workflow verifies the expected signing certificate and refuses to overwrite
an existing APK with a different certificate. A matching existing APK and release
metadata are retained as a 30-day Actions rollback artifact before replacement.
This rollback artifact is not a backup of the private signing key.

Existing debug-signed installations cannot ordinarily update to a new release
key. A new permanent key establishes future continuity; it does not restore the
old runner's key. An initial new-key release needs a separately agreed migration
plan. Do not bypass the replacement certificate check for the old release.

Keep an encrypted, independently recoverable offline backup of the keystore and
recovery instructions. Store its password separately in the owner's password
manager. GitHub Actions secrets are not a recoverable backup, and a same-disk
copy is not an off-device backup.

Configuration tests: `node scripts/test-android-release.js` (synthetic inputs,
no key creation). These do not substitute for Gradle/native signing and device
upgrade tests after credentials and the Android SDK are available.
