/** Lookup results shared by the desktop and the phone: the Lexicon sections, morphemes, scans (packages/core/src lexicon-parts, morpheme-view, ocr-view, dictionary). */
export default {
  // Lexicon: lookups that found nothing (dictionary.ts writes these as a sense's text)
  'lexicon.lookup.noDefinition': 'No definition available.',
  'lexicon.lookup.timedOut': 'Lookup timed out. Check your network or try again.',
  /** The first choice in a language picker: detect the language of the text. */
  'lexicon.languages.autoDetect': 'Auto-detect',

  // Lexicon: lists folded under a summary
  /** The summary that unfolds a long list of words; {count} is how many words the whole list has. */
  'lexicon.list.all': { one: 'All {count}', other: 'All {count}' },

  // Lexicon: Forms section
  /** After a part of speech heading when the table is another word's: "noun · forms of mouse". */
  'lexicon.forms.formsOf': 'forms of {lemma}',
  /** "mice is a form of mouse." when the kind of form is not known. */
  'lexicon.forms.isFormOf': '{word} is a form of {lemma}.',
  /** "mice is the plural of mouse."; {form} is one of the lexicon.formKind texts. */
  'lexicon.forms.isKindOf': '{word} is the {form} of {lemma}.',
  /** The line above the entry an irregular form opens: "past tense of run"; {forms} lists lexicon.formKind texts. */
  'lexicon.forms.formLine': '{forms} of {lemma}',
  /** Beside a form that is written less often than the other: "cacti, cactuses (less common)". */
  'lexicon.forms.lessCommon': 'less common',
  /** Row heading in a verb's forms: present tense forms (am, are). */
  'lexicon.forms.present': 'Present',
  'lexicon.forms.thirdPersonSingular': 'Third-person singular',
  'lexicon.forms.presentParticiple': 'Present participle',
  /** Row heading in a verb's forms: past tense forms. */
  'lexicon.forms.past': 'Past',
  'lexicon.forms.pastParticiple': 'Past participle',
  /** Row heading for a noun's plural forms, and the plural column of a table. */
  'lexicon.forms.plural': 'Plural',
  /** The plural of one of two nouns spelt alike; {sense} is a few words of its meaning: "Plural (isohedral polyhedron)". */
  'lexicon.forms.pluralFor': 'Plural ({sense})',
  'lexicon.forms.singular': 'Singular',
  'lexicon.forms.comparative': 'Comparative',
  'lexicon.forms.superlative': 'Superlative',
  /** Caption of a table of a noun's grammatical cases. */
  'lexicon.forms.cases': 'Cases',
  'lexicon.forms.preterite': 'Preterite',
  'lexicon.forms.imperfect': 'Imperfect',
  'lexicon.forms.nominative': 'Nominative',
  'lexicon.forms.genitive': 'Genitive',
  'lexicon.forms.dative': 'Dative',
  'lexicon.forms.accusative': 'Accusative',
  'lexicon.forms.instrumental': 'Instrumental',
  'lexicon.forms.prepositional': 'Prepositional',
  'lexicon.forms.locative': 'Locative',
  'lexicon.forms.ablative': 'Ablative',
  'lexicon.forms.vocative': 'Vocative',
  /** Row heading in a table of verb forms: first person. */
  'lexicon.forms.person1': '1st',
  /** Row heading in a table of verb forms: second person. */
  'lexicon.forms.person2': '2nd',
  /** Row heading in a table of verb forms: third person. */
  'lexicon.forms.person3': '3rd',

  // Lexicon: what kind of form a word is, inside "… is the {form} of …" and "{forms} of …"
  'lexicon.formKind.pastTense': 'past tense',
  'lexicon.formKind.past': 'past',
  'lexicon.formKind.pastParticiple': 'past participle',
  'lexicon.formKind.presentParticiple': 'present participle',
  'lexicon.formKind.presentTense': 'present tense',
  'lexicon.formKind.thirdPersonSingular': 'third person singular',
  'lexicon.formKind.thirdPersonSingularPresent': 'third person singular present',
  'lexicon.formKind.plural': 'plural',
  'lexicon.formKind.comparative': 'comparative',
  'lexicon.formKind.superlative': 'superlative',
  'lexicon.formKind.alternativeForm': 'alternative form',
  'lexicon.formKind.alternativeSpelling': 'alternative spelling',
  'lexicon.formKind.misspelling': 'misspelling',

  // Lexicon: Word family and Phrases sections
  'lexicon.family.derived': 'Derived words',
  'lexicon.family.related': 'Related words',
  'lexicon.family.alternatives': 'Other spellings',
  'lexicon.family.phrases': 'Phrases',
  'lexicon.family.seeAlso': 'See also',
  /** Before the prefixes, suffixes and roots a word is made of. */
  'lexicon.family.builtFrom': 'Built from',
  'lexicon.family.phrasalVerbs': 'Phrasal verbs',
  'lexicon.family.idioms': 'Idioms',
  /** Set phrases that are neither phrasal verbs nor idioms, shown after those two groups. */
  'lexicon.family.otherPhrases': 'Other phrases',

  // Lexicon: lines under a sense
  /** Label before one word that means the same. */
  'lexicon.senseNotes.synonym': 'Synonym',
  /** Label before several words that mean the same. */
  'lexicon.senseNotes.synonyms': 'Synonyms',
  /** Label before one word of opposite meaning. */
  'lexicon.senseNotes.opposite': 'Opposite',
  /** Label before several words of opposite meaning. */
  'lexicon.senseNotes.opposites': 'Opposites',
  /** Label before word combinations that often occur together. */
  'lexicon.senseNotes.collocations': 'Collocations',

  // Lexicon: around the entry
  /** Accessible name of the row of languages the word exists in. */
  'lexicon.languageSwitch.label': 'Languages',
  /** Under the senses; {sources} lists dictionary names: "Definitions from Wiktionary and Datamuse". */
  'lexicon.sources.definitionsFrom': 'Definitions from {sources}',
  'lexicon.section.glossIn': 'In {language}',
  /** Under a lookup that found nothing; {words} lists up to three spellings to try. */
  'lexicon.didYouMean': 'Did you mean {words}?',

  // Lexicon: a prefix, suffix or root's page
  /** Row heading: what kind of part it is (prefix, suffix, root). */
  'lexicon.morpheme.type': 'Type',
  'lexicon.morpheme.meaning': 'Meaning',
  /** Row heading: other ways the part is spelt. */
  'lexicon.morpheme.spellings': 'Spellings',
  /** Row heading: the Proto-Indo-European root. */
  'lexicon.morpheme.pieRoot': 'PIE root',
  'lexicon.morpheme.usage': 'Usage',
  /** Row heading: words reconstructed from the root. */
  'lexicon.morpheme.formations': 'Formations',
  'lexicon.morpheme.pieRootKind': 'Proto-Indo-European root',
  /** The kind of part with the language it comes from: "Latin root", "Greek prefix". */
  'lexicon.morpheme.kindFrom': '{origin} {kind}',
  /** Section name, lower case as the other section names: what the part is. */
  'lexicon.morpheme.section.about': 'about',
  /** Section name: the learner's saved words built on the part. */
  'lexicon.morpheme.section.myWords': 'my words',
  /** Section name: words from the learner's word books built on the part. */
  'lexicon.morpheme.section.wordBooks': 'word books',
  'lexicon.morpheme.section.derived': 'derived words',
  /** Section name: words in later languages that come from the root. */
  'lexicon.morpheme.section.descendants': 'descendants',
  /** Section name: related prefixes, suffixes and roots. */
  'lexicon.morpheme.section.related': 'related',

  // Scan view: a picture with its recognised text
  /** Accessible name of the scan view's toolbar. */
  'lexicon.ocr.toolbar': 'Scanned text',
  'lexicon.ocr.noText': 'No text found',
  /** Accessible name of the switch between the picture and the plain text. */
  'lexicon.ocr.view': 'View',
  /** A view switch option: the picture with its text in place. */
  'lexicon.ocr.picture': 'Picture',
  /** A view switch option: the recognised text alone. */
  'lexicon.ocr.text': 'Text',
  /** Accessible name of the picker for the language to translate the picture into. */
  'lexicon.ocr.translateTo': 'Translate to',
  /** Button: translate the paragraphs that failed again. */
  'lexicon.ocr.retry': 'Retry',
  'lexicon.ocr.copyAll': 'Copy all',
  'lexicon.ocr.copyImage': 'Copy image',
  'lexicon.ocr.saveImage': 'Save image',
  /** Tooltip on a word the text recognition was not sure of. */
  'lexicon.ocr.unsure': 'Unsure',
  'lexicon.ocr.translating': 'Translating',
  /** Progress while paragraphs are translated: "Translating 3 of 10". */
  'lexicon.ocr.translatingProgress': 'Translating {done} of {total}',
  /** How many paragraphs could not be translated. */
  'lexicon.ocr.notTranslated': { one: '{count} not translated', other: '{count} not translated' },
  /** The picture's text is already in the target language: "Already in French". */
  'lexicon.ocr.alreadyIn': 'Already in {language}',
  /** Said to a screen reader when the whole picture has been translated. */
  'lexicon.ocr.translated': 'Translated',
};
