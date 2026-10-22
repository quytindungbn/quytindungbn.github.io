import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, daysBetween, periodInterest, scheduleByTerm, scheduleByPayment } from '../js/lib/loanCalc.js';

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
