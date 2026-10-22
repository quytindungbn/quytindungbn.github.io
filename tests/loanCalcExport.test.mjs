import test from 'node:test';
import assert from 'node:assert/strict';
import { inputLines, summaryItems, loanCalcFileName, buildLoanCalcXlsx, buildLoanCalcPrintHtml, TABLE_HEAD } from '../js/lib/loanCalcExport.js';
import { scheduleByTerm, scheduleByPayment } from '../js/lib/loanCalc.js';

const start = new Date(2026, 9, 22);
const org = { name: 'Quỹ Tín Dụng Nhân Dân Bình Nguyên' };
const term = { tab: 'term', principal: 200e6, ratePercent: 10.34, startDate: start, months: 12, method: 'equalPrincipal' };
const termRes = scheduleByTerm({ principal: 200e6, ratePercent: 10.34, months: 12, startDate: start, method: 'equalPrincipal' });
const pay = { tab: 'pay', principal: 200e6, ratePercent: 10.34, startDate: start, payment: 20e6, kind: 'gocLai' };
const payRes = scheduleByPayment({ principal: 200e6, ratePercent: 10.34, payment: 20e6, startDate: start, kind: 'gocLai' });

test('điều kiện đã nhập: tab thời hạn và tab trả hàng tháng ghi đúng các dòng', () => {
  const a = Object.fromEntries(inputLines(term, termRes));
  assert.equal(a['Thời hạn vay'], '12 tháng');
  assert.match(a['Cách trả'], /Gốc trả đều/);
  assert.match(a['Lãi suất'], /10,34%\/năm/);
  const b = Object.fromEntries(inputLines(pay, payRes));
  assert.match(b['Số tiền trả mỗi tháng'], /20\.000\.000/);
  assert.match(b['Số tiền này là'], /gồm cả gốc và lãi/);
});

test('bốn ô tổng khớp số trên màn hình', () => {
  const s = summaryItems(term, termRes);
  assert.deepEqual(s.map((x) => x.label), ['Tổng gốc', 'Tổng lãi', 'Tổng phải trả', 'Thời hạn']);
  assert.match(s[1].value, /11\.201\.000/);
  assert.equal(summaryItems(pay, payRes)[3].label, 'Trả hết sau');
});

test('tên tệp theo ngày', () => {
  assert.equal(loanCalcFileName(new Date(2026, 9, 22)), 'Tinh-lai-vay_20261022.xlsx');
  assert.equal(loanCalcFileName(new Date(2026, 0, 5), 'pdf'), 'Tinh-lai-vay_20260105.pdf');
});

test('bản in: đủ tiêu đề, điều kiện, số tổng, mọi kỳ và dòng cộng; ký tự đặc biệt được thoát', () => {
  const html = buildLoanCalcPrintHtml({ org: { name: 'Quỹ <A> & B' }, inputs: term, result: termRes, printedOn: start });
  assert.match(html, /QUỸ &lt;A&gt; &amp; B/);
  assert.match(html, /BẢNG TÍNH LÃI VAY/);
  assert.equal((html.match(/<td class="l">Kỳ \d+<\/td>/g) || []).length, 12);
  assert.match(html, /<td class="p">18\.423\.000<\/td>/);
  assert.match(html, /Cộng<\/td><td><\/td><td>365<\/td>/);
  for (const head of TABLE_HEAD.slice(1)) assert.ok(html.includes(head), head);
  assert.match(html, /In ngày 22\/10\/2026/);
});

test('file Excel: là ZIP hợp lệ, có bảng đủ kỳ và dòng cộng', () => {
  const bytes = buildLoanCalcXlsx({ org, inputs: pay, result: payRes, printedOn: start });
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('BẢNG TÍNH LÃI VAY'));
  assert.ok(text.includes('Kỳ 11') && !text.includes('Kỳ 12'));
  assert.ok(text.includes('<v>10063000</v>'));
});
