/* global document, localStorage, matchMedia */
(() => {
  const key = "rocket-theme";
  let preference = "system";
  try {
    const stored = localStorage.getItem(key);
    if (stored === "system" || stored === "light" || stored === "dark") preference = stored;
  } catch {
    // Storage can be unavailable in hardened browsing modes; system is safe.
  }
  const dark = preference === "dark"
    || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePreference = preference;
})();
