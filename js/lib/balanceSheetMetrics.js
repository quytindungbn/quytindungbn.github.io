export function compareBalance(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base)) return null;
  const amount = current - base;
  return { amount, percent: base === 0 ? (amount === 0 ? 0 : null) : amount / Math.abs(base) * 100 };
}

export function yearOpeningReport(reports, yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) return null;
  return reports.find((report) => report.year_month === `${yearMonth.slice(0, 4)}-01`) || null;
}
