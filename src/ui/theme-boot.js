// Runs before the page is drawn (a plain script in <head>): puts the last chosen theme on the page at once, so a page that loads or reloads is never light for a moment
// and then dark. The real setting still arrives from the server (applyAppearance); this is only the last known value, kept by applyTheme.
(function () {
  try {
    var t = localStorage.getItem('bunny.theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* storage blocked: the stylesheet follows the system until the setting arrives */ }
})();
