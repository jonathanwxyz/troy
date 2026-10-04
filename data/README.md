# Iliad data

`iliad.sqlite` holds the Iliad with Theodorus Gaza's paraphrase, line by line, and the
Perseus treebank (lemma, morphology, dependency parse) word by word. `iliad.tsv` is a
plain-text copy of the `verses` table.

## Rebuilding

Run in this order; each script replaces only its own tables. Pages are cached in `raw/`.

1. `scripts/parse_iliad.py` → `verses` (+ `iliad.tsv`), from vasilestancu.ro
2. `scripts/import_treebank.py` → `sentences`, `tokens`, from Perseus AGDT 2.1
3. `scripts/align_words.py` → `word_links`

## Tables

- **verses** `(book, line)`: `homer` (site text), `paraphrase` (Gaza; NULL where he has
  none), `site_line` (the number the site shows).
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
