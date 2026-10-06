import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBalance, yearOpeningReport, provisionDifference, nextProvisionDeadline } from '../js/lib/balanceSheetMetrics.js';

test('biến động dùng số gốc tuyệt đối và không tạo tỷ lệ giả khi gốc bằng 0', () => {
  assert.deepEqual(compareBalance(70_147_510_875, 70_726_277_233), {
    amount: -578_766_358,
    percent: (-578_766_358 / 70_726_277_233) * 100,
  });
  assert.deepEqual(compareBalance(100, 0), { amount: 100, percent: null });
  assert.deepEqual(compareBalance(0, 0), { amount: 0, percent: 0 });
  assert.equal(compareBalance(100, undefined), null);
});

test('mốc từ đầu năm là số đầu kỳ tháng 01 cùng năm', () => {
  const january = { year_month: '2026-01', figures: { start: { assets: 80 }, end: { assets: 78 } } };
  const reports = [
    { year_month: '2025-12', figures: { end: { assets: 90 } } },
    january,
    { year_month: '2026-09', figures: { end: { assets: 65 } } },
  ];
  assert.equal(yearOpeningReport(reports, '2026-09'), january);
  assert.equal(compareBalance(65, yearOpeningReport(reports, '2026-09').figures.start.assets).amount, -15);
  assert.equal(yearOpeningReport(reports, '2025-12'), null);
});

test('dự phòng lấy bảng cân đối trừ phải trích và hạn ngày 07 tháng sau kể cả qua năm', () => {
  assert.equal(provisionDifference(120, 100), 20);
  assert.equal(provisionDifference(80, 100), -20);
  assert.equal(provisionDifference(100, 100), 0);
  assert.equal(provisionDifference(100, undefined), null);
  assert.equal(nextProvisionDeadline('2026-09'), '07/10/2026');
  assert.equal(nextProvisionDeadline('2026-12'), '07/01/2027');
});
