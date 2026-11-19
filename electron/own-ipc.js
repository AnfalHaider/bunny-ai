// PREFS-OWN: one place for "is this message from Bunny's own page?", so the IPC handlers that change something say it the same way and a test can run the rule.
/**
 * @param {{ senderFrame?: { url?: string } }} event  an ipcMain event
 * @param {(url: string) => boolean} isOwn  main.js's own-address check
 * @returns {boolean} true only when the frame that sent it is one of Bunny's own pages
 */
export function fromOwnFrame(event, isOwn) {
  try { return Boolean(isOwn(String(event?.senderFrame?.url ?? ''))); } catch { return false; }
}
