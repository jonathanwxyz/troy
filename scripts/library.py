#!/usr/bin/env python3
"""Build the library (data/library.sqlite): the texts the reader offers, grouped by
category, from a catalogue file.

    python3 scripts/library.py [--catalogue library/catalogue.json] [-v]

The catalogue is local (library/ is git-ignored); library/catalogue.example.json in
the repository shows the format. It is JSON:

    {"categories": ["Epic", "Philosophy"],          -- shown in this order
     "texts": [
       {"slug": "iliad", "title": "Ἰλιάς", "author": "Ὅμηρος", "category": "Epic",
        "reader": "iliad"},                         -- the Iliad reader (data/iliad.sqlite)
       {"slug": "...", "title": "...", "author": "...", "category": "Epic",
        "credit": "...",                            -- shown under the text
        "label": "Ῥαψῳδία {N}",                     -- optional: name the books ({n}: number,
                                                    -- {N}: Greek numeral letter, Α–Ω)
        "source": {"type": "wikisource", "site": "el.wikisource.org", "index": "<index page>"}},
       {"slug": "apology", "title": "Ἀπολογία Σωκράτους", "author": "Πλάτων",
        "category": "Philosophy", "source": {"type": "perseus", "work": "tlg0059.tlg002"}}]}

Sources (downloads are cached in data/raw/library/):
  wikisource  a work whose index page lists its books ("# [[/α|Ῥαψωδία α]]"); each
              book's verse is the text of its <poem> blocks, one line per verse,
              numbered by counting (disagreements with the page's {{fr|N}} line markers are
              reported)
  perseus     a Greek text from PerseusDL/canonical-greekLit (work = tlgXXXX.tlgYYY,
              edition default perseus-grc2, else perseus-grc1) cited by Stephanus sections (Plato):
              segments run from one section or speech to the next, with the speaker
              (<label>) and paragraph breaks kept

Notes (shown in the reader's σχόλια panel) come from a text's "notes" list, each
{"type": ..., "id": "Monro", "siglum": "M", "name": "Commentary (1886)", "lang": "en"}
plus where to find them, and "notes_credit" (a line under the panel):
  perseus     "file": a commentary in Perseus's bulk download (as in import_commentaries.py:
              TEI P4, Greek in Beta Code), e.g. "Classics/Homer/opensource/<file>.xml";
              notes keyed by line (<div2 type="commline">, in <div1 type="book">) or by
              Stephanus section (<div1 type="section" n="172A">); a paragraph per note
  scholia     "work": First1KGreek scholia (tlg5026.tlgNNN) set out a book at a time,
              each scholion a paragraph opening with its line number ("5. lemma] …") or
              continuing the line before; the books' hypotheses go with line 1

Tables: categories (name, sort), texts (slug, title, author, category, sort, form:
verse|prose, cite: line|section, reader: text|iliad, credit), divisions (text, n, label:
a book, or the whole work), segments (text, div, seq, ref: line number or section,
content, speaker, para: 1 where a paragraph or speech begins), note_sources (text, id,
siglum, name, lang, sort), notes (text, div, pos_from, pos_to: the segments (seq) a note
covers, source, seq, body, parts: JSON styled runs as in import_commentaries.py).
"""
import argparse
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))  # import_commentaries
DB = ROOT / "data" / "library.sqlite"
ILIAD_DB = ROOT / "data" / "iliad.sqlite"
CACHE = ROOT / "data" / "raw" / "library"
UA = {"User-Agent": "Mozilla/5.0 (scrolling-reader library builder; personal study tool)"}
TEI = "{http://www.tei-c.org/ns/1.0}"
GREEK_NUMERALS = " ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ"
PERSEUS_RAW = ROOT / "data" / "raw" / "perseus"
PERSEUS_ARCHIVE_URL = "https://www.perseus.tufts.edu/hopper/opensource/downloads/texts/hopper-texts-GreekRoman.tar.gz"
FIRST1K = "https://raw.githubusercontent.com/OpenGreekAndLatin/First1KGreek/master/data/{}/{}/{}.1st1K-grc1.xml"


