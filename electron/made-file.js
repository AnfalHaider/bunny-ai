// OFFICE-MAKE: Open, Save as… and Show in folder for a Word, Excel or PowerPoint file Bunny made in a chat with no folder. IPC only, from Bunny's own window: a page sends two ids (the chat and the
// file), never a path. The server looks the ids up under that chat's own made-files folder (window-only route), and the person chooses where Save as… puts the copy: the model never writes outside Bunny's data folder.
/**
 * @param {{ shell: { openPath: Function, showItemInFolder: Function }, dialog: { showSaveDialog: Function }, copyFile: Function,
 *           resolve: (chat: string, file: string) => Promise<{ ok: boolean, real?: string, name?: string, reason?: string }>,
 *           allowedSender: (event: object) => boolean, windowOf: (event: object) => object | null }} deps
 */
export function createMadeFile({ shell, dialog, copyFile, resolve, allowedSender, windowOf }) {
  const UUID = /^[a-f0-9-]{36}$/;
  const guarded = (job) => async (event, chat, file) => {
    if (!allowedSender(event)) return { ok: false, message: 'Not allowed' };
    if (typeof chat !== 'string' || typeof file !== 'string' || !UUID.test(chat) || !UUID.test(file)) return { ok: false, message: 'That file is not valid.' };
    let found;
    try { found = await resolve(chat, file); } catch { return { ok: false, message: 'Bunny could not look that file up.' }; }
    if (!found?.ok || !found.real) return { ok: false, message: found?.reason ?? 'That file is no longer here.' };
    return job(found, event);
  };
  return {
    open: guarded(async (found) => { const failed = await shell.openPath(found.real); return failed ? { ok: false, message: 'The file could not be opened. Use Save as… and open the copy.' } : { ok: true }; }),
    show: guarded(async (found) => { shell.showItemInFolder(found.real); return { ok: true }; }),
    save: guarded(async (found, event) => {
      const ext = String(found.name ?? '').match(/\.(docx|xlsx|pptx)$/i)?.[0] ?? '';
      const answer = await dialog.showSaveDialog(windowOf(event) ?? undefined, { title: 'Save as', defaultPath: found.name, filters: ext ? [{ name: ext.slice(1).toUpperCase(), extensions: [ext.slice(1).toLowerCase()] }] : [] });
      if (answer.canceled || !answer.filePath) return { ok: true, cancelled: true };
      try { await copyFile(found.real, answer.filePath); } catch { return { ok: false, message: 'The file could not be saved there.' }; }
      return { ok: true, saved: true };
    }),
  };
}
