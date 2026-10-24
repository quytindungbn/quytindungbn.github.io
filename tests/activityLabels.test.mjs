import test from 'node:test';
import assert from 'node:assert/strict';
import { describeOrgPatch, describeLoanCalc } from '../js/lib/activityLabels.js';
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
