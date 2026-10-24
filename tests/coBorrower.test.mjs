import test from 'node:test';
import assert from 'node:assert/strict';
import { normPersonName, samePerson, heirNamesOf, reconcileCoBorrower } from '../js/lib/coBorrower.js';

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
