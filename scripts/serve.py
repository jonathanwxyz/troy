#!/usr/bin/env python3
"""Local server for the reader front end (web/).

    python3 scripts/serve.py [--port 8000]   then open http://localhost:8000/

Routes:
  /                    web/index.html (and other files under web/)
  /api/book/<n>        JSON: title, audio URL and verses with their timings
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


def book_json(book):
    con = sqlite3.connect(DB)
    title = con.execute("SELECT title FROM books WHERE book = ?", (book,)).fetchone()
    rec = con.execute("SELECT recording FROM verse_timings WHERE book = ? AND model = ? LIMIT 1",
                      (book, MODEL)).fetchone()
    timing = {line: (start, speech_end, end) for line, start, speech_end, end in con.execute(
        "SELECT line, start, speech_end, end FROM verse_timings WHERE book = ? AND model = ?", (book, MODEL))}
    rows = ([(0, title[0])] if title else []) + con.execute(
        "SELECT line, homer FROM verses WHERE book = ? ORDER BY line", (book,)).fetchall()
    con.close()
    if not rows:
        return None
    verses = [{"line": line, "text": text,
               **dict(zip(("start", "speechEnd", "end"), timing[line]))} if line in timing
              else {"line": line, "text": text} for line, text in rows]
    return {"book": book, "audio": f"/audio/{rec[0]}" if rec else None, "verses": verses}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def do_GET(self):
        if m := re.fullmatch(r"/api/book/(\d+)", self.path):
            data = book_json(int(m[1]))
            if data is None:
                return self.send_error(HTTPStatus.NOT_FOUND)
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/audio/"):
            self.send_audio(RECORDINGS / Path(self.path[len("/audio/"):]).name)
        else:
            super().do_GET()

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
    args = ap.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Reader on http://localhost:{args.port}/  (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
