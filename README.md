# Iliad Reader

A reader for Homer's *Iliad* in Greek that follows along with a recording: the verse
being recited is highlighted as it plays, and each line comes with help for reading it.

- **Gaza's paraphrase**: Theodorus Gaza's Byzantine prose paraphrase under each line;
  hovering a Homeric word shows its equivalent in the paraphrase (Book 1 so far).
- **Word cards**: click a word for its lemma, a short definition, its morphology and its
  role in the sentence (from the Perseus treebank).
- **Translations**: A. T. Murray's English (line by line in Book 1, in short passages
  elsewhere) and Iakovos Polylas's modern Greek (13 books so far).
- **σχόλια**: the ancient scholia (Venetus A and B, Townleianus) and the English
  commentaries of Leaf, Seymour and Benner on each line.
- **Focused mode**: just the current verse and its neighbours, large.
- **Listening aids**: long pauses are shortened, "pause on hover" stops at the end of the
  verse under the pointer, and the place in each book is remembered.

Keys: Space plays or pauses, ← ↑ and → ↓ step a verse, F toggles focused mode, S shows
the scholia.

## Running it

Needs Python 3 (standard library only) and, for the audio, ffmpeg.

1. Build the database, `data/iliad.sqlite`. The scripts download their sources (cached
   in `data/raw/`); run them in the order given in [data/README.md](data/README.md#rebuilding).
2. Recordings: the reader expects one per book, `recordings/iliadNN.m4a`. The readings
   used are Project Eustathios's on YouTube; data/README.md gives the `yt-dlp` command.
   They stay local, out of git.
3. Align the recordings with the text (`scripts/align_audio.py`, or
   `scripts/align_all.sh` for all 24 books). This needs PyTorch and a speech model; see
   `requirements-audio.txt`. It takes a few hours on a laptop CPU, much less on a GPU.
4. Start the server and open the page:

   ```
   python3 scripts/serve.py      # then http://localhost:8000/?book=1
   ```

## Licence

The code is under the [MIT licence](LICENSE). The texts and data the scripts download
keep their own licences, several of them CC BY-SA; [data/README.md](data/README.md#sources-and-licences)
lists each source and its terms.
