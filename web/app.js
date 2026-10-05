// Iliad reader: shows a book's Homeric text and highlights the verse being recited.
const BOOK = Number(new URLSearchParams(location.search).get("book") || 1);
// Speaker icon shown beside a verse on hover: clicking the row (not a word) goes to it.
const SEEK_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
  '<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/>' +
  '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'd="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
const GREEK_NUMERALS = ["", "Α", "Β", "Γ", "Δ", "Ε", "Ζ", "Η", "Θ", "Ι", "Κ", "Λ", "Μ",
                        "Ν", "Ξ", "Ο", "Π", "Ρ", "Σ", "Τ", "Υ", "Φ", "Χ", "Ψ", "Ω"];

const audio = document.getElementById("audio");
const list = document.getElementById("verses");
const position = document.getElementById("position");
const follow = document.getElementById("follow");
const showParaphrase = document.getElementById("show-paraphrase");
const showTranslation = document.getElementById("show-translation");
const showModern = document.getElementById("show-modern");
const gloss = document.getElementById("gloss");
const holdOnHover = document.getElementById("hold-on-hover");
const focused = document.getElementById("focused");
const card = document.getElementById("card");
const cardBody = document.getElementById("card-body");
const focusControls = document.getElementById("focus-controls");
const bookSelect = document.getElementById("book-select");

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
  bookSelect.value = String(data.book);
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
    if (v.start != null) {
      const icon = document.createElement("span");
      icon.className = "seek-icon";
      icon.innerHTML = SEEK_ICON;
      li.append(icon);
    }
    li.append(num, text);
    if (v.paraphrase) {
      const para = document.createElement("span");
      para.className = "para";
      para.lang = "grc";
      para.textContent = v.paraphrase;
      li.append(para);
    }
    if (v.modern) {
      const mt = document.createElement("span");
      mt.className = "mt";
      mt.lang = "el";
      mt.textContent = v.modern;
      li.append(mt);
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

// Index of the verse whose span [start, end) contains t (binary search). A position a
// hair before a verse's start counts as that verse: browsers snap a seek to the nearest
// audio frame, which can land just short of the time asked for.
const SEEK_SLACK = 0.05;  // seconds
function verseAt(t) {
  let lo = 0, hi = verses.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (verses[mid].start <= t + SEEK_SLACK) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

// Focused mode shows verses[focusIdx] with its neighbours (the first verse before playback).
// Stepping one verse animates the change: lines that stay visible glide (and grow or
// shrink) from their old place to their new one, the incoming line fades in from the
// direction of travel and the outgoing one fades out the other way.
const FOCUS_MS = 450;
const FOCUS_EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
let focusIdx = -1;

function setFocus(i) {
  if (i === focusIdx) return;
  const dir = i - focusIdx;
  const animate = document.body.classList.contains("focused") && focusIdx >= 0 && Math.abs(dir) === 1
    && typeof Element.prototype.animate === "function"
    && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const before = new Map();  // el -> {rect, font, opacity} for the lines visible before the change
  if (animate) {
    for (const k of [focusIdx - 1, focusIdx, focusIdx + 1]) {
      const el = verses[k]?.el;
      if (el) {
        const cs = getComputedStyle(el);
        before.set(el, { rect: el.getBoundingClientRect(), font: parseFloat(cs.fontSize), opacity: cs.opacity });
      }
    }
  }

  for (const k of [focusIdx - 1, focusIdx, focusIdx + 1]) verses[k]?.el.classList.remove("f-prev", "f-cur", "f-next");
  focusIdx = i;
  verses[i - 1]?.el.classList.add("f-prev");
  verses[i]?.el.classList.add("f-cur");
  verses[i + 1]?.el.classList.add("f-next");
  if (verses[i]) verses[i].el.append(focusControls);
  if (!animate) return;

  const now = [i - 1, i, i + 1].map((k) => verses[k]?.el).filter(Boolean);
  for (const el of now) {
    const b = before.get(el);
    if (b) {  // stays visible: invert the move and size change, then play it forward
      const r = el.getBoundingClientRect();
      const s = b.font / parseFloat(getComputedStyle(el).fontSize);
      el.animate([
        { transformOrigin: "top left", transform: `translate(${b.rect.left - r.left}px, ${b.rect.top - r.top}px) scale(${s})` },
        { transformOrigin: "top left", transform: "none" },
      ], { duration: FOCUS_MS, easing: FOCUS_EASE });
    } else {  // incoming
      el.animate([
        { opacity: 0, transform: `translateY(${dir * 28}px)` },
        { opacity: getComputedStyle(el).opacity, transform: "none" },
      ], { duration: FOCUS_MS, easing: FOCUS_EASE });
    }
  }
  for (const [el, b] of before) {
    if (now.includes(el)) continue;
    // Outgoing: it is hidden now, so animate a copy left where it was.
    const ghost = el.cloneNode(true);
    ghost.classList.remove("current", "pausing", "held");
    Object.assign(ghost.style, {
      position: "fixed", left: `${b.rect.left}px`, top: `${b.rect.top}px`, width: `${b.rect.width}px`,
      margin: "0", fontSize: `${b.font}px`, pointerEvents: "none", zIndex: "1",
    });
    ghost.setAttribute("aria-hidden", "true");
    document.body.append(ghost);
    ghost.animate([
      { opacity: b.opacity, transform: "none" },
      { opacity: 0, transform: `translateY(${-dir * 28}px)` },
    ], { duration: FOCUS_MS, easing: FOCUS_EASE }).onfinish = () => ghost.remove();
  }
}

function update() {
  const t = audio.currentTime;
  const i = verseAt(t);
  if (verses.length) {
    setFocus(Math.max(i, 0));
    showScholiaFor(verses[focusIdx]);
  }
  if (i !== current) {
    if (current >= 0) verses[current].el.classList.remove("current", "pausing");
    current = i;
    if (i >= 0) {
      const el = verses[i].el;
      el.classList.add("current");
      if (follow.checked && !focused.checked && Date.now() - lastUserScroll > 4000) {
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
  if (i >= 0) holdIfHovered(verses[i], t);
  skipSilence(i, t);
  document.body.classList.toggle("playing", isPlaying());
  showTimeline(audio.currentTime);
  if (i >= 0) {
    const v = verses[i];
    v.el.classList.toggle("pausing", t >= v.speechEnd);
    showPosition((v.line === 0 ? "title" : `${BOOK}.${v.line}`) + (heldBy === v ? " · held" : ""));
  } else {
    showPosition("—");
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

// A hover-hold is not a pause: logically the recording is still playing and will go on
// when the pointer moves off. Pressing pause during a hold makes it a real pause instead.
function isPlaying() {
  return !audio.paused || heldBy !== null;
}

function togglePlay() {
  if (heldBy) { clearHold(); update(); }  // stay stopped; moving off the word won't resume
  else if (audio.paused) audio.play();
  else audio.pause();
}

// Long silences (paragraph breaks, the lead-in of a recording) are cut short: once the
// pause after a verse has lasted GAP_KEEP, playback jumps to LEAD_IN before the next verse.
const GAP_KEEP = 0.9;  // seconds of silence kept after a verse
const LEAD_IN = 0.35;  // seconds of silence kept before the next verse
function skipSilence(i, t) {
  if (audio.paused || !verses.length) return;
  const next = verses[i + 1];
  if (!next) return;
  const quietSince = i >= 0 ? verses[i].speechEnd : 0;
  if (t > quietSince + GAP_KEEP && next.start - t > LEAD_IN + 0.15) audio.currentTime = next.start - LEAD_IN;
}

// Jumping keeps the play state by default: a paused reader stays paused on the new verse.
// (Evaluated before clearHold, so a hover-hold counts as playing.)
function seekTo(i, { play = isPlaying() } = {}) {
  if (i < 0 || i >= verses.length) return;
  clearHold();
  released = null;  // replaying a verse while hovering it should hold at its end again
  audio.currentTime = verses[i].start;
  lastUserScroll = 0;  // a deliberate jump: let the view follow again
  update();
  if (play && audio.paused) audio.play();
}

// Position box: shows the current line; type a line ("40" or "1.40") and Enter to jump.
function showPosition(text) {
  if (document.activeElement !== position) position.value = text;
}

function jumpToTyped() {
  const m = position.value.trim().match(/^(?:(\d+)\.)?(\d+)$/);
  const book = m && m[1] ? Number(m[1]) : BOOK;
  const line = m ? Number(m[2]) : NaN;
  let i = m && book === BOOK ? verses.findIndex((v) => v.line === line) : -1;
  // Past the end of the book: go to its last verse.
  const last = verses.reduce((a, v, k) => (v.line > verses[a].line ? k : a), 0);
  if (i < 0 && m && book === BOOK && verses.length && line > verses[last].line) i = last;
  if (i < 0) {
    position.classList.add("invalid");
    position.select();
    return;
  }
  position.blur();
  seekTo(i, { play: false });
  verses[i].el.scrollIntoView({ block: "center", behavior: "smooth" });
}

position.addEventListener("focus", () => { position.select(); });
position.addEventListener("input", () => position.classList.remove("invalid"));
position.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); jumpToTyped(); }
  else if (e.key === "Escape") { e.preventDefault(); position.blur(); }
});
position.addEventListener("blur", () => { position.classList.remove("invalid"); update(); });

// Smooth highlighting while playing; timeupdate alone fires only ~4 times a second.
function tick() {
  update();
  if (!audio.paused) requestAnimationFrame(tick);
}
audio.addEventListener("play", () => {
  if (heldBy) { released = heldBy; clearHold(); }  // resumed by hand while still hovering
  update();
  requestAnimationFrame(tick);
});
audio.addEventListener("seeked", update);
audio.addEventListener("timeupdate", update);
audio.addEventListener("pause", update);

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

function applyModern() {
  document.body.classList.toggle("show-modern", showModern.checked);
  try { localStorage.setItem("showModern", showModern.checked ? "1" : "0"); } catch {}
  if (current >= 0 && follow.checked) verses[current].el.scrollIntoView({ block: "center" });
}
try { showModern.checked = localStorage.getItem("showModern") === "1"; } catch {}
showModern.addEventListener("change", applyModern);
applyModern();
showParaphrase.addEventListener("change", applyParaphrase);
applyParaphrase();

// Scholia panel: the ancient notes on the current verse, grouped by manuscript. Sources
// the reader has folded stay folded (remembered per browser).
const showScholia = document.getElementById("show-scholia");
const scholiaPanel = document.getElementById("scholia");
const scholiaBody = document.getElementById("scholia-body");
const scholiaLine = document.getElementById("scholia-line");
const scholiaCache = new Map();  // line -> response promise
let scholiaShown = null;         // line the panel shows
let scholiaFolded = new Set();
try { scholiaFolded = new Set(JSON.parse(localStorage.getItem("scholiaFolded")) ?? []); } catch {}

function fetchScholia(line) {
  if (!scholiaCache.has(line)) {
    scholiaCache.set(line, fetch(`/api/scholia/${BOOK}/${line}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((err) => { scholiaCache.delete(line); throw err; }));
  }
  return scholiaCache.get(line);
}

function renderScholia(data) {
  scholiaBody.replaceChildren();
  scholiaBody.scrollTop = 0;
  if (!data.sources.length) scholiaBody.append(el("p", "note", "No scholia on this line."));
  for (const src of data.sources) {
    const box = el("details", "sch-src");
    box.open = !scholiaFolded.has(src.id);
    box.dataset.src = src.id;
    const sum = el("summary");
    sum.append(el("span", "siglum", src.id.split("-")[0]), src.name, el("span", "count", src.notes.length));
    box.append(sum);
    for (const n of src.notes) {
      const p = el("p", "sch");
      if (n.from != null) p.append(el("span", "range", `${n.from}–${n.to}`));
      if (n.lemma) p.append(el("span", "lemma", `${n.lemma}]`), " ");
      p.append(n.text);
      box.append(p);
    }
    box.addEventListener("toggle", () => {
      box.open ? scholiaFolded.delete(src.id) : scholiaFolded.add(src.id);
      try { localStorage.setItem("scholiaFolded", JSON.stringify([...scholiaFolded])); } catch {}
    });
    scholiaBody.append(box);
  }
}

function showScholiaFor(v) {
  if (!showScholia.checked || !v || v.line === scholiaShown) return;
  const line = scholiaShown = v.line;
  scholiaLine.textContent = line ? `${BOOK}.${line}` : "";
  if (!line) {  // the spoken title
    scholiaBody.replaceChildren(el("p", "note", "The scholia begin at line 1."));
    return;
  }
  fetchScholia(line)
    .then((data) => { if (scholiaShown === line) renderScholia(data); })
    .catch((err) => {
      if (scholiaShown === line) scholiaBody.replaceChildren(el("p", "note", `Could not load: ${err.message}`));
    });
}

function applyScholia() {
  document.body.classList.toggle("show-scholia", showScholia.checked);
  scholiaPanel.hidden = !showScholia.checked;
  try { localStorage.setItem("showScholia", showScholia.checked ? "1" : "0"); } catch {}
  scholiaShown = null;
  if (showScholia.checked && focusIdx >= 0) showScholiaFor(verses[focusIdx]);
}
try { showScholia.checked = localStorage.getItem("showScholia") === "1"; } catch {}
showScholia.addEventListener("change", applyScholia);
document.getElementById("scholia-close").addEventListener("click", () => {
  showScholia.checked = false;
  applyScholia();
});
applyScholia();
// A folded source opens with a click; its summary shouldn't keep focus (Space is play/pause).
scholiaBody.addEventListener("mousedown", (e) => { if (e.target.closest("summary")) e.preventDefault(); });

// Word glosses: hovering a Homeric word shows Gaza's equivalent.
// Words sharing a paraphrase word (e.g. κατὰ … ἔκηα → κατέκαυσα) light up together.
function linkGroup(w, on) {
  if (w.dataset.group == null) return;
  // In focused mode only the current line lights up, not a linked word in a neighbour.
  const scope = on && focused.checked ? list.querySelector(".f-cur") ?? list : list;
  for (const el of scope.querySelectorAll(`.w[data-group="${w.dataset.group}"]`)) {
    el.classList.toggle("linked", on);
  }
}

list.addEventListener("mouseover", (e) => {
  const w = e.target.closest(".w");
  if (!w || w.dataset.gloss == null) return;
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
}

// Capture phase, so a word click doesn't also reach the verse's seek handler.
list.addEventListener("click", (e) => {
  const w = e.target.closest(".w");
  if (!w) return;
  e.stopPropagation();
  w === selected ? closeCard() : openCard(w);
}, true);
document.getElementById("card-close").addEventListener("click", closeCard);

// Clicking off the card closes it (a click on another word opens that word's card instead;
// clicks in the player bar leave it open). On the text, that click only closes the card:
// it doesn't also jump the audio.
document.addEventListener("click", (e) => {
  if (!selected || card.contains(e.target) || e.target.closest?.(".w, #player, #focus-controls, #scholia")) return;
  closeCard();
  if (list.contains(e.target)) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);
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

// Focused mode toggle (F), remembered per browser.
function applyFocused() {
  document.body.classList.toggle("focused", focused.checked);
  try { localStorage.setItem("focused", focused.checked ? "1" : "0"); } catch {}
  if (focused.checked) window.scrollTo(0, 0);
  else if (current >= 0) verses[current].el.scrollIntoView({ block: "center" });
}
try { focused.checked = localStorage.getItem("focused") === "1"; } catch {}
focused.addEventListener("change", applyFocused);
applyFocused();

// Don't fight the reader: pause auto-follow for a few seconds after a manual scroll.
for (const ev of ["wheel", "touchmove"]) {
  window.addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true });
}

// Stepping keeps the play state: a paused reader stays paused on the new verse.
function stepBack() {
  // Within the first 1.5 s of a verse, go to the previous one; otherwise restart this one.
  const i = verseAt(audio.currentTime);
  seekTo(i > 0 && audio.currentTime - verses[i].start < 1.5 ? i - 1 : Math.max(i, 0));
}
function stepForward() {
  seekTo(Math.min(verseAt(audio.currentTime) + 1, verses.length - 1));
}
document.getElementById("prev").addEventListener("click", stepBack);
document.getElementById("next").addEventListener("click", stepForward);

// Focused-mode controls live inside the current row: keep their clicks from seeking it.
for (const [id, action] of [["fc-prev", stepBack], ["fc-play", togglePlay], ["fc-next", stepForward]]) {
  document.getElementById(id).addEventListener("click", (e) => { e.stopPropagation(); action(); });
}

// Media bar: play/pause (hover-hold aware), timeline and volume.
const seek = document.getElementById("seek");
const timeNow = document.getElementById("time-now");
const timeTotal = document.getElementById("time-total");
const volume = document.getElementById("volume");
let seeking = false;  // the timeline thumb is being dragged

function fmtTime(s) {
  if (!Number.isFinite(s)) return "0:00";
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
function fillRange(input) {
  const max = Number(input.max) || 1;
  input.style.setProperty("--pct", `${(Number(input.value) / max) * 100}%`);
}
function showTimeline(t) {
  if (!seeking) seek.value = t;
  timeNow.textContent = fmtTime(seeking ? Number(seek.value) : t);
  fillRange(seek);
}

document.getElementById("play").addEventListener("click", togglePlay);
audio.addEventListener("durationchange", () => {
  seek.max = audio.duration || 0;
  timeTotal.textContent = fmtTime(audio.duration);
  showTimeline(audio.currentTime);
});
seek.addEventListener("input", () => { seeking = true; showTimeline(audio.currentTime); });
seek.addEventListener("change", () => {
  seeking = false;
  clearHold();
  released = null;
  audio.currentTime = Number(seek.value);
  lastUserScroll = 0;
  update();
});

function showVolume() {
  volume.value = audio.muted ? 0 : audio.volume;
  fillRange(volume);
  document.body.classList.toggle("muted", audio.muted || audio.volume === 0);
}
volume.addEventListener("input", () => {
  audio.volume = Number(volume.value);
  audio.muted = audio.volume === 0;
});
document.getElementById("mute").addEventListener("click", () => {
  if (audio.volume === 0) audio.volume = 0.5;  // unmuting from zero: make it audible
  audio.muted = !audio.muted;
});
audio.addEventListener("volumechange", () => {
  showVolume();
  try { localStorage.setItem("volume", JSON.stringify({ v: audio.volume, m: audio.muted })); } catch {}
});
try {
  const saved = JSON.parse(localStorage.getItem("volume"));
  if (saved) { audio.volume = saved.v; audio.muted = saved.m; }
} catch {}
showVolume();

// Buttons don't keep keyboard focus after a click, so Space stays play/pause (rather
// than pressing the last-clicked button again on top of it).
for (const b of document.querySelectorAll(".tbtn, #focus-controls button, #to-start, .toggle, #scholia-close")) {
  b.addEventListener("mousedown", (e) => e.preventDefault());
}

// Back to the beginning of the book (keeps the play state).
document.getElementById("to-start").addEventListener("click", () => {
  seekTo(0);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// Book picker.
for (let b = 1; b <= 24; b++) bookSelect.add(new Option(`Ῥαψῳδία ${GREEK_NUMERALS[b]}`, String(b)));
bookSelect.value = String(BOOK);
bookSelect.addEventListener("change", () => {
  savePlace();
  location.search = `?book=${bookSelect.value}`;
});

document.addEventListener("keydown", (e) => {
  // Typing in the line box is left alone; on a slider the arrow keys move the slider.
  if (e.target.closest?.('input[type="text"], textarea, select')) return;
  if (e.target.type === "range" && e.key.startsWith("Arrow")) return;
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); stepBack(); }
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); stepForward(); }
  else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else if (e.key === "f" || e.key === "F") {
    focused.checked = !focused.checked;
    applyFocused();
  } else if (e.key === "s" || e.key === "S") {
    showScholia.checked = !showScholia.checked;
    applyScholia();
  }
});

// Remember where you were: the audio position per book, saved while listening and on
// leaving, restored (paused) on the next visit. Storage may be unavailable.
const PLACE_KEY = `place:book${BOOK}`;
let restored = false;  // don't overwrite the saved place before it has been restored
let lastSaved = 0;

function savePlace() {
  if (!restored || !Number.isFinite(audio.currentTime)) return;
  try { localStorage.setItem(PLACE_KEY, audio.currentTime.toFixed(2)); } catch {}
  lastSaved = Date.now();
}

function restorePlace() {
  let t = NaN;
  try { t = parseFloat(localStorage.getItem(PLACE_KEY)); } catch {}
  const apply = () => {
    if (t > 0 && (!audio.duration || t < audio.duration)) audio.currentTime = t;
    restored = true;
    update();
    if (current >= 0 && !focused.checked) verses[current].el.scrollIntoView({ block: "center" });
  };
  // Setting currentTime before the audio's metadata is known may be ignored.
  if (audio.readyState >= 1) apply();
  else audio.addEventListener("loadedmetadata", apply, { once: true });
}

audio.addEventListener("timeupdate", () => { if (Date.now() - lastSaved > 3000) savePlace(); });
for (const ev of ["pause", "seeked"]) audio.addEventListener(ev, savePlace);
window.addEventListener("pagehide", savePlace);
document.addEventListener("visibilitychange", () => { if (document.hidden) savePlace(); });

fetch(`/api/book/${BOOK}`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((data) => { render(data); update(); restorePlace(); })
  .catch((err) => {
    list.textContent = `Could not load book ${BOOK}: ${err.message}`;
  });
