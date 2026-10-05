#!/usr/bin/env python3
"""Load A. T. Murray's English prose translation (Loeb, 1924) of the Iliad from
Perseus (canonical-greekLit, perseus-eng3) into data/iliad.sqlite as
`translation_passages`: one row per passage between two Greek line markers.

Perseus marks the Greek line numbers in the English every 5 lines, but not
consistently: in Book 1 marker n stands at the end of line n (passages 1-5, 6-10, ...),
in the other books at its start (1-4, 5-9, ...). Each book's convention is detected by
punctuation: Murray's English usually breaks a sentence where the Greek line ends in
. · ; so the text just before marker n should agree with the end of line n (marker at
the end) or of line n-1 (marker at the start). The translation is public domain;
the Perseus encoding is CC BY-SA 4.0. The raw file is cached in data/raw/.
"""
import re
import sqlite3
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

URL = ("https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/"
       "data/tlg0012/tlg001/tlg0012.tlg001.perseus-eng3.xml")
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "murray_iliad.xml"
DB = ROOT / "data" / "iliad.sqlite"
TEI = "{http://www.tei-c.org/ns/1.0}"
TRANSLATION = "murray"


def events(el):
    """Text pieces and line markers of el in reading order. Footnote markers are
    dropped; speeches (<quote>) get quotation marks."""
    tag = el.tag.removeprefix(TEI)
    if tag == "milestone" and el.get("unit") == "line":
        yield ("line", int(el.get("n")))
    elif tag != "note":
        if tag == "quote":
            yield ("text", " “")
        if el.text:
            yield ("text", el.text)
        for child in el:
            yield from events(child)
            if child.tail:
                yield ("text", child.tail)
        if tag == "quote":
            yield ("text", "” ")


def tidy(text):
    # Perseus sometimes splits one speech into two <quote>s; drop the seam ("… afar.” “Forthwith").
    text = re.sub(r"”\s*“", " ", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"“\s+", "“", text)
    text = re.sub(r"\s+”", "”", text)
    text = re.sub(r"\s+([,.;:!?’])", r"\1", text)
    return text.strip()


def passages(book_div):
    """(first line, text) for each stretch of English after a line marker. A marker
    that doesn't move forward (Perseus has a repeated 2.720 and 20.1, and 13.825 after
    13.830) is ignored, its text staying with the passage before it."""
    start, buf = None, []
    for kind, value in events(book_div):
        if kind == "line" and (start is None or value > start):
            if start is not None:
                yield start, tidy("".join(buf))
            start, buf = value, []
        elif kind == "text" and start is not None:
            buf.append(value)
    if start is not None:
        yield start, tidy("".join(buf))


STOP = re.compile(r"[.;·:!?][\"”’]?\s*$")


def marker_at_line_end(book, found, greek):
    """True if this book's markers sit at the end of their line (see module doc)."""
    end = start = 0
    for (_, before), (marker, _) in zip(found, found[1:]):
        if marker <= 1:
            continue
        eng = bool(STOP.search(before))
        end += eng == bool(STOP.search(greek.get((book, marker), "")))
        start += eng == bool(STOP.search(greek.get((book, marker - 1), "")))
    return end > start


def main():
    if not RAW.exists():
        with urllib.request.urlopen(URL) as r:
            RAW.write_bytes(r.read())
    root = ET.parse(RAW).getroot()

    con = sqlite3.connect(DB)
    last_line = dict(con.execute("SELECT book, max(line) FROM verses GROUP BY book"))
    greek = {(b, l): h for b, l, h in con.execute("SELECT book, line, homer FROM verses")}
    rows, at_end = [], []
    for div in root.iter(f"{TEI}div"):
        if div.get("subtype") != "book":
            continue
        book = int(div.get("n"))
        found = [(marker, text) for marker, text in passages(div) if text]
        shift = marker_at_line_end(book, found, greek)
        if shift:
            at_end.append(book)
        # First line of each passage: marker 1 opens the book; otherwise the marker's line,
        # or the line after it where markers stand at line ends.
        starts = [1 if marker == 1 else marker + shift for marker, _ in found]
        for k, (_, text) in enumerate(found):
            end = starts[k + 1] - 1 if k + 1 < len(found) else last_line[book]
            rows.append((TRANSLATION, book, starts[k], end, text))

    con.executescript(
        """
        DROP TABLE IF EXISTS translation_passages;
        CREATE TABLE translation_passages (
            translation TEXT    NOT NULL,  -- murray: A. T. Murray, Loeb 1924
            book        INTEGER NOT NULL,
            line_from   INTEGER NOT NULL,  -- Greek lines this passage translates
            line_to     INTEGER NOT NULL,
            text        TEXT    NOT NULL,
            PRIMARY KEY (translation, book, line_from)
        ) WITHOUT ROWID;
        """
    )
    con.executemany("INSERT INTO translation_passages VALUES (?, ?, ?, ?, ?)", rows)
    con.commit()
    books = len({r[1] for r in rows})
    print(f"{len(rows)} passages in {books} books -> {DB.relative_to(ROOT)} (translation_passages)")
    print(f"markers at line ends (passages shifted by one line) in book(s): {at_end or 'none'}")
    con.close()


if __name__ == "__main__":
    main()
