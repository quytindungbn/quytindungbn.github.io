import test from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords, buildNoticeHtml } from '../js/lib/printNotices.js';

const base = {
  contract: { code: '020/26', balance: 20000000, interestRate: 10.95, disbursedDate: '2026-02-12', interestPaidUntil: '2026-05-12', dueDate: '2026-10-20' },
  customer: { name: 'NGUYỄN VĂN A', address: 'Xóm 10, thôn Bình Nguyên' },
  org: { name: 'Quỹ tín dụng Nhân dân Bình Nguyên' },
  interest: 918000,
  asOf: new Date(2026, 9, 12),
};

test('số tiền bằng chữ giữ đúng đơn vị triệu, nghìn và đồng', () => {
  assert.equal(amountInWords(918000), 'Chín trăm mười tám nghìn đồng chẵn');
  assert.equal(amountInWords(20918000), 'Hai mươi triệu chín trăm mười tám nghìn đồng chẵn');
  assert.equal(amountInWords(0), 'Không đồng');
});

test('hai mẫu in dùng đúng hợp đồng, địa chỉ và khoản phải trả khác nhau', () => {
  const interest = buildNoticeHtml({ ...base, type: 'interest' });
  const due = buildNoticeHtml({ ...base, type: 'due' });
  for (const html of [interest, due]) {
    assert.match(html, /Địa chỉ: Xóm 10, thôn Bình Nguyên/);
    assert.match(html, /Bình Sơn, ngày 12 tháng 10 năm 2026/);
    assert.match(html, /Hợp đồng tín dụng số 020\/26/);
    assert.match(html, /CÁN BỘ TÍN DỤNG/);
    assert.match(html, /\(Ký, đóng dấu\)/);
    assert.doesNotMatch(html, /nếu phát hành/);
  }
  assert.match(interest, /Số tiền lãi: 918\.000 ₫/);
  assert.match(interest, /Đề nghị ông\/bà thanh toán đầy đủ số tiền lãi nêu trên/);
  assert.match(interest, /xem xét thu hồi nợ trước hạn khi đủ điều kiện/);
  assert.doesNotMatch(interest, /chịu hoàn toàn trước pháp luật/);
  assert.match(due, /Tổng gốc và lãi/);
  assert.match(due, /Yêu cầu ông\/bà trước ngày…… tháng…… năm………… phải thực hiện nghĩa vụ thanh toán toàn bộ nợ gốc và lãi theo hợp đồng tín dụng đã cam kết cho Quỹ tín dụng Nhân dân Bình Nguyên/);
  assert.doesNotMatch(due, /phải có mặt tại/);
  assert.match(due, /20\.918\.000 ₫/);
  assert.match(due, /ngày…… tháng…… năm/);
});

test('dữ liệu khách hàng trong giấy báo được mã hóa HTML', () => {
  const html = buildNoticeHtml({ ...base, type: 'due', customer: { name: '<img src=x onerror=alert(1)>', address: '<script>alert(1)</script>' } });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});