def get(url, name):
    """url's body, cached as data/raw/library/<name>."""
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
            path.write_bytes(r.read())
    return path.read_text(encoding="utf-8")


def safe(name):
    return re.sub(r'[/\\:*?"<>|\s]+', "_", name)


# ---------------------------------------------------------------- Wikisource

def wikitext(site, page):
    url = f"https://{site}/w/index.php?title={urllib.parse.quote(page)}&action=raw"
    return get(url, f"wikisource_{safe(site)}_{safe(page)}.txt")


def clean_wiki(line):
    line = re.sub(r"\{\{[^{}]*\}\}", "", line)                  # templates
    line = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", line)  # [[link|text]] -> text
    line = re.sub(r"<[^>]+>", "", line)                         # tags
    line = line.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", line).strip()


def wikisource(src, verbose):
    site, index = src.get("site", "el.wikisource.org"), src["index"]
    books = re.findall(r"^#\s*\[\[(/[^|\]]+)\|([^\]]+)\]\]", wikitext(site, index), re.M)
    if not books:
        sys.exit(f"wikisource: no '# [[/…|…]]' book list on {index}")
    divisions, segments = [], []
    for n, (sub, label) in enumerate(books, 1):
        text = wikitext(site, index + sub)
        while m := re.fullmatch(r"\s*#(?:REDIRECT|ΑΝΑΚΑΤΕΥΘΥΝΣΗ)\s*\[\[([^\]|]+)[^\]]*\]\].*", text, re.S | re.I):
            text = wikitext(site, m[1])
        divisions.append((n, label.strip()))
        line, mismatches = 0, []
        for poem in re.findall(r"<poem>(.*?)</poem>", text, re.S):
            for raw in poem.splitlines():
                marker = re.search(r"\{\{fr\|(\d+)\}\}", raw)
                content = clean_wiki(raw)
                if not content:
                    continue
                line += 1
                if marker and int(marker[1]) != line:
                    mismatches.append((line, int(marker[1])))  # reported; a stray marker
                    # (some pages have a few) shouldn't renumber the lines after it
                segments.append((n, line, str(line), content, None, 1))
        if verbose or mismatches:
            print(f"  {label.strip()}: {line} lines" +
                  (f"; line markers disagree at (counted, marked) {mismatches}" if mismatches else ""))
    return "verse", "line", divisions, segments


# ---------------------------------------------------------------- Perseus (Stephanus prose)

def perseus(src, verbose, title):
    work = src["work"]
    tlg, wk = work.split(".")
    for edition in [src["edition"]] if "edition" in src else ["perseus-grc2", "perseus-grc1"]:
        url = f"https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/data/{tlg}/{wk}/{work}.{edition}.xml"
        try:
            xml = get(url, f"perseus_{work}.{edition}.xml")
            break
        except urllib.error.HTTPError as e:
            if e.code != 404 or "edition" in src:
                raise
    else:
        sys.exit(f"perseus: no Greek edition of {work} found")
    body = ElementTree.fromstring(xml.encode()).find(f".//{TEI}body")
    segments = []
    state = {"ref": None, "speaker": None, "para": 1, "buf": []}

    def flush():
        content = re.sub(r"\s+", " ", "".join(state["buf"])).strip()
        if content:
            segments.append((1, len(segments) + 1, state["ref"], content, state["speaker"], state["para"]))
            state["speaker"], state["para"] = None, 0
        state["buf"] = []

    def walk(el):
        tag = el.tag.replace(TEI, "")
        if tag == "milestone":
            unit = el.get("unit")
            if unit == "section":
                flush()
                state["ref"] = el.get("n")
            elif unit == "para":
                flush()
                state["para"] = 1
        elif tag == "label":  # speaker: starts a new speech
            if state.pop("merge", False):  # the same speech, carried over a page division
                return
            flush()
            state["speaker"] = re.sub(r"\s+", " ", "".join(el.itertext())).strip()
            state["para"] = 1
        elif tag in ("del", "note", "bibl", "gap", "head"):
            pass
        else:
            if tag == "p":
                flush()
                said = el.find(f"{TEI}said")
                if said is not None and said.get("rend") == "merge":
                    state["merge"] = True  # continues the speech before: no new paragraph
                else:
                    state["para"] = 1
            if el.text:
                state["buf"].append(el.text)
            for child in el:
                walk(child)
                if child.tail:
                    state["buf"].append(child.tail)
            if tag == "l":
                state["buf"].append(" ")

    for child in body:
        walk(child)
    flush()
    if verbose:
        refs = [s[2] for s in segments]
        print(f"  {len(segments)} segments, sections {refs[0]}–{refs[-1]}")
    return "prose", "section", [(1, title)], segments


