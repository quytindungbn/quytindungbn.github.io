import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCallTime, formatPhoneDisplay } from '../js/lib/callHistory.js';

const now = new Date(2026, 9, 24, 10, 0);

test('cuộc gọi hôm nay: giờ phút, ngày, thứ và "bao lâu trước"', () => {
  const t = describeCallTime(new Date(2026, 9, 24, 9, 36).toISOString(), now);
  assert.deepEqual(t, { time: '09:36', date: '24/10/2026', weekday: 'Thứ Bảy', rel: 'Hôm nay', ago: '24 phút trước', days: 0 });
  assert.equal(describeCallTime(new Date(2026, 9, 24, 7, 5).toISOString(), now).ago, '2 giờ trước');
  assert.equal(describeCallTime(new Date(2026, 9, 24, 10, 0).toISOString(), now).ago, 'Vừa xong');
});

test('cuộc gọi các ngày trước: nhãn Hôm qua / N ngày trước / N tháng trước, đúng thứ trong tuần', () => {
  const at = (y, m, d, h = 22, min = 15) => describeCallTime(new Date(y, m - 1, d, h, min).toISOString(), now);
  assert.equal(at(2026, 10, 23).rel, 'Hôm qua');
  assert.equal(at(2026, 10, 23).weekday, 'Thứ Sáu');
  assert.equal(at(2026, 10, 23).ago, '');
  assert.deepEqual([at(2026, 10, 22).rel, at(2026, 10, 22).weekday, at(2026, 10, 22).date, at(2026, 10, 22).time], ['2 ngày trước', 'Thứ Năm', '22/10/2026', '22:15']);
  assert.equal(at(2026, 9, 20).rel, '1 tháng trước');
  assert.equal(at(2026, 4, 1).rel, '6 tháng trước');
  assert.equal(at(2025, 9, 1).rel, '1 năm trước');

  const early = new Date(2026, 9, 24, 0, 30);
  assert.equal(describeCallTime(early.toISOString(), new Date(2026, 9, 24, 8, 0)).rel, 'Hôm nay');
  assert.equal(describeCallTime(new Date(2026, 9, 23, 23, 59).toISOString(), new Date(2026, 9, 24, 8, 0)).rel, 'Hôm qua');
});

test('thời điểm lỗi hoặc ở tương lai (đồng hồ lệch) không làm hỏng giao diện', () => {
  assert.equal(describeCallTime('không phải ngày', now).time, '--:--');
  const future = describeCallTime(new Date(2026, 9, 24, 10, 5).toISOString(), now);
  assert.equal(future.rel, 'Hôm nay');
  assert.equal(future.ago, 'Vừa xong');
});

test('số điện thoại di động 10 số hiện dạng 0912 345 678, số khác giữ nguyên', () => {
  assert.equal(formatPhoneDisplay('0912345678'), '0912 345 678');
  assert.equal(formatPhoneDisplay('0912 345 678'), '0912 345 678');
  assert.equal(formatPhoneDisplay(' 0912.345.678 '), '0912 345 678');
  assert.equal(formatPhoneDisplay('+84912345678'), '+84912345678');
  assert.equal(formatPhoneDisplay('02838123456'), '02838123456');
  assert.equal(formatPhoneDisplay(''), '');
  assert.equal(formatPhoneDisplay(null), '');
});
