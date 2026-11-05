# Word forms: when a lookup opens another word

2026-11-04. This memo states the rule Phevere uses when you look up an inflected form such as "was", "children" or "gleaned", checks it against what the major learner dictionaries do with the same searches, and records where Phevere differs. The rule lives in `packages/core/src/form-of.ts`; the offline tests that hold it are `scripts/test-word-forms.js` and `scripts/test-plural-forms.js`.

The short answer to "is it right that 'was' opens be and 'children' opens child?" is yes. Every learner dictionary I could check keeps the definitions of "was" under be and the definitions of "children" under child. The Oxford Advanced Learner's Dictionary gives "was" a one-line entry that only points to be, and its search for "children" opens the entry for child. Longman gives both a one-line entry ("the first and third person singular of the past tense of be", "the plural of child"). None of the dictionaries I reached defines either form on its own.

## What mature practice is

Lexicographers call this lemmatisation: every inflected form belongs to one headword, its lemma, and the definitions, pronunciation and word history sit there. Wiktionary describes a lemma as the main entry where the definitions, etymology and inflections are placed, and a non-lemma form such as "walked" as an entry that generally only links to it ([Wiktionary: Lemmas](https://en.wiktionary.org/wiki/Wiktionary:Lemmas), marked there as a draft).

A form a reader cannot trace to its headword gets a reference entry, which is a headword with nothing but a pointer. Christian Lehmann's notes on lemmatisation give "worse: see bad" as the example, say regular forms need no such entry, and note that an electronic dictionary can do the same job by searching the forms stored with each lemma ([Lehmann, Lemmatization](https://christianlehmann.eu/ling/ling_meth/ling_description/lexicography/lemmatization.php)). Longman lists a word's irregular forms in its own entry and leaves the regular ones to rules in its guide ([Pentheroudakis and Vanderwende, 1993](https://arxiv.org/abs/cmp-lg/9411014)). Swedish learner dictionaries do the same with cross-reference headwords such as gick, "went", pointing to gå ([eLex 2019](https://elex.link/elex2019/wp-content/uploads/2019/09/eLex_2019_38.pdf)). Wiktionary's inclusion rules ask that an entry for "geese" or "were" say what form it is and not merely redirect ([Criteria for inclusion, Inflections](https://en.wiktionary.org/wiki/Wiktionary:Criteria_for_inclusion)).

A form becomes a headword of its own when it carries a meaning the lemma does not give. Wiktionary's rule separates the predictable meaning of a form from an idiomatic one, with "blues" and "smitten" as its examples. In the learner dictionaries checked below this covers plurals that mean something else (glasses, arms, savings, people), participles used as adjectives (tired, interested, and learned, which is also pronounced differently), and comparatives with uses of their own (better, worse).

So the settled part is this: open the lemma, unless the form has a meaning of its own. What publishers do not agree on is which irregular forms deserve a one-line reference entry. Oxford gives one to "mice" and "men" but sends "children" and "women" straight to child and woman; Longman and Cambridge give one to "children" as well.

## The rule Phevere uses

Phevere reads Wiktionary's page for the word, as Wiktextract parses it on kaikki.org, where each sense is tagged. The steps are these.

1. A word opens as another word when every sense on its page is a form of that word: a plural, a past tense or participle, a third-person form, a comparative, or another spelling. Senses Wiktionary tags obsolete, archaic, dialectal, rare, dated, nonstandard, slang and the like are ignored, as a learner dictionary leaves them out.
2. A word stays itself when it has meanings of its own. One sense of its own in another part of speech is allowed ("mice" is also a rare verb in Bermuda); a sense of its own in the same part of speech, or two senses of their own, keep the word. A regular plural also stays when Datamuse's definitions give it a noun sense of its own ("savings" is "a fund of money put by"). Since 2026-11-05 there is no hand-written list of such plurals: irregular plurals with meanings of their own (data, media, news, arms) already have senses of their own on the tagged page, and the regular ones are decided by those definitions. When the definitions cannot be fetched, the lookup falls back to the senses it has instead of guessing.
3. When a word is a form of two words, the one used at least twenty times as often wins, by Datamuse's word frequencies. "children" is also the plural of the dialectal "childer", so child wins. When both are common, as with "axes" (axe or axis) and "leaves" (leaf or leave), the word stays itself and its page lists both.
4. An irregular form spelled unlike its lemma shows a line above the lemma's entry, such as "was /wəz/ · past tense of be" or "mice · plural of mouse", the way Oxford gives these forms a one-line entry. Regular forms, Latin and Greek plurals ("criteria") and irregular plurals that begin like their singular ("children", "paparazzi") open the lemma with no line. This is `hasOwnFormEntry` in `form-of.ts`. No single word is special-cased, so "oxen" gets the line "plural of ox" although Oxford opens ox without one.

Learn uses a separate, stricter rule for treating two saved words as one, so that a quiz never merges "leader" with "lead"; it is described in [`docs/REVIEW.md`](REVIEW.md) under "A day's plan and its rounds".

## The comparison

I searched each word on 2026-11-04. Oxford Learner's and Longman were searched live (`oxfordlearnersdictionaries.com/search/english/?q=`, `ldoceonline.com/search/english/direct/?q=`), and the table records the page each search landed on. Cambridge, Merriam-Webster and Collins refuse automated requests with a bot check, so their columns come from the Internet Archive's 2026 copies of the same pages where it served one; "not checked" means neither the site nor the archive answered. Merriam-Webster's "was" is the one exception: the archive refused it, and the cell repeats the entry's own wording as it appears in search results for [its page](https://www.merriam-webster.com/dictionary/was). Macmillan is left out because its online dictionary closed on 30 June 2023 ([Wikipedia](https://en.wikipedia.org/wiki/Macmillan_English_Dictionary_for_Advanced_Learners)), and Collins COBUILD is left out because I could not reach a single page of it.

The Phevere column comes from running `resolveFormOf` and `formLine` on each word. Words with a saved Wiktionary page in `scripts/fixtures/inflections` were run offline with the test suite's fake network; the rest (better, worse, learned, tired, interested, media, people, dice, leaves, criteria, women) were run against kaikki.org and Datamuse on the same day, because no fixture exists for them.

"Short entry" means the dictionary has a page under the form's own spelling whose only content is the pointer quoted.

| Word | Oxford Learner's | Longman | Cambridge | Merriam-Webster | Phevere |
|---|---|---|---|---|---|
| was | Short entry pointing to be | Short entry: first and third person singular of the past tense of be | Not checked | Short entry: past tense first- and third-person singular of be | Opens be with "past tense of be" |
| went | Short entry: past tense of go | Short entry: the past tense of go | Short entry: past simple of go | Not checked | Opens go with "past tense of go" |
| children | Opens child | Short entry: the plural of child | Short entry: plural of child | Not checked | Opens child, no line |
| women | Opens woman | Short entry: the plural of woman | Not checked | Not checked | Opens woman with "plural of woman" |
| mice | Short entry: plural of mouse | Short entry: the plural of mouse | Not checked | Short entry: plural of mouse | Opens mouse with "plural of mouse" |
| teeth | Short entry: plural of tooth | Short entry: the plural of tooth | Not checked | Not checked | Opens tooth with "plural of tooth" |
| leaves | Short entry: plural of leaf | Short entry: the plural of leaf | Short entry: plural of leaf | Short entry: plural of leaf | Stays "leaves", listing plural of leaf and the -s form of leave |
| criteria | Opens criterion | Opens criterion | Not checked | Not checked | Opens criterion, no line |
| gleaned | Opens glean | Opens glean | Not checked | Not checked | Opens glean, no line |
| better | Own entry | Own entry | Own entry, "comparative of good" as its first sense | Not checked | Stays "better" |
| worse | Own entry | Own entry | Not checked | Not checked | Stays "worse" |
| glasses | Opens eyeglass, whose sense 2 is "eyeglasses (also glasses)" | Own entry | Not checked | Not checked | Stays "glasses" |
| arms | Own entry | Own entry | Not checked | Not checked | Stays "arms" |
| savings | Opens saving, where savings is a plural sense | Own entry | Not checked | Not checked | Stays "savings" |
| learned | Own entry, adjective | Own entry, adjective | Not checked | Not checked | Stays "learned" |
| tired | Own entry, adjective | Own entry, adjective | Own entry | Not checked | Stays "tired" |
| interested | Own entry, adjective | Own entry, adjective | Not checked | Not checked | Stays "interested" |
| data | Own entry | Own entry | Not checked | Not checked | Stays "data" |
| media | Own entry | Own entry, with "the plural of medium" as sense 1 | Not checked | Not checked | Stays "media" |
| people | Own entry | Own entry | Not checked | Not checked | Stays "people" |
| dice | Own entry | Own entry | Own entry | Own entry | Stays "dice" |
| fish | Own entry | Own entry | Not checked | Not checked | Stays "fish" |

Longman's search for "glasses", "arms" and "savings" lands on glass, arm and forced saving, but each has its own page at `ldoceonline.com/dictionary/glasses` and so on, and the glass entry points to it; the table gives the page that exists.

## How well Phevere agrees

On which word's definitions you land on, Phevere agrees with Oxford on 19 of these 22 words and with Longman on 21. The disagreements are these three.

"leaves" disagrees with all four dictionaries that were checked: each has a short entry naming only leaf. Phevere keeps "leaves" because it is just as much the -s form of leave, and opening leaf would be wrong for "she leaves at noon". The dictionaries can ignore leave because their reference entries are only for irregular forms, and "leaves" from leave is regular. Phevere's page for "leaves" shows both pointers, which is the same short entry with one more line, so I left it.

"glasses" and "savings" disagree with Oxford only on the name of the headword. Oxford files glasses under eyeglass and savings under saving; Longman gives both their own headword, as Phevere does. In every case the reader sees the spectacles and the money first, not "plural of glass" or "plural of saving".

On the line above the entry, the eight forms in the table that Phevere opens as another word (was, went, children, women, mice, teeth, criteria, gleaned) match Oxford's choice between a short entry and a plain redirect in seven cases and Longman's in seven. Oxford and Phevere part on "women", Longman and Phevere on "children".

The test file keeps a longer list for the line: 48 forms with what Oxford does for each, in the block that calls `hasOwnFormEntry`. I searched all 48 again on 2026-11-04 and Oxford still behaves as recorded. The rule agrees on 46; "does" (a short entry in Oxford, because it is also the plural of doe) and "women" (no short entry) are the two it gets wrong. The 32 forms with a page of their own include better, worse, best and worst, which Oxford gives full entries, not one-line ones; Phevere never opens them as good or bad in the first place, because Wiktionary gives them senses of their own.

## Where Phevere could change

The redirect itself needs no change: it follows the practice every dictionary above shares.

The line above the entry is where the dictionaries split. Phevere follows Oxford, so "children" opens child without a line, while Longman and Cambridge give it a one-line entry, "plural of child". Wiktionary's inclusion rule, that a form's entry should say what form it is, points the same way as Longman. Longman still opens ox for "oxen" and paparazzi has a full entry there, so Longman is not simply "a line for every irregular plural" either. With Oxford on one side, Longman and Cambridge on the other, and neither side consistent across these words, the evidence is mixed and I have not changed the code. If you prefer Longman's choice, the change is to drop the carve-out in `hasOwnFormEntry` for irregular plurals that begin like their singular, which would give children a line (women has one already) and change the test's Oxford expectations for children, oxen and paparazzi.

## Known gaps

The frequency check in step 3 needs Datamuse. When that request fails, the two candidate lemmas cannot be compared and the word stays itself. In one of my live runs "teeth" (tooth, or a dated spelling of teethe) stayed "teeth" for this reason, and the next run opened tooth. For a lookup that lasts until the app restarts. For a saved word the background check in `vocab-sync.ts` records the word as checked, so it is not asked again.

Wiktextract sometimes drops a sense's tags. The "Dated spelling of teethe" sense on the "teeth" page has no dated tag, so Phevere reads the lemma from the text and counts teethe as a second candidate; the frequency check then picks tooth. A missing tag on a sense that has a meaning of its own would keep a form from opening its lemma.

I could not check Cambridge, Merriam-Webster or Collins for most words, so their columns are thin; the claims about them rest only on the cells filled in.
