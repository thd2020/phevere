/** Notebook, word books, review and Learn views (packages/core/src notebook-*, wordbook-*, vocab-view, review-quiz, learn-*). */
export default {
  // Shared counts and names
  'notebook.words': { one: '{count} word', other: '{count} words' },
  /** The list of words the learner saved, as a name. */
  'notebook.myWords': 'My words',
  /** My words and every subscribed word book together. */
  'notebook.allBooks': 'All books',

  // A word's stage in review (Anki's card stages)
  /** Stage of a word never answered. */
  'notebook.maturity.new': 'New',
  /** Stage of a word in its first steps. */
  'notebook.maturity.learning': 'Learning',
  /** Stage of a word being learned again after a lapse. */
  'notebook.maturity.relearning': 'Relearning',
  /** Stage of a word held under three weeks. */
  'notebook.maturity.young': 'Young',
  /** Stage of a word held three weeks or more. */
  'notebook.maturity.mature': 'Mature',

  // Review: counts by stage, in chart readouts and spoken labels
  'notebook.review.count.new': { one: '{count} new', other: '{count} new' },
  'notebook.review.count.learning': { one: '{count} learning', other: '{count} learning' },
  'notebook.review.count.young': { one: '{count} young', other: '{count} young' },
  'notebook.review.count.mature': { one: '{count} mature', other: '{count} mature' },

  // Review: reviews due over the next two weeks (bar chart)
  'notebook.review.forecast.caption': 'Reviews due, next 14 days',
  'notebook.review.forecast.yLabel': 'Words due',
  'notebook.review.forecast.today': 'Today',
  'notebook.review.forecast.tomorrow': 'Tomorrow',
  /** "Today, Thu, Nov 6": a day's name, then its date. */
  'notebook.review.forecast.dayWithDate': '{day}, {date}',
  'notebook.review.forecast.barAria': { one: '{day}: {count} due', other: '{day}: {count} due' },
  'notebook.review.forecast.due': { one: '{count} due', other: '{count} due' },
  'notebook.review.forecast.dueOverdue': { one: '{count} due, {overdue} of them overdue', other: '{count} due, {overdue} of them overdue' },
  'notebook.review.forecast.nothingDue': 'nothing due',
  /** {total} and {today} are numbers in bold; {count} is the number of days. */
  'notebook.review.forecast.summary': { one: '{total} due in {count} day · {today} today', other: '{total} due in {count} days · {today} today' },
  /** The busiest day and how many are due on it. */
  'notebook.review.forecast.peak': 'most on {day} ({count})',
  'notebook.review.forecast.empty': { one: 'Nothing due in the next {count} day', other: 'Nothing due in the next {count} days' },

  // Review: words saved or started per day (heatmap)
  'notebook.review.heat.captionSaved': 'Words saved, last 12 weeks',
  'notebook.review.heat.captionStarted': 'Words started, last 12 weeks',
  'notebook.review.heat.saved': { one: '{count} saved', other: '{count} saved' },
  'notebook.review.heat.started': { one: '{count} started', other: '{count} started' },
  'notebook.review.heat.nothingSaved': 'nothing saved',
  'notebook.review.heat.nothingStarted': 'nothing started',
  /** {total} and {week} are numbers in bold; {count} is the number of weeks; {day} the busiest day and {best} its number. */
  'notebook.review.heat.summarySaved': {
    one: '{total} saved in {count} week · {week} in the last 7 days · most on {day} ({best})',
    other: '{total} saved in {count} weeks · {week} in the last 7 days · most on {day} ({best})',
  },
  'notebook.review.heat.summaryStarted': {
    one: '{total} started in {count} week · {week} in the last 7 days · most on {day} ({best})',
    other: '{total} started in {count} weeks · {week} in the last 7 days · most on {day} ({best})',
  },
  'notebook.review.heat.emptySaved': { one: 'Nothing saved in {count} week', other: 'Nothing saved in {count} weeks' },
  'notebook.review.heat.emptyStarted': { one: 'Nothing started in {count} week', other: 'Nothing started in {count} weeks' },

  // Review: word books in today's session
  'notebook.review.books.label': 'Word books today',
  /** {fresh} new words and {due} reviews today in one word book. */
  'notebook.review.books.today': '{fresh} new · {due} due',
  'notebook.review.books.barAria': '{known} known, {learning} learning of {total}',
  'notebook.review.books.known': '{known} / {total} known',
  /** The daily goal; the number is shown large and the rest of the text beside it. */
  'notebook.review.goal.perDay': { one: '{count} new word a day', other: '{count} new words a day' },

  // Review: the quiz
  'notebook.review.playWord': 'Play the word',
  'notebook.review.play': 'Play {word}',
  /** Spoken name of the blank in a fill-the-gap sentence. */
  'notebook.review.gap': 'gap',
  'notebook.review.ask.meaningChoice': 'Choose the meaning',
  'notebook.review.ask.wordChoice': 'Choose the word',
  'notebook.review.ask.listenChoice': 'Choose the word you hear',
  'notebook.review.ask.clozeChoice': 'Choose the word for the gap',
  'notebook.review.ask.spellTiles': 'Spell the word',
  'notebook.review.ask.recall': 'Type the word',
  'notebook.review.ask.listenType': 'Type the word you hear',
  'notebook.review.ask.cloze': 'Fill the gap',
  'notebook.review.ask.flash': 'Do you know this word?',
  'notebook.review.choices': 'Choices',
  'notebook.review.letters': { one: '{count} letter', other: '{count} letters' },
  /** Spoken label of the answer box; {letters} is "5 letters". */
  'notebook.review.answerAria': 'Answer, {letters}',
  /** Button that checks a typed answer. */
  'notebook.review.check': 'Check',
  'notebook.review.lettersShown': 'Letters shown',
  /** Spoken label of a placed letter tile that is tapped to remove it. */
  'notebook.review.takeBack': 'Take back {letter}',
  'notebook.review.spellingAria': 'Your spelling, {letters}',
  /** The row of shuffled letter tiles. */
  'notebook.review.lettersBank': 'Letters',
  'notebook.review.verdict.timeUp': 'Time is up',
  'notebook.review.verdict.typo': 'You have a typo',
  'notebook.review.verdict.correct': 'Correct',
  'notebook.review.verdict.keepPractising': 'Keep practising',
  'notebook.review.verdict.notQuite': 'Not quite',
  'notebook.review.countdown': { one: '{count} second to answer', other: '{count} seconds to answer' },
  /** A word the learner keeps missing (Anki's leech). */
  'notebook.review.troubleWord': 'Trouble word',
  'notebook.review.knewIt': 'I knew it',
  'notebook.review.didNotKnow': "I didn't know it",
  /** Marks a right answer as too easy, so the word comes back later. */
  'notebook.review.tooEasy': 'Too easy',
  'notebook.review.showMeaning': 'Show meaning',
  'notebook.review.openInLookup': 'Open in lookup',
  /** Button that reveals one more letter. */
  'notebook.review.hint': 'Hint',
  'notebook.review.dontKnow': "I don't know",
  'notebook.review.alreadyKnowIt': 'Already know it',
  'notebook.review.continue': 'Continue',
  /** Review grades, as in Anki. */
  'notebook.review.grade.again': 'Again',
  'notebook.review.grade.hard': 'Hard',
  'notebook.review.grade.good': 'Good',
  'notebook.review.grade.easy': 'Easy',
  /** When the word comes back; {gap} is "3 days" or "10 min". */
  'notebook.review.backIn': 'back in {gap}',
  'notebook.review.backToLearn': 'Back to Learn',
  'notebook.review.suggest': { one: '{count} new word a day fits your recent study time', other: '{count} new words a day fits your recent study time' },
  /** Button that sets the suggested daily goal. */
  'notebook.review.suggestUse': 'Use {count}',

  // Review: the start card
  'notebook.review.nothingDueToday': 'Nothing due today',
  /** {when} is "tomorrow" or a date. */
  'notebook.review.nextReview': 'Next review {when}',
  'notebook.review.more.new': { one: 'Learn {count} more word', other: 'Learn {count} more words' },
  'notebook.review.more.ahead': { one: 'Review {count} word early', other: 'Review {count} words early' },
  /** Words due again for review, beside Learning and New. */
  'notebook.review.start.review': 'Review',
  'notebook.review.start.roundOf': 'Round of {count}',
  'notebook.review.start.minutes': { one: 'About {count} min', other: 'About {count} min' },
  'notebook.review.start.moreToday': '{count} more today',
  'notebook.review.start.heldBack': {
    one: '{count} new word waits until the reviews are done',
    other: '{count} new words wait until the reviews are done',
  },
  'notebook.review.start.heldForTomorrow': { one: '{count} new word waits for tomorrow', other: '{count} new words wait for tomorrow' },
  'notebook.review.start.button': 'Start review',
  'notebook.review.empty': 'Save words to start reviewing.',

  // Review: the summary after a round
  'notebook.review.summary.roundDone': 'Round done',
  'notebook.review.summary.doneForToday': 'Done for today',
  'notebook.review.summary.answered': 'Answered',
  /** Share of answers that were right. */
  'notebook.review.summary.correct': 'Correct',
  'notebook.review.summary.minutes': 'Minutes',
  'notebook.review.summary.dueTomorrow': 'Due tomorrow',
  'notebook.review.summary.newStarted': 'New words started',
  'notebook.review.summary.alreadyKnown': 'Already known',
  /** A word set aside as known, then put back. */
  'notebook.review.summary.backInWords': 'Back in your words',
  /** Words that moved up a stage. */
  'notebook.review.summary.stronger': 'Stronger',
  /** Words that moved down a stage. */
  'notebook.review.summary.slippedBack': 'Slipped back',
  'notebook.review.summary.missed': 'Missed',
  'notebook.review.summary.nextRound': 'Next round · {count}',

  // Learn charts (learn-charts.ts): the heatmap and the memory strip
  /** Spoken label of one day on the heatmap. */
  'notebook.charts.heat.cellSaved': { one: '{date}: {count} saved', other: '{date}: {count} saved' },
  'notebook.charts.heat.cellStarted': { one: '{date}: {count} started', other: '{date}: {count} started' },
  'notebook.charts.heat.labelSaved': 'Words saved per day',
  'notebook.charts.heat.labelStarted': 'Words started per day',
  /** The heatmap legend's top value. */
  'notebook.charts.heat.perDay': '{count} a day',
  /** After the first chips of a list of words. */
  'notebook.charts.moreWords': { one: '+{count} more', other: '+{count} more' },
  /** The three moments the memory strip shows, without any review until then. */
  'notebook.charts.memory.today': 'Today',
  'notebook.charts.memory.inWeek': 'In a week',
  'notebook.charts.memory.inMonth': 'In a month',
  /** Caption over the predicted number of words remembered. */
  'notebook.charts.memory.remembered': 'Remembered',
  'notebook.charts.memory.rememberedWeek': 'Remembered in a week',
  'notebook.charts.memory.rememberedMonth': 'Remembered in a month',
  'notebook.charts.memory.ofWords': { one: 'of {count} word', other: 'of {count} words' },
  /** Words below the target recall; the number is set in bold. */
  'notebook.charts.memory.due': { one: '{count} due', other: '{count} due' },
  /** Words fewer than today; the number is set in bold. */
  'notebook.charts.memory.fewer': { one: '{count} fewer than today', other: '{count} fewer than today' },
  /** {word} is the word and {percent} its chance of recall. */
  'notebook.charts.memory.recallToday': '{word} {percent} recall today',
  'notebook.charts.memory.recallWeek': '{word} {percent} recall in a week',
  'notebook.charts.memory.recallMonth': '{word} {percent} recall in a month',
  'notebook.charts.memory.reviewed': 'Reviewed {day}',
  'notebook.charts.memory.dueOn': 'Due {day}',
  'notebook.charts.memory.dueSince': 'Due since {day}',
  /** The weakest words, listed first. */
  'notebook.charts.memory.fadingFirst': 'Fading first',
  'notebook.charts.memory.withoutReview': 'Without review',
  'notebook.charts.memory.chartLabel': 'Your words by chance of recall',
  /** The zone left of the target line on the memory strip. */
  'notebook.charts.memory.zoneDue': 'Due',
  /** The zone right of the target line: words still held. */
  'notebook.charts.memory.zoneHeld': 'Held',
  'notebook.charts.memory.axis': 'Chance of recall',

  // Learn: the Progress page (learn-progress.ts)
  /** Skills a question tests. */
  'notebook.learn.skill.meaning': 'Meaning',
  'notebook.learn.skill.spelling': 'Spelling',
  'notebook.learn.skill.listening': 'Listening',
  /** Questions of each skill on one day. */
  'notebook.learn.skillCount.meaning': { one: '{count} meaning', other: '{count} meaning' },
  'notebook.learn.skillCount.spelling': { one: '{count} spelling', other: '{count} spelling' },
  'notebook.learn.skillCount.listening': { one: '{count} listening', other: '{count} listening' },
  /** {percent} is in bold: the skill's share of the last week's questions. */
  'notebook.learn.mix.meaning': '{percent} meaning',
  'notebook.learn.mix.spelling': '{percent} spelling',
  'notebook.learn.mix.listening': '{percent} listening',
  'notebook.learn.mix.shareAria': '{skill} {percent}',
  'notebook.learn.mix.head': { one: 'Last 7 days · {count} question', other: 'Last 7 days · {count} questions' },
  'notebook.learn.today': 'Today',
  /** Spoken label of a gauge: its name, then its value. */
  'notebook.learn.gaugeAria': '{label}: {value}',
  /** A gauge's progress towards its target: "3 of 10". */
  'notebook.learn.valueOf': '{value} of {total}',
  'notebook.learn.gauge.newWords': 'New words',
  'notebook.learn.gauge.reviews': 'Reviews',
  /** Share of today's answers that were right. */
  'notebook.learn.gauge.right': 'Right',
  /** Days in a row with study. */
  'notebook.learn.streak': 'Day streak',
  'notebook.learn.bestStreak': 'Best {count}',
  'notebook.learn.dueIn7Days': 'Due in 7 days',
  /** Under the number of mature words. */
  'notebook.learn.ofStarted': 'of {count} started',
  'notebook.learn.answers.in30Days': 'Answers in 30 days',
  /** {percent} is in bold; {count} is the number of days with answers. */
  'notebook.learn.answers.rightOnDays': { one: '{percent} right · {count} day', other: '{percent} right · {count} days' },
  'notebook.learn.answers.rightWrong': '{right} right, {wrong} wrong',
  'notebook.learn.answers.dayAria': '{day}: {detail}',
  'notebook.learn.answers.dayHead': { one: '{count} answer, {percent} right', other: '{count} answers, {percent} right' },
  'notebook.learn.answers.minutes': { one: '{count} min', other: '{count} min' },
  'notebook.learn.answers.none': 'no answers',
  'notebook.learn.answers.yLabel': 'Answers',
  /** Chart legend: right answers. */
  'notebook.learn.answers.right': 'Right',
  /** Chart legend: wrong answers. */
  'notebook.learn.answers.wrong': 'Wrong',
  'notebook.learn.strength.aria': { one: '{stage}: {count} word', other: '{stage}: {count} words' },
  'notebook.learn.strength.yLabel': 'Words',
  'notebook.learn.mastered': '{value} of {total} mastered',
  'notebook.learn.known': '{value} of {total} known',
  'notebook.learn.lists.elsewhere': { one: '{count} started elsewhere', other: '{count} started elsewhere' },
  /** {list} is another word list's name. */
  'notebook.learn.lists.shared': { one: '{count} shared with {list}', other: '{count} shared with {list}' },
  /** Legend: words known. */
  'notebook.learn.key.known': 'Known',
  'notebook.learn.trouble.title': '{misses} of {answers} missed, last {day}',
  /** Legend under the trouble words: the small numbers are misses of answers. */
  'notebook.learn.trouble.key': 'Missed of answered',
  /** A word missed so often it is flagged (Anki's leech). */
  'notebook.learn.trouble.leech': 'Leech',
  'notebook.learn.none.rotation': 'No words in rotation yet',
  'notebook.learn.none.started': 'No words started yet',
  'notebook.learn.none.answers': 'No answers yet',
  'notebook.learn.none.trouble': 'No trouble words',
  'notebook.learn.none.families': 'No root families yet',
  'notebook.learn.section.memory': 'Memory',
  'notebook.learn.section.ahead': 'Reviews ahead',
  'notebook.learn.section.held': 'How long words are held',
  'notebook.learn.section.answers': 'Answers per day',
  'notebook.learn.section.skills': 'Skills',
  /** Section of the word lists (My words and the word books). */
  'notebook.learn.section.lists': 'Words',
  'notebook.learn.section.trouble': 'Trouble words',
  'notebook.learn.section.families': 'Root families',

  // Learn: the list switcher and the page switcher (learn-view.ts)
  'notebook.learn.scope.label': 'Study list',
  /** Tooltip of a word book in the switcher. */
  'notebook.learn.scope.bookTitle': '{book}: {known} of {total} known',
  /** The Learn page with today's review. */
  'notebook.learn.page.today': 'Today',
  /** The Learn page with charts of progress. */
  'notebook.learn.page.progress': 'Progress',

  // The Words views switcher (notebook-views.ts)
  'notebook.view.label': 'Notebook view',
  /** Words as a list. */
  'notebook.view.list': 'List',
  /** Words grouped by shared roots and affixes. */
  'notebook.view.families': 'Families',
  /** Words drawn as a graph. */
  'notebook.view.map': 'Map',
  /** Words as picture cards. */
  'notebook.view.cards': 'Cards',

  // Cards (notebook-cards.ts)
  'notebook.cards.empty': 'No saved words.',
  /** Pours every pile of cards out on the table. */
  'notebook.cards.expandAll': 'Expand all',
  /** Piles of cards by when the words were saved. */
  'notebook.cards.pile.new': 'New',
  'notebook.cards.pile.earlier': 'Earlier',
  'notebook.cards.pile.thisWeek': 'This week',
  'notebook.cards.pile.lastWeek': 'Last week',
  'notebook.cards.pileAria': { one: '{pile}, {count} card', other: '{pile}, {count} cards' },
  /** Spoken label of a card; {pile} is a pile's name such as "This week". */
  'notebook.cards.openLookup': '{word}: open lookup',
  'notebook.cards.openPile': '{word}: open the {pile} pile',
  'notebook.cards.gatherPile': '{word}: gather the {pile} pile',
  /** Turns a card to its front. */
  'notebook.cards.showWord': 'Show word',
  /** Turns a card to its back. */
  'notebook.cards.showMeaning': 'Show meaning',

  // Zoom controls (Families tree inspector, Map)
  'notebook.zoomIn': 'Zoom in',
  'notebook.zoomOut': 'Zoom out',
  /** Fits the whole drawing in view. */
  'notebook.zoomFit': 'Fit',

  // Families (notebook-families.ts)
  /** Ways to group words. */
  'notebook.families.group.root': 'Roots',
  /** Proto-Indo-European roots. */
  'notebook.families.group.deep': 'Deep roots',
  'notebook.families.group.prefix': 'Prefixes',
  'notebook.families.group.suffix': 'Suffixes',
  /** The languages words came from. */
  'notebook.families.group.origin': 'Origins',
  'notebook.families.group.tree': 'Word trees',
  /** Han characters shared by words. */
  'notebook.families.group.char': 'Characters',
  'notebook.families.groupBy': 'Group by',
  'notebook.families.tracing': 'Tracing origins {done} of {total}',
  /** {placed} is a number in bold; {count} the number of words. */
  'notebook.families.grouped': { one: '{placed} of {count} word grouped', other: '{placed} of {count} words grouped' },
  /** {languages} are the languages a word passed through, from the etymology. */
  'notebook.families.via': 'via {languages}',
  /** A language of origin and how many words came from it. */
  'notebook.families.originCount': '{origin} {count}',
  'notebook.families.treeAria': '{word} and the words built from it',
  'notebook.families.empty': 'No shared roots, affixes or characters yet.',
  /** Heading over the words a grouping could not place. */
  'notebook.families.rest.family': 'Not in a family yet',
  'notebook.families.rest.tree': 'Not part of a tree',
  'notebook.families.rest.origin': 'Origin not known yet',
  'notebook.families.openTree': 'Open the {word} tree',

  // Morpheme kinds (morpheme.ts), as labels beside a word part; lowercase in English
  'notebook.morpheme.kind.prefix': 'prefix',
  'notebook.morpheme.kind.suffix': 'suffix',
  'notebook.morpheme.kind.root': 'root',

  // Map (notebook-map.ts, notebook-map-3d.ts)
  'notebook.map.empty': 'No connected words yet.',
  /** Placeholder of the search box on the map. */
  'notebook.map.find': 'Find a word',
  'notebook.map.findLabel': 'Find a word on the map',
  /** Words shown on the map of all words: {shown} of {count}. */
  'notebook.map.wordsOf': { one: '{shown} of {count} word', other: '{shown} of {count} words' },
  'notebook.map.noMatch': 'No word matches “{query}”',
  /** The chips that choose which kinds of word parts the map shows. */
  'notebook.map.show': 'Show',
  'notebook.map.nothingToConnect': 'Nothing to connect with these filters.',
  'notebook.map.label': 'Map of related words',
  'notebook.map.reset': 'Reset view',
  'notebook.map.connected': 'Connected words',
  /** Label over the cluster of words that share no part with another word. */
  'notebook.map.unlinked': { one: 'Unlinked words · {count}', other: 'Unlinked words · {count}' },

  // My words list rows (vocab-view.ts)
  'notebook.list.copyWord': 'Copy {word}',
  'notebook.list.addToBook': 'Add to word book',
  'notebook.list.addWordToBook': 'Add {word} to a word book',
  'notebook.list.playPronunciation': 'Play pronunciation',
  /** Day headings over the words, newest first. */
  'notebook.list.group.earlier': 'Earlier',
  'notebook.list.group.today': 'Today',
  'notebook.list.group.yesterday': 'Yesterday',
  'notebook.list.group.thisWeek': 'This week',
  /** The word is due for review now. */
  'notebook.list.dueNow': 'Due now',
  /** A page number in a book or PDF the word was saved from. */
  'notebook.list.page': 'p. {page}',
  /** Labels of the facts under an opened word. */
  'notebook.list.fact.saved': 'Saved',
  'notebook.list.fact.source': 'Source',
  /** The device the word was saved on. */
  'notebook.list.fact.device': 'On',
  'notebook.list.fact.dictionary': 'Dictionary',
  'notebook.list.fact.review': 'Review',
  /** {when} is "In 3 days" or "Due now". */
  'notebook.list.reviewsSoFar': { one: '{when}, {count} review so far', other: '{when}, {count} reviews so far' },
  /** Review state of a word never reviewed. */
  'notebook.list.reviewNew': 'New',
  /** Shows the rest of a word's senses. */
  'notebook.list.showMore': 'Show more',
  'notebook.list.noDefinition': 'No definition saved.',
  'notebook.list.copyWithMeaning': 'Copy with meaning',
  'notebook.list.removeFromMyWords': 'Remove from My words',
  'notebook.list.removeWordFromMyWords': 'Remove {word} from My words',
  'notebook.list.saveToMyWords': 'Save to My words',
  'notebook.list.saveWordToMyWords': 'Save {word} to My words',

  /** The row of chips that filters words by their language. */
  'notebook.list.languageLabel': 'Language',
  /** The chip that shows words in every language. */
  'notebook.list.allLanguages': 'All',

  // Word books (wordbook-views.ts)
  'notebook.lookUpWord': 'Look up {word}',
  /** A word's state in a word book. */
  'notebook.books.status.new': 'New',
  'notebook.books.status.learning': 'Learning',
  'notebook.books.status.known': 'Known',
  'notebook.books.sort.label': 'Sort',
  /** Sort in the word book's own order. */
  'notebook.books.sort.book': 'Book order',
  /** Sort newest first. */
  'notebook.books.sort.recent': 'Recent',
  /** Sort alphabetically. */
  'notebook.books.sort.az': 'A–Z',
  'notebook.books.knownOf': '{known} of {total} known',
  /** The number is set in bold. */
  'notebook.books.counts.known': { one: '{count} known', other: '{count} known' },
  'notebook.books.counts.learning': { one: '{count} learning', other: '{count} learning' },
  'notebook.books.counts.new': { one: '{count} new', other: '{count} new' },
  'notebook.books.listsLabel': 'Word lists',
  /** Spoken label of the button that opens a list's menu. */
  'notebook.books.menuLabel': '{book} menu',
  /** Words grouped by the document, site or app they were saved from. */
  'notebook.books.sources': 'Sources',
  'notebook.books.addBook': 'Add a word book',
  /** Over a word book made from a document or site: {source} is its name. */
  'notebook.books.from': 'From {source}',
  /** Over a word book the learner made. */
  'notebook.books.myBook': 'My word book',
  'notebook.books.nameLabel': 'Book name',
  'notebook.books.addWord': 'Add a word',
  /** Button that adds the typed word to the book. */
  'notebook.books.addWordButton': 'Add',
  'notebook.books.noDefinition': 'No definition found.',
  'notebook.books.noMatches': 'No matching words.',
  'notebook.books.noWords': 'No words.',
  'notebook.books.inMyWords': 'In My words',
  'notebook.books.addToMyWords': 'Add to My words',
  'notebook.books.addWordToMyWords': 'Add {word} to My words',
  'notebook.books.markedKnown': 'Marked known',
  'notebook.books.markKnown': 'Mark known',
  'notebook.books.markWordKnown': 'Mark {word} known',
  'notebook.books.unmarkWordKnown': 'Unmark {word} known',
  'notebook.books.removeFromBook': 'Remove from this book',
  'notebook.books.removeWordFromBook': 'Remove {word} from this book',
  'notebook.books.showMore': { one: 'Show {count} more', other: 'Show {count} more' },
  'notebook.books.andMore': { one: 'and {count} more', other: 'and {count} more' },
  'notebook.books.openBook': 'Open word book',
  /** Adds a source's words that are not in its word book yet. */
  'notebook.books.addNew': { one: 'Add {count} new', other: 'Add {count} new' },
  'notebook.books.makeBook': 'Make a word book',
  'notebook.books.sourcesEmpty': 'Words saved from a PDF, a web page or an app are grouped here.',
  /** Where a published word list comes from, with its licence. */
  'notebook.books.source': 'Source',
  'notebook.books.openNamed': 'Open {book}',
  'notebook.books.removeNamed': 'Remove {book}',
  'notebook.books.addNamed': 'Add {book}',
  /** Button that adds a word book to your lists. */
  'notebook.books.add': 'Add',
  'notebook.books.import': 'Import…',
  'notebook.books.export': 'Export…',
  'notebook.books.exportAnki': 'Export for Anki…',
  'notebook.books.deleteBook': 'Delete book',
  'notebook.books.deletePrompt': 'Delete “{book}”?',
  'notebook.books.removePrompt': 'Remove “{book}”?',
  'notebook.books.progressKept': 'Your progress on its words is kept.',
  /** Name of a word book imported from an Anki deck that has no name. */
  'notebook.books.ankiDeck': 'Anki deck',
  /** File name of an exported word book that has no title. */
  'notebook.books.fileName': 'Words',

  // Word book files: errors shown when a book cannot be opened or exported (book-file.ts, book-transfer.ts)
  'notebook.books.error.gone': 'That book is gone.',
  'notebook.books.error.unknown': 'Unknown word book.',
  'notebook.books.error.noCrypto': 'This device cannot open protected books.',
  'notebook.books.error.notBook': 'Not a Phevere book file.',
  'notebook.books.error.newer': 'This book was made by a newer Phevere; update to open it.',
  'notebook.books.error.incomplete': 'This book file is incomplete.',
  'notebook.books.error.store': 'This book comes from the Phevere store; sign in with Plus to open it.',
  'notebook.books.error.changed': 'This book file was changed after it was issued.',
  'notebook.books.error.needsPlus': 'This book needs Plus. Sign in with the account that has it.',
  'notebook.books.error.damaged': 'This book file is damaged.',
};
