export function compareBalance(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base)) return null;
  const amount = current - base;
  return { amount, percent: base === 0 ? (amount === 0 ? 0 : null) : amount / Math.abs(base) * 100 };
}

export function yearOpeningReport(reports, yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) return null;
  return reports.find((report) => report.year_month === `${yearMonth.slice(0, 4)}-01`) || null;
}

/** Ghép các tài khoản của ba mốc để tài khoản vừa về 0 vẫn hiện mức giảm. */
export function accountDetailChanges(endLines, startLines, yearLines) {
  if (!Array.isArray(endLines)) return null;
  const sources = [endLines, startLines, yearLines];
  const id = (line) => `${line.code}\u0000${line.residual ? 'residual' : 'account'}`;
  const maps = sources.map((lines) => Array.isArray(lines)
    ? new Map(lines.map((line) => [id(line), line])) : null);
  const details = new Map();
  for (const lines of sources) {
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      const key = id(line);
      if (!details.has(key)) details.set(key, line);
    }
  }
  return [...details].map(([key, detail]) => ({
    ...detail,
    balance: maps[0].get(key)?.balance ?? 0,
    startBalance: maps[1] ? (maps[1].get(key)?.balance ?? 0) : undefined,
    yearBalance: maps[2] ? (maps[2].get(key)?.balance ?? 0) : undefined,
  }));
}

export function provisionDifference(balance, required) {
  return Number.isFinite(balance) && Number.isFinite(required) ? balance - required : null;
}

export function nextProvisionDeadline(yearMonth) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth || '')) return null;
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5));
  const nextMonth = month === 12 ? 1 : month + 1;
  return `07/${String(nextMonth).padStart(2, '0')}/${month === 12 ? year + 1 : year}`;
}

/** Tỷ số lũy kế theo số dư cuối kỳ; lợi nhuận đã được cộng vào vốn chủ sở hữu. */
export function managementRatios(end) {
  if (!end) return null;
  const profit = Number(end.profit);
  const equity = Number(end.equity);
  const assets = Number(end.assets);
  const loans = Number(end.grossLoans);
  const deposits = Number(end.customerDeposits);
  const ownCapital = Number.isFinite(equity) && Number.isFinite(profit) ? equity + profit : null;
  const divide = (numerator, denominator, scale = 1) =>
    Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator * scale : null;
  return {
    ownCapital,
    roe: divide(profit, ownCapital, 100),
    roa: divide(profit, assets, 100),
    loanDeposit: divide(loans, deposits, 100),
    depositCapital: divide(deposits, ownCapital),
  };
}
