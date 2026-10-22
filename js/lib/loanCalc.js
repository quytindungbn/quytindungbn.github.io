// Máy tính lãi vay (menu "Tính lãi vay") — phần thuần, không đụng DOM/mạng, kiểm thử bằng node: tests/loanCalc.test.mjs.
// Quy ước đúng như lãi cộng dồn trong hợp đồng: lãi kỳ = dư nợ × lãi suất năm × số ngày thực tế ÷ 365 (365 ngày/năm, kể cả năm nhuận),
// mỗi kỳ làm tròn MỘT lần đến hàng nghìn đồng (500 trở lên làm tròn lên).

export const DAYS_PER_YEAR = 365;
const MAX_MONTHS = 600;

/** Cộng `n` tháng vào ngày, giữ nguyên ngày trong tháng; tháng ngắn hơn thì lùi về ngày cuối tháng (31/01 + 1 tháng = 28 hoặc 29/02). */
export function addMonths(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
  d.setDate(Math.min(date.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
}

export function daysBetween(a, b) {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

/** Lãi 1 kỳ làm tròn đến nghìn đồng, tính bằng số nguyên lớn để không sai ngưỡng 500 do số thực. `rate` là %/năm (có thể có số lẻ, VD 10.34). */
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

/**
 * Tính theo THỜI HẠN vay: `months` kỳ tháng, mỗi kỳ trả đúng 1 lần cuối kỳ.
 * method: 'equalPrincipal' (gốc chia đều mỗi tháng, lãi theo dư nợ giảm dần) |
 *         'annuity' (số tiền gốc + lãi mỗi tháng gần bằng nhau, kỳ cuối điều chỉnh cho đủ) |
 *         'bullet' (lãi trả hàng tháng, toàn bộ gốc trả ở kỳ cuối).
 * Trả về { rows, totals } — mỗi dòng: { k, from, to, days, opening, interest, principal, payment, closing }.
 */
export function scheduleByTerm({ principal, ratePercent, months, startDate, method = 'equalPrincipal' }) {
  const P = Math.round(Number(principal)), N = Math.round(Number(months));
  if (!(P > 0) || !(Number(ratePercent) > 0) || !(N >= 1) || N > MAX_MONTHS) return null;
  const periods = [];
  for (let k = 1; k <= N; k++) {
    const from = addMonths(startDate, k - 1), to = addMonths(startDate, k);
    periods.push({ k, from, to, days: daysBetween(from, to) });
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
  if (method === 'bullet') rows = run((p) => (p.k === N ? P : 0));
  else if (method === 'annuity') {
    // Tìm số tiền trả mỗi tháng (làm tròn nghìn) sao cho kỳ cuối còn nợ ít nhất mà không âm: chia đôi trên đoạn [0, P + lãi cả kỳ].
    let lo = 0, hi = P * 2;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      let b = P;
      for (const p of periods) b = b + periodInterest(b, ratePercent, p.days) - mid;
      if (b > 0) lo = mid; else hi = mid;
    }
    const pay = Math.ceil(hi / 1000) * 1000;
    rows = run((p, balance, interest) => Math.max(0, pay - interest));
  } else {
    const each = roundThousand(P / N);
    rows = run(() => each);
  }
  return { rows, totals: totals(rows) };
}

/**
 * Tính theo SỐ TIỀN TRẢ HÀNG THÁNG: trả đều `payment` mỗi tháng tới khi hết nợ → ra số tháng.
 * kind: 'gocLai' — `payment` là tổng gốc + lãi mỗi tháng (gốc = payment − lãi) |
 *       'goc'    — `payment` chỉ là tiền gốc mỗi tháng, lãi cộng thêm theo dư nợ giảm dần.
 * Trả về { rows, totals } hoặc { error: 'khong_du_tra_lai', firstInterest } khi số tiền trả không đủ lãi tháng đầu (gốc không giảm), hoặc null nếu dữ liệu sai.
 */
export function scheduleByPayment({ principal, ratePercent, payment, startDate, kind = 'gocLai' }) {
  const P = Math.round(Number(principal)), X = Math.round(Number(payment));
  if (!(P > 0) || !(Number(ratePercent) > 0) || !(X > 0)) return null;
  const firstDays = daysBetween(startDate, addMonths(startDate, 1));
  const firstInterest = periodInterest(P, ratePercent, firstDays);
  if (kind === 'gocLai' && X <= firstInterest) return { error: 'khong_du_tra_lai', firstInterest };
  let balance = P; const rows = [];
  for (let k = 1; balance > 0; k++) {
    if (k > MAX_MONTHS) return { error: 'qua_dai', firstInterest };
    const from = addMonths(startDate, k - 1), to = addMonths(startDate, k), days = daysBetween(from, to);
    const interest = periodInterest(balance, ratePercent, days);
    const pr = Math.min(balance, kind === 'goc' ? X : X - interest);
    rows.push({ k, from, to, days, opening: balance, interest, principal: pr, payment: interest + pr, closing: balance - pr });
    balance -= pr;
  }
  return { rows, totals: totals(rows), firstInterest };
}