# ---------------------------------------------------------------- Iliad (its own reader)

def iliad(verbose):
    if not ILIAD_DB.exists():
        print("  (data/iliad.sqlite not built: no books listed)")
        return "verse", "line", [], []
    con = sqlite3.connect(ILIAD_DB)
    books = [b for (b,) in con.execute("SELECT DISTINCT book FROM verses ORDER BY book")]
    con.close()
    return "verse", "line", [(b, f"Ῥαψῳδία {GREEK_NUMERALS[b]}") for b in books], []


# ---------------------------------------------------------------- notes

def perseus_members(members):
    """Make sure each Perseus bulk-download member is in data/raw/perseus/ (fetching the
    125 MB archive once if any is missing, and deleting it afterwards)."""
    missing = [m for m in members if not (PERSEUS_RAW / Path(m).name).exists()]
    if not missing:
        return
    import tarfile
    PERSEUS_RAW.mkdir(parents=True, exist_ok=True)
    archive = PERSEUS_RAW / "hopper-texts-GreekRoman.tar.gz"
    if not archive.exists():
        print("downloading Perseus's Greek and Roman texts (125 MB) ...")
        with urllib.request.urlopen(urllib.request.Request(PERSEUS_ARCHIVE_URL, headers=UA)) as r, \
                archive.open("wb") as out:
            while chunk := r.read(1 << 20):
                out.write(chunk)
    with tarfile.open(archive) as tar:
        for m in missing:
            (PERSEUS_RAW / Path(m).name).write_bytes(tar.extractfile(m).read())
    archive.unlink()


def perseus_notes(spec):
    """(book, ref_from, ref_to, parts) for each note paragraph of a Perseus commentary."""
    from import_commentaries import VS_RANGE, load_xml, parts_of, tidy
    root = load_xml(PERSEUS_RAW / Path(spec["file"]).name)

    def paragraphs(block):
        for p in block.iter("p"):
            parts = tidy(parts_of(p, block.get("lang")))
            if parts:
                yield parts

    for book in root.iter("div1"):  # line notes, a book at a time
        if book.get("type") != "book" or not (book.get("n") or "").isdigit():
            continue
        for cl in book.iter():
            if cl.get("type") == "commline" and (cl.get("n") or "").isdigit():
                line = int(cl.get("n"))
                for parts in paragraphs(cl):
                    m = VS_RANGE.match("".join(t for _, t in parts))
                    last = int(m[2]) if m and int(m[1]) == line and int(m[2]) > line else line
                    yield int(book.get("n")), str(line), str(last), parts
    for sec in root.iter():  # Stephanus sections (an introduction's numbered § don't match)
        if sec.get("type") == "section" and re.fullmatch(r"\d+[A-Ea-e]", sec.get("n") or ""):
            ref = sec.get("n").lower()
            for parts in paragraphs(sec):
                yield 1, ref, ref, parts


