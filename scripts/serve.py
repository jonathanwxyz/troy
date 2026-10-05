#!/usr/bin/env python3
"""Local server for the reader front end (web/).

    python3 scripts/serve.py [--port 8000]   then open http://localhost:8000/
    python3 scripts/serve.py --host 0.0.0.0  also reachable from other devices on the network

Routes:
  /                    web/index.html (and other files under web/)
  /api/book/<n>        JSON: title, audio URL and verses (text, paraphrase, timings,
                       and per-word paraphrase equivalents where aligned; Homeric words
                       sharing a paraphrase word, e.g. a verb in tmesis, share a group id;
                       Murray's English per line where split, else as ~5-line passages;
                       the number of scholia and commentary notes per line)
  /api/word/<b>/<l>/<i>  JSON: treebank parse of word i (whitespace chunk) of verse b.l
  /api/scholia/<b>/<l>   JSON: the ancient scholia on verse b.l, grouped by manuscript, and
                         the English commentaries (Leaf, Seymour, Benner)
  /audio/<file>        a file from recordings/, with HTTP Range support for seeking
"""
import argparse
import json
import mimetypes
import re
import sqlite3
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
RECORDINGS = ROOT / "recordings"
DB = ROOT / "data" / "iliad.sqlite"
MODEL = "mms"

mimetypes.add_type("audio/ogg", ".opus")
mimetypes.add_type("audio/webm", ".webm")
mimetypes.add_type("application/manifest+json", ".webmanifest")

# Punctuation and editorial brackets around a paraphrase word, dropped in glosses.
EDGE_PUNCT = re.compile(r"^[^\w’']+|[^\w’']+$")


def book_json(book):
    con = sqlite3.connect(DB)
    title = con.execute("SELECT title FROM books WHERE book = ?", (book,)).fetchone()
    # One recording per book; prefer the AAC (.m4a) files over older formats.
    rec = con.execute("SELECT recording FROM verse_timings WHERE book = ? AND model = ? "
                      "GROUP BY recording ORDER BY recording LIKE '%.m4a' DESC LIMIT 1",
                      (book, MODEL)).fetchone()
    timing = {line: (start, speech_end, end) for line, start, speech_end, end in con.execute(
        "SELECT line, start, speech_end, end FROM verse_timings WHERE book = ? AND model = ? AND recording = ?",
        (book, MODEL, rec[0] if rec else None))}
    rows = ([(0, title[0], None)] if title else []) + con.execute(
        "SELECT line, homer, paraphrase FROM verses WHERE book = ? ORDER BY line", (book,)).fetchall()
    # Homeric word -> its paraphrase words, keyed by the word's whitespace-chunk index.
    glosses, sharers = {}, {}
    for line, wi, para_line, para_index, word in con.execute(
            "SELECT line, word_index, para_line, para_index, para_word FROM paraphrase_links "
            "WHERE book = ? ORDER BY line, word_index, para_line, para_index", (book,)):
        glosses.setdefault(line, {}).setdefault(wi, []).append(EDGE_PUNCT.sub("", word))
        sharers.setdefault((para_line, para_index), set()).add((line, wi))
    english = dict(con.execute(
        "SELECT line, text FROM translation_lines WHERE translation = 'murray' AND book = ?", (book,)))
    modern = dict(con.execute(
        "SELECT line, text FROM translation_lines WHERE translation = 'polylas' AND book = ?", (book,)))
    # How many scholia and commentary notes each line has (one covering several lines
    # counts for each).
    scholia = {}
    for first, last in con.execute("SELECT line, line_to FROM scholia WHERE book = ? UNION ALL "
                                   "SELECT line, line_to FROM commentaries WHERE book = ?", (book, book)):
        for line in range(first, last + 1):
            scholia[line] = scholia.get(line, 0) + 1
    # Passages only where the lines aren't split yet.
    translation = [{"from": a, "to": b, "text": t} for a, b, t in con.execute(
        "SELECT line_from, line_to, text FROM translation_passages "
        "WHERE translation = 'murray' AND book = ? ORDER BY line_from", (book,))
        if not all(line in english for line in range(a, b + 1))]
    con.close()
    groups = word_groups(sharers.values())
    if not rows:
        return None
    verses = [{"line": line, "text": text, "paraphrase": paraphrase, "english": english.get(line),
               "modern": modern.get(line),
               **({"scholia": scholia[line]} if line in scholia else {}),
               **(dict(zip(("start", "speechEnd", "end"), timing[line])) if line in timing else {}),
               **({"glosses": {i: " ".join(w) for i, w in glosses[line].items()}} if line in glosses else {}),
               **({"groups": groups[line]} if line in groups else {})}
              for line, text, paraphrase in rows]
    return {"book": book, "audio": f"/audio/{rec[0]}" if rec else None, "verses": verses,
            "translation": translation}


