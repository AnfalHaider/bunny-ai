// v0.1.14 PHONE-LAYOUT: a browser without dvh units (older Android WebViews, some installed web apps) counts 100vh as the screen with the address bar hidden, so the
// bottom of the page, the composer, is cut. There the window-high app takes its height from the visual viewport instead, which is what is really visible (the keyboard too).
export function fitViewport(win = window) {
  try {
    const doc = win.document;
    if (win.CSS?.supports?.('height', '100dvh') || !win.visualViewport) return false;
    const set = () => doc.documentElement.style.setProperty('--vv-h', `${Math.round(win.visualViewport.height)}px`);
    doc.documentElement.classList.add('no-dvh');
    set();
    win.visualViewport.addEventListener('resize', set);
    win.visualViewport.addEventListener('scroll', set);
    return true;
  } catch { return false; }
}
