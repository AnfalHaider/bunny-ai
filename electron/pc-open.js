// SEARCH-PC SP-4: Open, Show in folder and Copy path for a search result. IPC only: there is no server route a device could call. Each takes a result REF (never a path from
// a page); the server looks the ref up and judges the path again (exclusions, real path). Open uses shell.openPath for an allow-listed kind only, judged on the real path
// (the target, never a link); everything else gets Show in folder. Never "Open with", never another verb.
/**
 * @param {{ shell: { openPath: Function, showItemInFolder: Function }, clipboard: { writeText: Function }, resolve: (ref: string) => Promise<{ ok: boolean, real?: string, openable?: boolean, reason?: string }>,
 *           allowedSender: (event: object) => boolean }} deps
 */
export function createPcOpen({ shell, clipboard, resolve, allowedSender }) {
  const guarded = (job) => async (event, ref) => {
    if (!allowedSender(event)) return { ok: false, message: 'Not allowed' };
    if (typeof ref !== 'string' || ref.length > 80) return { ok: false, message: 'That result is not valid.' };
    let found;
    try { found = await resolve(ref); } catch { return { ok: false, message: 'Bunny could not look that result up.' }; }
    if (!found?.ok || !found.real) return { ok: false, message: found?.reason ?? 'That result is no longer available.' };
    return job(found);
  };
  return {
    open: guarded(async (found) => {
      if (!found.openable) { shell.showItemInFolder(found.real); return { ok: true, shown: true, message: 'Bunny shows this kind of file in its folder instead of opening it.' }; }
      const failed = await shell.openPath(found.real);
      return failed ? { ok: false, message: 'The file could not be opened.' } : { ok: true };
    }),
    show: guarded(async (found) => { shell.showItemInFolder(found.real); return { ok: true }; }),
    copy: guarded(async (found) => { clipboard.writeText(found.real); return { ok: true }; }),
  };
}
