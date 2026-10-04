#!/usr/bin/env python3
"""Link each word of the site's Homeric text (verses.homer) to its treebank
token(s) (tokens), storing the result in data/iliad.sqlite as `word_links`.

Run after parse_iliad.py and import_treebank.py.

Words are numbered by whitespace-separated chunk of `homer` (0-based), so a
reader can split the displayed line on whitespace and look up each chunk.
Matching is per line and tolerant of:
  - accents, breathings, capitalisation, elision marks   -> 'orthographic'
  - movable nu (ἔτελλεν / ἔτελλε)                        -> 'movable_nu'
  - one site word = several tokens (μηδέ / μη δέ)        -> 'split'
  - several site words = one token (πάλιν πλαγχθέντας)   -> 'joined'
  - a different reading in the same slot (ἐς / ἐν)       -> 'variant'
Site words with no counterpart get a row with token_seq NULL and match 'none'.
"""
import difflib
import re
import sqlite3
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "iliad.sqlite"

APOSTROPHES = re.compile(r"['’᾽᾿ʼ̓]")


def key(w):
    """Greek letters only: no diacritics, case, punctuation or elision mark."""
    s = unicodedata.normalize("NFD", w.lower())
    return "".join(c for c in s if "α" <= c <= "ω" or c == "ς").replace("ς", "σ")


def loose(k):
    """key() with movable nu dropped."""
    return k[:-1] if len(k) > 2 and k.endswith(("εν", "σιν", "ιν")) else k


def spelled(w):
    """Comparable spelling that keeps diacritics: decides 'exact' vs 'orthographic'."""
    w = APOSTROPHES.sub("’", unicodedata.normalize("NFC", w))
    return re.sub(r"[^\w’]", "", w)


def site_chunks(homer):
    """(chunk index, chunk) for each whitespace chunk that is part of the verse.

    Dropped: editorial notes in parentheses ('(Perseus: ...)', '(La Gaza, lispește)')
    and bracketed variants after the verse text (18.604-605). Brackets marking a
    whole line as suspect (1.265, 8.550-552) are kept.
    """
    dropped = set()
    for m in re.finditer(r"\([^)]*\)|\[[^\]]*\]", homer):
        if m[0].startswith("(") or m.start() > len(homer) - len(homer.lstrip()):
            dropped.update(range(m.start(), m.end()))
    out = []
    for i, m in enumerate(re.finditer(r"\S+", homer)):
        kept = "".join(c for p, c in enumerate(m[0], m.start()) if p not in dropped)
        if key(kept):
            out.append((i, m[0]))
    return out


def classify(site_word, token_form):
    if spelled(site_word) == spelled(token_form):
        return "exact"
    if key(site_word) == key(token_form):
        return "orthographic"
    return "movable_nu"


def align_line(site, toks):
    """site: [(chunk index, word)], toks: [(seq, form)] -> [(chunk index, word, seq|None, match)]"""
    sk = [loose(key(w)) for _, w in site]
    tk = [loose(key(f)) for _, f in toks]
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, sk, tk, autojunk=False).get_opcodes():
        S, T = site[i1:i2], toks[j1:j2]
        if op == "equal":
            out += [(ci, w, seq, classify(w, f)) for (ci, w), (seq, f) in zip(S, T)]
        elif S and T and "".join(sk[i1:i2]) == "".join(tk[j1:j2]):
            out += align_regrouped(S, T)
        elif S and len(S) == len(T):
            out += [(ci, w, seq, "variant") for (ci, w), (seq, _) in zip(S, T)]
        elif S and T and (len(S) == 1 or len(T) == 1):  # πάλιν πλαγχθέντας / παλιμπλαγχθέντας
            out += [(ci, w, seq, "variant") for ci, w in S for seq, _ in T]
        else:
            out += [(ci, w, None, "none") for ci, w in S]
    return out


def align_regrouped(S, T):
    """Same letters, different word division: walk both sides by letter count."""
    pairs, j, used = [], 0, 0  # used: letters of T[j] already consumed
    for ci, w in S:
        need = len(loose(key(w)))
        while need > 0 and j < len(T):
            size = len(loose(key(T[j][1])))
            pairs.append((ci, w, T[j][0], T[j][1]))
            take = min(need, size - used)
            need -= take
            used += take
            if used == size:
                j, used = j + 1, 0
    # A site word spanning several tokens is 'split'; site words sharing a token are 'joined'.
    tokens_of, words_of = {}, {}
    for ci, _, seq, _ in pairs:
        tokens_of.setdefault(ci, set()).add(seq)
        words_of.setdefault(seq, set()).add(ci)
    return [(ci, w, seq, "joined" if len(words_of[seq]) > 1 else "split" if len(tokens_of[ci]) > 1
             else classify(w, f)) for ci, w, seq, f in pairs]


def main():
    con = sqlite3.connect(DB)
    toks = {}
    for b, l, seq, form in con.execute(
            "SELECT book, line, seq, form FROM tokens "
            "WHERE line IS NOT NULL AND artificial IS NULL AND pos IS NOT 'punctuation' ORDER BY seq"):
        toks.setdefault((b, l), []).append((seq, form))

    rows = []
    for b, l, homer in con.execute("SELECT book, line, homer FROM verses ORDER BY book, line"):
        rows += [(b, l, *r) for r in align_line(site_chunks(homer), toks.get((b, l), []))]

    con.executescript(
        """
        DROP TABLE IF EXISTS word_links;
        CREATE TABLE word_links (
            book       INTEGER NOT NULL,
            line       INTEGER NOT NULL,
            word_index INTEGER NOT NULL,  -- 0-based whitespace chunk of verses.homer
            site_word  TEXT    NOT NULL,  -- that chunk, punctuation included
            token_seq  INTEGER REFERENCES tokens (seq),  -- NULL when no counterpart
            match      TEXT    NOT NULL   -- exact, orthographic, movable_nu, split, joined, variant, none
        );
        CREATE INDEX word_links_line ON word_links (book, line, word_index);
        CREATE INDEX word_links_token ON word_links (token_seq);
        """
    )
    con.executemany("INSERT INTO word_links VALUES (?, ?, ?, ?, ?, ?)", rows)
    con.commit()
    words = con.execute("SELECT count(DISTINCT book || '.' || line || '.' || word_index) FROM word_links").fetchone()[0]
    print(f"{words} site words linked -> {DB.relative_to(ROOT)} (word_links)")
    for match, n in con.execute(
            "SELECT match, count(DISTINCT book || '.' || line || '.' || word_index) FROM word_links "
            "GROUP BY match ORDER BY 2 DESC"):
        print(f"  {match:13} {n}")
    con.close()


if __name__ == "__main__":
    main()
