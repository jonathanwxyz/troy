#!/usr/bin/env python3
"""Import the Perseus Ancient Greek Dependency Treebank (AGDT 2.1) Iliad into
data/iliad.sqlite as the tables `sentences` and `tokens`.

Run scripts/parse_iliad.py first: the `verses` table is used to resolve words
the treebank cites to two lines at once.

Source: https://github.com/PerseusDL/treebank_data (CC BY-SA 3.0 US).
The raw file is cached in data/raw/ and only downloaded if missing.
"""
import re
import sqlite3
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

URL = ("https://raw.githubusercontent.com/PerseusDL/treebank_data/master/"
       "v2.1/Greek/texts/tlg0012.tlg001.perseus-grc1.tb.xml")
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "agdt_iliad.tb.xml"
DB = ROOT / "data" / "iliad.sqlite"

CITE = re.compile(r"urn:cts:greekLit:tlg0012\.tlg001:(\d+)\.(\d+)")

# AGDT 9-position postag, one table per position (positions 2..9; 1 is pos).
POSTAG = [
    ("pos", {"n": "noun", "v": "verb", "a": "adjective", "d": "adverb", "l": "article",
             "g": "particle", "c": "conjunction", "r": "preposition", "p": "pronoun",
             "m": "numeral", "i": "interjection", "e": "exclamation", "u": "punctuation",
             "x": "irregular"}),
    ("person", {"1": "1st", "2": "2nd", "3": "3rd"}),
    ("number", {"s": "singular", "p": "plural", "d": "dual"}),
    ("tense", {"p": "present", "i": "imperfect", "r": "perfect", "l": "pluperfect",
               "t": "future perfect", "f": "future", "a": "aorist"}),
    ("mood", {"i": "indicative", "s": "subjunctive", "o": "optative", "n": "infinitive",
              "m": "imperative", "p": "participle"}),
    ("voice", {"a": "active", "p": "passive", "m": "middle", "e": "medio-passive"}),
    ("gender", {"m": "masculine", "f": "feminine", "n": "neuter"}),
    ("gram_case", {"n": "nominative", "g": "genitive", "d": "dative", "a": "accusative",
                   "v": "vocative", "l": "locative"}),
    ("degree", {"c": "comparative", "s": "superlative"}),
]

# Elision marks in the treebank vary (incl. a bare combining U+0313); unify to U+2019.
ELISION = re.compile(r"[̓᾽ʼ'’]$")


def nfc(s):
    return unicodedata.normalize("NFC", s) if s else s


def norm_form(s):
    # Elision first: NFC would fuse a trailing U+0313 onto a vowel as a smooth breathing.
    return nfc(ELISION.sub("’", s))


def bare(s):
    """Lowercase Greek letters only, diacritics stripped: for matching words to verse text."""
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if "α" <= c <= "ω" or c == "ς").replace("ς", "σ")


def load_xml():
    if not RAW.exists():
        RAW.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL) as r:
            RAW.write_bytes(r.read())
    return ET.parse(RAW).getroot()


class Cursor:
    """Reading position in the verse text, carried across sentences: the current
    line and the bare text of it not yet consumed by a word."""

    def __init__(self, verse_text):
        self.verse_text = verse_text
        self.line = None
        self.rest = ""

    def move_to(self, line):
        if line != self.line:
            self.line, self.rest = line, bare(self.verse_text.get(line, ""))

    def consume(self, form):
        pos = self.rest.find(form) if form else -1
        if pos >= 0:
            self.rest = self.rest[pos + len(form):]
        return pos >= 0


def assign_lines(words, cursor):
    """Return (book, line) per word of one sentence.

    - single cite: that line
    - multi cite (annotator cited a stretch of lines jointly): continue from the
      current reading position, moving to the next candidate line once the word
      is no longer found in the rest of the current one
    - punctuation (no cite): line of the preceding word, else of the following one
    - artificial (elliptic) nodes: None
    """
    out = [None] * len(words)
    for i, w in enumerate(words):
        cands = [(int(b), int(l)) for b, l in CITE.findall(w.get("cite") or "")]
        if not cands:
            continue
        form = bare(w.get("form", ""))
        if len(cands) == 1:
            cursor.move_to(cands[0])
            cursor.consume(form)
        else:
            k = cands.index(cursor.line) if cursor.line in cands else 0
            cursor.move_to(cands[k])
            while not cursor.consume(form) and k + 1 < len(cands):
                k += 1
                cursor.move_to(cands[k])
        out[i] = cursor.line
    for i, w in enumerate(words):
        if out[i] is None and not w.get("artificial"):
            prev = next((out[j] for j in range(i - 1, -1, -1) if out[j]), None)
            out[i] = prev or next((out[j] for j in range(i + 1, len(words)) if out[j]), None)
    return out


def main():
    con = sqlite3.connect(DB)
    cursor = Cursor({(b, l): h for b, l, h in con.execute("SELECT book, line, homer FROM verses")})

    sentences, tokens = [], []
    for s in load_xml().iter("sentence"):
        sid = int(s.get("id"))
        sentences.append((sid, s.get("subdoc")))
        words = list(s.iter("word"))
        for w, bl in zip(words, assign_lines(words, cursor)):
            postag = w.get("postag") or ""
            decoded = [table.get(postag[i]) if len(postag) == 9 else None
                       for i, (_, table) in enumerate(POSTAG)]
            tokens.append((
                len(tokens) + 1, sid, int(w.get("id")),
                *(bl or (None, None)),
                norm_form(w.get("form")), nfc(w.get("lemma")) or None, postag or None,
                *decoded,
                int(w.get("head")) if w.get("head") else None, w.get("relation") or None,
                w.get("artificial"),
            ))

    cols = ", ".join(f"{name} TEXT" for name, _ in POSTAG)
    con.executescript(
        f"""
        DROP TABLE IF EXISTS tokens;
        DROP TABLE IF EXISTS sentences;
        CREATE TABLE sentences (
            sentence_id INTEGER PRIMARY KEY,  -- AGDT sentence id
            subdoc      TEXT                  -- line range as given by AGDT, e.g. '1.1-1.7'
        );
        CREATE TABLE tokens (
            seq         INTEGER PRIMARY KEY,  -- document order across the whole Iliad
            sentence_id INTEGER NOT NULL REFERENCES sentences,
            word_id     INTEGER NOT NULL,     -- id within the sentence; `head` refers to it
            book        INTEGER,              -- (book, line) joins verses; NULL for artificial nodes
            line        INTEGER,
            form        TEXT NOT NULL,
            lemma       TEXT,
            postag      TEXT,                 -- raw AGDT 9-position tag
            {cols},                           -- postag decoded
            head        INTEGER,              -- word_id of the governing word; 0 = sentence root
            relation    TEXT,                 -- AGDT dependency label (PRED, SBJ, OBJ, ATR, ...)
            artificial  TEXT,                 -- 'elliptic' for nodes inserted for an omitted word
            UNIQUE (sentence_id, word_id)
        );
        """
    )
    con.executemany("INSERT INTO sentences VALUES (?, ?)", sentences)
    con.executemany(f"INSERT INTO tokens VALUES ({', '.join('?' * len(tokens[0]))})", tokens)
    con.executescript(
        """
        CREATE INDEX tokens_book_line ON tokens (book, line);
        CREATE INDEX tokens_lemma ON tokens (lemma);
        """
    )
    con.commit()
    con.close()
    print(f"{len(sentences)} sentences, {len(tokens)} tokens -> {DB.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
