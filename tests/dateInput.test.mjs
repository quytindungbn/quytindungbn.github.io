import test from 'node:test';
import assert from 'node:assert/strict';
import { caretAfterDigits, typeIntoViDate, deleteFromViDate } from '../js/lib/dateInput.js';

test('ngày đã đủ: gõ số đè lên số tại con trỏ và nhảy qua dấu "/"', () => {
  assert.deepEqual(typeIntoViDate('23/10/2026', 6, 6, '5'), { value: '23/10/5026', caret: 7 });
  // con trỏ ngay trước dấu "/": bỏ qua dấu rồi đè số đầu của phần kế tiếp
  assert.deepEqual(typeIntoViDate('23/10/2026', 2, 2, '0'), { value: '23/00/2026', caret: 4 });
  // đè số cuối của phần ngày: con trỏ nhảy qua dấu "/" luôn
  assert.deepEqual(typeIntoViDate('23/10/2026', 1, 1, '9'), { value: '29/10/2026', caret: 3 });
  // ở cuối ô: không thêm số thừa
  assert.deepEqual(typeIntoViDate('23/10/2026', 10, 10, '7'), { value: '23/10/2026', caret: 10 });
});

test('gõ số khi ngày chưa đủ, hoặc chọn hết rồi gõ: để trình duyệt tự chèn (null)', () => {
  assert.equal(typeIntoViDate('23/10/202', 9, 9, '6'), null);
  assert.equal(typeIntoViDate('', 0, 0, '2'), null);
  assert.equal(typeIntoViDate('23/10/2026', 0, 10, '0'), null);
});

test('gõ dấu phân cách: sang phần kế tiếp, 1 số thì thêm số 0 phía trước', () => {
  assert.deepEqual(typeIntoViDate('5', 1, 1, '/'), { value: '05/', caret: 3 });
  assert.deepEqual(typeIntoViDate('05/3', 4, 4, '.'), { value: '05/03/', caret: 6 });
  assert.deepEqual(typeIntoViDate('23/10/2026', 1, 1, '-'), { value: '23/10/2026', caret: 3 });
  assert.deepEqual(typeIntoViDate('23/10/2026', 4, 4, ' '), { value: '23/10/2026', caret: 6 });
  // chưa gõ số nào của phần này thì bỏ qua dấu; đang ở phần năm thì không làm gì
  assert.deepEqual(typeIntoViDate('', 0, 0, '/'), { value: '', caret: 0 });
  assert.deepEqual(typeIntoViDate('23/10/20', 8, 8, '/'), { value: '23/10/20', caret: 8 });
  // chữ cái và nhiều ký tự một lúc (dán): để trình duyệt xử lý rồi định dạng lại
  assert.equal(typeIntoViDate('23/10/2026', 3, 3, 'a'), null);
  assert.equal(typeIntoViDate('23/10/2026', 3, 3, '12'), null);
  assert.equal(typeIntoViDate('23/10/2026', 3, 3, null), null);
});

test('xóa sát dấu "/": xóa luôn số bên cạnh, con trỏ đứng đúng chỗ để gõ lại', () => {
  assert.deepEqual(deleteFromViDate('23/10/2026', 3, 3, false), { value: '21/02/026', caret: 1 });
  assert.deepEqual(deleteFromViDate('23/10/2026', 2, 2, true), { value: '23/02/026', caret: 2 });
  // xóa số thường hoặc có vùng chọn: để trình duyệt xóa
  assert.equal(deleteFromViDate('23/10/2026', 5, 5, false), null);
  assert.equal(deleteFromViDate('23/10/2026', 0, 0, false), null);
  assert.equal(deleteFromViDate('23/10/2026', 2, 5, false), null);
});

test('vị trí con trỏ sau n chữ số', () => {
  assert.equal(caretAfterDigits('23/10/2026', 0), 0);
  assert.equal(caretAfterDigits('23/10/2026', 2), 2);
  assert.equal(caretAfterDigits('23/10/2026', 3), 4);
  assert.equal(caretAfterDigits('23/10/2026', 8), 10);
  assert.equal(caretAfterDigits('23/1', 9), 4);
});
