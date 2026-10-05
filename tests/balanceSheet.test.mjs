import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBalanceSheetRows } from '../js/lib/balanceSheet.js';

function sample() {
  const rows = Array.from({ length: 30 }, () => []);
  rows[4][0] = 'Từ ngày 01/09/2026 đến ngày 30/09/2026';
  const account = (index, code, dr, cr) => { rows[index] = ['', code, dr, cr, 0, 0, dr, cr]; };
  account(11, '1', 100, 0);
  account(12, '101', 100, 0);
  account(13, '13', 0, 0);
  account(14, '2', 200, 20);
  account(15, '211', 200, 0);
  account(16, '212', 0, 0);
  account(17, '219', 0, 20);
  account(18, '2191', 0, 5);
  account(19, '2192', 0, 15);
  account(20, '3', 0, 0);
  account(21, '4', 0, 200);
  account(22, '423', 0, 200);
  account(23, '6', 0, 80);
  account(24, '7', 0, 0);
  account(25, '8', 0, 0);
  return rows;
}

test('tổng tài sản trừ đúng dự phòng và khớp tổng nguồn vốn', () => {
  const report = parseBalanceSheetRows(sample());
  assert.equal(report.yearMonth, '2026-09');
  assert.equal(report.periodEnd, '2026-09-30');
  assert.equal(report.end.assets, 280);
  assert.equal(report.end.liabilities, 280);
  assert.equal(report.end.specificProvision, 5);
  assert.equal(report.end.generalProvision, 15);
});

test('chặn file không cân đối và dự phòng sai tài khoản con', () => {
  const unbalanced = sample();
  unbalanced[23][7] = 81;
  assert.throws(() => parseBalanceSheetRows(unbalanced), /lệch/);
  const wrongProvision = sample();
  wrongProvision[18][7] = 6;
  assert.throws(() => parseBalanceSheetRows(wrongProvision), /không khớp/);
});

test('chặn kỳ không đủ tháng và tài khoản trùng', () => {
  const partial = sample();
  partial[4][0] = 'Từ ngày 01/09/2026 đến ngày 29/09/2026';
  assert.throws(() => parseBalanceSheetRows(partial), /trọn một tháng/);
  const duplicate = sample();
  duplicate[26] = ['', '423', 0, 1, 0, 0, 0, 1];
  assert.throws(() => parseBalanceSheetRows(duplicate), /nhiều lần/);
});
