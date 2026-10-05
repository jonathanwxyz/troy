#!/usr/bin/env python3
"""Load the hand-made Homer -> paraphrase word alignments in
data/paraphrase_alignment/*.txt into data/iliad.sqlite as `paraphrase_links`.

Run after parse_iliad.py. File format: see the header of book01.txt.
Words are matched ignoring accents, case and punctuation (align_words.key), and
positions are 0-based whitespace chunks of verses.homer / verses.paraphrase,
the same numbering as word_links.word_index.
"""
import re
import sqlite3
import sys
from pathlib import Path

from align_words import key, site_chunks

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "iliad.sqlite"
SRC = ROOT / "data" / "paraphrase_alignment"

REF = re.compile(r"^([<>]*)(.+?)(?:@(\d+))?$")


class Line:
    """Whitespace chunks of one text line, with which ones are already claimed."""

    def __init__(self, text):
        self.chunks = text.split() if text else []
        self.used = set()

    def find(self, word, nth=None):
        """Index of the nth (1-based) chunk matching word, else the first unclaimed one,
        else (a word shared by two Homeric words) the first one."""
        hits = [i for i, c in enumerate(self.chunks) if key(c) == key(word)]
        if not hits:
            return None
        if nth:
            return hits[nth - 1] if nth <= len(hits) else None
        return next((i for i in hits if i not in self.used), hits[0])


def parse(path):
    """Yield (book, line, homer word, [paraphrase refs], source line no)."""
    current = None
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        if m := re.fullmatch(r"(\d+)\.(\d+)", s):
            current = (int(m[1]), int(m[2]))
            continue
        homer, _, para = s.partition(" = ")
        refs = [] if para.strip() == "-" else para.split()
        yield (*current, homer.strip(), refs, n)


def load_verses(con):
    return {(b, l): (h, p) for b, l, h, p in con.execute("SELECT book, line, homer, paraphrase FROM verses")}


def resolve(paths, verses):
    """Resolve alignment files to rows (book, line, word_index, homer_word,
    para_line, para_index, para_word). Returns (rows, errors, notes) where notes
    lists unaligned paraphrase words per covered line."""
    homer_lines, para_lines = {}, {}

    def hl(bl):
        return homer_lines.setdefault(bl, Line(verses[bl][0]))

    def pl(bl):
        return para_lines.setdefault(bl, Line(verses.get(bl, ("", ""))[1]))

    rows, errors, covered = [], [], set()
    for path in paths:
        for b, l, word, refs, n in parse(path):
            where = f"{path.name}:{n} ({b}.{l} {word})"
            h = hl((b, l))
            hi = h.find(word)
            if hi is None or hi in h.used:
                errors.append(f"{where}: Homeric word not found (or listed twice)")
                continue
            h.used.add(hi)
            covered.add((b, l))
            for ref in refs:
                m = REF.match(ref)
                offset = m[1].count(">") - m[1].count("<")
                target = (b, l + offset)
                p = pl(target)
                pi = p.find(m[2], int(m[3]) if m[3] else None)
                if pi is None:
                    errors.append(f"{where}: paraphrase word {ref!r} not found in {target[0]}.{target[1]}")
                    continue
                p.used.add(pi)
                rows.append((b, l, hi, h.chunks[hi], target[1], pi, p.chunks[pi]))

    for bl in sorted(covered):
        h = hl(bl)
        missing = [w for i, w in site_chunks(verses[bl][0]) if i not in h.used]
        if missing:
            errors.append(f"{bl[0]}.{bl[1]}: no entry for {' '.join(missing)}")
    notes = []
    for bl in sorted(covered):
        p = pl(bl)
        extra = [c for i, c in enumerate(p.chunks) if i not in p.used and key(c)]
        if extra:
            notes.append(f"{bl[0]}.{bl[1]}: {' '.join(extra)}")
    return rows, errors, notes


def main():
    con = sqlite3.connect(DB)
    rows, errors, notes = resolve(sorted(SRC.glob("*.txt")), load_verses(con))
    con.executescript(
        """
        DROP TABLE IF EXISTS paraphrase_links;
        CREATE TABLE paraphrase_links (
            book        INTEGER NOT NULL,
            line        INTEGER NOT NULL,  -- Homeric line
            word_index  INTEGER NOT NULL,  -- 0-based whitespace chunk of verses.homer
            homer_word  TEXT    NOT NULL,
            para_line   INTEGER NOT NULL,  -- paraphrase line (usually = line; Gaza sometimes shifts words)
            para_index  INTEGER NOT NULL,  -- 0-based whitespace chunk of verses.paraphrase
            para_word   TEXT    NOT NULL
        );
        CREATE INDEX paraphrase_links_homer ON paraphrase_links (book, line, word_index);
        CREATE INDEX paraphrase_links_para ON paraphrase_links (book, para_line, para_index);
        """
    )
    con.executemany("INSERT INTO paraphrase_links VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    con.commit()
    con.close()

    lines = len({r[:2] for r in rows})
    print(f"{len(rows)} links for {lines} lines -> {DB.relative_to(ROOT)} (paraphrase_links)")
    if errors:
        print("\nProblems:", *errors, sep="\n  ")
    if "-v" in sys.argv:
        print("\nParaphrase words left unaligned (Gaza's additions):", *notes, sep="\n  ")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
