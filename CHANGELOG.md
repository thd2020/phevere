# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Learn stages (2026-11-05): every word is New, Learning, Relearning, Young or Mature, as in Anki, with Mature meaning its memory now lasts three weeks or more. The stage shows on each question, the plan beside the quiz counts your words per stage, the reviews forecast splits by stage, and a round's summary lists the words that moved up a stage or slipped back.
- Dictation (2026-11-05): from the Young stage on, listening questions ask you to type the word you hear. Picking the word you hear from four stays for words you are still learning.
- Letter hints (2026-11-05): typed questions show how many letters the word has, show more first letters for a word you hold less firmly, and have a Hint button that reveals one more letter, up to all but the last. A right answer after a Hint counts as Hard.
- Countdown on choice questions (2026-11-05): with a countdown set in Settings → Learn, a question answered by picking one of four shows a bar that empties over those seconds, and when it runs out the question counts as not known and says "Time is up". The countdown pauses while you are on another tab or in another app, and on a listening question it starts once the word has played.
- New words a day (2026-11-05): after three days of study, the start card offers the number of new words a day that fits how much you usually study, with a button to use it.
- Add to word book (2026-11-05): next to the heart that saves a word to My words, a lookup has a button that adds the word to a book of your own, one you made from a source or imported. It lists those books with a tick on each one that already holds the word, and a tick or untick applies at once. The same button sits on the rows of a word book, in an opened My words row, on Recent rows, and in the desktop lookup window's toolbar. It appears only once you have such a book; Phevere's own books are not offered.
- Save from Recent (2026-11-05): each row of Recent lookups has a heart, as a lookup does. Tap it to save the word to My words, or tap a filled heart to remove it.
- Site icons in Sources (2026-11-05): a web site in Sources shows the site's own icon. When the icon cannot load, for example offline, the tile shows the site's first letter instead.

### Changed

- Windows Setup (2026-11-05): Custom options no longer stack every group in a large box. The install folder sits in one field with Browse beside it, and Shortcuts, Startup and Downloads are plain lists of checkboxes under short headings, with each download's size on the right. The pronunciation voice is a choice of None, Standard (132 MB) or High quality (350 MB) instead of a dropdown. While the options are open, the space required shows at the bottom left and Hide options and Install at the bottom right. Every option and what Setup installs are the same as before.
- Settings menus (2026-11-05): Install updates in Settings → Updates is a three-part switch (Automatically, Ask first, Off) on the desktop and on Android. The From and To languages under Quick translation and the text recognition Model open a menu in Phevere's own style instead of the plain system list. The menus work from the keyboard: the arrow keys move, typing a letter jumps to it, Enter chooses and Escape closes.
- Settings → Shortcuts (2026-11-05): the Save button now sits at the bottom of the shortcuts card, so the Built-in list follows at the same distance as every other section.
- Settings → Capture (2026-11-05): clicking the "Drop or paste an image" area, or pressing Enter or Space on it, opens a file picker. The chosen image is scanned like a dropped one.
- Notifications (2026-11-05): the "No image on clipboard" and "Quick translation failed" switches are gone. Those messages answer a shortcut you just pressed that could not work, so they always show; with them off, the shortcut seemed to do nothing. Image copied, Hover lookup switched on or off, and Update ready or available can still be turned off.
- Learn settings (2026-11-05): new words a day moved from the Learn tab to a new Learn section in Settings, on the desktop and the phone. It sets the goal for My words and for each word book you study, from 5, 10, 20 or 40 or any number up to 999. The same section has a countdown for choice questions (Off, or 5 to 30 seconds). The Today page now shows the goal as a fact, such as "10 new words a day"; tapping it opens Settings → Learn. A round already under way is not restarted when you change a goal.
- Memory on Progress (2026-11-05): "If you stop reviewing", with its 0 to 60 day slider and average recall, is replaced by Memory. A large number says how many of the words you are learning you would recall today, counted as the sum of each word's chance of recall, and a sentence says how many are below 90% and due. Below it every word is a dot placed by its chance of recall, teal while held and rust once due. Today, In a week and In a month move the dots to where they would be without review, and the sentence then says how many fewer words you would recall and how many would be due. Pointing at or tapping a dot, or moving along them with the arrow keys, names the word, its recall, when you last reviewed it and the date it falls below 90%; the words fading first are listed under the strip.
- Progress layout (2026-11-05): the page is no longer a grid of equal cards. Your streak is a giant numeral at the top, today is one sentence with its numbers picked out ("Today you started 6 of 10 new words and answered 42 questions, 88% of them right"), and two thin gauges show new words and reviews against today's targets. Each section below sits on a numbered rule and leads with one large number at a size of its own: words you would recall, reviews in the next 7 days, words held for 3 weeks or more, answers in 30 days. Skills are three large percentages side by side, trouble words are set as one run of type that grows larger and darker the more often a word was missed, and root families are set in italics sized by how many words they gather. In a wide window the sections pair up unevenly; on a phone they stack. Every chart still names a bar or a day when you point at or tap it.
- Learn questions (2026-11-05): the kind of question is the one you should get right about 85% of the time, judged from how firmly you hold the word now and from how you have done on each kind before. A word you are about to forget is picked from four again, and a word you know well is typed, filled into a sentence or written from dictation. Typing, filling a gap and dictation open once easier questions have gone right, a word started today is never typed the same day, and if your typed answers often go wrong you get fewer of them, so not every word has to be spelled.
- Today's new words (2026-11-05): once Phevere knows how much you usually study, a day with many reviews gives fewer new words and a light day the whole goal.
- Export, Import and Remove (2026-11-05): the open list's chip in Words now has its own menu button (the "…" joined to the chip). For My words it holds Export… and Export for Anki…; for a word book it also holds Remove, or Delete book for a book you made or imported. Import… moved to the word book library (Add a word book). The "…" menu at the right of the Words header, with Refresh, is gone; the list reloads by itself when words change. On the phone the Import and Export buttons left the top bar for the same places.
- Removing a word book asks first (2026-11-05): Remove and Delete book now ask for confirmation, which says that your progress on the book's words is kept. Removing Postgraduate 考研 and adding it again brings back where you were.
- A–Z order (2026-11-05): "#" now comes after Z in the A–Z rail, and words that start with a digit, a symbol or another script come last in the list, as in phone contacts. An accented first letter such as É files under E.
- Index rails (2026-11-05): the A–Z rail and the date rail jump when you click or tap a letter or date, or while you press and drag along them. Moving the mouse over them no longer moves the list. The date rail no longer shows a "Week of …" label in the middle of the list while you drag.
- Word book sorts (2026-11-05): Phevere's own word books sort by Book order or A–Z; Recent is offered only in books you made or imported and in All books.
- Families (2026-11-05): every word named on a family tile opens its lookup when clicked, not only the words in the open drawer.
- Cards (2026-11-05): the Piles, Scatter and Grid switch is gone. Clicking a pile pours its cards out where the pile lies: they slide off one after another into the pile's place and the places after it, and the piles that follow move out of their way. Clicking the pile's label, now under its first card, gathers the cards back. Expand all, a see-through button in the table's top-right corner that stays on screen as you scroll, pours every pile out at once and stays pressed; pressing it again gathers them. On a phone, shaking it twice does the same. On an iPhone the app asks for motion access the first time you tap the cards. Phevere remembers for each list (My words, each book and All books) whether every pile was out, and opens that list's cards that way after you leave Words or restart. A table you had on Scatter opens with every pile out until you change it. Dragging cards around the table is gone with Scatter.

### Fixed

- Settings → Learn (2026-11-05): on a phone, the Countdown on choice questions label no longer breaks into fragments under its menu; the menu sits under the label. On the desktop it opens the same styled menu as the other Settings menus.
- Cards (2026-11-05): clicking a card's picture several times quickly only turns the card over and back, however fast you click. It used to open the lookup when a click landed while the card was half turned. A card now opens the lookup only from its text or from Look up on its back.
- Cards for word books (2026-11-05): every word of a word book now has a card. Cards used to show only the words you had started plus the next 40, so the Postgraduate 考研 book showed 70 to 80 cards of its 4,801 words. Words you have not started yet lie in a New pile after the dated piles, in the book's order. The cards are drawn as you scroll to them, so a book of thousands of words opens and scrolls as quickly as a short list.
- Sync (2026-11-05): a word or word book saved in the same millisecond that a sync started could stay on that device. It is now sent with the next sync.
- Hover lookup strip (2026-11-05): pressing the trigger shortcut after moving to another word now looks up the word under the pointer and opens the strip there. Before, it reopened the previous word where you had hovered it, which looked like a stuck strip and later like strips drifting far from the pointer. A word hovered soon after the last one now opens once the short pause between lookups ends, instead of needing another nudge of the mouse. A word read after the pointer already left is dropped, so the strip no longer appears where the pointer used to be. The same word elsewhere on the page opens its own strip, and a word whose strip you clicked away opens again once the pointer leaves it and comes back. A strip that moves to a new word stays open its full ten seconds. On Windows with monitors at different scaling, a strip moved from one monitor to the other lands at the word.
- Map on the desktop (2026-11-05): Words → Map now draws the same 3D map as the phone. Before, the desktop app always fell back to a flat drawing of small dots, because the 3D part failed to load in the desktop window. Drag turns and tilts the map, right-drag or Shift-drag moves it, the wheel or a trackpad pinch zooms, and +, − and Reset view work as before. Roots, Prefixes and Suffixes, Find a word, the Unlinked words group and the orange word you last looked up all appear on it.
- Map (2026-11-05): Reset view, and the map when it opens, now fill the width and height of the map with the graph and the unlinked words, so a wide desktop window no longer shows the graph as a small cluster in the middle. The Unlinked words caption stays above its group however the map is turned, and a word's name starts beside its ball instead of across it when you are close.
- Learn prompts (2026-11-05): a long meaning is no longer cut off with "…". The question uses a shorter meaning of the word when it has one and shows the long one whole when it does not.
- Pronunciation in Learn (2026-11-05): a listening question plays the recorded voice when the word has one and the synthetic voice only when it has none, never one after the other, also when you tap play while the word is still loading.



## [4.1.0] - 2026-11-05

### Added

- Android updates (2026-11-05): the Android app gets the desktop's Settings → Updates section, without Roll back. Automatically, the default, checks GitHub Releases 30 seconds after the app opens and every six hours while it is open, downloads a newer release's APK in the background on an unmetered network, checks it against GitHub's SHA-256, and then opens Android's install prompt for you to confirm. On mobile data it waits for Check now. Ask first sends a notification and downloads only after you tap Update now, and Off checks only on Check now. When Install unknown apps is off for Phevere, the app opens that page and shows the install prompt when you come back. An APK that fails the checksum or is signed with a different key is deleted and an error says why. Debug builds open the release page instead of installing. The update keeps the notebook. Notifications gains an "Update ready or available" switch. Release builds now publish a `.sha256` file beside the APK, which the updater uses when the GitHub API is rate-limited.
- Updates (2026-11-04): Phevere checks GitHub Releases 30 seconds after it starts and then every six hours. **Settings → Updates** shows the version and what was found, and sets how releases install: Automatically (the default) downloads in the background and installs silently when Phevere quits, keeping the install folder and shortcut choices; Ask first tells you and installs when you select Update now; Off checks only on Check now. The tray menu offers "Restart to update" once a release is downloaded. Every download must match the SHA-256 checksum GitHub publishes for it, or it is deleted. Roll back installs the newest earlier release after asking, and automatic updates then skip the version you left until a newer one is published. Before any update or rollback the notebook is copied to `backups` in the data folder, keeping the newest five copies. The Windows installer and the AppImage update themselves; macOS, deb and rpm builds open the release page instead. A notification switch in Settings → Notifications covers update messages.

- Search suggestions (2026-11-04): typing in the desktop search field or the phone's lookup field lists the commonest words that begin with what you typed, ranked by how often they are used in English rather than alphabetically. Plurals and past tenses of a listed word are left out, and a misspelling such as "recieve" or "accomodate" suggests the right spelling. The list works offline from the word books and widens online.
- Word trees (2026-11-04): clicking a tree in Families → Word trees, or its open button, shows that tree alone and large, so the words on a big tree can be read. The wheel or a pinch zooms around the pointer, dragging moves the tree, a double click zooms in, and the bar has zoom out, fit, zoom in and close. Escape closes it on the desktop and Back on the phone, and a word in it opens the lookup. It stays open when the page behind it repaints.

### Changed