def scholia_notes(spec):
    """(book, line, line, None, text) for each scholion in a First1KGreek book-by-book edition."""
    tlg, wk = spec["work"].split(".")
    root = ElementTree.fromstring(get(FIRST1K.format(tlg, wk, spec["work"]), f"first1k_{spec['work']}.xml").encode())

    def flat(el, out):
        tag = el.tag.replace(TEI, "")
        if tag not in ("note", "head"):
            out.append(el.text or "")
            for child in el:
                flat(child, out)
        out.append(el.tail or "")

    for book in root.iter(f"{TEI}div"):
        if book.get("subtype") != "book" or not (book.get("n") or "").isdigit():
            continue
        b, line, argument = int(book.get("n")), 1, True  # the argument comes before the scholia
        for sec in book.iter(f"{TEI}div"):
            if sec.get("subtype") != "section":
                continue
            for p in sec.iter(f"{TEI}p"):
                out = []
                flat(p, out)
                text = "".join(out[:-1])  # without the paragraph's own tail
                text = re.sub(r"-\s*\n\s*", "", text)  # words broken over a printed line
                text = re.sub(r"\s+", " ", text).strip()
                if not text:
                    continue
                m = re.match(r"(\d{1,3})[ab]?\.\s*", text)
                if m:
                    argument = False
                    line, text = int(m[1]), text[m.end():]
                elif argument:  # the book's argument (ὑπόθεσις), before its first scholion
                    yield b, "1", "1", f"ὑπόθεσις] {text}"
                    continue
                yield b, str(line), str(line), text


def build_notes(slug, specs, segments, form):
    """Notes rows for a text: each source's notes placed on the segments they cover."""
    first, last = {}, {}  # (div, ref) -> seq of its first / last segment
    for div, seq, ref, *_ in segments:
        first.setdefault((div, ref), seq)
        last[(div, ref)] = seq
    sources, rows, skipped = [], [], 0
    for sort, spec in enumerate(specs):
        sources.append((slug, spec["id"], spec.get("siglum", spec["id"]), spec["name"], spec.get("lang"), sort))
        if spec["type"] == "perseus":
            items = ((b, a, z, json.dumps(parts, ensure_ascii=False), "".join(t for _, t in parts))
                     for b, a, z, parts in perseus_notes(spec))
        elif spec["type"] == "scholia":
            items = ((b, a, z, None, text) for b, a, z, text in scholia_notes(spec))
        else:
            sys.exit(f"{slug}: unknown notes type {spec['type']!r}")
        count = 0
        for b, a, z, parts, body in items:
            if (b, a) not in first:
                skipped += 1
                continue
            z = z if (b, z) in last else a
            rows.append((slug, b, first[(b, a)], last[(b, z)], spec["id"], len(rows), body, parts))
            count += 1
        print(f"  notes: {spec['id']}: {count}")
    if skipped:
        print(f"  notes: {skipped} on lines or sections not in this text, left out")
    return sources, rows


