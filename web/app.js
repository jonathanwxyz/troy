// Iliad reader: shows a book's Homeric text and highlights the verse being recited.
const BOOK = Number(new URLSearchParams(location.search).get("book") || 1);
const GREEK_NUMERALS = ["", "Α", "Β", "Γ", "Δ", "Ε", "Ζ", "Η", "Θ", "Ι", "Κ", "Λ", "Μ",
                        "Ν", "Ξ", "Ο", "Π", "Ρ", "Σ", "Τ", "Υ", "Φ", "Χ", "Ψ", "Ω"];

const audio = document.getElementById("audio");
const list = document.getElementById("verses");
const position = document.getElementById("position");
const follow = document.getElementById("follow");
const showParaphrase = document.getElementById("show-paraphrase");
const showTranslation = document.getElementById("show-translation");
const gloss = document.getElementById("gloss");
const holdOnHover = document.getElementById("hold-on-hover");
const card = document.getElementById("card");
const cardBody = document.getElementById("card-body");

let verses = [];   // {line, text, start, speechEnd, end, el}, timed ones in recording order
let current = -1;  // index into verses
let lastUserScroll = 0;
let passages = [];    // {from, to, el}: Murray's English passages
let activePassage = null;

// Pause on hover: hold playback at the end of the verse whose text the pointer is on.
const entryOf = new WeakMap();  // verse <li> -> its entry in verses
let hovered = null;   // verse entry under the pointer
let heldBy = null;    // verse we paused at because it was hovered
let released = null;  // verse the reader resumed by hand while hovering: don't hold it again

function render(data) {
  document.getElementById("book-title").textContent = `Ῥαψῳδία ${GREEK_NUMERALS[data.book] || data.book}`;
  document.title = `Iliad ${data.book} — Reader`;
  if (data.audio) audio.src = data.audio;

  const frag = document.createDocumentFragment();
  for (const v of data.verses) {
    const li = document.createElement("li");
    li.className = "verse" + (v.line === 0 ? " title" : "") + (v.start == null ? " untimed" : "");
    const num = document.createElement("span");
    num.className = "num" + (v.line % 5 === 0 && v.line > 0 ? "" : " hidden");
    num.textContent = v.line > 0 ? v.line : "";
    const text = document.createElement("span");
    text.className = "text";
    if (v.line > 0) {
      // One span per whitespace chunk; chunk indices match word_links/paraphrase_links.word_index.
      v.text.split(" ").forEach((chunk, i) => {
        if (i) text.append(" ");
        const w = document.createElement("span");
        w.className = "w";
        w.textContent = chunk;
        w.dataset.line = v.line;
        w.dataset.index = i;
        if (v.glosses) w.dataset.gloss = v.glosses[i] ?? "—";
        if (v.groups?.[i] != null) w.dataset.group = v.groups[i];
        text.append(w);
      });
    } else {
      text.textContent = v.text;
    }
    li.append(num, text);
    if (v.paraphrase) {
      const para = document.createElement("span");
      para.className = "para";
      para.lang = "grc";
      para.textContent = v.paraphrase;
      li.append(para);
    }
    if (v.english) {
      const en = document.createElement("span");
      en.className = "en";
      en.lang = "en";
      en.textContent = v.english;
      li.append(en);
    }
    const entry = { ...v, el: li };
    entryOf.set(li, entry);
    if (v.start != null) {
      li.addEventListener("click", () => seekTo(verses.indexOf(entry)));
      verses.push(entry);
    }
    frag.append(li);
  }
  list.append(frag);
  verses.sort((a, b) => a.start - b.start);

  // Each English passage goes after the last verse it translates.
  const verseEl = new Map(data.verses.map((v, i) => [v.line, list.children[i]]));
  for (const p of data.translation ?? []) {
    const after = verseEl.get(p.to) ?? verseEl.get(Math.max(...[...verseEl.keys()].filter((l) => l <= p.to)));
    if (!after) continue;
    const li = document.createElement("li");
    li.className = "trans";
    li.lang = "en";
    const lines = document.createElement("span");
    lines.className = "lines";
    lines.textContent = p.from === p.to ? `${p.from}` : `${p.from}–${p.to}`;
    li.append(lines, p.text);
    li.addEventListener("click", () => seekTo(verses.findIndex((v) => v.line === p.from)));
    after.after(li);
    passages.push({ ...p, el: li });
  }
}