- Sense pictures (2026-11-04): a picture now appears only where someone linked a meaning to a picture, and a sense with no such link shows none. Words with several meanings get one per meaning: "crane" the bird and the machine, "bat" the animal and the club, "spring" the season, the coil and the water source, "bank" the institution and the river edge, "mouse" the animal and the device. The pictures come, in this order, from Wikidata's word senses ("item for this sense" and that item's image), from Wiktionary definitions tied to a Wikidata item, from pictures Wiktionary editors tied to a sense, and, for a noun naming something you can see, from the Wikipedia article titled with the word or from an article on the word's disambiguation page titled with it, such as "Pitcher (container)", "Bed sheet" or "Seashell". Abstract words such as serendipity, insight or vicissitude show no picture, and the pictures that used to stand in for them (a shop named Serendipity, a film still, a water well for "well skilled") are gone; a picture an editor linked to an abstract sense, such as the allegory on "hope", stays. Up to three pictures appear per entry. The first sense of each part of speech gets its picture first, and a picture of a minor sense ("bell" the flower) waits until the main senses have theirs or every source has answered. Portraits of named people, and maps, flags or logos from articles, never show.
- Picture loading (2026-11-04): a lookup starts finding its pictures when you submit the word and shows the first one as soon as a source answers, in a box kept for it, so the text no longer jumps. Opening a picture offers Hide picture, which keeps it from showing again on that sense and on a card saved with it, with Undo in the toast that follows. In Words, the cards on screen get their pictures first, cards that scroll away before their turn are skipped, cards behind the top of a closed pile wait until it opens, and cards that load together share their requests. Tapping the small "i" on a card's picture shows its credit. On the phone, card pictures have their own part of the saved lookups, so a large notebook no longer pushes out saved dictionary results. Pictures saved by earlier versions are looked up again once. A word whose picture search hit a failed request is no longer saved without its pictures for a day: it is searched again on the next lookup, and a Wikidata query that timed out is asked again for that word alone.
- Word book lists (2026-11-04): tapping a word in a book's List opens it in place, as in My words, with its pronunciation, part of speech and first three senses; a word with no meaning yet has it looked up and kept. The search button beside it opens the full lookup.
- Learn sessions (2026-11-04): a day's review runs in rounds of up to twenty words. The start card shows the round as learning, review and new words with an estimated time and how many more words today has, and a round ends with what you answered, the words you started, the words that grew stronger or slipped back, the words you missed, and a Next round button (Enter on the desktop). When more than five times your daily goal is due, fewer new words come that day, and the start card says how many wait.
- Learn questions (2026-11-04): the kind of question follows how firmly you know the word instead of chance. A new word is recognised first, then picked from four, then typed when it comes back the same day; words held for days are typed, and words held for weeks are filled into a sentence, which can now come from the dictionary's example sentences when you saved no note. Listening questions are never more than a fifth of a session and never among its first four (one session of 44 questions had 21), and the session leans to whichever of meaning and spelling it has asked less.
- Learn and word books (2026-11-04): new words are picked across your books as one pool instead of book by book, at each book's own level first: 考研 and CET-4 no longer start with state, might and part, which 中考 and 高考 already teach, but with words such as federal, congress and executive. Words of a family you have started ("nationality" after "nation") move a little forward. A new word's question names the books that share it.
- Progress (2026-11-04): every chart has axes, labels and units, and pointing at or tapping a bar or a day names it and lists its words, which open in lookup. The forgetting curve became "If you stop reviewing": a slider from 0 to 60 days shows your average recall, how many words would still be at 90% or more, and the weakest words, and tapping one draws its own curve. New cards show the reviews ahead for 30 days, answers per day with accuracy and time, how long your words are held, last week's mix of question kinds, what each list shares with the others, and trouble words. On the Today page, tapping a day of the due forecast lists its words, and the saved-words calendar has months, weekdays and each day's words.
- Phone lookup (2026-11-04): the word, its pronunciations and the source tabs stay fixed and only the definitions scroll, so scrolling to the end of a long entry no longer pushes the word off the top. Pronunciations sit on one row that scrolls sideways, which leaves more room for the definitions.
- Word book lists (2026-11-04): a book's List can be ordered by the book's own order, Recent, or A to Z, and each word keeps its place number in the book. The book's header no longer carries the New a day chips (the daily goal lives in Learn), and Remove book is now a red close button on the book's chip in the switcher: it shows when you point at the chip on the desktop, and on the open book's chip on a phone.
- Families (2026-11-04): Roots, Prefixes, Suffixes and Deep roots are in A to Z order in one grid, with no letter headings. A family's tile is sized by how many words it holds and nothing else: on the desktop a family of two is a quarter of the row and one of sixteen or more three quarters, with a larger name and more of its words shown, and on a phone small families go two to a row while large ones take the whole row. Opening a family shows its words in a drawer under its row and leaves the tile where it was; the drawer is scrolled into view above the phone's bottom bar, and it stays open when the page repaints. When the word analysis knows a part's other spellings, the tile shows them after its name (fac · fic · fec · fect) and each word marks the spelling it uses.
- Cards (2026-11-04): on the desktop as on the phone, clicking a card's picture turns it over and clicking its text opens the lookup. On the back, a click anywhere turns it back to the picture, and a Look up button sits in the bottom-left corner.
- Cards (2026-11-04): clicking a pile, or its top card, opens only that pile. Its top card stays where it was and the rest of its cards are dealt in overlapping rows just below it, newest first, a screenful at a time with More for the next; the page scrolls just enough to show them. Gather, the pile, its top card or Piles puts the cards back. Scatter still spreads every pile at once. On a phone, swiping up or down over spread cards scrolls the page, and a long press or a sideways move picks a card up.

### Fixed

- Map (2026-11-04): the map holds every word of the notebook or book. Words that share no root, prefix or word with another sit together as small, lighter points beside the graph under "Unlinked words", below it on a phone held upright. Each is named when you point at it, tap it or find it, and Find a word and the Words search reach all of them. Postgraduate 考研 shows all 4,801 words, 2,803 of them linked; before, the 2,202 words with no shared part, such as happen, however and might, were missing and the count read "2,599 of 4,801 words".
- Roots and prefixes (2026-11-04): 76 more roots and three prefixes (ambi-, epi-, proto-) are recognised, following Wiktionary's etymology of each word, so protect (pro- + tect "cover"), despair and prosper (sper "hope"), society and associate (soci), policy, police and political (polit), and point, appoint and punctual (punct) now join their families. A root that ends in a silent e is found before the ending is taken for a suffix, so revise and advise are re- and ad- with vid "see", and en- counts before a whole word, as in enable, ensure and enlarge. Look-alikes stay out: scheme has no chem, polite no polit, whisper no sper, entire and energy no en-, and cruise and sunrise are not -ise verbs. In Postgraduate 考研, 1,872 words now sit in a root or prefix family (was 1,603).
- Saved forms with two possible words (2026-11-04): a saved word such as "teeth", which Wiktionary lists as a form of both tooth and teethe, stayed as itself for good when the word-frequency service did not answer during the background check of saved words. It is now checked again on a later launch, and becomes tooth once the frequencies arrive.
- Forms without frequencies (2026-11-04): when the word-frequency service does not answer, "paparazzo" no longer lists the nonstandard plural "paparazzos", and "cactus" no longer lists "cactusses". Wiktionary gives a word's second plural without a label whether dictionaries accept it (cactuses) or not (paparazzos), so until the frequencies arrive Forms shows only the plural Wiktionary gives first, together with any form it labels rare or dated, such as criterion's "criterions". Once the frequencies are back, cactus lists cactuses as less common again.
- Repeated senses and examples (2026-11-04): Wiktionary gives a sense together with its sub-senses and then each sub-sense again, so "pipe" showed "A rigid tube … A water pipe." and "A water pipe." with the same example under both. A sense now keeps only its own text, an example sentence shows once in an entry, and group headings such as "Meanings relating to a wind instrument." no longer show as senses.
- Capitalised entries (2026-11-04): a word Wiktionary keeps only with a capital, such as the taxon "Whippomorpha", is found when typed in lower case. A word typed with a capital that names something in its own right opens that first, with its capital: "Paris" is the city, not the plural of pari, and "May" starts with the month. A capital that only adds a surname or a small place, as at the start of a sentence, does not change the word: "Children" still opens child and "Went" opens go.
- Etymology of a word with no entry (2026-11-04): the Etymology tab shows a history only for the word you looked up, or the same word with other accents or capitals, from every source. Youdao's etymology block names its word, and one about another word is now left out; when Etymonline's own data does not answer and its word page turns out to be about another word, such as "cover" for "coverness", that page is left out too. Wiktionary's etymology already came only from the page for the word itself.
- Words with no entry (2026-11-04): a lookup that finds nothing, such as "coverness", says "Did you mean governess, covertness or coverless?" with the closest spelling first, instead of quietly opening a guess. Its Etymology tab no longer shows another word's history: Etymonline's stand-in word ("cover") is not used unless it is the same word without accents. A misspelling Wiktionary records, such as "idiosyncracy" or "recieve", still opens the right word.
- Map (2026-11-04): the map now holds every connected word of the notebook or book. It used to stop at 220 words, so Postgraduate 考研 showed 220 of its 4,801 words and ob- listed none of its words; ob- now lists 34, from obtain and observe to occur, offer and oppose. When Families learns a word's origin and the map changes, the words already on it stay where they were, with the same word in focus.
- Map (2026-11-04): on the desktop, drag turns and tilts the map, right-drag or Shift-drag moves it, and the wheel or a trackpad pinch zooms, as on the phone. On the phone, a drag or a two-finger pinch, twist or tilt works even when it starts on a word, and only a short tap opens a word. A drag across the map's height is a full turn, and the map keeps turning after you let go only if your finger was still moving. Zoom and Reset view sit in the top-right corner on every screen. On the phone the map fits above the tab bar, and a word's sheet scrolls into view so Look up can be reached. Without 3D graphics the flat map shows the 48 largest word parts and up to 220 of their words.
- Map (2026-11-04): the Find a word field fits its pill in the desktop window, suggests words as you type, and goes to one with a click or Enter. Typing an inflected form finds the word it comes from, so "changes" finds "change". It also finds word parts by any of their spellings, with or without the hyphen, so "ob-", "oc" and "fect" go to ob- and fac.
- Map (2026-11-04): the Words search no longer empties the map. The map opens on the word it finds, or says that no word matches and keeps the whole map.
- Map (2026-11-04): a word looked up from the map keeps its orange highlight when you come back to the map.
- Word book lists (2026-11-04): Recent in a book's List now means what it means in My words: the words you saved, or for a book word you have not saved the words you started in Learn, newest first. It used to sort by the last review, so a word moved up each time you reviewed it. Words you have neither saved nor started follow in the book's order.
- Map (2026-11-04): a word looked up from the map also keeps its orange highlight when the lookup saved it or otherwise changed the notebook, on the phone and the desktop. The map used to lose the word because it was drawn anew, and a book word saved to My words comes back under a new id; the map now finds the word again by its headword, keeps it where it stood, and keeps the camera on it. If the word did move, the map flies to it.
- Roots and prefixes (2026-11-04): a root is matched in all its spellings and shows them, so fac (make, do) reads "fac · fic · fec · fect" and takes in factory, infect, efficient, perfect, benefit and significant. Prefixes are matched in their assimilated forms: ob- as oc-, of- and op- (occur, offer, oppose), ad- before a doubled consonant (accept, affect, attract), and likewise in-, con- and sub-. The longest prefix wins, so undergo is under- and contrast is contra-, while contract stays con- with tract. Words that only look like a part are left out, such as face and fiction under fac, capital and captain under cap, certain and attain under ten, senate under nat, and electric under ex-. Where Families has read a word's origin from Wiktionary, a word of Old English or Old Norse origin loses its Latin parts. Families uses the same analysis.
- Families (2026-11-04): clicking a small family tile such as flu could send it dozens of rows down the page, out of view. Small tiles were drawn in gaps beside large ones, away from their place in the list, and an open tile no longer fitted in its gap.
- Cards (2026-11-04): Cards no longer jumps to the top of the page when the phone comes back to the app or the page repaints for another reason. The table was rebuilt at its smallest height for a moment, which pulled the scroll position up.
- Cards (2026-11-04): a card turned to its meaning on a scattered table now straightens up and comes to the top while it is read, then leans back when turned again. Before, scrolling a tilted card's meanings moved them along the page while the lines ran along the card.
- Learn (2026-11-04): "Too easy" after a right answer saves it as easy, "Already know it" now works for any new word, My words included, and a word you keep missing (four lapses) is tagged as a trouble word, asked in an easier form and listed on Progress.
- Linked word parts (2026-11-04): a word part written in a lookup's text, such as "ob-", "-ant" or "*bʰeh₂-" in an etymology, opens that part's page, on the desktop pop-up, the desktop lookup window and the phone. Ordinary words in definitions, examples and synonyms stay plain text; Built from, Forms, the word history and the sources' own links still open other words. Dragging across a definition still selects the text and offers its lookup, Tab reaches each link and Enter or Space opens it.
- Word part pages (2026-11-04): prefixes, suffixes, Latin and Greek roots and Proto-Indo-European roots have their own pages. Look up "ob-", "-ant", "-fac-" or "*bʰeh₂-", or tap a part under Built from, in an etymology or in a word history. A prefix or suffix page shows its senses and pronunciation from Wiktionary (only the entry for the part, not a homograph such as the clipping of "obligatory"), its spellings (ob-, oc-, of-, op-), its origin and usage notes, the words in My words and in your word books that are built on it, the commonest English words built on it, and related parts. A Latin or Greek root shows the word behind it with its principal parts (fac is faciō, facere, fēcī, factum) and senses, every spelling (fac, fic, fec, fect, so "-fic-" opens the same page), the Proto-Indo-European root it continues and the commonest English words built on it. A Proto-Indo-European root shows each of its meanings, the English words Etymonline traces to it, and its descendants in Latin, Greek, Sanskrit and the other languages Wiktionary lists. A part page has only the Lexicon and Etymology tabs and no play or save buttons. A word that is also a part, such as "con" or "form", opens as a word and links to the part's page under the headword.
- Built from (2026-11-04): a suffix or prefix that Wiktionary writes without its hyphen in the etymology, as in assist + ant, now reads -ant and opens the suffix, not the insect.
- Learn answer mark (2026-11-04): the check or cross now draws as an ink stroke over the whole question, its prompt and its options, more slowly, over a soft wash, while the right option fills. It plays on desktop and phone, also when Windows has "Show animations" off, which had hidden it completely; reduced motion keeps the fade and the drawing and leaves out the movement. A repaint while it plays no longer cuts it short.
- Learn options (2026-11-04): a question no longer offers two forms of one word, such as "vicissitude" and "vicissitudes" or "glean" and "gleaned", and a session asks one of two saved forms when one is listed as a form of the other or their meanings match. A question always answers and records the word it asked; look-alikes such as "rate" and "rat", "leader" and "lead", or "advice" and "advise" are never treated as one word.
- Learn senses (2026-11-04): a question uses the first real sense of a word and skips citations ("↑ idiosyncracy, in Dictionary.com Unabridged…"), "plural of" lines and Wiktionary style text, and prefers an everyday sense to a dialect one; the answer card and the Missed list show the same senses. A word with nothing usable is skipped rather than asked by sound. A book word whose meaning could not be looked up shows as a plain card, the word first and then its pronunciation and picture, and every book word in a round has its meaning looked up before the round starts.
- Learn taps (2026-11-04): a double tap on Continue no longer answers the next question or marks it "Already know it": taps in a question's first 0.4 seconds are ignored, "Already know it" sits at the end of the instruction row, and the round's summary lists the words set aside with Undo. A My words word marked known counts as known on Today as it does on Progress. Back during an answer saves the answer, and a new question on the phone starts below the app bar.
- Phone keyboard (2026-11-04): with a keyboard attached, 1 to 4 choose and Enter continues, as on the desktop; on a touch-only phone the key hints are hidden.
- Progress sync (2026-11-04): an answer from a device that still saves an older form of a word ("gleaned") lands on this device's card for the word ("glean").
- Word forms (2026-11-04): looking up a past tense, participle, plural, third-person or comparative form whose only senses are "past tense of", "plural of" and the like now opens the word itself, as learner dictionaries do: "gleaned" opens glean, "paparazzi" paparazzo, "vicissitudes" vicissitude, "went" go and "children" child. The same goes for a misspelling or another spelling of a word ("idiosyncracy" opens idiosyncrasy), but not for a regional spelling such as "estrus". A form with a meaning of its own, such as "glasses", "data" or "arms", still opens as itself. "was", "is" and "been" open be, "had" have, "mice" mouse and "taught" teach, while "savings", "belongings" and "earnings" stay, as do "axes" (axe or axis) and "bacteria". An irregular form spelled unlike its word, which the Oxford Advanced Learner's Dictionary gives a short entry of its own, now says what it is above the entry it opens: "was /wəz/ · past tense of be", "ran · past tense of run", "mice · plural of mouse", "taught · past tense, past participle of teach". Regular forms, plurals from Latin and Greek ("criteria") and irregular plurals that begin like their word ("children", "paparazzi") open the word plainly, as in Oxford; the rule agrees with Oxford on 46 of the 48 forms in `scripts/test-word-forms.js`, searched on 2026-11-04 ("does" and "women" are the two Oxford treats otherwise). Longman and Cambridge give "children" a short entry too. [`docs/WORD_FORMS.md`](docs/WORD_FORMS.md) compares the rule with Oxford, Longman, Cambridge and Merriam-Webster word by word. The page turns to the word before it shows the form in most lookups. The heart saves the word that opens, on the desktop pop-up, the desktop main window and the phone, even when tapped before the page has turned to it.
- Saved forms (2026-11-04): words already saved as a form of another word become that word once, on the desktop and the phone. A form whose saved meaning or spelling settles it changes at once; the rest are checked against Wiktionary in the background when online, so "gleaned" becomes glean and "idiosyncracy" joins idiosyncrasy. When the word is saved too, the two merge: the saved word keeps its part of speech, pronunciation and meaning and gains the form's own senses, both notes, the earlier save date, the more studied schedule and its due date, and the answer history and word-book progress follow. A form saved later beside its saved word joins it right after the save.
- References as senses (2026-11-04): a word could show Wiktionary's reference list as its meanings ("idiosyncracy, in Dictionary.com Unabridged ... ISBN"). References are no longer read as senses, and saved words that kept them lose those lines.
- Forms (2026-11-04): the Forms section lists what learner dictionaries list. Possessives are gone, a form gets no forms of its own ("paparazzi" no longer shows the plural "paparazzis"), and a second form that is rarely written is dropped or marked "less common" by how often each is used, so paparazzo lists paparazzi without paparazzos and cactus lists cactuses as less common. A form Wiktionary marks rare, dated or hypercorrect shows that label, and "be" shows am, are, was and were. "fish" lists fish and fishes, and "die" lists dies for the tool and dice for the cube, each named.
- Borrowed words (2026-11-04): "paparazzo", which language detection can take for Portuguese, showed the English word itself as its only sense. Its English senses are shown instead.

