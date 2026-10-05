#!/usr/bin/env python3
"""Score a candidate Homer -> paraphrase alignment file against a reference one.

    compare_alignments.py REFERENCE.txt CANDIDATE.txt [-v]

Both files use the format of data/paraphrase_alignment/*.txt and are resolved
to word positions exactly as the loader does. Only lines present in the
reference are scored. -v lists the Homeric words where the two disagree.
"""
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

from align_words import site_chunks
from import_paraphrase_alignment import DB, load_verses, resolve


def links_by_word(rows, lines):
    """{(book, line, word_index): {(para_line, para_index), ...}} for the given lines."""
    out = defaultdict(set)
    for b, l, wi, _, pl, pi, _ in rows:
        if (b, l) in lines:
            out[(b, l, wi)].add((pl, pi))
    return out


def main():
    args = [a for a in sys.argv[1:] if a != "-v"]
    ref_path, cand_path = map(Path, args)
    verses = load_verses(sqlite3.connect(DB))
    ref_rows, ref_err, _ = resolve([ref_path], verses)
    cand_rows, cand_err, _ = resolve([cand_path], verses)

    lines = {r[:2] for r in ref_rows}
    ref = links_by_word(ref_rows, lines)
    cand = links_by_word(cand_rows, lines)

    # Every word of the scored lines, so words both sides leave unaligned ("= -") count as agreement.
    homer_words = {(b, l, i) for b, l in lines for i, _ in site_chunks(verses[(b, l)][0])}
    words = {(b, l, i): w for b, l in lines for i, w in site_chunks(verses[(b, l)][0])}
    ref_pairs = {(k, p) for k, ps in ref.items() for p in ps}
    cand_pairs = {(k, p) for k, ps in cand.items() for p in ps}
    tp = len(ref_pairs & cand_pairs)
    precision = tp / len(cand_pairs) if cand_pairs else 0
    recall = tp / len(ref_pairs) if ref_pairs else 0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0

    exact = sum(1 for k in homer_words if ref.get(k, set()) == cand.get(k, set()))
    overlap = sum(1 for k in homer_words if ref.get(k) and ref.get(k) & cand.get(k, set()))
    with_ref = sum(1 for k in homer_words if ref.get(k))

    print(f"{cand_path.name} vs {ref_path.name}: {len(lines)} lines")
    print(f"  format problems        {len(cand_err)}")
    print(f"  links                  reference {len(ref_pairs)}, candidate {len(cand_pairs)}, shared {tp}")
    print(f"  link precision         {precision:.1%}")
    print(f"  link recall            {recall:.1%}")
    print(f"  link F1                {f1:.1%}")
    print(f"  Homeric words, same set of paraphrase words    {exact}/{len(homer_words)} ({exact / len(homer_words):.1%})")
    print(f"  Homeric words, at least one shared link        {overlap}/{with_ref} ({overlap / with_ref:.1%})")
    if "-v" in sys.argv:
        para = {k: v[1].split() if v[1] else [] for k, v in verses.items()}

        def show(ps, b):
            return " ".join(para[(b, pl)][pi] + ("" if pl == l else f"[{b}.{pl}]") for pl, pi in sorted(ps)) or "-"

        if cand_err:
            print("\nFormat problems:", *cand_err, sep="\n  ")
        print("\nDisagreements (reference | candidate):")
        for k in sorted(homer_words):
            b, l, wi = k
            if ref.get(k, set()) != cand.get(k, set()):
                print(f"  {b}.{l} {words[k]}: {show(ref.get(k, set()), b)} | {show(cand.get(k, set()), b)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
