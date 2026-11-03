# Notebook review: what works and what Phevere does

2026-11-03: review moved out of the Words switcher into its own tab, Learn, on desktop and phone. The quiz and the plan described here are its Today page.

2026-11-03. This memo is the reason review is a quiz rather than a flashcard with four self-rating buttons. It looks at how the main vocabulary apps run review, what memory research says about it, and then the design built in `packages/core/src/review-quiz.ts` (questions and grading), `review-schedule.ts` (FSRS scheduling) and `notebook-review.ts` (the view).

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

## What Phevere does now

Each due word becomes one question, and the kind of question follows how firmly the word is held. Strength comes from FSRS stability.

| Memory | Question |
|---|---|
| New word | Pick the meaning of the word from four |
| Learning, relearning after a miss, or stability under 4 days | Pick the word for a meaning, or pick the word you hear |
| Stability 4 to 21 days | Type the word from its meaning with the first letter shown, or type the word you hear |
| Stability over 21 days | Fill the gap in a sentence from your own note, when the note has one; otherwise type the word |

That ladder follows Laufer and Goldstein from the easiest kind of knowledge to the hardest, and it ends in the typed recall that WaniKani and Lingvist use. Wrong options come from other saved words in the same language and, where possible, the same part of speech; for word options, words of similar length and first letter come first. The word is blanked out of any meaning that contains it. A word with no saved meaning and too few other words falls back to a plain card where you say whether you knew it.

![Screenshot of the feedback after a wrong choice: the right meaning in teal, the chosen one in red with the word it belongs to, then Continue, Open in lookup and I knew it](REVIEW.assets/wrong-answer.png)

*After a miss, the chosen option names the word it belongs to, and "I knew it" overturns the grade.*

The answer is graded automatically and mapped to FSRS's four grades, so the learner never rates their own memory:

- A wrong answer is Again, and a typed answer one letter off in a word of five letters or more (two letters in ten or more) is Hard.
- A right choice is Good, or Hard after ten seconds. Recognition never earns Easy.
- A right typed answer is Easy within 2.5 seconds plus a quarter second per letter, Hard after 15 seconds plus that allowance, and Good in between.

One tap overturns the grade: "I knew it" after a miss (a slip of the finger or a typo) makes it Good, and "I didn't know it" after a lucky guess makes it Again. The answer shows at once with the picture, the pronunciation, the saved senses and the note, plus an "Open in lookup" button for the full entry, and the line under the buttons says when the word comes back. Words due again within 20 minutes, which is Anki's learn-ahead limit, come back in the same session, up to three times. The session ends with how many answers were given, the share right, the average time and the words missed, each of which opens in lookup. On the desktop, 1 to 4 pick an option and Enter starts or continues.

Scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2 (MIT) with 90% desired retention, Anki's default learning steps of 1 and 10 minutes, and interval fuzz. Version 6.0.0 came out on 2026-10-28 and requires Node 24, while the desktop app runs on Electron 28, so the 5.x line is the one that fits. The notebook keeps stability, difficulty, state, lapses, the last review time and the learning step in new columns, added with `ALTER TABLE ADD COLUMN` so no row is rewritten. A word reviewed only under the old scheduler gets its first FSRS state from its interval and ease with the same formula fsrs-rs uses when Anki switches a collection to FSRS: stability equals the old interval, and difficulty follows from the ease. The old interval, ease and due fields stay filled, so an older app syncing the same notebook still sees sensible due dates. When an older app edits only a note, the newer app keeps its memory state; when the older app reviews the word itself, the state is rebuilt from the old fields at the next review.

## What is left open

Automatic grading by time is a judgement call. If the thresholds feel wrong in use, they live in `autoGrade` in `review-quiz.ts`. FSRS can fit its parameters to a learner's own history once there are a few hundred reviews; Phevere does not keep a review log yet, so it runs on the default parameters.
