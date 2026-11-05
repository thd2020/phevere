# Learning in Phevere: what works and what Phevere does

2026-11-05: Progress is set as an editorial spread, "If you stop reviewing" became Memory, a strip with one dot per word that shows what a week or a month off would cost, and new words a day, the countdown on choice questions and speaking questions moved to Settings → Learn. See "The Progress page" and "Settings → Learn".

2026-11-04: the Learn tab was rebuilt after a user called it a toy. Questions now follow a ladder by memory strength with a skill balance (listening at most a fifth of a session), sessions run in rounds of twenty, leeches are recognised, new words are picked across all your books as one pool, and Today and Progress have charts with axes and readouts you can point at. The research behind these choices is under "Sessions, ladders and charts in the mature apps", and the design under "What Phevere does now".

2026-11-03: review moved out of the Words switcher into its own tab, Learn, on desktop and phone. The quiz and the plan described here are its Today page.

This memo is the reason review is a quiz rather than a flashcard with four self-rating buttons, and the reason for the way a session is put together. It looks at how the main vocabulary apps run review, what memory research says about it, and then the design built in `packages/core/src/review-quiz.ts` (the session, the questions and grading), `review-schedule.ts` (FSRS scheduling), `wordbooks.ts` (sessions across word books), `notebook-review.ts` (the Today page), `learn-progress.ts` (the Progress page) and `learn-charts.ts` (the charts).

The two question screenshots below show the Learn tab before the 2026-11-04 rebuild and are due to be retaken; the Progress and Settings screenshots are from 2026-11-05 and use made-up words.

![Screenshot of a meaning question: the word abandon with four meanings to choose from](REVIEW.assets/meaning-question.png)

*A new word starts with picking its meaning out of four, the wrong ones taken from other saved verbs.*

## How the main apps review words

