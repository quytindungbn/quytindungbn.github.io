import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoanSummaryText, loanStatusText, customerDisplay } from '../js/lib/loanSummary.js';
import { boldDigits, boldText } from '../js/utils.js';

const contract = { code: '457/26', principal: 320e6, balance: 200e6, interestRate: 10.95, disbursedDate: '2025-12-25', dueDate: '2026-12-20', interestPaidUntil: '2026-05-11' };
const base = { orgName: 'Quỹ Tín Dụng Nhân Dân Bình Nguyên', hotline: '0255 3 800 800', customerName: 'Phan Thắng', heirName: 'ĐỖ THỊ KIM PHƯƠNG', contract, info: { status: 'dang_vay', days: 60 }, asOf: new Date(2026, 9, 21), days: 163, accrued: 9780000 };

test('mẫu A: đủ thông tin khoản vay, tên quỹ viết hoa làm tiêu đề, không có công thức tính lãi', () => {
  const t = buildLoanSummaryText(base);
  assert.equal(t.split('\n')[0], 'QUỸ TÍN DỤNG NHÂN DÂN BÌNH NGUYÊN');
  for (const s of ['THÔNG TIN KHOẢN VAY', '(tính đến 21/10/2026)', 'Khách hàng: PHAN THẮNG và ĐỖ THỊ KIM PHƯƠNG', 'Hợp đồng số: 457/26', 'Tình trạng: Trong hạn',
    'Số tiền vay ban đầu: 320.000.000 ₫', 'Gốc đã trả: 120.000.000 ₫', `Dư nợ gốc hiện tại: ${boldDigits('200.000.000 ₫')}`, 'Lãi suất: 10,95%/năm',
    'Ngày vay: 25/12/2025', 'Ngày đến hạn: 20/12/2026', 'Đã trả lãi đến ngày: 11/05/2026', 'Số ngày tính lãi: 163 ngày', `Tiền lãi phải trả: ${boldDigits('9.780.000 ₫')}`,
    `${boldText('I')}. ${boldText('KHOẢN VAY')}`, `${boldText('II')}. ${boldText('TIỀN LÃI')}`, 'Hotline: 0255 3 800 800']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('÷ 365') && !t.includes('×'), 'đã bỏ công thức tính lãi');
  assert.ok(!/[▌▶━┈]/.test(t), 'không dùng ký hiệu trang trí');
});

test('có kỳ trả gốc tới thì thêm dòng; không có thì không thêm', () => {
  assert.ok(!buildLoanSummaryText(base).includes('Kỳ trả gốc tới'));
  const t = buildLoanSummaryText({ ...base, nextInstallment: { date: new Date(2026, 11, 31), amount: 50e6 } });
  assert.ok(t.includes('Kỳ trả gốc tới: 31/12/2026 — 50.000.000 ₫'));
});

test('thiếu số tiền vay ban đầu hoặc đã tất toán thì bỏ phần không áp dụng', () => {
  const t = buildLoanSummaryText({ ...base, contract: { ...contract, principal: 0 } });
  assert.ok(!t.includes('Số tiền vay ban đầu') && !t.includes('Gốc đã trả'));
  const s = buildLoanSummaryText({ ...base, contract: { ...contract, balance: 0 }, info: { status: 'da_tat_toan', days: 0 } });
  assert.ok(s.includes('Tình trạng: Đã tất toán') && !s.includes(boldText('TIỀN LÃI')));
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
  const one = buildLoanSummaryText({ ...base, heirName: '' });
  assert.ok(one.includes('Khách hàng: PHAN THẮNG\n') && !one.includes(' và '));
});

test('boldText: chữ không dấu và chữ số sang kiểu đậm, dấu tiếng Việt giữ bằng dấu ghép', () => {
  assert.equal(boldText('I'), '𝐈');
  assert.equal(boldText('II'), '𝐈𝐈');
  assert.equal(boldText('VAY 2026'), '𝐕𝐀𝐘 𝟐𝟎𝟐𝟔');
  const t = boldText('KHOẢN');
  assert.ok(t.startsWith('𝐊𝐇𝐎𝐀') && t.includes('\u0309') && t.endsWith('𝐍'), 'dấu hỏi ghép sau chữ A đậm');
  assert.equal(boldText(''), '');
  assert.equal(boldText(null), '');
});
