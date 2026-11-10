import { compactParts } from '../utils.js';

export function moneyChange(current, previous) {
  if (previous === null || previous === undefined || !Number.isFinite(Number(previous))) return null;
  const cur = Number(current) || 0;
  const prev = Number(previous);
  const diff = Math.round(cur - prev);
  const tone = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const { num, unit } = compactParts(Math.abs(diff));
  return {
    tone, diff, num, unit,
    sign: tone === 'up' ? '+' : tone === 'down' ? '−' : '',
    percent: prev > 0 ? (Math.abs(diff) / prev) * 100 : null,
  };
}