**Anki** has offered FSRS as its scheduler since version 23.10 ([release notes](https://github.com/ankitects/anki/releases/tag/23.10)). FSRS keeps three numbers per card: retrievability, the chance you recall it right now; stability, the days until that chance falls to 90%; and difficulty, which sets how fast stability grows ([ABC of FSRS](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS)). The learner still grades each card with Again, Hard, Good or Easy, and the default desired retention is 90% ([deck options manual](https://docs.ankiweb.net/deck-options.html)). The manual has to remind people that Hard is a pass, which says something about how confusing four self-ratings are.

**Duolingo** grades automatically from whether the exercise was answered correctly. Its scheduler, half-life regression, estimates how long each word lasts in a learner's memory from their practice history. It cut prediction error by more than 45% against Leitner-style baselines and raised daily engagement by 12% ([Settles and Meeder 2016](https://aclanthology.org/P16-1174/)). The Practice Hub has Mistakes and Words sections built on it ([Duolingo blog](https://blog.duolingo.com/guide-to-duolingo-practice-hub/)).

**Memrise** grades automatically too. A right answer moves a word to a longer interval, from 4 hours up to 6 months, and a wrong one sends it back to 4 hours ([help](https://explore.memrise.com/help)). Learners can put typing tests first, and Speed Review gives about six seconds a word ([product news](https://memrise.com/blog/product-news-oct21)).

**Quizlet Learn** mixes typed answers, multiple choice and know-or-don't-know cards, and schedules the items least likely to be recalled using a power-law forgetting model ([Quizlet's 2018 paper](https://arxiv.org/abs/1803.00111)). Quizlet says Learn moves you from multiple choice to written questions; I could not open that page to confirm the wording.

**WaniKani** never asks for a self-rating. Answers are typed, items climb nine stages from Apprentice to Burned over intervals of 4 hours to 4 months, and a wrong answer drops them back ([SRS stages](https://knowledge.wanikani.com/wanikani/srs-stages/)). WaniKani refuses multiple choice because with it "you don't actually have to recall anything" ([FAQ](https://knowledge.wanikani.com/wanikani/multiple-choice/)).

**Lingvist** shows an example sentence with a gap and you type the missing word, with hints on request. It schedules the next review for when predicted recall drops to about 80% ([how it works](https://lingvist.com/blog/learn-with-lingvist-in-three-easy-steps/), [spaced repetition](https://lingvist.com/blog/spaced-repetition-in-learning/)).

**Vocabulary.com** runs rounds of ten questions drawn from ten question types, among them picture, synonym and real-world example questions. Difficulty adapts with item response theory, so learners get harder questions as they answer basic ones ([how it works](https://www.vocabulary.com/how-it-works/), [the science](https://www.vocabulary.com/membership/science-of-vocabulary/)).

Six of the seven grade the answer themselves. Only Anki asks the learner to rate their own memory, and Anki is a general flashcard tool, not a vocabulary app.

## What the research says

Testing beats rereading. In [Karpicke and Roediger 2008](https://pubmed.ncbi.nlm.nih.gov/18276894/), once students could recall a word, more study did nothing for recall a week later, while more testing had a large effect. In [Roediger and Karpicke 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x) rereading won at five minutes and lost at two days and a week, even though it made students more confident. The old Review screen showed the word and then the meaning, which is closer to rereading than to a test.

Spacing matters, and the best gap grows with how long you want to remember ([Cepeda et al. 2006](https://doi.org/10.1037/0033-2909.132.3.354), [Cepeda et al. 2008](https://doi.org/10.1111/j.1467-9280.2008.02209.x)). That is what an expanding schedule tied to a target retention does.

Harder practice that feels worse often teaches better ([Bjork and Bjork 2011](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/04/EBjork_RBjork_2011.pdf)). Producing an answer beats recognising it: across 86 studies the generation effect was d = 0.40 ([Bertsch et al. 2007](https://doi.org/10.3758/bf03193441)). For vocabulary, [Laufer and Goldstein 2004](https://doi.org/10.1111/j.0023-8333.2004.00260.x) found a fixed order of difficulty across 435 learners: recognising the meaning of a word is easiest, then recognising the word for a meaning, then recalling the meaning, then recalling the word itself.

Multiple choice still has a place if it is done well. Wrong options can stick as false memories, and more of them makes it worse ([Roediger and Marsh 2005](https://doi.org/10.1037/0278-7393.31.5.1155)), but plausible, competitive options make learners retrieve and even help them remember the wrong options' own material ([Little et al. 2012](https://doi.org/10.1177/0956797612443370)). Feedback after a choice question removes most of the false-memory cost ([Butler and Roediger 2008](https://doi.org/10.3758/mc.36.3.604)). Delayed feedback helped in some lab studies ([Butler, Karpicke and Roediger 2007](https://doi.org/10.1037/1076-898X.13.4.273)), but for adults the advantage disappeared once the time to the test was controlled ([Metcalfe, Kornell and Finn 2009](https://doi.org/10.3758/MC.37.8.1077)), so showing the answer right away is fine.

Response time carries information. A scheduler that used both accuracy and response time beat fixed schedules on immediate and delayed tests ([Mettler, Massey and Kellman 2016](https://doi.org/10.1037/xge0000170)). FSRS itself does not take answer time as input ([FSRS contributor on the Anki forum](https://forums.ankiweb.net/t/several-fsrs-related-suggestions/44673?page=4)), so time has to be folded into the grade before FSRS sees it. A picture next to the word gives a second route to recall ([dual coding](https://en.wikipedia.org/wiki/Dual-coding_theory)), and the notebook already has one for every word.

## Sessions, ladders and charts in the mature apps

2026-11-04. The first version of Learn answered the question "how should a word be tested". It did not answer how a session is built, what happens to a word that keeps failing, or what the charts are for. This section looks at those questions across Anki with FSRS, WaniKani, Duolingo, Memrise, Quizlet Learn, Lingvist, Vocabulary.com, Clozemaster, 墨墨背单词 (MaiMemo), 百词斩 (Baicizhan), 不背单词 (Bubei) and 扇贝单词 (Shanbay). Baicizhan, Bubei and Shanbay publish little about their design, so what is said of them comes from reviews and how-to pages.

### How a session is built

Every app puts due reviews first and caps new words. Anki defaults to 20 new cards and 200 reviews a day, and its review limit also holds back new cards; the manual advises against adding new cards while reviews are overdue ([deck options](https://docs.ankiweb.net/deck-options.html)). MaiMemo deliberately has no fixed number of new words: when more reviews are due it hands out fewer new ones, because a fixed quota lets the pile of reviews grow until people quit ([MaiMemo docs](https://memodocs.maimemo.com/docs/TXhHwrM8Ei5QKjk562mcq8uInef)); its reviews come first, most forgotten first ([docs](https://memodocs.maimemo.com/docs/PulqwOB1xi5jV0kb8Y1cPE7ZnKc)). Lingvist shows no new words until every word at risk has been reviewed ([help](https://lingvist.com/help/why-do-i-see-new-words/)). Sessions come in short, countable pieces: Bubei works in groups of ten words and asks whether to go on ([sspai](https://sspai.com/post/87587)), Clozemaster and Vocabulary.com work in rounds ([Clozemaster FAQ](https://www.clozemaster.com/faq), [Vocabulary.com](https://www.vocabulary.com/how-it-works/)), and Duolingo lessons have a progress bar and an end.

### The exercise ladder

Quizlet Learn starts with multiple choice and moves to written questions as answers come back right, because early multiple choice can be passed by elimination ([how Quizlet works](https://quizlet.com/features/how-quizlet-works)). Baicizhan teaches a new word in three steps, from a picture chosen for an example sentence to the Chinese meaning, and a miss sends the word back a step ([woshipm review](https://www.woshipm.com/evaluating/3923886.html)). Duolingo's Birdbrain model picks the exercise a learner should find just hard enough ([Duolingo blog](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain)). Clozemaster gives typed answers twice the points of multiple choice ([docs](https://docs.clozemaster.com/article/103-how-do-points-work)). None of them picks the kind of question at random.

### Leeches

Anki tags a card that has lapsed eight times as a leech and suspends it ([manual](https://docs.ankiweb.net/leeches.html)). WaniKani has no built-in leech handling; its community scores leeches by wrong answers over the current streak ([forum](https://community.wanikani.com/t/userscript-wanikani-dashboard-leech-tables-notice-your-leeches/33124)), and its Extra Study mode drills the last day's mistakes without counting them against the schedule ([help](https://knowledge.wanikani.com/widgets/extra-study/)). Vocabulary.com keeps a Trouble Words list and brushes those words up more often ([help](https://www.vocabulary.com/help/tracking-progress/monitoring-your-trouble-words)).

### Overrides

Five of the apps let you declare a word known: MaiMemo's 熟知, Baicizhan's 斩 (tapped again to undo), Shanbay's 太简单, Memrise's Known and Lingvist's mute ([MaiMemo](https://memodocs.maimemo.com/docs/Ok6YwF2X7iJZvvkCunjcmWwLnzb/), [Baicizhan](https://jingyan.baidu.com/article/09ea3edec060ad81afde3949.html), [Lingvist](https://lingvist.com/help/can-i-skip-certain-words/)). Quizlet offers "Override: I was correct" after a typed answer was marked wrong. Anki undoes the last answer with Ctrl+Z. Lingvist decides from the letters' positions whether a slip is a typo ([help](https://lingvist.com/help/how-do-you-count-mistakes)); WaniKani's matching is reported as too loose, accepting "north" for "south".

### Several books

MaiMemo keeps one pool of words and treats its books as ways of sorting it: a word learned in one book is learned in every book, with one history and one next review ([docs](https://memodocs.maimemo.com/docs/Y0iDwaZYeixhnzkuqJRcOEt6ncc/)). Shanbay instead filters a newly added book against your history once ([baidu](https://jingyan.baidu.com/article/ea24bc39774c019a62b331fe.html)).

### Charts

Anki's statistics answer questions a learner acts on: the future due forecast says whether to add new cards today, true retention says whether the scheduler meets its target, and the FSRS simulator forecasts the daily load for given limits ([stats manual](https://docs.ankiweb.net/stats.html)). MaiMemo shows a forgetting curve, the review load ahead and a distribution of how durable each word's memory is ([App Store](https://apps.apple.com/us/app/id888483369)); Shanbay shows how each book's words spread across familiarity levels. One review notes that Baicizhan and Bubei chart nothing ([woshipm](https://www.woshipm.com/evaluating/4425622.html)).

### What Phevere took, and what it left

Phevere took these, each for a reason it can name:

| Practice | Taken from | Why |
|---|---|---|
| New words fall as the review load grows | MaiMemo, Anki's review limit | The user's own complaint about long sessions is the failure MaiMemo describes |
| Rounds of twenty words with a clear end | Bubei, Clozemaster, Duolingo | A backlog of 4,801 words should never be one endless session |
| A ladder by memory strength, moving up within a session | Quizlet Learn, Baicizhan | Picking the kind at random gave the user 21 listening questions out of 44 |
| A skill balance with listening capped | None directly; Duolingo's "right difficulty" idea | Listening is the weakest signal of knowing a word and was half of a session |
| Leeches held at the learning stage and listed | Anki, Vocabulary.com | Drilling the same failing format again is what does not work |
| "Too easy" and "Already know it" | Shanbay, Baicizhan, MaiMemo | One tap for a word that wastes your time |
| One card per word across books, new words from one pool | MaiMemo | Phevere already kept progress per word; the books were still drawn separately |
| Charts that answer a question, with readouts | Anki, MaiMemo, Shanbay | The old charts had no axes and said nothing on a tap |

It left out an undo after Continue. Nothing is saved until Continue, and before that "I knew it", "I didn't know it" and "Too easy" already overturn the grade, which covers the slip Anki's undo is for; undoing a saved answer would mean deleting from an append-only history that other devices replay. It left out suspending a leech, because a word you saved is a word you want, and it left out a separate mistakes drill, because a leech already comes back in the easier format. Fitting FSRS parameters to your own history waits until there are a few hundred answers.

## What Phevere does now

### A day's plan and its rounds

Today's plan is every word due by the end of today, most overdue first, with today's new words spread among them. My words gives its own new words, oldest saved first, up to its daily goal. A word book gives words from the pool described under "Word books as one pool". While due reviews are at most five times the daily goal, the whole goal is given; beyond that each five more reviews hold back one new word, and at ten times the goal no new word comes until the reviews are done. The start card says how many wait.

A session takes the first twenty words of the plan as a round. The start card shows the round as learning, review and new words with an estimate of the time, and how many more words today has. A round ends with how many answers were given, the share right, the time, the words due tomorrow, the new words started, the words that moved up or slipped back a stage, and the words missed, each of which opens in lookup. Next round plans again from what is due now.

A question always asks, answers and records the word it was built for; it never shows another headword in its place. Two headwords count as one word only by a strict rule (`regularForms` in `review-quiz.ts`): the regular -s, -es, -ed and -ing endings, with a final e dropped, y turned to i, and a consonant doubled only before -ed and -ing in a one-syllable word, plus British and American spellings such as "colour" and "color". -er, -est and -ly are left out, because they make other words: "leader" is not "lead", "forest" is not "fore", and "rate" is not "rat". No choice question offers two forms of one word. Two saved entries are asked once in a session only when, beyond the spelling, one entry is listed as a form of the other ("simple past of glean") or their meanings are mostly the same; then the word itself, or the entry with a usable sense, is kept. Words of a word book are never folded together, since each book lists its own headwords. Confusable words such as "principal" and "principle", or "advice" and "advise", stay apart and make good wrong options.

### The ladder

Each question's kind follows the word's stage. The stage is the word's memory level, moved up a step each time the word comes back in the same session, so a new word is recognised, then recalled from four, then typed:

| Stage | When | Kinds, most fitting first |
|---|---|---|
| 0 | New word, first time today | Pick the meaning; pick the word |
| 1 | Learning or relearning, stability under 4 days, or a new word's second ask | Pick the word; pick the meaning; pick the word you hear; type the word |
| 2 | Stability 4 to 21 days, or a new word's third ask | Type the word from its meaning; fill the gap in a sentence; type the word you hear |
| 3 | Stability over 21 days | Fill the gap; type the word; type the word you hear |

That order follows Laufer and Goldstein from the easiest kind of knowledge to the hardest, and it ends in the typed recall that WaniKani and Lingvist use.

Within a stage the kind is chosen by cost (`chooseKind`): its place in the stage's order, plus a penalty when the session already leans on its skill more than the aim (meaning 45%, spelling 40%, listening 15%), plus a small penalty for repeating the last kind. Listening is never more than a fifth of a session, and never in the first four questions; it passes that cap only for a word that has nothing else to ask. In the user's session of 2026-11-04, 21 of 44 questions were listening; the same words now get at most eight.

A gap-fill question uses a sentence from your note, then the sentence the word was saved from, then the dictionary's example sentences, which the apps look up a few words ahead.

### Senses a question can use

A question shows the first usable sense of the word (`bestSense`). Citation lines that some sources return instead of a sense ("↑ "idiosyncracy", in Dictionary.com Unabridged…"), "plural of" and "past tense of" lines, and text that is only Wiktionary style rules are not usable; "Alternative form of mock-up. [A scale model…]" uses the bracketed gloss. An everyday sense comes before a dialect, obsolete or rare one, so "shed" asks "to part with, cast off" rather than its UK dialect sense. A word with no usable sense is skipped unless a sentence can be found for it; it is never pushed into listening instead. A word with no senses at all, such as a book word whose lookup failed, gets the plain card: the word, then its pronunciation, picture and Open in lookup. Before a round starts, the apps look up the meaning of every book word in it, so the plain card is the exception.

### Grading and overrides

The answer is graded automatically and mapped to FSRS's four grades, so the learner never rates their own memory:

- A wrong answer is Again, and a typed answer one letter off in a word of five letters or more (two letters in ten or more) is Hard.
- A right choice is Good, or Hard after ten seconds. Recognition never earns Easy.
- A right typed answer is Easy within 2.5 seconds plus a quarter second per letter, Hard after 15 seconds plus that allowance, and Good in between.

![Screenshot of the feedback after a wrong choice: the right meaning in teal, the chosen one in red with the word it belongs to, then Continue, Open in lookup and I knew it](REVIEW.assets/wrong-answer.png)

*After a miss, the chosen option names the word it belongs to, and "I knew it" overturns the grade.*

One tap overturns the grade before Continue saves it: "I knew it" after a miss makes it Good, "I didn't know it" after a lucky guess makes it Again, and "Too easy" after a right answer makes it Easy. A new word from any list can be set aside with "Already know it", which sits at the end of the instruction row, away from where Continue appears; the round's summary lists those words with Undo. Taps and keys in the first 0.4 seconds of a question are ignored, so a double tap on Continue cannot answer the next one. Back during an answer saves it first, as Continue would. The answer shows at once with the picture, the pronunciation, the saved senses and the note, and the line under the buttons says when the word comes back. Words due again within 20 minutes, Anki's learn-ahead limit, come back in the same session, up to three times. With a keyboard, on the desktop and on a phone or tablet that has one, 1 to 4 pick an option and Enter starts, continues or begins the next round; the key hints show only where a keyboard-like pointer exists.

### Leeches

A word with four lapses or more is a leech (`isLeech`). Anki's threshold is eight, but Anki's lapses come from the learner's own Again; here every miss counts, so the line is lower. A leech is asked at the learning stage whatever its stability, in the easier recognition formats, is tagged "Trouble word" on the question, comes back at most once more in a session, and is listed with its misses on the Progress page.

### The answer mark

The answer is marked on the question itself, over the instruction, the prompt and the options together: a brush tick for a right answer, a lighter tick for an almost, a cross for a wrong one, each a tapered ink shape revealed by a pen line along its middle, over a soft wash of teal or rust. The right option fills and settles and a wrong pick gives a small shake. The whole mark takes about three seconds and takes no taps, so Continue works while it plays. A repaint resumes it from the time of the answer, so a picture or a meaning loading in the background no longer cuts it short.

Windows reports reduced motion when "Show animations" is off, and both apps turned every animation off then, which is why the mark never showed for some users. The mark now draws in that case too, with the lift, the settle and the shake left out.

### Word books as one pool

Progress belongs to the word, not to a book (see `wordbook-store.ts`): a word saved to My words is scheduled on its `vocab` row, and a book word on its `book_words` row, both keyed by the lowercase headword. So a word known through My words counts as known in 考研 and every other book that lists it, and an answer in any list updates it everywhere.

New book words are picked across the scope's books as one pool (`pickNewBookWords`). Each book offers its words at its own level first: a word of 考研 or CET-4 that Starter, 中考 or 高考 already teach waits until the book's own words run out, because the learner most likely knows it. Book order alone started 考研 with state, might, part, against and system; it now starts with federal, republican, congress, democratic and executive. Within that, words that share a root or a stem with a word you saved or started ("nationality" after "nation") and words more of your books list move a little forward, and each book's daily goal still sets how many words the pool gives.

For words that slip through, the choice was between this level filter and a placement pass, the quick "know it or not" triage that 不背单词 and MaiMemo offer when a book is added (MaiMemo's 熟知 also marks words known one at a time). The level filter costs the learner nothing before the first question and is right for most of a graded book, while a placement pass costs minutes up front and asks the same question "Already know it" already asks in the round. So Phevere filters by level and keeps "Already know it", with Undo, as the triage. A new word's question is tagged with the books that share it. On Progress, each list says how many words it shares with the others and how many of its words were started through another list.

## The answer history

Every answer is also written to an append-only table, `answer_history` (`packages/core/src/answer-history.ts`), on the desktop and the phone. A row holds the headword in lower case, the `vocab` row id when the word is in My words, the word book being studied, the time, the question type, the skill it tested, whether it was right, the response time, the grade that was saved and the device. "Already know it" and its undo are rows too, with no grade. Rows are never changed or deleted.

The skill comes from the question type. Picking a meaning or a word, and the plain flash card, test meaning; typing the word from its meaning or into a sentence tests spelling; the two questions that play the word test listening. There is no speaking check, so the third skill is called Listening. A word's score in a skill moves halfway towards 1 after a right answer and halfway towards 0 after a wrong one, so two right answers in a row from scratch, or three after a miss, take it past 0.75, which counts as mastered.

The FSRS schedule can be rebuilt from the history. `replaySchedule` runs the graded answers in time order through the same `scheduleReview` call the live review uses, starting from a new card. ts-fsrs seeds its interval fuzz from the review time, the repetition count and the memory state, so the replay lands on exactly the state the live updates wrote; `scripts/test-review.js` checks this for a saved word, a book word and a word reviewed before the history existed. That last case is why a word's first graded row can carry a `prior`: the schedule as it stood just before, which replay starts from. `rebuildWordSchedule` writes the replayed state back to the word's `vocab` row, or to its `book_words` row when it is not in My words.

## The Progress page

Learn has a second page, Progress, built from the answer history and the words' FSRS state in `packages/core/src/learn-progress.ts`. It follows the list chosen in the Learn switcher, except the Words section, which always lists My words and every book. Every chart has a y axis with its unit, gridlines and labelled days, and a readout under it: pointing at a bar or a day, tapping it, or moving to it with the keyboard names it and lists its words, which open in lookup.

Since 2026-11-05 the page is set like a printed spread rather than a grid of equal cards. The streak is a giant numeral at the top, today is told in one sentence with its numbers in rust, and each section after it sits on an ink rule with a number and a label, led by one oversized number at a size of its own. On a wide window the sections pair up on twelve columns as seven and five; on a phone they stack.

![Screenshot of the Progress page on a phone with made-up words: a 29-day streak as a giant rust numeral, today in one sentence, two thin gauges, and the Memory section whose number 37 rises through its rule](REVIEW.assets/progress-phone.png)

*The top of Progress on a phone: the streak, today in a sentence, and Memory.*

![Screenshot of the Progress page in a wide window with made-up words: the masthead beside the sentence about today, Memory with its dot strip set to In a week, and the paired Reviews ahead and How long words are held sections](REVIEW.assets/progress-desktop.png)

*In a wide window the big number and its sentence sit beside the strip, and the next sections pair up seven to five.*

![Screenshot of the lower half of Progress in a wide window: three skill percentages as small multiples, the week's mix as a ribbon and a sentence, My words with its known count, trouble words set as one run of type, and root families in large italics](REVIEW.assets/progress-desktop-lower.png)

*Skills as small multiples, trouble words sized by how often they were missed, and root families sized by how many words they gather.*

The sections answer one question each:

| Section | The question it answers |
|---|---|
| Masthead | How long is my streak, and how far am I through today's new words and reviews? |
| Memory | How many of my words would I recall today, in a week or in a month without review, and which fade first? |
| Reviews ahead | How busy are the coming days, and with which words? Bars split learning words, words held under three weeks and words held longer. |
| How long words are held | How many started words are held for under a week, up to three weeks, up to three months and longer? |
| Answers per day | How much did I study each day, how much was right, and for how long? |
| Skills | How many words are mastered in meaning, spelling and listening, and what was last week's mix of question kinds? |
| Words | How far am I through each list, what does it share with the others, and how much of it did I learn elsewhere? |
| Trouble words | Which words do I keep missing? |
| Root families | How much of each root family do I know? |

New words today counts words whose first graded answer fell today, against the sum of the daily goals in the list. Reviews counts today's graded answers against those plus the reviews still due. The streak counts days in a row with at least one answer, ending today or, before today's first answer, yesterday. A word's skill score moves halfway towards 1 after a right answer and halfway towards 0 after a wrong one, and 0.75 counts as mastered.

### Memory

Memory replaced "If you stop reviewing", which drew the average recall over a slider from 0 to 60 days. An average of 67% after fourteen days tells a learner nothing they can act on. What a learner can act on is a count of words and a date. Anki's "estimated total knowledge" is the sum of every card's chance of recall ([stats manual](https://docs.ankiweb.net/stats.html)), and MaiMemo shows how durable each word's memory is rather than one curve ([App Store](https://apps.apple.com/us/app/id888483369)).

So Memory leads with the number of words you would recall, which is that sum, and a sentence that says how many are below 90% and due. Every word is a dot placed by its chance of recall, teal while it is held and rust once it is due. Today, In a week and In a month move the dots to where they would be without review, and the sentence then says how many fewer words you would recall and how many would be due, so the cost of a week off is a number. Pointing at or tapping a dot, or walking the dots with the arrow keys, names the word, its recall, when it was last reviewed and the date it falls below 90%. In FSRS that date is the last review plus the word's stability, since stability is defined as the days until recall falls to 90%. The words fading first are listed under the strip.

![Screenshot of Memory set to In a month with made-up words: 32 words recalled, five fewer than today, most dots rust and left of the 90% line, and the words fading first listed below](REVIEW.assets/progress-memory-month.png)

*In a month without review, most of the dots have crossed into the rust zone.*

### What the layout follows

Apple Fitness and Health lead each metric with one large number and a sentence about the learner's own trend. Spotify Wrapped sets numbers as shapes at many times the body size, and Strava's Year in Sport, designed by Manual, keeps its type, strips and circles simple enough to animate. Tufte's sparklines and the direct-labelling advice from Datawrapper and the EU data visualisation guide argue for putting numbers inside sentences and labels on the data instead of in legends. The Pudding's notes on responsive graphics ask for charts that work on a phone first and for fixed annotations where hover is missing ([Pudding](https://pudding.cool/process/responsive-scrollytelling/), [Datawrapper](https://www.datawrapper.de/blog/better-more-responsive-annotations-in-Datawrapper-data-visualizations/), [Tufte](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/)). The page keeps the app's three hues and its serif, Source Serif 4, at its display optical size for the numbers; the charts keep their readouts, so every bar and dot can still be pointed at, tapped and reached by keyboard.

The Today page has two charts of its own: reviews due over the next fourteen days, where tapping a day lists its words, and the words saved (in a book, started) per day over twelve weeks, with months along the top, weekdays down the side and each day's count and words on a tap. It shows the daily goal for new words as a fact, which opens Settings → Learn.

## Settings → Learn

Since 2026-11-05 the options for Learn live in Settings, on the desktop and the phone, and the Learn tab only shows what they settle. That is where every app we looked at keeps them: Anki's daily limits and timers are deck options ([manual](https://docs.ankiweb.net/deck-options.html)), Shanbay keeps 每日单词量 under 我的 and 学习设置, Duolingo keeps the daily goal and the speaking and listening switches in Settings, and WaniKani moved its daily lesson count to App Settings ([blog](https://blog.wanikani.com/posts/today-lessons-count-setting/)).

![Screenshot of Settings → Learn on a phone: new words a day for My words and for the Postgraduate book, the countdown on choice questions set to 8 seconds, and the speaking-questions switch](REVIEW.assets/settings-learn-phone.png)

*Settings → Learn: a goal per list, the countdown, and speaking questions once a microphone is there.*

New words a day has a row for My words and one for each word book you study, with 5, 10, 20 and 40 and an Other field for any number up to 999. Countdown on choice questions is Off or 5 to 30 seconds. Speaking questions appears only when the device lists a microphone Phevere may use; when microphone access is refused or there is none, the row is not there at all. Both options reach Learn as `learnPrefs` and `microphone` in `ReviewRenderOptions` (`packages/core/src/learn-prefs.ts`); the countdown and the speaking question itself belong to the question logic in `review-quiz.ts`. A round under way is not restarted when a goal changes.

## What is left open

Automatic grading by time is a judgement call. If the thresholds feel wrong in use, they live in `autoGrade` in `review-quiz.ts`. The skill aims and the listening cap live in `SKILL_TARGET` and `LISTEN_CAP`, the leech line in `LEECH_LAPSES`, and the round size in `ROUND_WORDS`. FSRS can fit its parameters to a learner's own history once there are a few hundred reviews; the answer history holds what that fitting needs, but Phevere still runs on the default parameters. The question screenshots in this memo show the Learn tab before the 2026-11-04 rebuild.
