import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBalance, priorYearEndReport } from '../js/lib/balanceSheetMetrics.js';

test('biến động dùng số gốc tuyệt đối và không tạo tỷ lệ giả khi gốc bằng 0', () => {
  assert.deepEqual(compareBalance(70_147_510_875, 70_726_277_233), {
    amount: -578_766_358,
    percent: (-578_766_358 / 70_726_277_233) * 100,
  });
  assert.deepEqual(compareBalance(100, 0), { amount: 100, percent: null });
  assert.deepEqual(compareBalance(0, 0), { amount: 0, percent: 0 });
  assert.equal(compareBalance(100, undefined), null);
});

test('đầu năm là cuối kỳ tháng 12 của năm trước, không phải đầu kỳ báo cáo', () => {
  const december = { year_month: '2025-12', figures: { end: { assets: 70 } } };
  const reports = [december, { year_month: '2026-09', figures: { end: { assets: 65 } } }];
  assert.equal(priorYearEndReport(reports, '2026-09'), december);
  assert.equal(priorYearEndReport(reports, '2025-12'), null);
});
