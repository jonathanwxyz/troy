#!/usr/bin/env python3
"""Parse vasilestancu.ro's interlinear Iliad pages (Homeric text + Gaza's paraphrase)
into data/iliad.sqlite and data/iliad.tsv.

Raw pages are cached in data/raw/ and only downloaded if missing.
"""
import html
import re
import sqlite3
import unicodedata
import urllib.request
from pathlib import Path

URL = "https://vasilestancu.ro/iliad_{}-paraphrase_interlinear.html"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DB = ROOT / "data" / "iliad.sqlite"
TSV = ROOT / "data" / "iliad.tsv"

ROW_MARKER = "<!--textul_homeric_normal!-->"
DELIM = "<!--»!-->"

# The site numbers lines consecutively, but the standard (OCT) numbering skips
# 11.543 and 14.269 (plus-verses not printed). From those lines on, the site's
# number is one lower than the standard one: {book: first site_line to shift}.
OCT_SKIPS = {11: 543, 14: 269}

# Latin homoglyphs typed inside Greek words in the source.
HOMOGLYPHS = str.maketrans({"o": "ο", "T": "Τ", "u": "υ"})
GREEK = r"[Ͱ-Ͽἀ-῿]"


def fetch(book: int) -> str:
    path = RAW / f"iliad_{book}.html"
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL.format(book)) as r:
            path.write_bytes(r.read())
    return path.read_text(encoding="utf-8")


def field(row: str, marker: str) -> str:
    """Text between the first pair of »-delimiters following the named marker."""
    seg = row[row.index(f"<!--{marker}!-->"):]
    seg = seg[seg.index(DELIM) + len(DELIM):]
    end = seg.find(DELIM)
    return seg[:end] if end >= 0 else seg


def clean(s: str) -> str:
    s = re.sub(r"</?[A-Za-z][^>]*>", "", s)  # HTML tags only; keeps editorial <...> around Greek
    s = html.unescape(s)
    s = re.sub(rf"(?<={GREEK})[oTu]+|[oTu]+(?={GREEK})", lambda m: m[0].translate(HOMOGLYPHS), s)
    s = unicodedata.normalize("NFC", s)
    return re.sub(r"\s+", " ", s).strip()


def parse(book: int):
    for raw_row in fetch(book).split(ROW_MARKER)[1:]:
        row = ROW_MARKER + raw_row
        site_line = int(clean(field(row, "numarul_versului")))
        line = site_line + (book in OCT_SKIPS and site_line >= OCT_SKIPS[book])
        paraphrase = clean(field(row, "parafraza_gaza"))
        yield (
            book,
            line,
            site_line,
            clean(field(row, "textul_homeric_normal")),
            None if paraphrase in ("", "-") else paraphrase,  # "-": Gaza has no paraphrase
        )


def main():
    rows = [r for b in range(1, 25) for r in parse(b)]

    con = sqlite3.connect(DB)
    con.executescript(
        """
        DROP TABLE IF EXISTS verses;
        CREATE TABLE verses (
            book       INTEGER NOT NULL,  -- 1..24
            line       INTEGER NOT NULL,  -- standard (OCT) line number
            site_line  INTEGER NOT NULL,  -- line number as shown on vasilestancu.ro
            homer      TEXT    NOT NULL,  -- Homeric text
            paraphrase TEXT,              -- Gaza's paraphrase; NULL where he gives none
            PRIMARY KEY (book, line)
        ) WITHOUT ROWID;
        """
    )
    con.executemany("INSERT INTO verses VALUES (?, ?, ?, ?, ?)", rows)
    con.commit()
    con.close()

    # Fields never contain tabs or newlines (clean() collapses whitespace), so no quoting needed.
    with TSV.open("w", encoding="utf-8") as f:
        f.write("book\tline\tsite_line\thomer\tparaphrase\n")
        for r in rows:
            f.write("\t".join(str(x) if x is not None else "" for x in r) + "\n")

    print(f"{len(rows)} verses -> {DB.relative_to(ROOT)}, {TSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
