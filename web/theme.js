// Theme button and text size menu, shared by the library (index.html) and the reader
// (read.html).
{
  // Theme switch: automatic (the system's choice) -> light -> dark, remembered per browser.
  // Each page applies the stored theme before it draws (a script in its <head>).
  const themeButton = document.getElementById("theme");
  const THEMES = ["auto", "light", "dark"];
  const THEME_NAMES = { auto: "automatic (as the system)", light: "light", dark: "dark" };
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)");
  function showTheme() {
    const mode = document.documentElement.dataset.theme ?? "auto";
    themeButton.dataset.mode = mode;
    themeButton.title = `Theme: ${THEME_NAMES[mode]}. Click to change.`;
    // The phone's status bar (installed app) takes the page's background colour.
    const dark = mode === "dark" || (mode === "auto" && !!systemDark?.matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1d1a16" : "#fdf6e3");
  }
  systemDark?.addEventListener?.("change", showTheme);
  themeButton.addEventListener("click", () => {
    const mode = THEMES[(THEMES.indexOf(themeButton.dataset.mode) + 1) % THEMES.length];
    if (mode === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    try { localStorage.setItem("theme", mode); } catch {}
    showTheme();
  });
  showTheme();

  // Text size menu (Aa): the reader's text (verses, card, scholia) and the interface (the
  // bars; all of the library), each a step smaller or larger, remembered per browser.
  // Each page's <head> applies the stored sizes before it draws; a change fires "sizechange".
  const SIZES = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.7];
  const sizePicker = document.getElementById("size-picker");
  const sizeButton = document.getElementById("size-button");
  const sizeMenu = document.getElementById("size-menu");

  function sizeOf(row) {
    const v = parseFloat(document.documentElement.style.getPropertyValue(row.dataset.prop)) || 1;
    // The nearest step, in case the stored value isn't one.
    return SIZES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  }
  function showSizes() {
    for (const row of sizeMenu.querySelectorAll(".size-row")) {
      const v = sizeOf(row);
      row.querySelector(".size-value").textContent = `${Math.round(v * 100)}%`;
      row.querySelector('[data-step="-1"]').disabled = v === SIZES[0];
      row.querySelector('[data-step="1"]').disabled = v === SIZES.at(-1);
    }
  }
  sizeMenu.addEventListener("click", (e) => {
    const step = e.target.closest(".size-step");
    if (!step) return;
    const row = step.closest(".size-row");
    const i = SIZES.indexOf(sizeOf(row)) + Number(step.dataset.step);
    const v = SIZES[Math.min(Math.max(i, 0), SIZES.length - 1)];
    document.documentElement.style.setProperty(row.dataset.prop, v);
    try { localStorage.setItem(row.dataset.key, String(v)); } catch {}
    showSizes();
    document.dispatchEvent(new Event("sizechange"));
  });
  function closeSizes() {
    if (sizeMenu.hidden) return;
    sizeMenu.hidden = true;
    sizeButton.setAttribute("aria-expanded", "false");
  }
  sizeButton.addEventListener("click", () => {
    if (!sizeMenu.hidden) return closeSizes();
    showSizes();
    sizeMenu.hidden = false;
    sizeButton.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("pointerdown", (e) => { if (!sizePicker.contains(e.target)) closeSizes(); });
  sizePicker.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sizeMenu.hidden) { e.preventDefault(); closeSizes(); sizeButton.focus(); }
  });
}
