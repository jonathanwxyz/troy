# Iliad data

`iliad.sqlite` holds the Iliad with Theodorus Gaza's paraphrase, line by line, and the
Perseus treebank (lemma, morphology, dependency parse) word by word. `iliad.tsv` is a
plain-text copy of the `verses` table.

## Rebuilding

Run in this order; each script replaces only its own tables. Pages are cached in `raw/`.

1. `scripts/parse_iliad.py` → `verses` (+ `iliad.tsv`), from vasilestancu.ro, and `books`
   from `book_titles.tsv`
2. `scripts/import_treebank.py` → `sentences`, `tokens`, from Perseus AGDT 2.1
3. `scripts/align_words.py` → `word_links`
4. `scripts/import_paraphrase_alignment.py` → `paraphrase_links`, from the hand-made
   files in `paraphrase_alignment/` (`-v` lists Gaza's unaligned additions)

5. `scripts/import_shortdefs.py` → `shortdefs`, `lemma_defs` (English short definitions;
   after step 2)
6. `scripts/import_translation.py` → `translation_passages` (Murray's English), then
   `scripts/import_translation_lines.py` → `translation_lines` (split per line, from
   `translation_lines/murray_book01.txt`)
7. `.venv/bin/python scripts/align_audio.py --book 1 --audio recordings/iliad01.opus`
   → `verse_timings` (setup in `requirements-audio.txt`; recordings stay local, see
   `.gitignore`)

`scripts/compare_alignments.py REF CANDIDATE [-v]` scores one alignment file against
another (link precision/recall, per-word agreement).

## Tables

- **verses** `(book, line)`: `homer` (site text), `paraphrase` (Gaza; NULL where he has
  none), `site_line` (the number the site shows).
- **books** `book`: `title`, the spoken intro read before line 1 of that book's
  recording (Book 1: Ὁμήρου Ἰλιάς. Ῥαψῳδία Α.). Edit `book_titles.tsv` to add more.
- **tokens** `seq`: one row per treebank word in reading order, with `book, line`,
  `form, lemma, postag` and the tag decoded (`pos, person, number, tense, mood, voice,
  gender, gram_case, degree`), plus `head, relation` (parse) and `artificial`.
- **sentences** `sentence_id`: treebank sentences.
- **word_links**: joins site words to tokens. `word_index` is the 0-based
  whitespace-separated chunk of `verses.homer`, so split the displayed line on whitespace
  and look each chunk up. A word can have several rows (`split`) and a token can serve
  several words (`joined`). `match` is one of:

  | match | meaning | count |
  |---|---|---|
  | exact | same word | 110,830 |
  | split | one site word = several tokens (μηδέ = μη + δέ) | 816 |
  | orthographic | accents, breathings, case or elision mark differ | 181 |
  | none | no counterpart in the treebank | 56 |
  | joined | several site words = one token (ἦ τοι = ἤτοι) | 14 |
  | variant | different reading in the same slot (ἐς / ἐν) | 11 |
  | movable_nu | ἔτελλεν / ἔτελλε | 5 |

- **paraphrase_links**: Homeric word → Gaza's paraphrase words, one row per pair
  (`book, line, word_index` as in `word_links`; `para_line, para_index` index the
  whitespace chunks of `verses.paraphrase`). Hand-aligned; Book 1 so far.
  Conventions: articles and ὦ go with their noun; Gaza's additions (λέγων etc.) stay
  unaligned; split verbs (ἐπὶ … ἔτελλεν) link both parts to the one Attic verb; when
  Gaza moves words across a line break, `para_line` differs from `line`. The source
  format is described at the top of `paraphrase_alignment/book01.txt`.

- **shortdefs** `lemma`: the Perseus/Logeion short English definitions
  ([helmadik/shortdefs](https://github.com/helmadik/shortdefs), ~100k Greek lemmas; no
  licence stated, its README asks for credit to Perseus and Logeion).
- **lemma_defs** `lemma`: a definition for each treebank lemma (`tokens.lemma`), with the
  list `entry` it came from and how it was matched: `exact`, `alias`
  (`lemma_aliases.tsv`: Homeric/variant spellings, plus an own definition for ἕ),
  `no_diacritics` (Πηλείδης ~ Πηλεΐδης) or `accents` (ποτέ ~ ποτε). Covers 99.4% of
  Book 1's words and 99.0% of the Iliad's; unmatched are mostly names (Μηριόνης) and
  Homeric forms (ἱρός, εἷος) — add them to `lemma_aliases.tsv`.
- **translation_passages** `(translation, book, line_from)`: A. T. Murray's prose
  translation (Loeb, 1924; public domain) from Perseus (`perseus-eng3`, encoding CC BY-SA
  4.0). Perseus marks the Greek line numbers every 5 lines, so each row covers ~5 lines
  and is not split per verse. In Book 1 its markers stand at the end of their line
  (passages 1–5, 6–10, …), in Books 2–24 at the start (1–4, 5–9, …); the importer detects
  this per book from where sentences end (see `import_translation.py`). Its markers have three slips, merged into the
  preceding passage: 2.720 repeated, 13.825 after 13.830, 20.1 repeated.
- **translation_lines** `(translation, book, line)`: Murray split into single Greek
  lines (Book 1 so far). The split points are hand-made: `translation_lines/murray_book01.txt`
  gives the first words of each line's English; the importer checks the pieces rejoin
  to the passage exactly. Where Murray reorders clauses across lines the cut is the
  best fit, so a line's English can carry a word or two belonging to its neighbour.
- **verse_timings** `(recording, model, book, line)`: where each verse is in a
  recording, in seconds. `line` 0 is the spoken title (`books.title`). `start` = first
  sound, `speech_end` = last sound, `end` = next verse's start (so `end - speech_end` is
  the pause after the verse; up to ~20 s at paragraph breaks). Made by CTC forced
  alignment with Meta's MMS model on romanized text; the Greek wav2vec2 model lost its
  place on Book 1. Check for Book 1: 95.9% of verse starts fall on a pause (median
  0.03 s from its end); the rest are run-on lines read without a pause. Known slip:
  1.312 starts ~1.4 s early (just before the pause that precedes it).

## Known mismatches (expect these)

**Line numbering.** `line` is the standard (OCT) number. The site numbers straight
through 11.543 and 14.269, which the standard numbering skips, so from those lines to
the end of the book `site_line` = `line` − 1.

**Lines missing from the treebank.** 8.548, 8.550–552 and 9.458–461 are plus-verses
(quoted by ancient authors, not in the medieval manuscripts). The site prints them in
brackets; the treebank and Gaza do not have them. Their words are `match = 'none'`.

**Lines Gaza does not paraphrase** (`paraphrase IS NULL`, 31 lines): the plus-verses above,
plus 1.265, 8.224–226, 8.277, 8.466–468, 12.325, 13.749, 16.381, 16.614–615, 17.585, 18.201,
19.177, 20.312, 21.434, 21.480, 21.510, 23.867, 24.312, 24.693. Most of these repeat lines
found elsewhere in the poem and were evidently absent from his manuscript. At 23.866–867
his text ran the two lines together, so his paraphrase of 866 corresponds to the end of 867.

**Different wording.** The texts differ in 17 lines, 14 of them in Book 1, where the
treebank follows another edition: 1.20, 1.25, 1.48, 1.59, 1.65, 1.105, 1.117, 1.119, 1.277,
1.281, 1.297, 1.309, 1.404, 1.464. In several (1.65, 1.309, 1.464, 1.281) the site's
reading is the one Gaza paraphrases, so the parse may not fit the paraphrase there.

**Editorial notes in the site text.** 23.866 and 23.867 contain notes ("(Perseus: …)",
"(La Gaza, lispește)"); 18.604–605 carry bracketed variants; 14.070's paraphrase is a note
by Gaza. `align_words.py` ignores notes and trailing bracketed variants; the six treebank
words of 23.866 appear on the site only inside its note and have no link.

**Other.** 74 treebank words have no lemma (e.g. Ἄϊδι, 1.3). The treebank's elision
marks are normalised to ’ and all Greek is NFC.

## Licences

The treebank is CC BY-SA 3.0 US (Perseus Digital Library): anything published from
`tokens`/`word_links` needs attribution and the same licence. Homeric text and paraphrase
are from vasilestancu.ro.
