export function restoreLeadingInstallment(entries, { principal, balance, disbursedYear }) {
  if (!entries.length || !Number.isFinite(disbursedYear)) return entries;
  const amountPaid = (Number(principal) || 0) - (Number(balance) || 0);
  const missing = (Number(principal) || 0) - entries.reduce((sum, e) => sum + e.amount, 0);
  if (entries[0].year === disbursedYear + 2 && missing > 0 && missing <= amountPaid) {
    return [{ year: disbursedYear + 1, amount: missing, restored: true }, ...entries];
  }
  return entries;
}

export function mergeInstallmentSchedule(existing, incoming) {
  const years = Object.keys(incoming || {}).map(Number).filter(Number.isFinite);
  if (!years.length) return existing || null;
  const firstYear = Math.min(...years);
  const merged = {};
  for (const [year, amount] of Object.entries(existing || {})) {
    if (Number(year) < firstYear && Number(amount) > 0) merged[year] = Number(amount);
  }
  for (const [year, amount] of Object.entries(incoming)) merged[year] = amount;
  return merged;
}
