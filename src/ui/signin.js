// BROWSER step 2: the sign-in page of a device that is not signed in yet. It sends the passcode to this server only; nothing is stored in the page.
(() => {
  const form = document.getElementById('form');
  const input = document.getElementById('passcode');
  const go = document.getElementById('go');
  const msg = document.getElementById('msg');
  let timer = null;
  const WHY_UNREACHED = 'Bunny could not be reached at this address. If it has changed, open the address shown in Bunny on the computer.';
  if (new URLSearchParams(location.search).has('signedout')) { msg.textContent = 'You were signed out: it was idle too long, or Bunny was turned off and on. Sign in again.'; msg.style.color = 'var(--dim)'; }
  const say = (text) => { msg.textContent = text; msg.style.color = ''; };
  const wait = (seconds) => {
    clearInterval(timer);
    let left = seconds;
    go.disabled = true;
    const tick = () => { if (left <= 0) { clearInterval(timer); go.disabled = false; say(''); return; } say(`Wait ${left} second${left === 1 ? '' : 's'} and try again.`); left -= 1; };
    tick();
    timer = setInterval(tick, 1000);
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (go.disabled) return;
    go.disabled = true;
    say('');
    try {
      const res = await fetch('/api/remote/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: input.value }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { location.replace('/'); return; }
      input.value = '';
      const seconds = Number(res.headers.get('retry-after'));
      if (seconds > 0) wait(seconds); else { say(String(body.message ?? `Sign-in did not work (the answer was ${res.status}). Check the address and try again.`)); go.disabled = false; }
    } catch {
      say(WHY_UNREACHED + ' Is Bunny still running on the computer?');
      go.disabled = false;
    }
  });
})();