## [4.0.0] - 2026-11-04

The 4.0.0 files were first published on 2026-11-03 and rebuilt from `main` on 2026-11-04; the entries dated 2026-11-04 arrived with the rebuild.

### Added

- Word book files (2026-11-04): Export in Words saves the book you are looking at (My words, a book you made, or one of Phevere's books) as one `.pvbook` file, with every word, the sentence it was saved from, its saved date and its learning history. Import reads it on the desktop or the phone and rebuilds each word's progress, so importing the same file twice changes nothing. Importing a book you made where one of the same name exists asks whether to replace it or keep both. Export for Anki writes a deck Anki imports as is, and Import reads Anki packages (`.apkg`, including Anki 2.1.50 and later) and Anki text exports, one book per deck. See [`docs/BOOK_FORMAT.md`](docs/BOOK_FORMAT.md).
- Learn (2026-11-04): an answer is marked on the question itself, with a check drawn like a pen stroke for a right answer, a cross for a wrong one and a lighter check for an almost, instead of a green "Correct" line; the chosen and the right option carry a small cross and check. A back arrow at the top of a session returns to the Learn page. The daily goal takes any number from 1 to 999 beside the 5, 10, 20 and 40 presets.
- Language filter in Words (2026-11-03): when My words holds at least three words in each of two or more languages, a row of chips above the views (All, English, Chinese, Japanese and so on, each with its count) shows one language at a time in List, Families, Map and Cards, on desktop and phone. The choice is remembered. A Latin-script word that language detection filed under a language with only a word or two (an English phrase saved as Italian) counts as English. Word books keep one language each and show no chips.
- Quick translation (2026-11-03): on the desktop, Settings → Shortcuts → Quick translation turns on two shortcuts. Translate and replace (Ctrl+Alt+T) swaps the selected text in any application for its translation, using the From and To set there and the Translation engine from Sources. Choose a translation (Ctrl+Alt+Shift+T) opens a panel beside the pointer with each engine's translation; change the languages there, move between engines with the arrow keys, and press Enter to paste, or Esc to leave the text alone. Text already in the target language goes the other way, so Chinese with a Chinese target becomes English. The clipboard is put back afterwards and the borrowed text stays out of clipboard history. If another app holds a shortcut, Settings says which one. Linux needs `xdotool`; without it the section is not shown.
- Definitions in other languages (2026-11-03): Settings → Sources has a new group with Chinese Wiktionary, Russian Wiktionary and Japanese Wiktionary, all off until you switch them on. Chinese Wiktionary defines Chinese words and words of other languages in Chinese, and marks literary and Classical senses 〈书〉; the Russian and Japanese editions define Russian and Japanese words in their own language. See [`docs/MULTILINGUAL.md`](docs/MULTILINGUAL.md).
- Word sources (2026-11-03): a word saved from the pop-up remembers where you met it: the app, the web page title and address in Chrome, Edge and Firefox, the document and page in a PDF reader, and the sentence around the word. The expanded word shows the source and the sentence with the word marked, Learn's gap-fill question uses that sentence, and Words → Sources groups saved words by book or site, with Make a word book to turn one into your own book. Private and incognito windows are never read, and Settings → Capture has a switch to turn it off.
- Families (2026-11-03): Families now places most of a notebook, not only words with a Latin or Greek part in their spelling. Each word's origin and Proto-Indo-European root are read from Wiktionary, so a 591-word notebook went from 205 grouped words to 493 under Origins, with 20 families under the new Deep roots. A family is a folded card with its words stacked behind it that deals them out when opened, origins are layered strata split by the route a word took (Latin via French), word trees are drawn as small trees whose branches grow in, and every grouping ends with the words it could not place.
- Map (2026-11-03): the map is a 3D graph you can turn and zoom. Only roots and prefixes carry labels until you point at a word; clicking one flies to it, dims the rest and lists its words with Look up. A search field flies to a word.
- Cards (2026-11-03): cards open as piles by week. Scatter throws them across a table where you can drag them, Grid sorts them A to Z, and a tap opens the word's lookup.
- Search (2026-11-03): the search field in the desktop main window looks things up, not only the notebook. Enter looks up what you typed, and the panel under the field lists matching saved words with their first sense, recent lookups and the Settings page that holds a matching option.
- Saved words (2026-11-03): an expanded word shows when it was saved, on which device, which dictionaries gave its senses, and when its next review is. The Recent list has a timeline rail of weeks or months beside it that scrubs like A to Z.
- Learning progress (2026-11-03): Learn has a Progress page beside Today, on desktop and phone. It shows today's new words and reviews against the daily goals, your streak, new, learning and known words in My words and each book, how many words you have mastered in meaning, spelling and listening, how much of each root family you know, answers per day over 30 days, and a forgetting curve for the next 30 days. Every answer and every "Already know it" is now kept in a local answer history, from which each word's schedule can be rebuilt; see [`docs/REVIEW.md`](docs/REVIEW.md).
- Word books (2026-11-03): the Notebook tab is now Words, on desktop and phone. My words is your own list as before, and "Add a word book" opens a library of ten graded lists ordered from primary school up: Starter 1000, Junior high 中考, Senior high 高考, CET-4, CET-6, Postgraduate 考研, General English 2800, Academic English 960, TOEIC 1250 and Business English 1700. A book you add sits in the switcher above the views with a progress ring of known words. Its List shows the words in the book's order with New, Learning or Known, a heart to add the word to My words and a tick to mark it known; Families, Map, Cards and Review work on its words. Review draws each book's daily goal of new words in order, looks up their meaning, mixes in every word due that day, and offers "Already know it" for a new word. All books runs one session across My words and every book, and the plan panel shows each book's new and due words and known count. A word learned once counts in every book that lists it. Subscriptions and progress sync with the account. Sources and licences are in [`docs/WORDBOOKS.md`](docs/WORDBOOKS.md).
- API keys (2026-11-03): Settings → API keys has one card per provider: Google Translate, DeepL, Youdao, Oxford Dictionaries, WordsAPI and Collins. Each card says what the key turns on and whether a key is not set, saved, verified or rejected, and its Test button sends one small request to the provider. Fields are masked, with Show and Clear buttons and a Get a key link to the provider. The desktop app now has fields for Youdao, Oxford, WordsAPI and Collins, which it could already use but had nowhere to enter. On the desktop, keys are now kept across restarts, encrypted with the system keychain (DPAPI on Windows); before, they were lost when the app quit.

### Changed

- Export (2026-11-04): Words no longer exports My words as JSON or CSV; it writes a `.pvbook` file or an Anki deck instead. Import still reads the older JSON and CSV files.
- Plus (2026-11-03): the Get Plus button is now a quiet text link in the account panel. Learn shows it only when progress synced earlier is about to be dropped.
- Sources under senses (2026-11-03): the source of a run of senses is one quiet line after the run, in sentence case, instead of spaced capitals under every sense.
- Settings (2026-11-03): Shortcuts, Capture, Notifications and Audio on desktop, and Capture, Notifications, Audio and Lookup on the phone, use the same cards, rows and key caps as Sources, Offline and API keys.
- Neural voice (2026-11-03): Settings → Audio and Setup recommend Neural (high quality) on desktop. On an i5-10500 it read a 124-word paragraph with no pauses and half the CPU time of the standard voice, which falls behind real time on Intel CPUs without VNNI. Setup calls the two voices Standard and High quality, as the app does.
- Sync (2026-11-03): saved words and word-book subscriptions keep syncing free, without review progress. Learning progress now syncs as the answer history, and only for accounts with Plus; on every device the schedule of each word is rebuilt from the merged answers. Without Plus, progress stays on the device and everything works there; the account panel and the Learn tab show one line and a Get Plus link. A word record pulled back from the server keeps this device's schedule, also when another device merged two copies of the word. See [`docs/ACCOUNT.md`](docs/ACCOUNT.md).
- Learn tab (2026-11-03): Review left the Words switcher and became its own tab, Learn. The phone's bottom bar reads Lookup, Words, Learn, Settings, and the desktop window's tabs read Words, Learn, Recent. Words keeps List, Families, Map and Cards. Learn has a switcher for My words, each word book you added and All books, and shows today's quiz with the daily goal, the book rows and the two-week forecast. The list chosen in one tab is chosen in the other. If you had left the notebook on Review, Words opens on the list and the desktop window opens on Learn.
- Phone Settings (2026-11-03): Sources, Offline and API keys on the phone use the same rows, language bands, catalogue cards, pack sheet and key cards as the desktop. Clearing a key now takes effect at once rather than after a restart, and the progress bar moves while a pack imports.
- Offline (2026-11-03): each language in Settings → Offline has its own band, with its name in its own script, a large sample of the script behind it and notes on its alphabet. Packs are catalogue cards, each with its own spine. Selecting a pack opens a panel with its description, entry count, download and installed size, edition and date, publisher, licence, source, homepage and, once installed, where it is stored. A download shows its progress on the card and in the panel.
- Sources (2026-11-03): dictionary sources and translation engines share one row design in Settings → Sources: a seal, the name, the languages it covers, and its switch or choice. Each row opens to a short description of what it provides and a link to its site. A source that needs a key says API key required, and that label opens the provider's card on the API keys page.
- Review (2026-11-03): the notebook's Review view is a quiz on desktop and phone instead of a card with Again, Hard, Good and Easy buttons. A new word asks you to pick its meaning from four; as you learn it, you pick the word for a meaning or the word you hear, then type it from its meaning or from the audio, and finally fill the gap in a sentence from your note. Answers are graded from whether they were right and how long they took, and "I knew it" or "I didn't know it" overturns the grade. Each answer shows the picture, pronunciation and senses with an Open in lookup button, and a session ends with a summary of missed words. On the desktop, 1 to 4 choose and Enter continues. Scheduling moved to FSRS, the model Anki uses; words reviewed before keep their progress, converted from their old interval and ease, and older app versions keep syncing. The reasons are in [`docs/REVIEW.md`](docs/REVIEW.md).
- OCR pack (2026-11-03): desktop installers no longer include the PP-OCRv4 models, so the Windows x64 Setup.exe is about 15 MB smaller. Hover lookup over text that cannot be selected, and Scan, need the OCR pack, a 14 MB download: Settings → Capture shows "Needs the OCR pack" with an Install button beside Hover lookup, and the Hover chip reads No OCR until it is installed. The app checks each file's SHA-256 and falls back to npm mirrors when GitHub is slow. Upgrading a Windows installation of 3.0 or earlier keeps the models it already has.
- Windows Setup (2026-11-03): Custom options are grouped into install location (with the space required), Shortcuts, Startup and Downloads, each download with its size. The OCR pack can be ticked there. A new install no longer creates a desktop shortcut unless you tick it.

### Fixed

- Plurals (2026-11-04): a plain plural such as "acronyms", whose only senses are "plural of acronym", opens as "acronym" and is saved as "acronym". Words already saved that way ("scraps") become their singular once, joining it if it is saved too; irregular plurals are left alone. A plural with senses of its own, such as "bacteria" or "glasses" (spectacles), keeps its own entry, and those senses are no longer dropped.
- Phone Words (2026-11-04): the List view shows every saved word instead of the 400 changed most recently, so search finds older words, the My words count is the whole notebook, and book lists mark every saved word.
- Pictures (2026-11-04): clicking a picture beside a sense shows it larger, over the lookup, with its title and a link to its page on Wikimedia Commons. A click outside the link, Esc, or Back on the phone closes it.
- Etymology (2026-11-04): "From", "Borrowed from" and the like are no longer bold in any source tab.
- Phone Cards (2026-11-04): tapping a card's picture turns it over and tapping its text opens the lookup. The meaning side scrolls when it is longer than the card, and shows up to eight senses.
- Phone Back (2026-11-04): the back gesture now closes an open sheet or picker, leaves a Learn session for the Learn page, steps back through looked-up words, returns to Words or Learn when the lookup was opened from there, and returns to Lookup from the other tabs, before it leaves the app.
- Phone pronunciation (2026-11-04): "Loading pronunciation…" appears only when a recording is not on the phone yet and takes more than two and a half seconds.
- Card pictures (2026-11-04): on the desktop, Cards no longer takes minutes to show pictures. They are fetched by the main process, which Wikimedia lets make far more requests, and pictures and dictionary results are kept on disk for two weeks, so a restart shows them at once.
- Android voices (2026-11-04): with a neural voice, each IPA chip now says its own pronunciation instead of the headword, as on the desktop. Recorded pronunciations are kept on the phone after the first play and fetched ahead when a lookup finishes.
- Phone settings (2026-11-04): each settings page starts with its name, and the Lookup page that held only an Images switch is gone; the switch is "Pictures beside senses" in Sources.
- Words froze (2026-11-03): opening Families, or switching to it a few times, could hang the whole main window, and because Families is remembered it hung again on every launch. On the phone it hung after opening a family card. Tracing origins no longer repaints the view when nothing new came back, and the trace is saved when it ends.
- Deep roots (2026-11-03): the count no longer climbs from a few cards to dozens each time you come back. Traced roots are kept, root glosses load twenty at a time, and the phone traces every saved word instead of the first 400.
- Words header (2026-11-03): Export, Import and Refresh moved into a More menu at the end of the header row, so the header fits on one line.
- Date rail (2026-11-03): the date and A to Z rails sit just inside the scrollbar instead of under it, the list uses the space the rail left empty, and the label shown while dragging fits a whole date.
- Pop-up (2026-11-03): the selection toolbar and lookup window no longer have a grey band under them on Windows 11.
- Japanese speech (2026-11-03): Japanese is no longer read by the Chinese voice. An installed Japanese voice reads it, or Google Translate's voice when there is none, and the system's default voice is never used for a language it does not speak.
- Examples (2026-11-03): a Chinese example from Wiktionary shows once, in simplified characters, instead of once in each script.
- Sources (2026-11-03): on the desktop, switches in Settings → Sources are kept across restarts.
- Lexicon (2026-11-03): senses with no part of speech are headed "other" instead of "unknown", or have no heading when they are the only group.
- Pop-up (2026-11-03): selecting a new word sometimes left the pop-up on the previous one. A hover lookup that finished after the selection replaced it, a strip that had just expanded kept its old word, and selecting the same word again later was ignored. While text is selected, hover lookups now wait until the next click.
- Long text speech (2026-11-03): reading a paragraph aloud in Translation sent it to the voice as one job, so nothing played until all of it was synthesized, and the PC stayed busy with no way to stop it. Speech now starts after the first sentence, pressing the speaker again stops it, and closing the pop-up cancels what is queued.
- Neural voices (2026-11-03): downloading Neural (standard) or Neural (high quality) failed its checksum on every platform, because sherpa-onnx re-uploaded both Kokoro archives on 2026-10-26. The app now expects the new files. On a PC with Kokoro, a long Translation paragraph used to wait about 38 seconds before any sound and stopped at 500 characters; it now starts after about 4 seconds and reads to the end, on two CPU threads instead of half the cores, with the voice loaded while the lookup is still open.
- FreeDict English–Chinese (2026-11-03): the catalog listed it under the GNU GPL; its TEI header says Creative Commons Attribution-ShareAlike 3.0, and Settings now says so too.
- Android LSPosed (2026-11-03): in apps whose screens are drawn by another app, Phevere stayed at the end of the selection bar's overflow because the module never ran where the bar was drawn. Pressing Phevere on such a bar while a custom slot or the instant press is set now asks LSPosed, once per app, to add the app that drew it; after you approve and force-stop that app, the slot applies there too.
- IPA (2026-11-03): words that neither Wiktionary, Free Dictionary nor the CMU Pronouncing Dictionary transcribe, such as holon and operon, showed no pronunciation in the lookup or the notebook. Datamuse, which the lookup already asks for senses, now also returns its pronunciation of the word, and that becomes the US IPA when no other source has one: holon reads /ˈhɑlən/. Notebook words saved without a pronunciation get it the next time the app starts. A saved lookup with senses but no IPA is now kept for a day instead of two weeks, so the phone looks it up again.
- Pictures (2026-11-03): some words, such as operon and arbitrage, got no picture in the lookup or on notebook cards. Wikimedia now lets a client that does not name itself make about ten requests a minute, and the desktop asked for pictures with a generic browser User-Agent, so after a few words the answers were 429 errors. The empty result was then kept until the app restarted, or for two weeks on the phone. Pictures are now requested at most three at a time with Phevere's own User-Agent, a 429 is retried once, nothing is kept when a request failed, and a word that found no picture is tried again after six hours. A word whose Wikipedia article has no lead image now takes a picture used in the article that names it, SVG diagrams included, so operon shows the lac operon diagram. The Commons search looks for a one-word query in file names and takes drawings too, so arbitrage shows a trading chart instead of nothing (the full-text search returned US Navy ships coded ARB). A word whose Wikipedia title is a city, a film or a person, such as holon, no longer gets photos of that city.

## [3.0.0] - 2026-11-02

### Added

- Forms (2026-11-02): the Lexicon has a Forms section after the senses, on desktop and phone. Verbs list the third-person singular, present participle, past and past participle; English nouns the plural and possessive; adjectives the comparative and superlative. German, Russian and other declined nouns get a table of cases by singular and plural, and French and Spanish verbs a table of persons for the present and past. Only parts of speech the lookup shows get a table, so a rare verb sense of mice adds nothing. A form says what it is (mice is the plural of mouse) and shows its lemma's forms. Russian stress is shown as a bold vowel. The forms come from Wiktextract's parse of Wiktionary's inflection tables on kaikki.org and load after the senses.
- Spelling (2026-11-02): an English word with no entry, or whose entry is mostly "misspelling of" another word, is looked up as the closest spelling one or two edits away. recieve shows receive, definately shows definitely, and acomodate shows accommodate, and the notebook saves that spelling.
- Multilingual sources (2026-11-02): Japanese words get English senses from Jisho, Russian words from OpenRussian, and words in any language English Wiktionary covers from kaikki.org, each with a switch in Settings → Sources. Wiktionary now answers from the section of the detected language, so a Russian word is no longer looked up under English. A Latin-script word that English sources do not know, such as Haus or Häuser, falls back to kaikki's entry in other languages and to the installed packs of other languages.
- Offline packs by language (2026-11-02): JMdict for Japanese (the full dictionary on desktop, common words on the phone), Kengdic for Korean, and FreeDict packs from German, French, Italian, Portuguese, Dutch, Polish, Russian, Greek, Finnish, Hungarian, Catalan and Croatian into English. German is desktop only. Settings → Offline lists every pack under the language of its headwords, with its size and a Download or Remove button, and the phone can now install FreeDict packs.
- Notebook views (2026-11-02): on desktop and phone the notebook has five views. List is the dictionary sheet as before. Families groups saved words by a shared root, prefix, suffix, origin (Latin, Greek, French, Old English) or Han character, and shows word trees where one saved word is built from another (nation, national, nationality). Map draws the same relations as a graph you can pan and zoom; pointing at a root lights up its words. Cards show each word split into its parts with their meanings, your note as a mnemonic, and the meaning on the back. Review runs today's spaced-repetition queue (Again, Hard, Good, Easy) with a daily goal for new words, the reviews due over the next two weeks and the words added over the last twelve weeks.
- iOS Neural voices (2026-10-30): Settings → Audio on iOS lists the two Kokoro voices Android has, Neural (standard, 132 MB) and Neural (high quality, 350 MB), below the installed Apple voices. Tapping one downloads it with a progress bar and a cancel button, resumes after a dropped connection, checks its SHA-256 and then selects it. Words are then spoken by Kokoro through sherpa-onnx 1.13.3; IPA chips and any text Kokoro cannot voice still use the Apple voice. The app grows by the statically linked sherpa-onnx and onnxruntime libraries, and now needs iOS 15.1 or later, the minimum onnxruntime 1.26 is built for (every iPhone that ran iOS 14 can run iOS 15).

### Fixed

- Android sign-in (2026-10-30): signing in on the phone failed with "Sign-in did not finish. (token_error)". The app's HTTP bridge read only a `Content-Type` header spelled with capitals, so the form-encoded token request went to Auth0 labelled as JSON and was rejected. Header names are now matched in any case.

### Changed

- Pictures (2026-11-02): every word with a definition gets at least one picture. When no sense has a matching picture, the first sense takes the picture of the Wikipedia article about the word, abstract ideas included (freedom, justice, happiness), or a Wiktionary caption that names it, or the article of a related noun (inspect shows an inspection, beautiful shows beauty), or the best-matching Wikimedia Commons file. Notebook cards and Review ask for a picture for every word.
- Word family (2026-11-02): the section is shorter and easier to read. Inflections and "form of" moved to Forms. Each group (derived words, related words, other spellings, phrases, see also) shows its closest members as one line of links, and the rest open under All. Derived words that share the headword's stem and common words come first, so happy lists happily and happiness before happycore. Proper names go last among phrases. Affixes and roots read as one Built from line, and the side rail has one Family entry instead of one per group. An English lookup of a word whose Wiktionary page has no English section, such as Haus, no longer lists words from other languages.
- Notebook words (2026-11-02): words are saved in dictionary form instead of as selected, so CODON is saved as codon and Bunny, as bunny. German nouns, proper nouns, abbreviations and I keep their capitals. Words saved earlier are fixed once when the notebook opens; the change syncs to other devices, and entries that now name the same word are merged.
- Desktop main window (2026-11-02): Notebook and Recent are tabs at the top of the window, and the window scrolls as one page. The notebook list used to scroll inside the scrolling window, so the wheel stalled at the list's edge, and every row of a long notebook was laid out on each scroll step. Rows off screen are now skipped until they scroll into view, and a long list paints its first rows at once and the rest in the background.
- Notebook rows (2026-11-02): Look up sits next to Play at the end of every row, so a collapsed row can be looked up without opening it.
- Recent lookups (2026-11-02): recent lookups are the same rows as the notebook, grouped by day, with Play, Look up, the time, and the pronunciation and part of speech of words already in the notebook. The desktop keeps 60 and the phone 30. Lists saved by earlier versions still load, without a time.
- Source language (2026-11-02): the desktop Translation tab now starts on Detect language, as the phone already did. Detection reads Japanese-only kanji (対, 応, 駅, 働) and 々 as Japanese, so 要対応 is no longer taken for Chinese, and common simplified-only characters as Chinese. Latin text is scored on letters that belong to few languages (ß, ñ, ő, ł, ř), Cyrillic and Arabic variants are told apart, and more scripts are recognised. A single word that the English word list does not have, or Han text with nothing telling, asks Google's keyless detector, waiting at most 0.9 seconds and pausing for ten minutes after a failure.
- Sense order (2026-11-02): English lookups now put the most common part of speech first and, within it, the most common senses first, on desktop and phone. The counts are how often each Princeton WordNet 3.1 sense is tagged in the SemCor corpus, the same counts that order WordNet's own sense numbers. Free Dictionary and Wiktionary senses are matched to WordNet senses by the words their definitions share. Counts within a factor of two count as a tie, so the source's order still decides between, for example, the financial bank (20 tags) and the river bank (25). Senses that match nothing stay beside the sense before them, and the lexicon no longer reorders senses by definition length. "bear" and "fair" now open on the verb and the adjective instead of the noun. The table (6,889 words, 680 KB compressed) loads in the background on the first English lookup. `scripts/build-sense-frequency.js` rebuilds it.
- Notebook (2026-10-30): on desktop and phone the notebook is one sheet of rows grouped by day (Today, Yesterday, This week, then by month). A row shows the word, one pronunciation, the part of speech, a play button and the time, and never the meaning, so the list works as a memory check. Opening a row shows the pronunciations as US and UK chips, the senses as a numbered list (four, then Show more), the note, the sources and the save date, with Look up and Remove. The language pair appears only for translations.
- Icon (2026-10-30): Phevere uses the Holarky family letter p from the Holarky brand kit: a lowercase p leaning 12 degrees, with a plum stem and a hollow mint bowl, on a paper tile. It replaces the text-cursor p on Windows, macOS, Linux, the tray, the installer, the Android launcher, iOS, the splash screens and the window title bars. At 16 to 32 px the bowl is a solid stroke (`packaging/icon-small.svg`). The account button's Holarky mark uses the brand's small mark too.
- Account (2026-10-30): the Holarky account is a button in the desktop title bar and the phone app bar instead of a Settings section. Signed out it shows the Holarky mark and opens Sign in; signed in it shows your initial and opens a panel with sync status, Sync now, Sign out and Delete account. A ring on the button means a sync is running and a red dot means the last one failed.

### Fixed

- Linux tray icon (2026-10-30): the icon now appears when Phevere starts before the desktop panel, which is common when it launches at login and on slower ARM machines. Electron picks the tray backend once, when the icon is created, and fell back to an old-style X11 icon that Wayland panels never show. Phevere now checks the session bus for a StatusNotifierItem host and rebuilds the icon when one appears. With no host after a minute (GNOME without the AppIndicator extension, or a panel without a tray), it logs the session type and desktop and shows one notification.

## [2.3.0] - 2026-10-29

### Added

- Holarky account (2026-10-29): sign in with one Holarky account, shared with knowrld, from Settings → Account on desktop and phone (email and password, or Google, on Holarky's sign-in page). While signed in, the notebook stays the same on every device: words, notes, review progress and deletions sync, the newest edit wins, and the same word saved on two devices becomes one entry. Settings → Account also syncs on demand, signs out (the notebook stays on the device) and deletes the account everywhere. Lookups never wait for the account. See `docs/ACCOUNT.md`.
- Linux desktop (2026-10-25): deb, rpm and AppImage for x64 and arm64, attached to the 2.2.0 release. Select-to-lookup reads the primary selection (Wayland data-control on KDE Plasma and wlroots, XFixes on X11); GNOME Wayland uses a `phevere --lookup-selection` shortcut. Hover lookup (AT-SPI, then OCR), read-this-window, now playing (MPRIS), hold-to-trigger, and OCR work as on Windows. See `docs/LINUX_SELECTION.md`.

## [2.2.0] - 2026-10-20

### Changed

- Icon (2026-10-20): a light tile with a lowercase p whose stem is a text cursor and a highlighter stroke through it replaces the dark teal P. Windows, macOS, tray, installer, Android launcher, iOS and the splash screens all come from `packaging/icon.svg`; the phone splash no longer shows the Capacitor placeholder.
- In-app text (2026-10-20): one name per thing on desktop and phone (Notebook, Recent lookups, Scan region, Scan under pointer, Scan active window, Scan clipboard image, Pop-up settings, Back and Forward). Failures read "Could not …", empty states are short, status chips read On or Off, and messages no longer name the OCR engine or the notebook database. Voices are Built-in, Neural (standard) and Neural (high quality).

### Fixed

- Etymonline (2026-10-20): entries load inside the app again. The /word/ pages sit behind a Cloudflare challenge, so lookups now use Etymonline's JSON endpoint and fall back to the page. Every entry for a word (verb, adjective, noun) is shown.
- Neural voice on IPA chips (2026-10-20): with Neural compact or Neural full quality installed, desktop IPA chips read their own transcription with Kokoro instead of eSpeak, in the same phoneme style the headword voice uses. On Android the chip says its headword in the chip's accent with the neural voice. Mechanical still uses eSpeak.
- Settings gear (2026-10-20): stays beside the window controls. A zero-width title bar reading while the window was hidden used to push it next to the title.
- Stacked lookups (2026-10-20): each outside click closes the front popup, then the next one, instead of closing only the first.
- Settings and main window (2026-10-20): the gear reopens Settings every time. A window whose first paint was skipped used to stay hidden, so the gear did nothing until restart; the main window could start hidden the same way.
- Word history (2026-10-20): a Wiktionary root now sits at the oldest end, so "orientation" reads Proto-Indo-European, French, English.

### Changed

- Etymology summary (2026-10-20): the word history reads oldest first and ends at the headword, with the relation on each arrow. The Wiktionary text no longer repeats it as a reversed line.
- Settings shortcuts (2026-10-20): rows share one label column, so key boxes and Set buttons line up. Popup trigger shows "Hold while selecting" under its label, and the fixed shortcuts sit under a Fixed subhead in the same columns.

## Desktop and phone refresh for 2.1.0 (2026-10-14)

All six downloads were replaced on the existing 2.1.0 release; the git tag is unchanged. Windows x64 and ARM64 passed the real upgrade checks. Mobile builds and the Android emulator speech test passed. The Android CI and release APKs have different debug signing certificates; upgrade compatibility with the previous published APK is unverified. Earlier intermittent ARM64 native startup failures remain unexplained.

### Fixed

- Full-panel opening (2026-10-14): expose the existing preference as Open full lookup panel and perform the lookup when selected text arrives after the panel has already expanded. Duplicate startup messages retain the chosen view.
- Etymology sources (2026-10-14): restore contributor attribution, combine passages from the same contributor and language without dropping distinct continuations, retain the chosen tab as results arrive, and separate pronunciation-only caches. Etymonline request failures remain visible with an Open entry action and retry after ten minutes.
- Desktop lookup shortcut (2026-10-14): immediately reopen the same selected word after closing its popup, retain the selected text until it expires, and reuse a loading strip when the shortcut repeats.
- Windows installer upgrades (2026-10-14): preserve component choices, honor shortcut retention during replacement, and avoid creating installation registry entries before installation succeeds. Release jobs verify a real upgrade and same-version replacement before upload.
- Desktop popup sizing (2026-10-14): expanded panels enforce a toolbar-safe minimum width, keep pending content fitting from reusing strip dimensions, and stop treating a loaded panel as an in-flight selection strip.
- Windows selection monitor (2026-10-14): replace detached capture threads with an owned worker, join workers before destruction, release replaced callbacks and the UI Automation handler, and bound pending callbacks.

### Added

- Windows Setup component choices (2026-10-14): optional Compact and Full pronunciation models download during installation on x64; startup and post-install launch choices sit under Custom options. Native controls retain the original illustrated single-page layout and support keyboard navigation.
- Local desktop diagnostics (2026-10-14): record sleep, resume, process exits, and crashes under the app's local data directory without uploading reports. The reported day-long idle exit remains unverified.

## [2.1.0] - 2026-09-30

### Added

- **Pronunciation voices on desktop (2026-09-30):** the phone's engines. eSpeak NG is built in (the Mechanical voice, and every IPA chip, spoken from the IPA itself); Kokoro neural voices can be downloaded in Settings → Audio (compact 132 MB, full 350 MB), except on Windows on ARM, which sherpa-onnx does not support. The headword speaker plays the recorded clip and, when there is none, speaks the word with the chosen voice; notebook ▶ does the same; translation speakers use the chosen voice. Speed and volume now apply.
- **IPA for every English word (2026-09-30):** when no online source has a transcription (Wiktionary's "rejuvenation" has only audio), US IPA comes from the CMU Pronouncing Dictionary.

### Changed

- **Installer (2026-09-30):** one page instead of a wizard: an illustration, an Install button and the license checkbox, with Custom options for the folder, shortcuts and OCR models. Installing shows one progress bar; the last page opens Phevere. Always installs for all users in Program Files, which was already the default.
- **Loading (2026-09-30):** lookups show a skeleton of the result with the selected word already in place, instead of a progress bar with stage chips. OCR keeps its progress bar.
- **Settings (2026-09-30):** laid out like the phone: flat rows, section subheads, offline packs as rows with download and remove icons, API keys saved when edited, no internal priority numbers.
- **Look (2026-09-30):** sharper part-of-speech rail labels (desktop and phone), parts of speech in italic serif, soft source chips, slim monitor toggles with a status dot, and window buttons on the paper colour instead of a grey band.

## [2.0.0] - 2026-09-29

### Added

- Settings → **Notifications**: turn off the clipboard-image tray balloon, the “no image on clipboard” hint, and hover on/off banners. Stored in `%APPDATA%\phevere\notification-prefs.json`.
- **Android / iOS:** native WebView (not Capacitor) with a Material 3 phone UI: full lookup (lexicon, translation, Wikipedia article in the pane, etymology source tabs, IPA, recorded audio), notebook (expandable rows, export/import), settings (sources, API keys, offline packs), Process Text / Share as a compact lookup card (Android overlay or bottom sheet; iOS half-sheet), and camera / photo **Scan** (image stays, words are selectable). Phone **Notifications** has independent switches for incoming lookup, notebook saves, and scan finished. Android keeps a silent shade entry while the lookup strip floats. See [`docs/MOBILE.md`](docs/MOBILE.md).
- GitHub Actions **android-apk** and **ios-ipa** jobs upload a debug APK and an IPA as **Actions artifacts** (not GitHub Releases).

### Changed

- **Main and settings windows (2026-09-29):** same palette, bundled fonts, scrollbars and controls as the phone app and the new pop-up: pill buttons (one filled ember action per page), Material switches and radios, tonal pill for the open settings section, flat fields with an ember focus ring. The main-window slogan and the explanatory paragraphs on the Notifications, Sources and Offline pages are gone.
- **Lookup speed (2026-09-29):** the first result appears as soon as Wiktionary or Free Dictionary returns senses (about 1 s here, with IPA), instead of waiting up to 2.5 s for the slowest source. Translation, IPA top-ups and etymology arrive as separate updates as each one lands, rather than after the slowest translation engine. A source whose host keeps timing out (Free Dictionary is currently unreachable) is skipped for 3 minutes, doubling up to 30. Results are cached even when one source failed (for 10 minutes in memory), and asking for a word that is still loading joins that lookup instead of starting another.
- **Phone cache (2026-09-29):** finished lookups are kept in the WebView's localStorage for 14 days (1 day when a source was missing), up to 300 words, so they survive Android closing the app and are shared with the floating pop-up. Android requests share one HTTP client, so connections to each host are reused.
- **Desktop pop-up (2026-09-29):** restyled to match the phone app: warm paper colours, line icons, Outfit for text, Source Serif 4 for the headword and examples, and Charis SIL for IPA (all bundled, so they load without Google Fonts). Lexicon, Translation, Wikipedia and Etymology are now icons in the toolbar; the open one becomes a tab joined to the page below, and the old text tab row is gone. Back and forward sit at the left of the toolbar. One thin scrollbar style throughout. The options menu uses switches, and the pop-up keeps a width you dragged wider when you change views.
- **Hover lookup (2026-09-29):** reads the word under the cursor instead of its neighbour. A UI Automation word whose box does not contain the cursor is ignored in favour of OCR, and OCR now weights glyph widths when mapping the cursor to a character.

- **Android (2026-09-28, night):** rooted phones: the LSPosed module presses Phevere with no selection bar when “Pop up as soon as text is selected” is on, and Settings → Capture adds **Phevere's place on the bar** (system default, or drag it into a slot on a mock bar). Modern LSPosed shares these switches through its private remote preferences; older LSPosed falls back to a readable preferences file. Without root, accessibility presses Phevere on the bar (Chrome included).
- **Android (2026-09-28, later):** in-app selections use the selection bar unless “Pop up as soon as text is selected” is on (the floating pop-up draws an equivalent bar). The pop-up is smaller (≈360 × 460 dp) and opens beside the selected word when its position is known. One “Phevere” top bar on every tab; the pop-up header is a slim row without a search box; icon result tabs; Google Translate-style language bar and sheet; Material voice list with download progress; Playback volume. Back/forward and “plural of X” links follow the desktop pop-up. Wiktionary usage notes no longer appear as IPA.
- **Android (2026-09-28):** floating pop-up closes on a tap outside and resizes by dragging its margins (size remembered). IPA chips are compact and share a full-width row. Settings tabs wrap onto more lines. Pronunciation voice is a radio list with download progress, matching the Translation engine list. In-app selections open the pop-up only when “Pop up as soon as text is selected” is on.
- **Android (2026-09-27):** Settings → Capture → **Pop up as soon as text is selected** (off by default) opens the pop-up on selection via an accessibility service, without root. Chrome page text still needs the selection menu.
- **Android (2026-09-27):** Settings → Audio → Pronunciation voice adds a compact neural voice (Kokoro int8, 132 MB) beside the full 350 MB one.
- **Android (2026-09-27, later):** selecting text inside Phevere opens the pop-up, as on desktop and in other apps; in the pop-up it looks up in place (the overlay no longer drops the selection). The pop-up's From/To language lists open again, and changing a language keeps you on the Translation tab. IPA chips no longer play silence or odd sounds for unstressed IPA or for vowels eSpeak's English voice lacks.
- **Android (2026-09-27):** passes the 16 KB page-size check (eSpeak is built from source with NDK r28). IPA chips speak their IPA with the mechanical voice, as on desktop; the notebook ▶ now plays the recorded human clip like the headword button. Lexicon examples pair English with Chinese instead of following the Translation tab's “To” language, and show English-only sentences when no Chinese pair exists.
- Phone **Settings** lists Capture, Notifications, Sources, Offline, API keys, and Audio on the device (Notifications is omitted in the Chrome preview). Notifications has three switches — incoming lookup, saved to notebook, scan finished — plus Allow / the OS notification screen. Shortcuts, hover, tray balloons, and PP-OCR packs stay on the desktop app. Lexicon rail jumps like desktop. Etymology waits for Wiktionary / Etymonline / Youdao, then shows source tabs; `mobile:dev` proxies those two sites so the browser preview is not stuck on Wiktionary. Wikipedia opens the article in the lookup pane; in-article links load the next page there. The notebook matches desktop: expandable rows, Recent / A–Z, Export / Import / Refresh. Android **Phevere** in the selection tray always opens the compact lookup card. Camera/photo opens Scan instead of stuffing OCR into the search box.
- Phone in-app messages use a Material 3 snackbar (Android / preview) or a top banner (iOS).
- Translation tab cards, language selects, and the swap button use the same rounded corners as lexicon result cards (12px / 8px).
- Wikipedia search and article cards use the same 12px corners as lexicon result cards.
- Lexicon **chips** (rail tabs and word-family banners) abbreviate only long POS (**adj.**, **adv.**, **prep.**, …). **Noun** and **verb** stay in full, and the part-of-speech heading in the main pane is always the full word.
- Lexicon sidebar uses **cards** for blocks and **vertical** section tabs. Below the headword, the rail and the definitions each fill the remaining pane and scroll on their own (10px rail scrollbar). Lexicon vs word family stay separate rounded cards.
- Toolbar 🔊 plays a **recorded** clip: Free Dictionary MP3 when that API answered, otherwise the Wiktionary/Commons file from `{{audio}}`. It does not read the spelling with the system voice. Clips are cached in the lookup pane, in memory, and on disk (`%APPDATA%\phevere\pronunciation-cache`). Every attached URL is prefetched in parallel as soon as lookup has them. A click before the URL arrives waits instead of toasting “No recorded pronunciation”.
- A speaker after each US / UK IPA chip speaks **that chip’s IPA** through a long-lived Windows System.Speech host (`<phoneme alphabet="ipa">`) or macOS `say` phonemes — not the headword and not the recorded clip.

### Fixed

- IPA no longer shows Wiktionary markup such as `<q:obsolete><ref:{{R:…` after the transcription.
- Android lookup had a double status-bar and nav-bar gap: the WebView sat below the system bars and CSS padded them again. The page now draws edge-to-edge and `--pv-inset-*` is applied once. Focusing search emptied the page because a tap on the box was treated as submit (`closest('[data-act]')` hit the search form) and the keyboard height was added on top of `adjustResize`. Taps only focus; Enter / Look up still search. The window pans instead of resizing.
- Camera capture failed with `No Activity found to handle Intent IMAGE_CAPTURE` on Android 11+ (package visibility). The manifest now declares that intent, and the app falls back to the photo picker if no camera app answers.
- Camera/photo OCR no longer dumps the whole transcript into the search box. **Scan** keeps the picture; words on it are selectable and look up in place.
- The lookup column could not scroll — only the white lexicon card did. The headword, IPA chips, tabs, and senses now move together.
- IPA chip speakers did nothing in the Android WebView (`speechSynthesis` is missing). Chips play that accent’s recorded clip when the source sent one, otherwise Android/iOS TTS of the headword.
- Phone Wikipedia in-pane links did nothing: Parsoid uses `./Title` hrefs, and the click handler was attached after `srcdoc` so it often missed `load`. Links now resolve against the article base, hash cites scroll in place, and File/Special URLs open in the browser.
- Phone etymology often showed only Wiktionary in the Chrome preview because Etymonline and Youdao are blocked by CORS. Youdao also has an HTTP fallback when HTTPS is empty.
- GitHub **release** workflow never parsed: the macOS asset-delete step had unindented Python, so every `main` push showed a 0-job failure and tag `v1.5.0` never got a GitHub Release. Mac now deletes/replaces assets with the same PowerShell as Windows.
- Windows Setup failed in Actions: NSIS `ShowInstDetails` sat inside a Function (`installer.nsh`). It is a compiler flag only; the InstFiles callback keeps `SetDetailsPrint both`.
- Toolbar 🔊 still showed “Fetching pronunciation…” on a second click: replay wiped the audio element, walked dead Free Dictionary URLs again (12s, failures uncached), and only prefetched the first URL. Replay now uses the in-pane clip; missing URLs are remembered; all recorded URLs prefetch together.
- Recorded clips went through Wikimedia `Special:FilePath` (2–3s per redirect here) and were sent to the popup as base64 data URLs even when already on disk. Playback now uses `upload.wikimedia.org` (MediaWiki filename case) and a `phevere-audio://` file protocol (host or path clip key, same on Windows and macOS). Lookups log `pronunciation audio` with source/ms.
- Sense numbers sat above the gloss (`align-items: start` plus a smaller number size). Number and first line of the definition now share a baseline.
- Hover / OCR lookup on HiDPI (and mixed-DPI) PCs opened the strip at a fixed workArea corner. Cursor and overlay points are Electron DIP; `placePopupNearPoint` no longer runs `screenToDipPoint` on them. Win32 UIA still uses physical pixels for word-at-point, but not as the popup anchor.
- Vertical rail chips only drew a hairline before the last sub-tab (`rotate(180deg)` flipped an inset shadow). Every sub-tab in a glued rail chip is now split by a 1px gap.
- IPA chip speakers failed on every word (`powershell.exe exit null`) because each retry killed the previous synthesizer. Toolbar 🔊 said “No recorded pronunciation” whenever Free Dictionary timed out, even when Wiktionary had a Commons recording.

## [1.5.0] - 2026-09-04

### Added

- Translation engines live in **Settings → Sources** (Auto / Google / MyMemory / Youdao / DeepL). The lookup Translation tab is a language pair (detect, swap, target) with speakers on source and target; preference is stored in `%APPDATA%\phevere\translation-prefs.json`.
- **Android / iOS (Capacitor v1):** shared TypeScript lookup core (`packages/core`), in-app search and notebook, Android Process Text, iOS Share + `phevere://lookup`. Sideload only — see [`docs/MOBILE.md`](docs/MOBILE.md).
- Windows **ARM64** NSIS Setup (`Phevere-Setup-<version>-arm64.exe`) on the same GitHub Release as x64. Built on `windows-11-arm` (UIA addon compiled natively). OCR uses sharp’s wasm fallback — sharp 0.33.5 has no `@img/sharp-win32-arm64`.
- GitHub **release** on `v*` builds **four** desktop artifacts onto one tag: Windows x64 + ARM64 Setup, macOS Intel + Apple Silicon DMG. Actions **workflow_dispatch** (`attach_tag`) replaces those same-named files (does not retag).
- macOS matches the Windows capture actions: **Read this window** (frontmost AX window bounds), **Now playing** (Music / Spotify), Screen Recording prompt (same one-click Settings jump as Accessibility), native traffic-light caption on notebook/Settings/clipboard, ⌘ keycaps, and Notification instead of a tray balloon.

### Changed

- Translation engines in **Settings → Sources** use the same row layout as dictionary sources, with formal names (Google Translate, MyMemory, Youdao, DeepL) and “No API key” / “API key required”.
- The Translation tab honours the From/To selects (listed languages) instead of flipping English→English into Chinese.
- Hover OCR is the same probe for every PP-OCR pack: DB `unclip_ratio` 2.2, locate on a line strip, recrop from glyph height (not the det-box width). PP-OCRv5’s tighter boxes no longer clip a mid-word square.
- Durable windows (notebook, Settings, clipboard) are opaque. On Windows they use the native caption overlay so resize is not a frameless Mica drag. On macOS they use `hiddenInset` traffic lights and hide the Windows-style HTML caption buttons.
- NSIS InstFiles page **names the step**: header subtitle, details list (extract / shortcuts / OCR models / Apps & Features). `prepare:installer` flips electron-builder’s `SetDetailsPrint none` so extract lines are visible.
- CI/dev bumps from Dependabot: Actions `checkout` / `setup-node` / `upload-artifact` v7, `action-gh-release` v3, `webpack-cli` 7, `ts-loader` 9.6, `maker-rpm` 7.11. TypeScript stays 5; `@typescript-eslint/eslint-plugin` stays 6 (PRs #7 and #9 closed — they need a matching parser / loader).

### Fixed

- Notebook cards showed `en → zh` on English dictionary saves because the default translation target was stored as the gloss language. The chip is now lemma → saved-sense language (`en → en` for Free Dictionary / Wiktionary).
- Popup 🌐 duplicated the Translation tab. The gear shrunk the window to 200px and left it there; clicking Lexicon did not restore height. Gear is an overlay; tabs restore the last expanded size.
- Empty translation results (Google 429, missing Youdao/DeepL keys) were frozen in the 24h lookup cache, so every chip looked dead. Failed translations are no longer cached; Google gtx cools down after 429 and falls through to a second Google URL plus MyMemory.
- Word-family **derived** chips showed `noun/verb/adj.` on almost every citation form (wink marks those as all three POS). Banners are a single precise tag (wiki or suffix) or omitted; phrase chips are not labelled “phrase”.
- Shrinking the main window felt stuck: notebook/Settings are opaque (no Mica), Windows uses `titleBarOverlay`, and live-resize drops blur/shadow/transitions.
- Hover OCR used a fixed 128×128 DIP square, so small type glued several words and large type clipped letters. The probe is now pack-agnostic: line strip, glyph-height recrop, gap-merge of letter boxes and tight v5 fragments. Gutenye’s hard-coded DB unclip is raised to 2.2 so rec is not cropped to v5’s tight polygon.
- `npm start` failed to compile: a stray brace in Settings CSS, and a missing macOS koffi binding after the mouse-down hover change.
- Select-to-lookup ignored Phevere’s own windows (Settings and the notebook): UIA/AX skipped this process, and Settings was a modal child of the main window. Lookup now uses the same capture path inside the app; tray **Settings** no longer raises the main window. On Windows, a tray right-click no longer also fires the left-click “open notebook” handler.
- Hover OCR no longer runs after a live text selection (or while the mouse button is down). Selection wins.
- macOS hover / region OCR no longer fails silently when Screen Recording is off: empty captures open the same Settings jump as Accessibility.
- Main-window **Recent / A–Z** no longer collapses to a single letter when narrowing; those controls do not shrink, and the window has a minimum width.
- **Installed** image OCR (hover or Ctrl+Shift+O) inserted spaces between letters (`centrific` → `c e n t r i f i c`). Packaged `desktopCapturer` thumbnails often do not match the requested pixel size; crop now uses the bitmap’s real size vs display DIP, and glyph-spaced CTC output is glued. Dev `npm start` was masking this via Python RapidOCR. Selectable UIA text was never affected.
- Switching OCR to **PP-OCRv5** produced no text: the pack used PP-OCRv4 `ppocr_keys_v1.txt` (~6.6k classes) against a ~18k-class rec model. It now downloads RapidOCR’s `ppocrv5_dict.txt` and re-fetches if an old short dict is still on disk.
- macOS shortcut monitor mode opened a lookup on every selection: `isAcceleratorPhysicallyHeld` always returned true off Windows. It now uses `CGEventSourceKeyState` (same hold-while-select / select-then-trigger as Windows). `CommandOrControl` is Command on Mac.
- macOS Dock used the default Electron atom: packager needs `packaging/icon.icns`, and `npm start` now calls `app.dock.setIcon` (BrowserWindow `icon` does not set the Dock).
- macOS menu-bar **P**: left-click only shows the main window. The context menu is right-click only (`setContextMenu` on darwin was also opening it on left-click).
- macOS lookup when `AXSelectedText` is empty (Chrome, Cursor, Safari, …): after a drag or double-click, try Accessibility (including Chromium text-markers after `AXManualAccessibility`), then browser AppleScript `getSelection()`, then silent Cmd+C with clipboard restore. Password fields are skipped.
- Embedded OCR failed to start on macOS: `@gutenye/ocr-node` is ESM, so webpack `require()` threw; load it with dynamic `import()` of the real `node_modules` file (webpack’s `require.resolve` of the external was the bare package name). Python fallback looks for `python3`, not only `python`. Pin `onnxruntime-node` to 1.23.2 so Intel Macs still get a `darwin/x64` native binary (1.24+ ships arm64 only).
- Hover lookup used a whole OCR line instead of the word under the cursor: Gutenye returns a `box` polygon (not `frame`), so line bounds were dropped. Map those boxes and pick the Latin word / CJK character at the pointer.
- `npm start`: one Ctrl+C quits the app. `before-quit` used to `preventDefault()` and wait on teardown, so Electron stayed alive after Forge had already handled the signal.
- Packaged builds omitted webpack externals (`onnxruntime-node`, `sharp`, `@gutenye`), so OCR only worked under `npm start`. The Mac zip / Windows Setup now keep and unpack those natives for the target arch; installed OCR never uses the user's Python. CI packages darwin x64 (`macos-15-intel`) and arm64 (`macos-latest`) and checks the payload.

### Notes for users

- **Windows x64** — `Phevere-Setup-1.5.0-x64.exe` from [GitHub Releases](https://github.com/thd2020/phevere/releases/tag/v1.5.0) (Actions). Unsigned; SmartScreen may warn. Signing options: [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md).
- **Windows ARM64** — `Phevere-Setup-1.5.0-arm64.exe` on the same release (Snapdragon / Windows 11 ARM). Unsigned. OCR uses sharp wasm (no native win32-arm64 at 0.33.5).
- **macOS Intel** — `Phevere-1.5.0-darwin-x64.dmg` from the same Actions run (`macos-15-intel`). Unsigned; Gatekeeper will warn (not notarized). Drag Phevere into Applications. Enable **Accessibility** and **Screen Recording** when asked (tray items open those panes).
- **macOS Apple Silicon** — `Phevere-1.5.0-darwin-arm64.dmg` from the same Actions run (`macos-latest`). Same Gatekeeper note.
- Run elevated on Windows when you need UIAutomation across elevated / protected apps.

## [1.4.1] - 2026-08-21

### Added

- Draft **macOS** selection backend (Accessibility + CGEvent tap) on the same `{ text, x, y }` path as Windows UIA. Compile on a Mac (`npm run build-native`). Untrusted Accessibility opens a one-click **Open Accessibility Settings** dialog (and a tray item); lookup starts when the toggle is on. See [`docs/MACOS_SELECTION.md`](docs/MACOS_SELECTION.md). Unsigned Intel + Apple Silicon DMGs can be attached to the GitHub Release (Gatekeeper still warns).
- Lexicon **Phrases** row in Word family: multi-word derived terms (idioms, collocations) sit apart from single-word derivatives, with phrase/idiom banners instead of fake POS tags.

### Fixed

- Windows lookup in Chromium chat panels (Cursor **agent output**, some VS Code webviews): empty `TextSelectionChanged` events no longer count as “UIA already handled it.” After a drag/double-click, Windows now follows the same idea as macOS: (1) TextPattern on the focused/point element, (2) poke Chromium’s UIA tree (`WM_GETOBJECT`) and retry, then (5) silent Ctrl+C with clipboard restore. There is no AppleScript analog (macOS step 3); Cursor would not use that step on Mac either. Password fields are skipped. Editor, terminal, and chat input were already fine (real TextPattern).
- `npm start` on macOS/Linux no longer dies on Windows-only `chcp 65001` (UTF-8 console is still set on Windows).
- Expanded lookup width hugs the Back/Forward + tab row (no leftover strip after Etymology). Horizontal resize works again; the previous min-size used the window’s own width and locked it. Narrowing the window wraps Lexicon / Translation / Wikipedia / Etymology onto extra rows instead of clipping them.
- `npm install` hanging on Electron’s silent GitHub/`got` fetch: `.npmrc` `electron_mirror` plus `scripts/ensure-electron.js` (curl). `npm start` restores `path.txt`/`dist` after a Ctrl+C’d install.
- `npm start` on Windows no longer dies with `spawn scripts/npm-lifecycle-shell ENOENT` (custom `script-shell` is not cross-platform; CreateProcess does not apply PATHEXT).
- Word-family **Derived** chips now get POS banners (suffix + citation-form guess). Multi-word items move to **Phrases**.
- macOS drag/double-click lookup: event tap + AX observer run on Electron’s main run loop (a private thread never delivered mouse or AX events). Switching apps rebinds the observer. The tap is mouse-only, so Input Monitoring is not required.
- macOS AX addon compiles on the current SDK (`AXValueType` vs `kAXValueCGRectType` UInt32).

### Notes for users

- **Windows Setup rebuilt 2026-08-27** on this same tag (filenames unchanged; Mac DMGs not replaced). x64 + ARM64 now include Cursor **agent output** lookup (empty Chromium UIA no longer blocks the 1→2→5 capture chain) and packaged OCR natives.
- **Windows x64** — `Phevere-Setup-1.4.1-x64.exe` from [GitHub Releases](https://github.com/thd2020/phevere/releases/tag/v1.4.1) (Actions). SHA-256 `7B197F30…4AFE3C`. Still unsigned; SmartScreen may warn. Signing options: [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md).
- **Windows ARM64** — `Phevere-Setup-1.4.1-arm64.exe` on the same release (Snapdragon / Windows 11 ARM). SHA-256 `A5ED5894…D92D28`. Unsigned. OCR uses sharp wasm (no native win32-arm64 at 0.33.5).
- **macOS** — unsigned `Phevere-1.4.1-darwin-x64.dmg` (Intel, SHA-256 `B7AB0F50…B56D585`) and `Phevere-1.4.1-darwin-arm64.dmg` (Apple Silicon, SHA-256 `94405049…2AFD3B8`) on the same release (rebuilt 2026-08-25: custom Dock icon; menu-bar **P** right-click menu; shortcut mode holds the trigger). Drag Phevere into Applications. Gatekeeper will warn (not notarized).
- Run elevated when you need UIAutomation across elevated / protected apps.

## [1.4.0] - 2026-08-19

### Added

- Lexicon **Word family** section: inflections, alternative/derived/related terms, affixes, and roots as in-app links (Wiktionary headings + affix templates). Related forms are not mixed into definitions. POS labels such as “verb form” sit as small banners on the chip, not as fake headwords.
- Dictionary lookup **Back / Forward** on the lexicon tab, plus mouse extra buttons (and Alt+← / Alt+→).

### Changed

- Lookup policy lives in one module (`lookup-policy.ts`): exact form first, lemma only if every source is empty, one grammatical form-of test, notebook save key is the queried form. IPA, etymology, and family share a single Wiktionary wikitext fetch.
- Dictionary tab: headword, senses, examples, synonyms/antonyms, and word family are separate cards. The old “N senses · Source · Source” title line is gone (POS headings and per-sense source badges remain). Pronounce / Search Web on those cards are omitted — they already live on the toolstrip.
- Etymology tab matches the same paper cards (no black title bar, nested grey panel, or extra “Etymology” heading). Translation cards no longer duplicate the toolstrip Web button.

### Fixed

- Inflected lookups such as **tantalizing** no longer mix in verb senses, IPA, or notebook saves for the lemma **tantalize**. The card, pronunciation, and Save stay on the exact form; the headword is used only when every source has no sense for that form. Wiki form-of links still look up the linked word on their own.
- A quick second selection (wrong word, then the right one) follows the latest text: the in-flight strip is retargeted, `popup-text` is not dropped while the page is still loading, a late `getLastSelection` cannot overwrite a newer word, and a distinct correction is not held behind another 500ms native debounce.
- Following a word-family chip or form-of link no longer traps you with no way back; Chromium page history no longer swallows mouse extra keys.
- Expanded lookup grows to fit **Back / Forward** plus all tabs, so Etymology is not clipped off the 400px row.

### Notes for users

- **Windows x64** — `Phevere-Setup-1.4.0-x64.exe` from [GitHub Releases](https://github.com/thd2020/phevere/releases/tag/v1.4.0) (Actions). SHA-256 `9822C0A9…560AF8`. Still unsigned; SmartScreen may warn. Signing options: [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md).
- Run elevated when you need UIAutomation across elevated / protected apps.

## [1.3.1] - 2026-08-19

### Changed

- Installer wizard uses **2×** sidebar/header bitmaps, **white** page paper (not XP grey), and HALFTONE stretch so Win11 HiDPI no longer pixelates the P-mark pane.

### Fixed

- **Quit Phevere** (tray / taskbar menu) no longer races `app.quit()` when windows close — UIA, OCR, and sql.js tear down first so Chromium helper processes do not linger.
- Windows 11 **dark app theme** no longer paints Mica/Acrylic near-black under dark text — Phevere stays on its light paper UI.

### Notes for users

- **Windows x64** — `Phevere-Setup-1.3.1-x64.exe` from [GitHub Releases](https://github.com/thd2020/phevere/releases/tag/v1.3.1) (Actions). Still unsigned; SmartScreen may warn. Signing options: [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md).
- Run elevated when you need UIAutomation across elevated / protected apps.

## [1.3.0] - 2026-08-18

### Added

- Notebook: **Recent / A–Z** sort, A–Z index scrubber (tap or slide, large letter HUD), and **Export / Import** (JSON or CSV).
- GitHub Actions: `ci.yml` packages on PR/`main`; `release.yml` builds unsigned NSIS Setup on `v*` tags, uploads the GitHub Release, and attests the exe. Optional `CSC_LINK` / `CSC_KEY_PASSWORD` secrets sign the installer.

### Changed

- Settings window opens at **800×600** (same as the main window), with tighter grouped rows and a centered switch thumb.
- Settings shortcuts render as **keycap chips**, not a monospace string.
- Main window content uses the full width; notebook/recent lists leave a gap before the window scrollbar.
- App titlebar uses the stylized **P** mark (not the old magnifying glass).
- Open from notebook / recent uses the same floating lookup as a selection (always-on-top, click outside to close).
- Inflected lookups deinflect once (wink + content-namespace “plural of X”) instead of following the first Wiktionary `/wiki/` link.

### Fixed

- Installer sidebar no longer cover-crops the old splash PNG (blur/warp). Inner wizard pages use a light header bitmap instead of a navy slab that read as black.
- Expanding a notebook card and selecting definition text no longer collapses the card — only the lemma / IPA / POS / timestamp row toggles.
- Etymology / translation tabs show a progress bar while sources are still in flight; a 502 from Etymonline no longer discards Wiktionary etymology.
- Looking up **tribulations** no longer jumps to **Appendix:Glossary**.
- Unsigned GitHub Actions tag builds no longer fail Authenticode when `CSC_LINK` is an empty secret.

### Notes for users

- **Windows x64** — `Phevere-Setup-1.3.0-x64.exe` from [GitHub Releases](https://github.com/thd2020/phevere/releases/tag/v1.3.0) (built by Actions). Unsigned unless `CSC_LINK` is set; SmartScreen may warn.
- Run elevated when you need UIAutomation across elevated / protected apps.

## [1.2.2] - 2026-08-18

### Added

- **Offline dictionary catalog** — Settings → Offline can download Princeton WordNet 3.1 (en→en), Webster’s Unabridged 1913 via GNU GCIDE (en→en), CC-CEDICT (zh→en), and FreeDict English–Chinese (en→zh). Living Oxford / Collegiate Webster / Collins stay API or licensed-JSON only (publisher copyright).
- Per-source lookup cache (timeouts retry) and US + UK IPA when sources provide them.
- Vocab notebook: IPA + play control, search, listed above Recent selections; empty cards fill from a **background lookup queue**.
- Win11/Fluent window chrome (Mica/Acrylic where the OS supports it); sticky titlebars; Authenticode hook via `CSC_LINK`.

### Changed

- Offline pack import uses batched SQLite writes; live lookup overlaps local packs with network APIs.
- First paint returns local-pack defs in ~0.5s instead of waiting out translation/etymology timeouts (~7.5s).
- Lookup panel inset (36px toolbar, 12px results) so chrome does not clip the lemma.
- Select-to-lookup in the main window or an open lookup matches selecting elsewhere: a **toolstrip** appears. An expanded lookup stays put; a second strip opens beside it.

### Fixed

- Packaged launch `Cannot find module 'node-fetch'` — webpack now bundles it into `app.asar`.
- Hung / frozen lookup: `node-fetch` timeouts, safe `Promise.race`, sql.js off the main thread, UIA native addon out of preload, popup webpack no longer pulled in main-window CSS, duplicate `const` that stopped the popup script from parsing.
- Heart icon on the collapsed strip no longer waits forever; lemma saves immediately and the notebook fills later.
- Offline Webster/WordNet hits were dropped when online sources hung, then timeout stubs were cached for 24h.
- Notebook Open rows stayed empty; POS tags like GCIDE `n` / `v. t.` now merge with WordNet / Free Dictionary.
- Punctuated selections (`hello,`) no longer flicker to “no definition”; worse updates cannot replace a better card.
- Looking up `fluff` jumped to `roleplaying` (greedy Wiktionary “a form of”). Grammatical form-of only, and only when that is the first sense.
- Notebook “IPA pending” after the panel already had pronunciation; recovered IPA is patched into existing rows.
- In-app selection ignored Off/Shortcut monitor mode.
- Installer left pane blank (PNG bytes named `.bmp`); `MUI_BGCOLOR already defined`; several `make:win` TypeScript compile breaks.
- Tray Exit left a ghost icon and leftover processes; Etymonline entries truncated at OpenGraph “…”.
- Window Close stayed reachable while content scrolls.

### Notes for users

- **Windows x64** — install with `Phevere-Setup-1.2.2-x64.exe`.
- If an older Phevere folder remains with no Apps entry, run `scripts/remove-ghost-phevere.ps1` then reinstall.
- Run elevated when you need UIAutomation across elevated / protected apps.
- Unsigned builds may trigger SmartScreen until an OV/EV `CSC_LINK` cert is used.

## [1.2.1] - 2026-08-12

### Added

- **Native ONNX OCR** — embedded PP-OCRv4 via `onnxruntime-node` / `@gutenye/ocr-node` (Python RapidOCR is last-resort only).
- **Pluggable OCR packs** — Settings: bundled models, download PP-OCRv5, or a custom model folder.
- **Wikipedia in-popup reader** — article opens in an in-panel `<webview>` (toolbar W removed).
- **Etymology source tabs** — vertical sidebar for multi-source etymology.
- **Installer components** — optional desktop / Start menu shortcuts and OCR models; ink/teal/ember icon and wizard art.
- **Uninstall UX** — Start menu “Uninstall Phevere”, reinforced Apps & Features entry; `scripts/remove-ghost-phevere.ps1` for stuck Program Files installs.

### Changed

- Default install path **`Program Files\Phevere`** (no author parent folder); publisher **thd2020**.
- Single Setup.exe bundles OCR models again (uncheck OCR to omit from disk).
- Vocab notebook: dictionary-style rows, collapse-on-click, lemma-safe heart save.
- Translation / etymology / notebook UI polish; quieter trial-sounding copy.
- `npm run make:win` uses npmmirror Electron mirrors by default (avoids `github.com` timeouts).

### Fixed

- Packaged vocabulary notebook wipe / sticky save failures (atomic SQLite persist, no save-on-open race).
- Missing IPA after plural→lemma pivot (e.g. vagaries / vicissitudes).
- Tray Quit leaving orphan OCR / UIA processes.
- Popup load failures on some PCs (retry + optional `.disable-gpu`).
- Packaged `sql-asm.js` resolve; OCR hover/region; CC-CEDICT lookup; shortcut hover gate; Etymonline marketing blurb; in-popup select-to-lookup / lemma links.

### Notes for users

- **Windows x64** — install with `Phevere-Setup-1.2.1-x64.exe`.
- If an older Phevere folder remains with no Apps entry, run `scripts/remove-ghost-phevere.ps1` then reinstall.
- Run elevated when you need UIAutomation across elevated / protected apps.
- Unsigned builds may trigger SmartScreen until code signing is configured.

## [1.2.0] - 2026-08-07

### Added

- **Vocabulary notebook** — local SQLite (sql.js) Anki-light store; red heart on the popup toolstrip to save/unsave the current lemma.
- **Offline dictionary packs** — Settings → Offline: consent download of CC-CEDICT, or import JSON/JSONL / CEDICT text; optional `resources/seed/` import on first run.
- **Definition sense merging** — near-identical glosses across Datamuse / Free Dictionary / Wiktionary collapse into one sense with multi-source cite badges.
- **NSIS Setup.exe** — customizable electron-builder installer (directory chooser, shortcuts, branding) as the primary Windows distributable.

### Changed

- **Smart source routing** — CJK → Youdao / CEDICT / offline; Latin → Free Dictionary / Wiktionary / Datamuse; translation prefers Youdao (CJK) or DeepL (Latin) when keyed.
- **Translation tab** — confidence score hidden; tighter type and action sizing.
- **Wikipedia tab** — thumbnails fetched in the main process as data URLs; REST summary uses page titles (fixes broken image placeholders).
- **Packaging** — `sql.js` / `sql-wasm.wasm` and seed folder shipped with the installer; live DB remains under `%APPDATA%`.

### Fixed

- Dual-monitor popup placement (nearest display workArea).
- NSIS build: proper `.ico` icons; installer.nsh comment that NSIS treated as a fatal warning.
- `electron` kept only in `devDependencies` for electron-builder metadata checks.

### Notes for users

- **Windows x64** — install with `Phevere-Setup-1.2.0-x64.exe` (assisted wizard).
- Run elevated when you need UIAutomation across elevated / protected apps.
- Unsigned builds may trigger SmartScreen until code signing is configured.

## [1.1.0] - 2026-07-24

### Added

- Multi-pattern UIA fallback chain (DirectUI / MSAA / edit controls).
- Synthetic copy mouse fallback for canvas PDF readers.
- Non-destructive clipboard bridge during synthetic copy.

### Changed

- Proxy-aware `net.fetch` for dictionary / translation pipelines.

## [1.0.0] - 2026-03-24

### Added

- Electron app with dictionary popup, Google Translate integration, Wikipedia and search links, clipboard history.
- Windows text selection via Microsoft UI Automation (native addon) with debounced selection handling.
- Global shortcuts, monitor/selection modes, and settings UI (including shortcut trigger behavior).
- Windows installer as **WiX MSI** (`npm run make` / `make:win`); see `PACKAGING.md`.
- `koffi`-based physical key state for shortcut mode; `asarUnpack` so the addon loads in packaged builds.

### Changed

- Replaced Squirrel with WiX MSI for Windows distribution.

### Notes for users

- **Windows x64**, **run elevated** when using UIAutomation across the desktop (see README).
- Install from the release asset; no separate Node.js install required.

[Unreleased]: https://github.com/thd2020/phevere/compare/v4.1.0...HEAD
[4.1.0]: https://github.com/thd2020/phevere/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/thd2020/phevere/compare/v3.0.0...v4.0.0
[3.0.0]: https://github.com/thd2020/phevere/compare/v2.3.0...v3.0.0
[2.3.0]: https://github.com/thd2020/phevere/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/thd2020/phevere/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/thd2020/phevere/releases/tag/v2.1.0
[2.0.0]: https://github.com/thd2020/phevere/releases/tag/v2.0.0
[1.5.0]: https://github.com/thd2020/phevere/releases/tag/v1.5.0
[1.4.1]: https://github.com/thd2020/phevere/releases/tag/v1.4.1
[1.4.0]: https://github.com/thd2020/phevere/releases/tag/v1.4.0
[1.3.1]: https://github.com/thd2020/phevere/releases/tag/v1.3.1
[1.3.0]: https://github.com/thd2020/phevere/releases/tag/v1.3.0
[1.2.2]: https://github.com/thd2020/phevere/releases/tag/v1.2.2
[1.2.1]: https://github.com/thd2020/phevere/releases/tag/v1.2.1
[1.2.0]: https://github.com/thd2020/phevere/releases/tag/v1.2.0
[1.1.0]: https://github.com/thd2020/phevere/releases/tag/v1.1.0
[1.0.0]: https://github.com/thd2020/phevere/releases/tag/v1.0.0
