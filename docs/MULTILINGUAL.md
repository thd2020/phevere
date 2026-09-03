# Multilingual dictionary & TTS — roadmap

## Dictionary (definitions, not only translation)

**What the app uses today**

| Layer | Role |
|--------|------|
| **Free Dictionary API** (`dictionaryapi.dev`) | Word entries for many languages (`/entries/{lang}/{word}`) — already wired with language map. |
| **English Wiktionary REST** | One HTTP host; response is **keyed by language** (`ja`, `fr`, `de`, …). Good for lemmas that exist on en.wiktionary. |
| **Translation** | Free Google then MyMemory (engine chosen in Settings → Sources). Youdao / DeepL if you add keys. |

**Bug fixed (historical):** For JA/KO/ZH, the parallel aggregator **skipped** Free Dictionary + Wiktionary entirely, so users only saw **translation**. Those sources are now **always** attempted using the **detected source language**.

**There is no single “one API” for every language pair at dictionary depth.** Realistic upgrades:

1. **Keep Wiktionary + Free Dictionary** as the default free stack (done).
2. **Optional locale Wiktionary** (`ja.wiktionary.org` REST) for better Japanese-only lemmas — extra implementation.
3. **Commercial “all-in-one”** options (keys + billing): **Oxford**, **Collins**, **WordsAPI**, **DeepL** (glosses), **Azure Dictionary** / **Google Cloud Translation** (not full monolingual dictionaries for all pairs).
4. **Language-specific** free APIs when you want higher quality: e.g. **Jisho** (unofficial patterns), **Korean National Institute** datasets, etc.
5. **Offline catalog** (Settings → Offline): Princeton WordNet 3.1 and Webster 1913/GCIDE for en→en; CC-CEDICT for zh→en; FreeDict eng–zho for en→zh. Living Oxford / Collegiate Webster / Collins are not redistributable as dumps.

## Pronunciation (speaker)

**Root causes addressed**

1. Buttons called `playAudio(word, 'en')` so **Japanese/Korean text was requested as English**.
2. When no OS voice matched, the code **forced English voice + English lang** — useless for CJK and often **silent**.
3. **Script order:** Kana/Korean/Han detection reordered so Kana is not classified as Chinese first.

**Still required on Windows:** Install **speech language packs** (Settings → Time & language → Language → add Japanese/Korean → Speech). Without voices, Chromium may still attempt `utterance.lang = 'ja-JP'` with `voice = null`; quality varies.

**Optional next step:** Fallback TTS via **Google Translate TTS** or **Azure TTS** (network, API keys) when `speechSynthesis` has no voice.
