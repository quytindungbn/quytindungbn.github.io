import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextMonthlyOn, firstRemindOn, nextAfterDone, noteState, isDue, pillLabel, repeatLabel,
  sortNotes, summarize, describeFirst, validateDraft, planChanged, addDaysIso, diffDays, weekdayVi, formatVnDate, isIsoDate, firstMonthlyOn,
} from '../js/lib/customerNotes.js';

const T = '2026-10-26';

test('ngày: cộng/trừ ngày, khoảng cách, thứ trong tuần, định dạng', () => {
  assert.equal(addDaysIso('2026-10-26', 15), '2026-11-10');
  assert.equal(addDaysIso('2026-12-30', 5), '2027-01-04');
  assert.equal(diffDays('2026-10-26', '2026-11-10'), 15);
  assert.equal(diffDays('2026-10-26', '2026-10-24'), -2);
  assert.equal(weekdayVi('2026-10-26'), 'Thứ Hai');
  assert.equal(weekdayVi('2026-11-10'), 'Thứ Ba');
  assert.equal(formatVnDate('2026-11-05'), '05/11/2026');
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-02-28'), true);
});

test('nextMonthlyOn: gồm hôm nay khi trùng ngày, qua tháng, ngày 31 rơi vào tháng ngắn, qua năm', () => {
  assert.equal(nextMonthlyOn(5, '2026-10-26'), '2026-11-05');
  assert.equal(nextMonthlyOn(26, '2026-10-26'), '2026-10-26');
  assert.equal(nextMonthlyOn(26, '2026-10-26', false), '2026-11-26');
  assert.equal(nextMonthlyOn(31, '2026-02-01'), '2026-02-28');
  assert.equal(nextMonthlyOn(31, '2026-02-28', false), '2026-03-31');
  assert.equal(nextMonthlyOn(15, '2026-12-20'), '2027-01-15');
  assert.equal(nextMonthlyOn(30, '2028-02-10'), '2028-02-29');
});

test('firstRemindOn: sau N ngày, ngày cụ thể, hàng tháng, không nhắc', () => {
  assert.equal(firstRemindOn({ kind: 'after', afterDays: 15 }, T), '2026-11-10');
  assert.equal(firstRemindOn({ kind: 'after', afterDays: 0 }, T), null);
  assert.equal(firstRemindOn({ kind: 'after', afterDays: 400 }, T), null);
  assert.equal(firstRemindOn({ kind: 'date', date: '2026-12-01' }, T), '2026-12-01');
  assert.equal(firstRemindOn({ kind: 'date', date: 'abc' }, T), null);
  assert.equal(firstRemindOn({ kind: 'monthly', monthlyDay: 5 }, T), '2026-11-05');
  assert.equal(firstRemindOn({ kind: 'monthly', monthlyDay: 31 }, T), null);
  assert.equal(firstRemindOn({ kind: 'monthly', monthlyDay: 0 }, T), null);
  assert.equal(firstRemindOn({ kind: 'none' }, T), null);
});

test('describeFirst: ví dụ trả gốc hàng tháng ngày 5 và hẹn 15 ngày', () => {
  assert.deepEqual(describeFirst({ kind: 'monthly', monthlyDay: 5 }, T), { iso: '2026-11-05', text: 'Thứ Năm, 05/11/2026', inDays: 10, pushed: false });
  assert.deepEqual(describeFirst({ kind: 'after', afterDays: 15 }, T), { iso: '2026-11-10', text: 'Thứ Ba, 10/11/2026', inDays: 15, pushed: false });
  assert.equal(describeFirst({ kind: 'none' }, T), null);
});

test('nextAfterDone: chỉ việc hàng tháng; bấm đúng hạn, muộn, sớm, hoãn', () => {
  const m = (day, remindOn) => ({ kind: 'monthly', monthlyDay: day, remindOn });
  assert.equal(nextAfterDone(m(26, '2026-10-26'), '2026-10-26'), '2026-11-26');
  assert.equal(nextAfterDone(m(24, '2026-10-24'), '2026-10-26'), '2026-11-24');
  assert.equal(nextAfterDone(m(24, '2026-10-24'), '2026-12-24'), '2027-01-24');
  assert.equal(nextAfterDone(m(5, '2026-11-05'), '2026-10-26'), '2026-12-05');
  assert.equal(nextAfterDone(m(26, '2026-10-28'), '2026-10-27'), '2026-11-26');
  assert.equal(nextAfterDone({ kind: 'after', afterDays: 15, remindOn: '2026-11-10' }, T), null);
});

