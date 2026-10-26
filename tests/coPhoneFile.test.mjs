import test from 'node:test';
import assert from 'node:assert/strict';
import { normHeader, parseCoPhoneRows, CO_PHONE_STATUS } from '../js/lib/coPhoneFile.js';

test('normHeader: bỏ dấu, chữ thường, ký tự lạ thành khoảng trắng', () => {
  assert.equal(normHeader('Số HĐTD'), 'so hdtd');
  assert.equal(normHeader(' SĐT  người cùng vay '), 'sdt nguoi cung vay');
  assert.equal(normHeader('CMND/CCCD người thừa kế'), 'cmnd cccd nguoi thua ke');
  assert.equal(normHeader(null), '');
});

const HEAD = ['STT', 'Số HĐTD', 'Mã khách hàng', 'Tên khách hàng', 'Số CMND/CCCD', 'Người thừa kế (mã KH)', 'CMND/CCCD người thừa kế', 'SĐT người cùng vay', 'Ghi chú'];

test('parseCoPhoneRows: tìm đúng cột Số HĐTD + SĐT người cùng vay, không nhầm cột "Người thừa kế (mã KH)" hay CCCD người thừa kế', () => {
  const r = parseCoPhoneRows([HEAD, ['1', '465/26', '11185', 'A', 'x', '0', '', '', 'Không có'], ['2', '464/26', '12134', 'B', 'y', '13079', 'z', '0374512450', '']]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, [{ row: 2, code: '465/26', phone: '' }, { row: 3, code: '464/26', phone: '0374512450' }]);
  assert.equal(r.total, 2);
});

test('parseCoPhoneRows: tiêu đề không ở dòng đầu, tên cột biến thể, bỏ dòng không có Số HĐTD', () => {
  const rows = [['DANH SÁCH'], [], ['Số HĐ', 'Số điện thoại người thừa kế'], ['461/26', '374512450'], ['', '0988777666'], ['462/26', ' 0988 777 666 ']];
  const r = parseCoPhoneRows(rows);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, [{ row: 4, code: '461/26', phone: '374512450' }, { row: 6, code: '462/26', phone: '0988 777 666' }]);
});

test('parseCoPhoneRows: thiếu cột thì báo lý do', () => {
  assert.equal(parseCoPhoneRows([['Số HĐTD', 'Tên']]).ok, false);
  assert.equal(parseCoPhoneRows([['Tên', 'SĐT người cùng vay']]).ok, false);
  assert.equal(parseCoPhoneRows([]).ok, false);
  assert.match(parseCoPhoneRows(null).reason, /Số HĐTD/);
});

test('CO_PHONE_STATUS: đủ nhãn cho mọi trạng thái máy chủ trả về', () => {
  for (const k of ['added', 'replaced', 'same', 'conflict', 'nophone', 'nocontract', 'settled', 'noheir', 'badphone', 'samemain', 'noscope']) assert.ok(CO_PHONE_STATUS[k]?.label, k);
});
