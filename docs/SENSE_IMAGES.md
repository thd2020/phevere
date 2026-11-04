# Sense pictures

2026-11-04. This memo records how dictionaries and related projects decide which senses get a picture, how many pictures an entry carries and when it carries none, and the rules Phevere follows as a result. The code is `packages/core/src/sense-images.ts`, which both the desktop lookup and the phone use, and the notebook cards call the same module through `fetchWordImage`. The offline checks are in `scripts/test-sense-images.js`, which replays Wikimedia responses saved under `scripts/fixtures/`.

## Why this memo exists

Two complaints came in. Many words, such as equilibrium, showed no picture at all, and some words showed an unrelated picture when a proper one existed, or none on a major sense: crane had a bird but no lifting machine. The module had been tuned word by word since 2026-11-02, so I looked up how lexicographers and the Wikimedia projects settle these questions before changing it again.

## What established practice says

Learner's dictionaries illustrate concrete nouns first, sometimes verbs and adjectives, and treat abstract nouns as outside the picturable range. Dziemianko's 2022 study in ReCALL states this directly, citing Klosa and Stein ([doi:10.1017/S0958344021000264](https://doi.org/10.1017/S0958344021000264)), and Biesaga's survey of the Oxford Advanced Learner's Dictionary adds that a picture must look like the real object, be easy to read and leave out what does not matter ([EURALEX 2016](http://euralex.org/wp-content/themes/euralex/proceedings/Euralex%202016/euralex_2016_007_p99.pdf)). The picture sits beside the definition it shows. Longman's entry for [crane](https://www.ldoceonline.com/dictionary/crane) has one picture, on the machine sense, and its entry for [equilibrium](https://www.ldoceonline.com/dictionary/equilibrium) has none.

Wiktionary's image policy says images "should be significant and relevant, not primarily decorative", and gives the `{{senseno}}` template to mark which sense of a word a picture shows ([Wiktionary:Images](https://en.wiktionary.org/wiki/Wiktionary:Images)). Its entry layout rules keep out pictures of people tied only to a word's coinage, so no Orwell on "newspeak" ([Wiktionary:Entry layout](https://en.wiktionary.org/wiki/Wiktionary:Entry_layout)).

Wikidata's image property P18 holds one representative image of an item, which its usage notes describe as "representative, unambiguous, and high quality" ([Property talk:P18](https://www.wikidata.org/wiki/Property_talk:P18)). A lexeme's sense can point to the item it means through P5137, "item for this sense" ([Property:P5137](https://www.wikidata.org/wiki/Property:P5137)). Free-text file search has no such link: it matches spelling. ImageNet drew its images for WordNet's noun synsets only, and a 2020 audit of its person categories found most of them could not be pictured at all; of 1,239 rated synsets only 158 scored 4 or more for imageability ([Yang et al. 2020](https://arxiv.org/abs/1912.07726)).

Anki users describe a weak picture on an abstract card as one you keep failing and recommend example sentences instead ([Anki forum](https://forums.ankiweb.net/t/pros-cons-of-images/41408)); Migaku's guide says to skip the image for abstract words ([Migaku](https://migaku.com/blog/japanese/anki-language-learning-guide)), and Fluent Forever teaches words like "to seem" from sentences rather than pictures ([Fluent Forever](https://blog.fluent-forever.com/?p=483)). One study did find that pictures helped learners remember abstract second-language words ([Farley, Ramonda and Liu 2012](https://repositori.uvic-ucc.cat/handle/10854/6853)), so a well-chosen picture is still worth showing when one exists. I found no published rule on diagrams. Showing a diagram only for a technical sense, such as chemical equilibrium, is my own reading of the sources above.

On density, none of the dictionaries I looked at puts a picture on every sense or every entry. Wikidata keeps one best image per item. Nothing I found sets a number per entry, so Phevere keeps its earlier cap of three.

## The rules Phevere follows

| Rule | Where in the code | Source |
|---|---|---|
| A picture belongs to one sense and sits beside it. | `fetchSenseImages` returns one slot per sense | Wiktionary:Images, Longman's crane |
| Only noun senses with a gloss and no slang or figurative label get a picture from an article. Wiktionary's own sense pictures may illustrate any part of speech, because editors placed them. | `isPicturableNounSense`, `matchWiktionaryImages` | Dziemianko 2022, Biesaga 2016 |
| The picture comes from a source about that sense: a Wiktionary picture tied to it, an article that names the word ("Crane (machine)", "Chemical equilibrium"), or that article's Wikidata item. | `matchSenseArticles`, `buildDisambiguationLinksUrl`, `buildWikidataImagesUrl` | P18, P5137 |
| An article goes to a sense only when each is the other's best fit. A sense whose article is taken, or has no picture, stays bare instead of borrowing a weaker match. | `matchSenseArticles` | Wiktionary:Images |
| A compound title names a kind of the thing, so "Central bank" cannot illustrate "a device used to store coins" on one shared word. | `needed` in `matchSenseArticles` | Biesaga 2016 |
| The article titled with the word alone may only illustrate a concrete sense. | `opts.concrete` in `matchSenseArticles` | Dziemianko 2022 |
| No portrait of a named person stands for a word's meaning. | `isNamedPersonPicture` | Wiktionary:Entry layout |
| A Commons file search hit must share a word with the gloss, ignoring Commons bookkeeping categories. | `rankCommonsFiles` with `needGloss`, `topicCategories` | ImageNet audit, Anki forum |
| Function words (however, of, they) get no search at all. | `onlyFunctionWords` | Migaku, Fluent Forever |
| At most three pictures per lookup, earliest senses first, never the same file twice. | `resolveSenseImages` | Wikidata's one image per item |
| When no source fits, there is no picture. | the whole module | Wiktionary:Images, Anki forum |

## What crane, equilibrium, however and notion get

Crane takes both pictures from the articles its disambiguation page lists. Equilibrium takes two diagrams, one for the chemistry sense and one for the mechanics sense, and nothing for "the condition of a system in which competing influences are balanced" or "mental balance".

<p align="center">
<img src="https://thumb.wikimedia.org/wikipedia/commons/thumb/6/67/Antigone_canadensis_353731480_%28cropped%29.jpg/330px-Antigone_canadensis_353731480_%28cropped%29.jpg" width="160" alt="Photo of a sandhill crane, the picture for crane's bird sense">
<img src="https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4a/Crane_machine_slewing_platform.svg/330px-Crane_machine_slewing_platform.svg.png" width="120" alt="Drawing of a lifting crane on a slewing platform, the picture for crane's machine sense">
<img src="https://thumb.wikimedia.org/wikipedia/commons/thumb/b/be/Diag_eq.svg/330px-Diag_eq.svg.png" width="130" alt="Diagram from the chemical equilibrium item, the picture for equilibrium in chemistry">
<img src="https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fc/WeightNormal.svg/330px-WeightNormal.svg.png" width="130" alt="Diagram of weight and normal force, the picture for equilibrium in mechanics">
</p>
<p align="center"><sub>From left: crane (bird), from <a href="https://en.wikipedia.org/wiki/Crane_(bird)">Crane (bird)</a>, by Zygy, CC0; crane (machine), from <a href="https://en.wikipedia.org/wiki/Crane_(machine)">Crane (machine)</a>, by Wilfredo R. Rodriguez H., CC BY-SA 3.0; equilibrium in chemistry, the P18 of <a href="https://www.wikidata.org/wiki/Q189520">chemical equilibrium</a>, by Maghémite, CC BY-SA 3.0; equilibrium in mechanics, from <a href="https://en.wikipedia.org/wiki/Mechanical_equilibrium">Mechanical equilibrium</a>, public domain. All via Wikimedia Commons.</sub></p>

However gets no picture. Notion gets one, a photo of sewing notions on the sewing sense ("any small article used in sewing and haberdashery"), from the article "Notions (sewing)". A notebook card for notion in its "idea" sense used to show "The Mistaken Notion", a Rowlandson caricature found by file name; it now shows nothing, because no Commons hit shares a word with the gloss once categories such as "Artworks with known accession number" are left out.

Serendipity lost its picture. The article's lead image is a portrait of Horace Walpole, who coined the word, and nothing else fits.

## How a lookup finds its pictures

An English lookup makes its requests in at most three rounds, at most three requests at a time as Wikimedia's [rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits) ask.

1. Side by side: the Wiktionary entry's wikitext, one Wikipedia query for the articles titled with the word and its derived nouns, and the articles the word's disambiguation page links to, with their lead images, short descriptions and Wikidata items. The third request is skipped when the word has no noun sense.
2. Side by side, only when needed: Wikidata's page images for matched articles that have no free lead image, and, for a word with no disambiguation page, a Wikipedia search for up to two concrete senses still bare.
3. One Commons `imageinfo` call for every chosen file, which brings the 330 px thumbnail, its size, the author, the licence and the categories.

The 330 px thumbnail is one of Wikimedia's standard sizes and covers the phone's figure, which is at most 116 CSS pixels wide, at three device pixels per CSS pixel. Only when no sense gets a picture does the whole-word fallback run, as described at the top of the module.

Requests per lookup, measured live on 2026-11-04 with each word's full Wiktionary sense list:

| Word | Before: requests, rounds | After: requests, rounds | Pictures after |
|---|---|---|---|
| crane | 5, 3 | 4, 2 | bird, machine |
| equilibrium | 6, 5 | 5, 3 | chemistry, mechanics |
| notion | 6, 4 | 4, 2 | sewing notions |
| however | 4, 3 | 2, 1 | none |

From the machine I tested on, in China, a single Wikimedia request took between half a second and seven seconds, so a round saved matters more than a request saved. A word that only gets the whole-word fallback, such as happiness, now makes four requests instead of three, because the disambiguation links go out with the first round, but it still finishes in two rounds.

## What this does not do

Wikidata lexemes were not used. Their senses do link to items (the English noun crane, [L22641](https://www.wikidata.org/wiki/Lexeme:L22641), links its bird and machine senses), but reaching them takes a lexeme search and then an entity request before any picture can be looked up, two extra rounds, and equilibrium's lexeme has a single sense. The disambiguation page reaches the same items in the first round.

The Wiktionary REST API drops sense labels such as "(chemistry)", so the module cannot use them to choose between "Chemical equilibrium" and "Thermodynamic equilibrium"; it relies on the words of the gloss.

The fixtures pin the behaviour on the responses recorded on 2026-11-02 to 2026-11-04. Wikipedia and Wikidata editors change lead images, descriptions and disambiguation pages, so a live lookup can differ from the tests.
