# Android build and selection-toolbar setup

## Build

CI prepares the speech bundle, checks its SHA-256 digests, synthesizes English US/UK
and Mandarin samples, and builds the APK. No speech engine or model download is
required on the phone. The first playback unpacks the bundled files in app-private
storage. This increases APK size by roughly 400 MB and also uses private storage.

For a local Android build:

```sh
npm run mobile:build
python apps/mobile/scripts/prepare-speech.py
cd apps/mobile/android
./gradlew assembleDebug
```

The embedded runtime is sherpa-onnx 1.13.3; the bundled Kokoro v1 model supports
English and Mandarin. Recorded source audio remains available for other languages.
Runtime, model URLs, and SHA-256 digests are pinned in `scripts/prepare-speech.py`.
Model files and the AAR are generated build outputs and must not be committed.

## crDroid / Android 16: Phevere first

The same APK includes an optional LSPosed module. On a rooted phone with LSPosed:

1. Install the APK, then open **LSPosed → Modules → Phevere** and enable it.
2. Select the apps where you select text (browser, reader, etc.). Do not select
   System Framework; the hook runs inside the selected apps.
3. Force-stop and reopen those apps, or reboot. Select a word. Phevere's existing
   action should be the first visible button, outside the overflow menu.

The module promotes only an existing Phevere `PROCESS_TEXT` action and preserves
the relative order of other actions. No clipboard monitoring or accessibility
service is involved. Disable the module to restore the original ordering.
Apps with custom selection menus or which omit Phevere entirely are outside this
hook's scope. The setup dialog is shown once and can be reopened from Capture.

Source basis: crDroid's [Android 16 Editor](https://github.com/crdroidandroid/android_frameworks_base/blob/16.0/core/java/android/widget/Editor.java)
uses `SHOW_AS_ACTION_NEVER` for process-text actions. The
[FloatingToolbar](https://github.com/crdroidandroid/android_frameworks_base/blob/16.0/core/java/com/android/internal/widget/floatingtoolbar/FloatingToolbar.java)
sorts them before drawing the main and overflow panels. The hook changes both
the action flag and comparator; changing manifest priority alone does neither.
