/**
 * W3-3, the Auto middle way: in Auto mode Bunny runs build actions without asking, except these three,
 * which still ask the person before they run:
 *   - building a new tool                 (create_tool)
 *   - a schedule that may change things   (schedule_task with may_change === true)
 *   - adding a local connector, which runs a program on this computer (add_connector with a non-empty command)
 * Everything else that is a build action (computer-use clicks and typing, for one) runs without asking in Auto.
 */
export function asksInAuto(name, args) {
  if (name === 'create_tool') return true;
  if (name === 'schedule_task') return args?.may_change === true;
  if (name === 'add_connector') return String(args?.command ?? '').trim() !== '';
  return false;
}
