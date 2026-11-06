/** The phone app (apps/mobile/src). */
export default {
  // Updates (app-update.ts): the Updates section of Settings and the update notifications
  /** How the phone installs updates: by itself. */
  'mobile.update.mode.auto': 'Automatically',
  /** How the phone installs updates: after the user agrees. */
  'mobile.update.mode.ask': 'Ask first',
  /** How the phone installs updates: never checks by itself. */
  'mobile.update.mode.off': 'Off',
  /** {status} is an HTTP status code such as 403. */
  'mobile.update.githubAnswered': 'GitHub answered {status}',
  /** {file} is the APK's file name. */
  'mobile.update.noChecksum': 'GitHub lists no checksum for {file}, so it was not installed.',
  /** {detail} is the network error, in English. */
  'mobile.update.unreachable': 'Could not reach GitHub. {detail}',
  'mobile.update.notify.ready': 'Phevere {version} is ready to install.',
  'mobile.update.notify.available': 'Phevere {version} is available.',
  'mobile.update.status.checking': 'Checking…',
  /** {percent} is already formatted, such as "42%". */
  'mobile.update.status.downloading': 'Downloading {version}… {percent}',
  'mobile.update.status.failed': 'Update failed',
  /** "Install unknown apps" is the name of Android's own permission screen. */
  'mobile.update.status.needsPermission': 'Install unknown apps is off for Phevere',
  'mobile.update.status.ready': '{version} is ready to install',
  'mobile.update.status.available': '{version} is available',
  'mobile.update.status.upToDate': 'Up to date',
  /** Opens the release page to download the APK by hand (debug builds). */
  'mobile.update.action.download': 'Download…',
  'mobile.update.action.install': 'Install',
  'mobile.update.action.updateNow': 'Update now',
  /** The progress bar's name while the APK downloads. */
  'mobile.update.downloadingLabel': 'Downloading update',
  /** Label of the choice between Automatically, Ask first and Off. */
  'mobile.update.installUpdates': 'Install updates',
  'mobile.update.checkNow': 'Check now',

  // Settings → Capture (settings-panels.ts)
  'mobile.capture.floatingPopup': 'Floating pop-up',
  /** Android's permission "Display over other apps", by its system name. */
  'mobile.capture.displayOverApps': 'Display over other apps',
  'mobile.capture.cameraOrPhoto': 'Camera or photo',
  /** Heading: reading text from a picture. */
  'mobile.capture.scan': 'Scan',
  /** Heading on iOS: what happens when text is selected. */
  'mobile.capture.selection': 'Selection',
  'mobile.capture.popUpOnSelection': 'Pop up on selection',
  /** Heading: Android's menu of actions over selected text (Cut, Copy, Paste…). */
  'mobile.capture.selectionBar': 'Selection bar',
  /** Where Phevere sits on the selection bar. */
  'mobile.capture.positionOnBar': 'Position on bar',
  /** Position choice: where Android puts it. */
  'mobile.capture.position.system': 'System',
  /** Position choice: where the user drags it. */
  'mobile.capture.position.custom': 'Custom',
  'mobile.capture.lsposedModule': 'LSPosed module',
  'mobile.capture.moduleAbout': 'Adds Phevere to the text selection menu in chosen apps',
  /** State of the LSPosed module: not running. */
  'mobile.capture.moduleInactive': 'Inactive',
  /** Android's accessibility service, by its system name. */
  'mobile.capture.accessibilityService': 'Accessibility service',

  // The mock selection bar under Settings → Capture. These imitate Android's own text
  // selection menu, which Android shows in the phone's language: use Android's wording.
  'mobile.mockBar.cut': 'Cut',
  'mobile.mockBar.copy': 'Copy',
  'mobile.mockBar.paste': 'Paste',
  'mobile.mockBar.selectAll': 'Select all',
  'mobile.mockBar.share': 'Share',
  /** Name of the draggable Phevere chip, read by screen readers. */
  'mobile.mockBar.position': 'Phevere position on the selection bar',
  'mobile.mockBar.moveLeft': 'Move Phevere left',
  'mobile.mockBar.moveRight': 'Move Phevere right',

  // Settings → Notifications
  /** Row that asks for Android's notification permission. */
  'mobile.notifications.allow': 'Notifications',
  'mobile.notifications.incoming': 'Incoming lookup',
  'mobile.notifications.saved': 'Saved to notebook',
  'mobile.notifications.scanFinished': 'Scan finished',
  'mobile.notifications.updates': 'Update ready or available',
  'mobile.notifications.systemSettings': 'System notification settings',

  // Settings → Sources
  /** Heading of the switch for pictures from Wikimedia Commons. */
  'mobile.sources.pictures': 'Pictures',
  'mobile.sources.picturesBesideSenses': 'Pictures beside senses',

  // Settings → Offline
  'mobile.offline.storedInBrowser': 'Browser storage for this site',
  /** {file} is the database's file name. */
  'mobile.offline.storedInApp': '{file} in app storage',
  /** Heading of the import rows. */
  'mobile.offline.import': 'Import',
  'mobile.offline.importPack': 'Import pack',
  /** The file formats an imported pack may be in; the names are formats and stay as written. */
  'mobile.offline.importPackFormats': 'FreeDict TEI, JMdict JSON, Kengdic TSV, WordNet or GCIDE',
  'mobile.offline.importCedict': 'Import CEDICT file',

  // Settings → Audio
  'mobile.audio.pronunciation': 'Pronunciation',
  'mobile.audio.voice': 'Pronunciation voice',
  /** The built-in robotic voice that needs no download. */
  'mobile.audio.voice.mechanical': 'Mechanical',
  'mobile.audio.voice.compact': 'Neural (standard)',
  'mobile.audio.voice.full': 'Neural (high quality)',
  /** {percent} is already formatted, such as "40%". */
  'mobile.audio.voiceDownloading': 'Downloading {percent}',
  'mobile.audio.voiceBuiltIn': 'Built-in',
  'mobile.audio.voiceDownloaded': 'Downloaded',
  /** Screen reader name of a voice not yet downloaded; {size} is formatted, such as "60 MB". */
  'mobile.audio.voiceNeedsDownload': '{name}, download {size}',
  /** Heading of the speed and volume sliders. */
  'mobile.audio.playback': 'Playback',
  'mobile.audio.speed': 'Speed',
  'mobile.audio.volume': 'Volume',
  /** The playback speed, such as "1.0×"; {speed} is already formatted. */
  'mobile.audio.speedValue': '{speed}×',

  // Settings → Offline: catalogue installs and imported files (app.ts, platform/offline.ts)
  'mobile.offline.downloading': 'Downloading…',
  'mobile.offline.unpacking': 'Unpacking…',
  'mobile.offline.importingProgress': 'Importing {done} of {total}',
  'mobile.offline.installed': { one: 'Installed {name}, {count} entry', other: 'Installed {name}, {count} entries' },
  'mobile.offline.removePackConfirm': 'Remove this pack?',
  'mobile.offline.importing': 'Importing…',
  'mobile.offline.importedEntries': { one: 'Imported {count} entry', other: 'Imported {count} entries' },
  /** {name} is the dictionary pack's name. */
  'mobile.offline.error.noEntries': 'No entries parsed for {name}',
  'mobile.offline.error.cannotInstall': 'This pack cannot be installed here.',
  /** {detail} is the last network error, in English. */
  'mobile.offline.error.downloadFailed': 'Download failed: {detail}',
  /** {id} is the pack's internal id. */
  'mobile.offline.error.unknownPack': 'Unknown pack {id}',
  'mobile.offline.error.emptyArchive': 'Archive had no dictionary files',

  // Bottom navigation and the top bar (views.ts)
  /** The bottom navigation bar, for screen readers. */
  'mobile.nav.label': 'Primary',
  /** Bottom bar tab: the lookup screen. */
  'mobile.nav.lookup': 'Lookup',
  /** Bottom bar tab: the saved words and word books. */
  'mobile.nav.words': 'Words',
  /** Go forward in the lookup history. */
  'mobile.bar.forward': 'Forward',
  'mobile.bar.scanText': 'Scan text',
  'mobile.bar.searchWeb': 'Search the web',
  /** In the floating pop-up: open the word in the full app. */
  'mobile.bar.openInApp': 'Open in Phevere',
  'mobile.search.placeholder': 'Look up a word or phrase',

  // Lookup screen (views.ts)
  'mobile.lookup.lookingUp': 'Looking up',
  /** {word} is the text the person looked up. */
  'mobile.lookup.failed': 'Could not look up "{word}".',
  'mobile.lookup.unknownError': 'Unknown error',
  'mobile.lookup.empty': 'Type a word, or select text in another app.',
  /** The list of recent lookups, for screen readers. */
  'mobile.lookup.recentLabel': 'Recent lookups',
  /** Heading over the recent lookups. */
  'mobile.lookup.recent': 'Recent',
  'mobile.lookup.saveToMyWords': 'Save to My words',
  'mobile.lookup.removeFromMyWords': 'Remove from My words',
  /** A result tab: the dictionary entry. */
  'mobile.result.lexicon': 'Lexicon',
  /** A result tab: the word's translations. */
  'mobile.result.translation': 'Translation',
  /** A result tab: the word's origin. */
  'mobile.result.etymology': 'Etymology',
  'mobile.ipa.play': 'Play pronunciation',
  'mobile.ipa.playUs': 'Play US pronunciation',
  'mobile.ipa.playUk': 'Play UK pronunciation',

  // Lookup: Lexicon tab. Section names are lower case, like the parts of speech beside them.
  'mobile.lexicon.noDefinitions': 'No definitions found.',
  'mobile.lexicon.sections': 'Lexicon sections',
  /** Section of senses that have no part of speech, beside sections such as "noun" and "verb". */
  'mobile.lexicon.section.other': 'other',
  /** The only section, when no sense has a part of speech. */
  'mobile.lexicon.section.senses': 'senses',
  /** The word's inflected forms. */
  'mobile.lexicon.section.forms': 'forms',
  'mobile.lexicon.section.examples': 'examples',
  'mobile.lexicon.section.synonyms': 'synonyms',
  'mobile.lexicon.section.antonyms': 'antonyms',
  /** Phrasal verbs, idioms and set phrases with the word. */
  'mobile.lexicon.section.phrases': 'phrases',
  /** Short tab name of the word family section. */
  'mobile.lexicon.section.family': 'family',
  /** Words built from the same root. */
  'mobile.lexicon.section.wordFamily': 'word family',

  // Lookup: Translation tab and its language picker (views.ts, picker.ts)
  /** A translation is on its way. */
  'mobile.translation.translating': 'Translating',
  'mobile.translation.none': 'No translation found.',
  /** Which engine translated: "via DeepL". */
  'mobile.translation.via': 'via {provider}',
  /** Label over the original text when its language is not known. */
  'mobile.translation.source': 'Source',
  'mobile.translation.playSource': 'Play source',
  'mobile.translation.playTranslation': 'Play translation',
  'mobile.picker.detectLanguage': 'Detect language',
  /** {language} is the chosen source language's name. */
  'mobile.picker.fromLabel': 'Translate from: {language}',
  /** {language} is the chosen target language's name. */
  'mobile.picker.toLabel': 'Translate to: {language}',
  'mobile.picker.swap': 'Swap languages',
  /** Heading of the sheet that picks the source language. */
  'mobile.picker.from': 'Translate from',
  /** Heading of the sheet that picks the target language. */
  'mobile.picker.to': 'Translate to',
  'mobile.picker.search': 'Search languages',
  'mobile.picker.recent': 'Recent languages',
  'mobile.picker.all': 'All languages',

  // Lookup: Wikipedia tab
  'mobile.wiki.openInBrowser': 'Open in browser',
  'mobile.wiki.loadingArticle': 'Loading article…',
  'mobile.wiki.failed': 'Wikipedia lookup failed.',
  'mobile.wiki.none': 'No Wikipedia articles found.',
  'mobile.wiki.searching': 'Searching Wikipedia',

  // Lookup: Etymology tab
  /** Tab name of the first etymology when its source has no name. */
  'mobile.etymology.primary': 'Primary',
  /** Tab name of a further etymology when its source has no name, short for "alternative": "Alt 2". */
  'mobile.etymology.alternative': 'Alt {n}',
  'mobile.etymology.chain': 'Word history, oldest first',
  /** How an older form reached the newer one, shown on the arrow between them. */
  'mobile.etymology.relation.inherited': 'inherited',
  'mobile.etymology.relation.borrowed': 'borrowed',
  'mobile.etymology.relation.learnedBorrowing': 'learned borrowing',
  'mobile.etymology.relation.derived': 'derived',
  /** A loan translation. */
  'mobile.etymology.relation.calque': 'calque',
  'mobile.etymology.relation.root': 'root',
  'mobile.etymology.loading': 'Loading etymology',
  'mobile.etymology.none': 'No etymology found.',
  'mobile.etymology.blocked': 'Etymonline blocked this request.',
  'mobile.etymology.unavailable': 'Etymonline is unavailable.',
  'mobile.etymology.openOnEtymonline': 'Open on Etymonline',
  'mobile.etymology.sources': 'Etymology sources',

  // Words tab (views.ts, app.ts)
  'mobile.words.searchPlaceholder': 'Search words…',
  'mobile.words.search': 'Search words',
  'mobile.words.searchBookPlaceholder': 'Search this book…',
  'mobile.words.searchBook': 'Search this book',
  /** The sort buttons, for screen readers. */
  'mobile.words.sort': 'Sort',
  'mobile.words.sort.recentLabel': 'Most recent first',
  /** Tooltip of the sort button: most recent first. */
  'mobile.words.sort.recent': 'Recent',
  'mobile.words.sort.azLabel': 'Alphabetical',
  /** Tooltip of the alphabetical sort button. */
  'mobile.words.sort.az': 'A–Z',
  'mobile.words.noMatches': 'No matching words.',
  'mobile.words.empty': 'No saved words.',
  /** The A to Z rail beside the list. */
  'mobile.words.jumpToLetter': 'Jump to letter',
  /** Button on a word card: turn it to show the word. */
  'mobile.words.card.showWord': 'Show word',
  /** Button on a word card: turn it to show the meaning. */
  'mobile.words.card.showMeaning': 'Show meaning',
  'mobile.words.showMore': 'Show more',
  'mobile.words.showLess': 'Show less',
  /** Fallback name of a word book's menu. */
  'mobile.books.menuFallback': 'Book',
  'mobile.books.addToBook': 'Add to word book',
  /** {title} is a word book's name. */
  'mobile.books.added': 'Added {title}',
  'mobile.books.addedTo': 'Added to {title}',
  'mobile.books.removedFrom': 'Removed from {title}',
  'mobile.books.deleted': 'Deleted {title}',
  'mobile.books.removed': 'Removed {title}',
  /** A new word book was made from a source; {title} is its name. */
  'mobile.books.made': 'Made {title}',

  // Importing and exporting word lists (app.ts, platform/notebook-io.ts)
  'mobile.import.importedSkipped': 'Imported {imported}. Skipped {skipped}.',
  /** {title} is the name of the person's own word book. */
  'mobile.import.conflictUser': 'You already have a book named “{title}”.',
  'mobile.import.conflictUserDetail':
    "Replace overwrites its word list with this file's. Keep both adds this one as “{title} (2)”. Progress is merged either way.",
  'mobile.import.keepBoth': 'Keep both',
  /** Button: overwrite the existing book with the file. */
  'mobile.import.replace': 'Replace',
  /** {title} is a published word book's name. */
  'mobile.import.conflictCatalog': 'You already added “{title}”.',
  'mobile.import.conflictCatalogDetail': "This file's progress is merged into it.",
  'mobile.import.mergeProgress': 'Merge progress',
  'mobile.import.newInMyWords': { one: '{count} new in My words', other: '{count} new in My words' },
  'mobile.import.importedBook': { one: 'Imported {title}: {count} word', other: 'Imported {title}: {count} words' },
  /** {record} is the row number in the file. */
  'mobile.import.csv.badQuote': 'Invalid CSV: unexpected character or quote in record {record}',
  'mobile.import.csv.unterminated': 'Invalid CSV: unterminated quoted field',
  'mobile.import.csv.headers': 'Invalid CSV: expected unique, non-empty headers including lemma',
  'mobile.import.csv.columns': 'Invalid CSV: column count does not match headers in record {record}',
  'mobile.import.json.notArray': 'JSON notebook must be an array (or { entries: [] })',
  'mobile.notebook.keptChanging': 'The notebook kept changing while saving',

  // Toasts (app.ts)
  'mobile.toast.savedToMyWords': 'Saved to My words',
  'mobile.toast.removedFromMyWords': 'Removed from My words',
  /** {error} is what went wrong, often in English. */
  'mobile.toast.couldNotSave': 'Could not save: {error}',
  /** {file} is the saved file's name. */
  'mobile.toast.savedFile': 'Saved {file}',
  'mobile.toast.couldNotExport': 'Could not export',
  'mobile.toast.couldNotImport': 'Could not import',
  'mobile.toast.pronunciationOff': 'Pronunciation is off',
  'mobile.toast.couldNotCopy': 'Could not copy',
  'mobile.toast.couldNotPlay': 'Could not play pronunciation',
  'mobile.toast.couldNotPlayIpa': 'Could not play this IPA',

  // Scan (app.ts, views.ts)
  /** Name of the saved picture file, without its extension. */
  'mobile.scan.imageFileName': 'Scanned text',
  'mobile.scan.couldNotSaveImage': 'Could not save',
  'mobile.scan.needsApp': 'Scanning requires the Android or iOS app.',
  'mobile.scan.noPicture': 'No picture',
  'mobile.scan.failed': 'Could not scan',
  'mobile.scan.picture': 'Scanned picture',
  /** Hint over a scanned picture. */
  'mobile.scan.selectText': 'Select text',
  /** The sheet over the picture that shows a lookup. */
  'mobile.scan.sheet': 'Lookup',
  'mobile.scan.resizeSheet': 'Resize lookup',

  // Sense pictures
  'mobile.picture.hidden': 'Picture hidden',
  'mobile.picture.hide': 'Hide picture',

  // System notifications (app.ts)
  'mobile.notify.saved': 'Saved to My words',
  'mobile.notify.scanFinished': 'Scan finished',
  'mobile.notify.scanWords': { one: '{count} word', other: '{count} words' },
  'mobile.notify.scanNoText': 'No text',
  /** Title of the notification for a word sent from another app. */
  'mobile.notify.incoming': 'Incoming lookup',

  // Account (app.ts, platform/account.ts)
  /** The account sheet, for screen readers. */
  'mobile.account.sheet': 'Account',
  'mobile.account.deleted': 'Account deleted',
  'mobile.account.signInNeedsApp': 'Sign-in works in the phevere app, not in a browser preview.',
  'mobile.account.signInUnfinished': 'Sign-in did not finish.',

  /** The count beside the Dictionaries heading in Settings → Sources: "5 of 9 on". */
  'mobile.sources.countOn': '{on} of {total} on',
};
