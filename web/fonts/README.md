# Fonts

The fonts for the Greek text, served from this site rather than from Google Fonts, so the
page doesn't wait on another server before it can draw. The files are Google Fonts' WOFF2
builds, split by script (Greek, Greek Extended, Latin, Latin Extended); the top of `../style.css`
declares them, and a browser downloads only the parts a page uses.

| Font | Files | Licence |
| --- | --- | --- |
| Gentium Book Plus (SIL International) | `gentium-book-plus-*` | [OFL-gentiumbookplus.txt](OFL-gentiumbookplus.txt) |
| EB Garamond (The EB Garamond Project Authors) | `eb-garamond-*` | [OFL-ebgaramond.txt](OFL-ebgaramond.txt) |
| GFS Didot (Greek Font Society) | `gfs-didot-*` | [OFL-gfsdidot.txt](OFL-gfsdidot.txt) |

All three are under the SIL Open Font License 1.1, which allows them to be bundled and
redistributed with software.
