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

test('chi tiết TK 36 cấp 3 và các nguồn nợ khác khớp số tổng, không cộng trùng tài khoản cha', () => {
  const rows = sample();
  const set = (index, name, code, dr, cr) => {
    rows[index] = [name, code, dr, cr, 0, 0, dr, cr];
  };
  set(20, 'Tài sản khác', '3', 15, 0);
  set(21, 'Các khoản phải trả', '4', 0, 215);
  set(26, 'Các khoản phải thu nội bộ', '36', 10, 0);
  set(27, 'Tạm ứng nghiệp vụ', '3612', 6, 0);
  set(28, 'Phải thu nội bộ khác', '3621', 4, 0);
  set(29, 'Lãi phải thu', '391', 5, 0);
  rows.push(['Chi tiết tạm ứng', '3612.01', 6, 0, 0, 0, 6, 0]);
  rows.push(['Các khoản phải trả bên ngoài', '45', 0, 10, 0, 0, 0, 10]);
  rows.push(['Thuế phải nộp', '453', 0, 7, 0, 0, 0, 7]);
  rows.push(['Phải trả khác', '459', 0, 3, 0, 0, 0, 3]);
  rows.push(['Lãi và phí phải trả', '49', 0, 5, 0, 0, 0, 5]);
  const { end } = parseBalanceSheetRows(rows);
  assert.equal(end.internalReceivables, 10);
  assert.equal(end.otherLiabilities, 10);
  assert.deepEqual(end.accountDetails.internalReceivables.map(({ code, balance }) => [code, balance]),
    [['3612', 6], ['3621', 4]]);
  assert.deepEqual(end.accountDetails.otherLiabilities.map(({ code, balance }) => [code, balance]),
    [['453', 7], ['459', 3]]);
  assert.equal(end.accountDetails.internalReceivables[0].name, 'Tạm ứng nghiệp vụ');
  assert.equal(end.accountDetails.otherLiabilities[0].name, 'Thuế phải nộp');
});

test('TK 484 tách 4841/4842; TK 461 và 469 tách hết tài khoản con', () => {
  const rows = sample();
  const set = (index, name, code, dr, cr) => {
    rows[index] = [name, code, dr, cr, 0, 0, dr, cr];
  };
  set(11, 'Tài sản', '1', 120, 0);
  set(12, 'Tiền mặt', '101', 120, 0);
  set(21, 'Phải trả', '4', 0, 220);
  set(26, 'Phải trả nội bộ', '46', 0, 15);
  set(27, 'Lợi tức vốn góp', '461', 0, 7);
  set(28, 'Phải trả khác', '469', 0, 8);
  set(29, 'Tài sản nợ khác', '48', 0, 5);
  rows.push(['Quỹ khác', '484', 0, 5, 0, 0, 0, 5]);
  rows.push(['Quỹ khen thưởng', '4841', 0, 2, 0, 0, 0, 2]);
  rows.push(['Quỹ phúc lợi', '4842', 0, 3, 0, 0, 0, 3]);
  rows.push(['Lợi tức vốn góp', '461.01', 0, 5, 0, 0, 0, 5]);
  rows.push(['Phải trả nội bộ khác', '461.02', 0, 2, 0, 0, 0, 2]);
  rows.push(['Lợi tức theo mẫu cũ', '469.01', 0, 8, 0, 0, 0, 8]);
  const end = parseBalanceSheetRows(rows).end;
  assert.equal(end.otherLiabilities, 20);
  assert.deepEqual(end.accountDetails.otherLiabilities.map(({ code, balance }) => [code, balance]), [
    ['461.01', 5], ['461.02', 2], ['469.01', 8], ['4841', 2], ['4842', 3],
  ]);
  assert.equal(end.accountDetails.otherLiabilities.reduce((sum, row) => sum + row.balance, 0), 20);
});
