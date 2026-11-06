/** The desktop main window and Settings window (src/renderer.ts, src/index.html, src/global-search.ts, src/shortcut-capture.ts). */
export default {
  // Main window chrome (src/index.html)
  'desktop.main.windowControls': 'Window',
  'desktop.main.minimize': 'Minimize',
  'desktop.main.maximize': 'Maximize',
  'desktop.main.account': 'Account',
  /** Accessible name of the row of tabs: Words, Learn, Recent. */
  'desktop.main.tabs': 'Main',
  'desktop.main.tab.words': 'Words',
  /** Tab of recently looked-up words. */
  'desktop.main.tab.recent': 'Recent',

  // Search panel under the main window's search field (src/global-search.ts)
  /** First row of the panel; {word} is the typed text, shown in bold. */
  'desktop.search.lookUp': 'Look up {word}',
  'desktop.search.allSaved': { one: 'All {count} saved word', other: 'All {count} saved words' },
  'desktop.search.myWords': 'My words',
  /** Heading over recently looked-up words. */
  'desktop.search.recent': 'Recent',

  // Recent lookups
  'desktop.recent.title': 'Recent lookups',
  'desktop.recent.clear': 'Clear history',
  'desktop.recent.cleared': 'Recent lookups cleared',
  'desktop.recent.noMatches': 'No matching lookups.',
  'desktop.recent.empty': 'No recent lookups.',

  // Clipboard history window
  'desktop.clipboard.empty': 'No clipboard items.',
  /** Window heading with the number of saved items in brackets. */
  'desktop.clipboard.title': { one: 'Clipboard history ({count})', other: 'Clipboard history ({count})' },
  /** Button that empties the clipboard history. */
  'desktop.clipboard.clear': 'Clear',
  'desktop.clipboard.search': 'Search clipboard…',
  'desktop.clipboard.clearConfirm': 'Clear clipboard history?',

  // Words tab
  /** Timeline rail entry for a week; {date} is its Monday, such as "March 3". */
  'desktop.words.weekOf': 'Week of {date}',
  'desktop.words.unavailable': 'My words is unavailable.',
  'desktop.words.loadFailed': 'Could not load My words.',
  'desktop.words.noMatches': 'No matching words.',
  'desktop.words.empty': 'No saved words.',
  'desktop.words.showMore': 'Show more',
  'desktop.words.showLess': 'Show less',
  /** Button that turns a flash card to its word side. */
  'desktop.words.card.showWord': 'Show word',
  /** Button that turns a flash card to its meaning side. */
  'desktop.words.card.showMeaning': 'Show meaning',
  /** Accessible name of a word book's menu when the book has no title. */
  'desktop.words.bookMenu': 'Book',
  'desktop.words.addToBook': 'Add to word book',
  'desktop.words.sort': 'Sort',
  /** Sort by when the word was saved, newest first. */
  'desktop.words.sortRecent': 'Recent',
  /** Sort alphabetically. */
  'desktop.words.sortAz': 'A–Z',
  'desktop.words.jumpToLetter': 'Jump to letter',
  'desktop.words.jumpToDate': 'Jump to date',

  // Status bar at the bottom of the main window
  'desktop.status.toggles': 'Monitoring toggles',
  /** Status bar switch for lookup on text selection. */
  'desktop.status.selection': 'Selection',
  'desktop.status.clipboard': 'Clipboard',
  /** Status bar switch for lookup on mouse hover. */
  'desktop.status.hover': 'Hover',
  'desktop.status.audio': 'Audio',
  /** Status bar button, read with the word under it: "Scan" "Region". */
  'desktop.status.scan': 'Scan',
  'desktop.status.region': 'Region',
  'desktop.status.scanTitle': 'Scan region ({shortcut})',
  /** Selection lookup mode: the pop-up opens only while the trigger key is held. */
  'desktop.status.selectionShortcut': 'Shortcut',
  /** {state} is On, Off or Shortcut. */
  'desktop.status.selectionLabel': 'Selection mode: {state}',
  /** Hover lookup is on but text recognition is not installed. */
  'desktop.status.hoverNoOcr': 'No OCR',
  'desktop.status.hoverLabel': 'Hover lookup: {state}',
  'desktop.status.hoverNeedsPack': 'Needs the OCR pack',
  'desktop.status.audioLabel': 'Pronunciation: {state}',

  // Settings: Shortcuts
  'desktop.settings.shortcuts.selectionMode': 'Selection mode',
  'desktop.settings.shortcuts.popupTrigger': 'Pop-up trigger',
  /** Hint under "Pop-up trigger": hold the key while selecting text. */
  'desktop.settings.shortcuts.popupTriggerHint': 'Hold while selecting',
  'desktop.settings.shortcuts.scanRegion': 'Scan region',
  'desktop.settings.shortcuts.hoverLookup': 'Hover lookup',
  /** Button that starts recording a new keyboard shortcut. */
  'desktop.settings.shortcuts.set': 'Set…',
  /** Heading over the shortcuts that cannot be changed. */
  'desktop.settings.shortcuts.builtIn': 'Built-in',
  'desktop.settings.shortcuts.scanUnderPointer': 'Scan under pointer',
  'desktop.settings.shortcuts.scanActiveWindow': 'Scan active window',
  'desktop.settings.shortcuts.scanClipboardImage': 'Scan clipboard image',
  'desktop.settings.shortcuts.lookUpNowPlaying': 'Look up now playing',
  /** Shown on a shortcut's Set… button while it waits for keys. */
  'desktop.settings.shortcuts.recording': 'Press a shortcut…',
  'desktop.settings.shortcuts.saved': 'Saved',
  'desktop.settings.shortcuts.saveFailed': 'Could not save',
  'desktop.settings.quickTranslation.title': 'Quick translation',
  /** First choice in the source language list. */
  'desktop.settings.quickTranslation.detect': 'Detect language',
  /** First choice in the target language list. */
  'desktop.settings.quickTranslation.auto': 'Auto',
  /** {names} is a list of shortcut names, such as "Translate and replace and Choose a translation". */
  'desktop.settings.quickTranslation.taken': '{names}: shortcut in use by another app',
  'desktop.settings.quickTranslation.enabled': 'Translate selected text in place',
  'desktop.settings.quickTranslation.replace': 'Translate and replace',
  'desktop.settings.quickTranslation.panel': 'Choose a translation',
  /** The source language of quick translation. */
  'desktop.settings.quickTranslation.from': 'From',
  /** The target language of quick translation. */
  'desktop.settings.quickTranslation.to': 'To',

  // Settings: Capture
  'desktop.settings.capture.hoverLookup': 'Hover lookup',
  /** Button that installs the text recognition pack hover lookup needs. */
  'desktop.settings.capture.install': 'Install',
  'desktop.settings.capture.openLookupsAs': 'Open lookups as',
  /** A lookup shown as a thin strip under the selection. */
  'desktop.settings.capture.openAsStrip': 'Strip',
  'desktop.settings.capture.openAsPanel': 'Full pop-up',
  'desktop.settings.capture.rememberSources': 'Remember where words were saved',
  'desktop.settings.capture.dropLabel': 'Choose, drop or paste an image',
  'desktop.settings.capture.dropTitle': 'Drop or paste an image',
  'desktop.settings.capture.dropFormats': 'PNG, JPEG or WebP',
  'desktop.settings.ocr.title': 'Text recognition',
  /** The text recognition model. */
  'desktop.settings.ocr.model': 'Model',
  'desktop.settings.ocr.checking': 'Checking…',
  'desktop.settings.ocr.refresh': 'Refresh',
  'desktop.settings.ocr.chooseFolder': 'Choose folder…',
  'desktop.settings.ocr.apply': 'Apply',
  /** A model in the list that is downloaded when chosen. */
  'desktop.settings.ocr.profileToDownload': '{name} (download)',
  'desktop.settings.ocr.unavailable': 'Text recognition unavailable.',
  'desktop.settings.ocr.ready': '{model}: ready',
  'desktop.settings.ocr.needsPack': 'Needs the OCR pack',
  /** {error} is the model's error message, or the word for "unavailable". */
  'desktop.settings.ocr.failed': '{model}: {error}',
  'desktop.settings.ocr.unavailableShort': 'unavailable',
  'desktop.settings.ocr.modelChecking': '{model}: checking…',
  'desktop.settings.ocr.checkFailed': 'Could not check status: {error}',
  'desktop.settings.ocr.chooseModelFolder': 'Choose a model folder…',
  'desktop.settings.ocr.cancelled': 'Cancelled.',
  'desktop.settings.ocr.loadingCustom': 'Loading custom models…',
  'desktop.settings.ocr.switchFailed': 'Could not switch model: {error}',
  'desktop.settings.ocr.unknownError': 'unknown',
  'desktop.settings.ocr.downloadingModels': 'Downloading models…',
  'desktop.settings.ocr.switching': 'Switching…',
  'desktop.settings.ocrPack.installing': 'Installing the OCR pack… {percent}',
  'desktop.settings.ocrPack.failed': 'Download failed',
  'desktop.settings.ocrPack.needed': 'Needs the OCR pack ({size})',
  'desktop.settings.ocrPack.retry': 'Retry',

  // Settings: Notifications
  'desktop.settings.notifications.imageCopied': 'Image copied',
  'desktop.settings.notifications.hoverToggled': 'Hover lookup switched on or off',
  'desktop.settings.notifications.updates': 'Update ready or available',

  // Settings: Updates
  'desktop.settings.updates.install': 'Install updates',
  'desktop.settings.updates.modeAuto': 'Automatically',
  'desktop.settings.updates.modeAsk': 'Ask first',
  /** Update mode: never install updates. */
  'desktop.settings.updates.modeOff': 'Off',
  'desktop.settings.updates.checkNow': 'Check now',
  /** The installed version, such as "Phevere 2.4.1". */
  'desktop.settings.updates.version': 'Phevere {version}',
  'desktop.settings.updates.checking': 'Checking…',
  'desktop.settings.updates.downloading': 'Downloading {version}… {percent}',
  'desktop.settings.updates.installing': 'Installing {version}…',
  'desktop.settings.updates.failed': 'Update failed',
  'desktop.settings.updates.ready': '{version} is ready. It installs when Phevere quits.',
  'desktop.settings.updates.available': '{version} is available',
  'desktop.settings.updates.upToDate': 'Up to date',
  'desktop.settings.updates.restart': 'Restart to update',
  'desktop.settings.updates.updateNow': 'Update now',
  /** Opens the release page to download the new version by hand. */
  'desktop.settings.updates.download': 'Download…',
  'desktop.settings.updates.rollBack': 'Roll back to {version}',

  // Settings: Sources
  /** Count above the dictionary list, such as "5 of 8 on". */
  'desktop.settings.sources.countOn': '{on} of {total} on',

  // Settings: Offline
  'desktop.settings.offline.title': 'Offline dictionary',
  /** Heading over the import buttons (a noun). */
  'desktop.settings.offline.import': 'Import',
  'desktop.settings.offline.importPack': 'Import pack',
  'desktop.settings.offline.importPackFormats': 'JSON or JSONL',
  'desktop.settings.offline.importCedict': 'Import CEDICT file',
  'desktop.settings.offline.unavailable': 'Offline dictionaries unavailable.',
  'desktop.settings.offline.catalogFailed': 'Could not load catalog.',
  'desktop.settings.offline.downloadConfirm': 'Download this dictionary pack?',
  'desktop.settings.offline.starting': 'Starting…',
  'desktop.settings.offline.installed': { one: 'Installed {name}, {count} entry.', other: 'Installed {name}, {count} entries.' },
  'desktop.settings.offline.downloadFailed': 'Download failed.',
  'desktop.settings.offline.downloadFailedWith': 'Download failed: {error}',
  'desktop.settings.offline.removeConfirm': 'Remove {name}?',
  'desktop.settings.offline.removed': 'Removed {name}.',
  'desktop.settings.offline.chooseJson': 'Choose a JSON or JSONL file…',
  'desktop.settings.offline.chooseCedict': 'Choose a CEDICT file…',
  'desktop.settings.offline.importCancelled': 'Import cancelled.',
  'desktop.settings.offline.imported': { one: 'Imported {count} entry.', other: 'Imported {count} entries.' },
  'desktop.settings.offline.importedCedict': { one: 'Imported {count} CEDICT entry.', other: 'Imported {count} CEDICT entries.' },
  'desktop.settings.offline.importFailed': 'Import failed.',
  'desktop.settings.offline.importFailedWith': 'Import failed: {error}',

  // Settings: Audio
  'desktop.settings.audio.pronunciation': 'Pronunciation',
  'desktop.settings.audio.voice': 'Pronunciation voice',
  'desktop.settings.audio.playback': 'Playback',
  'desktop.settings.audio.speed': 'Speed',
  /** Playback speed, such as "1.0×". */
  'desktop.settings.audio.speedValue': '{speed}×',
  'desktop.settings.audio.volume': 'Volume',
  'desktop.settings.audio.voiceDownloading': 'Downloading {percent}',
  /** A pronunciation voice that is on this computer. */
  'desktop.settings.audio.voiceDownloaded': 'Downloaded',
  'desktop.settings.audio.voiceRecommended': 'Recommended',
  'desktop.audio.playFailed': 'Could not play pronunciation',
};
