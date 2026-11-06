/**
 * Settings pages shared by the desktop and the phone (packages/core/src/settings-*.ts), and
 * the section names both list.
 */
export default {
  'settings.title': 'Settings',
  'settings.sections': 'Settings sections',
  'settings.section.shortcuts': 'Shortcuts',
  'settings.section.capture': 'Capture',
  'settings.section.learn': 'Learn',
  'settings.section.notifications': 'Notifications',
  'settings.section.sources': 'Sources',
  'settings.section.offline': 'Offline',
  'settings.section.api': 'API keys',
  'settings.section.audio': 'Audio',
  'settings.section.updates': 'Updates',
  'settings.section.about': 'About',
  'settings.language': 'App language',
  'settings.language.system': 'System',

  // Shared rows (settings-kit.ts)
  /** Accessible name of the button that stops a voice or pack download. */
  'settings.kit.cancelDownload': 'Cancel download',
  /** Shown in place of key caps when a shortcut has no keys. */
  'settings.kit.shortcutNotSet': 'Not set',

  // Settings → About
  'settings.about.version': 'Version {version}',
  'settings.about.versionBuild': 'Version {version} ({build})',
  'settings.about.versionUnknown': 'Development build',
  'settings.about.starTitle': 'Like Phevere?',
  'settings.about.starSub': 'A star on GitHub helps other people find it.',
  /** Button: give the GitHub repository a star. */
  'settings.about.star': 'Star on GitHub',
  'settings.about.sourceCode': 'Source code',
  'settings.about.whatsNew': 'What’s new',
  'settings.about.reportProblem': 'Report a problem',
  'settings.about.privacy': 'Privacy policy',
  'settings.about.licence': 'Licence',
  'settings.about.author': 'Author',
  'settings.about.dataHead': 'Data sources',
  'settings.about.softwareHead': 'Software and fonts',
  'settings.about.servicesName': 'Online services',
  'settings.about.servicesSub': 'Used under each service’s terms',
  'settings.about.perFile': 'Licence shown with each file',
  'settings.about.perPack': 'Licence shown with each pack',
  /** The first line of a new GitHub issue's body; the version follows it. */
  'settings.about.issueIntro': 'What happened, and what did you expect?',
  // What each credited work provides
  'settings.about.provides.wiktionary': 'Definitions, pronunciation, word history and word families, also through Free Dictionary API and Kaikki',
  'settings.about.provides.wikipedia': 'Article summaries',
  'settings.about.provides.commons': 'Pictures and recorded pronunciations',
  'settings.about.provides.wikidata': 'Links from senses to pictures',
  'settings.about.provides.jmdict': 'Japanese entries, online through Jisho and offline',
  'settings.about.provides.openrussian': 'Russian stress, forms and translations',
  'settings.about.provides.tatoeba': 'Example sentences and their translations',
  'settings.about.provides.cedict': 'Chinese entries, offline',
  'settings.about.provides.wordnet': 'Sense order, and an offline dictionary',
  'settings.about.provides.gcide': 'Webster’s 1913 dictionary, offline',
  'settings.about.provides.freedict': 'Bilingual dictionaries, offline',
  'settings.about.provides.kengdic': 'Korean entries, offline',
  'settings.about.provides.etymonline': 'Word history',
  /** The book names (Starter, General, Academic, TOEIC, Business English) are titles of published word lists. */
  'settings.about.provides.ngsl': 'Starter, General, Academic, TOEIC and Business English word books',
  /** 中考, 高考, CET-4, CET-6 and 考研 are names of Chinese exams and stay as written. */
  'settings.about.provides.ecdict': '中考, 高考, CET-4, CET-6 and 考研 word books',
  'settings.about.provides.cmudict': 'American pronunciation',
  'settings.about.provides.espeak': 'Mechanical voice, and pronunciation for the Neural voices',
  'settings.about.provides.espeakIos': 'Pronunciation for the Neural voices',
  'settings.about.provides.kokoro': 'Neural voices',
  'settings.about.provides.sherpa': 'Speech engine',
  'settings.about.provides.ppocr': 'Text recognition in images',
  /** Outfit, Source Serif 4, Charis SIL and IBM Plex Mono are font names. */
  'settings.about.provides.fonts': 'Outfit, Source Serif 4, Charis SIL and IBM Plex Mono',
  'settings.about.fontsName': 'Fonts',

  // Settings → API keys
  'settings.keys.unlocks.google': 'Translations and language detection through the Cloud Translation API',
  'settings.keys.unlocks.deepl': 'DeepL as the translation engine',
  'settings.keys.unlocks.youdao': 'Youdao translation and Youdao dictionary entries',
  'settings.keys.unlocks.oxford': 'Oxford definitions and etymologies in lookups',
  'settings.keys.unlocks.wordsapi': 'WordsAPI definitions and synonyms in lookups',
  'settings.keys.unlocks.collins': 'Collins definitions in lookups',
  'settings.keys.field.apiKey': 'API key',
  /** DeepL's name for its API key. */
  'settings.keys.field.authKey': 'Authentication key',
  'settings.keys.field.appKey': 'App key',
  'settings.keys.field.appSecret': 'App secret',
  'settings.keys.field.appId': 'App ID',
  'settings.keys.field.rapidApiKey': 'RapidAPI key',
  /** The RapidAPI host name a Collins subscription gives. */
  'settings.keys.field.apiHost': 'API host',
  /** Key status: nothing entered. */
  'settings.keys.status.unset': 'Not set',
  /** Key status: stored, not tested yet. */
  'settings.keys.status.saved': 'Saved',
  'settings.keys.status.testing': 'Testing…',
  'settings.keys.status.verified': 'Verified',
  'settings.keys.status.failed': 'Failed',
  /** Placeholder in a secret field whose saved value cannot be shown. */
  'settings.keys.savedSecret': '•••••••••••• saved',
  /** Placeholder in a plain field whose saved value cannot be shown. */
  'settings.keys.savedPlain': 'Saved',
  'settings.keys.show': 'Show {field}',
  'settings.keys.hide': 'Hide {field}',
  'settings.keys.clear': 'Clear {field}',
  'settings.keys.getKey': 'Get a key',
  /** Button: send a test request with the key. */
  'settings.keys.test': 'Test',
  // Results of the Test button (api-key-check.ts)
  'settings.keys.check.works': 'Key works',
  'settings.keys.check.rateLimited': 'Rate limited; try again later',
  'settings.keys.check.noKey': 'No key saved',
  'settings.keys.check.unreachable': 'Could not reach {host}',
  /** {status} is an HTTP status code such as 401. */
  'settings.keys.check.httpStatus': 'HTTP {status}',
  'settings.keys.check.deeplRejected': 'DeepL rejected the key',
  'settings.keys.check.youdaoBothNeeded': 'App key and secret are both needed',
  'settings.keys.check.cannotSign': 'Cannot sign the request here',
  'settings.keys.check.youdaoUnknownKey': 'Youdao does not recognise the app key (error 108)',
  'settings.keys.check.youdaoSignature': 'Signature check failed; check the app secret (error 202)',
  /** {code} is Youdao's numeric error code. */
  'settings.keys.check.youdaoError': 'Youdao error {code}',
  'settings.keys.check.oxfordBothNeeded': 'App ID and app key are both needed',
  'settings.keys.check.collinsBothNeeded': 'API key and host are both needed',
  'settings.keys.check.unknownProvider': 'Unknown provider',

  // Settings → Learn
  'settings.learn.newWordsHead': 'New words a day',
  'settings.learn.questionsHead': 'Questions',
  'settings.learn.myWords': 'My words',
  'settings.learn.countdown': 'Countdown on choice questions',
  'settings.learn.plan.minutes': { one: 'About {count} min a day', other: 'About {count} min a day' },
  'settings.learn.plan.finish': 'every word started by {when}',
  'settings.learn.plan.allStarted': 'every word started',
  'settings.learn.suggested': 'Your pace',
  'settings.learn.other': 'Other',
  'settings.learn.otherLabel': 'New words a day for {list}',
  'settings.learn.left': { one: '{count} not started', other: '{count} not started' },
  'settings.learn.secondsShort': '{count} s',
  'settings.learn.off': 'Off',
  /** The word under the countdown wheel's number. */
  /** Read by a screen reader for the countdown wheel's value. */
  'settings.learn.speaking': 'Speaking questions',

  // Settings → Sources
  'settings.sources.dictionaries': 'Dictionaries',
  /** How many dictionary sources are switched on, as "5 of 9 on". */
  'settings.sources.countOn': '{on} of {total} on',
  'settings.sources.empty': 'No dictionary sources loaded.',
  'settings.sources.nativeHead': 'Definitions in other languages',
  'settings.sources.engineHead': 'Translation engine',
  /** A chip for a source that covers words in any language. */
  'settings.sources.manyLanguages': 'Many languages',
  'settings.sources.needsKey': 'API key required',
  'settings.sources.needsPack': 'Offline pack required',
  /** Translation engine choice: pick an engine on its own. */
  'settings.sources.engine.auto': 'Automatic',
  'settings.sources.about.freeDictionary': 'English definitions, phonetic spellings and recorded pronunciations, drawn from Wiktionary.',
  'settings.sources.about.wiktionary': 'Definitions, parts of speech and etymologies from the English Wiktionary, for words in any language it covers.',
  'settings.sources.about.oxford': 'Oxford definitions, examples and etymologies for English words.',
  'settings.sources.about.collins': 'Collins English definitions, through a RapidAPI subscription.',
  'settings.sources.about.wordsapi': 'English definitions with synonyms and related words.',
  'settings.sources.about.youdao': 'Chinese–English dictionary entries and web translations from NetEase Youdao.',
  'settings.sources.about.cedict': 'Chinese–English entries with pinyin, read from the CC-CEDICT offline pack.',
  'settings.sources.about.datamuse': 'Short English definitions and synonyms from the Datamuse word-finding API.',
  'settings.sources.about.tatoeba': 'Example sentences with translations, written and checked by volunteers.',
  'settings.sources.about.jisho': 'Japanese words with readings and English glosses. Built on JMdict.',
  'settings.sources.about.openrussian': 'Russian words with stress marks, inflected forms and English translations.',
  'settings.sources.about.kaikki': 'Wiktionary entries extracted by wiktextract, for words that are not English.',
  /** 〈书〉 is the label Chinese dictionaries use for literary senses; keep it as written. */
  'settings.sources.about.zhWiktionary': 'Definitions written in Chinese, for Chinese words and words of other languages. Literary and Classical senses are marked 〈书〉.',
  'settings.sources.about.ruWiktionary': 'Russian words defined in Russian.',
  'settings.sources.about.jaWiktionary': 'Japanese words defined in Japanese.',
  'settings.sources.about.engineAuto': 'Google Translate first, then MyMemory when Google does not answer.',
  'settings.sources.about.engineGoogle': 'Works without a key. With a Cloud Translation key it uses the official API.',
  'settings.sources.about.engineMymemory': 'Translation memory from Translated, mixing human and machine translations.',
  'settings.sources.about.engineYoudao': 'Translation by NetEase Youdao.',
  'settings.sources.about.engineDeepl': 'Translation by DeepL, with a key from a DeepL API Free account.',

  // Settings → Offline: shelves and cards
  'settings.offline.script.latin': 'Latin script',
  'settings.offline.script.han': 'Han characters',
  'settings.offline.script.kanjiKana': 'Kanji and kana',
  'settings.offline.script.hangul': 'Hangul',
  'settings.offline.script.greek': 'Greek script',
  'settings.offline.script.cyrillic': 'Cyrillic script',
  'settings.offline.script.arabic': 'Arabic script',
  'settings.offline.script.hebrew': 'Hebrew script',
  'settings.offline.script.devanagari': 'Devanagari',
  'settings.offline.script.thai': 'Thai script',
  /** The size of an alphabet. */
  'settings.offline.letters': { one: '{count} letter', other: '{count} letters' },
  /** The size of an alphabet and the letters that set it apart, as "30 letters, č ć đ š ž". */
  'settings.offline.lettersWith': { one: '{count} letter, {letters}', other: '{count} letters, {letters}' },
  'settings.offline.trait.zh': 'Simplified and traditional',
  'settings.offline.trait.ja': 'Hiragana, katakana',
  'settings.offline.trait.ko': 'Syllable blocks',
  'settings.offline.trait.rtl': 'Right to left',
  'settings.offline.trait.toneMarks': 'Tone marks',
  'settings.offline.shelfPacks': { one: '{count} pack', other: '{count} packs' },
  'settings.offline.shelfPacksInstalled': { one: '{count} pack, {installed} installed', other: '{count} packs, {installed} installed' },
  'settings.offline.entries': { one: '{count} entry', other: '{count} entries' },
  /** A rounded count on a pack card, as "~125,000 entries". */
  'settings.offline.entriesApproxShort': { one: '~{count} entry', other: '~{count} entries' },
  'settings.offline.entriesAbout': { one: 'About {count} entry', other: 'About {count} entries' },
  'settings.offline.entriesInstalled': { one: '{count} installed', other: '{count} installed' },
  'settings.offline.entriesPublished': { one: '{count} entry published', other: '{count} entries published' },
  'settings.offline.entriesPublishedAbout': { one: 'About {count} entry published', other: 'About {count} entries published' },
  'settings.offline.removeNamed': 'Remove {name}',
  'settings.offline.downloadNamed': 'Download {name}',
  /** Accessible name of a pack card that opens its details. */
  'settings.offline.details': '{name} details',
  // The pack inspector
  /** Pack state. */
  'settings.offline.installed': 'Installed',
  /** Pack state. */
  'settings.offline.notInstalled': 'Not installed',
  'settings.offline.meta.language': 'Language',
  'settings.offline.meta.entries': 'Entries',
  /** Row label: the size of the download, as a noun. */
  'settings.offline.meta.download': 'Download',
  'settings.offline.meta.installedSize': 'Installed size',
  'settings.offline.meta.edition': 'Edition',
  'settings.offline.meta.date': 'Date',
  'settings.offline.meta.publisher': 'Publisher',
  'settings.offline.meta.licence': 'Licence',
  'settings.offline.meta.source': 'Source',
  'settings.offline.meta.homepage': 'Homepage',
  'settings.offline.meta.installedOn': 'Installed on',
  'settings.offline.meta.storedIn': 'Stored in',
  // Pack descriptions and download confirmations (offline-catalog.ts)
  /** CC-CEDICT's edition: a new file is exported every day. */
  'settings.offline.edition.daily': 'Daily export',
  'settings.offline.desc.wikdict': '{language} headwords with English translations, generated from Wiktionary by WikDict.',
  'settings.offline.desc.freedict': '{language} headwords with English translations from the FreeDict project.',
  'settings.offline.desc.wordnet': 'A lexical database of English. Nouns, verbs, adjectives and adverbs are grouped into sets of synonyms, each with a short definition.',
  'settings.offline.desc.gcide': "GNU's Collaborative International Dictionary of English: Webster's Revised Unabridged Dictionary of 1913, supplemented with WordNet and proofread by volunteers.",
  'settings.offline.desc.engZho': 'English headwords with Chinese translations, generated from Wiktionary by WikDict.',
  'settings.offline.desc.cedict': 'Community-maintained Chinese–English dictionary with traditional and simplified characters, pinyin and English glosses.',
  'settings.offline.desc.jmdict': 'Japanese–English dictionary with kanji spellings, kana readings and English glosses, in the JSON edition by jmdict-simplified.',
  'settings.offline.desc.jmdictCommon': 'The JMdict entries marked as common words, with kanji spellings, kana readings and English glosses.',
  'settings.offline.desc.kengdic': "Joe Speigle's Korean–English word list, with hanja where known.",
  'settings.offline.desc.ding': 'German–English dictionary from Ding by Frank Richter, TU Chemnitz.',
  /** The first line of a download confirmation; {name} is the pack, {host} the server it comes from. */
  'settings.offline.consent.ask': 'Download {name} from {host}?',
  'settings.offline.consent.askFree': 'Download free {name} from {host}?',
  /** {language} is the language of the glosses, such as English. */
  'settings.offline.consent.jmdictName': 'JMdict ({language})',
  'settings.offline.consent.jmdictCommonName': 'JMdict common words ({language})',
  'settings.offline.consent.gcideName': "GNU GCIDE (Webster's Revised Unabridged Dictionary, 1913)",
  'settings.offline.consent.kengdicName': "Kengdic (Joe Speigle's Korean–English dictionary)",
  /** {licence} is the licence's name. */
  'settings.offline.consent.licence': '{licence}.',
  'settings.offline.consent.wordnet': 'WordNet License (free use with attribution). This product includes WordNet® data developed by Princeton University. Import may take a minute.',
  'settings.offline.consent.gcide': 'GNU GPL v3 or later. File is large; import may take a few minutes.',
  /** {count} is a rounded number, such as 27,000. */
  'settings.offline.consent.headwords': { one: '{licence}. About {count} headword.', other: '{licence}. About {count} headwords.' },
  'settings.offline.consent.largeMinute': '{licence}. File is large; import may take a minute.',
  'settings.offline.consent.entriesMinutes': { one: '{licence}. About {count} entry; import may take a few minutes.', other: '{licence}. About {count} entries; import may take a few minutes.' },
  'settings.offline.consent.entries': { one: '{licence}. About {count} entry.', other: '{licence}. About {count} entries.' },
  'settings.offline.consent.words': { one: '{licence}. About {count} word.', other: '{licence}. About {count} words.' },

  // Number wheels
  /** A wheel's value with its unit when no plural message is given, as "15 seconds". */
  'settings.wheel.valueUnit': '{value} {unit}',

  // Account (the title-bar button and its panel)
  'settings.account.signIn': 'Sign in',
  'settings.account.signOut': 'Sign out',
  /** Accessible name of the account button when signed in. */
  'settings.account.buttonLabel': 'Account: {email}',
  'settings.account.finishInBrowser': 'Finish signing in in your browser.',
  'settings.account.syncing': 'Syncing…',
  'settings.account.syncedJustNow': 'Synced just now',
  /** {time} is a relative time such as "5 minutes ago", or a date. */
  'settings.account.synced': 'Synced {time}',
  'settings.account.notSynced': 'Not synced yet',
  'settings.account.syncNow': 'Sync now',
  'settings.account.deleteWarningPhone': 'Deletes your Holarky account and its synced notebook in every Holarky app. The notebook on this phone stays. Type your email to confirm.',
  'settings.account.deleteWarningComputer': 'Deletes your Holarky account and its synced notebook in every Holarky app. The notebook on this computer stays. Type your email to confirm.',
  'settings.account.emailField': 'Account email',
  /** Button that deletes the account for good. */
  'settings.account.delete': 'Delete account',
  /** Button that starts deleting the account (a confirmation follows). */
  'settings.account.deleteStart': 'Delete account…',
  'settings.account.plusKeptUntil': 'Synced progress is kept until {date}.',
  'settings.account.plusLocalOnly': 'Learning progress stays on this device.',
  'settings.account.plusKeep': 'Keep it with Plus',
  'settings.account.plusSync': 'Sync it with Plus',
  // Account errors
  'settings.account.error.signIn': 'Sign-in did not finish.',
  'settings.account.error.emailMismatch': "That email doesn't match this account.",
  'settings.account.error.notDeleted': 'The account was not deleted.',
  'settings.account.error.signedOut': 'You were signed out. Sign in again to keep syncing.',
  'settings.account.error.syncFailed': 'Sync failed.',
  'settings.account.error.cancelled': 'Sign-in was cancelled.',
  'settings.account.error.server': 'The account server had a problem. phevere will try again later.',
  'settings.account.error.unreachable': "Couldn't reach the account server. phevere will try again later.",
  /** An error sentence followed by the server's error code, as "Sync failed. (invalid_grant)". */
  'settings.account.error.withCode': '{message} ({code})',
  /** An error sentence followed by the system's own message. */
  'settings.account.error.withDetail': '{message} {detail}',
};
