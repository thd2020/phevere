/** The desktop lookup pop-up, the quick translation panel and the scan windows (src/popup-new.html, src/quick-panel.*, src/ocr-*). */
export default {
  // Lookup pop-up: window and options panel
  /** The pop-up window's title, shown in the taskbar. */
  'popup.windowTitle': 'Phevere Dictionary',
  'popup.options.preload': 'Look up before expanding',
  'popup.options.openLinksExternally': 'Open links in browser',
  /** A switch: show pictures beside the senses. */
  'popup.options.images': 'Images',

  // Lookup pop-up: toolbar
  'popup.toolbar.history': 'Lookup history',
  'popup.toolbar.backTitle': 'Back (Alt+Left)',
  /** Go forward in the lookup history. */
  'popup.toolbar.forward': 'Forward',
  'popup.toolbar.forwardTitle': 'Forward (Alt+Right)',
  /** The group of view tabs (Lexicon, Translation, Wikipedia, Etymology). */
  'popup.toolbar.views': 'Views',
  /** A view tab: the dictionary entry. */
  'popup.tab.lexicon': 'Lexicon',
  /** A view tab: the word's translations. */
  'popup.tab.translation': 'Translation',
  /** A view tab: the word's origin. */
  'popup.tab.etymology': 'Etymology',
  'popup.playPronunciation': 'Play pronunciation',
  'popup.toolbar.searchWeb': 'Search the web',
  'popup.toolbar.saveToNotebook': 'Save to notebook',
  'popup.saveToMyWords': 'Save to My words',
  'popup.removeFromMyWords': 'Remove from My words',
  'popup.addToWordBook': 'Add to word book',
  'popup.toolbar.settings': 'Pop-up settings',
  'popup.toolbar.closeTitle': 'Close (Esc)',

  // Lookup pop-up: Translation view's language row
  /** Label before the source-language list. */
  'popup.translate.from': 'From',
  /** Label before the target-language list. */
  'popup.translate.to': 'To',
  'popup.translate.detectLanguage': 'Detect language',
  'popup.translate.swap': 'Swap languages',
  /** A language in the list: its own name, then its name in the interface language ("Deutsch (German)"). */
  'popup.translate.languageOption': '{native} ({name})',
  /** Tooltip on the source list when it is set to detect: the language that was detected. */
  'popup.translate.detected': 'Detected: {language}',

  // Lookup pop-up: loading
  'popup.loading.lookingUp': 'Looking up…',
  'popup.loading.querying': 'Querying dictionary sources',
  'popup.loading.detecting': 'Detecting language and fetching sources',
  'popup.loading.wikipedia': 'Wikipedia…',
  'popup.loading.wikipediaSummary': 'Fetching article summary',
  'popup.error.timedOut': 'Lookup timed out.',
  /** The lookup failed; {word} is the text the person selected. */
  'popup.error.lookupFailed': 'Could not look up "{word}".',
  'popup.error.unknown': 'Unknown error',
  'popup.results.none': 'No results.',

  // Lookup pop-up: Etymology view
  'popup.etymology.loading': 'Loading etymology',
  'popup.etymology.sources': 'Etymology sources',
  'popup.etymology.none': 'No etymology found.',
  'popup.etymology.blocked': 'Etymonline blocked this request.',
  'popup.etymology.unavailable': 'Etymonline is unavailable.',
  'popup.etymology.openOnEtymonline': 'Open on Etymonline',
  /** Tab name of the first etymology when its source has no name. */
  'popup.etymology.primary': 'Primary',
  /** Tab name of a further etymology when its source has no name, short for "alternative": "Alt 2". */
  'popup.etymology.alternative': 'Alt {n}',
  'popup.etymology.chain': 'Word history, oldest first',
  /** How an older form reached the newer one, shown on the arrow between them. */
  'popup.etymology.relation.inherited': 'inherited',
  'popup.etymology.relation.borrowed': 'borrowed',
  'popup.etymology.relation.learnedBorrowing': 'learned borrowing',
  'popup.etymology.relation.derived': 'derived',
  /** A loan translation. */
  'popup.etymology.relation.calque': 'calque',
  'popup.etymology.relation.root': 'root',

  // Lookup pop-up: Translation view
  /** A translation is on its way. */
  'popup.translation.translating': 'Translating',
  'popup.translation.none': 'No translation found.',
  /** Which engine translated: "via DeepL". */
  'popup.translation.via': 'via {provider}',
  /** Label over the original text when its language is not known: the source language. */
  'popup.translation.source': 'Source',
  'popup.translation.playSource': 'Play source',
  'popup.translation.playTranslation': 'Play translation',

  // Lookup pop-up: pronunciation
  'popup.audio.failed': 'Could not play pronunciation',
  'popup.audio.off': 'Pronunciation is off',
  'popup.ipa.none': 'No IPA for this word',
  'popup.ipa.failed': 'Could not play this IPA',
  'popup.ipa.playUs': 'Play US pronunciation',
  'popup.ipa.playUk': 'Play UK pronunciation',

  // Lookup pop-up: Lexicon view
  'popup.lexicon.noDefinitions': 'No definitions found.',
  'popup.lexicon.noDefinition': 'No definition.',
  /** {source} is a dictionary's name. */
  'popup.lexicon.noDefinitionsFrom': 'No definitions from {source}.',
  'popup.lexicon.sections': 'Lexicon sections',
  /** Section of senses that have no part of speech, beside sections such as "noun" and "verb". */
  'popup.lexicon.section.other': 'other',
  /** The only section, when no sense has a part of speech. */
  'popup.lexicon.section.senses': 'senses',
  /** The word's inflected forms. */
  'popup.lexicon.section.forms': 'forms',
  'popup.lexicon.section.examples': 'examples',
  'popup.lexicon.section.synonyms': 'synonyms',
  'popup.lexicon.section.antonyms': 'antonyms',
  /** Phrasal verbs, idioms and set phrases with the word. */
  'popup.lexicon.section.phrases': 'phrases',
  /** Short tab name of the word family section. */
  'popup.lexicon.section.family': 'family',
  /** Words built from the same root. */
  'popup.lexicon.section.wordFamily': 'word family',

  // Lookup pop-up: My words and word books
  'popup.save.notebookUnavailable': 'Notebook unavailable',
  'popup.save.nothing': 'Nothing to save',
  'popup.save.saved': 'Saved to My words',
  'popup.save.removed': 'Removed from My words',
  'popup.save.unavailable': 'Could not save. My words is unavailable.',
  /** {reason} is the error the notebook gave. */
  'popup.save.failed': 'Could not save: {reason}',
  /** {book} is the name of the person's word book. */
  'popup.bookAdd.added': 'Added to {book}',
  'popup.bookAdd.removed': 'Removed from {book}',

  // Lookup pop-up: Wikipedia view
  'popup.wiki.unavailable': 'Wikipedia unavailable.',
  'popup.wiki.nothingToSearch': 'Nothing to search.',
  'popup.wiki.none': 'No Wikipedia articles found.',
  'popup.wiki.failed': 'Wikipedia lookup failed.',
  'popup.wiki.back': 'Back to results',
  'popup.wiki.openInBrowser': 'Open in browser',

  // Quick translation panel
  'popup.quick.windowTitle': 'Quick translation',
  'popup.quick.from': 'Translate from',
  'popup.quick.to': 'Translate to',
  'popup.quick.swap': 'Swap languages',
  /** The list of translations, one per engine. */
  'popup.quick.translations': 'Translations',
  'popup.quick.detectLanguage': 'Detect language',
  /** Target language chosen automatically. */
  'popup.quick.autoTarget': 'Auto',
  'popup.quick.translating': 'Translating…',
  /** This engine gave no translation. */
  'popup.quick.noTranslation': 'No translation',
  /** Key hint: the arrow keys move between translation engines. */
  'popup.quick.keys.engine': 'Engine',
  /** Key hint: Enter pastes the chosen translation over the selected text. */
  'popup.quick.keys.replace': 'Replace',

  // Region picker for a scan
  'popup.scanRegion.windowTitle': 'Scan region',
  'popup.scanRegion.hint': 'Drag to select an area. Press Esc to cancel.',

  // Scanned-text window
  'popup.scanText.windowTitle': 'Scanned text',
  'popup.scanText.picture': 'Scanned picture',
  /** Status after the picture was saved to a file. */
  'popup.scanText.saved': 'Saved',
};
