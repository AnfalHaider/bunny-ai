// BROWSER step 2: the sign-in page of a device that is not signed in yet. It sends the passcode to this server only; nothing is stored in the page.
(() => {
  const form = document.getElementById('form');
  const input = document.getElementById('passcode');
  const go = document.getElementById('go');
  const msg = document.getElementById('msg');
  let timer = null;
  const say = (text) => { msg.textContent = text; };
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
      if (seconds > 0) wait(seconds); else { say(String(body.message ?? 'That did not work.')); go.disabled = false; }
    } catch {
      say('Bunny could not be reached. Is it still running on the computer?');
      go.disabled = false;
    }
  });
})();
