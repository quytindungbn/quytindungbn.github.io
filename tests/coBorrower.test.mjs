import test from 'node:test';
import assert from 'node:assert/strict';
import { normPersonName, samePerson, heirNamesOf, reconcileCoBorrower, checkCoPhone, sanitizeCoPhoneInput } from '../js/lib/coBorrower.js';

test('so sánh tên: bỏ qua hoa/thường và khoảng trắng thừa, giữ dấu', () => {
  assert.equal(normPersonName('  Trần   Văn  Bình '), 'trần văn bình');
  assert.ok(samePerson('TRẦN VĂN BÌNH', 'Trần Văn Bình'));
  assert.ok(!samePerson('Trần Văn Bình', 'Trần Văn Binh'));
  assert.ok(!samePerson('', ''));
  assert.ok(!samePerson(null, 'A'));
});

test('heirNamesOf: bỏ tên trống, tên trùng khách và tên lặp', () => {
  const cts = [{ heirName: 'ĐỖ THỊ HOA' }, { heirName: '' }, { heirName: 'LÊ QUANG NINH' }, { heirName: 'đỗ  thị hoa' }, { heirName: 'VÕ VĂN AN' }, {}];
  assert.deepEqual(heirNamesOf(cts, 'Lê Quang Ninh'), ['ĐỖ THỊ HOA', 'VÕ VĂN AN']);
  assert.deepEqual(heirNamesOf([], 'A'), []);
  assert.deepEqual(heirNamesOf(null, 'A'), []);
});

test('reconcile: hợp đồng không có người cùng vay thì giữ nguyên', () => {
  assert.deepEqual(reconcileCoBorrower('ĐỖ THỊ HOA', []), { action: 'none', name: 'ĐỖ THỊ HOA' });
  assert.deepEqual(reconcileCoBorrower('', []), { action: 'none', name: '' });
});

test('reconcile: chưa lưu ai thì lưu tên đầu tiên', () => {
  assert.deepEqual(reconcileCoBorrower('', ['ĐỖ THỊ HOA', 'VÕ VĂN AN']), { action: 'fill', name: 'ĐỖ THỊ HOA' });
  assert.equal(reconcileCoBorrower(null, ['A B']).action, 'fill');
});

test('reconcile: đúng họ tên đã lưu (ở bất kỳ hợp đồng nào) thì giữ như cũ', () => {
  assert.deepEqual(reconcileCoBorrower('đỗ thị hoa', ['VÕ VĂN AN', 'ĐỖ THỊ HOA']), { action: 'keep', name: 'đỗ thị hoa' });
});

test('reconcile: khác tên thì thay người mới và ghi lại tên cũ', () => {
  assert.deepEqual(reconcileCoBorrower('ĐỖ THỊ HOA', ['TRẦN THỊ LAN']), { action: 'replace', name: 'TRẦN THỊ LAN', prev: 'ĐỖ THỊ HOA' });
});

test('checkCoPhone: đúng 10 số và có số 0 đứng đầu', () => {
  assert.deepEqual(checkCoPhone('0988777666'), { ok: true, empty: false, phone: '0988777666' });
  assert.deepEqual(checkCoPhone('0988 777 666'), { ok: true, empty: false, phone: '0988777666' });
  assert.deepEqual(checkCoPhone('0988.777.666'), { ok: true, empty: false, phone: '0988777666' });
  assert.equal(checkCoPhone('098877766').ok, false); // thiếu 1 số
  assert.equal(checkCoPhone('09887776666').ok, false); // thừa 1 số
  assert.equal(checkCoPhone('988777666').ok, false); // 9 số, thiếu số 0
  assert.equal(checkCoPhone('9887776660').reason, 'Số điện thoại phải bắt đầu bằng số 0.'); // đủ 10 số nhưng không có 0 đầu
  assert.equal(checkCoPhone('+84988777666').ok, false); // không nhận dạng +84
  assert.equal(checkCoPhone('0988abc666').ok, false);
});

test('checkCoPhone: để trống là hợp lệ (xóa số)', () => {
  for (const v of ['', '   ', null, undefined]) assert.deepEqual(checkCoPhone(v), { ok: true, empty: true, phone: '' });
});

test('sanitizeCoPhoneInput: chỉ giữ chữ số, tối đa 10 số, đổi +84 thành 0', () => {
  assert.equal(sanitizeCoPhoneInput('0988 777 666'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('09ab88-777.666 123'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('+84 988 777 666'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('84988777666'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('098'), '098');
  assert.equal(sanitizeCoPhoneInput(''), '');
});
