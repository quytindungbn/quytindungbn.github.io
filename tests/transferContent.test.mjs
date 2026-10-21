import test from 'node:test';
import assert from 'node:assert/strict';
import { transferContent } from '../js/lib/transferContent.js';
import { buildVietQrPayload, clipDisplay } from '../js/lib/vietQrLocal.js';

const contract = { code: '455/26' };
const customer = { name: 'PHẠM THỊ TÀI' };

test('nội dung chuyển khoản: bản trong mã QR không dấu, bản hiển thị có dấu', () => {
  assert.deepEqual(transferContent('lai', contract, customer), { text: 'TRA LAI HDTD 455 26 PHAM THI TAI', shown: 'Trả lãi HĐTD 455/26 PHẠM THỊ TÀI' });
  assert.deepEqual(transferContent('goc', contract, customer), { text: 'TRA GOC HDTD 455 26 PHAM THI TAI', shown: 'Trả gốc HĐTD 455/26 PHẠM THỊ TÀI' });
  assert.deepEqual(transferContent('goc_lai', contract, customer), { text: 'TRA GOC LAI HDTD 455 26 PHAM THI TAI', shown: 'Trả gốc và lãi HĐTD 455/26 PHẠM THỊ TÀI' });
  assert.deepEqual(transferContent('tat_toan', contract, customer), { text: 'TAT TOAN HDTD 455 26 PHAM THI TAI', shown: 'Tất toán HĐTD 455/26 PHẠM THỊ TÀI' });
  assert.deepEqual(transferContent('lai', contract, null), { text: '', shown: '' });
});

test('mã QR luôn chứa nội dung không dấu, kể cả khi có chữ hiển thị có dấu', () => {
  const { text } = transferContent('lai', contract, customer);
  const payload = buildVietQrPayload({ bin: '970446', accountNo: '5200000000825012', amount: 1446000, content: text });
  assert.ok(payload.includes('TRA LAI HDTD 455 26 PHAM THI TAI'));
  assert.ok(!/[^\x20-\x7E]/.test(payload), 'chuỗi QR chỉ gồm ký tự ASCII');
});

test('chữ hiển thị bị cắt đúng như nội dung trong mã QR (tối đa 50 ký tự khi bỏ dấu)', () => {
  const long = transferContent('tat_toan', { code: 'HD20261001' }, { name: 'NGUYỄN THỊ HOA THÔN BÌNH NGUYÊN XÃ AN PHÚ' });
  const payload = buildVietQrPayload({ bin: '970446', accountNo: '5200000000825012', amount: 1000, content: long.text });
  const inQr = /0850([A-Z0-9 ]{50})6304/.exec(payload); // tag 62 > 08: nội dung chuyển khoản, dài đúng 50 ký tự khi bị cắt
  assert.ok(inQr, 'nội dung dài bị cắt còn 50 ký tự trong mã QR');
  const shown = clipDisplay(long.shown, 50);
  const ascii = shown.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đ]/g, 'd').replace(/[Đ]/g, 'D').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(ascii.length <= 50);
  assert.ok(inQr[1].trim().startsWith(ascii), `QR: "${inQr[1]}" / hiển thị: "${ascii}"`);
  assert.equal(clipDisplay('Trả lãi HĐTD 455/26 PHẠM THỊ TÀI', 50), 'Trả lãi HĐTD 455/26 PHẠM THỊ TÀI');
});
