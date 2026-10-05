#!/usr/bin/env python3
"""Load Iakovos Polylas's modern Greek verse translation of the Iliad (published 1923,
public domain) from Greek Wikisource into data/iliad.sqlite (`translation_lines`,
translation = 'polylas').

Polylas renders the Iliad line for line, and Wikisource marks every fifth line with
{{r|n}}. A book is loaded only if it has as many lines as the Greek (verses table)
and every marker n sits on its n-th line; other books are reported and skipped.
Raw wikitext is cached in data/raw/polylas/.
"""
import html
import re
import sqlite3
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "polylas"
DB = ROOT / "data" / "iliad.sqlite"
TRANSLATION = "polylas"
PAGE = "Ιλιάδα (Πολυλάς)/{}"
BOOK_LETTERS = "αβγδεζηθικλμνξοπρστυφχψω"


def fetch(book):
    path = RAW / f"{book:02d}.txt"
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        title = urllib.parse.quote(PAGE.format(BOOK_LETTERS[book - 1]))
        url = f"https://el.wikisource.org/w/index.php?title={title}&action=raw"
        req = urllib.request.Request(url, headers={"User-Agent": "scrolling-reader/1.0 (personal study tool)"})
        with urllib.request.urlopen(req) as r:
            path.write_bytes(r.read())
    return path.read_text(encoding="utf-8")


def verse_lines(wikitext):
    """[(text, marker or None)] for each verse line of the page."""
    body = re.search(r"<poem>(.*?)</poem>", wikitext, re.S)
    body = body[1] if body else wikitext.split("}}", 1)[-1]
    out = []
    for raw in body.splitlines():
        marker = re.search(r"\{\{\s*r\s*\|\s*(\d+)\s*\}\}", raw)
        text = re.sub(r"\{\{[^}]*\}\}", "", raw)              # templates ({{r|5}} etc.)
        text = re.sub(r"<[^>]+>", "", text)                   # <br>, spans
        text = re.sub(r"'{2,}", "", text)                     # wiki bold/italics
        text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)  # links
        text = unicodedata.normalize("NFC", html.unescape(text))
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            out.append((text, int(marker[1]) if marker else None))
    return out


def main():
    con = sqlite3.connect(DB)
    greek_lines = dict(con.execute("SELECT book, count(*) FROM verses GROUP BY book"))
    rows, report = [], []
    for book in range(1, 25):
        lines = verse_lines(fetch(book))
        misplaced = [(i, m) for i, (_, m) in enumerate(lines, 1) if m is not None and m != i]
        if len(lines) != greek_lines[book] or misplaced:
            report.append(f"book {book:2}: skipped — {len(lines)} lines vs {greek_lines[book]} Greek"
                          + (f"; first misplaced marker {misplaced[0][1]} on line {misplaced[0][0]}" if misplaced else ""))
            continue
        rows += [(TRANSLATION, book, i, text) for i, (text, _) in enumerate(lines, 1)]
        report.append(f"book {book:2}: {len(lines)} lines")

    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS translation_lines (
            translation TEXT    NOT NULL,  -- murray (English), polylas (modern Greek), ...
            book        INTEGER NOT NULL,
            line        INTEGER NOT NULL,
            text        TEXT,              -- NULL: no text of its own (in the line before)
            PRIMARY KEY (translation, book, line)
        ) WITHOUT ROWID;
        """
    )
    con.execute("DELETE FROM translation_lines WHERE translation = ?", (TRANSLATION,))
    con.executemany("INSERT INTO translation_lines VALUES (?, ?, ?, ?)", rows)
    con.commit()
    con.close()
    print(f"{len(rows)} Polylas lines -> {DB.relative_to(ROOT)} (translation_lines)")
    print(*report, sep="\n  ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
