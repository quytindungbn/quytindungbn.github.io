import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBalance, yearOpeningReport, previousDecemberReport, historicAccountLines, accountDetailChanges, loanTermChildren, selectLatestBalanceImports, provisionDifference, nextProvisionDeadline, managementRatios, monthlyProfit, previousMonthReport, provisionAlertTarget, provisionAdjustment } from '../js/lib/balanceSheetMetrics.js';

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

test('mốc vốn chủ sở hữu mục chính là cuối tháng 12 năm trước', () => {
  const reports = [
    { year_month: '2025-12', figures: { end: { equity: 3_800 } } },
    { year_month: '2026-01', figures: { start: { equity: 3_790 } } },
  ];
  assert.equal(compareBalance(4_200, previousDecemberReport(reports, '2026-09').figures.end.equity).amount, 400);
  assert.equal(previousDecemberReport(reports, '2025-12'), null);
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

test('tài khoản vốn biến mất khỏi file vẫn hiện số dư gần nhất và mức giảm từ đầu năm', () => {
  const januaryLine = { code: '69', name: 'Lợi nhuận chưa phân phối', balance: 5 };
  const reports = [
    { year_month: '2026-01', figures: { start: { accountDetails: { equityOther: [januaryLine] } }, end: { accountDetails: { equityOther: [januaryLine] } } } },
    { year_month: '2026-04', figures: { start: { accountDetails: { equityOther: [] } }, end: { accountDetails: { equityOther: [] } } } },
  ];
  const history = historicAccountLines(reports, '2026-04', 'equityOther');
  const [line] = accountDetailChanges([], [], [januaryLine], history);
  assert.equal(line.name, 'Lợi nhuận chưa phân phối');
  assert.equal(line.balance, 0);
  assert.equal(line.lastBalance, 5);
  assert.equal(line.lastMonth, '2026-01');
  assert.equal(compareBalance(line.balance, line.yearBalance).percent, -100);
});

test('nạp nhiều file lấy bản mới nhất từng tháng và chặn hai bản cùng ngày', () => {
  const file = (name, yearMonth, periodEnd) => ({ file: { name }, parsed: { yearMonth, periodEnd } });
  const older = file('a.xls', '2026-09', '2026-09-05');
  const newer = file('b.xls', '2026-09', '2026-09-30');
  const october = file('c.xls', '2026-10', '2026-10-07');
  const result = selectLatestBalanceImports([october, older, newer]);
  assert.deepEqual(result.selected, [newer, october]);
  assert.deepEqual(result.skipped, [older]);
  assert.throws(() => selectLatestBalanceImports([newer, file('d.xls', '2026-09', '2026-09-30')]), /cùng ngày/);
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

test('lợi nhuận hàng tháng là chênh lệch lợi nhuận lũy kế đầu và cuối tháng', () => {
  const report = (yearMonth, start, end) => ({ year_month: yearMonth, figures: { start: { profit: start }, end: { profit: end } } });
  assert.equal(monthlyProfit(report('2026-10', 828e6, 920e6)), 92e6);
  assert.equal(monthlyProfit(report('2026-05', 352e6, 300e6)), -52e6);
  assert.equal(monthlyProfit(report('2026-01', 0, 86e6)), 86e6);
  assert.equal(monthlyProfit(report('2026-01', 1_000e6, 86e6)), 86e6);
  assert.equal(monthlyProfit(report('2026-01', undefined, -15e6)), -15e6);
  assert.equal(monthlyProfit(report('2026-02', undefined, 86e6)), null);
  assert.equal(monthlyProfit({ year_month: '2026-03', figures: { end: {} } }), null);
  assert.equal(monthlyProfit(null), null);
});

test('tháng liền trước kể cả qua năm', () => {
  const reports = [{ year_month: '2025-12' }, { year_month: '2026-01' }, { year_month: '2026-03' }];
  assert.equal(previousMonthReport(reports, '2026-01').year_month, '2025-12');
  assert.equal(previousMonthReport(reports, '2026-02').year_month, '2026-01');
  assert.equal(previousMonthReport(reports, '2026-04').year_month, '2026-03');
  assert.equal(previousMonthReport(reports, '2026-03'), null);
  assert.equal(previousMonthReport(reports, 'abc'), null);
});

test('nhắc trích / hoàn nhập dự phòng chỉ hiện từ ngày 01 đến hết ngày 07, cho tháng liền trước, khi xem tháng đó hoặc tháng hiện tại', () => {
  const reports = ['2026-09', '2026-10', '2026-11'].map((year_month) => ({ year_month }));
  const day = (year, month, date) => new Date(year, month - 1, date, 12);
  assert.equal(provisionAlertTarget(reports, '2026-11', day(2026, 11, 4)).year_month, '2026-10');
  assert.equal(provisionAlertTarget(reports, '2026-10', day(2026, 11, 4)).year_month, '2026-10');
  assert.equal(provisionAlertTarget(reports, '2026-11', day(2026, 11, 1)).year_month, '2026-10');
  assert.equal(provisionAlertTarget(reports, '2026-11', day(2026, 11, 7)).year_month, '2026-10');
  assert.equal(provisionAlertTarget(reports, '2026-11', day(2026, 11, 8)), null);
  assert.equal(provisionAlertTarget(reports, '2026-10', day(2026, 11, 8)), null);
  assert.equal(provisionAlertTarget(reports, '2026-09', day(2026, 11, 4)), null);
  assert.equal(provisionAlertTarget(reports, '2026-10', day(2026, 10, 25)), null);
  assert.equal(provisionAlertTarget(reports, '2026-10', day(2026, 10, 5)).year_month, '2026-09');
  assert.equal(provisionAlertTarget(reports.filter((item) => item.year_month !== '2026-10'), '2026-11', day(2026, 11, 4)), null);
  assert.equal(provisionAlertTarget([{ year_month: '2026-12' }], '2027-01', day(2027, 1, 3)).year_month, '2026-12');
});

test('chênh lệch dự phòng lấy theo dòng Tổng dự phòng: một số tiền, dư hay thiếu, hạn ngày 07 tháng sau', () => {
  const report = { year_month: '2026-10', figures: { end: { generalProvision: 342_000_000, specificProvision: 230_000_000, totalProvision: 572_000_000 } } };
  assert.deepEqual(provisionAdjustment(report, { generalProvision: 354_450_000, specificProvision: 203_000_000 }),
    { gap: 14_550_000, yearMonth: '2026-10', deadline: '07/11/2026' });
  assert.equal(provisionAdjustment(report, { generalProvision: 360_000_000, specificProvision: 240_000_000 }).gap, -28_000_000);
  assert.equal(provisionAdjustment(report, { generalProvision: 352_000_000, specificProvision: 220_000_000 }), null);
  const withOther = { ...report, figures: { end: { ...report.figures.end, totalProvision: 575_000_000 } } };
  assert.equal(provisionAdjustment(withOther, { generalProvision: 342_000_000, specificProvision: 230_000_000 }).gap, 3_000_000);
  const oldImport = { year_month: '2026-12', figures: { end: { generalProvision: 10, specificProvision: 5 } } };
  assert.deepEqual(provisionAdjustment(oldImport, { generalProvision: 12, specificProvision: 5 }), { gap: -2, yearMonth: '2026-12', deadline: '07/01/2027' });
  assert.equal(provisionAdjustment(report, { generalProvision: 342_000_000.3, specificProvision: 230_000_000 }), null);
  assert.equal(provisionAdjustment(report, null), null);
  assert.equal(provisionAdjustment(null, { generalProvision: 1, specificProvision: 1 }), null);
  assert.equal(provisionAdjustment(report, { generalProvision: NaN, specificProvision: 230_000_000 }), null);
});

test('mục con dư nợ cho vay theo kỳ hạn: loại không có số dư thì ẩn, có số ở đầu hoặc cuối kỳ thì hiện; kỳ chưa lưu thì không có mục nào', () => {
  const none = { loanTermShort: 0, loanTermMedium: 0, loanTermLong: 0, loanTermOther: 0 };
  const terms = { ...none, loanTermShort: 100, loanTermMedium: 50 };
  const labels = (rows) => rows.map(([label]) => label);
  assert.deepEqual(labels(loanTermChildren({ ...terms }, { ...terms })), ['Ngắn hạn', 'Trung hạn']);
  assert.deepEqual(labels(loanTermChildren({ ...terms, loanTermLong: 5 }, { ...terms })), ['Ngắn hạn', 'Trung hạn', 'Dài hạn']);
  assert.deepEqual(labels(loanTermChildren({ ...terms }, { ...terms, loanTermLong: 8 })), ['Ngắn hạn', 'Trung hạn', 'Dài hạn']);
  assert.deepEqual(loanTermChildren({ ...terms }, { ...terms, loanTermOther: 7 }).at(-1), ['Khác', 'loanTermOther']);
  assert.deepEqual(loanTermChildren({ ...terms, loanTermOther: 3 }, { ...terms }).at(-1), ['Khác', 'loanTermOther']);
  assert.deepEqual(labels(loanTermChildren(null, { ...terms })), ['Ngắn hạn', 'Trung hạn']);
  assert.deepEqual(loanTermChildren({ ...none }, { ...none }), []);
  assert.deepEqual(labels(loanTermChildren(null, { ...terms }, { showZero: true })), ['Ngắn hạn', 'Trung hạn', 'Dài hạn']);
  assert.deepEqual(loanTermChildren({ grossLoans: 150 }, { grossLoans: 150 }), []);
  assert.deepEqual(loanTermChildren({ ...terms }, { loanTermShort: 100, loanTermMedium: 50 }), []);
  assert.deepEqual(loanTermChildren(undefined, undefined), []);
  assert.deepEqual(loanTermChildren(null, { grossLoans: 150 }, { showZero: true }), []);
});
