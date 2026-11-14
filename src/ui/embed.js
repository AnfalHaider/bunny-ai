/**
 * Panel mode for the settings-style pages.
 *
 * The Settings window in the chat page shows these pages inside an iframe:
 *   settings.html?embed=1&section=appearance   one section of Settings
 *   providers.html?embed=1                     the whole Providers page
 * In panel mode the page drops its own title and back links, and when a
 * section is named, every other <section data-section> is hidden.
 */
export function applyEmbed() {
  const params = new URLSearchParams(location.search);
  if (params.get('embed') !== '1') return false;
  document.documentElement.classList.add('embedded');
  const section = params.get('section');
  if (section) {
    for (const node of document.querySelectorAll('section[data-section]')) {
      if (node.dataset.section !== section) node.hidden = true;
    }
  }
  // Links that would navigate away open in the parent window instead.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.getAttribute('href').startsWith('#')) return;
    e.preventDefault();
    window.parent.postMessage({ type: 'bunny:navigate', href: a.getAttribute('href') }, location.origin);
  });
  return true;
}