# Sources shown in the scholia panel, in order: (id, siglum, name, language). The
# manuscripts of the ancient scholia (scholia.source), then the English commentaries
# (commentaries.source).
SCHOLIA_SOURCES = [
    ("A", "A", "Venetus A", "grc"), ("A-int", "A", "Venetus A, interlinear", "grc"),
    ("B", "B", "Venetus B", "grc"), ("B-rec", "B", "Venetus B, later hand", "grc"),
    ("T", "T", "Townleianus", "grc"), ("T-rec", "T", "Townleianus, later hand", "grc"),
    ("Leaf", "Leaf", "Commentary on the Iliad (1900)", "en"),
    ("Seymour", "Seymour", "Commentary, Books I–VI (1891)", "en"),
    ("Benner", "Benner", "Selections from the Iliad (1903)", "en"),
]
# "μῆνιν] παρὰ τὸ μένω …": the lemma (the words commented on) and the note.
LEMMA = re.compile(r"([^\]]{1,90})\]\s*(.*)", re.S)


def scholia_json(book, line):
    con = sqlite3.connect(DB)
    rows = con.execute("SELECT line, line_to, source, text FROM scholia "
                       "WHERE book = ? AND line <= ? AND line_to >= ? ORDER BY seq", (book, line, line)).fetchall()
    comm = con.execute("SELECT line, line_to, source, parts FROM commentaries "
                       "WHERE book = ? AND line <= ? AND line_to >= ? ORDER BY seq", (book, line, line)).fetchall()
    con.close()
    notes = {}
    for first, last, source, text in rows:
        m = LEMMA.fullmatch(text)
        notes.setdefault(source, []).append({
            "lemma": m[1].strip() if m else None, "text": m[2] if m else text,
            **({"from": first, "to": last} if first != last else {})})
    for first, last, source, parts in comm:  # styled runs: l = lemma, i = italic, t = text
        notes.setdefault(source, []).append({
            "parts": json.loads(parts), **({"from": first, "to": last} if first != last else {})})
    return {"book": book, "line": line,
            "sources": [{"id": sid, "siglum": siglum, "name": name, "lang": lang, "notes": notes[sid]}
                        for sid, siglum, name, lang in SCHOLIA_SOURCES if sid in notes]}


# AGDT dependency labels; suffixes _CO (coordinated) and _AP (in apposition).
RELATIONS = {
    "PRED": "predicate", "SBJ": "subject", "OBJ": "object", "ATR": "attribute",
    "ADV": "adverbial", "ATV": "complement", "AtvV": "complement", "PNOM": "predicate nominal",
    "OCOMP": "object complement", "COORD": "coordinator", "APOS": "apposition",
    "AuxP": "preposition", "AuxC": "subordinating conjunction", "AuxY": "sentence particle",
    "AuxZ": "emphasizing particle", "AuxV": "auxiliary verb", "AuxX": "comma", "AuxK": "end punctuation",
    "AuxG": "bracket", "ExD": "external (e.g. vocative, ellipsis)", "XSEG": "word fragment",
}


def relation_label(rel):
    if not rel:
        return None
    base, *suffixes = rel.split("_")
    label = RELATIONS.get(base, base)
    if "AP" in suffixes:
        label += ", in apposition"
    if "CO" in suffixes:
        label += ", coordinated"
    return label


