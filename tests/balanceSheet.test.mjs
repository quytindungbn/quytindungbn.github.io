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

test('nhận báo cáo hằng ngày, chặn kỳ sai tháng và tài khoản trùng', () => {
  const daily = sample();
  daily[4][0] = 'Từ ngày 01/09/2026 đến ngày 29/09/2026';
  assert.equal(parseBalanceSheetRows(daily).periodEnd, '2026-09-29');
  daily[4][0] = 'Từ ngày 01/09/2026 đến ngày 01/10/2026';
  assert.throws(() => parseBalanceSheetRows(daily), /cùng tháng/);
  const duplicate = sample();
  duplicate[26] = ['', '423', 0, 1, 0, 0, 0, 1];
  assert.throws(() => parseBalanceSheetRows(duplicate), /nhiều lần/);
});

test('tài khoản dự phòng không phát sinh được coi là 0, tài khoản cho vay mới được tính', () => {
  const rows = sample();
  rows[18] = []; // tháng này không có 2191
  rows[17][3] = rows[17][7] = 15;
  rows[14][3] = rows[14][7] = 15;
  rows[23][3] = rows[23][7] = 85;
  const withoutSpecific = parseBalanceSheetRows(rows);
  assert.equal(withoutSpecific.end.specificProvision, 0);
  assert.equal(withoutSpecific.end.generalProvision, 15);
  assert.equal(withoutSpecific.end.assets, 285);

  rows[26] = ['', '213', 10, 0, 0, 0, 10, 0];
  rows[15][2] = rows[15][6] = 200;
  rows[14][2] = rows[14][6] = 210;
  rows[23][3] = rows[23][7] = 95;
  const withNewLoan = parseBalanceSheetRows(rows);
  assert.equal(withNewLoan.end.grossLoans, 210);
  assert.equal(withNewLoan.end.loanNet, 195);
});

test('tài khoản dự phòng mới vẫn được trừ trong tổng, không lặp dòng tài khoản con', () => {
  const rows = sample();
  rows[14][3] = rows[14][7] = 23;
  rows[17][3] = rows[17][7] = 23;
  rows[23][3] = rows[23][7] = 77;
  rows[26] = ['', '2193', 0, 3, 0, 0, 0, 3];
  const report = parseBalanceSheetRows(rows);
  assert.equal(report.end.totalProvision, 23);
  assert.equal(report.end.otherProvision, 3);
  assert.equal(report.end.loanNet, 177);
  assert.equal(report.end.assets, 277);
});

test('tách vốn điều lệ và các quỹ, giữ phần vốn chủ sở hữu khác', () => {
  const rows = sample();
  const account = (index, code, credit) => { rows[index] = ['', code, 0, credit, 0, 0, 0, credit]; };
  account(26, '601', 40);
  account(27, '611', 10);
  account(28, '612', 20);
  account(29, '613', 5);
  const report = parseBalanceSheetRows(rows);
  assert.deepEqual(report.end.equityParts, {
    charterCapital: 40, supplementaryReserve: 10,
    developmentReserve: 20, financialReserve: 5, otherEquity: 5,
  });
  assert.equal(parseBalanceSheetRows(sample()).end.equityParts, null);
  rows[27] = []; // một quỹ không phát sinh, vẫn giữ các khoản mục còn lại
  assert.equal(parseBalanceSheetRows(rows).end.equityParts.supplementaryReserve, 0);
});

test('lợi nhuận = doanh thu trừ chi phí; TSCĐ trừ hao mòn và tách góp vốn', () => {
  const rows = sample();
  const set = (code, dr, cr) => {
    const row = rows.find((item) => item[1] === code);
    row[2] = row[6] = dr;
    row[3] = row[7] = cr;
  };
  set('1', 160, 0);
  set('13', 60, 0);
  set('3', 85, 0);
  set('4', 0, 285);
  set('7', 0, 100);
  set('8', 40, 0);
  rows.push(['', '301', 100, 0, 0, 0, 100, 0]);
  rows.push(['', '305', 0, 20, 0, 0, 0, 20]);
  rows.push(['', '344', 5, 0, 0, 0, 5, 0]);
  const { start, end } = parseBalanceSheetRows(rows);
  assert.equal(end.revenue, 100);
  assert.equal(end.expenses, 40);
  assert.equal(end.profit, 60);
  assert.equal(end.fixedAssetsGross, 100);
  assert.equal(end.accumulatedDepreciation, 20);
  assert.equal(end.fixedAssetsNet, 80);
  assert.equal(end.capitalContribution, 5);
  assert.equal(end.fixedCapital, 85);
  assert.equal(start.fixedAssetsNet, 80);
});
