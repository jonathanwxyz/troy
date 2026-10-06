// Reader: shows one book of a text and, where there is a recording, highlights the verse
// being recited. read.html?text=<slug>&book=<n>; the Iliad (text=iliad, the default) comes from
// its own API, with Gaza's paraphrase, translations, scholia and parsing. Library texts
// have only what their data offers (data.features); prose (Plato) is set as paragraphs
// with its sections (Stephanus) marked.
const PARAMS = new URLSearchParams(location.search);
const TEXT = PARAMS.get("text") || "iliad";
const BOOK = Number(PARAMS.get("book") || 1);
// Old links (?book=N, the Iliad) show the full address: ?text=iliad&book=N.
if (!PARAMS.has("text")) history.replaceState(null, "", `?${new URLSearchParams({ text: TEXT, book: BOOK })}${location.hash}`);
const API = TEXT === "iliad" ? `/api/book/${BOOK}` : `/api/text/${encodeURIComponent(TEXT)}/${BOOK}`;
let hasScholia = TEXT === "iliad";  // known for sure once the book has loaded
const FEATURES = ["audio", "paraphrase", "modern", "translation", "scholia", "words"];
// Speaker icon shown beside a verse on hover: clicking the row (not a word) goes to it.
const SEEK_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
  '<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/>' +
  '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'd="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
// Below the width that fits the scholia column, a button on each verse with scholia opens
// them in a popup instead.
const SCHOLIA_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 5h16v11H10l-4 3.5V16H4z"/>' +
  '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8 9h8M8 12.3h5"/></svg>';

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
const bookPicker = document.getElementById("book-picker");
const bookSelect = document.getElementById("book-select");
const bookMenu = document.getElementById("book-menu");

let DATA = null;   // the book as loaded
let verses = [];   // {line, text, start, speechEnd, end, el}, timed ones in recording order
let refs = [];     // {ref, el, entry}: every line or section start, for the position box
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
  DATA = data;
  const has = new Set(data.features ?? []);
  for (const f of FEATURES) document.body.classList.toggle(`no-${f}`, !has.has(f));
  if (!has.has("audio")) document.body.classList.remove("focused");  // nothing to focus on
  list.classList.toggle("prose", data.form === "prose");
  document.getElementById("eyebrow").textContent = data.eyebrow ?? data.title;
  const bookLabel = data.books.find((b) => b.n === data.book)?.label;
  document.title = `${data.title}${bookLabel ? ` · ${bookLabel}` : ""} — Reader`;
  fillBooks(data.books);
  document.getElementById("credits").replaceChildren(...(data.credits ?? []).map((c) => {
    const p = el("p", "credit", c.text);
    if (c.id) p.id = c.id;
    return p;
  }));
  hasScholia = has.has("scholia");
  document.querySelector(".sch-credit").textContent = data.notesCredit ?? "";
  if (data.audio) audio.src = data.audio;
  if (data.form === "prose") renderProse(data);
  else renderVerse(data, has);
  applyScholia();
  const first = refs.find((r) => r.ref && r.ref !== "0")?.ref;
  if (!data.audio) position.placeholder = data.cite === "section" ? `go to ${first}` : "go to line";
  if (data.cite === "section") position.title = `Type a section (e.g. ${first}) and press Enter`;
}

