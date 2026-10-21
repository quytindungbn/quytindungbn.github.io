import test from 'node:test';
import assert from 'node:assert/strict';
import { interestDaysBetween, interestAsOfForDays, interestBonusDays, MAX_INTEREST_DAYS } from '../js/lib/interestDays.js';
import { parseViDate, maskViDate, toDateInputValue, formatDate } from '../js/utils.js';

const d = (y, m, day) => new Date(y, m - 1, day);

test('số ngày lãi: tính bình thường từ "Thu lãi đến ngày" tới ngày chọn', () => {
  const ct = { disbursedDate: '2026-01-03', interestPaidUntil: '2026-09-12' };
  assert.equal(interestBonusDays(ct), 0);
  assert.equal(interestDaysBetween(ct, d(2026, 10, 21)), 39);
  assert.equal(interestDaysBetween(ct, d(2026, 9, 12)), 0);
  assert.equal(interestDaysBetween(ct, d(2026, 9, 1)), 0, 'chọn ngày trước ngày đã trả lãi thì 0 ngày, không âm');
});

test('số ngày lãi: quy ước "thu lãi đến ngày = giải ngân + 1" cộng thêm 1 ngày', () => {
  const ct = { disbursedDate: '2026-08-17', interestPaidUntil: '2026-08-18' };
  assert.equal(interestBonusDays(ct), 1);
  assert.equal(interestDaysBetween(ct, d(2026, 8, 19)), 2); // ví dụ trong chú thích cũ của state.js
  const early = { disbursedDate: '2026-08-20', interestPaidUntil: '2026-08-21' };
  assert.equal(interestDaysBetween(early, d(2026, 8, 20)), 0); // -1 + 1 = 0, không phải 1
});

test('đổi số ngày -> ngày rồi tính lại ra đúng số ngày đó (cả trường hợp ngày đặc biệt)', () => {
  const cases = [
    { disbursedDate: '2026-01-03', interestPaidUntil: '2026-09-12' },
    { disbursedDate: '2026-08-17', interestPaidUntil: '2026-08-18' },
    { disbursedDate: '2026-03-01', interestPaidUntil: '2026-03-01' },
    { disbursedDate: '2025-12-25' }, // chưa có "thu lãi đến ngày": dùng ngày giải ngân
  ];
  for (const ct of cases) {
    for (let n = 0; n <= 800; n++) {
      assert.equal(interestDaysBetween(ct, interestAsOfForDays(ct, n)), n, `${JSON.stringify(ct)} n=${n}`);
    }
  }
});

test('đổi ngày -> số ngày: ngày sau 1 ngày thì số ngày tăng đúng 1', () => {
  const ct = { disbursedDate: '2026-01-03', interestPaidUntil: '2026-05-11' };
  assert.equal(formatDate(interestAsOfForDays(ct, 163)), '21/10/2026');
  assert.equal(interestDaysBetween(ct, d(2026, 10, 22)), interestDaysBetween(ct, d(2026, 10, 21)) + 1);
  assert.equal(MAX_INTEREST_DAYS, 3650);
});

test('parseViDate: đúng định dạng dd/mm/yyyy, từ chối ngày không có thật', () => {
  assert.equal(formatDate(parseViDate('30/10/2026')), '30/10/2026');
  assert.equal(formatDate(parseViDate('5/1/2026')), '05/01/2026');
  assert.equal(parseViDate('31/02/2026'), null);
  assert.equal(parseViDate('29/02/2027'), null);
  assert.equal(formatDate(parseViDate('29/02/2028')), '29/02/2028');
  assert.equal(parseViDate('2026-10-30'), null);
  assert.equal(parseViDate('30/10/26'), null);
  assert.equal(parseViDate(''), null);
  assert.equal(parseViDate(null), null);
});

test('maskViDate: gõ số liền tự chèn dấu "/"', () => {
  assert.equal(maskViDate('25102026'), '25/10/2026');
  assert.equal(maskViDate('2510'), '25/10');
  assert.equal(maskViDate('251'), '25/1');
  assert.equal(maskViDate('2'), '2');
  assert.equal(maskViDate('25/10/2026999'), '25/10/2026');
  assert.equal(maskViDate('ab12cd'), '12');
  assert.equal(maskViDate(''), '');
});

test('toDateInputValue: giờ địa phương, không lệch múi giờ', () => {
  assert.equal(toDateInputValue(d(2026, 1, 1)), '2026-01-01');
  assert.equal(toDateInputValue(d(2026, 10, 30)), '2026-10-30');
});
