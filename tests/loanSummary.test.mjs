import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoanSummaryText, loanStatusText, customerDisplay, textWidth, labelWidth, alignRows } from '../js/lib/loanSummary.js';
import { boldDigits } from '../js/utils.js';

const flat = (t) => t.replace(/[ \u00a0\u2000-\u200a]+/g, ' ');

const contract = { code: '457/26', principal: 320e6, balance: 200e6, interestRate: 10.95, disbursedDate: '2025-12-25', dueDate: '2026-12-20', interestPaidUntil: '2026-05-11' };
const base = { orgName: 'Quỹ Tín Dụng Nhân Dân Bình Nguyên', hotline: '0255 3 800 800', customerName: 'Phan Thắng', contract, info: { status: 'dang_vay', days: 60 }, asOf: new Date(2026, 9, 21), days: 163, accrued: 9780000 };

test('mẫu A: đủ thông tin khoản vay, tên quỹ viết hoa làm tiêu đề, không có công thức tính lãi', () => {
  const t = flat(buildLoanSummaryText(base));
  assert.equal(t.split('\n')[0], 'QUỸ TÍN DỤNG NHÂN DÂN BÌNH NGUYÊN');
  for (const s of ['THÔNG TIN KHOẢN VAY', '(tính đến 21/10/2026)', 'Khách hàng: PHAN THẮNG', 'Hợp đồng số: 457/26', 'Tình trạng: Trong hạn',
    '• Số tiền vay: 320.000.000 ₫', '• Gốc đã trả: 120.000.000 ₫', `• Dư nợ hiện tại: ${boldDigits('200.000.000 ₫')}`, '• Lãi suất: 10,95%/năm',
    '• Ngày vay: 25/12/2025', '• Ngày đến hạn: 20/12/2026', '• Đã trả lãi đến: 11/05/2026', '• Số ngày tính lãi: 163 ngày', `• Tiền lãi phải trả: ${boldDigits('9.780.000 ₫')}`,
    '\nI. KHOẢN VAY\n', '\nII. TIỀN LÃI\n', 'Hotline: 0255 3 800 800']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('ban đầu') && !t.includes('gốc hiện tại') && !t.includes('đến ngày:'), 'nhãn ngắn gọn: "Số tiền vay", "Dư nợ hiện tại", "Đã trả lãi đến"');
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

test('phần giá trị sau dấu ":" thẳng hàng một cột (ước lượng lệch không quá 1/12 em, khoảng 1–2px)', () => {
  const out = buildLoanSummaryText({ ...base, nextInstallment: { date: new Date(2026, 11, 31), amount: 50e6 } });
  const lines = out.split('\n');
  const start = (l, prefix) => { const m = l.match(new RegExp(`^${prefix}([^:]+):([ \\u2000-\\u200a]+)`)); return labelWidth(m[1], prefix) + textWidth(m[2]); };
  const spread = (ws) => Math.max(...ws) - Math.min(...ws);
  const bullets = lines.filter((l) => l.startsWith('• '));
  assert.equal(bullets.length, 10);
  assert.ok(spread(bullets.map((l) => start(l, '• '))) <= 84, 'cột mục I/II lệch ' + spread(bullets.map((l) => start(l, '• '))));
  assert.ok(spread(lines.slice(4, 7).map((l) => start(l, ''))) <= 84, 'khối Khách hàng/Hợp đồng/Tình trạng cũng thẳng cột');
});

test('alignRows: nhãn ngắn được đệm bằng khoảng trắng cố định theo em (không bị gộp), giữ đúng nội dung', () => {
  const out = alignRows([['Ngày', 'A'], ['Dư nợ hiện tại', 'B']]);
  assert.ok(/[\u2002-\u2006]/.test(out[0]));
  assert.equal(flat(out[0]), 'Ngày: A');
  assert.equal(flat(out[1]), 'Dư nợ hiện tại: B');
  assert.ok(!/[ \u00a0]/.test(out[0]), 'không dùng dấu cách thường/NBSP để đệm (dễ bị gộp hoặc lệch)');
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

test('tên khách IN HOA và chỉ lấy tên MỘT người (không ghi thêm người đồng vay)', () => {
  assert.equal(customerDisplay('Phan Thắng'), 'PHAN THẮNG');
  assert.equal(customerDisplay('  lê thị thanh '), 'LÊ THỊ THANH');
  assert.equal(customerDisplay(undefined), '');
  const t = flat(buildLoanSummaryText({ ...base, heirName: 'ĐỖ THỊ KIM PHƯƠNG' }));
  assert.ok(t.includes('Khách hàng: PHAN THẮNG\n') && !t.includes(' và ') && !t.includes('KIM PHƯƠNG'));
});
