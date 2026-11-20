export function countChange(current, previous, { worseWhenUp = false, decimals = 0 } = {}) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const shown = (n) => Number(n.toFixed(decimals));
  const diff = Number((shown(cur) - shown(prev)).toFixed(decimals));
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const tone = dir === 'flat' ? 'flat' : (dir === 'up') !== worseWhenUp ? 'good' : 'bad';
  return { dir, tone, diff: Math.abs(diff) };
}
