import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, daysBetween, periodInterest, periodsUntil, scheduleByTerm, scheduleByPayment } from '../js/lib/loanCalc.js';

const d = (y, m, day) => new Date(y, m - 1, day);

test('lãi 1 kỳ: dư nợ × lãi suất × số ngày ÷ 365, làm tròn đến nghìn (500 trở lên làm tròn lên)', () => {
  assert.equal(periodInterest(190e6, 10.34, 8), 431000); // đúng số trên màn hình hợp đồng 318/26
  assert.equal(periodInterest(200e6, 10.34, 31), 1756000);
  assert.equal(periodInterest(81500e3, 10, 365), 8150000);
  assert.equal(periodInterest(1000, 10, 1), 0);
  assert.equal(periodInterest(0, 10, 30), 0);
  assert.equal(periodInterest(100e6, 0, 30), 0);
  // 100.000.000 × 9% × 30 ÷ 365 = 739.726,03 -> 740.000; ngưỡng đúng 500: 365.000.000 × 10% × 1 ÷ 365 = 100.000
  assert.equal(periodInterest(100e6, 9, 30), 740000);
  assert.equal(periodInterest(365e6, 10, 1), 100000);
});

test('cộng tháng giữ ngày, tháng ngắn lùi về ngày cuối tháng', () => {
  assert.deepEqual(addMonths(d(2026, 10, 22), 1), d(2026, 11, 22));
  assert.deepEqual(addMonths(d(2027, 1, 31), 1), d(2027, 2, 28));
  assert.deepEqual(addMonths(d(2028, 1, 31), 1), d(2028, 2, 29));
  assert.deepEqual(addMonths(d(2026, 12, 15), 2), d(2027, 2, 15));
  assert.equal(daysBetween(d(2026, 10, 22), d(2027, 10, 22)), 365);
});

test('theo thời hạn, lãi hàng tháng - gốc cuối kỳ: 12 tháng, gốc trả một lần ở kỳ cuối', () => {
  const r = scheduleByTerm({ principal: 200e6, ratePercent: 10.34, months: 12, startDate: d(2026, 10, 22), method: 'bullet' });
  assert.equal(r.rows.length, 12);
  assert.equal(r.totals.days, 365);
  assert.equal(r.totals.principal, 200e6);
  assert.deepEqual(r.rows.slice(0, 11).map((x) => x.principal), Array(11).fill(0));
  assert.equal(r.rows[11].principal, 200e6);
  assert.equal(r.rows[11].closing, 0);
  assert.equal(r.rows[0].interest, 1756000); // 31 ngày
  assert.equal(r.totals.interest, r.rows.reduce((s, x) => s + x.interest, 0));
});

test('theo thời hạn, gốc chia đều: gốc mỗi tháng bằng nhau, lãi giảm dần, kỳ cuối hết nợ', () => {
  const r = scheduleByTerm({ principal: 200e6, ratePercent: 10.34, months: 12, startDate: d(2026, 10, 22), method: 'equalPrincipal' });
  assert.equal(r.totals.principal, 200e6);
  assert.equal(r.rows[0].principal, 16667000);
  assert.equal(r.rows[11].closing, 0);
  assert.ok(r.rows[0].interest > r.rows[5].interest && r.rows[5].interest > r.rows[10].interest);
  for (const x of r.rows) assert.equal(x.payment, x.interest + x.principal);
});

test('theo thời hạn, gốc + lãi đều: các tháng gần bằng nhau, kỳ cuối điều chỉnh, tổng gốc đúng số vay', () => {
  const r = scheduleByTerm({ principal: 200e6, ratePercent: 10.34, months: 12, startDate: d(2026, 10, 22), method: 'annuity' });
  assert.equal(r.totals.principal, 200e6);
  assert.equal(r.rows[11].closing, 0);
  const first = r.rows[0].payment;
  for (const x of r.rows.slice(0, 11)) assert.ok(Math.abs(x.payment - first) <= 2000, `kỳ ${x.k}: ${x.payment} lệch ${first}`);
  assert.ok(r.rows[11].payment <= first + 2000 && r.rows[11].payment > 0);
});

test('theo số tiền trả hàng tháng (gốc + lãi): ra số tháng, kỳ cuối trả phần còn lại', () => {
  const r = scheduleByPayment({ principal: 200e6, ratePercent: 10.34, payment: 20e6, startDate: d(2026, 10, 22), kind: 'gocLai' });
  assert.equal(r.rows.length, 11);
  assert.equal(r.totals.principal, 200e6);
  assert.equal(r.rows[0].payment, 20e6);
  assert.equal(r.rows[0].interest, 1756000);
  assert.equal(r.rows[0].principal, 18244000);
  assert.equal(r.rows[10].closing, 0);
  assert.ok(r.rows[10].payment < 20e6);
  assert.equal(r.firstInterest, 1756000);
});

