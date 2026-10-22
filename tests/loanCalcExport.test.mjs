import test from 'node:test';
import assert from 'node:assert/strict';
import { inputLines, summaryItems, summaryTiles, printModel, loanCalcFileName, buildLoanCalcXlsx, buildLoanCalcPrintHtml, TABLE_HEAD } from '../js/lib/loanCalcExport.js';
import { unzipEntries } from './helpers/unzip.mjs';
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
  assert.match(b['Số tiền này là'], /Gồm cả gốc và lãi/);
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

test('bốn ô tổng của bản in: đúng thứ tự và chữ như trên màn hình, ô nổi bật khác nhau theo tab', () => {
  const a = summaryTiles(term, termRes);
  assert.deepEqual(a.map((t) => t.label), ['Tổng gốc', 'Tổng lãi', 'Tổng phải trả', 'Thời hạn']);
  assert.deepEqual(a.map((t) => !!t.hi), [false, true, false, false]);
  assert.equal(a[3].value, '12 tháng');
  assert.equal(a[3].sub, 'Đến 22/10/2027');
  assert.equal(a[1].sub, '365 ngày thực tế');
  const b = summaryTiles(pay, payRes);
  assert.deepEqual(b.map((t) => t.label), ['Trả hết sau', 'Tổng gốc', 'Tổng lãi', 'Tổng phải trả']);
  assert.equal(b[0].hi, true);
});

test('mô hình bản in: chữ đã định dạng sẵn, mỗi kỳ một dòng, dòng cộng khớp tổng', () => {
  const m = printModel({ org, inputs: term, result: termRes, printedOn: start });
  assert.equal(m.orgName, 'QUỸ TÍN DỤNG NHÂN DÂN BÌNH NGUYÊN');
  assert.equal(m.dateText, 'Lập ngày 22/10/2026');
  assert.equal(m.subtitle, 'Tính theo thời hạn vay');
  assert.equal(printModel({ org, inputs: pay, result: payRes, printedOn: start }).subtitle, 'Tính theo số tiền trả hàng tháng');
  assert.equal(m.rows.length, 12);
  assert.deepEqual(m.rows[0], { ky: 'Kỳ 1', date: '22/11/2026', days: '31', opening: '200.000.000', principal: '16.667.000', interest: '1.756.000', payment: '18.423.000', closing: '183.333.000' });
  assert.deepEqual(m.total, { days: '365', principal: '200.000.000', interest: '11.201.000', payment: '211.201.000' });
  const bullet = scheduleByTerm({ principal: 200e6, ratePercent: 10.34, months: 12, startDate: start, method: 'bullet' });
  assert.equal(printModel({ org, inputs: { ...term, method: 'bullet' }, result: bullet, printedOn: start }).rows[0].principal, '—', 'kỳ không trả gốc hiện dấu gạch');
  assert.equal(printModel({ inputs: term, result: termRes }).orgName, 'QUỸ TÍN DỤNG NHÂN DÂN', 'thiếu tên quỹ dùng tên mặc định');
});

