// Library: the texts, by category (from /api/library), each linking to the reader, a
// book at a time for works in several books.
const root = document.getElementById("library");

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function readerHref(text, book) {
  const q = new URLSearchParams({ text: text.reader === "iliad" ? "iliad" : text.slug, book });
  return `read.html?${q}`;
}

// A book's button: the letter at the end of its label ("Ῥαψωδία α" -> α), else its number.
function bookChip(label, n) {
  const m = label?.match(/\s(\S{1,2})$/);
  return m ? m[1] : String(n);
}

function render(data) {
  root.replaceChildren();
  if (data.missing) {
    const p = el("p", "notice");
    p.append("No library yet. Copy ", el("code", null, "library/catalogue.example.json"), " to ",
             el("code", null, "library/catalogue.json"), ", edit it, and run ",
             el("code", null, "python3 scripts/library.py"), ".");
    root.append(p);
    return;
  }
  for (const cat of data.categories) {
    const section = el("section", "category");
    section.append(el("h2", null, cat.name));
    if (!cat.texts.length) section.append(el("p", "empty", "Nothing here yet."));
    for (const t of cat.texts) {
      const work = el("div", "work");
      const head = el("div", "work-head");
      const title = t.books.length === 1 ? el("a", "work-title", t.title) : el("span", "work-title", t.title);
      if (t.books.length === 1) title.href = readerHref(t, t.books[0].n);
      head.append(title);
      if (t.author) head.append(el("span", "work-author", t.author));
      work.append(head);
      if (t.books.length > 1) {
        const books = el("div", "books");
        for (const b of t.books) {
          const a = el("a", null, bookChip(b.label, b.n));
          a.href = readerHref(t, b.n);
          a.title = b.label ?? `Book ${b.n}`;
          books.append(a);
        }
        work.append(books);
      }
      section.append(work);
    }
    root.append(section);
  }
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

fetch("/api/library")
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then(render)
  .catch((err) => {
    root.replaceChildren(el("p", "notice", navigator.onLine === false || err instanceof TypeError
      ? "The library isn't available offline yet: open it once while online."
      : `Could not load the library: ${err.message}`));
  });