test('noteState / isDue / pillLabel / repeatLabel', () => {
  const n = (o) => ({ status: 'open', kind: 'none', ...o });
  assert.equal(noteState(n({ remindOn: '2026-10-24' }), T), 'late');
  assert.equal(noteState(n({ remindOn: '2026-10-26' }), T), 'today');
  assert.equal(noteState(n({ remindOn: '2026-11-10' }), T), 'soon');
  assert.equal(noteState(n({}), T), 'plain');
  assert.equal(noteState(n({ status: 'done', remindOn: '2026-10-24' }), T), 'done');
  assert.equal(isDue(n({ remindOn: '2026-10-24' }), T), true);
  assert.equal(isDue(n({ remindOn: '2026-10-26' }), T), true);
  assert.equal(isDue(n({ remindOn: '2026-10-27' }), T), true);
  assert.equal(isDue(n({ remindOn: '2026-10-29' }), T), true);
  assert.equal(isDue(n({ remindOn: '2026-10-30' }), T), false);
  assert.equal(isDue(n({}), T), false);
  assert.equal(pillLabel(n({ remindOn: '2026-10-24' }), T), 'Trễ 2 ngày');
  assert.equal(pillLabel(n({ remindOn: '2026-10-26' }), T), 'Hôm nay');
  assert.equal(pillLabel(n({ remindOn: '2026-11-10' }), T), 'Còn 15 ngày');
  assert.equal(pillLabel(n({}), T), 'Ghi chú');
  assert.equal(repeatLabel({ kind: 'monthly', monthlyDay: 26 }), 'Hàng tháng · ngày 26');
  assert.equal(repeatLabel({ kind: 'after', afterDays: 15 }), 'Khách hẹn 15 ngày');
  assert.equal(repeatLabel({ kind: 'date', remindOn: '2026-12-01' }), 'Hẹn ngày 01/12');
  assert.equal(repeatLabel({ kind: 'none' }), '');
});

test('sortNotes: trễ (cũ nhất trước) → hôm nay → sắp tới (gần nhất trước) → ghi chú thường (mới nhất trước)', () => {
  const mk = (id, remindOn, createdAt) => ({ id, status: 'open', kind: 'none', remindOn, createdAt });
  const list = [mk('plain1', null, '2026-01-03'), mk('soon2', '2026-11-20', '2026-10-01'), mk('late1', '2026-10-24', '2026-10-01'), mk('soon1', '2026-11-10', '2026-10-02'), mk('today', '2026-10-26', '2026-10-01'), mk('plain2', null, '2026-05-03'), mk('late0', '2026-10-20', '2026-10-01')];
  assert.deepEqual(sortNotes(list, T).map((x) => x.id), ['late0', 'late1', 'today', 'soon1', 'soon2', 'plain2', 'plain1']);
});

test('summarize: đếm trễ / hôm nay / sắp tới / ghi chú, bỏ việc đã xong', () => {
  const mk = (remindOn, status = 'open') => ({ status, kind: 'none', remindOn });
  assert.deepEqual(summarize([mk('2026-10-24'), mk('2026-10-26'), mk('2026-11-10'), mk(null), mk('2026-10-20', 'done')], T), { late: 1, today: 1, soon: 1, plain: 1, total: 4 });
});