test('theo số tiền trả hàng tháng (chỉ gốc): lãi cộng thêm, tổng trả mỗi tháng giảm dần', () => {
  const r = scheduleByPayment({ principal: 200e6, ratePercent: 10.34, payment: 20e6, startDate: d(2026, 10, 22), kind: 'goc' });
  assert.equal(r.rows.length, 10);
  assert.equal(r.rows[0].principal, 20e6);
  assert.equal(r.rows[0].payment, 20e6 + 1756000);
  assert.ok(r.rows[9].payment < r.rows[0].payment);
  assert.equal(r.totals.principal, 200e6);
});

test('số tiền trả mỗi tháng không đủ trả lãi thì báo lỗi, không lặp vô hạn', () => {
  const r = scheduleByPayment({ principal: 200e6, ratePercent: 10.34, payment: 1.5e6, startDate: d(2026, 10, 22), kind: 'gocLai' });
  assert.equal(r.error, 'khong_du_tra_lai');
  assert.equal(r.firstInterest, 1756000);
  const slow = scheduleByPayment({ principal: 200e6, ratePercent: 10.34, payment: 1800000, startDate: d(2026, 10, 22), kind: 'gocLai' });
  assert.ok(slow.rows ? slow.rows.length > 100 : slow.error === 'qua_dai');
});

test('dữ liệu không hợp lệ thì trả về null', () => {
  assert.equal(scheduleByTerm({ principal: 0, ratePercent: 10, months: 12, startDate: d(2026, 1, 1) }), null);
  assert.equal(scheduleByTerm({ principal: 1e6, ratePercent: 10, months: 0, startDate: d(2026, 1, 1) }), null);
  assert.equal(scheduleByPayment({ principal: 1e6, ratePercent: 0, payment: 1e5, startDate: d(2026, 1, 1) }), null);
});

test('gốc trả đều + tự nhập số gốc mỗi tháng: các kỳ đầu trả đúng số đó, phần còn lại trả hết ở kỳ cuối', () => {
  const r = scheduleByTerm({ principal: 200e6, ratePercent: 10.5, months: 24, startDate: d(2026, 10, 23), method: 'equalPrincipal', fixedAmount: 5e6 });
  assert.equal(r.rows.length, 24);
  assert.deepEqual(r.rows.slice(0, 23).map((x) => x.principal), Array(23).fill(5e6));
  assert.equal(r.rows[23].principal, 85e6);
  assert.equal(r.rows[23].closing, 0);
  assert.equal(r.rows[23].payment, r.rows[23].principal + r.rows[23].interest);
  assert.equal(r.totals.principal, 200e6);
  assert.equal(r.rows[1].opening, 195e6); // lãi kỳ sau tính trên dư nợ đã giảm
});

test('gốc + lãi trả đều + tự nhập số tiền mỗi tháng: kỳ 1 đến kỳ áp chót trả đúng số đó, kỳ cuối trả nốt', () => {
  const r = scheduleByTerm({ principal: 200e6, ratePercent: 10.5, months: 24, startDate: d(2026, 10, 23), method: 'annuity', fixedAmount: 5e6 });
  assert.equal(r.rows.length, 24);
  assert.deepEqual(r.rows.slice(0, 23).map((x) => x.payment), Array(23).fill(5e6));
  assert.ok(r.rows[23].payment > 5e6);
  assert.equal(r.rows[23].closing, 0);
  assert.equal(r.totals.principal, 200e6);
});

test('tự nhập số tiền quá lớn hoặc quá nhỏ thì báo lỗi rõ, không tính sai', () => {
  const base = { principal: 200e6, ratePercent: 10.5, months: 24, startDate: d(2026, 10, 23) };
  const big = scheduleByTerm({ ...base, method: 'equalPrincipal', fixedAmount: 10e6 });
  assert.equal(big.error, 'tra_het_truoc_han');
  assert.equal(big.maxAmount, Math.floor((200e6 - 1) / 23));
  assert.equal(scheduleByTerm({ ...base, method: 'annuity', fixedAmount: 60e6 }).error, 'tra_het_truoc_han');
  const small = scheduleByTerm({ ...base, method: 'annuity', fixedAmount: 1e6 });
  assert.equal(small.error, 'khong_du_tra_lai');
  assert.equal(small.firstInterest, periodInterest(200e6, 10.5, 31));
});

test('không tự nhập số tiền thì kết quả y hệt cũ; lãi hàng tháng - gốc cuối kỳ bỏ qua số tự nhập', () => {
  for (const method of ['equalPrincipal', 'annuity', 'bullet']) {
    const base = { principal: 200e6, ratePercent: 10.34, months: 12, startDate: d(2026, 10, 22), method };
    assert.deepEqual(scheduleByTerm({ ...base, fixedAmount: null, endDate: null }), scheduleByTerm(base));
  }
  const b = { principal: 200e6, ratePercent: 10.34, months: 12, startDate: d(2026, 10, 22), method: 'bullet' };
  assert.deepEqual(scheduleByTerm({ ...b, fixedAmount: 5e6 }), scheduleByTerm(b));
});