function renderVerse(data, has) {
  const frag = document.createDocumentFragment();
  for (const v of data.verses) {
    const li = document.createElement("li");
    li.className = "verse" + (v.line === 0 ? " title" : "") + (v.start == null ? " untimed" : "");
    const ref = v.ref ?? String(v.line);
    const num = document.createElement("span");
    num.className = "num" + (Number(ref) % 5 === 0 && Number(ref) > 0 ? "" : " hidden");
    num.textContent = v.line > 0 ? ref : "";
    const text = document.createElement("span");
    text.className = "text";
    if (v.line > 0 && has.has("words")) {
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
    setNoteKey(li, v.line, v.line, v.line === 0 ? "" : data.books.length > 1 ? `${BOOK}.${ref}` : ref);
    if (v.scholia) li.append(scholiaButton(li, `line ${ref}`, v.scholia));
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
    if (v.line > 0) refs.push({ ref, el: li, entry: v.start != null ? entry : null });
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

// Prose: a paragraph per speech (or the editor's paragraph), speaker first. Where a
// section begins, its number stands in the margin if the paragraph opens with it, and
// in the text otherwise.
function renderProse(data) {
  const frag = document.createDocumentFragment();
  let li = null, text = null, num = null, lastRef = null, notes = 0, refsIn = [];
  const close = () => {  // the paragraph's notes key: its first to last segment
    if (!li) return;
    const label = refsIn.length > 1 ? `${refsIn[0]}–${refsIn.at(-1)}` : refsIn[0] ?? lastRef ?? "";
    setNoteKey(li, Number(li.dataset.from), Number(li.dataset.to), label);
    if (notes) li.append(scholiaButton(li, label, notes));
  };
  for (const v of data.verses) {
    const opens = v.para || !text;
    if (opens) {
      close();
      li = el("li", "verse prose-para untimed");
      li.dataset.from = v.line;
      num = el("span", "num");
      text = el("span", "text");
      li.append(num, text);
      frag.append(li);
      notes = 0;
      refsIn = lastRef && !(v.ref && v.ref !== lastRef) ? [lastRef] : [];
    }
    li.dataset.to = v.line;
    notes += v.scholia ?? 0;
    if (v.ref && v.ref !== lastRef) refsIn.push(v.ref);
    if (v.speaker) text.append(el("span", "speaker", v.speaker), " ");
    const seg = el("span", "seg");
    if (v.ref && v.ref !== lastRef) {
      if (opens) num.textContent = v.ref;
      else seg.append(el("span", "ref-mark", v.ref), " ");
      refs.push({ ref: v.ref, el: opens ? text.parentNode : seg, entry: null });
      lastRef = v.ref;
    }
    seg.append(v.text);
    text.append(seg, " ");
  }
  close();
  list.append(frag);
}

// Each row knows which segments its notes are on (for the scholia panel and popup).
function setNoteKey(li, from, to, label) {
  Object.assign(li.dataset, { from, to, label });
}
function noteKey(li) {
  return li && { from: Number(li.dataset.from), to: Number(li.dataset.to), label: li.dataset.label, li };
}
function scholiaButton(li, what, count) {
  const b = el("button", "sch-btn");
  b.innerHTML = SCHOLIA_ICON;
  b.title = `Notes on ${what} (${count})`;
  b.setAttribute("aria-label", b.title);
  b.addEventListener("click", (e) => { e.stopPropagation(); openScholiaPopup(noteKey(li)); });
  return b;
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
    showScholiaFor(noteKey(verses[focusIdx].el));
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
  placeCard();  // the selected word may have moved (follow scroll, focused-mode steps)
  if (i >= 0) {
    const v = verses[i];
    v.el.classList.toggle("pausing", t >= v.speechEnd);
    showPosition((v.line === 0 ? "title" : `${BOOK}.${v.ref ?? v.line}`) + (heldBy === v ? " · held" : ""));
  } else {
    showPosition(verses.length ? "—" : "");  // no recording: the box is just for jumping
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

// A line ("40", or "1.40" in book 1), or for prose a section ("172a"; "172" is its first).
function findLine(typed) {
  const m = typed.match(/^(?:(\d+)\.)?(\d+)$/);
  if (!m || (m[1] && Number(m[1]) !== BOOK)) return null;
  const line = Number(m[2]);
  const lines = refs.filter((r) => Number(r.ref) > 0);
  const last = lines.at(-1);
  // Past the end of the book: its last line.
  return lines.find((r) => Number(r.ref) === line) ?? (last && line > Number(last.ref) ? last : null);
}
function findSection(typed) {
  const m = typed.toLowerCase().replace(/[\s.§]+/g, "").match(/^(\d+)([a-e]?)$/);
  if (!m) return null;
  return refs.find((r) => r.ref === m[1] + (m[2] || "a")) ?? refs.find((r) => r.ref.startsWith(m[1])) ?? null;
}

function jumpToTyped() {
  const typed = position.value.trim();
  const target = DATA?.cite === "section" ? findSection(typed) : findLine(typed);
  if (!target) {
    position.classList.add("invalid");
    position.select();
    return;
  }
  position.blur();
  if (target.entry) seekTo(verses.indexOf(target.entry), { play: false });
  target.el.scrollIntoView({ block: "center", behavior: "smooth" });
  target.el.classList.remove("located");
  void target.el.offsetWidth;  // restart the highlight if it is still running
  target.el.classList.add("located");
  setTimeout(() => target.el.classList.remove("located"), 1800);
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
const scholiaCache = new Map();  // "from-to" -> response promise
let scholiaShown = null;         // "from-to" of the line(s) the panel shows
let scholiaFolded = new Set();
try { scholiaFolded = new Set(JSON.parse(localStorage.getItem("scholiaFolded")) ?? []); } catch {}

function fetchScholia(key) {
  const id = `${key.from}-${key.to}`;
  if (!scholiaCache.has(id)) {
    const url = TEXT === "iliad" ? `/api/scholia/${BOOK}/${key.from}`
      : `/api/notes/${encodeURIComponent(TEXT)}/${BOOK}/${id}`;
    scholiaCache.set(id, fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((err) => { scholiaCache.delete(id); throw err; }));
  }
  return scholiaCache.get(id);
}

function renderScholia(data) {
  scholiaBody.replaceChildren();
  scholiaBody.scrollTop = 0;
  if (!data.sources.length) scholiaBody.append(el("p", "note", TEXT === "iliad" ? "No scholia on this line." : "No notes here."));
  for (const src of data.sources) {
    const box = el("details", "sch-src");
    box.open = !scholiaFolded.has(src.id);
    box.dataset.src = src.id;
    box.lang = src.lang;
    const sum = el("summary");
    sum.append(el("span", "siglum", src.siglum), src.name, el("span", "count", src.notes.length));
    box.append(sum);
    for (const n of src.notes) {
      const p = el("p", "sch");
      if (n.from != null) p.append(el("span", "range", `${n.from}–${n.to}`));
      if (n.parts) {  // a commentary note: styled runs (l = lemma, i = italic, t = text)
        for (const [kind, text] of n.parts) {
          p.append(kind === "l" ? el("span", "lemma", text) : kind === "i" ? el("i", null, text) : text);
        }
      } else {
        if (n.lemma) p.append(el("span", "lemma", `${n.lemma}]`), " ");
        p.append(n.text);
      }
      box.append(p);
    }
    box.addEventListener("toggle", () => {
      box.open ? scholiaFolded.delete(src.id) : scholiaFolded.add(src.id);
      try { localStorage.setItem("scholiaFolded", JSON.stringify([...scholiaFolded])); } catch {}
    });
    scholiaBody.append(box);
  }
}

// Screens too narrow for the scholia column use the per-verse buttons and a popup instead
// of the toggle (the breakpoint matches style.css).
const scholiaPopupMode = window.matchMedia?.("(max-width: 89.99rem)");
const popupMode = () => !!scholiaPopupMode?.matches;

let notedRow = null;  // without a recording: the row the notes are on, marked in the text
function loadScholia(key) {
  const id = `${key.from}-${key.to}`;
  scholiaShown = id;
  notedRow?.classList.remove("noted");
  notedRow = DATA && !DATA.audio ? key.li : null;
  notedRow?.classList.add("noted");
  scholiaLine.textContent = key.label;
  if (TEXT === "iliad" && !key.from) {  // the spoken title
    scholiaBody.replaceChildren(el("p", "note", "The scholia begin at line 1."));
    return;
  }
  fetchScholia(key)
    .then((data) => { if (scholiaShown === id) renderScholia(data); })
    .catch((err) => {
      if (scholiaShown === id) scholiaBody.replaceChildren(el("p", "note", `Could not load: ${err.message}`));
    });
}

// The panel follows the current verse (toggle mode, wider screens); without a recording,
// the line or paragraph at the reading position, or the one last clicked.
function showScholiaFor(key) {
  if (!hasScholia || !showScholia.checked || popupMode() || !key || `${key.from}-${key.to}` === scholiaShown) return;
  loadScholia(key);
}

function readingRow() {
  const r = list.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, innerHeight * 0.4)?.closest?.("li.verse");
  return hit && list.contains(hit) ? hit : null;
}
let clickedAt = 0;
window.addEventListener("scroll", () => {
  if (DATA && !DATA.audio && Date.now() - clickedAt > 1500) showScholiaFor(noteKey(readingRow()));
}, { passive: true });
list.addEventListener("click", (e) => {
  if (!DATA || DATA.audio || e.target.closest(".sch-btn")) return;
  const li = e.target.closest("li.verse");
  if (!li) return;
  clickedAt = Date.now();
  showScholiaFor(noteKey(li));
});

// Popup (narrower screens): pauses the recording, as reading them takes a while.
function openScholiaPopup(key) {
  if (heldBy) { clearHold(); update(); }
  else if (!audio.paused) audio.pause();
  closeCard();
  document.body.classList.add("scholia-popup");
  scholiaPanel.hidden = false;
  loadScholia(key);
}

function closeScholia() {
  notedRow?.classList.remove("noted");
  notedRow = null;
  if (document.body.classList.contains("scholia-popup")) {
    document.body.classList.remove("scholia-popup");
    applyScholia();
  } else {
    showScholia.checked = false;
    applyScholia();
  }
}

function applyScholia() {
  const panel = hasScholia && showScholia.checked && !popupMode();
  if (!popupMode()) document.body.classList.remove("scholia-popup");
  document.body.classList.toggle("show-scholia", panel);
  scholiaPanel.hidden = !panel && !document.body.classList.contains("scholia-popup");
  try { localStorage.setItem("showScholia", showScholia.checked ? "1" : "0"); } catch {}
  if (panel) {
    scholiaShown = null;
    if (focusIdx >= 0) showScholiaFor(noteKey(verses[focusIdx].el));
    else if (DATA && !DATA.audio) showScholiaFor(noteKey(readingRow() ?? list.querySelector("li.verse")));
  }
}
try { showScholia.checked = localStorage.getItem("showScholia") === "1"; } catch {}
showScholia.addEventListener("change", applyScholia);
scholiaPopupMode?.addEventListener?.("change", applyScholia);
document.getElementById("scholia-close").addEventListener("click", closeScholia);
// A tap outside the popup closes it (and does nothing else, e.g. doesn't seek).
document.addEventListener("click", (e) => {
  if (!document.body.classList.contains("scholia-popup") || scholiaPanel.contains(e.target)
      || e.target.closest?.(".sch-btn")) return;
  closeScholia();
  e.stopPropagation();
  e.preventDefault();
}, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("scholia-popup")) closeScholia();
});
applyScholia();
// A folded source opens with a click; its summary shouldn't keep focus (Space is play/pause).
scholiaBody.addEventListener("mousedown", (e) => { if (e.target.closest("summary")) e.preventDefault(); });

// Word glosses: hovering a Homeric word shows Gaza's equivalent. Not on touch: a tap opens
// the card, which already has it.
// Words sharing a paraphrase word (e.g. κατὰ … ἔκηα → κατέκαυσα) light up together.
function linkGroup(w, on) {
  if (w.dataset.group == null) return;
  // In focused mode only the current line lights up, not a linked word in a neighbour.
  const scope = on && focused.checked ? list.querySelector(".f-cur") ?? list : list;
  for (const el of scope.querySelectorAll(`.w[data-group="${w.dataset.group}"]`)) {
    el.classList.toggle("linked", on);
  }
}

list.addEventListener("pointerover", (e) => {
  const w = e.target.closest(".w");
  if (!w || w.dataset.gloss == null || e.pointerType === "touch") return;
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
list.addEventListener("pointerout", (e) => {
  const w = e.target.closest(".w");
  if (!w) return;
  linkGroup(w, false);
  if (!e.relatedTarget?.closest?.(".w")) gloss.hidden = true;
});
window.addEventListener("scroll", () => { gloss.hidden = true; placeCard(); }, { passive: true });

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
  placeCard();
  try {
    const r = await fetch(`/api/word/${BOOK}/${w.dataset.line}/${w.dataset.index}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (selected === w) { renderCard(data); placeCard(); }
  } catch (err) {
    if (selected === w) cardBody.replaceChildren(el("p", "note", `Could not load: ${err.message}`));
  }
}

// Small and medium screens: the card floats just above the selected word's line (below
// it when there is more room there), centred on the word and kept between the top bar
// and the player. Wide screens keep it in the right-hand margin (CSS).
const cardFloats = window.matchMedia?.("(max-width: 75.99rem)");
const CARD_GAP = 8;    // px between the card and the bars and edges
const CARD_SPACE = 20; // px between the card and the word's line
function placeCard() {
  if (card.hidden || !selected) return;
  Object.assign(card.style, { left: "", top: "", maxHeight: "" });
  if (!cardFloats?.matches) return;
  const r = selected.getBoundingClientRect();
  if (!r.width && !r.height) return closeCard();  // its verse is hidden (focused mode)
  const minTop = document.getElementById("topbar").getBoundingClientRect().bottom + CARD_GAP;
  const maxBottom = document.getElementById("player").getBoundingClientRect().top - CARD_GAP;
  // Above the whole verse, so a wrapped verse isn't half covered; failing that below it;
  // failing both (a verse at the top of the page, a long prose paragraph) beside the word's line.
  const v = selected.closest(".text")?.getBoundingClientRect() ?? r;
  const need = Math.min(card.offsetHeight, 160);
  const room = (top, bottom) => ({ above: top - CARD_SPACE - minTop, below: maxBottom - bottom - CARD_SPACE });
  let { above, below } = room(v.top, v.bottom), from = v;
  if (above < need && below < need) {
    ({ above, below } = room(r.top, r.bottom));
    from = r;
  }
  const fitsAbove = above >= need || above >= below;
  card.style.maxHeight = `${Math.max(fitsAbove ? above : below, 120)}px`;
  card.style.top = `${fitsAbove ? from.top - CARD_SPACE - card.offsetHeight : from.bottom + CARD_SPACE}px`;
  const w = card.offsetWidth;
  card.style.left = `${Math.min(Math.max(CARD_GAP, r.left + r.width / 2 - w / 2), innerWidth - w - CARD_GAP)}px`;
}
window.addEventListener("resize", placeCard);
cardFloats?.addEventListener?.("change", placeCard);

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
  if (!selected || card.contains(e.target) || e.target.closest?.(".w, #player, #focus-controls, #scholia, .sch-btn")) return;
  closeCard();
  if (list.contains(e.target)) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selected) closeCard(); });

// Track which verse's text the pointer is on; leaving a held verse resumes playback.
// On a touch screen a tap counts: the tapped verse holds until a tap elsewhere.
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

try { holdOnHover.checked = localStorage.getItem("holdOnHover") !== "0"; } catch {}  // on by default
holdOnHover.addEventListener("change", () => {
  try { localStorage.setItem("holdOnHover", holdOnHover.checked ? "1" : "0"); } catch {}
  if (!holdOnHover.checked) { clearHold(); update(); }
});

// The bars' heights, for focused mode to fit the verses between them (style.css). Their
// size on screen, which includes the Interface size (CSS zoom).
function measureBars() {
  for (const [id, name] of [["topbar", "--topbar-h"], ["player", "--player-h"]]) {
    const h = document.getElementById(id).getBoundingClientRect().height;
    document.documentElement.style.setProperty(name, `${h}px`);
  }
}
if (typeof ResizeObserver === "function") {
  const bars = new ResizeObserver(measureBars);
  for (const id of ["topbar", "player"]) bars.observe(document.getElementById(id));
}
measureBars();

// After a size change in the Aa menu (theme.js): refit focused mode, the card and the view.
document.addEventListener("sizechange", () => {
  measureBars();
  placeCard();
  if (!focused.checked && current >= 0 && follow.checked) verses[current].el.scrollIntoView({ block: "center" });
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

// Focused mode: scrolling (wheel or swipe) steps through the verses (the page itself
// doesn't scroll there).
const WHEEL_STEP = 60;      // px of wheel travel per verse
const WHEEL_LOCK_MS = 450;  // after a step, one gesture (or trackpad momentum) won't step again...
const WHEEL_QUIET_MS = 150; // ...until the wheel has been still this long
let wheelSum = 0, wheelStepAt = 0, wheelLastAt = 0;

function stepsVerses(e) {
  if (!focused.checked || !verses.length || document.body.classList.contains("no-audio")) return false;
  return !e.target.closest?.("#scholia, #card, #player, #topbar");
}
function stepBy(dir) { seekTo(Math.min(Math.max(focusIdx + dir, 0), verses.length - 1)); }

window.addEventListener("wheel", (e) => {
  if (!e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY) || !stepsVerses(e)) return;
  e.preventDefault();
  const now = Date.now();
  const quiet = now - wheelLastAt > WHEEL_QUIET_MS;
  wheelLastAt = now;
  if (quiet) wheelSum = 0;
  else if (now - wheelStepAt < WHEEL_LOCK_MS) return;
  else if (Math.abs(e.deltaY) < 4) return;  // the dying tail of trackpad momentum
  wheelSum += e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1);
  if (Math.abs(wheelSum) >= WHEEL_STEP) {
    stepBy(Math.sign(wheelSum));
    wheelSum = 0;
    wheelStepAt = now;
  }
}, { passive: false });

let touchFrom = null;  // {x, y} where a one-finger swipe began
window.addEventListener("touchstart", (e) => {
  touchFrom = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
window.addEventListener("touchmove", (e) => {
  if (!touchFrom || e.touches.length !== 1) return;
  const dy = touchFrom.y - e.touches[0].clientY;
  if (dy && stepsVerses(e)) e.preventDefault();  // no native scroll or bounce
}, { passive: false });
window.addEventListener("touchend", (e) => {
  if (!touchFrom) return;
  const t = e.changedTouches[0];
  const dx = touchFrom.x - t.clientX, dy = touchFrom.y - t.clientY;
  touchFrom = null;
  if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) && stepsVerses(e)) stepBy(Math.sign(dy));
});

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

// Focused-mode controls: previous, play/pause, next.
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
for (const b of document.querySelectorAll(".tbtn, #focus-controls button, #to-start, #theme, #size-button, .size-step, .toggle, #scholia-close, .sch-btn")) {
  b.addEventListener("mousedown", (e) => e.preventDefault());
}

// Back to the beginning of the book (keeps the play state).
document.getElementById("to-start").addEventListener("click", () => {
  seekTo(0);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// Book picker (hidden for a work in one piece): a menu of links to the other books.
function fillBooks(books) {
  bookMenu.replaceChildren(...books.map((b) => {
    const q = new URLSearchParams({ text: TEXT, book: b.n });
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(b.n === BOOK));
    const a = document.createElement("a");
    a.href = `?${q}`;
    a.textContent = b.label;
    li.append(a);
    return li;
  }));
  document.getElementById("book-label").textContent = books.find((b) => b.n === BOOK)?.label ?? "";
  bookPicker.hidden = books.length < 2;
}
function openBooks() {
  bookMenu.hidden = false;
  bookSelect.setAttribute("aria-expanded", "true");
  // Keep it on screen: shift it left if it would run off the right edge.
  bookMenu.style.left = "";
  const over = bookMenu.getBoundingClientRect().right - (innerWidth - 16);
  if (over > 0) bookMenu.style.left = `${-over}px`;
  const here = bookMenu.querySelector('[aria-selected="true"]');
  if (here) bookMenu.scrollTop = here.offsetTop - (bookMenu.clientHeight - here.offsetHeight) / 2;
  (here ?? bookMenu.firstElementChild)?.querySelector("a").focus({ preventScroll: true });
}
function closeBooks() {
  if (bookMenu.hidden) return;
  bookMenu.hidden = true;
  bookSelect.setAttribute("aria-expanded", "false");
}
bookSelect.addEventListener("click", () => (bookMenu.hidden ? openBooks() : closeBooks()));
bookMenu.addEventListener("click", (e) => { if (e.target.closest("a")) savePlace(); });
// Tapping anywhere else closes it.
document.addEventListener("pointerdown", (e) => { if (!bookPicker.contains(e.target)) closeBooks(); });
bookPicker.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !bookMenu.hidden) { e.preventDefault(); closeBooks(); bookSelect.focus(); }
  else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !bookMenu.hidden) {
    e.preventDefault();
    const links = [...bookMenu.querySelectorAll("a")];
    const i = links.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : -1);
    links[Math.min(Math.max(i, 0), links.length - 1)]?.focus();
  }
});
// Tabbing out closes it too. (A click elsewhere is left to pointerdown: Safari doesn't
// focus a clicked button, so a click on the picker's own button would look like leaving.)
bookPicker.addEventListener("focusout", (e) => {
  if (e.relatedTarget && !bookPicker.contains(e.relatedTarget)) closeBooks();
});

document.addEventListener("keydown", (e) => {
  // Typing in the line box is left alone; on a slider the arrow keys move the slider.
  if (e.target.closest?.('input[type="text"], textarea, select, #book-picker, #size-picker')) return;
  if (e.target.type === "range" && e.key.startsWith("Arrow")) return;
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); stepBack(); }
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); stepForward(); }
  else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else if ((e.key === "f" || e.key === "F") && !document.body.classList.contains("no-audio")) {
    focused.checked = !focused.checked;
    applyFocused();
  } else if ((e.key === "s" || e.key === "S") && hasScholia) {
    if (document.body.classList.contains("scholia-popup")) closeScholia();
    else if (popupMode()) { if (focusIdx >= 0 && verses[focusIdx].scholia) openScholiaPopup(noteKey(verses[focusIdx].el)); }
    else { showScholia.checked = !showScholia.checked; applyScholia(); }
  }
});

// Remember where you were: the audio position per book, saved while listening and on
// leaving, restored (paused) on the next visit; without a recording, the scroll position.
// Storage may be unavailable.
const PLACE_KEY = TEXT === "iliad" ? `place:book${BOOK}` : `place:${TEXT}:${BOOK}`;
let restored = false;  // don't overwrite the saved place before it has been restored
let lastSaved = 0;

function savePlace() {
  if (!restored) return;
  try {
    if (!DATA?.audio) localStorage.setItem(PLACE_KEY, `scroll:${Math.round(scrollY)}`);
    else if (Number.isFinite(audio.currentTime)) localStorage.setItem(PLACE_KEY, audio.currentTime.toFixed(2));
  } catch {}
  lastSaved = Date.now();
}

function restorePlace() {
  let saved = null;
  try { saved = localStorage.getItem(PLACE_KEY); } catch {}
  if (!DATA.audio) {
    const y = saved?.startsWith("scroll:") ? Number(saved.slice(7)) : 0;
    if (y > 0) window.scrollTo(0, y);
    restored = true;
    return;
  }
  const t = parseFloat(saved);
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
window.addEventListener("scroll", () => { if (!DATA?.audio && Date.now() - lastSaved > 1000) savePlace(); },
                        { passive: true });
document.addEventListener("visibilitychange", () => { if (document.hidden) savePlace(); });

// Lock screen, notification and headset controls: play/pause, and the track buttons step
// a verse.
function setupMediaSession() {
  if (!("mediaSession" in navigator) || !DATA.audio) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: DATA.books.find((b) => b.n === BOOK)?.label ?? DATA.title, artist: DATA.author ?? "",
    album: DATA.title,
    artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
  });
  const actions = {
    play: () => { if (!isPlaying()) togglePlay(); },
    pause: () => { if (isPlaying()) togglePlay(); },
    previoustrack: stepBack,
    nexttrack: stepForward,
    seekto: (d) => { clearHold(); audio.currentTime = d.seekTime; update(); },
  };
  for (const [action, handler] of Object.entries(actions)) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}  // not all are supported
  }
}

// Installable app: the service worker caches the reader for offline use (sw.js).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

fetch(API)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((data) => { render(data); update(); restorePlace(); setupMediaSession(); })
  .catch((err) => {
    list.textContent = navigator.onLine === false || err instanceof TypeError
      ? "This isn't available offline yet: open it once while online, and it will be."
      : `Could not load this text: ${err.message}`;
  });
