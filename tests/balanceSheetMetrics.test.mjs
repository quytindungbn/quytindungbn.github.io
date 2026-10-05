import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBalance, yearOpeningReport } from '../js/lib/balanceSheetMetrics.js';

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
