/**
 * A copy of src/providers/providerOrder.js for the page (the browser can only import from src/ui); test/free-tags.test.js keeps the two equal.
 *
 * Order the providers that serve one model.
 *
 * Order, first to last:
 *   1. providers that have run out today go last (`out`)
 *   2. the person's own order for this model (`modelOrder`), then their overall order (`personOrder`)
 *   3. for providers neither list: Free, then Free daily, then the rest
 * Inside a group the input order is kept. Pure: inputs are never changed.
 *
 * @param {string[]} providers
 * @param {{
 *   free?: Record<string, 'free'|'daily'|null|undefined>,
 *   personOrder?: string[],
 *   modelOrder?: string[],
 *   out?: Record<string, boolean> | Set<string>,
 * }} [opts]
 * @returns {string[]}
 */
export function orderProviders(providers, { free = {}, personOrder = [], modelOrder = [], out = {} } = {}) {
  const isOut = (id) => (out instanceof Set ? out.has(id) : Boolean(out?.[id]));
  const explicit = (id) => {
    const m = modelOrder.indexOf(id);
    if (m !== -1) return m;
    const p = personOrder.indexOf(id);
    return p === -1 ? Infinity : modelOrder.length + p;
  };
  const group = (id) => {
    const kind = free[id];
    if (kind === 'free') return 0;
    if (kind === 'daily') return 1;
    return 2;
  };

  return [...providers]
    .map((id, index) => ({ id, index, outFlag: isOut(id) ? 1 : 0, rank: explicit(id), grp: group(id) }))
    .sort((a, b) =>
      a.outFlag - b.outFlag
      || (a.rank === b.rank ? 0 : a.rank < b.rank ? -1 : 1)
      || a.grp - b.grp
      || a.index - b.index)
    .map((row) => row.id);
}