// Index of the verse whose span [start, end) contains t (binary search).
function verseAt(t) {
  let lo = 0, hi = verses.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (verses[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

function update() {
  const t = audio.currentTime;
  const i = verseAt(t);
  if (i !== current) {
    if (current >= 0) verses[current].el.classList.remove("current", "pausing");
    current = i;
    if (i >= 0) {
      const el = verses[i].el;
      el.classList.add("current");
      if (follow.checked && Date.now() - lastUserScroll > 4000) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }
  const line = i >= 0 ? verses[i].line : null;
  const p = passages.find((q) => line >= q.from && line <= q.to) ?? null;
  if (p !== activePassage) {
    activePassage?.el.classList.remove("active");
    activePassage = p;
    p?.el.classList.add("active");
  }
  if (i >= 0) {
    const v = verses[i];
    holdIfHovered(v, t);
    v.el.classList.toggle("pausing", t >= v.speechEnd);
    position.textContent = (v.line === 0 ? "title" : `${BOOK}.${v.line}`) + (heldBy === v ? " · held" : "");
  } else {
    position.textContent = "—";
  }
}

function holdIfHovered(v, t) {
  if (released && released !== v) released = null;
  if (holdOnHover.checked && !audio.paused && v === hovered && v !== released && t >= v.speechEnd) {
    audio.pause();
    heldBy = v;
    v.el.classList.add("held");
  }
}

function clearHold() {
  heldBy?.el.classList.remove("held");
  heldBy = null;
}

function seekTo(i) {
  if (i < 0 || i >= verses.length) return;
  clearHold();
  released = null;  // replaying a verse while hovering it should hold at its end again
  audio.currentTime = verses[i].start;
  lastUserScroll = 0;  // a deliberate jump: let the view follow again
  update();
  if (audio.paused) audio.play();
}

// Smooth highlighting while playing; timeupdate alone fires only ~4 times a second.
function tick() {
  update();
  if (!audio.paused) requestAnimationFrame(tick);
}
audio.addEventListener("play", () => {
  if (heldBy) { released = heldBy; clearHold(); }  // resumed by hand while still hovering
  requestAnimationFrame(tick);
});
audio.addEventListener("seeked", update);
audio.addEventListener("timeupdate", update);

// Paraphrase toggle, remembered per browser (storage may be unavailable).
function applyParaphrase() {
  document.body.classList.toggle("hide-paraphrase", !showParaphrase.checked);
  gloss.hidden = true;
  try { localStorage.setItem("showParaphrase", showParaphrase.checked ? "1" : "0"); } catch {}
  if (current >= 0 && follow.checked) verses[current].el.scrollIntoView({ block: "center" });
}
try { if (localStorage.getItem("showParaphrase") === "0") showParaphrase.checked = false; } catch {}

function applyTranslation() {
  document.body.classList.toggle("show-translation", showTranslation.checked);
  try { localStorage.setItem("showTranslation", showTranslation.checked ? "1" : "0"); } catch {}
  if (current >= 0 && follow.checked) verses[current].el.scrollIntoView({ block: "center" });
}
try { showTranslation.checked = localStorage.getItem("showTranslation") === "1"; } catch {}
showTranslation.addEventListener("change", applyTranslation);
applyTranslation();
showParaphrase.addEventListener("change", applyParaphrase);
applyParaphrase();

// Word glosses: with the paraphrase hidden, hovering a Homeric word shows its equivalent.
// Words sharing a paraphrase word (e.g. κατὰ … ἔκηα → κατέκαυσα) light up together.
function linkGroup(w, on) {
  if (w.dataset.group == null) return;
  for (const el of list.querySelectorAll(`.w[data-group="${w.dataset.group}"]`)) {
    el.classList.toggle("linked", on);
  }
}

list.addEventListener("mouseover", (e) => {
  const w = e.target.closest(".w");
  if (!w || showParaphrase.checked || w.dataset.gloss == null) return;
  linkGroup(w, true);
  gloss.textContent = w.dataset.gloss;
  gloss.classList.toggle("none", w.dataset.gloss === "—");
  gloss.hidden = false;
  const r = w.getBoundingClientRect(), g = gloss.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left + r.width / 2 - g.width / 2), innerWidth - g.width - 8);
  const above = r.top - g.height - 8;
  gloss.style.left = `${left + scrollX}px`;
  gloss.style.top = `${(above > 8 ? above : r.bottom + 8) + scrollY}px`;
});
list.addEventListener("mouseout", (e) => {
  const w = e.target.closest(".w");
  if (!w) return;
  linkGroup(w, false);
  if (!e.relatedTarget?.closest?.(".w")) gloss.hidden = true;
});
window.addEventListener("scroll", () => { gloss.hidden = true; }, { passive: true });

// Parsing card: clicking a word shows its treebank analysis (instead of seeking).
let selected = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const MATCH_NOTES = {
  orthographic: "Perseus spells it slightly differently",
  movable_nu: "Perseus prints it without movable ν",
  joined: "Perseus treats this and its neighbour as one word",
  variant: "Perseus has a different reading here",
};

function renderCard(data) {
  cardBody.replaceChildren();
  cardBody.append(el("h2", null, data.word.replace(/^[^\p{L}]+|[^\p{L}’'᾽]+$/gu, "")));
  if (data.gloss) {
    const g = el("p", "gloss-line");
    g.append(el("span", "label", "Gaza"), data.gloss);
    cardBody.append(g);
  }
  if (!data.tokens.length) {
    cardBody.append(el("p", "note", "Not in the Perseus treebank (its text leaves this line out)."));
  }
  for (const t of data.tokens) {
    const box = el("div", "token");
    if (data.tokens.length > 1 || t.match === "variant") box.append(el("div", "form", `Perseus: ${t.form}`));
    const lemma = el("div", "lemma", t.lemma ?? "(no lemma)");
    if (t.lemma) {
      const a = el("a", null, "Logeion ↗");
      a.href = `https://logeion.uchicago.edu/${encodeURIComponent(t.lemma)}`;
      a.target = "_blank";
      a.rel = "noopener";
      lemma.append(a);
    }
    box.append(lemma);
    if (t.definition) box.append(el("div", "definition", t.definition));
    if (t.morph.length) {
      const m = el("div", "morph");
      for (const f of t.morph) m.append(el("span", null, f));
      box.append(m);
    }
    if (t.role) {
      const r = el("div", "role");
      r.append(el("span", "label", "role"),
               t.root ? `${t.role} (main clause)` : t.head ? `${t.role} → ${t.head}` : t.role,
               el("code", null, t.relation));
      box.append(r);
    }
    if (MATCH_NOTES[t.match]) box.append(el("div", "note", MATCH_NOTES[t.match]));
    cardBody.append(box);
  }
}

async function openCard(w) {
  selected?.classList.remove("selected");
  selected = w;
  w.classList.add("selected");
  card.hidden = false;
  document.body.classList.add("card-open");
  try {
    const r = await fetch(`/api/word/${BOOK}/${w.dataset.line}/${w.dataset.index}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (selected === w) renderCard(data);
  } catch (err) {
    if (selected === w) cardBody.replaceChildren(el("p", "note", `Could not load: ${err.message}`));
  }
}

function closeCard() {
  selected?.classList.remove("selected");
  selected = null;
  card.hidden = true;
  document.body.classList.remove("card-open");
}

// Capture phase, so a word click doesn't also reach the verse's seek handler.
list.addEventListener("click", (e) => {
  const w = e.target.closest(".w");
  if (!w) return;
  e.stopPropagation();
  w === selected ? closeCard() : openCard(w);
}, true);
document.getElementById("card-close").addEventListener("click", closeCard);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selected) closeCard(); });

// Track which verse's text the pointer is on; leaving a held verse resumes playback.
list.addEventListener("mouseover", (e) => {
  const text = e.target.closest(".text");
  if (text) hovered = entryOf.get(text.closest(".verse")) ?? null;
});
list.addEventListener("mouseout", (e) => {
  const text = e.target.closest(".text");
  if (!text || text.contains(e.relatedTarget)) return;
  hovered = null;
  if (heldBy) {
    clearHold();
    audio.play();
  }
});

try { holdOnHover.checked = localStorage.getItem("holdOnHover") === "1"; } catch {}
holdOnHover.addEventListener("change", () => {
  try { localStorage.setItem("holdOnHover", holdOnHover.checked ? "1" : "0"); } catch {}
  if (!holdOnHover.checked) { clearHold(); update(); }
});

// Don't fight the reader: pause auto-follow for a few seconds after a manual scroll.
for (const ev of ["wheel", "touchmove"]) {
  window.addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true });
}

document.getElementById("prev").addEventListener("click", () => {
  // Within the first 1.5 s of a verse, go to the previous one; otherwise restart this one.
  const i = verseAt(audio.currentTime);
  seekTo(i > 0 && audio.currentTime - verses[i].start < 1.5 ? i - 1 : Math.max(i, 0));
});
document.getElementById("next").addEventListener("click", () => seekTo(verseAt(audio.currentTime) + 1));

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, audio")) return;
  if (e.key === " ") { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); document.getElementById("prev").click(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); document.getElementById("next").click(); }
});

fetch(`/api/book/${BOOK}`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((data) => { render(data); update(); })
  .catch((err) => {
    list.textContent = `Could not load book ${BOOK}: ${err.message}`;
  });
