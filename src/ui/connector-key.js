// The "paste your key" box of a remote connector (Settings, Customize): the header name the service asks for and a PASSWORD field for the key. Window only (the server refuses a device). The key goes to Bunny's own
// server over this page's connection, is kept in the secret store on this computer, is sent only to this connector's own address, and is never shown again: the list shows only the header's name and that a key is set.

/** The words under the box, with the host the key will go to. */
export const keyNote = (server) => `Paste the key ${server.name} gave you. Bunny keeps it on this computer, sends it only to ${String(server.url ?? '').replace(/^https?:\/\//, '').split('/')[0]}, and never shows it again.`;

/**
 * @param {{ server: object, doc?: Document, save: (header: string, value: string) => Promise<unknown>, done: () => void, cancel: () => void }} o
 */
export function keyBox({ server, doc = document, save, done, cancel }) {
  const box = doc.createElement('span');
  box.className = 'cz-signin-note cz-key-box';
  const note = doc.createElement('span');
  note.textContent = keyNote(server);
  const header = doc.createElement('input');
  header.className = 'input'; header.type = 'text'; header.spellcheck = false; header.autocomplete = 'off';
  header.placeholder = 'Header name'; header.value = server.keyHeader || server.keyHeaders?.[0] || '';
  header.setAttribute('aria-label', `Header name for ${server.name}`);
  const key = doc.createElement('input');
  key.className = 'input'; key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false;
  key.placeholder = server.hasKey ? 'New key (the saved one is not shown)' : 'Key';
  key.setAttribute('aria-label', `Key for ${server.name}`);
  const problem = doc.createElement('span');
  problem.setAttribute('role', 'alert'); problem.className = 'err'; problem.hidden = true;
  const go = doc.createElement('button');
  go.type = 'button'; go.className = 'btn btn-primary btn-sm'; go.textContent = 'Save key';
  const no = doc.createElement('button');
  no.type = 'button'; no.className = 'btn btn-sm'; no.textContent = 'Cancel';
  const submit = async () => {
    const h = header.value.trim(); const v = key.value;
    if (!h || !v.trim()) { problem.textContent = 'Type the header name and paste the key.'; problem.hidden = false; return; }
    go.disabled = true;
    try { await save(h, v); key.value = ''; done(); } catch (err) { key.value = ''; problem.textContent = String(err?.message ?? 'The key was not saved.').slice(0, 200); problem.hidden = false; } finally { go.disabled = false; }
  };
  go.addEventListener('click', submit);
  key.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  no.addEventListener('click', () => { key.value = ''; cancel(); });
  box.append(note, header, key, go, no, problem);
  return box;
}
