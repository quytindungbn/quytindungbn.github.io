export function compareBalance(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base)) return null;
  const amount = current - base;
  return { amount, percent: base === 0 ? (amount === 0 ? 0 : null) : amount / Math.abs(base) * 100 };
}

export function yearOpeningReport(reports, yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) return null;
  return reports.find((report) => report.year_month === `${yearMonth.slice(0, 4)}-01`) || null;
}

export function provisionDifference(balance, required) {
  return Number.isFinite(balance) && Number.isFinite(required) ? balance - required : null;
}

export function nextProvisionDeadline(yearMonth) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth || '')) return null;
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5));
  const nextMonth = month === 12 ? 1 : month + 1;
  return `10/${String(nextMonth).padStart(2, '0')}/${month === 12 ? year + 1 : year}`;
}
