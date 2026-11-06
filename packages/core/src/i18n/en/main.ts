/** The desktop main process: tray, menus, dialogs and notifications (src/index.ts, src/services). */
export default {
  // Tray menu
  'main.tray.open': 'Open Phevere',
  'main.tray.selectionMode': 'Selection mode',
  /** A choice under Selection mode: look up only while the trigger key is held. */
  'main.tray.selectionMode.shortcut': 'Shortcut (hold the trigger key)',
  'main.tray.hoverLookup': 'Hover lookup',
  'main.tray.scanRegion': 'Scan region…',
  'main.tray.scanUnderPointer': 'Scan under pointer',
  'main.tray.scanActiveWindow': 'Scan active window',
  'main.tray.scanClipboardImage': 'Scan clipboard image',
  /** Look up the title of the song or video the computer is playing. */
  'main.tray.lookUpNowPlaying': 'Look up now playing',
  'main.tray.clipboardHistory': 'Clipboard history',
  'main.tray.macAccessibilitySettings': 'Open Accessibility Settings…',
  'main.tray.macScreenRecordingSettings': 'Open Screen Recording Settings…',
  'main.tray.quit': 'Quit Phevere',
  'main.tray.update.restart': 'Restart to update to {version}',
  'main.tray.update.install': 'Update to {version}',
  'main.tray.update.download': 'Download Phevere {version}…',

  // Menu item that opens the Settings window (tray and the macOS app menu)
  'main.menu.settings': 'Settings…',

  // macOS app menu; {app} is the app's name
  'main.appMenu.about': 'About {app}',
  'main.appMenu.services': 'Services',
  'main.appMenu.hide': 'Hide {app}',
  'main.appMenu.hideOthers': 'Hide Others',
  'main.appMenu.showAll': 'Show All',
  'main.appMenu.quit': 'Quit {app}',
  /** The Edit menu's title. */
  'main.appMenu.edit': 'Edit',
  'main.appMenu.undo': 'Undo',
  'main.appMenu.redo': 'Redo',
  'main.appMenu.cut': 'Cut',
  'main.appMenu.copy': 'Copy',
  'main.appMenu.paste': 'Paste',
  'main.appMenu.pasteAndMatchStyle': 'Paste and Match Style',
  /** Edit menu command that deletes the selected text. */
  'main.appMenu.delete': 'Delete',
  'main.appMenu.selectAll': 'Select All',
  /** Edit menu submenu that reads the selected text aloud. */
  'main.appMenu.speech': 'Speech',
  'main.appMenu.startSpeaking': 'Start Speaking',
  'main.appMenu.stopSpeaking': 'Stop Speaking',
  /** The Window menu's title. */
  'main.appMenu.window': 'Window',
  'main.appMenu.minimize': 'Minimize',
  /** Window menu command that enlarges the window (macOS "Zoom"). */
  'main.appMenu.zoom': 'Zoom',
  'main.appMenu.front': 'Bring All to Front',

  // Notifications (Windows tray balloons, macOS and Linux notifications)
  /** {shortcut} is the key combination that toggles hover lookup. */
  'main.notify.hoverOn': 'Hover lookup on ({shortcut})',
  'main.notify.hoverOff': 'Hover lookup off ({shortcut})',
  'main.notify.translateFailed': 'Could not translate the selection.',
  /** {keys} is the system's screenshot shortcut, such as Win+Shift+S. */
  'main.notify.noClipboardImage': 'No image on the clipboard. Press {keys} to capture one.',
  'main.notify.noClipboardImage.linux': 'No image on the clipboard. Copy a region with Print Screen first.',
  /** {keys} is Phevere's shortcut for scanning the clipboard image. */
  'main.notify.clipboardImageReady': 'Image copied. Press {keys} to scan it.',
  'main.notify.noTray.gnome': 'No tray icon: turn on the AppIndicator extension. Run Phevere again to reopen its window.',
  'main.notify.noTray': 'No tray icon: this desktop has no system tray. Run Phevere again to reopen its window.',
  'main.notify.updateReady': 'Phevere {version} is ready. It installs when Phevere quits.',
  'main.notify.updateAvailable': 'Phevere {version} is available.',

  // Shortcut errors shown in Settings
  'main.shortcuts.mustDiffer': 'Each shortcut must be different.',
  'main.shortcuts.allRequired': 'All shortcut fields are required.',
  'main.shortcuts.invalid': 'This shortcut is not valid.',

  // The small progress window shown while text is captured and recognised
  'main.progress.working': 'Working…',
  'main.progress.recognizing': 'Recognizing text…',
  'main.progress.capturingRegion': 'Capturing screen region',
  'main.progress.captureFailed': 'Capture failed',
  'main.progress.tryLargerRegion': 'Try a larger region',
  'main.progress.readingText': 'Reading text',
  /** {seconds} is how long recognition has been running; "s" stands for seconds. */
  'main.progress.stillWorking': 'Still working… {seconds}s',
  'main.progress.lookingUp': 'Looking up…',
  'main.progress.regionTooSmall': 'Region too small',
  'main.progress.selectLargerArea': 'Select a larger area.',
  'main.progress.scanningUnderPointer': 'Scanning under pointer…',
  'main.progress.capturingNearby': 'Capturing nearby text',
  'main.progress.scanningWindow': 'Scanning window…',
  'main.progress.capturingWindow': 'Capturing foreground window',
  'main.progress.scanningClipboard': 'Scanning clipboard image…',
  'main.progress.scanningImage': 'Scanning image…',
  /** Title while Phevere asks the system what song or video is playing. */
  'main.progress.nowPlaying': 'Now playing…',
  'main.progress.checkingNowPlaying': 'Checking what is playing',

  // What the pop-up shows when a scan has nothing to look up
  'main.scan.noText': '(No text found)',
  'main.scan.needsPack': '(Needs the OCR pack)',
  /** {reason} is the engine's own error text, usually in English. */
  'main.scan.unavailable': '(Text recognition unavailable: {reason})',
  'main.scan.engineFailedToLoad': 'embedded engine failed to load',
  'main.scan.engineFailed': 'embedded engine failed',
  'main.scan.windowFailed': '(Could not scan this window)',
  'main.scan.nothingPlaying': '(Nothing is playing)',
  'main.scan.imageLoadFailed': 'Could not load image',
  'main.scan.imageDecodeFailed': 'Could not decode image',

  // Word book files: export, import and the questions an import asks
  'main.books.exportTitle': 'Export book',
  'main.books.exportAnkiTitle': 'Export for Anki',
  /** File type name in the save dialog: Anki's plain-text import format. */
  'main.books.fileType.ankiText': 'Anki text',
  /** File type name: a word book saved by Phevere (.pvbook). */
  'main.books.fileType.book': 'Phevere book',
  /** File type name covering every kind of book file Phevere opens. */
  'main.books.fileType.books': 'Books',
  'main.books.fileType.olderExport': 'Older Phevere export',
  'main.books.importTitle': 'Import a book',
  'main.books.openFailed': 'This book could not be opened.',
  'main.books.sqliteMissing': 'SQLite is not available to read this Anki file.',
  /** The name of the learner's own word list in the notebook. */
  'main.books.myWords': 'My words',
  /** Button: overwrite the existing book with the imported one. */
  'main.books.replace': 'Replace',
  /** Button: keep the existing book and add the imported one beside it. */
  'main.books.keepBoth': 'Keep both',
  'main.books.nameTaken': 'You already have a book named “{title}”.',
  'main.books.nameTakenDetail':
    "Replace overwrites its word list with this file's. Keep both adds this one as “{title} (2)”. Progress is merged either way.",
  /** Button: add the imported file's progress to the book already there. */
  'main.books.mergeProgress': 'Merge progress',
  'main.books.alreadyAdded': 'You already added “{title}”.',
  'main.books.alreadyAddedDetail': "This file's progress is merged into it.",

  // Offline dictionaries: file dialogs and download progress in Settings
  'main.offline.importPackTitle': 'Import dictionary pack',
  'main.offline.importCedictTitle': 'Import CC-CEDICT file',
  'main.offline.fileType.json': 'Dictionary JSON',
  'main.offline.fileType.all': 'All files',
  'main.offline.progress.downloading': 'Downloading…',
  /** {done} and {total} are sizes in megabytes. */
  'main.offline.progress.downloadingOf': 'Downloading {done} of {total} MB',
  /** {done} is a size in megabytes; the total size is unknown. */
  'main.offline.progress.downloadingSize': 'Downloading {done} MB',
  'main.offline.progress.importing': 'Importing…',
  'main.offline.progress.importingCount': { one: 'Importing {count} entry', other: 'Importing {count} entries' },
  'main.offline.progress.unpacking': 'Unpacking…',
  /** {reason} is the network error, usually in English. */
  'main.offline.downloadFailed': 'Download failed: {reason}',

  // Text recognition (OCR) models in Settings
  'main.ocr.chooseFolderTitle': 'Choose OCR model folder',
  'main.ocr.profile.custom': 'Custom model folder…',
  'main.ocr.unknownProfile': 'Unknown OCR profile',
  'main.ocr.folderHasNoModel': 'This folder does not contain an OCR model.',
  /** {model} is the OCR model's name, such as PP-OCRv5 mobile. */
  'main.ocr.using': 'Using {model}',
  'main.ocr.rapidReady': 'RapidOCR ready',
  'main.ocr.embeddedReady': 'Embedded OCR ready',
  'main.ocr.couldNotStart': 'Text recognition could not start (models: {path})',

  'main.ocrPack.downloadFailed': 'Could not download the OCR pack. Check the connection and try again.',

  // The scanned-text window
  'main.ocrResult.title': 'Scanned text',
  /** Default name of the saved picture, without the .png extension. */
  'main.ocrResult.fileName': 'Scanned text',
  'main.ocrResult.fileType.png': 'PNG image',

  // Updates
  /** Button: install the older version {version}. */
  'main.update.rollBack': 'Roll back to {version}',
  'main.update.rollBackQuestion': 'Replace Phevere {from} with {to}?',
  'main.update.rollBackDetail':
    'Your notebook is copied to the backups folder first and stays in place. {to} may drop details that only {from} records, such as review history, for words it changes. Automatic updates skip {from} until a newer version is published.',
  'main.update.noInstaller': 'This release has no installer for this computer.',
  'main.update.noChecksum': 'GitHub lists no checksum for {file}, so it was not installed.',
  'main.update.interrupted': 'The download was interrupted. It resumes where it stopped on the next check.',
  'main.update.checksumMismatch': "{file} did not match GitHub's checksum, so it was deleted.",
  /** {reason} is the network error, usually in English. */
  'main.update.unreachable': 'Could not reach GitHub. {reason}',

  // macOS permission dialogs; {app} is Phevere, or Electron in a development build
  'main.mac.accessibility.title': 'Accessibility access required',
  'main.mac.accessibility.message': '{app} needs Accessibility access to read selected text.',
  'main.mac.accessibility.detail': 'In System Settings, open Privacy & Security, then Accessibility, and turn on {app}.',
  'main.mac.screenRecording.title': 'Screen Recording access required',
  'main.mac.screenRecording.message': '{app} needs Screen Recording access to read text on screen.',
  'main.mac.screenRecording.detail': 'In System Settings, open Privacy & Security, then Screen Recording, and turn on {app}.',
  'main.mac.openSystemSettings': 'Open System Settings',
  'main.mac.notNow': 'Not Now',

  // Speech voices in Settings, Audio
  /** The built-in robotic voice (eSpeak NG). */
  'main.speech.voice.mechanical': 'Mechanical',
  /** Shown beside a voice that ships with Phevere and needs no download. */
  'main.speech.voice.builtIn': 'Built-in',
  'main.speech.voice.neuralStandard': 'Neural (standard)',
  'main.speech.voice.neuralHigh': 'Neural (high quality)',
  /** {status} is an HTTP status code. */
  'main.speech.downloadFailed': 'Download failed (HTTP {status})',
  'main.speech.verifyFailed': 'Download verification failed. Please retry.',

  // Account sign-in: the page the browser shows after sign-in, and sign-in errors
  'main.account.signedIn.title': 'Signed in to phevere',
  'main.account.signedIn.message': 'You can close this tab and go back to phevere.',
  'main.account.signInFailed.title': 'Sign-in did not finish',
  'main.account.signInFailed.message': 'Go back to phevere and try again.',
  'main.account.timedOut': 'Sign-in timed out. Try again.',
  'main.account.cancelled': 'Sign-in cancelled.',
  /** {ports} is a list of network port numbers. */
  'main.account.portsBusy':
    'Sign-in needs one of the local ports {ports}, and all are in use. Close the program using them and try again.',
};