test('bản in: A4 ngang, kiểu chữ của app, đủ tiêu đề, điều kiện, số tổng, mọi kỳ và dòng cộng; ký tự đặc biệt được thoát', () => {
  const html = buildLoanCalcPrintHtml({ org: { name: 'Quỹ <A> & B' }, inputs: term, result: termRes, printedOn: start });
  assert.match(html, /size:A4 landscape/);
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Inter[^"]*Source\+Serif\+4/, 'tải đúng kiểu chữ app đang dùng');
  assert.match(html, /font:500 9\.5pt\/1\.4 'Inter'/);
  assert.match(html, /'Source Serif 4'/);
  assert.match(html, /QUỸ &lt;A&gt; &amp; B/);
  assert.match(html, /BẢNG TÍNH LÃI VAY/);
  assert.match(html, /Tính theo thời hạn vay/);
  assert.match(html, /counter\(page\) " \/ " counter\(pages\)/, 'có số trang');
  assert.equal((html.match(/<td class="l">Kỳ \d+<\/td>/g) || []).length, 12);
  assert.match(html, /<td class="p">18\.423\.000<\/td>/);
  assert.match(html, /<td class="l">Cộng<\/td><td><\/td><td class="c">365<\/td><td><\/td><td>200\.000\.000<\/td>/);
  for (const head of TABLE_HEAD) assert.ok(html.includes(`>${head}</th>`), head);
  assert.equal((html.match(/class="tile( hi)?"/g) || []).length, 4);
  assert.match(html, /Lập ngày 22\/10\/2026/);
  assert.match(html, /\.t td\{[^}]*border-bottom:\.3mm solid #a3b8ae\}/, 'kẻ từng dòng của bảng đủ đậm để rà theo hàng');
  assert.ok(!html.includes('<A>'), 'tên quỹ có ký tự đặc biệt không lọt thô vào HTML (kể cả trong khối CSS)');
  assert.equal((buildLoanCalcPrintHtml({ org: { name: 'x</style><script>1</script>' }, inputs: term, result: termRes, printedOn: start }).match(/<\/style>/g) || []).length, 1, 'tên quỹ không đóng sớm thẻ style');
  const cssTitle = /@top-left\{content:"((?:[^"\\]|\\.)*)"/.exec(buildLoanCalcPrintHtml({ org: { name: 'Quỹ "X" \\ Y' }, inputs: term, result: termRes, printedOn: start }));
  assert.ok(cssTitle && cssTitle[1].includes('\\"X\\"') && cssTitle[1].includes('\\\\'), 'chuỗi trong CSS được thoát dấu " và \\');
});

test('file Excel: A4 ngang, vừa chiều ngang, có bảng đủ kỳ, ngày thật, dòng cộng, tiêu đề bảng lặp lại và số trang', () => {
  const bytes = buildLoanCalcXlsx({ org, inputs: pay, result: payRes, printedOn: start });
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  const files = unzipEntries(bytes);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.ok(sheet.includes('BẢNG TÍNH LÃI VAY'));
  assert.ok(sheet.includes('QUỸ TÍN DỤNG NHÂN DÂN BÌNH NGUYÊN'));
  assert.ok(sheet.includes('Kỳ 11') && !sheet.includes('Kỳ 12'));
  assert.ok(sheet.includes('<v>10063000</v>'), 'tổng lãi là số');
  assert.ok(sheet.includes('<v>46348</v>'), 'ngày trả kỳ 1 (22/11/2026) là ngày của Excel');
  assert.ok(sheet.includes('orientation="landscape" fitToWidth="1" fitToHeight="0"'));
  assert.ok(sheet.includes('<mergeCell ref="A2:H2"/>'), 'tiêu đề gộp ô trải hết bề ngang');
  assert.ok(sheet.includes('Trang &amp;P / &amp;N'));
  const wb = files['xl/workbook.xml'];
  const head = /!\$(\d+):\$(\d+)<\/definedName>/.exec(wb);
  assert.ok(head && head[1] === head[2], 'có dòng lặp ở đầu mỗi trang in');
  assert.ok(new RegExp(`<row r="${head[1]}"[^>]*><c r="A${head[1]}"[^>]*t="inlineStr"><is><t xml:space="preserve">Kỳ</t>`).test(sheet), 'dòng lặp đúng là dòng tiêu đề bảng');
  const styles = files['xl/styles.xml'];
  assert.ok(styles.includes('Cambria') && styles.includes('Calibri'));
  assert.ok(styles.includes('formatCode="dd/mm/yyyy"'));
  assert.ok(styles.includes('<bottom style="thin"><color rgb="FF98AEA3"/></bottom>'), 'kẻ từng dòng của bảng đủ đậm');
  const term2 = unzipEntries(buildLoanCalcXlsx({ org, inputs: term, result: termRes, printedOn: start }))['xl/worksheets/sheet1.xml'];
  assert.ok(term2.includes('Gốc trả đều mỗi tháng') && term2.includes('Thời hạn vay'));
});
