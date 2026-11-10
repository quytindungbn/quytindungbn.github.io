import test from 'node:test';
import assert from 'node:assert/strict';
import { isXomName, parseAddress, shortAddress } from '../js/lib/addressText.js';

test('địa chỉ có xóm: danh sách chỉ hiện xóm và thôn, ẩn xã Bình Sơn và tỉnh Quảng Ngãi', () => {
  assert.equal(shortAddress('Xóm 05, thôn Bình Bắc, xã Bình Sơn, tỉnh Quảng Ngãi'), 'Xóm 05, thôn Bình Bắc');
});

test('địa chỉ không có xóm: chỉ hiện thôn, không lặp thôn', () => {
  assert.equal(shortAddress('thôn Đông Bình, xã Bình Sơn, tỉnh Quảng Ngãi'), 'thôn Đông Bình');
  assert.equal(shortAddress('thôn Đông Bình, thôn Đông Bình, tỉnh Quảng Ngãi'), 'thôn Đông Bình');
});

test('bỏ phần ghi chú "(trước đây là …)" trong ngoặc', () => {
  const address = 'Xóm 11, thôn Bình Nguyên, xã Bình Sơn, tỉnh Quảng Ngãi (trước đây là: Xóm 11, thôn Châu Tử, xã Bình Nguyên, huyện Bình Sơn, tỉnh Quảng Ngãi)';
  assert.equal(shortAddress(address), 'Xóm 11, thôn Bình Nguyên');
});

test('Bình Sơn viết kiểu nào cũng ẩn: xã Bình Sơn, Xã bình sơn, Bình Sơn, huyện Bình Sơn, không dấu', () => {
  for (const commune of ['xã Bình Sơn', 'Xã bình sơn', 'Bình Sơn', 'huyện Bình Sơn', 'xa Binh Son']) {
    assert.equal(shortAddress(`Xóm 2, thôn Bình Bắc, ${commune}, tỉnh Quảng Ngãi`), 'Xóm 2, thôn Bình Bắc', commune);
  }
});

test('khách ngoài xã Bình Sơn thì hiện luôn xã', () => {
  assert.equal(shortAddress('Xóm 3, thôn An Hòa, xã Bình Thạnh, tỉnh Quảng Ngãi'), 'Xóm 3, thôn An Hòa, xã Bình Thạnh');
  assert.equal(shortAddress('Xóm 11, thôn Châu Tử, xã Bình Nguyên, huyện Bình Sơn, tỉnh Quảng Ngãi'), 'Xóm 11, thôn Châu Tử, xã Bình Nguyên');
});

test('tên thôn trùng chữ Bình Sơn vẫn giữ; tỉnh khác Quảng Ngãi vẫn hiện', () => {
  assert.equal(shortAddress('Xóm 1, thôn Bình Sơn, xã Bình Sơn, tỉnh Quảng Ngãi'), 'Xóm 1, thôn Bình Sơn');
  assert.equal(shortAddress('Xóm 1, thôn An Hòa, xã Tịnh Hà, tỉnh Quảng Nam'), 'Xóm 1, thôn An Hòa, xã Tịnh Hà, tỉnh Quảng Nam');
});

test('địa chỉ không có tỉnh, rỗng hoặc chỉ toàn nơi bị ẩn thì vẫn có chữ hợp lý', () => {
  assert.equal(shortAddress('Xóm 5, thôn Bình Bắc'), 'Xóm 5, thôn Bình Bắc');
  assert.equal(shortAddress(''), '');
  assert.equal(shortAddress(null), '');
  assert.equal(shortAddress('xã Bình Sơn, tỉnh Quảng Ngãi'), 'xã Bình Sơn, tỉnh Quảng Ngãi');
});

test('chữ có dấu viết dạng tổ hợp (NFD) vẫn nhận ra tỉnh và xã', () => {
  const address = 'Xóm 05, thôn Bình Bắc, xã Bình Sơn, tỉnh Quảng Ngãi'.normalize('NFD');
  assert.equal(shortAddress(address), 'Xóm 05, thôn Bình Bắc'.normalize('NFD').normalize('NFC'));
});

test('tách địa chỉ: không có xóm thì xóm để trống, không lấy thôn làm xóm', () => {
  assert.deepEqual(parseAddress('thôn Đông Bình, xã Bình Sơn, tỉnh Quảng Ngãi'), { xom: '', thon: 'thôn Đông Bình', xa: 'xã Bình Sơn', tinh: 'tỉnh Quảng Ngãi' });
  assert.deepEqual(parseAddress('Xóm 05, thôn Bình Bắc, xã Bình Sơn, tỉnh Quảng Ngãi'), { xom: 'Xóm 05', thon: 'thôn Bình Bắc', xa: 'xã Bình Sơn', tinh: 'tỉnh Quảng Ngãi' });
});

test('tách địa chỉ: bỏ ghi chú trong ngoặc và giữ cách đoán cũ cho địa chỉ không có từ khóa', () => {
  const noted = parseAddress('Xóm 11, thôn Bình Nguyên, xã Bình Sơn, tỉnh Quảng Ngãi (trước đây là: Xóm 11, thôn Châu Tử, xã Bình Nguyên, huyện Bình Sơn, tỉnh Quảng Ngãi)');
  assert.deepEqual(noted, { xom: 'Xóm 11', thon: 'thôn Bình Nguyên', xa: 'xã Bình Sơn', tinh: 'tỉnh Quảng Ngãi' });
  assert.deepEqual(parseAddress('Bình Nguyên, Bình Bắc, Quảng Ngãi'), { xom: 'Bình Nguyên', thon: 'Bình Bắc', xa: 'Bình Nguyên', tinh: 'Quảng Ngãi' });
});

test('chỉ giá trị bắt đầu bằng "xóm" mới là xóm', () => {
  assert.equal(isXomName('Xóm 05'), true);
  assert.equal(isXomName('XÓM 5'), true);
  assert.equal(isXomName('xom 3'), true);
  assert.equal(isXomName('thôn Đông Bình'), false);
  assert.equal(isXomName(''), false);
  assert.equal(isXomName(undefined), false);
});
