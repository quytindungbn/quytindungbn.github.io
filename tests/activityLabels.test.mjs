import test from 'node:test';
import assert from 'node:assert/strict';
import { describeOrgPatch, describeLoanCalc, trailText, trailList, describeThonXom, describeDateRange, describeSearch, clipLabel } from '../js/lib/activityLabels.js';
import { METHOD_LABELS, KIND_LABELS } from '../js/lib/loanCalcExport.js';

test('mô tả mục cài đặt vừa sửa: gọn, bỏ trùng, không ghi giá trị', () => {
  assert.equal(describeOrgPatch({ hotline: '1900', bannerTitle: 'x', bannerText: 'y', bannerEnabled: true }), 'hotline, banner');
  assert.equal(describeOrgPatch({ name: 'A', pushTemplates: {} }), 'tên quỹ, mẫu thông báo');
  assert.equal(describeOrgPatch({ lạ: 1 }), 'lạ');
  assert.equal(describeOrgPatch({}), '');
});

test('mô tả lần bấm Tính lãi (cả hai cách tính)', () => {
  const start = new Date(2026, 9, 23);
  assert.equal(
    describeLoanCalc({ tab: 'term', principal: 200e6, ratePercent: 10.5, startDate: start, months: 12, method: 'equalPrincipal' }),
    'Tính lãi vay theo thời hạn: vay **200.000.000 ₫**, lãi suất **10,5%/năm**, **12 tháng**, gốc trả đều mỗi tháng',
  );
  const withDue = describeLoanCalc({ tab: 'term', principal: 100e6, ratePercent: 11.5, startDate: start, months: 6, method: 'annuity', fixedAmount: 5e6, endDate: new Date(2027, 3, 15) });
  assert.match(withDue, /đến ngày \*\*15\/04\/2027\*\*/);
  assert.match(withDue, /5\.000\.000 ₫\/tháng/);
  const pay = describeLoanCalc({ tab: 'pay', principal: 100e6, ratePercent: 10.5, startDate: start, payment: 8e6, kind: 'gocLai' });
  assert.match(pay, /^Tính lãi vay theo số tiền trả hàng tháng: vay \*\*100\.000\.000 ₫\*\*/);
  assert.match(pay, /trả \*\*8\.000\.000 ₫\*\* mỗi tháng \(gồm cả gốc và lãi\)/);
  assert.match(describeLoanCalc(null), /chưa đủ số liệu/);
});

test('nhãn cách trả / loại số tiền trong Nhật ký khớp đúng nhãn của trang Tính lãi vay (không bị lệch khi một bên đổi)', () => {
  const start = new Date(2026, 9, 23);
  for (const [method, label] of Object.entries(METHOD_LABELS)) {
    assert.ok(describeLoanCalc({ tab: 'term', principal: 1e6, ratePercent: 10, startDate: start, months: 3, method }).includes(label.toLowerCase()), method);
  }
  for (const [kind, label] of Object.entries(KIND_LABELS)) {
    assert.ok(describeLoanCalc({ tab: 'pay', principal: 1e6, ratePercent: 10, startDate: start, payment: 1e5, kind }).includes(label.toLowerCase()), kind);
  }
});

test('chữ người dùng gõ đưa vào Nhật ký: bỏ dấu *, xuống dòng, khoảng trắng thừa và cắt gọn', () => {
  assert.equal(trailText('  nguyễn **văn**\n  an  '), 'nguyễn văn an');
  assert.equal(trailText(null), '');
  assert.equal(trailText('a'.repeat(100), 10), `${'a'.repeat(9)}…`);
  assert.equal(trailText('abc', 10), 'abc');
});

test('danh sách Thôn/Xóm đã lọc: nêu tối đa 3 nơi, còn lại gộp thành số', () => {
  assert.equal(trailList(['A', 'B']), 'A, B');
  assert.equal(trailList(['A', 'B', 'C', 'D', 'E']), 'A, B, C và 2 nơi khác');
  assert.equal(trailList([]), '');
});

test('mô tả lọc Thôn/Xóm: có lọc, chỉ Thôn, chỉ Xóm và bỏ lọc', () => {
  assert.equal(describeThonXom(['Bình Bắc'], ['Xóm 05']), 'lọc Thôn: **Bình Bắc** · Xóm: **Xóm 05**');
  assert.equal(describeThonXom(['Đông Bình'], []), 'lọc Thôn: **Đông Bình**');
  assert.equal(describeThonXom([], ['Xóm 3']), 'lọc Xóm: **Xóm 3**');
  assert.equal(describeThonXom([], []), 'bỏ lọc Thôn/Xóm');
});

test('mô tả lọc theo ngày ở Lịch sử gửi: đủ 2 đầu, một đầu và bỏ lọc', () => {
  assert.equal(describeDateRange('2026-10-01', '2026-10-31'), 'lọc từ ngày **01/10/2026** đến ngày **31/10/2026**');
  assert.equal(describeDateRange('2026-10-01', ''), 'lọc từ ngày **01/10/2026**');
  assert.equal(describeDateRange('', '2026-10-31'), 'lọc đến ngày **31/10/2026**');
  assert.equal(describeDateRange('', ''), 'bỏ lọc theo ngày');
});

test('mô tả tìm kiếm: ghi rõ ở đâu và gõ gì, ô trống thì không ghi', () => {
  assert.equal(describeSearch('Quản lý OA › Danh sách OA', ' Ái Nhi '), 'Quản lý OA › Danh sách OA: tìm **Ái Nhi**');
  assert.equal(describeSearch('Quản lý OA', '   '), '');
});

test('dòng Nhật ký quá dài được cắt trong 200 ký tự và không để lại dấu ** lẻ (chữ đậm không bị hỏng)', () => {
  const thon = Array.from({ length: 9 }, (_, i) => `Thôn có tên rất dài số ${i}`);
  const label = `Quản lý OA › Gửi tự động › Thêm vào "Báo lãi tự động hàng tháng": ${describeThonXom(thon, thon)}`;
  assert.ok(label.length > 200);
  const clipped = clipLabel(label);
  assert.ok(clipped.length <= 200, String(clipped.length));
  assert.equal((clipped.match(/\*\*/g) || []).length % 2, 0);
  assert.equal(clipLabel('Xem **Nhóm 3** (Tháng 10/2026)'), 'Xem **Nhóm 3** (Tháng 10/2026)');
  assert.equal(clipLabel('  a \n b  '), 'a b');
});
