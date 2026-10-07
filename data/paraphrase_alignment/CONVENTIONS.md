# How the alignments are made

Each Homeric word is given the words of Gaza's paraphrase that render it. The file
format is described at the top of `book01.txt`. These are the decisions behind Books 1–6,
written out so that later books follow them. The importer
(`scripts/import_paraphrase_alignment.py`) checks the mechanics; this file covers the
judgement.

## The whole rendering, not just its core

A Homeric word gets every paraphrase word that renders it, including the words Gaza
adds to make the rendering complete:

- doublets: `ῥῆξε = ἔρρηξε καὶ ἔτρεψε`, `ἐλεαίρεις = ἐλεεῖς καὶ οἰκτείρεις`
- a periphrasis: `Τελαμώνιος = ὁ Τελαμῶνος`, `Πηληϊάδεω = τοῦ υἱοῦ τοῦ Πηλέως`,
  `ἀντιανείρας = τὰς τοῖς ἀνδράσιν ἀντιτασσομένας`, `μυχῷ = κατὰ τὸ ἐνδότερον μέρος`
- a supplied object or pronoun goes with its verb: `ξείνισσε = ἐξένισεν αὐτόν`,
  `δεῖξαι = δεῖξαι αὐτὰ`, `ἐδάμασσε = τὸν δῆμον ὑπέταξεν`
- a supplied copula goes with its predicate: `λέων = λέων ἦν`
- a phrase that renders one word: `ἐννῆμαρ = ἐπὶ ἐννέα ἡμέρας`, `ἀγκὰς = ἐν ταῖς ἀγκάλαις`

Left unaligned (Gaza's additions): explanations and alternatives, above all those
opening with `ἤτοι` (`λελουμένος, ἤτοι ἐπιτείλας ἐκ τοῦ Ὠκεανοῦ`: only `λελουμένος`);
speech framing he adds (`λέγων`); and words with no Homeric counterpart at all. A
parenthesised alternative in the paraphrase goes with the word it doubles:
`διεξίμεναι = ἐξελθεῖν (ἐξιέναι)`.

## Articles

- **An article goes with the word right after it** in the paraphrase (about 80% of
  cases in Books 1–6): `τὴν ἡμετέραν γενεάν` gives `ἡμετέρην = τὴν ἡμετέραν`,
  `γενεήν = γενεάν`; `τῆς πλατείας καὶ μεγάλης Λυκίας` gives `εὐρείης = τῆς πλατείας καὶ
  μεγάλης`, `Λυκίης = Λυκίας`. Where the next word renders nothing, or belongs with the
  article only through a genitive in between (`τὸ τῶν Ἑλλήνων περίφραγμα`), it goes with
  its noun: `ἕρκος = τὸ περίφραγμα`.
- A Homeric article or demonstrative (`ὁ, ἡ, τό`, `τὸν δέ`, `ὃ δ'`) is rendered by
  Gaza's demonstrative or relative: `τόν = τοῦτον` / `ὃν`, `ἣ = αὕτη`, `τοὶ = οὗτοι`;
  where Gaza names the person instead, the name with its article: `ὃ = ὁ Ἕκτωρ`.
- `ὦ` that Gaza adds before a vocative goes with it (`θεὰ = ὦ Θεὰ`); a Homeric `ὦ` is
  its own word (`ὦ = ὦ`, `Προῖτ' = Προῖτε`).

## Particles

- `δέ`, `μέν`, `γάρ`, `ἀλλά`, `οὐ(κ)`, `καί` go to their own counterpart where Gaza has
  one: `δ' = δὲ`, `αὐτάρ`/`ἀτάρ = δὲ`, `ἰδὲ = καὶ`, `τε … καὶ`: `τε = καὶ` where Gaza
  has καὶ in its place, else `τε = -` (or `τε = τε`).
- `ἄρα / ἄρ' / ῥα / ῥ'`, `δή`, `περ`, `γε`, `κε / κεν / ἄν` take a particle Gaza has
  in the same place (`δὴ`, `γε`, `ἂν`, `τοίνυν`, `οὖν`), else `-`. `κε = ἂν` wherever
  Gaza keeps the potential.
- `ἤτοι ... μέν` with `μὲν οὖν`: `ἤτοι = -`, `μὲν = μὲν οὖν`.
- `οὔ τι` (not at all) with `οὐδαμῶς`: `οὔ = οὐδαμῶς`, `τι = -`.
- Directional `-δε` written apart (`Λυκίην δέ`, `πεδίον δέ`, `οἶκον δέ`): the noun takes
  the whole prepositional phrase (`Λυκίην = εἰς τὴν Λυκίαν`), `δέ = -`.

## Word order and lines

- Entries follow the Homeric order; the paraphrase words come from wherever they are.
- One paraphrase word may serve two Homeric words: tmesis (`ἐν ... πῆξε`, both
  `= ἐνέπηξε`), `ἔνθα καὶ ἔνθ'` (`καὶ = κᾀκεῖσε`, `ἔνθ' = κᾀκεῖσε`).
- Words Gaza moves to the next or previous paraphrase line take `>` or `<`, on every
  word: `ἀκάματον = >ἀκοπίαστον >καὶ >πολύ`.
- A repeated paraphrase word is found in order (the first one not yet used); `w@2` only
  where that would pick the wrong one.
- A Homeric word with no counterpart: `-`.

## Checking

`python3 scripts/import_paraphrase_alignment.py -v` must report no problems; its list of
unaligned paraphrase words should hold only Gaza's additions as above.
`scripts/compare_alignments.py REF CANDIDATE -v` scores one alignment against another.
