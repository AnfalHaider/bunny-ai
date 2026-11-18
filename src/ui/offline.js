// The "Bunny is not running" page asks the server whether it is back (the health answer needs no token) and goes to the app when it is.
(() => {
  const check = async () => { try { const r = await fetch('/api/health', { cache: 'no-store' }); if (r.ok) location.replace('/'); } catch { /* still not running */ } };
  setInterval(check, 3000);
})();