def word_json(book, line, index):
    con = sqlite3.connect(DB)
    verse = con.execute("SELECT homer FROM verses WHERE book = ? AND line = ?", (book, line)).fetchone()
    if not verse or not 0 <= index < len(verse[0].split(" ")):
        return None
    gloss = [w for (w,) in con.execute(
        "SELECT para_word FROM paraphrase_links WHERE book = ? AND line = ? AND word_index = ? "
        "ORDER BY para_line, para_index", (book, line, index))]
    tokens = []
    for (form, lemma, definition, pos, person, number, tense, mood, voice, gender, case, degree,
         relation, head, sentence_id, match) in con.execute(
            "SELECT t.form, t.lemma, d.definition, t.pos, t.person, t.number, t.tense, t.mood, t.voice, "
            "t.gender, t.gram_case, t.degree, t.relation, t.head, t.sentence_id, w.match "
            "FROM word_links w JOIN tokens t ON t.seq = w.token_seq "
            "LEFT JOIN lemma_defs d ON d.lemma = t.lemma "
            "WHERE w.book = ? AND w.line = ? AND w.word_index = ? ORDER BY t.seq", (book, line, index)):
        head_word = con.execute("SELECT form, artificial FROM tokens WHERE sentence_id = ? AND word_id = ?",
                                (sentence_id, head)).fetchone() if head else None
        tokens.append({
            "form": form, "lemma": lemma, "definition": definition, "match": match,
            # Verbs read "3rd singular aorist indicative active", nominals "feminine singular accusative".
            "morph": [m for m in ((pos, person, number, tense, mood, voice, gender, case, degree) if person
                                  else (pos, tense, mood, voice, gender, number, case, degree)) if m],
            "relation": relation, "role": relation_label(relation),
            "head": None if not head else "(implied word)" if head_word and head_word[1] else
                    head_word[0] if head_word else None,
            "root": head == 0,
        })
    con.close()
    return {"word": verse[0].split(" ")[index], "gloss": " ".join(EDGE_PUNCT.sub("", w) for w in gloss) or None,
            "tokens": tokens}


def word_groups(sharer_sets):
    """Join Homeric words (line, word_index) that share any paraphrase word into
    groups (union-find). Returns {line: {word_index: group_id}} for groups of 2+."""
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for words in sharer_sets:
        first, *rest = words
        for w in rest:
            parent[find(w)] = find(first)
    members = {}
    for w in parent:
        members.setdefault(find(w), []).append(w)
    out = {}
    for gid, ws in enumerate(m for m in members.values() if len(m) > 1):
        for line, wi in ws:
            out.setdefault(line, {})[wi] = gid
    return out


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def do_GET(self):
        if m := re.fullmatch(r"/api/book/(\d+)", self.path):
            self.send_json(book_json(int(m[1])))
        elif m := re.fullmatch(r"/api/word/(\d+)/(\d+)/(\d+)", self.path):
            self.send_json(word_json(*map(int, m.groups())))
        elif m := re.fullmatch(r"/api/scholia/(\d+)/(\d+)", self.path):
            self.send_json(scholia_json(*map(int, m.groups())))
        elif self.path.startswith("/audio/"):
            self.send_audio(RECORDINGS / Path(self.path[len("/audio/"):]).name)
        else:
            super().do_GET()

    def send_json(self, data):
        if data is None:
            return self.send_error(HTTPStatus.NOT_FOUND)
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_audio(self, path):
        """Serve a recording, honouring a single byte Range (browsers seek with these)."""
        if not path.is_file():
            return self.send_error(HTTPStatus.NOT_FOUND)
        size = path.stat().st_size
        start, end = 0, size - 1
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m and (m[1] or m[2]):
            if m[1]:
                start, end = int(m[1]), int(m[2]) if m[2] else size - 1
            else:  # suffix range: last N bytes
                start = max(0, size - int(m[2]))
            end = min(end, size - 1)
            if start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                return self.end_headers()
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with path.open("rb") as f:
            f.seek(start)
            remaining = end - start + 1
            try:
                while remaining and (chunk := f.read(min(1 << 16, remaining))):
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the browser cancelled the request (normal when seeking)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1",
                    help="address to listen on (0.0.0.0: reachable from other devices, e.g. a phone)")
    args = ap.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Reader on http://localhost:{args.port}/  (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