# ---------------------------------------------------------------- build

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalogue", type=Path, default=ROOT / "library" / "catalogue.json")
    ap.add_argument("-v", action="store_true", help="report each book")
    args = ap.parse_args()
    if not args.catalogue.exists():
        sys.exit(f"no catalogue at {args.catalogue}: copy library/catalogue.example.json there and edit it")
    cat = json.loads(args.catalogue.read_text(encoding="utf-8"))
    categories = cat.get("categories", [])

    perseus_members([n["file"] for t in cat["texts"] for n in t.get("notes", []) if n["type"] == "perseus"])
    rows_t, rows_d, rows_s, rows_ns, rows_n = [], [], [], [], []
    for sort, t in enumerate(cat["texts"]):
        if t.get("category") not in categories:
            sys.exit(f"{t['slug']}: category {t.get('category')!r} is not in the catalogue's categories")
        print(f"{t['slug']}: {t['title']}")
        reader = t.get("reader", "text")
        if reader == "iliad":
            form, cite, divs, segs = iliad(args.v)
        else:
            src = t["source"]
            if src["type"] == "wikisource":
                form, cite, divs, segs = wikisource(src, args.v)
            elif src["type"] == "perseus":
                form, cite, divs, segs = perseus(src, args.v, t["title"])
            else:
                sys.exit(f"{t['slug']}: unknown source type {src['type']!r}")
        if t.get("label"):
            divs = [(n, t["label"].format(n=n, N=GREEK_NUMERALS[n] if n < len(GREEK_NUMERALS) else n))
                    for n, _ in divs]
        if t.get("notes"):
            ns, n = build_notes(t["slug"], t["notes"], segs, form)
            rows_ns += ns
            rows_n += n
        rows_t.append((t["slug"], t["title"], t.get("author"), t["category"], sort, form, cite, reader,
                       t.get("credit"), t.get("notes_credit")))
        rows_d += [(t["slug"], n, label) for n, label in divs]
        rows_s += [(t["slug"], *s) for s in segs]

    DB.parent.mkdir(exist_ok=True)
    con = sqlite3.connect(DB)
    con.executescript("""
        DROP TABLE IF EXISTS categories; DROP TABLE IF EXISTS texts;
        DROP TABLE IF EXISTS divisions; DROP TABLE IF EXISTS segments;
        DROP TABLE IF EXISTS note_sources; DROP TABLE IF EXISTS notes;
        CREATE TABLE categories (name TEXT PRIMARY KEY, sort INTEGER NOT NULL);
        CREATE TABLE texts (
            slug     TEXT PRIMARY KEY,
            title    TEXT NOT NULL,
            author   TEXT,
            category TEXT NOT NULL REFERENCES categories,
            sort     INTEGER NOT NULL,   -- order within the library
            form     TEXT NOT NULL,      -- verse (a line per segment) or prose
            cite     TEXT NOT NULL,      -- line or section (Stephanus)
            reader   TEXT NOT NULL,      -- text (generic reader) or iliad
            credit   TEXT,
            notes_credit TEXT);          -- under the σχόλια panel
        CREATE TABLE divisions (
            text  TEXT NOT NULL REFERENCES texts,
            n     INTEGER NOT NULL,      -- book number (1 for an undivided work)
            label TEXT,
            PRIMARY KEY (text, n));
        CREATE TABLE segments (
            text    TEXT NOT NULL,
            div     INTEGER NOT NULL,
            seq     INTEGER NOT NULL,    -- order within the division
            ref     TEXT,                -- line number, or Stephanus section (172a)
            content TEXT NOT NULL,
            speaker TEXT,                -- speaker label where a speech begins (ΣΩ.)
            para    INTEGER NOT NULL,    -- 1: starts a paragraph (always, for verse)
            PRIMARY KEY (text, div, seq));
        CREATE TABLE note_sources (
            text TEXT NOT NULL, id TEXT NOT NULL, siglum TEXT, name TEXT, lang TEXT,
            sort INTEGER NOT NULL, PRIMARY KEY (text, id));
        CREATE TABLE notes (
            text     TEXT NOT NULL,
            div      INTEGER NOT NULL,
            pos_from INTEGER NOT NULL,   -- first and last segment (seq) the note is on
            pos_to   INTEGER NOT NULL,
            source   TEXT NOT NULL,
            seq      INTEGER NOT NULL,   -- order within the source
            body     TEXT NOT NULL,      -- plain text ("lemma] note" for scholia)
            parts    TEXT);              -- JSON [[kind, text], ...] (l lemma, i italic, t text)
        CREATE INDEX notes_place ON notes (text, div, pos_from);
    """)
    con.executemany("INSERT INTO categories VALUES (?, ?)", [(c, i) for i, c in enumerate(categories)])
    con.executemany("INSERT INTO texts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows_t)
    con.executemany("INSERT INTO note_sources VALUES (?, ?, ?, ?, ?, ?)", rows_ns)
    con.executemany("INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows_n)
    con.executemany("INSERT INTO divisions VALUES (?, ?, ?)", rows_d)
    con.executemany("INSERT INTO segments VALUES (?, ?, ?, ?, ?, ?, ?)", rows_s)
    con.commit()
    con.close()
    print(f"{len(rows_t)} texts, {len(rows_d)} divisions, {len(rows_s)} segments, {len(rows_n)} notes "
          f"-> {DB.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
