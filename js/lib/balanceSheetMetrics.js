export function compareBalance(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base)) return null;
  const amount = current - base;
  return { amount, percent: base === 0 ? (amount === 0 ? 0 : null) : amount / Math.abs(base) * 100 };
}

export function priorYearEndReport(reports, yearMonth) {
  const year = Number(yearMonth?.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  return reports.find((report) => report.year_month === `${year - 1}-12`) || null;
}