test('validateDraft: nội dung bắt buộc, kiểu nhắc đủ tham số, số tiền chỉ lấy chữ số', () => {
  assert.equal(validateDraft({ text: '   ', kind: 'none' }).ok, false);
  assert.equal(validateDraft({ text: 'x'.repeat(301), kind: 'none' }).ok, false);
  assert.equal(validateDraft({ text: 'a', kind: 'after', afterDays: 0 }).ok, false);
  assert.equal(validateDraft({ text: 'a', kind: 'date', date: '' }).ok, false);
  assert.equal(validateDraft({ text: 'a', kind: 'monthly', monthlyDay: 40 }).ok, false);
  assert.equal(validateDraft({ text: 'a', kind: 'monthly', monthlyDay: 31 }).ok, false);
  assert.equal(validateDraft({ text: 'a', kind: 'monthly', monthlyDay: 30 }).ok, true);
  const r = validateDraft({ text: '  Khách   trả gốc  ', kind: 'monthly', monthlyDay: '5', amount: '2.000.000', contractId: 'ct1', visibility: 'me' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.clean, { text: 'Khách trả gốc', kind: 'monthly', afterDays: null, monthlyDay: 5, date: null, amount: 2000000, contractId: 'ct1', visibility: 'me' });
  const p = validateDraft({ text: 'ghi chú thường', kind: 'bậy' });
  assert.equal(p.clean.kind, 'none');
  assert.equal(p.clean.visibility, 'all');
});

test('planChanged: chỉ tính lại ngày nhắc khi đổi kiểu hoặc thông số nhắc', () => {
  const note = { kind: 'after', afterDays: 15, remindOn: '2026-11-10' };
  assert.equal(planChanged(note, { kind: 'after', afterDays: 15 }), false);
  assert.equal(planChanged(note, { kind: 'after', afterDays: 7 }), true);
  assert.equal(planChanged(note, { kind: 'monthly', monthlyDay: 5 }), true);
  assert.equal(planChanged({ kind: 'date', remindOn: '2026-12-01' }, { kind: 'date', date: '2026-12-01' }), false);
  assert.equal(planChanged({ kind: 'monthly', monthlyDay: 5 }, { kind: 'monthly', monthlyDay: 6 }), true);
});

test('hàng tháng: ngày nhắc đầu tiên còn dưới 10 ngày thì sang tháng sau (hôm nay 26/10)', () => {
  assert.equal(firstMonthlyOn(26, T), '2026-11-26');
  assert.equal(firstMonthlyOn(27, T), '2026-11-27');
  assert.equal(firstMonthlyOn(28, T), '2026-11-28');
  assert.equal(firstMonthlyOn(30, T), '2026-11-30');
  assert.equal(firstMonthlyOn(4, T), '2026-12-04');
  assert.equal(firstMonthlyOn(5, T), '2026-11-05');
  assert.equal(firstMonthlyOn(6, T), '2026-11-06');
  assert.equal(firstMonthlyOn(1, T), '2026-12-01');
});

test('hàng tháng: từ 10 ngày trở lên vẫn trong tháng này', () => {
  assert.equal(firstMonthlyOn(15, '2026-10-01'), '2026-10-15');
  assert.equal(firstMonthlyOn(11, '2026-10-01'), '2026-10-11');
  assert.equal(firstMonthlyOn(10, '2026-10-01'), '2026-11-10');
  assert.equal(firstMonthlyOn(9, '2026-10-01'), '2026-11-09');
  assert.equal(firstMonthlyOn(5, '2026-10-01'), '2026-11-05');
  assert.equal(firstMonthlyOn(3, '2026-12-28'), '2027-02-03');
  assert.equal(firstMonthlyOn(30, '2026-02-01'), '2026-02-28');
});

test('describeFirst báo đã đẩy sang tháng sau khi còn dưới 10 ngày', () => {
  assert.equal(describeFirst({ kind: 'monthly', monthlyDay: 26 }, T).pushed, true);
  assert.equal(describeFirst({ kind: 'monthly', monthlyDay: 26 }, T).iso, '2026-11-26');
  assert.equal(describeFirst({ kind: 'monthly', monthlyDay: 5 }, T).pushed, false);
  assert.equal(describeFirst({ kind: 'monthly', monthlyDay: 15 }, '2026-10-01').pushed, false);
});

test('hàng tháng: tháng không có ngày đó thì nhắc vào cuối tháng, tháng sau trở lại đúng ngày', () => {
  assert.equal(nextMonthlyOn(30, '2026-01-30', false), '2026-02-28');
  assert.equal(nextMonthlyOn(30, '2026-02-28', false), '2026-03-30');
  assert.equal(nextMonthlyOn(30, '2028-01-30', false), '2028-02-29');
  assert.equal(nextMonthlyOn(29, '2026-01-29', false), '2026-02-28');
  assert.equal(firstMonthlyOn(30, '2026-02-05'), '2026-02-28');
  assert.equal(firstMonthlyOn(30, '2026-01-25'), '2026-02-28');
  assert.equal(firstMonthlyOn(30, '2026-04-10'), '2026-04-30');
});

test('báo trước 3 ngày: ghi chú vừa tạo / vừa hoãn trong cửa sổ 3 ngày thì chưa báo trước, đến ngày mới hiện', () => {
  const n = (x) => ({ status: 'open', ...x });
  assert.equal(isDue(n({ remindOn: '2026-10-29', updatedAt: '2026-10-26T08:00:00' }), T), false);
  assert.equal(isDue(n({ remindOn: '2026-10-29', updatedAt: '2026-10-20T08:00:00' }), T), true);
  assert.equal(isDue(n({ remindOn: '2026-10-29', updatedAt: '2026-10-26T08:00:00' }), '2026-10-29'), true);
  assert.equal(isDue(n({ remindOn: '2026-10-30', updatedAt: '2026-10-20T08:00:00' }), T), false);
  assert.equal(isDue(n({ remindOn: '2026-10-30', updatedAt: '2026-10-20T08:00:00' }), '2026-10-27'), true);
  assert.equal(isDue(n({ remindOn: '2026-10-29', status: 'done' }), T), false);
});
