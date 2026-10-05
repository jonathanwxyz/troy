// Iliad reader: shows a book's Homeric text and highlights the verse being recited.
const BOOK = Number(new URLSearchParams(location.search).get("book") || 1);
const GREEK_NUMERALS = ["", "Α", "Β", "Γ", "Δ", "Ε", "Ζ", "Η", "Θ", "Ι", "Κ", "Λ", "Μ",
                        "Ν", "Ξ", "Ο", "Π", "Ρ", "Σ", "Τ", "Υ", "Φ", "Χ", "Ψ", "Ω"];

const audio = document.getElementById("audio");
const list = document.getElementById("verses");
const position = document.getElementById("position");
const follow = document.getElementById("follow");

let verses = [];   // {line, text, start, speechEnd, end, el}, timed ones in recording order
let current = -1;  // index into verses
let lastUserScroll = 0;

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
    text.textContent = v.text;
    li.append(num, text);
    if (v.start != null) {
      li.addEventListener("click", () => seekTo(verses.indexOf(entry)));
    }
    frag.append(li);
    const entry = { ...v, el: li };
    if (v.start != null) verses.push(entry);
  }
  list.append(frag);
  verses.sort((a, b) => a.start - b.start);
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
  if (i >= 0) {
    const v = verses[i];
    v.el.classList.toggle("pausing", t >= v.speechEnd);
    position.textContent = v.line === 0 ? "title" : `${BOOK}.${v.line}`;
  } else {
    position.textContent = "—";
  }
}

function seekTo(i) {
  if (i < 0 || i >= verses.length) return;
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
audio.addEventListener("play", () => requestAnimationFrame(tick));
audio.addEventListener("seeked", update);
audio.addEventListener("timeupdate", update);

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
