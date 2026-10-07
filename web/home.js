// Library: bookmarks, then the texts by category (from /api/library), each linking to the
// reader. A work in several books goes back to the book last opened, with a menu of the
// others; a collection (a Testament) has a menu of its books, each with its chapters.
const root = document.getElementById("library");
const marksBox = document.getElementById("bookmarks");

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" ' +
  'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>';

const slugOf = (t) => (t.reader === "iliad" ? "iliad" : t.slug);
// The book to open a text at: the one last opened, if it still has it, else its first.
function bookFor(t) {
  const n = lastBook(slugOf(t));
  return t.books.some((b) => b.n === n) ? n : t.books[0]?.n ?? 1;
}
function hrefFor(t) {
  return readerHref(slugOf(t), bookFor(t));
}
// A collection opens at the text last opened in it (at that text's last book).
function memberFor(c) {
  const slug = lastText(c.collection);
  return c.texts.find((t) => slugOf(t) === slug) ?? c.texts[0];
}

// Menus: one open at a time; a tap elsewhere or Escape closes it.
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.menu.hidden = true;
  openMenu.button.setAttribute("aria-expanded", "false");
  openMenu = null;
}
function menuButton(text, menu) {
  const b = el("button", "pick");
  b.append(el("span", "pick-label", text));
  b.insertAdjacentHTML("beforeend", CHEVRON);
  b.setAttribute("aria-haspopup", "true");
  b.setAttribute("aria-expanded", "false");
  b.addEventListener("click", () => {
    if (openMenu?.menu === menu) return closeMenu();
    closeMenu();
    menu.hidden = false;
    b.setAttribute("aria-expanded", "true");
    openMenu = { menu, button: b };
    // Keep it on screen, and show the place last opened.
    menu.style.left = "";
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
    const over = menu.getBoundingClientRect().right - (innerWidth - 16);
    if (over > 0) menu.style.left = `${-over / zoom}px`;
    const here = menu.querySelector('[aria-current="true"]');
    if (here) menu.scrollTop = here.offsetTop - (menu.clientHeight - here.offsetHeight) / 2;
  });
  return b;
}
document.addEventListener("pointerdown", (e) => {
  if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.button.contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openMenu) { const b = openMenu.button; closeMenu(); b.focus(); }
});

// A text's books, as a list of links (the one last opened marked).
function bookLinks(t, cls) {
  const ul = el("ul", cls);
  const here = bookFor(t);
  for (const b of t.books) {
    const a = el("a", null, cls === "chapters" ? String(b.n) : shortLabel(b.label, b.n));
    a.href = readerHref(slugOf(t), b.n);
    if (b.label) a.title = b.label;
    if (b.n === here && lastBook(slugOf(t))) a.setAttribute("aria-current", "true");
    const li = el("li");
    li.append(a);
    ul.append(li);
  }
  return ul;
}

function workEntry(t) {
  const work = el("div", "work");
  const head = el("div", "work-head");
  const title = el("a", "work-title", t.title);
  title.href = hrefFor(t);
  head.append(title);
  if (t.author) head.append(el("span", "work-author", t.author));
  work.append(head);
  if (t.books.length > 1) {
    const menu = bookLinks(t, "menu");
    menu.hidden = true;
    const here = t.books.find((b) => b.n === bookFor(t));
    const picker = el("div", "work-pick");
    picker.append(menuButton(shortLabel(here?.label, here?.n ?? 1), menu), menu);
    head.append(picker);
  }
  return work;
}

// A collection (a Testament): its title opens the book last read in it; the menu lists
// its books, each opening at the chapter last read, with its chapters under a toggle.
function collectionEntry(c) {
  const work = el("div", "work collection");
  const head = el("div", "work-head");
  const member = memberFor(c);
  const title = el("a", "work-title", c.title);
  title.href = hrefFor(member);
  head.append(title);
  const menu = el("ul", "menu nested");
  menu.hidden = true;
  for (const t of c.texts) {
    const li = el("li", "member");
    const row = el("div", "member-row");
    const a = el("a", null, t.title);
    a.href = hrefFor(t);
    if (t === member && lastText(c.collection)) a.setAttribute("aria-current", "true");
    row.append(a);
    li.append(row);
    if (t.books.length > 1) {
      const chapters = bookLinks(t, "chapters");
      chapters.hidden = true;
      const toggle = el("button", "expand");
      toggle.innerHTML = CHEVRON;
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", `Chapters of ${t.title}`);
      toggle.addEventListener("click", () => {
        chapters.hidden = !chapters.hidden;
        toggle.setAttribute("aria-expanded", String(!chapters.hidden));
      });
      row.append(toggle);
      li.append(chapters);
    }
    menu.append(li);
  }
  const picker = el("div", "work-pick");
  picker.append(menuButton(member.title, menu), menu);
  head.append(picker);
  work.append(head);
  return work;
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
    for (const t of cat.texts) section.append(t.collection ? collectionEntry(t) : workEntry(t));
    root.append(section);
  }
}

// Bookmarks: each opens the reader at its verse; × deletes it.
function renderMarks(marks) {
  marksBox.replaceChildren();
  marksBox.hidden = !marks.length;
  if (!marks.length) return;
  marksBox.append(el("h2", null, "Bookmarks"));
  const ul = el("ul", "marks");
  for (const m of marks) {
    const li = el("li");
    const a = el("a", "mark");
    a.href = readerHref(m.text, m.book, m.ref);
    a.append(el("span", "mark-label", m.label ?? `${m.title ?? m.text} ${m.ref}`));
    if (m.snippet) a.append(el("span", "mark-snippet", m.snippet));
    const del = el("button", "mark-delete", "×");
    del.title = "Delete this bookmark";
    del.setAttribute("aria-label", `Delete the bookmark ${m.label ?? m.ref}`);
    del.addEventListener("click", async () => {
      del.disabled = true;
      try {
        await bookmarksApi.remove(m.id);
        li.remove();
        if (!ul.children.length) marksBox.hidden = true;
      } catch {
        del.disabled = false;
        del.title = "Couldn't delete it (offline?)";
      }
    });
    li.append(a, del);
    ul.append(li);
  }
  marksBox.append(ul);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

bookmarksApi.list().then(renderMarks).catch(() => renderMarks([]));
fetch("/api/library")
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then(render)
  .catch((err) => {
    root.replaceChildren(el("p", "notice", navigator.onLine === false || err instanceof TypeError
      ? "The library isn't available offline yet: open it once while online."
      : `Could not load the library: ${err.message}`));
  });

// Coming back with the back button (a page kept in memory): the places last opened, and
// the bookmarks, may have changed.
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  bookmarksApi.list().then(renderMarks).catch(() => {});
  fetch("/api/library").then((r) => r.json()).then(render).catch(() => {});
});
