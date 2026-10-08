import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBalance, yearOpeningReport, accountDetailChanges, provisionDifference, nextProvisionDeadline, managementRatios } from '../js/lib/balanceSheetMetrics.js';

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

test('chi tiết tài khoản giữ cả mã đã về 0 và phân biệt phần chưa tách', () => {
  const end = [{ code: '3611', balance: 120 }, { code: '484', residual: true, balance: 10 }];
  const start = [{ code: '3611', balance: 100 }, { code: '3612', balance: 50 }, { code: '484', residual: true, balance: 20 }];
  const year = [{ code: '3611', balance: 80 }, { code: '484', balance: 30 }];
  const lines = accountDetailChanges(end, start, year);
  assert.deepEqual(lines.map(({ code, residual, balance, startBalance, yearBalance }) =>
    [code, !!residual, balance, startBalance, yearBalance]), [
    ['3611', false, 120, 100, 80],
    ['484', true, 10, 20, 0],
    ['3612', false, 0, 50, 0],
    ['484', false, 0, 0, 30],
  ]);
  assert.equal(compareBalance(lines[2].balance, lines[2].startBalance).percent, -100);
  assert.equal(accountDetailChanges(end, undefined, undefined)[0].startBalance, undefined);
  assert.equal(accountDetailChanges(undefined, start, year), null);
});

test('dự phòng lấy bảng cân đối trừ phải trích và hạn ngày 07 tháng sau kể cả qua năm', () => {
  assert.equal(provisionDifference(120, 100), 20);
  assert.equal(provisionDifference(80, 100), -20);
  assert.equal(provisionDifference(100, 100), 0);
  assert.equal(provisionDifference(100, undefined), null);
  assert.equal(nextProvisionDeadline('2026-09'), '07/10/2026');
  assert.equal(nextProvisionDeadline('2026-12'), '07/01/2027');
});

test('chỉ số quản trị dùng lợi nhuận lũy kế và vốn chủ sở hữu gồm lợi nhuận', () => {
  const ratios = managementRatios({ profit: 400, equity: 3600, assets: 8000, grossLoans: 5000, customerDeposits: 6000 });
  assert.equal(ratios.ownCapital, 4000);
  assert.equal(ratios.roe, 10);
  assert.equal(ratios.roa, 5);
  assert.equal(ratios.loanDeposit, 5000 / 6000 * 100);
  assert.equal(ratios.depositCapital, 1.5);
  assert.equal(managementRatios({ profit: 1, equity: -1, assets: 0, grossLoans: 1, customerDeposits: 0 }).depositCapital, null);
});