test('ngày đáo hạn đúng tròn tháng cho kết quả giống hệt nhập thời hạn', () => {
  for (const method of ['equalPrincipal', 'annuity', 'bullet']) {
    const base = { principal: 200e6, ratePercent: 10.34, startDate: d(2026, 10, 23), method };
    assert.deepEqual(scheduleByTerm({ ...base, months: 12 }), scheduleByTerm({ ...base, months: 0, endDate: d(2027, 10, 23) }));
  }
});

test('ngày đáo hạn không tròn tháng: số kỳ tính từ ngày vay, kỳ cuối ngắn hơn và dừng đúng ngày đáo hạn', () => {
  const start = d(2026, 10, 23), end = d(2027, 4, 15);
  const r = scheduleByTerm({ principal: 200e6, ratePercent: 10.5, months: 0, startDate: start, method: 'bullet', endDate: end });
  assert.equal(r.rows.length, 6);
  assert.equal(r.rows[5].days, 23);
  assert.deepEqual(r.rows[5].to, end);
  assert.equal(r.totals.days, daysBetween(start, end));
  assert.equal(r.rows[5].principal, 200e6);
  assert.equal(r.rows[5].closing, 0);
});

test('ngày đáo hạn kết hợp số tự nhập: kỳ cuối trả nốt gốc còn lại', () => {
  const r = scheduleByTerm({ principal: 100e6, ratePercent: 11.5, months: 0, startDate: d(2027, 10, 22), method: 'equalPrincipal', fixedAmount: 5e6, endDate: d(2028, 10, 22) });
  assert.equal(r.rows.length, 12);
  assert.equal(r.rows[11].principal, 45e6);
  assert.equal(r.rows[11].closing, 0);
});

test('ngày đáo hạn sai (không sau ngày vay, quá xa) thì trả về null', () => {
  const base = { principal: 1e6, ratePercent: 10, months: 0, startDate: d(2026, 10, 23) };
  assert.equal(scheduleByTerm({ ...base, endDate: d(2026, 10, 23) }), null);
  assert.equal(scheduleByTerm({ ...base, endDate: d(2026, 1, 1) }), null);
  assert.equal(scheduleByTerm({ ...base, endDate: d(2080, 1, 1) }), null);
});

test('số kỳ từ ngày vay đến ngày đáo hạn (periodsUntil) khớp số dòng của bảng trả', () => {
  const s = d(2026, 10, 23);
  assert.equal(periodsUntil(s, d(2027, 10, 23)), 12); // 23/10/2026 + 12 tháng = 23/10/2027
  assert.equal(periodsUntil(s, d(2027, 10, 24)), 13);
  assert.equal(periodsUntil(s, d(2027, 4, 15)), 6);
  assert.equal(periodsUntil(s, d(2026, 11, 23)), 1);
  assert.equal(periodsUntil(s, s), 0);
  assert.equal(periodsUntil(s, d(2026, 1, 1)), 0);
  assert.equal(periodsUntil(s, d(2090, 1, 1)), 0);
  for (const end of [d(2027, 4, 15), d(2027, 10, 23), d(2028, 1, 31)]) {
    assert.equal(scheduleByTerm({ principal: 1e8, ratePercent: 10, months: 0, startDate: s, method: 'bullet', endDate: end }).rows.length, periodsUntil(s, end));
  }
});

test('gốc + lãi trả đều: số tiền trả mỗi tháng làm tròn nghìn như Excel (từ 500 lên, dưới 500 xuống), kỳ cuối trả nốt', () => {
  // Số vừa đủ trả hết đúng kỳ cuối = 17.614.500 (đúng 500) -> làm tròn lên 17.615.000
  const a = scheduleByTerm({ principal: 200e6, ratePercent: 10.34, months: 12, startDate: d(2026, 10, 22), method: 'annuity' });
  assert.equal(a.rows[0].payment, 17615000);
  // 4.947.111 (dưới 500) -> làm tròn xuống 4.947.000, không còn làm tròn lên 4.948.000
  const b = scheduleByTerm({ principal: 150e6, ratePercent: 11.5, months: 36, startDate: d(2026, 10, 22), method: 'annuity' });
  assert.equal(b.rows[0].payment, 4947000);
  assert.equal(b.rows[34].payment, 4947000);
  // 4.801.111 -> 4.801.000; 8.602.166 -> 8.602.000
  assert.equal(scheduleByTerm({ principal: 80e6, ratePercent: 9.9, months: 18, startDate: d(2026, 10, 22), method: 'annuity' }).rows[0].payment, 4801000);
  assert.equal(scheduleByTerm({ principal: 50e6, ratePercent: 10.95, months: 6, startDate: d(2026, 10, 22), method: 'annuity' }).rows[0].payment, 8602000);
  // Phần chênh do làm tròn dồn vào kỳ cuối: hết nợ, tổng gốc đúng số vay, kỳ cuối chỉ lệch rất ít so với các kỳ trước
  for (const r of [a, b]) {
    assert.equal(r.rows[r.rows.length - 1].closing, 0);
    assert.equal(r.totals.principal, r.rows[0].opening);
    assert.ok(Math.abs(r.rows[r.rows.length - 1].payment - r.rows[0].payment) < 50000);
  }
});
