export const DAYS_PER_YEAR = 365;
const MAX_MONTHS = 600;

export function addMonths(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
  d.setDate(Math.min(date.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
}

export function daysBetween(a, b) {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

export function periodsUntil(startDate, endDate) {
  if (!(daysBetween(startDate, endDate) >= 1)) return 0;
  for (let k = 1; k <= MAX_MONTHS; k++) if (daysBetween(addMonths(startDate, k), endDate) <= 0) return k;
  return 0;
}

export function periodInterest(balance, ratePercent, days) {
  const b = Number(balance), r = Number(ratePercent), d = Number(days);
  if (![b, r, d].every(Number.isFinite) || b <= 0 || r <= 0 || d <= 0) return 0;
  const [rn, rd] = fraction(r);
  const numerator = BigInt(Math.round(b)) * BigInt(Math.round(d)) * rn;
  const denominator = rd * 100n * BigInt(DAYS_PER_YEAR) * 1000n;
  const thousands = numerator / denominator;
  return Number((thousands + ((numerator % denominator) * 2n >= denominator ? 1n : 0n)) * 1000n);
}

function fraction(value) {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, decimal = ''] = mantissa.split('.');
  const digits = BigInt(whole + decimal);
  const scale = decimal.length - Number(exponent);
  return scale >= 0 ? [digits, 10n ** BigInt(scale)] : [digits * 10n ** BigInt(-scale), 1n];
}

const roundThousand = (n) => Math.round(n / 1000) * 1000;

function totals(rows) {
  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
  return { months: rows.length, days: sum('days'), interest: sum('interest'), principal: sum('principal'), payment: sum('payment') };
}

export function scheduleByTerm({ principal, ratePercent, months, startDate, method = 'equalPrincipal', fixedAmount = null, endDate = null }) {
  const P = Math.round(Number(principal));
  const end = endDate instanceof Date && !Number.isNaN(endDate.getTime()) ? endDate : null;
  const periods = [];
  if (end) {
    if (!(daysBetween(startDate, end) >= 1)) return null;
    for (let k = 1; k <= MAX_MONTHS + 1; k++) {
      const from = addMonths(startDate, k - 1);
      let to = addMonths(startDate, k);
      const isLast = daysBetween(to, end) <= 0;
      if (isLast) to = end;
      periods.push({ k, from, to, days: daysBetween(from, to) });
      if (isLast) break;
    }
  }
  const N = end ? periods.length : Math.round(Number(months));
  if (!(P > 0) || !(Number(ratePercent) > 0) || !(N >= 1) || N > MAX_MONTHS) return null;
  const fixed = Math.round(Number(fixedAmount));
  const useFixed = Number.isFinite(fixed) && fixed > 0 && N >= 2 && (method === 'equalPrincipal' || method === 'annuity');
  if (!end) {
    for (let k = 1; k <= N; k++) {
      const from = addMonths(startDate, k - 1), to = addMonths(startDate, k);
      periods.push({ k, from, to, days: daysBetween(from, to) });
    }
  }
  const run = (principalFor) => {
    let balance = P; const rows = [];
    for (const p of periods) {
      const interest = periodInterest(balance, ratePercent, p.days);
      const last = p.k === N;
      const pr = last ? balance : Math.min(balance, principalFor(p, balance, interest));
      rows.push({ ...p, opening: balance, interest, principal: pr, payment: interest + pr, closing: balance - pr });
      balance -= pr;
    }
    return rows;
  };
  let rows;
  if (useFixed && method === 'equalPrincipal') {
    if (fixed * (N - 1) >= P) return { error: 'tra_het_truoc_han', maxAmount: Math.floor((P - 1) / (N - 1)) };
    rows = run(() => fixed);
  } else if (useFixed && method === 'annuity') {
    const firstInterest = periodInterest(P, ratePercent, periods[0].days);
    if (fixed <= firstInterest) return { error: 'khong_du_tra_lai', firstInterest };
    let b = P;
    for (const p of periods.slice(0, N - 1)) {
      b = b + periodInterest(b, ratePercent, p.days) - fixed;
      if (b <= 0) return { error: 'tra_het_truoc_han' };
    }
    rows = run((p, balance, interest) => Math.max(0, fixed - interest));
  } else if (method === 'bullet') rows = run((p) => (p.k === N ? P : 0));
  else if (method === 'annuity') {

    let lo = 0, hi = P * 2;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      let b = P;
      for (const p of periods) b = b + periodInterest(b, ratePercent, p.days) - mid;
      if (b > 0) lo = mid; else hi = mid;
    }
    const pay = Math.max(1000, roundThousand(hi));
    rows = run((p, balance, interest) => Math.max(0, pay - interest));
  } else {
    const each = roundThousand(P / N);
    rows = run(() => each);
  }
  return { rows, totals: totals(rows) };
}

export function scheduleByPayment({ principal, ratePercent, payment, startDate, kind = 'gocLai', endDate = null }) {
  const P = Math.round(Number(principal)), X = Math.round(Number(payment));
  if (!(P > 0) || !(Number(ratePercent) > 0) || !(X > 0)) return null;

  const end = endDate instanceof Date && !Number.isNaN(endDate.getTime()) ? endDate : null;
  if (end && !(daysBetween(startDate, end) >= 1)) return null;
  const firstDays = daysBetween(startDate, addMonths(startDate, 1));
  const firstInterest = periodInterest(P, ratePercent, firstDays);
  const oneShot = end && daysBetween(addMonths(startDate, 1), end) <= 0;
  if (kind === 'gocLai' && X <= firstInterest && !oneShot) return { error: 'khong_du_tra_lai', firstInterest };
  let balance = P; const rows = [];
  for (let k = 1; balance > 0; k++) {
    if (k > MAX_MONTHS) return { error: 'qua_dai', firstInterest };
    const from = addMonths(startDate, k - 1);
    let to = addMonths(startDate, k);
    const lastByDate = !!end && daysBetween(to, end) <= 0;
    if (lastByDate) to = end;
    const days = daysBetween(from, to);
    const interest = periodInterest(balance, ratePercent, days);
    const pr = lastByDate ? balance : Math.min(balance, kind === 'goc' ? X : X - interest);
    rows.push({ k, from, to, days, opening: balance, interest, principal: pr, payment: interest + pr, closing: balance - pr });
    balance -= pr;
  }
  return { rows, totals: totals(rows), firstInterest };
}
