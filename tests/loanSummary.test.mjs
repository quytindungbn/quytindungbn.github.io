import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoanSummaryText, loanStatusText, customerDisplay, textWidth, alignRows } from '../js/lib/loanSummary.js';
import { boldDigits } from '../js/utils.js';

// Bỏ phần đệm khoảng trắng canh cột để kiểm tra nội dung chữ.
const flat = (t) => t.replace(/[ \u00a0]+/g, ' ');

const contract = { code: '457/26', principal: 320e6, balance: 200e6, interestRate: 10.95, disbursedDate: '2025-12-25', dueDate: '2026-12-20', interestPaidUntil: '2026-05-11' };
const base = { orgName: 'Quỹ Tín Dụng Nhân Dân Bình Nguyên', hotline: '0255 3 800 800', customerName: 'Phan Thắng', heirName: 'ĐỖ THỊ KIM PHƯƠNG', contract, info: { status: 'dang_vay', days: 60 }, asOf: new Date(2026, 9, 21), days: 163, accrued: 9780000 };

test('mẫu A: đủ thông tin khoản vay, tên quỹ viết hoa làm tiêu đề, không có công thức tính lãi', () => {
  const t = flat(buildLoanSummaryText(base));
  assert.equal(t.split('\n')[0], 'QUỸ TÍN DỤNG NHÂN DÂN BÌNH NGUYÊN');
  for (const s of ['THÔNG TIN KHOẢN VAY', '(tính đến 21/10/2026)', 'Khách hàng: PHAN THẮNG và ĐỖ THỊ KIM PHƯƠNG', 'Hợp đồng số: 457/26', 'Tình trạng: Trong hạn',
    '• Số tiền vay: 320.000.000 ₫', '• Gốc đã trả: 120.000.000 ₫', `• Dư nợ gốc hiện tại: ${boldDigits('200.000.000 ₫')}`, '• Lãi suất: 10,95%/năm',
    '• Ngày vay: 25/12/2025', '• Ngày đến hạn: 20/12/2026', '• Đã trả lãi đến ngày: 11/05/2026', '• Số ngày tính lãi: 163 ngày', `• Tiền lãi phải trả: ${boldDigits('9.780.000 ₫')}`,
    '\nI. KHOẢN VAY\n', '\nII. TIỀN LÃI\n', 'Hotline: 0255 3 800 800']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('ban đầu'), 'nhãn là "Số tiền vay", không còn "ban đầu"');
  assert.ok(!t.includes('÷ 365') && !t.includes('×'), 'đã bỏ công thức tính lãi');
  assert.ok(!/[▌▶━┈]/.test(t), 'không dùng ký hiệu trang trí');
});

test('chỉ số tiền dùng chữ số đậm; chữ tiếng Việt giữ chữ thường để Zalo không lỗi font', () => {
  const t = buildLoanSummaryText(base);
  assert.ok(!/[\u{1D400}-\u{1D7CD}]/u.test(t), 'không có chữ cái đậm kiểu Unicode');
  assert.ok(!/[\u0300-\u036f]/.test(t), 'không có dấu ghép rời');
});

test('gạch ngang chia dòng ngắn, không bị xuống dòng trong khung tin nhắn', () => {
  const lines = buildLoanSummaryText(base).split('\n').filter((l) => /^─+$/.test(l));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(l.length <= 16, `gạch ngang dài ${l.length}`);
});

test('phần giá trị sau dấu ":" thẳng hàng một cột (các dòng lệch nhau không quá một dấu cách)', () => {
  const t = buildLoanSummaryText({ ...base, nextInstallment: { date: new Date(2026, 11, 31), amount: 50e6 } });
  const space = textWidth(' ');
  const columns = t.split('\n').filter((l) => l.startsWith('• ')).map((l) => textWidth(l.match(/^(• [^:]+:[ \u00a0]+)/)[1]));
  assert.equal(columns.length, 10);
  assert.ok(Math.max(...columns) - Math.min(...columns) <= space + 1, `cột lệch ${Math.max(...columns) - Math.min(...columns)}`);
  const head = t.split('\n').slice(4, 7).map((l) => textWidth(l.match(/^([^:]+:[ \u00a0]+)/)[1]));
  assert.ok(Math.max(...head) - Math.min(...head) <= space + 1, 'khối Khách hàng/Hợp đồng/Tình trạng cũng thẳng cột');
});

test('alignRows: nhãn ngắn được đệm bằng khoảng trắng không bị gộp, giữ đúng nội dung', () => {
  const out = alignRows([['Ngày', 'A'], ['Dư nợ gốc hiện tại', 'B']]);
  assert.ok(out[0].includes('\u00a0') && !out[1].includes('\u00a0'));
  assert.equal(flat(out[0]), 'Ngày: A');
  assert.equal(flat(out[1]), 'Dư nợ gốc hiện tại: B');
});

test('có kỳ trả gốc tới thì thêm dòng; không có thì không thêm', () => {
  assert.ok(!buildLoanSummaryText(base).includes('Kỳ trả gốc tới'));
  const t = buildLoanSummaryText({ ...base, nextInstallment: { date: new Date(2026, 11, 31), amount: 50e6 } });
  assert.ok(flat(t).includes('Kỳ trả gốc tới: 31/12/2026 — 50.000.000 ₫'));
});

test('thiếu số tiền vay ban đầu hoặc đã tất toán thì bỏ phần không áp dụng', () => {
  const t = buildLoanSummaryText({ ...base, contract: { ...contract, principal: 0 } });
  assert.ok(!t.includes('Số tiền vay') && !t.includes('Gốc đã trả'));
  const s = flat(buildLoanSummaryText({ ...base, contract: { ...contract, balance: 0 }, info: { status: 'da_tat_toan', days: 0 } }));
  assert.ok(s.includes('Tình trạng: Đã tất toán') && !s.includes('TIỀN LÃI'));
});

test('cách nói tình trạng dành cho khách', () => {
  assert.equal(loanStatusText({ status: 'qua_han', days: 12 }), 'Quá hạn 12 ngày');
  assert.equal(loanStatusText({ status: 'gan_den_han', days: 9 }), 'Còn 9 ngày đến hạn');
  assert.equal(loanStatusText({ status: 'dang_vay', days: 100 }), 'Trong hạn');
});

test('tên khách IN HOA, chữ "và" viết thường; chỉ 1 tên thì không có chữ "và"', () => {
  assert.equal(customerDisplay('Phan Thắng', 'ĐỖ THỊ KIM PHƯƠNG'), 'PHAN THẮNG và ĐỖ THỊ KIM PHƯƠNG');
  assert.equal(customerDisplay('Phan Thắng', ''), 'PHAN THẮNG');
  assert.equal(customerDisplay('Phan Thắng', undefined), 'PHAN THẮNG');
  assert.equal(customerDisplay('Phan Thắng', 'phan thắng'), 'PHAN THẮNG', 'đồng vay trùng tên khách thì không lặp');
  const one = flat(buildLoanSummaryText({ ...base, heirName: '' }));
  assert.ok(one.includes('Khách hàng: PHAN THẮNG\n') && !one.includes(' và '));
});
